// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {AdminUpgradeable} from "./AdminUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract CirculationHelper is AdminUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;

    address immutable vxZenlinkToken;
    address immutable zenlinkToken;
    uint256 public minPenaltyRatio;
    uint256 public maxPenaltyRatio;

    EnumerableSet.AddressSet private _lockedContracts;

    error ZeroAddress();
    error CannotExceedMaxPenaltyRatio(uint256 maxPenaltyRatio);
    error InvalidPenaltyRatio(uint256 min, uint256 max);

    constructor(
        address _vxZenlinkToken, 
        address _zenlinkToken,
        uint256 _minPenaltyRatio,
        uint256 _maxPenaltyRatio
    ) {
        vxZenlinkToken = _vxZenlinkToken;
        zenlinkToken = _zenlinkToken;
        _updatePenaltyRatio(_minPenaltyRatio, _maxPenaltyRatio);
        _initializeAdmin(msg.sender);
    }

    function updatePenaltyRatio(
        uint256 _minPenaltyRatio, 
        uint256 _maxPenaltyRatio
    ) external onlyAdmin {
        _updatePenaltyRatio(_minPenaltyRatio, _maxPenaltyRatio);
    }

    function _updatePenaltyRatio(
        uint256 _minPenaltyRatio, 
        uint256 _maxPenaltyRatio
    ) private {
        if (_maxPenaltyRatio > 50e16) 
            revert CannotExceedMaxPenaltyRatio(50e16);
        if (_minPenaltyRatio >= _maxPenaltyRatio) 
            revert InvalidPenaltyRatio(_minPenaltyRatio, _maxPenaltyRatio);
        minPenaltyRatio = _minPenaltyRatio;
        maxPenaltyRatio = _maxPenaltyRatio;
    }

    function lockedContracts() external view returns (address[] memory) {
        return _lockedContracts.values();
    }

    function addLockedContract(address lockedContract) external onlyAdmin {
        if (lockedContract == address(0)) revert ZeroAddress();
        if (!_lockedContracts.contains(lockedContract)) {
            _lockedContracts.add(lockedContract);
        }
    }

    function removeLockedContract(address lockedContract) external onlyAdmin {
        if (lockedContract == address(0)) revert ZeroAddress();
        if (_lockedContracts.contains(lockedContract)) {
            _lockedContracts.remove(lockedContract);
        }
    }

    function getCirculation() public view returns (uint256 circulation) {
        circulation = IERC20(zenlinkToken).totalSupply();
        address[] memory contracts = _lockedContracts.values();
        for (uint256 i = 0; i < contracts.length; i++) {
            circulation -= IERC20(zenlinkToken).balanceOf(contracts[i]);
        }
    }

    function getZenlinkTokenWithdrawFeeRatio() external view returns (uint256 ratio) {
        uint256 zenlinkCirculation = getCirculation();
        uint256 x = Math.mulDiv(
            IERC20(zenlinkToken).balanceOf(vxZenlinkToken),
            1e18,
            zenlinkCirculation
        );
        ratio = getRatioValue(x);
    }

    function getRatioValue(uint256 input) public view returns (uint256) {
        // y = maxPenaltyRatio (x < 0.1)
        // y = minPenaltyRatio (x > 0.5)
        // y = maxPenaltyRatio - (input - 0.1) * step
        if (input < 1e17) {
            return maxPenaltyRatio;
        } else if (input > 5e17) {
            return minPenaltyRatio;
        } else {
            uint256 step = Math.mulDiv(
                maxPenaltyRatio - minPenaltyRatio,
                1e18,
                4e17
            );
            return maxPenaltyRatio - Math.mulDiv(input - 1e17, step, 1e18);
        }
    }
}
