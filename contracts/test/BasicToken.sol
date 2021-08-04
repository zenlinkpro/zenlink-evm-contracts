// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Example class - a mock class using delivering from ERC20
contract BasicToken is ERC20 {
    constructor(
        string memory setName,
        string memory setSymbol,
        uint256 initialBalance
    ) ERC20(setName, setSymbol) {
        _mint(msg.sender, initialBalance);
    }
}
