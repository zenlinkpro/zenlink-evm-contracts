// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../libraries/Helper.sol";
import "../libraries/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../libraries/AdminUpgradeable.sol";

contract Stake is Pausable, ReentrancyGuard, AdminUpgradeable {
    using Math for uint256;

    struct StakeData {
        uint256 stake_amount;
        uint256 block_number;
        uint256 interest;
    }

    address public immutable STAKED_TOKEN;
    address public immutable REWARD_TOKEN;
    uint256 public immutable START_BLOCK;
    uint256 public immutable END_BLOCK;
    uint256 private _total_interest;
    uint256 private _total_reward;

    mapping(address => StakeData) private StakeDatas;

    constructor(
        address stake_token,
        address reward_token,
        uint256 start_block,
        uint256 end_block
    ) {
        require (start_block >= block.number, 'startBlock less than blockNumber');
        require (end_block > start_block, 'startBlock less than or equal to endBlock');

        _initializeAdmin(msg.sender);
        STAKED_TOKEN = stake_token;
        REWARD_TOKEN = reward_token;
        START_BLOCK = start_block;
        END_BLOCK = end_block;
        _total_reward = IERC20(reward_token).balanceOf(address(this));
    }

    function syncReward() public {
        require(block.number < END_BLOCK, "over stake period");
        _total_reward = IERC20(REWARD_TOKEN).balanceOf(address(this));
    }

    function stake(uint256 amount) public returns (uint256 added_interest) {
        require(block.number < END_BLOCK, "over stake period");
        require(amount > 0, "cannot stake 0 amount");

        Helper.safeTransferFrom(
            STAKED_TOKEN,
            msg.sender,
            address(this),
            amount
        );

        StakeData memory data = StakeDatas[msg.sender];

        data.block_number = data.block_number < START_BLOCK
            ? START_BLOCK
            : block.number;

        added_interest = amount.mul(END_BLOCK - data.block_number);

        _total_interest = _total_interest.add(added_interest);

        data.stake_amount = data.stake_amount.add(amount);
        data.interest = data.interest.add(added_interest);
        StakeDatas[msg.sender] = data;
    }

    function redeem(uint256 amount) public returns (uint256 removed_interest) {
        require(amount > 0, "cannot redeem 0 amount");
        require(block.number > START_BLOCK, "stake not start");

        StakeData memory data = StakeDatas[msg.sender];
        require(data.stake_amount <= amount, "insufficent stake amount");

        data.block_number = block.number < END_BLOCK ? block.number : END_BLOCK;

        removed_interest = amount.mul(END_BLOCK - data.block_number);

        _total_interest = _total_interest.sub(removed_interest);

        data.stake_amount = data.stake_amount.sub(amount);
        data.interest = data.interest.sub(removed_interest);
        StakeDatas[msg.sender] = data;

        Helper.safeTransfer(STAKED_TOKEN, msg.sender, amount);
    }

    function claim() public returns (uint256 claim_reward_amount) {
        require(block.number > END_BLOCK, "in stake period");

        StakeData memory data = StakeDatas[msg.sender];
        require(data.interest > 0, "no interest");

        claim_reward_amount =
            _total_reward.mul(data.interest) /
            _total_interest;

        data.interest = 0;
        data.block_number = block.number;
        StakeDatas[msg.sender] = data;
        Helper.safeTransfer(REWARD_TOKEN, msg.sender, claim_reward_amount);
    }
}
