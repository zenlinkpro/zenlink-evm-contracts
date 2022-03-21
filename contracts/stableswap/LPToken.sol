// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IStableSwap.sol";

contract LPToken is Ownable, ERC20Burnable {
    IStableSwap public swap;

    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
        swap = IStableSwap(msg.sender);
    }

    function mint(address _to, uint256 _amount) external onlyOwner {
        require(_amount > 0, "zeroMintAmount");
        _mint(_to, _amount);
    }
}
