// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../libraries/AdminUpgradeable.sol";
import "../libraries/Math.sol";

contract ZenlinkToken is ERC20, AdminUpgradeable {
    using Math for uint256;
    // global transfer switch
    bool public transferable;

    uint8 private decimal;

    uint256 private maxTotalSupply;

    // address map that can be transferred at any time.
    mapping(address => bool) public whitelistMap;

    modifier canTransfer() {
        require(
            transferable == true || whitelistMap[msg.sender] == true,
            "can't transfer"
        );
        _;
    }

    constructor(
        string memory setSymbol,
        string memory setName,
        uint8 setDecimal,
        uint256 initialBalance,
        uint256 maxMint
    ) ERC20(setName, setSymbol) {
        require(maxMint >= initialBalance, "initialBalance bigger than max");
        _initializeAdmin(msg.sender);
        _mint(msg.sender, initialBalance);
        whitelistMap[msg.sender] = true;
        decimal = setDecimal;
        maxTotalSupply = maxMint;
    }

    function decimals() public view virtual override returns (uint8) {
        return decimal;
    }

    function addWhitelist(address user) external onlyAdmin {
        whitelistMap[user] = true;
    }

    function removeWhitelist(address user) external onlyAdmin {
        delete whitelistMap[user];
    }

    function enableTransfer() external onlyAdmin {
        transferable = true;
    }

    function disableTransfer() external onlyAdmin {
        transferable = false;
    }

    function mint(uint256 mintAmount) external onlyAdmin {
        require(totalSupply().add(mintAmount) <= maxTotalSupply, "can't mint");
        _mint(msg.sender, mintAmount);
    }

    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        canTransfer
        returns (bool)
    {
        return ERC20.transfer(recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override canTransfer returns (bool) {
        return ERC20.transferFrom(sender, recipient, amount);
    }
}
