pragma solidity ^0.6.0;

interface INativeCurrency {
    function deposit() external payable;

    function withdraw(uint256) external;
}
