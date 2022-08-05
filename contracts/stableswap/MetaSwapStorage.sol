// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { LPToken } from "./LPToken.sol";
import { IStableSwap } from "./interfaces/IStableSwap.sol";
import { IStableSwapCallee } from "./interfaces/IStableSwapCallee.sol";
import { StableSwapStorage } from "./StableSwapStorage.sol";

library MetaSwapStorage {
    using SafeERC20 for IERC20;

    event AddLiquidity(
        address indexed provider,
        uint256[] token_amounts,
        uint256[] fees,
        uint256 invariant,
        uint256 token_supply
    );

    event FlashLoan(
        address indexed caller,
        address indexed receiver,
        uint256[] amounts_out
    );

    event TokenExchange(
        address indexed buyer,
        uint256 sold_id,
        uint256 tokens_sold,
        uint256 bought_id,
        uint256 tokens_bought
    );

    event TokenSwapUnderlying(
        address indexed buyer,
        uint256 tokensSold,
        uint256 tokensBought,
        uint128 soldId,
        uint128 boughtId
    );

    event RemoveLiquidity(address indexed provider, uint256[] token_amounts, uint256[] fees, uint256 token_supply);

    event RemoveLiquidityOne(address indexed provider, uint256 index, uint256 token_amount, uint256 coin_amount);

    event RemoveLiquidityImbalance(
        address indexed provider,
        uint256[] token_amounts,
        uint256[] fees,
        uint256 invariant,
        uint256 token_supply
    );

    uint256 public constant FEE_DENOMINATOR = 1e10;
    /// @dev protect from division loss when run approximation loop. We cannot divide at the end because of overflow,
    /// so we add some (small) PRECISION when divide in each iteration
    uint256 public constant A_PRECISION = 100;
    /// @dev max iteration of converge calculate
    uint256 internal constant MAX_ITERATION = 256;
    uint256 public constant POOL_TOKEN_COMMON_DECIMALS = 18;

    // Cache expire time for the stored value of base Swap's virtual price
    uint256 public constant BASE_CACHE_EXPIRE_TIME = 10 minutes;
    uint256 public constant BASE_VIRTUAL_PRICE_PRECISION = 10**18;

    struct MetaSwap {
        // Meta-Swap related parameters
        IStableSwap baseSwap;
        uint256 baseVirtualPrice;
        uint256 baseCacheLastUpdated;
        IERC20[] baseTokens;
    }

    // Struct storing variables used in calculations in the
    // calculateRemoveLiquidityOneTokenInfo function to avoid stack too deep errors
    struct CalculateRemoveLiquidityOneTokenInfo {
        uint256 D0;
        uint256 D1;
        uint256 newY;
        uint256 feePerToken;
        uint256 preciseA;
        uint256 xpi;
    }

    // Struct storing variables used in calculation in removeLiquidityImbalance function
    // to avoid stack too deep error
    struct ManageLiquidityInfo {
        uint256 D0;
        uint256 D1;
        uint256 D2;
        LPToken lpToken;
        uint256 totalSupply;
        uint256 preciseA;
        uint256 baseVirtualPrice;
        uint256[] tokenPrecisionMultipliers;
        uint256[] newBalances;
    }

    struct SwapUnderlyingInfo {
        uint256 x;
        uint256 dx;
        uint256 dy;
        uint256[] tokenPrecisionMultipliers;
        uint256[] oldBalances;
        IERC20[] baseTokens;
        IERC20 tokenFrom;
        uint8 metaIndexFrom;
        IERC20 tokenTo;
        uint8 metaIndexTo;
        uint256 baseVirtualPrice;
    }

    struct CalculateSwapUnderlyingInfo {
        uint256 baseVirtualPrice;
        IStableSwap baseSwap;
        uint8 baseLPTokenIndex;
        uint8 baseTokensLength;
        uint8 metaIndexTo;
        uint256 x;
        uint256 dy;
    }

    /**
     * @notice swap two tokens in the pool
     * @param self Swap struct to read from and write to
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @param tokenIndexFrom the token the user wants to sell
     * @param tokenIndexTo the token the user wants to buy
     * @param dx the amount of tokens the user wants to sell
     * @param minDy the min amount the user would like to receive, or revert.
     * @return amount of token user received on swap
     */
    function swap(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256 tokenIndexFrom,
        uint256 tokenIndexTo,
        uint256 dx,
        uint256 minDy
    ) external returns (uint256) {
        {
            uint256 pooledTokensLength = self.pooledTokens.length;
            require(
                tokenIndexFrom < pooledTokensLength && tokenIndexTo < pooledTokensLength,
                "Token index is out of range"
            );
        }

        uint256 transferredDx;
        {
            IERC20 tokenFrom = self.pooledTokens[tokenIndexFrom];
            require(
                dx <= tokenFrom.balanceOf(msg.sender),
                "Cannot swap more than you own"
            );
            transferredDx = _doTransferIn(tokenFrom, dx);
        }
        (uint256 dy, uint256 dyFee) = _calculateSwap(
            self,
            tokenIndexFrom,
            tokenIndexTo,
            transferredDx,
            _updateBaseVirtualPrice(metaSwapStorage)
        );
        require(dy >= minDy, "Swap didn't result in min tokens");
        uint256 dyAdminFee = ((dyFee * self.adminFee) / FEE_DENOMINATOR) / self.tokenMultipliers[tokenIndexTo];
        self.balances[tokenIndexFrom] += transferredDx;
        self.balances[tokenIndexTo] -= dy + dyAdminFee;

        self.pooledTokens[tokenIndexTo].safeTransfer(msg.sender, dy);
        emit TokenExchange(
            msg.sender,
            tokenIndexFrom,
            transferredDx,
            tokenIndexTo,
            dy
        );

        return dy;
    }

    /**
     * @notice Swaps with the underlying tokens of the base Swap pool. For this function,
     * the token indices are flattened out so that underlying tokens are represented
     * in the indices.
     * @dev Since this calls multiple external functions during the execution,
     * it is recommended to protect any function that depends on this with reentrancy guards.
     * @param self Swap struct to read from and write to
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @param tokenIndexFrom the token the user wants to sell
     * @param tokenIndexTo the token the user wants to buy
     * @param dx the amount of tokens the user wants to sell
     * @param minDy the min amount the user would like to receive, or revert.
     * @return amount of token user received on swap
     */
    function swapUnderlying(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy
    ) external returns (uint256) {
        SwapUnderlyingInfo memory v = SwapUnderlyingInfo(
            0,
            0,
            0,
            self.tokenMultipliers,
            self.balances,
            metaSwapStorage.baseTokens,
            IERC20(address(0)),
            0,
            IERC20(address(0)),
            0,
            _updateBaseVirtualPrice(metaSwapStorage)
        );

        uint8 baseLPTokenIndex = uint8(v.oldBalances.length - 1);

        {
            uint8 maxRange = uint8(baseLPTokenIndex + v.baseTokens.length);
            require(
                tokenIndexFrom < maxRange && tokenIndexTo < maxRange,
                "Token index out of range"
            );
        }

        IStableSwap baseSwap = metaSwapStorage.baseSwap;

        // Find the address of the token swapping from and the index in MetaSwap's token list
        if (tokenIndexFrom < baseLPTokenIndex) {
            v.tokenFrom = self.pooledTokens[tokenIndexFrom];
            v.metaIndexFrom = tokenIndexFrom;
        } else {
            v.tokenFrom = v.baseTokens[tokenIndexFrom - baseLPTokenIndex];
            v.metaIndexFrom = baseLPTokenIndex;
        }

        v.dx = _doTransferIn(v.tokenFrom, dx);

        if (
            tokenIndexFrom < baseLPTokenIndex || tokenIndexTo < baseLPTokenIndex
        ) {
            // Either one of the tokens belongs to the MetaSwap tokens list
            uint256[] memory xp = _xp(
                v.oldBalances,
                v.tokenPrecisionMultipliers,
                v.baseVirtualPrice
            );

            if (tokenIndexFrom < baseLPTokenIndex) {
                // Swapping from a MetaSwap token
                v.x = xp[tokenIndexFrom] + (dx * v.tokenPrecisionMultipliers[tokenIndexFrom]);
            } else {
                // Swapping from one of the tokens hosted in the base Swap
                // This case requires adding the underlying token to the base Swap, then
                // using the base LP token to swap to the desired token
                uint256[] memory baseAmounts = new uint256[](v.baseTokens.length);
                baseAmounts[tokenIndexFrom - baseLPTokenIndex] = v.dx;

                // Add liquidity to the base Swap contract and receive base LP token
                v.dx = baseSwap.addLiquidity(baseAmounts, 0, block.timestamp);

                // Calculate the value of total amount of baseLPToken we end up with
                v.x = ((v.dx * v.baseVirtualPrice) / BASE_VIRTUAL_PRICE_PRECISION) + xp[baseLPTokenIndex];
            }

            // Calculate how much to withdraw in MetaSwap level and the the associated swap fee
            uint256 dyFee;
            {
                uint256 y = _getY(
                    self,
                    v.metaIndexFrom,
                    v.metaIndexTo,
                    v.x,
                    xp
                );
                v.dy = xp[v.metaIndexTo] - y - 1;
                if (tokenIndexTo >= baseLPTokenIndex) {
                    // When swapping to a base Swap token, scale down dy by its virtual price
                    v.dy = (v.dy * BASE_VIRTUAL_PRICE_PRECISION) / v.baseVirtualPrice;
                }
                dyFee = (v.dy * self.fee) / FEE_DENOMINATOR;
                v.dy = (v.dy - dyFee) / v.tokenPrecisionMultipliers[v.metaIndexTo];
            }

            // Update the balances array according to the calculated input and output amount
            {
                uint256 dyAdminFee = (dyFee * self.adminFee) / FEE_DENOMINATOR;
                dyAdminFee = dyAdminFee / v.tokenPrecisionMultipliers[v.metaIndexTo];
                self.balances[v.metaIndexFrom] = v.oldBalances[v.metaIndexFrom] + v.dx;
                self.balances[v.metaIndexTo] = v.oldBalances[v.metaIndexTo] - v.dy - dyAdminFee;
            }

            if (tokenIndexTo >= baseLPTokenIndex) {
                // When swapping to a token that belongs to the base Swap, burn the LP token
                // and withdraw the desired token from the base pool
                uint256 oldBalance = v.tokenTo.balanceOf(address(this));
                baseSwap.removeLiquidityOneToken(
                    v.dy,
                    tokenIndexTo - baseLPTokenIndex,
                    0,
                    block.timestamp
                );
                v.dy = v.tokenTo.balanceOf(address(this)) - oldBalance;
            }

            // Check the amount of token to send meets minDy
            require(v.dy >= minDy, "Swap didn't result in min tokens");
        } else {
            // Both tokens are from the base Swap pool
            // Do a swap through the base Swap
            v.dy = v.tokenTo.balanceOf(address(this));
            baseSwap.swap(
                tokenIndexFrom - baseLPTokenIndex,
                tokenIndexTo - baseLPTokenIndex,
                v.dx,
                minDy,
                block.timestamp
            );
            v.dy = v.tokenTo.balanceOf(address(this)) - v.dy;
        }

        // Send the desired token to the caller
        v.tokenTo.safeTransfer(msg.sender, v.dy);

        emit TokenSwapUnderlying(
            msg.sender,
            dx,
            v.dy,
            tokenIndexFrom,
            tokenIndexTo
        );

        return v.dy;
    }

    function flashLoan(
        StableSwapStorage.SwapStorage storage self,
        uint256[] memory amountsOut,
        address to,
        bytes calldata data
    ) external {
        uint256 nCoins = self.pooledTokens.length;
        require(amountsOut.length == nCoins, "invalidAmountsLength");
        {
            uint256 tokenSupply = self.lpToken.totalSupply();
            require(tokenSupply > 0, "insufficientLiquidity");
        }
        uint256[] memory fees = new uint256[](nCoins);
        uint256 _fee = _feePerToken(self);
        uint256 amp = _getAPrecise(self);
        uint256 D0 = _getD(_xp(self.balances, self.tokenMultipliers), amp);

        for (uint256 i = 0; i < nCoins; i++) {
            if (amountsOut[i] > 0) {
                require(amountsOut[i] < self.balances[i], "insufficientBalance");
                fees[i] = (_fee * amountsOut[i]) / FEE_DENOMINATOR;
                self.pooledTokens[i].safeTransfer(to, amountsOut[i]);
            }
        }

        if (data.length > 0) {
            IStableSwapCallee(to).zenlinkStableSwapCall(
                msg.sender, 
                self.pooledTokens,
                amountsOut, 
                fees, 
                data
            );
        }

        uint256[] memory newBalances = self.balances;
        for (uint256 i = 0; i < nCoins; i++) {
            if (amountsOut[i] > 0) {
                newBalances[i] += (_doTransferIn(self.pooledTokens[i], amountsOut[i] + fees[i]) - amountsOut[i]);
            }
        }

        uint256 D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
        assert(D1 > D0);

        uint256 diff = 0;
        for (uint256 i = 0; i < nCoins; i++) {
            diff = _distance((D1 * self.balances[i]) / D0, newBalances[i]);
            fees[i] = (_fee * diff) / FEE_DENOMINATOR;
            self.balances[i] = newBalances[i] - ((fees[i] * self.adminFee) / FEE_DENOMINATOR);
        }

        emit FlashLoan(msg.sender, to, amountsOut);
    }

    /**
     * @notice Add liquidity to the pool
     * @param self Swap struct to read from and write to
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @param amounts the amounts of each token to add, in their native precision
     * @param minToMint the minimum LP tokens adding this amount of liquidity
     * should mint, otherwise revert. Handy for front-running mitigation
     * allowed addresses. If the pool is not in the guarded launch phase, this parameter will be ignored.
     * @return amount of LP token user received
     */
    function addLiquidity(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256[] memory amounts,
        uint256 minToMint
    ) external returns (uint256) {
        IERC20[] memory pooledTokens = self.pooledTokens;
        require(
            amounts.length == pooledTokens.length,
            "Amounts must match pooled tokens"
        );
        uint256[] memory fees = new uint256[](pooledTokens.length);

        // current state
        ManageLiquidityInfo memory v = ManageLiquidityInfo(
            0,
            0,
            0,
            self.lpToken,
            0,
            _getAPrecise(self),
            _updateBaseVirtualPrice(metaSwapStorage),
            self.tokenMultipliers,
            self.balances
        );
        v.totalSupply = v.lpToken.totalSupply();
        
        if (v.totalSupply != 0) {
            v.D0 = _getD(
                _xp(v.newBalances, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
                v.preciseA
            );
        }

        for (uint256 i = 0; i < pooledTokens.length; i++) {
            require(
                v.totalSupply != 0 || amounts[i] > 0,
                "Must supply all tokens in pool"
            );

            if (amounts[i] > 0) {
                v.newBalances[i] += _doTransferIn(pooledTokens[i], amounts[i]);
            }
        }

        v.D1 = _getD(
            _xp(v.newBalances, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
            v.preciseA
        );
        require(v.D1 > v.D0, "D should increase");

        // updated to reflect fees and calculate the user's LP tokens
        v.D2 = v.D1;
        uint256 toMint;

        if (v.totalSupply > 0) {
            uint256 feePerToken = _feePerToken(self);
            for (uint256 i = 0; i < pooledTokens.length; i++) {
                uint256 idealBalance = (v.D1 * self.balances[i]) / v.D0;
                fees[i] = (feePerToken * (_distance(idealBalance, v.newBalances[i]))) / FEE_DENOMINATOR;
                self.balances[i] = v.newBalances[i] - ((fees[i] * self.adminFee) / FEE_DENOMINATOR);
                v.newBalances[i] -= fees[i];
            }
            v.D2 = _getD(
                _xp(v.newBalances, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
                v.preciseA
            );
            toMint = ((v.D2 - v.D0) * v.totalSupply) / v.D0;
        } else {
            // the initial depositor doesn't pay fees
            self.balances = v.newBalances;
            toMint = v.D1;
        }

        require(toMint >= minToMint, "Couldn't mint min requested");
        // mint the user's LP tokens
        self.lpToken.mint(msg.sender, toMint);

        emit AddLiquidity(msg.sender, amounts, fees, v.D1, toMint);

        return toMint;
    }

    function removeLiquidity(
        StableSwapStorage.SwapStorage storage self,
        uint256 lpAmount,
        uint256[] memory minAmounts
    ) external returns (uint256[] memory amounts) {
        uint256 totalSupply = self.lpToken.totalSupply();
        require(lpAmount <= totalSupply);
        uint256 nCoins = self.pooledTokens.length;

        uint256[] memory fees = new uint256[](nCoins);
        amounts = _calculateRemoveLiquidity(self, lpAmount);

        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] >= minAmounts[i], "> slippage");
            self.balances[i] = self.balances[i] - amounts[i];
            self.pooledTokens[i].safeTransfer(msg.sender, amounts[i]);
        }

        self.lpToken.burnFrom(msg.sender, lpAmount);
        emit RemoveLiquidity(msg.sender, amounts, fees, totalSupply - lpAmount);
    }

    /**
     * @notice Remove liquidity from the pool all in one token.
     * @param self Swap struct to read from and write to
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @param tokenAmount the amount of the lp tokens to burn
     * @param tokenIndex the index of the token you want to receive
     * @param minAmount the minimum amount to withdraw, otherwise revert
     * @return amount chosen token that user received
     */
    function removeLiquidityOneToken(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256 tokenAmount,
        uint8 tokenIndex,
        uint256 minAmount
    ) external returns (uint256) {
        LPToken lpToken = self.lpToken;
        uint256 totalSupply = lpToken.totalSupply();
        uint256 numTokens = self.pooledTokens.length;
        require(tokenAmount <= lpToken.balanceOf(msg.sender), ">LP.balanceOf");
        require(tokenIndex < numTokens, "Token not found");

        uint256 dyFee;
        uint256 dy;

        (dy, dyFee) = _calculateRemoveLiquidityOneToken(
            self,
            tokenAmount,
            tokenIndex,
            _updateBaseVirtualPrice(metaSwapStorage),
            totalSupply
        );

        require(dy >= minAmount, "dy < minAmount");

        self.balances[tokenIndex] -= (dy + (dyFee * self.adminFee) / FEE_DENOMINATOR);
        // Burn the associated LP token from the caller and send the desired token
        lpToken.burnFrom(msg.sender, tokenAmount);
        self.pooledTokens[tokenIndex].safeTransfer(msg.sender, dy);

        emit RemoveLiquidityOne(msg.sender, tokenIndex, tokenAmount, dy);

        return dy;
    }

    /**
     * @notice Remove liquidity from the pool, weighted differently than the
     * pool's current balances.
     *
     * @param self Swap struct to read from and write to
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @param amounts how much of each token to withdraw
     * @param maxBurnAmount the max LP token provider is willing to pay to
     * remove liquidity. Useful as a front-running mitigation.
     * @return actual amount of LP tokens burned in the withdrawal
     */
    function removeLiquidityImbalance(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256[] memory amounts,
        uint256 maxBurnAmount
    ) external returns (uint256) {
        // Using this struct to avoid stack too deep error
        ManageLiquidityInfo memory v = ManageLiquidityInfo(
            0,
            0,
            0,
            self.lpToken,
            0,
            _getAPrecise(self),
            _updateBaseVirtualPrice(metaSwapStorage),
            self.tokenMultipliers,
            self.balances
        );
        v.totalSupply = v.lpToken.totalSupply();

        require(
            amounts.length == v.newBalances.length,
            "Amounts should match pool tokens"
        );
        require(maxBurnAmount != 0, "Must burn more than 0");

        uint256 feePerToken = _feePerToken(self);

        // Calculate how much LPToken should be burned
        uint256[] memory fees = new uint256[](v.newBalances.length);
        {
            uint256[] memory balances1 = new uint256[](v.newBalances.length);
            v.D0 = _getD(
                _xp(v.newBalances, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
                v.preciseA
            );
            for (uint256 i = 0; i < v.newBalances.length; i++) {
                balances1[i] = v.newBalances[i] - amounts[i];
            }
            v.D1 = _getD(
                _xp(balances1, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
                v.preciseA
            );

            for (uint256 i = 0; i < v.newBalances.length; i++) {
                uint256 idealBalance = (v.D1 * v.newBalances[i]) / v.D0;
                uint256 difference = _distance(idealBalance, balances1[i]);
                fees[i] = (feePerToken * difference) / FEE_DENOMINATOR;
                self.balances[i] = balances1[i] - ((fees[i] * self.adminFee) / FEE_DENOMINATOR);
                balances1[i] -= fees[i];
            }

            v.D2 = _getD(
                _xp(balances1, v.tokenPrecisionMultipliers, v.baseVirtualPrice),
                v.preciseA
            );
        }

        uint256 tokenAmount = ((v.D0 - v.D2) * v.totalSupply) / v.D0;
        require(tokenAmount != 0, "Burnt amount cannot be zero");

        // Scale up by withdraw fee
        tokenAmount += 1;
        // Check for max burn amount
        require(tokenAmount <= maxBurnAmount, "tokenAmount > maxBurnAmount");
        
        // Burn the calculated amount of LPToken from the caller and send the desired tokens
        v.lpToken.burnFrom(msg.sender, tokenAmount);
        for (uint256 i = 0; i < v.newBalances.length; i++) {
            if (amounts[i] > 0) {
                self.pooledTokens[i].safeTransfer(msg.sender, amounts[i]);
            }
        }

        emit RemoveLiquidityImbalance(msg.sender, amounts, fees, v.D1, v.totalSupply - tokenAmount);

        return tokenAmount;
    }

    /// VIEW FUNCTIONS

    /**
     * @notice Get the virtual price, to help calculate profit
     * @param self Swap struct to read from
     * @param metaSwapStorage MetaSwap struct to read from
     * @return the virtual price, scaled to precision of BASE_VIRTUAL_PRICE_PRECISION
     */
    function getVirtualPrice(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage
    ) external view returns (uint256) {
        uint256 D = _getD(_xp(self, _getBaseVirtualPrice(metaSwapStorage)), _getAPrecise(self));
        uint256 tokenSupply = self.lpToken.totalSupply();
        if (tokenSupply != 0) {
            return (D * BASE_VIRTUAL_PRICE_PRECISION) / tokenSupply;
        }
        return 0;
    }

    function calculateRemoveLiquidityOneToken(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256 inAmount,
        uint256 inIndex
    ) external view returns (uint256 amount) {
        (amount, ) = _calculateRemoveLiquidityOneToken(
            self,
            inAmount,
            inIndex,
            _getBaseVirtualPrice(metaSwapStorage),
            self.lpToken.totalSupply()
        );
    }

    function calculateSwap(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256 inIndex,
        uint256 outIndex,
        uint256 inAmount
    ) external view returns (uint256 outAmount) {
        (outAmount, ) = _calculateSwap(
            self, 
            inIndex, 
            outIndex, 
            inAmount, 
            _getBaseVirtualPrice(metaSwapStorage)
        );
    }

    /**
     * @notice Calculates the expected return amount from swapping between
     * the pooled tokens and the underlying tokens of the base Swap pool.
     *
     * @param self Swap struct to read from
     * @param metaSwapStorage MetaSwap struct from the same contract
     * @param tokenIndexFrom the token to sell
     * @param tokenIndexTo the token to buy
     * @param dx the number of tokens to sell. If the token charges a fee on transfers,
     * use the amount that gets transferred after the fee.
     * @return dy the number of tokens the user will get
     */
    function calculateSwapUnderlying(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external view returns (uint256) {
        CalculateSwapUnderlyingInfo memory v = CalculateSwapUnderlyingInfo(
            _getBaseVirtualPrice(metaSwapStorage),
            metaSwapStorage.baseSwap,
            0,
            uint8(metaSwapStorage.baseTokens.length),
            0,
            0,
            0
        );
        uint256[] memory xp = _xp(self, v.baseVirtualPrice);
        v.baseLPTokenIndex = uint8(xp.length - 1);
        {
            uint8 maxRange = v.baseLPTokenIndex + v.baseTokensLength;
            require(
                tokenIndexFrom < maxRange && tokenIndexTo < maxRange,
                "Token index out of range"
            );
        }

        if (tokenIndexFrom < v.baseLPTokenIndex) {
            // tokenFrom is from this pool
            v.x = xp[tokenIndexFrom] + (dx * self.tokenMultipliers[tokenIndexFrom]);
        } else {
            // tokenFrom is from the base pool
            tokenIndexFrom = tokenIndexFrom - v.baseLPTokenIndex;
            if (tokenIndexTo < v.baseLPTokenIndex) {
                uint256[] memory baseInputs = new uint256[](v.baseTokensLength);
                baseInputs[tokenIndexFrom] = dx;
                v.x = (
                    v.baseSwap.calculateTokenAmount(baseInputs, true) * v.baseVirtualPrice
                ) / BASE_VIRTUAL_PRICE_PRECISION;
                // when adding to the base pool,you pay approx 50% of the swap fee
                v.x = v.x 
                    - ((v.x * _getBaseSwapFee(metaSwapStorage.baseSwap)) / (FEE_DENOMINATOR * 2))
                    + xp[v.baseLPTokenIndex];
            } else {
                return v.baseSwap.calculateSwap(
                    tokenIndexFrom,
                    tokenIndexTo - v.baseLPTokenIndex,
                    dx
                );
            }
            tokenIndexFrom = v.baseLPTokenIndex;
        }

        v.metaIndexTo = v.baseLPTokenIndex;
        if (tokenIndexTo < v.baseLPTokenIndex) {
            v.metaIndexTo = tokenIndexTo;
        }

        {
            uint256 y = _getY(
                self,
                tokenIndexFrom,
                v.metaIndexTo,
                v.x,
                xp
            );
            v.dy = xp[v.metaIndexTo] - y - 1;
            uint256 dyFee = (v.dy * self.fee) / FEE_DENOMINATOR;
            v.dy = v.dy - dyFee;
        }

        if (tokenIndexTo < v.baseLPTokenIndex) {
            // tokenTo is from this pool
            v.dy = v.dy / self.tokenMultipliers[v.metaIndexTo];
        } else {
            // tokenTo is from the base pool
            v.dy = v.baseSwap.calculateRemoveLiquidityOneToken(
                (v.dy * BASE_VIRTUAL_PRICE_PRECISION) / v.baseVirtualPrice,
                tokenIndexTo - v.baseLPTokenIndex
            );
        }

        return v.dy;
    }

    function calculateRemoveLiquidity(StableSwapStorage.SwapStorage storage self, uint256 amount)
        external
        view
        returns (uint256[] memory)
    {
        return _calculateRemoveLiquidity(self, amount);
    }

    /**
     * @notice A simple method to calculate prices from deposits or
     * withdrawals, excluding fees but including slippage. This is
     * helpful as an input into the various "min" parameters on calls
     * to fight front-running
     *
     * @dev This shouldn't be used outside frontends for user estimates.
     *
     * @param self Swap struct to read from
     * @param metaSwapStorage MetaSwap struct to read from
     * @param amounts an array of token amounts to deposit or withdrawal,
     * corresponding to pooledTokens. The amount should be in each
     * pooled token's native precision. If a token charges a fee on transfers,
     * use the amount that gets transferred after the fee.
     * @param deposit whether this is a deposit or a withdrawal
     * @return if deposit was true, total amount of lp token that will be minted and if
     * deposit was false, total amount of lp token that will be burned
     */
    function calculateTokenAmount(
        StableSwapStorage.SwapStorage storage self,
        MetaSwap storage metaSwapStorage,
        uint256[] calldata amounts,
        bool deposit
    ) external view returns (uint256) {
        uint256 amp = _getAPrecise(self);
        uint256 D0;
        uint256 D1;
        {
            uint256 baseVirtualPrice = _getBaseVirtualPrice(metaSwapStorage);
            uint256[] memory balances1 = self.balances;
            uint256[] memory tokenPrecisionMultipliers = self.tokenMultipliers;
            uint256 numTokens = balances1.length;
            D0 = _getD(_xp(balances1, tokenPrecisionMultipliers, baseVirtualPrice), amp);
            for (uint256 i = 0; i < numTokens; i++) {
                if (deposit) {
                    balances1[i] += amounts[i];
                } else {
                    balances1[i] -= amounts[i];
                }
            }
            D1 = _getD(_xp(balances1, tokenPrecisionMultipliers, baseVirtualPrice), amp);
        }
        uint256 totalSupply = self.lpToken.totalSupply();
        if (deposit) {
            return ((D1 - D0) * totalSupply) / D0;
        } else {
            return ((D0 - D1) * totalSupply) / D0;
        }
    }

    /// INTERNAL FUNCTIONS

    /**
     * @notice Return the stored value of base Swap's virtual price. If
     * value was updated past BASE_CACHE_EXPIRE_TIME, then read it directly
     * from the base Swap contract.
     * @param metaSwapStorage MetaSwap struct to read from
     * @return base Swap's virtual price
     */
    function _getBaseVirtualPrice(MetaSwap storage metaSwapStorage) internal view returns (uint256) {
        if (block.timestamp > metaSwapStorage.baseCacheLastUpdated + BASE_CACHE_EXPIRE_TIME) {
            return metaSwapStorage.baseSwap.getVirtualPrice();
        }
        return metaSwapStorage.baseVirtualPrice;
    }

    function _getBaseSwapFee(IStableSwap baseSwap)
        internal
        view
        returns (uint256 fee)
    {
        (, fee, , , , , ) = baseSwap.swapStorage();
    }


    function _calculateRemoveLiquidity(StableSwapStorage.SwapStorage storage self, uint256 amount)
        internal
        view
        returns (uint256[] memory)
    {
        uint256 totalSupply = self.lpToken.totalSupply();
        require(amount <= totalSupply, "Cannot exceed total supply");

        uint256[] memory amounts = new uint256[](self.pooledTokens.length);

        for (uint256 i = 0; i < self.pooledTokens.length; i++) {
            amounts[i] = (self.balances[i] * (amount)) / (totalSupply);
        }
        return amounts;
    }

    function _calculateRemoveLiquidityOneToken(
        StableSwapStorage.SwapStorage storage self,
        uint256 inAmount,
        uint256 inIndex,
        uint256 baseVirtualPrice,
        uint256 totalSupply
    ) internal view returns(uint256, uint256) {
        uint256 dy;
        uint256 swapFee;
        {
            uint256 currentY;
            uint256 newY;

            (dy, newY, currentY) = _calculateRemoveLiquidityOneTokenDY(
                self,
                inIndex,
                inAmount,
                baseVirtualPrice,
                totalSupply
            );
            swapFee = ((currentY - newY) / self.tokenMultipliers[inIndex]) - dy;
        }

        return (dy, swapFee);
    }

    function _calculateRemoveLiquidityOneTokenDY(
        StableSwapStorage.SwapStorage storage self,
        uint256 inIndex,
        uint256 inAmount,
        uint256 baseVirtualPrice,
        uint256 totalSupply
    ) internal view returns (uint256, uint256, uint256) {
        // Get the current D, then solve the stableswap invariant
        // y_i for D - tokenAmount
        uint256[] memory xp = _xp(self, baseVirtualPrice);
        require(inIndex < xp.length, "Token index out of range");
        CalculateRemoveLiquidityOneTokenInfo memory v = CalculateRemoveLiquidityOneTokenInfo(
            0,
            0,
            0,
            0,
            _getAPrecise(self),
            0
        );
        v.D0 = _getD(xp, v.preciseA);
        v.D1 = v.D0 - ((inAmount * v.D0) / totalSupply);

        require(inAmount <= xp[inIndex], "Withdraw exceeds available");
        v.newY = _getYD(self, v.preciseA, inIndex, xp, v.D1);
        uint256[] memory xpReduced = new uint256[](xp.length);
        v.feePerToken = _feePerToken(self);

        for (uint256 i = 0; i < xp.length; i++) {
            v.xpi = xp[i];
            // if i == tokenIndex, dxExpected = xp[i] * d1 / d0 - newY
            // else dxExpected = xp[i] - (xp[i] * d1 / d0)
            // xpReduced[i] -= dxExpected * fee / FEE_DENOMINATOR
            xpReduced[i] = v.xpi - (
                (
                    (i == inIndex)
                        ? ((v.xpi * v.D1) / v.D0) - v.newY
                        : v.xpi - ((v.xpi * v.D1) / v.D0)
                ) * v.feePerToken / FEE_DENOMINATOR
            );
        }

        uint256 dy = xpReduced[inIndex] - (
            _getYD(self, v.preciseA, inIndex, xpReduced, v.D1)
        );

        if (inIndex == xp.length - 1) {
            dy = (dy * BASE_VIRTUAL_PRICE_PRECISION) / baseVirtualPrice;
            v.newY = (v.newY * BASE_VIRTUAL_PRICE_PRECISION) / baseVirtualPrice;
            xp[inIndex] = (xp[inIndex] * BASE_VIRTUAL_PRICE_PRECISION) / baseVirtualPrice;
        }
        dy = (dy - 1) * self.tokenMultipliers[inIndex];

        return (dy, v.newY, xp[inIndex]);
    }

    function _calculateSwap(
        StableSwapStorage.SwapStorage storage self,
        uint256 inIndex,
        uint256 outIndex,
        uint256 inAmount,
        uint256 baseVirtualPrice
    ) internal view returns (uint256 outAmount, uint256 fee) {
        uint256[] memory normalizedBalances = _xp(self, baseVirtualPrice);
        require(
            inIndex < normalizedBalances.length && outIndex < normalizedBalances.length, 
            "Token index out of range"
        );
        uint256 baseLPTokenIndex = normalizedBalances.length - 1;

        uint256 newInBalance = inAmount * self.tokenMultipliers[inIndex];
        if (inIndex == baseLPTokenIndex) {
            newInBalance = (newInBalance * baseVirtualPrice) / BASE_VIRTUAL_PRICE_PRECISION;
        }
        newInBalance = newInBalance + normalizedBalances[inIndex];

        uint256 outBalance = _getY(self, inIndex, outIndex, newInBalance, normalizedBalances);
        outAmount = normalizedBalances[outIndex] - outBalance - 1;
        if (outIndex == baseLPTokenIndex) {
            outAmount = (outAmount * BASE_VIRTUAL_PRICE_PRECISION) / baseVirtualPrice;
        }

        fee = (outAmount * self.fee) / FEE_DENOMINATOR;
        outAmount = outAmount - fee;
        outAmount = outAmount / self.tokenMultipliers[outIndex];
    }

    /**
     * Ramping A up or down, return A with precision of A_PRECISION
     */
    function _getAPrecise(StableSwapStorage.SwapStorage storage self) internal view returns (uint256) {
        if (block.timestamp >= self.futureATime) {
            return self.futureA;
        }

        if (self.futureA > self.initialA) {
            return
                self.initialA +
                ((self.futureA - self.initialA) * (block.timestamp - self.initialATime)) /
                (self.futureATime - self.initialATime);
        }

        return
            self.initialA -
            ((self.initialA - self.futureA) * (block.timestamp - self.initialATime)) /
            (self.futureATime - self.initialATime);
    }

    /**
     * normalized balances of each tokens.
     */
    function _xp(
        uint256[] memory balances, 
        uint256[] memory rates
    ) internal pure returns (uint256[] memory) {
        for (uint256 i = 0; i < balances.length; i++) {
            rates[i] = (rates[i] * balances[i]);
        }

        return rates;
    }

    function _xp(
        uint256[] memory balances, 
        uint256[] memory rates,
        uint256 baseVirtualPrice
    ) internal pure returns (uint256[] memory) {
        uint256[] memory xp = _xp(balances, rates);
        uint256 baseLPTokenIndex = balances.length - 1;
        xp[baseLPTokenIndex] = (xp[baseLPTokenIndex] * baseVirtualPrice) / BASE_VIRTUAL_PRICE_PRECISION;
        return xp;
    }

    function _xp(
        StableSwapStorage.SwapStorage storage self, 
        uint256 baseVirtualPrice
    ) internal view returns (uint256[] memory) {
        return _xp(
            self.balances,
            self.tokenMultipliers,
            baseVirtualPrice
        );
    }

    /**
     * Calculate D for *NORMALIZED* balances of each tokens
     * @param xp normalized balances of token
     */
    function _getD(uint256[] memory xp, uint256 amp) internal pure returns (uint256) {
        uint256 nCoins = xp.length;
        uint256 sum = _sumOf(xp);
        if (sum == 0) {
            return 0;
        }

        uint256 Dprev = 0;
        uint256 D = sum;
        uint256 Ann = amp * nCoins;

        for (uint256 i = 0; i < MAX_ITERATION; i++) {
            uint256 D_P = D;
            for (uint256 j = 0; j < xp.length; j++) {
                D_P = (D_P * D) / (xp[j] * nCoins);
            }
            Dprev = D;
            D =
                (((Ann * sum) / A_PRECISION + D_P * nCoins) * D) /
                (((Ann - A_PRECISION) * D) / A_PRECISION + (nCoins + 1) * D_P);
            if (_distance(D, Dprev) <= 1) {
                return D;
            }
        }

        // Convergence should occur in 4 loops or less. If this is reached, there may be something wrong
        // with the pool. If this were to occur repeatedly, LPs should withdraw via `removeLiquidity()`
        // function which does not rely on D.
        revert("invariantCalculationFailed");
    }

     /**
     * calculate new balance of when swap
     * Done by solving quadratic equation iteratively.
     *  x_1**2 + x_1 * (sum' - (A*n**n - 1) * D / (A * n**n)) = D ** (n + 1) / (n ** (2 * n) * prod' * A)
     *  x_1**2 + b*x_1 = c
     *  x_1 = (x_1**2 + c) / (2*x_1 + b)
     * @param inIndex index of token to swap in
     * @param outIndex index of token to swap out
     * @param inBalance new balance (normalized) of input token if the swap success
     * @return NORMALIZED balance of output token if the swap success
     */
    function _getY(
        StableSwapStorage.SwapStorage storage self,
        uint256 inIndex,
        uint256 outIndex,
        uint256 inBalance,
        uint256[] memory normalizedBalances
    ) internal view returns (uint256) {
        require(inIndex != outIndex, "sameToken");
        uint256 nCoins = self.pooledTokens.length;
        require(inIndex < nCoins && outIndex < nCoins, "indexOutOfRange");

        uint256 amp = _getAPrecise(self);
        uint256 Ann = amp * nCoins;
        uint256 D = _getD(normalizedBalances, amp);

        uint256 sum = 0; // sum of new balances except output token
        uint256 c = D;
        for (uint256 i = 0; i < nCoins; i++) {
            if (i == outIndex) {
                continue;
            }

            uint256 x = i == inIndex ? inBalance : normalizedBalances[i];
            sum += x;
            c = (c * D) / (x * nCoins);
        }

        c = (c * D * A_PRECISION) / (Ann * nCoins);
        uint256 b = sum + (D * A_PRECISION) / Ann;

        uint256 lastY = 0;
        uint256 y = D;

        for (uint256 index = 0; index < MAX_ITERATION; index++) {
            lastY = y;
            y = (y * y + c) / (2 * y + b - D);
            if (_distance(lastY, y) <= 1) {
                return y;
            }
        }

        revert("yCalculationFailed");
    }

    function _getYD(
        StableSwapStorage.SwapStorage storage self,
        uint256 A,
        uint256 index,
        uint256[] memory xp,
        uint256 D
    ) internal view returns (uint256) {
        uint256 nCoins = self.pooledTokens.length;
        assert(index < nCoins);
        uint256 Ann = A * nCoins;
        uint256 c = D;
        uint256 s = 0;
        uint256 _x = 0;
        uint256 yPrev = 0;

        for (uint256 i = 0; i < nCoins; i++) {
            if (i == index) {
                continue;
            }
            _x = xp[i];
            s += _x;
            c = (c * D) / (_x * nCoins);
        }

        c = (c * D * A_PRECISION) / (Ann * nCoins);
        uint256 b = s + (D * A_PRECISION) / Ann;
        uint256 y = D;

        for (uint256 i = 0; i < MAX_ITERATION; i++) {
            yPrev = y;
            y = (y * y + c) / (2 * y + b - D);
            if (_distance(yPrev, y) <= 1) {
                return y;
            }
        }
        revert("invariantCalculationFailed");
    }

    function _feePerToken(StableSwapStorage.SwapStorage storage self) internal view returns (uint256) {
        uint256 nCoins = self.pooledTokens.length;
        return (self.fee * nCoins) / (4 * (nCoins - 1));
    }

    function _doTransferIn(IERC20 token, uint256 amount) internal returns (uint256) {
        uint256 priorBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - priorBalance;
    }

    function _sumOf(uint256[] memory x) internal pure returns (uint256 sum) {
        sum = 0;
        for (uint256 i = 0; i < x.length; i++) {
            sum += x[i];
        }
    }

    function _distance(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? x - y : y - x;
    }

     /**
     * @notice Determines if the stored value of base Swap's virtual price is expired.
     * If the last update was past the BASE_CACHE_EXPIRE_TIME, then update the stored value.
     *
     * @param metaSwapStorage MetaSwap struct to read from and write to
     * @return base Swap's virtual price
     */
    function _updateBaseVirtualPrice(MetaSwap storage metaSwapStorage) internal returns (uint256) {
        if (
            block.timestamp >
            metaSwapStorage.baseCacheLastUpdated + BASE_CACHE_EXPIRE_TIME
        ) {
            // When the cache is expired, update it
            uint256 baseVirtualPrice = IStableSwap(metaSwapStorage.baseSwap).getVirtualPrice();
            metaSwapStorage.baseVirtualPrice = baseVirtualPrice;
            metaSwapStorage.baseCacheLastUpdated = block.timestamp;
            return baseVirtualPrice;
        } else {
            return metaSwapStorage.baseVirtualPrice;
        }
    }
}
