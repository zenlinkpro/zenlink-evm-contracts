// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../libraries/Helper.sol";
import "../libraries/Math.sol";
import "../libraries/AdminUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Stake is ReentrancyGuard, AdminUpgradeable {
    using Math for uint256;

    // Info of each staker
    struct StakerInfo {
        uint256 stakedAmount;      // How many stake tokens the user has provided
        uint256 lastUpdatedBlock;  // Last block number that user behavior occurs
        uint256 accInterest;       // Accumulated interest the user has owned
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
    // The total staked amount of whole stake
    uint256 public totalStakedAmount;
    // The total reward amount of whole stake
    uint256 public totalRewardAmount;

    // Is stake paused
    bool private _stakePaused;
    // Is redeem paused
    bool private _redeemPaused;
    // Is claim paused
    bool private _claimPaused;

    // Info of each staker that stakes token
    mapping(address => StakerInfo) private _stakerInfos;

    event Staked(address indexed user, uint256 amount, uint256 interest);
    event Redeem(address indexed user, uint256 redeemAmount, uint256 interest);
    event RewardsClaimed(address indexed to, uint256 amount);
    event Withdraw(address indexed token, address indexed to, uint256 amount);
    event StakePaused(address indexed caller);
    event StakeUnpaused(address indexed caller);
    event RedeemPaused(address indexed caller);
    event RedeemUnpaused(address indexed caller);
    event ClaimPaused(address indexed caller);
    event ClaimUnpaused(address indexed caller);

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
        
        _stakePaused = false;
        _redeemPaused = false;
        _claimPaused = false;
    }

    modifier beforeEndPeriod() {
        require(block.number < END_BLOCK, "OVER_PERIOD");
        _;
    }

    modifier whenStakeNotPaused() {
        require(!_stakePaused, "STAKE_PAUSED");
        _;
    }

    modifier whenRedeemNotPaused() {
        require(!_redeemPaused, "REDEEM_PAUSED");
        _;
    }

    modifier whenClaimNotPaused() {
        require(!_claimPaused, "CLAIM_PAUSED");
        _;
    }

    /**
     * @dev add reward amount by admin
     **/
    function addReward(uint256 amount) external onlyAdmin beforeEndPeriod {
        Helper.safeTransferFrom(
            REWARD_TOKEN,
            msg.sender,
            address(this),
            amount
        );
        totalRewardAmount = totalRewardAmount.add(amount);
    }

    /**
     * @dev remove reward amount by admin
     **/
    function removeReward(uint256 amount) external onlyAdmin beforeEndPeriod {
        require(amount <= totalRewardAmount, 'INSUFFICIENT_REWARD_AMOUNT');
        Helper.safeTransfer(REWARD_TOKEN, msg.sender, amount);
        totalRewardAmount = totalRewardAmount.sub(amount);
    }

    /**
     * @dev withdraw by admin
     **/
    function withdraw(address token, address to, uint256 amount) external onlyAdmin {
        if (token == REWARD_TOKEN) {
            uint256 rewardBalance = IERC20(REWARD_TOKEN).balanceOf(address(this));
            require(rewardBalance.sub(amount) >= totalRewardAmount, 'INSUFFICIENT_REWARD_BALANCE');
        }
        Helper.safeTransfer(token, to, amount);

        emit Withdraw(token, to, amount);
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
    
    function pauseStake() external onlyAdmin {
        require(!_stakePaused, 'STAKE_PAUSED');
        _stakePaused = true;
        emit StakePaused(msg.sender);
    }

    function unpauseStake() external onlyAdmin {
        require(_stakePaused, 'STAKE_UNPAUSED');
        _stakePaused = false;
        emit StakeUnpaused(msg.sender);
    }

    function pauseRedeem() external onlyAdmin {
        require(!_redeemPaused, 'REDEEM_PAUSED');
        _redeemPaused = true;
        emit RedeemPaused(msg.sender);
    }

    function unpauseRedeem() external onlyAdmin {
        require(_redeemPaused, 'REDEEM_UNPAUSED');
        _redeemPaused = false;
        emit RedeemUnpaused(msg.sender);
    }
    
    function pauseClaim() external onlyAdmin {
        require(!_claimPaused, 'CLAIM_PAUSED');
        _claimPaused = true;
        emit ClaimPaused(msg.sender);
    }

    function unpauseClaim() external onlyAdmin {
        require(_claimPaused, 'CLAIM_UNPAUSED');
        _claimPaused = false;
        emit ClaimUnpaused(msg.sender);
    }

    /**
     * @dev Stakes tokens
     * @param amount Amount to stake
     **/
    function stake(uint256 amount) external beforeEndPeriod nonReentrant whenStakeNotPaused {
        require(amount > 0, 'INVALID_ZERO_AMOUNT');
        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];

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
        totalStakedAmount = totalStakedAmount.add(amount);

        stakerInfo.stakedAmount = stakerInfo.stakedAmount.add(amount);
        stakerInfo.accInterest = stakerInfo.accInterest.add(addedInterest);
        
        emit Staked(msg.sender, amount, addedInterest);
    }

    /**
     * @dev Redeems staked tokens
     * @param amount Amount to redeem
     **/
    function redeem(uint256 amount) external nonReentrant whenRedeemNotPaused {
        require(amount > 0, 'INVALID_ZERO_AMOUNT');
        require(block.number > START_BLOCK, "STAKE_NOT_STARTED");

        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];
        require(amount <= totalStakedAmount, 'INSUFFICIENT_TOTAL_STAKED_AMOUNT');
        require(amount <= stakerInfo.stakedAmount, 'INSUFFICIENT_STAKED_AMOUNT');

        stakerInfo.lastUpdatedBlock = block.number < END_BLOCK ? block.number : END_BLOCK;

        uint256 removedInterest = amount.mul(END_BLOCK.sub(stakerInfo.lastUpdatedBlock));

        totalInterest = totalInterest.sub(removedInterest);
        totalStakedAmount = totalStakedAmount.sub(amount);

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
    function claim() external nonReentrant whenClaimNotPaused {
        require(block.number > END_BLOCK, "STAKE_NOT_FINISHED");
        require(totalInterest > 0, 'INVALID_ZERO_TOTAL_INTEREST');

        StakerInfo storage stakerInfo = _stakerInfos[msg.sender];
        require(stakerInfo.accInterest > 0, "INSUFFICIENT_ACCUMULATED_INTEREST");

        uint256 claimRewardAmount = totalRewardAmount.mul(stakerInfo.accInterest) / totalInterest;

        stakerInfo.accInterest = 0;
        stakerInfo.lastUpdatedBlock = block.number;

        Helper.safeTransfer(REWARD_TOKEN, msg.sender, claimRewardAmount);
        emit RewardsClaimed(msg.sender, claimRewardAmount);
    }
}
