// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { 
    StableSwap, 
    StableSwapStorage, 
    SafeERC20,
    IERC20,
    IStableSwap,
    LPToken
} from "./StableSwap.sol";
import { MetaSwapStorage } from "./MetaSwapStorage.sol";

contract MetaSwap is StableSwap {
    using MetaSwapStorage for StableSwapStorage.SwapStorage;
    using SafeERC20 for IERC20;

    MetaSwapStorage.MetaSwap public metaSwapStorage;

    // events replicated from SwapStorage to make the ABI easier for dumb
    // clients
    event TokenSwapUnderlying(
        address indexed buyer,
        uint256 tokensSold,
        uint256 tokensBought,
        uint128 soldId,
        uint128 boughtId
    );

    /**
     * @notice Get the virtual price, to help calculate profit
     * @return the virtual price, scaled to the POOL_PRECISION_DECIMALS
     */
    function getVirtualPrice()
        external
        view
        virtual
        override
        returns (uint256)
    {
        return MetaSwapStorage.getVirtualPrice(swapStorage, metaSwapStorage);
    }

    /**
     * @notice Calculate amount of tokens you receive on swap
     * @param tokenIndexFrom the token the user wants to sell
     * @param tokenIndexTo the token the user wants to buy
     * @param dx the amount of tokens the user wants to sell. If the token charges
     * a fee on transfers, use the amount that gets transferred after the fee.
     * @return amount of tokens the user will receive
     */
    function calculateSwap(
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) virtual external view override returns (uint256) {
        return MetaSwapStorage.calculateSwap(
            swapStorage,
            metaSwapStorage,
            tokenIndexFrom,
            tokenIndexTo,
            dx
        );
    }

    /**
     * @notice Calculate amount of tokens you receive on swap. For this function,
     * the token indices are flattened out so that underlying tokens are represented.
     * @param tokenIndexFrom the token the user wants to sell
     * @param tokenIndexTo the token the user wants to buy
     * @param dx the amount of tokens the user wants to sell. If the token charges
     * a fee on transfers, use the amount that gets transferred after the fee.
     * @return amount of tokens the user will receive
     */
    function calculateSwapUnderlying(
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external view virtual returns (uint256) {
        return MetaSwapStorage.calculateSwapUnderlying(
            swapStorage,
            metaSwapStorage,
            tokenIndexFrom,
            tokenIndexTo,
            dx
        );
    }

    /**
     * @notice A simple method to calculate prices from deposits or
     * withdrawals, excluding fees but including slippage. This is
     * helpful as an input into the various "min" parameters on calls
     * to fight front-running
     *
     * @dev This shouldn't be used outside frontends for user estimates.
     *
     * @param amounts an array of token amounts to deposit or withdrawal,
     * corresponding to pooledTokens. The amount should be in each
     * pooled token's native precision. If a token charges a fee on transfers,
     * use the amount that gets transferred after the fee.
     * @param deposit whether this is a deposit or a withdrawal
     * @return token amount the user will receive
     */
    function calculateTokenAmount(uint256[] calldata amounts, bool deposit)
        virtual
        external
        view
        override
        returns (uint256)
    {
        return MetaSwapStorage.calculateTokenAmount(
            swapStorage,
            metaSwapStorage,
            amounts,
            deposit
        );
    }

    function calculateRemoveLiquidity(uint256 amount) virtual external view override returns (uint256[] memory) {
        return MetaSwapStorage.calculateRemoveLiquidity(swapStorage, amount);
    }

    /**
     * @notice Calculate the amount of underlying token available to withdraw
     * when withdrawing via only single token
     * @param tokenAmount the amount of LP token to burn
     * @param tokenIndex index of which token will be withdrawn
     * @return availableTokenAmount calculated amount of underlying token
     * available to withdraw
     */
    function calculateRemoveLiquidityOneToken(
        uint256 tokenAmount,
        uint8 tokenIndex
    ) virtual external view override returns (uint256) {
        return MetaSwapStorage.calculateRemoveLiquidityOneToken(
            swapStorage,
            metaSwapStorage,
            tokenAmount,
            tokenIndex
        );
    }

    function initialize(
        address[] memory,
        uint8[] memory,
        string memory,
        string memory,
        uint256,
        uint256,
        uint256,
        address
    ) public virtual override onlyAdmin {
        revert("use initializeMetaSwap() instead");
    }

    /**
     * @notice Initializes this MetaSwap contract with the given parameters.
     * MetaSwap uses an existing Swap pool to expand the available liquidity.
     * _pooledTokens array should contain the base Swap pool's LP token as
     * the last element. For example, if there is a Swap pool consisting of
     * [DAI, USDC, USDT]. Then a MetaSwap pool can be created with [sUSD, BaseSwapLPToken]
     * as _pooledTokens.
     *
     * This will also deploy the LPToken that represents users'
     * LP position. The owner of LPToken will be this contract - which means
     * only this contract is allowed to mint new tokens.
     *
     * @param _pooledTokens an array of ERC20s this pool will accept. The last
     * element must be an existing Swap pool's LP token's address.
     * @param decimals the decimals to use for each pooled token,
     * eg 8 for WBTC. Cannot be larger than POOL_PRECISION_DECIMALS
     * @param lpTokenName the long-form name of the token to be deployed
     * @param lpTokenSymbol the short symbol for the token to be deployed
     * @param _a the amplification coefficient * n * (n - 1). See the
     * StableSwap paper for details
     * @param _fee default swap fee to be initialized with
     * @param _adminFee default adminFee to be initialized with
     */
    function initializeMetaSwap(
        address[] memory _pooledTokens,
        uint8[] memory decimals,
        string memory lpTokenName,
        string memory lpTokenSymbol,
        uint256 _a,
        uint256 _fee,
        uint256 _adminFee,
        address _feeDistributor,
        IStableSwap baseSwap
    ) public virtual onlyAdmin {
        StableSwap.initialize(
            _pooledTokens, 
            decimals, 
            lpTokenName, 
            lpTokenSymbol, 
            _a, 
            _fee, 
            _adminFee, 
            _feeDistributor
        );

        metaSwapStorage.baseSwap = baseSwap;
        metaSwapStorage.baseVirtualPrice = baseSwap.getVirtualPrice();
        metaSwapStorage.baseCacheLastUpdated = block.timestamp;

        // Read all tokens that belong to baseSwap
        {
            uint8 i;
            for (; i < 32; i++) {
                try baseSwap.getToken(i) returns (IERC20 token) {
                    metaSwapStorage.baseTokens.push(token);
                    token.safeApprove(address(baseSwap), type(uint256).max);
                } catch {
                    break;
                }
            }
            require(i > 1, "baseSwap must pool at least 2 tokens");
        }

        // Check the last element of _pooledTokens is owned by baseSwap
        IERC20 baseLPToken = IERC20(_pooledTokens[_pooledTokens.length - 1]);
        require(
            LPToken(address(baseLPToken)).owner() == address(baseSwap),
            "baseLPToken is not owned by baseSwap"
        );

        // Pre-approve the baseLPToken to be used by baseSwap
        baseLPToken.safeApprove(address(baseSwap), type(uint256).max);
    }

    /**
     * @notice Swap two tokens using this pool
     * @param tokenIndexFrom the token the user wants to swap from
     * @param tokenIndexTo the token the user wants to swap to
     * @param dx the amount of tokens the user wants to swap from
     * @param minDy the min amount the user would like to receive, or revert.
     * @param deadline latest timestamp to accept this transaction
     */
    function swap(
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        uint256 deadline
    ) external virtual override nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return MetaSwapStorage.swap(
            swapStorage,
            metaSwapStorage,
            tokenIndexFrom,
            tokenIndexTo,
            dx,
            minDy
        );
    }

    /**
     * @notice Swap two tokens using this pool and the base pool.
     * @param tokenIndexFrom the token the user wants to swap from
     * @param tokenIndexTo the token the user wants to swap to
     * @param dx the amount of tokens the user wants to swap from
     * @param minDy the min amount the user would like to receive, or revert.
     * @param deadline latest timestamp to accept this transaction
     */
    function swapUnderlying(
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        uint256 deadline
    ) external virtual nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return MetaSwapStorage.swapUnderlying(
            swapStorage,
            metaSwapStorage,
            tokenIndexFrom,
            tokenIndexTo,
            dx,
            minDy
        );
    }

    function flashLoan(
        uint256[] memory amountsOut,
        address to,
        bytes calldata data,
        uint256 deadline
    ) external virtual override whenNotPaused nonReentrant deadlineCheck(deadline) {
        MetaSwapStorage.flashLoan(swapStorage, amountsOut, to, data);
    }

    function addLiquidity(
        uint256[] memory amounts,
        uint256 minMintAmount,
        uint256 deadline
    ) external virtual override whenNotPaused nonReentrant deadlineCheck(deadline) returns (uint256) {
        return MetaSwapStorage.addLiquidity(
            swapStorage,
            metaSwapStorage,
            amounts, 
            minMintAmount
        );
    }

    function removeLiquidity(
        uint256 lpAmount,
        uint256[] memory minAmounts,
        uint256 deadline
    ) external  virtual override nonReentrant deadlineCheck(deadline) returns (uint256[] memory) {
        return MetaSwapStorage.removeLiquidity(swapStorage, lpAmount, minAmounts);
    }

    function removeLiquidityOneToken(
        uint256 lpAmount,
        uint8 index,
        uint256 minAmount,
        uint256 deadline
    ) external virtual override nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return MetaSwapStorage.removeLiquidityOneToken(
            swapStorage, 
            metaSwapStorage, 
            lpAmount, 
            index, 
            minAmount
        );
    }

    function removeLiquidityImbalance(
        uint256[] memory amounts,
        uint256 maxBurnAmount,
        uint256 deadline
    ) external virtual override nonReentrant whenNotPaused deadlineCheck(deadline) returns (uint256) {
        return MetaSwapStorage.removeLiquidityImbalance(
            swapStorage, 
            metaSwapStorage, 
            amounts, 
            maxBurnAmount
        );
    }
}

