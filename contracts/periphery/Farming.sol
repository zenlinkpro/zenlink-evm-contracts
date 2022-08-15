// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../libraries/Math.sol";
import "../libraries/Helper.sol";
import "../libraries/AdminUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Farming is AdminUpgradeable {
    using Math for uint256;
    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many farming tokens that user has provided.
        uint256[] rewardDebt; // Reward debt. See explanation below.
        // pending reward = (user.amount * pool.accRewardPerShare) - user.rewardDebt
        // Whenever a user stakes or redeems farming tokens to a pool. Here's what happens:
        //   1. The pool's `accRewardPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User add pending reward to his/her info.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
        uint256[] pending; // Pending rewards.
        uint256 nextClaimableBlock; // Next Block user can claim rewards.
    }
    // Info of each pool.
    struct PoolInfo {
        address farmingToken; // Address of farming token contract.
        address[] rewardTokens; // Reward tokens.
        uint256[] rewardPerBlock; // Reward tokens created per block.
        uint256[] accRewardPerShare; // Accumulated rewards per share, times 1e12.
        uint256[] remainingRewards; // remaining rewards in the pool.
        uint256 amount; // amount of farming token.
        uint256 lastRewardBlock; // Last block number that pools updated.
        uint256 startBlock; // Start block of pools.
        uint256 claimableInterval; // How many blocks of rewards can be claimed.
    }
    // Info of each pool.
    PoolInfo[] private poolInfo;
    // Info of each user that stakes farming tokens.
    mapping(uint256 => mapping(address => UserInfo)) private userInfo;

    event PoolAdded(address indexed farmingToken);
    event Charged(uint256 indexed pid, address[] rewards, uint256[] amounts);
    event WithdrawRewards(uint256 indexed pid, address[] rewards, uint256[] amounts);
    event Stake(address indexed user, uint256 indexed pid, uint256 amount);
    event Redeem(address indexed user, uint256 indexed pid, uint256 amount);
    event Claim(
        address indexed user, 
        uint256 indexed pid, 
        address[] rewards,
        uint256[] amounts
    );
    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        uint256 amount
    );

    constructor() {
        _initializeAdmin(msg.sender);
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new farming token to the pool. Can only be called by the admin.
    // XXX DO NOT add the same farming token more than once. Rewards will be messed up if you do.
    function add(
        address _farmingToken,
        address[] memory _rewardTokens,
        uint256[] memory _rewardPerBlock,
        uint256 _startBlock,
        uint256 _claimableInterval
    ) external onlyAdmin {
        require(_rewardTokens.length == _rewardPerBlock.length, 'INVALID_REWARDS');
        uint256 lastRewardBlock =
            block.number > _startBlock ? block.number : _startBlock;
        uint256[] memory accRewardPerShare = new uint256[](_rewardTokens.length);
        uint256[] memory remainingRewards = new uint256[](_rewardTokens.length);
        poolInfo.push(
            PoolInfo({
                farmingToken: _farmingToken,
                rewardTokens: _rewardTokens,
                rewardPerBlock: _rewardPerBlock,
                accRewardPerShare: accRewardPerShare,
                remainingRewards: remainingRewards,
                amount: 0,
                lastRewardBlock: lastRewardBlock,
                startBlock: _startBlock,
                claimableInterval: _claimableInterval
            })
        );
        emit PoolAdded(_farmingToken);
    }

    // Update the given pool's rewardPerBlock. Can only be called by the admin.
    function set(
        uint256 _pid,
        uint256[] memory _rewardPerBlock,
        bool _withUpdate
    ) external onlyAdmin {
        if (_withUpdate) {
            updatePool(_pid);
        }
        PoolInfo storage pool = poolInfo[_pid];
        require(_rewardPerBlock.length == pool.rewardPerBlock.length, 'INVALID_REWARDS');
        pool.rewardPerBlock = _rewardPerBlock;
    }

    // Charge the given pool's rewards. Can only be called by the admin.
    function charge(
        uint256 _pid,
        uint256[] memory _amounts
    ) external onlyAdmin {
        PoolInfo storage pool = poolInfo[_pid];
        require(_amounts.length == pool.rewardTokens.length, 'INVALID_AMOUNTS');
        for (uint256 i = 0; i < _amounts.length; i++) {
            if (_amounts[i] > 0) {
                Helper.safeTransferFrom(
                    pool.rewardTokens[i], 
                    msg.sender, 
                    address(this), 
                    _amounts[i]
                );
                pool.remainingRewards[i] = pool.remainingRewards[i].add(_amounts[i]);
            }
        }
        emit Charged(_pid, pool.rewardTokens, _amounts);
    }

    // Withdraw the given pool's rewards. Can only be called by the admin.
    function withdrawRewards(
        uint256 _pid,
        uint256[] memory _amounts
    ) external onlyAdmin {
        PoolInfo storage pool = poolInfo[_pid];
        require(_amounts.length == pool.rewardTokens.length, 'INVALID_AMOUNTS');
        for (uint256 i = 0; i < _amounts.length; i++) {
            require(_amounts[i] <= pool.remainingRewards[i], 'INVALID_AMOUNT');
            if (_amounts[i] > 0) {
                Helper.safeTransfer(
                    pool.rewardTokens[i], 
                    msg.sender, 
                    _amounts[i]
                );
                pool.remainingRewards[i] = pool.remainingRewards[i].sub(_amounts[i]);
            }
        }
        emit WithdrawRewards(_pid, pool.rewardTokens, _amounts);
    }

    // View function to see the given pool's info.
    function getPoolInfo(uint256 _pid) 
        external 
        view
        returns(
            address farmingToken,
            uint256 amount,
            address[] memory rewardTokens,
            uint256[] memory rewardPerBlock,
            uint256[] memory accRewardPerShare,
            uint256 lastRewardBlock,
            uint256 startBlock,
            uint256 claimableInterval
        )
    {
        PoolInfo memory pool = poolInfo[_pid];
        farmingToken = pool.farmingToken;
        amount = pool.amount;
        rewardTokens = pool.rewardTokens;
        rewardPerBlock = pool.rewardPerBlock;
        accRewardPerShare = pool.accRewardPerShare;
        lastRewardBlock = pool.lastRewardBlock;
        startBlock = pool.startBlock;
        claimableInterval = pool.claimableInterval;
    }

    // View function to see the remaing rewards of the given pool.
    function getRemaingRewards(uint256 _pid) 
        external
        view
        returns(uint256[] memory remainingRewards)
    {
        PoolInfo memory pool = poolInfo[_pid];
        remainingRewards = pool.remainingRewards;
    }

    // View function to see the given pool's info of user.
    function getUserInfo(uint256 _pid, address _user)
        external 
        view
        returns(
            uint256 amount,
            uint256[] memory pending,
            uint256[] memory rewardDebt,
            uint256 nextClaimableBlock
        )
    {
        UserInfo memory user = userInfo[_pid][_user];
        amount = user.amount;
        pending = user.pending;
        rewardDebt= user.rewardDebt;
        nextClaimableBlock = user.nextClaimableBlock;
    }

    // View function to see pending rewards.
    function pendingRewards(uint256 _pid, address _user) 
        public 
        view 
        returns(uint256[] memory rewards, uint256 nextClaimableBlock)
    {
        PoolInfo memory pool = poolInfo[_pid];
        UserInfo memory user = userInfo[_pid][_user];
        uint256 farmingTokenSupply = pool.amount;
        rewards = user.pending;
        if (block.number >= pool.lastRewardBlock && user.pending.length > 0 && farmingTokenSupply != 0) {
            for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
                uint256 reward = pool.rewardPerBlock[i].mul(
                    block.number.sub(pool.lastRewardBlock)
                );
                uint256 accRewardPerShare = pool.accRewardPerShare[i].add(
                    reward.mul(1e12) / farmingTokenSupply
                );
                rewards[i] = user.pending[i].add(
                    (user.amount.mul(accRewardPerShare) / 1e12).sub(user.rewardDebt[i])
                );
            }
        }
        nextClaimableBlock = user.nextClaimableBlock;
    }

    // View function to see current periods.
    function getPeriodsSinceStart(uint256 _pid) 
        public 
        view 
        returns(uint256 periods) 
    {
        PoolInfo memory pool = poolInfo[_pid];
        if (block.number <= pool.startBlock || pool.claimableInterval == 0) return 0;
        uint256 blocksSinceStart = block.number.sub(pool.startBlock);
        periods = (blocksSinceStart / pool.claimableInterval).add(1);
        if (blocksSinceStart % pool.claimableInterval == 0) {
            periods = periods - 1;
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 farmingTokenSupply = pool.amount;
        if (farmingTokenSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
            uint256 reward = pool.rewardPerBlock[i].mul(
                block.number.sub(pool.lastRewardBlock)
            );
            if (pool.remainingRewards[i] >= reward) {
                pool.remainingRewards[i] = pool.remainingRewards[i].sub(reward);
            } else {
                pool.remainingRewards[i] = 0;
            }
            pool.accRewardPerShare[i] = pool.accRewardPerShare[i].add(
                reward.mul(1e12) / farmingTokenSupply
            );
        }
        pool.lastRewardBlock = block.number;
    }

    // Stake farming tokens to the given pool.
    function stake(
        uint256 _pid,
        address _farmingToken, 
        uint256 _amount
    ) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(pool.farmingToken == _farmingToken, 'FARMING_TOKEN_SAFETY_CHECK');
        updatePool(_pid);
        if (user.amount > 0) {
            for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
                uint256 pending = (
                    user.amount.mul(pool.accRewardPerShare[i]) / 1e12
                ).sub(user.rewardDebt[i]);
                user.pending[i] = user.pending[i].add(pending);
            }
        }
        if (user.nextClaimableBlock == 0 && user.amount == 0) {
            if (block.number <= pool.startBlock) {
                user.nextClaimableBlock = pool.startBlock.add(pool.claimableInterval);
            } else {
                uint256 periods = getPeriodsSinceStart(_pid);
                user.nextClaimableBlock = pool.startBlock.add(
                    periods.mul(pool.claimableInterval)
                );
            }
            user.rewardDebt = new uint256[](pool.rewardTokens.length);
            user.pending = new uint256[](pool.rewardTokens.length);
        }
        Helper.safeTransferFrom(
            pool.farmingToken, 
            msg.sender, 
            address(this), 
            _amount
        );
        user.amount = user.amount.add(_amount);
        pool.amount = pool.amount.add(_amount);
        for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
            user.rewardDebt[i] = user.amount.mul(pool.accRewardPerShare[i]) / 1e12;
        }
        emit Stake(msg.sender, _pid, _amount);
    }

    // Redeem farming tokens from the given pool.
    function redeem(
        uint256 _pid, 
        address _farmingToken, 
        uint256 _amount
    ) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(pool.farmingToken == _farmingToken, 'FARMING_TOKEN_SAFETY_CHECK');
        require(user.amount >= _amount, 'INSUFFICIENT_AMOUNT');
        updatePool(_pid);
        for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
            uint256 pending = (
                user.amount.mul(pool.accRewardPerShare[i]) / 1e12
            ).sub(user.rewardDebt[i]);
            user.pending[i] = user.pending[i].add(pending);
            user.rewardDebt[i] = user.amount.sub(_amount).mul(pool.accRewardPerShare[i]) / 1e12;
        }
        Helper.safeTransfer(pool.farmingToken, msg.sender, _amount);
        user.amount = user.amount.sub(_amount);
        pool.amount = pool.amount.sub(_amount);
        emit Redeem(msg.sender, _pid, _amount);
    }

    // Claim rewards when block number larger than user's nextClaimableBlock.
    function claim(uint256 _pid) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(block.number > user.nextClaimableBlock, 'NOT_CLAIMABLE');
        (uint256[] memory rewards, ) = pendingRewards(_pid, msg.sender);
        updatePool(_pid);
        for (uint256 i = 0; i < pool.accRewardPerShare.length; i++) {
            user.pending[i] = 0;
            user.rewardDebt[i] = user.amount.mul(pool.accRewardPerShare[i]) / 1e12;
            if (rewards[i] > 0) {
                Helper.safeTransfer(pool.rewardTokens[i], msg.sender, rewards[i]);
            }
        }
        uint256 periods = getPeriodsSinceStart(_pid);
        user.nextClaimableBlock = pool.startBlock.add(
            periods.mul(pool.claimableInterval)
        );
        emit Claim(msg.sender, _pid, pool.rewardTokens, rewards);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        pool.amount = pool.amount.sub(amount);
        user.amount = 0;
        user.pending = new uint256[](pool.accRewardPerShare.length);
        user.rewardDebt = new uint256[](pool.accRewardPerShare.length);
        user.nextClaimableBlock = 0;
        Helper.safeTransfer(pool.farmingToken, msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }
}
