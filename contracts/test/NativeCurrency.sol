// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../periphery/interfaces/IWNativeCurrency.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Example class
contract NativeCurrency is IWNativeCurrency, ERC20 {
    constructor(string memory setName, string memory setSymbol)
        ERC20(setName, setSymbol)
    {}

    function deposit() public payable override {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public override {
        require(balanceOf(msg.sender) >= wad, "");
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
    }

    function totalSupply() public view override returns (uint256) {
        return address(this).balance;
    }
}
