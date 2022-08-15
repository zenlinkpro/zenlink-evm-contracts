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

    function previewRedeem(uint256 shares) public view virtual override returns (uint256) {
        uint256 assets = _convertToAssets(shares, Math.Rounding.Down);
        uint256 feeRatio = getZenlinkTokenWithdrawFeeRatio();
        uint256 withdrawFeeAmount = Math.mulDiv(assets, feeRatio, 10**18);
        return assets - withdrawFeeAmount;
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

        uint256 shares = previewWithdraw(assets);
        uint256 feeRatio = getZenlinkTokenWithdrawFeeRatio();
        uint256 withdrawFeeAmount = Math.mulDiv(assets, feeRatio, 10**18);
        _withdraw(_msgSender(), receiver, owner, assets - withdrawFeeAmount, shares);

        return shares;
    }
}
