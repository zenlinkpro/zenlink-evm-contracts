// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {AdminUpgradeable} from "../libraries/AdminUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RewardDispatcher is AdminUpgradeable {
    using SafeERC20 for IERC20;

    // the token to dispatch
    IERC20 public immutable token;
    // the dest address that the token will send to
    address public immutable dest;
    uint256 public rewardRate;
    uint256 public lastRecordBlock;

    event Charged(address indexed sender, address indexed token, uint256 amount);
    event WithdrawReward(address indexed sender, address indexed token, uint256 amount);
    event DispatchReward(address indexed dest, address indexed token, uint256 amount);
    event UpdateRate(uint256 rate);

    constructor(IERC20 _token, address _dest) {
        token = _token;
        dest = _dest;
        _initializeAdmin(msg.sender);
    }

    function dispatchReward() public {
        uint256 amount = (block.number - lastRecordBlock) * rewardRate;
        lastRecordBlock = block.number;
        token.safeTransfer(dest, amount);

        emit DispatchReward(msg.sender, address(token), amount);
    }

    function updateRate(uint256 rate) external onlyAdmin {
        dispatchReward();
        rewardRate = rate;
        emit UpdateRate(rate);
    }

    function withdrawRewards(uint256 amount) external onlyAdmin {
        token.safeTransfer(msg.sender, amount);
        emit WithdrawReward(msg.sender, address(token), amount);
    }
}
