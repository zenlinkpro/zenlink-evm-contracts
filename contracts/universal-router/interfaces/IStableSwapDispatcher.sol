// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IStableSwapDispatcher {
    function swap(address pool, address tokenIn, address tokenOut, address to) external;
}
