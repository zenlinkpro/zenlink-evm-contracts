pragma solidity ^0.6.0;

import "../interfaces/INativeCurrency.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Example class
contract NativeCurrency is INativeCurrency, ERC20 {
    constructor(string memory setName, string memory setSymbol)
        public
        ERC20(setName, setSymbol)
    {}

    function deposit() public payable override {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public override {
        require(balanceOf(msg.sender) >= wad, "");
        _burn(msg.sender, wad);
        msg.sender.transfer(wad);
    }

    function totalSupply() public view override returns (uint256) {
        return address(this).balance;
    }
}
