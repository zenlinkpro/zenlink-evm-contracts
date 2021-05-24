pragma solidity ^0.6.0;

import "./interfaces/IRouter.sol";
import "./interfaces/IPair.sol";
import "./interfaces/IFactory.sol";
import "./libraries/zenlinkHelper.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Router is IRouter {
    address public override factory;

    constructor(address _factory) public {
        factory = _factory;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");
        _;
    }

    function addLiquidity(
        address token0,
        address token1,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    )
        external
        override
        ensure(deadline)
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 liquidity
        )
    {
        (amount0, amount1) = _addLiquidity(
            token0,
            token1,
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min
        );
        address pair = ZenlinkHelper.pairFor(factory, token0, token1);
        ZenlinkHelper.safeTransferFrom(token0, msg.sender, pair, amount0);
        ZenlinkHelper.safeTransferFrom(token1, msg.sender, pair, amount1);
        liquidity = IPair(pair).mint(to);
    }

    function _addLiquidity(
        address token0,
        address token1,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) private returns (uint256 amount0, uint256 amount1) {
        if (IFactory(factory).getPair(token0, token1) == address(0)) {
            IFactory(factory).createPair(token0, token1);
        }
        (uint256 reserve0, uint256 reserve1) =
            ZenlinkHelper.getReserves(factory, token0, token1);
        if (reserve0 == 0 && reserve1 == 0) {
            (amount0, amount1) = (amount0Desired, amount1Desired);
        } else {
            uint256 amount1Optimal =
                ZenlinkHelper.quote(amount0Desired, reserve0, reserve1);
            if (amount1Optimal <= amount1Desired) {
                require(
                    amount1Optimal >= amount1Min,
                    "Router: INSUFFICIENT_1_AMOUNT"
                );
                (amount0, amount1) = (amount0Desired, amount1Optimal);
            } else {
                uint256 amount0Optimal =
                    ZenlinkHelper.quote(amount1Desired, reserve1, reserve0);
                assert(amount0Optimal <= amount0Desired);
                require(
                    amount0Optimal >= amount0Min,
                    "Router: INSUFFICIENT_0_AMOUNT"
                );
                (amount0, amount1) = (amount0Optimal, amount1Desired);
            }
        }
    }

    function removeLiquidity(
        address token0,
        address token1,
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    )
        public
        override
        ensure(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        address pair = ZenlinkHelper.pairFor(factory, token0, token1);
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        (uint256 amountA, uint256 amountB) = IPair(pair).burn(to);
        (address tokenA, ) = ZenlinkHelper.sortTokens(token0, token1);
        (amount0, amount1) = tokenA == token0
            ? (amountA, amountB)
            : (amountB, amountA);
        require(amount0 >= amount0Min, "Router: INSUFFICIENT_0_AMOUNT");
        require(amount1 >= amount1Min, "Router: INSUFFICIENT_1_AMOUNT");
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = ZenlinkHelper.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0
                    ? (uint256(0), amountOut)
                    : (amountOut, uint256(0));
            address to =
                i < path.length - 2
                    ? ZenlinkHelper.pairFor(factory, output, path[i + 2])
                    : _to;
            IPair(ZenlinkHelper.pairFor(factory, input, output)).swap(
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
        amounts = ZenlinkHelper.getAmountsOut(factory, amountIn, path);
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        ZenlinkHelper.safeTransferFrom(
            path[0],
            msg.sender,
            ZenlinkHelper.pairFor(factory, path[0], path[1]),
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
        amounts = ZenlinkHelper.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, "Router: EXCESSIVE_INPUT_AMOUNT");
        ZenlinkHelper.safeTransferFrom(
            path[0],
            msg.sender,
            ZenlinkHelper.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, to);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure override returns (uint256 amountOut) {
        return ZenlinkHelper.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure override returns (uint256 amountIn) {
        return ZenlinkHelper.getAmountOut(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        return ZenlinkHelper.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        return ZenlinkHelper.getAmountsIn(factory, amountOut, path);
    }
}
