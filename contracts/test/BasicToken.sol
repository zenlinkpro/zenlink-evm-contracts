// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Example class - a mock class using delivering from ERC20
contract BasicToken is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory setName,
        string memory setSymbol,
        uint8 setDecimals,
        uint256 initialBalance
    ) ERC20(setName, setSymbol) {
        _decimals = setDecimals;
        _mint(msg.sender, initialBalance);
    }

    // sets the balance of the address
    // this mints/burns the amount depending on the current balance
    function setBalance(address to, uint256 amount) public {
        uint256 old = balanceOf(to);
        if (old < amount) {
            _mint(to, amount - old);
        } else if (old > amount) {
            _burn(to, old - amount);
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
