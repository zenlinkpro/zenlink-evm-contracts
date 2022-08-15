// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { 
    ERC4626, 
    IERC20Metadata,
    ERC20,
    Math
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { AdminUpgradeable } from "../libraries/AdminUpgradeable.sol";
import { ICirculationHelper } from "../libraries/interfaces/ICirculationHelper.sol";

contract vxZenlinkToken is ERC4626, AdminUpgradeable {
    address public circulationHelper;

    event WithdrawVXZLK(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 fee,
        uint256 shares
    );

    constructor(
        IERC20Metadata _zlk,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) ERC4626(_zlk) {
        _initializeAdmin(msg.sender);
    }

    function updateCirculationHelper(address helper) external onlyAdmin {
        circulationHelper = helper;
    }

    function getZenlinkTokenWithdrawFeeRatio() public view returns (uint256) {
        return ICirculationHelper(circulationHelper).getZenlinkTokenWithdrawFeeRatio();
    }

    function getWithdrawResult(uint256 assets) 
        public 
        view 
        returns (uint256 zlkReceive, uint256 withdrawFeeAmount) 
    {
        uint256 feeRatio = getZenlinkTokenWithdrawFeeRatio();
        withdrawFeeAmount = Math.mulDiv(assets, feeRatio, 10**18);
        zlkReceive = assets - withdrawFeeAmount;
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

        uint256 shares = previewWithdraw(assets);
        (uint256 zlkReceive, uint256 withdrawFeeAmount) = getWithdrawResult(assets);
        _withdraw(_msgSender(), receiver, owner, zlkReceive, shares);

        emit WithdrawVXZLK(_msgSender(), receiver, owner, zlkReceive, withdrawFeeAmount, shares);
        return shares;
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");

        uint256 assets = previewRedeem(shares);
        (uint256 zlkReceive, uint256 withdrawFeeAmount) = getWithdrawResult(assets);
        _withdraw(_msgSender(), receiver, owner, zlkReceive, shares);

        emit WithdrawVXZLK(_msgSender(), receiver, owner, zlkReceive, withdrawFeeAmount, shares);
        return assets;
    }
}
