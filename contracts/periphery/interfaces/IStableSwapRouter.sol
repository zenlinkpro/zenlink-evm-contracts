// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../../stableswap/interfaces/IStableSwap.sol";

interface IStableSwapRouter {
    function convert(
        IStableSwap fromPool,
        IStableSwap toPool,
        uint256 amount,
        uint256 minToMint,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function addPoolLiquidity(
        IStableSwap pool,
        uint256[] memory amounts,
        uint256 minMintAmount,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function addPoolAndBaseLiquidity(
        IStableSwap pool,
        IStableSwap basePool,
        uint256[] memory meta_amounts,
        uint256[] memory base_amounts,
        uint256 minToMint,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function removePoolLiquidity(
        IStableSwap pool,
        uint256 lpAmount,
        uint256[] memory minAmounts,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function removePoolLiquidityOneToken(
        IStableSwap pool,
        uint256 lpAmount,
        uint8 index,
        uint256 minAmount,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function removePoolAndBaseLiquidity(
        IStableSwap pool,
        IStableSwap basePool,
        uint256 _amount,
        uint256[] calldata min_amounts_meta,
        uint256[] calldata min_amounts_base,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts, uint256[] memory base_amounts);

    function removePoolAndBaseLiquidityOneToken(
        IStableSwap pool,
        IStableSwap basePool,
        uint256 _token_amount,
        uint8 i,
        uint256 _min_amount,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function swapPool(
        IStableSwap pool,
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount,
        uint256 minOutAmount,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function swapPoolFromBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function swapPoolToBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        address to,
        uint256 deadline
    ) external returns (uint256);

    function calculateConvert(
        IStableSwap fromPool,
        IStableSwap toPool,
        uint256 amount
    ) external view returns (uint256);

    function calculateTokenAmount(
        IStableSwap pool,
        IStableSwap basePool,
        uint256[] memory meta_amounts,
        uint256[] memory base_amounts,
        bool is_deposit
    ) external view returns (uint256);

    function calculateRemoveLiquidity(
        IStableSwap pool,
        IStableSwap basePool,
        uint256 amount
    ) external view returns (uint256[] memory meta_amounts, uint256[] memory base_amounts);

    function calculateRemoveBaseLiquidityOneToken(
        IStableSwap pool,
        IStableSwap basePool,
        uint256 _token_amount,
        uint8 iBase
    ) external view returns (uint256 availableTokenAmount);

    function calculateSwap(
        IStableSwap pool,
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount
    ) external view returns (uint256);

    function calculateSwapFromBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external view returns (uint256);

    function calculateSwapToBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external view returns (uint256);
}