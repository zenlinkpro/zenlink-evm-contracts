// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface IWNativeCurrency {
    function deposit() external payable;

    function withdraw(uint256) external;
}
