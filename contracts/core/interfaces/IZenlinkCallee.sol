// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface IZenlinkCallee {
    function zenlinkCall(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
