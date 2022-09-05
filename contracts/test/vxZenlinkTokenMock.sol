// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {vxZenlinkToken, IERC20Metadata} from "../tokens/vxZenlinkToken.sol";

// mock class using ERC20
contract vxZenlinkTokenMock is vxZenlinkToken {
    constructor(
        IERC20Metadata asset,
        string memory name,
        string memory symbol
    ) vxZenlinkToken(asset, name, symbol) {}

    function mockMint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function mockBurn(address account, uint256 amount) public {
        _burn(account, amount);
    }
}
