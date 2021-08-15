// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../libraries/Helper.sol";
import "../libraries/Math.sol";
import "../libraries/AdminUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Stake is Pausable, ReentrancyGuard, AdminUpgradeable {
    using Math for uint256;

    // Info of each staker
    struct StakerInfo {
        uint256 stakedAmount;      // How many stake tokens the user has provided
        uint256 lastUpdatedBlock;  // Last block number that user behavior occurs
        uint256 accInterest;       // Accumulated interest the user has owned
        bool inBlackList;          // Is staker in blackList
    }

    // The STAKED TOKEN
    address public immutable STAKED_TOKEN;
    // The REWARD TOKEN
    address public immutable REWARD_TOKEN;
    // The block when stake starts
    uint256 public immutable START_BLOCK;
    // The block when stake ends
    uint256 public immutable END_BLOCK;
    // The total interest of whole stake
    uint256 public totalInterest;
    // The total reward amount of whole stake
    uint256 public totalRewardAmount;

    // Info of each staker that stakes token
    mapping(address => StakerInfo) private _stakerInfos;

    event Staked(address indexed user, uint256 amount, uint256 interest);
    event Redeem(address indexed user, uint256 redeemAmount, uint256 interest);
    event RewardsClaimed(address indexed to, uint256 amount);

    constructor(
        address _stakeToken,
        address _rewardToken,
        uint256 _startBlock,
        uint256 _endBlock
    ) {
        require(_startBlock >= block.number, 'INVALID_START_BLOCK');
        require(_endBlock > _startBlock, 'INVALID_STAKE_PERIOD');

        _initializeAdmin(msg.sender);
        STAKED_TOKEN = _stakeToken;
        REWARD_TOKEN = _rewardToken;
        START_BLOCK = _startBlock;
        END_BLOCK = _endBlock;
        totalRewardAmount = IERC20(_rewardToken).balanceOf(address(this));
    }

    modifier inStakePeriod() {
        require(block.number < END_BLOCK, "OVER_PERIOD");
        _;
    }

    /**
     * @dev Updates total reward amount by admin
     **/
    function syncReward() public onlyAdmin inStakePeriod {
        totalRewardAmount = IERC20(REWARD_TOKEN).balanceOf(address(this));
    }

    function setBlackList(address blacklistAddress) public onlyAdmin {
        _stakerInfos[blacklistAddress].inBlackList = true;
    }

    function removeBlackList(address blacklistAddress) public onlyAdmin {
        _stakerInfos[blacklistAddress].inBlackList = false;
    }
    
    function getStakerInfo(address staker) 
        external 
        view 
        returns (uint256 stakedAmount, uint256 accInterest)  
    {
        StakerInfo memory stakerInfo = _stakerInfos[staker];
        stakedAmount = stakerInfo.stakedAmount;
        accInterest = stakerInfo.accInterest;
    }
    
    function pause() external onlyAdmin whenNotPaused {
        _pause();
    }

    function unpause() external onlyAdmin whenPaused {
        _unpause();
    }

    /**
     * @dev Stakes tokens
     * @param amount Amount to stake
     **/
    function stake(uint256 amount) public inStakePeriod nonReentrant whenNotPaused {
        require(amount > 0, 'INVALID_ZERO_AMOUNT');
        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];
        require(!stakerInfo.inBlackList, 'IN_BLACK_LIST');

        Helper.safeTransferFrom(
            STAKED_TOKEN,
            msg.sender,
            address(this),
            amount
        );

        stakerInfo.lastUpdatedBlock = stakerInfo.lastUpdatedBlock < START_BLOCK
            ? START_BLOCK
            : block.number;

        uint256 addedInterest = amount.mul(END_BLOCK.sub(stakerInfo.lastUpdatedBlock));

        totalInterest = totalInterest.add(addedInterest);

        stakerInfo.stakedAmount = stakerInfo.stakedAmount.add(amount);
        stakerInfo.accInterest = stakerInfo.accInterest.add(addedInterest);
        
        emit Staked(msg.sender, amount, addedInterest);
    }

    /**
     * @dev Redeems staked tokens
     * @param amount Amount to redeem
     **/
    function redeem(uint256 amount) public nonReentrant {
        require(amount > 0, 'INVALID_ZERO_AMOUNT');
        require(block.number > START_BLOCK, "STAKE_NOT_STARTED");

        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];
        require(!stakerInfo.inBlackList, 'IN_BLACK_LIST');
        require(stakerInfo.stakedAmount <= amount, "INSUFFICIENT_STAKED_AMOUNT");

        stakerInfo.lastUpdatedBlock = block.number < END_BLOCK ? block.number : END_BLOCK;

        uint256 removedInterest = amount.mul(END_BLOCK.sub(stakerInfo.lastUpdatedBlock));

        totalInterest = totalInterest.sub(removedInterest);

        stakerInfo.stakedAmount = stakerInfo.stakedAmount.sub(amount);
        stakerInfo.accInterest = stakerInfo.accInterest.sub(removedInterest);

        Helper.safeTransfer(STAKED_TOKEN, msg.sender, amount);
        emit Redeem(msg.sender, amount, removedInterest);
    }

    /**
     * @dev Return the total amount of estimated rewards from an staker
     * @param staker The staker address
     * @return The rewards
     */
    function getEstimatedRewardsBalance(address staker) external view returns (uint256) {
        StakerInfo memory stakerInfo = _stakerInfos[staker];
        if (totalInterest != 0) {
            return totalRewardAmount.mul(stakerInfo.accInterest) / totalInterest;
        }
        return 0;
    }

    /**
     * @dev Claims all amount of `REWARD_TOKEN` calculated from staker interest
     **/
    function claim() public nonReentrant {
        require(block.number > END_BLOCK, "STAKE_NOT_FINISHED");
        require(totalInterest > 0, 'INVALID_ZERO_TOTAL_INTEREST');

        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];
        require(!stakerInfo.inBlackList, 'IN_BLACK_LIST');
        require(stakerInfo.accInterest > 0, "INSUFFICIENT_ACCUMULATED_INTEREST");

        uint256 claimRewardAmount = totalRewardAmount.mul(stakerInfo.accInterest) / totalInterest;

        stakerInfo.accInterest = 0;
        stakerInfo.lastUpdatedBlock = block.number;

        Helper.safeTransfer(REWARD_TOKEN, msg.sender, claimRewardAmount);
        emit RewardsClaimed(msg.sender, claimRewardAmount);
    }
}
