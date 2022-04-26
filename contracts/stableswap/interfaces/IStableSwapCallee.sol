// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IStableSwapCallee {
    function zenlinkStableSwapCall(
        address sender, 
        uint256[] memory amounts, 
        uint256[] memory fees, 
        bytes calldata data
    ) external;
}
