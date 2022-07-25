// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { IPair } from '../core/interfaces/IPair.sol';
import { IFactory } from '../core/interfaces/IFactory.sol';
import { Helper } from './Helper.sol';
import { Math } from '@openzeppelin/contracts/utils/math/Math.sol';
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library LiquidityMathLibrary {
    error ZeroPairReserves();
    error InvalidLiquidityAmount();

    // computes the direction and magnitude of the profit-maximizing trade
    function computeProfitMaximizingTrade(
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 reserveA,
        uint256 reserveB
    ) pure internal returns (bool aToB, uint256 amountIn) {
        aToB = Math.mulDiv(reserveA, truePriceTokenB, reserveB) < truePriceTokenA;

        uint256 invariant = reserveA * reserveB;

        uint256 leftSide = Math.sqrt(
            Math.mulDiv(
                invariant * 1000,
                aToB ? truePriceTokenA : truePriceTokenB,
                (aToB ? truePriceTokenB : truePriceTokenA) * 997
            )
        );
        uint256 rightSide = (aToB ? reserveA * 1000 : reserveB * 1000) / 997;

        if (leftSide < rightSide) return (false, 0);

        // compute the amount that must be sent to move the price to the profit-maximizing price
        amountIn = leftSide - rightSide;
    }

    // gets the reserves after an arbitrage moves the price to the profit-maximizing ratio given an externally observed true price
    function getReservesAfterArbitrage(
        address factory,
        address tokenA,
        address tokenB,
        uint256 truePriceTokenA,
        uint256 truePriceTokenB
    ) view internal returns (uint256 reserveA, uint256 reserveB) {
        // first get reserves before the swap
        (reserveA, reserveB) = Helper.getReserves(factory, tokenA, tokenB);

        if (reserveA == 0 || reserveB == 0) revert ZeroPairReserves();

        // then compute how much to swap to arb to the true price
        (bool aToB, uint256 amountIn) = computeProfitMaximizingTrade(truePriceTokenA, truePriceTokenB, reserveA, reserveB);

        if (amountIn == 0) {
            return (reserveA, reserveB);
        }

        // now affect the trade to the reserves
        if (aToB) {
            uint256 amountOut = Helper.getAmountOut(amountIn, reserveA, reserveB);
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            uint256 amountOut = Helper.getAmountOut(amountIn, reserveB, reserveA);
            reserveB += amountIn;
            reserveA -= amountOut;
        }
    }

    // computes liquidity value given all the parameters of the pair
    function computeLiquidityValue(
        uint256 reservesA,
        uint256 reservesB,
        uint256 totalSupply,
        uint256 liquidityAmount,
        uint8 feeBasePoint,
        uint256 kLast
    ) internal pure returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        if (feeBasePoint > 0 && kLast > 0) {
            uint256 rootK = Math.sqrt(reservesA * reservesB);
            uint256 rootKLast = Math.sqrt(kLast);
            if (rootK > rootKLast) {
                uint256 numerator1 = totalSupply;
                uint256 numerator2 = rootK - rootKLast;
                uint256 denominator = (rootK * (30 - feeBasePoint)) / feeBasePoint + rootKLast;
                uint256 feeLiquidity = Math.mulDiv(numerator1, numerator2, denominator);
                totalSupply = totalSupply + feeLiquidity;
            }
        }
        return (reservesA * liquidityAmount / totalSupply, reservesB * liquidityAmount / totalSupply);
    }

    // get all current parameters from the pair and compute value of a liquidity amount
    // **note this is subject to manipulation, e.g. sandwich attacks**. prefer passing a manipulation resistant price to
    // #getLiquidityValueAfterArbitrageToPrice
    function getLiquidityValue(
        address factory,
        address tokenA,
        address tokenB,
        uint256 liquidityAmount
    ) internal view returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        (uint256 reservesA, uint256 reservesB) = Helper.getReserves(factory, tokenA, tokenB);
        IPair pair = IPair(Helper.pairFor(factory, tokenA, tokenB));
        uint8 feeBasePoint = IFactory(factory).feeBasePoint();
        uint256 kLast = feeBasePoint > 0 ? pair.kLast() : 0;
        uint256 totalSupply = IERC20(address(pair)).totalSupply();
        return computeLiquidityValue(reservesA, reservesB, totalSupply, liquidityAmount, feeBasePoint, kLast);
    }

    // given two tokens, tokenA and tokenB, and their "true price", i.e. the observed ratio of value of token A to token B,
    // and a liquidity amount, returns the value of the liquidity in terms of tokenA and tokenB
    function getLiquidityValueAfterArbitrageToPrice(
        address factory,
        address tokenA,
        address tokenB,
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 liquidityAmount
    ) internal view returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        uint8 feeBasePoint = IFactory(factory).feeBasePoint();
        IPair pair = IPair(Helper.pairFor(factory, tokenA, tokenB));
        uint256 kLast = feeBasePoint > 0 ? pair.kLast() : 0;
        uint256 totalSupply = IERC20(address(pair)).totalSupply();

        // this also checks that totalSupply > 0
        if (totalSupply < liquidityAmount || liquidityAmount == 0) revert InvalidLiquidityAmount();

        (uint256 reservesA, uint256 reservesB) = getReservesAfterArbitrage(factory, tokenA, tokenB, truePriceTokenA, truePriceTokenB);

        return computeLiquidityValue(reservesA, reservesB, totalSupply, liquidityAmount, feeBasePoint, kLast);
    }
}
