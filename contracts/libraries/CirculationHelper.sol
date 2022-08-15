// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { AdminUpgradeable } from "./AdminUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract CirculationHelper is AdminUpgradeable {
    address immutable vxZenlinkToken;
    address immutable zenlinkToken;
    address[] lockedContracts;

    uint256 public immutable MIN_PENALTY_RATIO = 5 * 10**16; // 5%
    uint256 public immutable MAX_PENALTY_RATIO = 15 * 10**16; // 15%

    error ZeroAddress();

    constructor(address _vxZenlinkToken, address _zenlinkToken) {
        vxZenlinkToken = _vxZenlinkToken;
        zenlinkToken = _zenlinkToken;
        _initializeAdmin(msg.sender);
    }

    function addLockedContract(address lockedContract) external onlyAdmin {
        if (lockedContract == address(0)) revert ZeroAddress();
        lockedContracts.push(lockedContract);
    }

    function removeLockedContract(address lockedContract) external onlyAdmin {
        if (lockedContract == address(0)) revert ZeroAddress();
        address[] memory _lockedContracts = lockedContracts;
        uint256 len = _lockedContracts.length;
        
        for (uint256 i = 0; i < len; i++) {
            if (_lockedContracts[i] == lockedContract) {
                _lockedContracts[i] = _lockedContracts[len - 1];
                break;
            }
        }

        lockedContracts = _lockedContracts;
        lockedContracts.pop();
    }

    function getCirculation() public view returns (uint256 circulation) {
        circulation = IERC20(zenlinkToken).totalSupply();
        for (uint256 i = 0; i < lockedContracts.length; i++) {
            circulation -= IERC20(zenlinkToken).balanceOf(lockedContracts[i]);
        }
    }

    function getZenlinkTokenWithdrawFeeRatio() external view returns (uint256 ratio) {
        uint256 zenlinkCirculation = getCirculation();
        uint256 x = Math.mulDiv(
            IERC20(zenlinkToken).balanceOf(vxZenlinkToken),
            10**18,
            zenlinkCirculation
        );
        ratio = getRatioValue(x);
    }

    function getRatioValue(uint256 input) public pure returns (uint256) {
        // y = 15% (x < 0.1)
        // y = 5% (x > 0.5)
        // y = 0.175 - 0.25 * x
        if (input < 10**17) {
            return MAX_PENALTY_RATIO;
        } else if (input > 5 * 10**17) {
            return MIN_PENALTY_RATIO;
        } else {
            return 175 * 10**15 - Math.mulDiv(input, 25 * 10**16, 10**18);
        }
    }
}
