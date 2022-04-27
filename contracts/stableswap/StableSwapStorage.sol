// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IStableSwapCallee.sol";
import "./LPToken.sol";

/**
 * StableSwap main algorithm
 */
library StableSwapStorage {
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

    struct SwapStorage {
        IERC20[] pooledTokens;
        LPToken lpToken;
        uint256[] tokenMultipliers; // token i multiplier to reach POOL_TOKEN_COMMON_DECIMALS
        uint256[] balances; // effective balance which might different from token balance of the contract 'cause it hold admin fee as well
        uint256 fee; // swap fee ratio. Charge on any action which move balance state far from the ideal state
        uint256 adminFee; // admin fee in ratio of swap fee.
        uint256 initialA; // observation of A, multiplied with A_PRECISION
        uint256 futureA;
        uint256 initialATime;
        uint256 futureATime;
    }

    /**
     * @notice Deposit coins into the pool
     * @param amounts List of amounts of coins to deposit
     * @param minMintAmount Minimum amount of LP tokens to mint from the deposit
     * @return mintAmount Amount of LP tokens received by depositing
     */
    function addLiquidity(
        SwapStorage storage self,
        uint256[] memory amounts,
        uint256 minMintAmount
    ) external returns (uint256 mintAmount) {
        uint256 nCoins = self.pooledTokens.length;
        require(amounts.length == nCoins, "invalidAmountsLength");
        uint256[] memory fees = new uint256[](nCoins);
        uint256 _fee = _feePerToken(self);

        uint256 tokenSupply = self.lpToken.totalSupply();
        uint256 amp = _getAPrecise(self);

        uint256 D0 = 0;
        if (tokenSupply > 0) {
            D0 = _getD(_xp(self.balances, self.tokenMultipliers), amp);
        }

        uint256[] memory newBalances = self.balances;

        for (uint256 i = 0; i < nCoins; i++) {
            if (tokenSupply == 0) {
                require(amounts[i] > 0, "initialDepositRequireAllTokens");
            }
            // get real transfer in amount
            if (amounts[i] > 0) {
                newBalances[i] += _doTransferIn(self.pooledTokens[i], amounts[i]);
            }
        }

        uint256 D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
        assert(D1 > D0); // double check

        if (tokenSupply == 0) {
            self.balances = newBalances;
            mintAmount = D1;
        } else {
            uint256 diff = 0;
            for (uint256 i = 0; i < nCoins; i++) {
                diff = _distance((D1 * self.balances[i]) / D0, newBalances[i]);
                fees[i] = (_fee * diff) / FEE_DENOMINATOR;
                self.balances[i] = newBalances[i] - ((fees[i] * self.adminFee) / FEE_DENOMINATOR);
                newBalances[i] -= fees[i];
            }
            D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
            mintAmount = (tokenSupply * (D1 - D0)) / D0;
        }

        require(mintAmount >= minMintAmount, "> slippage");

        self.lpToken.mint(msg.sender, mintAmount);
        emit AddLiquidity(msg.sender, amounts, fees, D1, mintAmount);
    }

    function flashLoan(
        SwapStorage storage self,
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

    function swap(
        SwapStorage storage self,
        uint256 i,
        uint256 j,
        uint256 inAmount,
        uint256 minOutAmount
    ) external returns (uint256) {
        IERC20 inCoin = self.pooledTokens[i];
        uint256[] memory normalizedBalances = _xp(self);
        inAmount = _doTransferIn(inCoin, inAmount);

        uint256 x = normalizedBalances[i] + (inAmount * self.tokenMultipliers[i]);
        uint256 y = _getY(self, i, j, x, normalizedBalances);

        uint256 dy = normalizedBalances[j] - y - 1; // iliminate rouding errors
        uint256 dy_fee = (dy * self.fee) / FEE_DENOMINATOR;

        dy = (dy - dy_fee) / self.tokenMultipliers[j]; // denormalize

        require(dy >= minOutAmount, "> slippage");

        uint256 _adminFee = (dy_fee * self.adminFee) / FEE_DENOMINATOR / self.tokenMultipliers[j];

        // update balances
        self.balances[i] += inAmount;
        self.balances[j] -= dy + _adminFee;

        self.pooledTokens[j].safeTransfer(msg.sender, dy);
        emit TokenExchange(msg.sender, i, inAmount, j, dy);
        return dy;
    }

    function removeLiquidity(
        SwapStorage storage self,
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

    function removeLiquidityOneToken(
        SwapStorage storage self,
        uint256 lpAmount,
        uint256 index,
        uint256 minAmount
    ) external returns (uint256) {
        uint256 totalSupply = self.lpToken.totalSupply();
        require(totalSupply > 0, "totalSupply = 0");
        uint256 numTokens = self.pooledTokens.length;
        require(lpAmount <= self.lpToken.balanceOf(msg.sender), "> balance");
        require(lpAmount <= totalSupply, "> totalSupply");
        require(index < numTokens, "tokenNotFound");

        uint256 dyFee;
        uint256 dy;

        (dy, dyFee) = _calculateRemoveLiquidityOneToken(self, lpAmount, index);

        require(dy >= minAmount, "> slippage");

        self.balances[index] -= (dy + (dyFee * self.adminFee) / FEE_DENOMINATOR);
        self.lpToken.burnFrom(msg.sender, lpAmount);
        self.pooledTokens[index].safeTransfer(msg.sender, dy);

        emit RemoveLiquidityOne(msg.sender, index, lpAmount, dy);

        return dy;
    }

    function removeLiquidityImbalance(
        SwapStorage storage self,
        uint256[] memory amounts,
        uint256 maxBurnAmount
    ) external returns (uint256 burnAmount) {
        uint256 nCoins = self.pooledTokens.length;
        require(amounts.length == nCoins, "invalidAmountsLength");
        uint256 totalSupply = self.lpToken.totalSupply();
        require(totalSupply != 0, "totalSupply = 0");
        uint256 _fee = _feePerToken(self);
        uint256 amp = _getAPrecise(self);

        uint256[] memory newBalances = self.balances;
        uint256 D0 = _getD(_xp(self), amp);

        for (uint256 i = 0; i < nCoins; i++) {
            newBalances[i] -= amounts[i];
        }

        uint256 D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
        uint256[] memory fees = new uint256[](nCoins);

        for (uint256 i = 0; i < nCoins; i++) {
            uint256 idealBalance = (D1 * self.balances[i]) / D0;
            uint256 diff = _distance(newBalances[i], idealBalance);
            fees[i] = (_fee * diff) / FEE_DENOMINATOR;
            self.balances[i] = newBalances[i] - ((fees[i] * self.adminFee) / FEE_DENOMINATOR);
            newBalances[i] -= fees[i];
        }

        // recalculate invariant with fee charged balances
        D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
        burnAmount = ((D0 - D1) * totalSupply) / D0;
        assert(burnAmount > 0);
        require(burnAmount <= maxBurnAmount, "> slippage");

        self.lpToken.burnFrom(msg.sender, burnAmount);

        for (uint256 i = 0; i < nCoins; i++) {
            if (amounts[i] != 0) {
                self.pooledTokens[i].safeTransfer(msg.sender, amounts[i]);
            }
        }

        emit RemoveLiquidityImbalance(msg.sender, amounts, fees, D1, totalSupply - burnAmount);
    }

    /// VIEW FUNCTIONS
    function getAPrecise(SwapStorage storage self) external view returns (uint256) {
        return _getAPrecise(self);
    }

    /**
     * Returns portfolio virtual price (for calculating profit)
     * scaled up by 1e18
     */
    function getVirtualPrice(SwapStorage storage self) external view returns (uint256) {
        uint256 D = _getD(_xp(self), _getAPrecise(self));
        uint256 tokenSupply = self.lpToken.totalSupply();
        if (tokenSupply > 0) {
            return (D * 10**POOL_TOKEN_COMMON_DECIMALS) / tokenSupply;
        }
        return 0;
    }

    function getAdminBalance(SwapStorage storage self, uint256 index) external view returns (uint256) {
        require(index < self.pooledTokens.length, "indexOutOfRange");
        return self.pooledTokens[index].balanceOf(address(this)) - (self.balances[index]);
    }

    /**
     * Estimate amount of LP token minted or burned at deposit or withdrawal
     * without taking fees into account
     */
    function calculateTokenAmount(
        SwapStorage storage self,
        uint256[] memory amounts,
        bool deposit
    ) external view returns (uint256) {
        uint256 nCoins = self.pooledTokens.length;
        require(amounts.length == nCoins, "invalidAmountsLength");
        uint256 amp = _getAPrecise(self);
        uint256 D0 = _getD(_xp(self), amp);

        uint256[] memory newBalances = self.balances;
        for (uint256 i = 0; i < nCoins; i++) {
            if (deposit) {
                newBalances[i] += amounts[i];
            } else {
                newBalances[i] -= amounts[i];
            }
        }

        uint256 D1 = _getD(_xp(newBalances, self.tokenMultipliers), amp);
        uint256 totalSupply = self.lpToken.totalSupply();

        if (totalSupply == 0) {
            return D1; // first depositor take it all
        }

        uint256 diff = deposit ? D1 - D0 : D0 - D1;
        return (diff * self.lpToken.totalSupply()) / D0;
    }

    function getA(SwapStorage storage self) external view returns (uint256) {
        return _getAPrecise(self) / A_PRECISION;
    }

    function calculateSwap(
        SwapStorage storage self,
        uint256 inIndex,
        uint256 outIndex,
        uint256 inAmount
    ) external view returns (uint256) {
        uint256[] memory normalizedBalances = _xp(self);
        uint256 newInBalance = normalizedBalances[inIndex] + (inAmount * self.tokenMultipliers[inIndex]);
        uint256 outBalance = _getY(self, inIndex, outIndex, newInBalance, normalizedBalances);
        uint256 outAmount = (normalizedBalances[outIndex] - outBalance - 1) / self.tokenMultipliers[outIndex];
        uint256 _fee = (self.fee * outAmount) / FEE_DENOMINATOR;
        return outAmount - _fee;
    }

    function calculateRemoveLiquidity(SwapStorage storage self, uint256 amount)
        external
        view
        returns (uint256[] memory)
    {
        return _calculateRemoveLiquidity(self, amount);
    }

    function calculateRemoveLiquidityOneToken(
        SwapStorage storage self,
        uint256 lpAmount,
        uint256 tokenIndex
    ) external view returns (uint256 amount) {
        (amount, ) = _calculateRemoveLiquidityOneToken(self, lpAmount, tokenIndex);
    }

    /// INTERNAL FUNCTIONS

    /**
     * Ramping A up or down, return A with precision of A_PRECISION
     */
    function _getAPrecise(SwapStorage storage self) internal view returns (uint256) {
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
    function _xp(uint256[] memory balances, uint256[] memory rates) internal pure returns (uint256[] memory) {
        for (uint256 i = 0; i < balances.length; i++) {
            rates[i] = (rates[i] * balances[i]);
        }

        return rates;
    }

    function _xp(SwapStorage storage self) internal view returns (uint256[] memory) {
        return _xp(self.balances, self.tokenMultipliers);
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
        SwapStorage storage self,
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

    function _calculateRemoveLiquidity(SwapStorage storage self, uint256 amount)
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
        SwapStorage storage self,
        uint256 tokenAmount,
        uint256 index
    ) internal view returns (uint256 dy, uint256 fee) {
        require(index < self.pooledTokens.length, "indexOutOfRange");
        uint256 amp = _getAPrecise(self);
        uint256[] memory xp = _xp(self);
        uint256 D0 = _getD(xp, amp);
        uint256 D1 = D0 - (tokenAmount * D0) / self.lpToken.totalSupply();
        uint256 newY = _getYD(self, amp, index, xp, D1);
        uint256[] memory reducedXP = xp;
        uint256 _fee = _feePerToken(self);

        for (uint256 i = 0; i < self.pooledTokens.length; i++) {
            uint256 expectedDx = 0;
            if (i == index) {
                expectedDx = (xp[i] * D1) / D0 - newY;
            } else {
                expectedDx = xp[i] - (xp[i] * D1) / D0;
            }
            reducedXP[i] -= (_fee * expectedDx) / FEE_DENOMINATOR;
        }

        dy = reducedXP[index] - _getYD(self, amp, index, reducedXP, D1);
        dy = (dy - 1) / self.tokenMultipliers[index];
        fee = ((xp[index] - newY) / self.tokenMultipliers[index]) - dy;
    }

    function _feePerToken(SwapStorage storage self) internal view returns (uint256) {
        uint256 nCoins = self.pooledTokens.length;
        return (self.fee * nCoins) / (4 * (nCoins - 1));
    }

    function _getYD(
        SwapStorage storage self,
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
}
