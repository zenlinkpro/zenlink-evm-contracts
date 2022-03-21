// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IWNativeCurrency.sol";
import "./interfaces/ISwapRouterV1.sol";
import "../stableswap/interfaces/IStableSwap.sol";
import "../libraries/Math.sol";
import "../libraries/Helper.sol";

contract SwapRouterV1 is ISwapRouterV1 {
    using SafeERC20 for IERC20;
    using Math for uint256;

    struct StablePath {
        IStableSwap pool;
        IStableSwap basePool;
        address fromToken;
        address toToken;
        bool fromBase;
    }

    address public override factory;
    address public override WNativeCurrency;

    constructor(address _factory, address _WNativeCurrency) {
        factory = _factory;
        WNativeCurrency = _WNativeCurrency;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "SwapRouterV1: EXPIRED");
        _;
    }

    receive() external payable {
        require(msg.sender == WNativeCurrency);
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = Helper.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address to = i < path.length - 2
                ? Helper.pairFor(factory, output, path[i + 2])
                : _to;
            IPair(Helper.pairFor(factory, input, output)).swap(
                amount0Out,
                amount1Out,
                to
            );
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = Helper.getAmountsOut(factory, amountIn, path);
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        Helper.safeTransferFrom(
            path[0],
            msg.sender,
            Helper.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, to);
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = Helper.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, "SwapRouterV1: EXCESSIVE_INPUT_AMOUNT");
        Helper.safeTransferFrom(
            path[0],
            msg.sender,
            Helper.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, to);
    }

    function swapExactNativeCurrencyForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == WNativeCurrency, "SwapRouterV1: INVALID_PATH");
        amounts = Helper.getAmountsOut(factory, msg.value, path);
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        IWNativeCurrency(WNativeCurrency).deposit{value: amounts[0]}();
        require(
            IERC20(WNativeCurrency).transfer(
                Helper.pairFor(factory, path[0], path[1]),
                amounts[0]
            )
        );
        _swap(amounts, path, to);
    }

    function swapTokensForExactNativeCurrency(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        require(
            path[path.length - 1] == WNativeCurrency,
            "SwapRouterV1: INVALID_PATH"
        );
        amounts = Helper.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, "SwapRouterV1: EXCESSIVE_INPUT_AMOUNT");
        Helper.safeTransferFrom(
            path[0],
            msg.sender,
            Helper.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, address(this));
        IWNativeCurrency(WNativeCurrency).withdraw(amounts[amounts.length - 1]);
        Helper.safeTransferNativeCurrency(to, amounts[amounts.length - 1]);
    }

    function swapExactTokensForNativeCurrency(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        require(
            path[path.length - 1] == WNativeCurrency,
            "SwapRouterV1: INVALID_PATH"
        );
        amounts = Helper.getAmountsOut(factory, amountIn, path);
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        Helper.safeTransferFrom(
            path[0],
            msg.sender,
            Helper.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, address(this));
        IWNativeCurrency(WNativeCurrency).withdraw(amounts[amounts.length - 1]);
        Helper.safeTransferNativeCurrency(to, amounts[amounts.length - 1]);
    }

    function swapNativeCurrencyForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == WNativeCurrency, "SwapRouterV1: INVALID_PATH");
        amounts = Helper.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, "SwapRouterV1: EXCESSIVE_INPUT_AMOUNT");
        IWNativeCurrency(WNativeCurrency).deposit{value: amounts[0]}();
        require(
            IERC20(WNativeCurrency).transfer(
                Helper.pairFor(factory, path[0], path[1]),
                amounts[0]
            )
        );
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) {
            Helper.safeTransferNativeCurrency(
                msg.sender,
                msg.value - amounts[0]
            );
        }
    }

    function _swapPool(
        IStableSwap pool,
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount,
        uint256 minOutAmount,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        IERC20 coin = pool.getToken(fromIndex);
        coin.safeIncreaseAllowance(address(pool), inAmount);
        amountOut = pool.swap(fromIndex, toIndex, inAmount, minOutAmount, deadline);
    }

    function _swapPoolFromBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        IERC20 baseToken = basePool.getLpToken();
        uint8 baseTokenIndex = pool.getTokenIndex(address(baseToken));
        uint256[] memory base_amounts = new uint256[](basePool.getNumberOfTokens());
        base_amounts[tokenIndexFrom] = dx;
        IERC20 coin = basePool.getToken(tokenIndexFrom);
        coin.safeIncreaseAllowance(address(basePool), dx);
        uint256 baseLpAmount = basePool.addLiquidity(base_amounts, 0, deadline);
        if (baseTokenIndex != tokenIndexTo) {
            amountOut = _swapPool(pool, baseTokenIndex, tokenIndexTo, baseLpAmount, minDy, deadline);
        } else {
            amountOut = baseLpAmount;
        }
    }

    function _swapPoolToBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        IERC20 baseToken = basePool.getLpToken();
        uint8 baseTokenIndex = pool.getTokenIndex(address(baseToken));
        uint256 tokenLPAmount = dx;
        if (baseTokenIndex != tokenIndexFrom) {
            tokenLPAmount = _swapPool(pool, tokenIndexFrom, baseTokenIndex, dx, 0, deadline);
        }
        baseToken.safeIncreaseAllowance(address(basePool), tokenLPAmount);
        amountOut = basePool.removeLiquidityOneToken(tokenLPAmount, tokenIndexTo, minDy, deadline);
    }

    function swapPool(
        IStableSwap pool,
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount,
        uint256 minOutAmount,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountOut) {
        IERC20 coin = pool.getToken(fromIndex);
        coin.safeTransferFrom(msg.sender, address(this), inAmount);
        amountOut = _swapPool(pool, fromIndex, toIndex, inAmount, minOutAmount, deadline);
        IERC20 coinTo = pool.getToken(toIndex);
        coinTo.safeTransfer(to, amountOut);
    }

    function swapPoolFromBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountOut) {
        IERC20 coin = basePool.getToken(tokenIndexFrom);
        coin.safeTransferFrom(msg.sender, address(this), dx);
        amountOut = _swapPoolFromBase(pool, basePool, tokenIndexFrom, tokenIndexTo, dx, minDy, deadline);
        IERC20 coinTo = pool.getToken(tokenIndexTo);
        coinTo.safeTransfer(to, amountOut);
    }

    function swapPoolToBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx,
        uint256 minDy,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountOut) {
        IERC20 coin = pool.getToken(tokenIndexFrom);
        coin.safeTransferFrom(msg.sender, address(this), dx);
        amountOut = _swapPoolToBase(pool, basePool, tokenIndexFrom, tokenIndexTo, dx, minDy, deadline);
        IERC20 coinTo = basePool.getToken(tokenIndexTo);
        coinTo.safeTransfer(to, amountOut);
    }

    function _anyStableSwap(
        uint256 amountIn,
        Route calldata route,
        uint256 deadline
    ) private returns (address tokenOut, uint256 amountOut) {
        StablePath memory path = _decodeStableSwapCallData(route.callData);
        tokenOut = path.toToken;

        if (address(path.basePool) == address(0)) {
            amountOut = _swapPool(
                path.pool, 
                path.pool.getTokenIndex(path.fromToken), 
                path.pool.getTokenIndex(path.toToken), 
                amountIn, 
                0, 
                deadline
            );
        } else if (path.fromBase) {
            amountOut = _swapPoolFromBase(
                path.pool, 
                path.basePool, 
                path.basePool.getTokenIndex(path.fromToken), 
                path.pool.getTokenIndex(path.toToken), 
                amountIn, 
                0, 
                deadline
            );
        } else {
            amountOut = _swapPoolToBase(
                path.pool,
                path.basePool,
                path.pool.getTokenIndex(path.fromToken), 
                path.basePool.getTokenIndex(path.toToken), 
                amountIn, 
                0,
                deadline
            );
        }
    }

    function _swapThroughStablePool(
        address tokenIn,
        uint256 amountIn,
        Route[] calldata routes,
        uint256 deadline
    ) private returns (address tokenOut, uint256 amountOut) {
        tokenOut = tokenIn;
        amountOut = amountIn;

        for (uint256 i = 0; i < routes.length; i++) {
            if (routes[i].stable) {
               (tokenOut, amountOut) = _anyStableSwap(amountOut, routes[i], deadline);
            } else {
                address[] memory path = _decodeAmmCalldata(routes[i].callData);
                tokenOut = path[path.length - 1];
                uint256[] memory amounts = Helper.getAmountsOut(factory, amountOut, path);
                Helper.safeTransfer(
                    path[0], 
                    Helper.pairFor(factory, path[0], path[1]),
                    amounts[0]
                );
                _swap(amounts, path, address(this));
                amountOut = amounts[amounts.length - 1];
            }
        }
    }

    function swapExactTokensForTokensThroughStablePool(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountOut) {
        address tokenIn;
        if (routes[0].stable) {
            tokenIn = _decodeStableSwapCallData(routes[0].callData).fromToken;
        } else {
            tokenIn = _decodeAmmCalldata(routes[0].callData)[0];
        }

        Helper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        address tokenOut;
        (tokenOut, amountOut) = _swapThroughStablePool(tokenIn, amountIn, routes, deadline);
        require(
            amountOut >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }

    function swapExactNativeCurrencyForTokensThroughStablePool(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external override payable ensure(deadline) returns (uint256 amountOut) {
        require(!routes[0].stable, "SwapRouterV1: INVALID_ROUTES");
        address tokenIn = _decodeAmmCalldata(routes[0].callData)[0];
        require(tokenIn == WNativeCurrency, "SwapRouterV1: INVALID_ROUTES");
        IWNativeCurrency(WNativeCurrency).deposit{value: msg.value}();
        address tokenOut;
        (tokenOut, amountOut) = _swapThroughStablePool(tokenIn, msg.value, routes, deadline);
        require(
            amountOut >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }

    function swapExactTokensForNativeCurrencyThroughStablePool(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountOut) {
        require(!routes[routes.length - 1].stable, "SwapRouterV1: INVALID_ROUTES");
        address[] memory tokenOutPath = _decodeAmmCalldata(routes[routes.length - 1].callData);
        require(tokenOutPath[tokenOutPath.length - 1] == WNativeCurrency, "SwapRouterV1: INVALID_ROUTES");
        address tokenIn;
        if (routes[0].stable) {
            tokenIn = _decodeStableSwapCallData(routes[0].callData).fromToken;
        } else {
            tokenIn = _decodeAmmCalldata(routes[0].callData)[0];
        }
        Helper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        address tokenOut;
        (tokenOut, amountOut) = _swapThroughStablePool(tokenIn, amountIn, routes, deadline);
        require(
            amountOut >= amountOutMin,
            "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        IWNativeCurrency(WNativeCurrency).withdraw(amountOut);
        Helper.safeTransferNativeCurrency(to, amountOut);
    }

    function _decodeAmmCalldata(bytes memory data) private pure returns (address[] memory path) {
        path = abi.decode(data, (address[]));
    }

    function _decodeStableSwapCallData(bytes memory data) 
        private 
        pure 
        returns (StablePath memory path) 
    {
        (
            IStableSwap pool, 
            IStableSwap basePool, 
            address fromToken, 
            address toToken, 
            bool fromBase
        ) = abi.decode(data, (IStableSwap, IStableSwap, address, address, bool));

        return StablePath(pool, basePool, fromToken, toToken, fromBase);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external override pure returns (uint256 amountOut) {
        return Helper.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) external override pure returns (uint256 amountIn) {
        return Helper.getAmountOut(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        external
        override
        view
        returns (uint256[] memory amounts)
    {
        return Helper.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        external
        override
        view
        returns (uint256[] memory amounts)
    {
        return Helper.getAmountsIn(factory, amountOut, path);
    }

    function calculateSwap(
        IStableSwap pool,
        uint8 fromIndex,
        uint8 toIndex,
        uint256 inAmount
    ) external override view returns (uint256) {
        return pool.calculateSwap(fromIndex, toIndex, inAmount);
    }

    function calculateSwapFromBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external override view returns (uint256) {
        IERC20 baseToken = basePool.getLpToken();
        uint8 baseTokenIndex = pool.getTokenIndex(address(baseToken));
        uint256[] memory base_amounts = new uint256[](basePool.getNumberOfTokens());
        base_amounts[tokenIndexFrom] = dx;
        uint256 baseLpAmount = basePool.calculateTokenAmount(base_amounts, true);
        if (baseTokenIndex == tokenIndexTo) {
            return baseLpAmount;
        }
        return pool.calculateSwap(baseTokenIndex, tokenIndexTo, baseLpAmount);
    }

    function calculateSwapToBase(
        IStableSwap pool,
        IStableSwap basePool,
        uint8 tokenIndexFrom,
        uint8 tokenIndexTo,
        uint256 dx
    ) external override view returns (uint256) {
        IERC20 baseToken = basePool.getLpToken();
        uint8 baseTokenIndex = pool.getTokenIndex(address(baseToken));
        uint256 tokenLPAmount = dx;
        if (baseTokenIndex != tokenIndexFrom) {
            tokenLPAmount = pool.calculateSwap(tokenIndexFrom, baseTokenIndex, dx);
        }
        return basePool.calculateRemoveLiquidityOneToken(tokenLPAmount, tokenIndexTo);
    }
}
