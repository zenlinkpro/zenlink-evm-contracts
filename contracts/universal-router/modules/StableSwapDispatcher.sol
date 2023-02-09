// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStableSwap} from "../../stableswap/interfaces/IStableSwap.sol";

contract StableSwapDispatcher {
    using SafeERC20 for IERC20;

    error InsufficientAmountIn();

    function swap(address pool, address tokenIn, address tokenOut, address to) external {
        uint8 tokenInIndex = IStableSwap(pool).getTokenIndex(tokenIn);
        uint8 tokenOutIndex = IStableSwap(pool).getTokenIndex(tokenOut);
        uint256 amountIn = IERC20(tokenIn).balanceOf(address(this));
        uint256 prevBalanceOut = IERC20(tokenOut).balanceOf(address(this));

        if (amountIn == 0) revert InsufficientAmountIn();
        IERC20(tokenIn).safeIncreaseAllowance(address(pool), amountIn);
        IStableSwap(pool).swap(tokenInIndex, tokenOutIndex, amountIn, 0, type(uint256).max);

        IERC20(tokenOut).safeTransfer(to, IERC20(tokenOut).balanceOf(address(this)) - prevBalanceOut);
    }
}
