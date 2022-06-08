// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import '../core/ZenlinkERC20.sol';

contract MockZenlinkERC20 is ZenlinkERC20 {
    constructor(uint256 _totalSupply) {
        _mint(msg.sender, _totalSupply);
    }
}
