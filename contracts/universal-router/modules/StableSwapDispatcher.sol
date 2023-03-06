// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwap} from "../interfaces/ISwap.sol";
import {IMetaSwap} from "../interfaces/IMetaSwap.sol";
import {IStableSwapDispatcher} from "../interfaces/IStableSwapDispatcher.sol";
import {IWETH} from "../interfaces/IWETH.sol";

contract StableSwapDispatcher is IStableSwapDispatcher {
    using SafeERC20 for IERC20;

    address public immutable weth;

    error InsufficientAmountIn();

    constructor(address _weth) {
        weth = _weth;
    }

    /// @notice To receive ETH from WETH
    receive() external payable {}

    function swap(
        address _pool,
        bool _isNativePool,
        uint8 _tokenInIndex,
        uint8 _tokenOutIndex,
        address _tokenIn,
        address _tokenOut,
        address _to
    ) external override {
        ISwap pool = ISwap(_pool);
        IERC20 tokenIn = IERC20(_tokenIn);
        IERC20 tokenOut = IERC20(_tokenOut);
        bool isNativeTokenIn = _tokenIn == weth && _isNativePool;
        bool isNatvieTokenOut = _tokenOut == weth && _isNativePool;
        uint256 amountIn = tokenIn.balanceOf(address(this));
        if (amountIn == 0) revert InsufficientAmountIn();
        if (isNativeTokenIn) {
            IWETH(_tokenIn).withdraw(amountIn); 
            pool.swap{value: address(this).balance}(
                _tokenInIndex, 
                _tokenOutIndex, 
                address(this).balance, 
                0, 
                type(uint256).max
            );
        } else {
            tokenIn.safeIncreaseAllowance(address(pool), amountIn);
            pool.swap(_tokenInIndex, _tokenOutIndex, amountIn, 0, type(uint256).max);
        }
        if (isNatvieTokenOut) {
            IWETH(_tokenOut).deposit{value: address(this).balance}();
        }
        tokenOut.safeTransfer(_to, tokenOut.balanceOf(address(this)));
    }

    function swapUnderlying(
        address _pool,
        uint8 _tokenInIndex,
        uint8 _tokenOutIndex,
        address _tokenIn,
        address _tokenOut,
        address _to
    ) external override {
        IMetaSwap metaPool = IMetaSwap(_pool);
        IERC20 tokenIn = IERC20(_tokenIn);
        IERC20 tokenOut = IERC20(_tokenOut);
        uint256 amountIn = tokenIn.balanceOf(address(this));
        if (amountIn == 0) revert InsufficientAmountIn();
        tokenIn.safeIncreaseAllowance(address(metaPool), amountIn);
        metaPool.swapUnderlying(
            _tokenInIndex,
            _tokenOutIndex,
            amountIn,
            0,
            type(uint256).max
        );
        tokenOut.safeTransfer(_to, tokenOut.balanceOf(address(this)));
    }
}
