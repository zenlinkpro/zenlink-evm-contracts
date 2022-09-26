// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdminUpgradeable} from "../libraries/AdminUpgradeable.sol";
import {Farming} from "../periphery/Farming.sol";

contract Gauge is AdminUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice The address of framing contract
    address public farming;

    /// @notice The address of the token used to vote.
    address public voteToken;

    /// @notice The duration between tow vote period.
    uint256 public voteSetWindow;

    /// @notice The duration of a vote period.
    uint256 public voteDuration;

    /// @notice The next vote period id.
    uint256 public nextVotePeriodID;

    struct PoolPeriodState {
        /// @notice Flag marking whether the pool inherit the last period token.
        bool inherit;
        /// @notice Flag marking whether the pool votalbe has been reset by admin.
        bool resetVotable;
        /// @notice Flag marking whether the pool is votalbe in this period.
        bool votable;
        /// @notice score this pool get in this period.
        uint256 score;
        /// @notice The Amount of token this pool get in this period.
        uint256 totalAmount;
    }

    struct VotePeriod {
        /// @notice The start timestmap of this vote period
        uint256 start;
        /// @notice The end timestmap of this vote period
        uint256 end;
    }

    /// @notice (periodId => VotePeriod)
    mapping(uint256 => VotePeriod) public votePeriods;

    /// @notice (userAddress => pooId => amount)
    mapping(address => mapping(uint256 => uint256)) public userInfos;

    /// @notice periodId => (poolId => PoolPeriodState)
    mapping(uint256 => mapping(uint256 => PoolPeriodState)) public allPoolState;

    /// @notice pool last update period
    mapping(uint256 => uint256) public poolLastUpdatePeriod;

    ///@notice poolId => bool, flag mark whether the trading pool is consist of stablecoins
    mapping(uint256 => bool) public stablePools;

    event UpdatePoolHistory(
        uint256 indexed poolId,
        uint256 curPeriod,
        uint256 lastPeriod,
        uint256 needUpdatePool,
        uint256 lastPeriodAmount
    );

    event Vote(
        address indexed voter,
        uint256 indexed period,
        uint256 poolId,
        uint256 amount,
        uint256 poolPeriodScore,
        uint256 poolPeriodAmount
    );

    event CancelVote(
        address indexed voter,
        uint256 indexed period,
        uint256 poolId,
        uint256 amount,
        uint256 poolPeriodScore,
        uint256 poolPeriodAmount
    );

    event InheritPool(
        uint256 poolId,
        uint256 curPeriod,
        uint256 lastPeriod,
        uint256 amount,
        bool votable
    );

    event UpdateVotePeriod(uint256 curPeriod, uint256 start, uint256 end);

    event SetNonVotablePools(uint256 period, uint256[] pools);

    event SetVotablePools(uint256 period, uint256[] pools);

    event UpdateVoteSetWindow(uint256 curPeriod, uint256 voteSetWindow);

    event UpdateVoteDuration(uint256 curPeriod, uint256 voteDuration);

    event UpdateStablePools(uint256[] pids);

    event MigrateVote(
        address indexed voter,
        uint256 indexed period,
        uint256[] fromPoolIds,
        uint256[] fromAmounts,
        uint256[] toPoolIds,
        uint256[] toAmounts
    );

    error InvalidBlock(uint256 block);
    error PoolNotAllowedToVote(uint256 poolId);
    error InsuffientAmount(uint256 amount);
    error ArrayMismatch();
    error AmountNotEqual(uint256 amount0, uint256 amount1);
    error NoNeedToUpdate(uint256 curPeriod, uint256 period);

    constructor(
        address _farming,
        address _voteToken,
        uint256 _voteDuration,
        uint256 _voteSetWindow,
        uint256 _firstPeriodStart
    ) {
        if (block.timestamp >= _firstPeriodStart)
            revert InvalidBlock(_firstPeriodStart);

        nextVotePeriodID = 1;
        voteToken = _voteToken;
        farming = _farming;
        voteSetWindow = _voteSetWindow;
        voteDuration = _voteDuration;

        votePeriods[0] = VotePeriod(
            _firstPeriodStart,
            _firstPeriodStart + voteDuration
        );

        _initializeAdmin(msg.sender);
    }

    function updateVoteSetWindow(uint256 _voteSetWindow) external onlyAdmin {
        uint256 curPeriodId = getCurrentPeriodId();
        voteSetWindow = _voteSetWindow;
        emit UpdateVoteSetWindow(curPeriodId, voteSetWindow);
    }

    function updateVoteDuration(uint256 _voteDuration) external onlyAdmin {
        uint256 curPeriodId = getCurrentPeriodId();
        voteDuration = _voteDuration;
        emit UpdateVoteDuration(curPeriodId, voteDuration);
    }

    function updateVotePeriod() public {
        uint256 curTimestamp = block.timestamp;
        uint256 curPeriodId = getCurrentPeriodId();

        VotePeriod storage curPeriod = votePeriods[curPeriodId];

        if (curPeriod.end > curTimestamp) {
            return;
        }

        VotePeriod storage nextPeriod = votePeriods[nextVotePeriodID];
        if (curPeriod.end + voteSetWindow >= curTimestamp) {
            nextPeriod.start = curPeriod.end + voteSetWindow;
            nextPeriod.end = nextPeriod.start + voteDuration;
        } else {
            nextPeriod.start = curTimestamp;
            nextPeriod.end = curTimestamp + voteDuration;
        }

        emit UpdateVotePeriod(
            nextVotePeriodID,
            nextPeriod.start,
            nextPeriod.end
        );

        nextVotePeriodID++;
    }

    function setVotablePools(uint256[] memory poolIds) external onlyAdmin {
        uint256 periodId = getCurrentPeriodId();
        VotePeriod memory curPeriod = votePeriods[periodId];

        if (curPeriod.end < block.timestamp) {
            periodId = nextVotePeriodID;
        }

        for (uint256 i; i < poolIds.length; i++) {
            PoolPeriodState storage poolPeriodState = allPoolState[periodId][poolIds[i]];
            poolPeriodState.votable = true;
            poolPeriodState.resetVotable = true;
        }
        emit SetVotablePools(periodId, poolIds);
    }

    function setNonVotablePools(uint256[] memory poolIds) external onlyAdmin {
        uint256 periodId = getCurrentPeriodId();

        VotePeriod memory curPeriod = votePeriods[periodId];

        if (curPeriod.end < block.timestamp) {
            periodId = nextVotePeriodID;
        }

        for (uint256 i; i < poolIds.length; i++) {
            PoolPeriodState storage poolPeriodState = allPoolState[periodId][poolIds[i]];
            poolPeriodState.votable = false;
            poolPeriodState.resetVotable = true;
        }
        emit SetNonVotablePools(periodId, poolIds);
    }

    function vote(uint256 poolId, uint256 amount) external {
        updateVotePeriod();

        uint256 curPeriodId = getCurrentPeriodId();
        VotePeriod memory currentPeriod = votePeriods[curPeriodId];

        if (block.timestamp >= currentPeriod.end)
            revert InvalidBlock(currentPeriod.end);

        PoolPeriodState storage curPoolState = _inheritExpiredPool(poolId);
        _vote(poolId, amount, curPoolState, currentPeriod);
    }

    function _vote(
        uint256 poolId,
        uint256 amount,
        PoolPeriodState storage curPoolState,
        VotePeriod memory currentPeriod
    ) internal {
        uint256 curTimestamp = block.timestamp;

        if (!curPoolState.votable) revert PoolNotAllowedToVote(poolId);
        uint256 curPeriodId = getCurrentPeriodId();

        if (curTimestamp < currentPeriod.start) {
            curTimestamp = currentPeriod.start;
        }

        uint256 score = ((currentPeriod.end - curTimestamp) * amount) /
            (currentPeriod.end - currentPeriod.start);

        curPoolState.score += score;
        curPoolState.totalAmount += amount;

        userInfos[msg.sender][poolId] += amount;

        IERC20(voteToken).safeTransferFrom(msg.sender, address(this), amount);

        emit Vote(
            msg.sender, 
            curPeriodId, 
            poolId, 
            amount, 
            curPoolState.score, 
            curPoolState.totalAmount
        );
    }

    function cancelVote(uint256 poolId, uint256 amount) external {
        updateVotePeriod();
        PoolPeriodState storage poolState = _inheritExpiredPool(poolId);

        uint256 curPeriodId = getCurrentPeriodId();
        _cancelVote(poolId, curPeriodId, poolState, amount);
    }

    function _cancelVote(
        uint256 poolId,
        uint256 curPeriodId,
        PoolPeriodState storage poolState,
        uint256 amount
    ) internal {
        uint256 userBalance = userInfos[msg.sender][poolId];
        if (userBalance < amount) revert InsuffientAmount(userBalance);

        userInfos[msg.sender][poolId] -= amount;

        VotePeriod memory curPeriod = votePeriods[curPeriodId];

        uint256 curTimestamp = block.timestamp;

        if (curTimestamp < curPeriod.start) {
            poolState.score -= amount;
        } else if (curTimestamp <= curPeriod.end) {
            poolState.score -=
                (amount * (curPeriod.end - curTimestamp)) /
                (curPeriod.end - curPeriod.start);
        }

        poolState.totalAmount -= amount;

        IERC20(voteToken).safeTransfer(msg.sender, amount);

        emit CancelVote(
            msg.sender, 
            curPeriodId, 
            poolId, 
            amount, 
            poolState.score, 
            poolState.totalAmount
        );
    }

    function batchVote(uint256[] memory poolIds, uint256[] memory amounts)
        public
    {
        if (poolIds.length != amounts.length) revert ArrayMismatch();
        updateVotePeriod();

        uint256 curPeriodId = getCurrentPeriodId();
        VotePeriod memory currentPeriod = votePeriods[curPeriodId];
        if (block.timestamp >= currentPeriod.end)
            revert InvalidBlock(currentPeriod.end);

        for (uint256 i = 0; i < poolIds.length; i++) {
            PoolPeriodState storage poolState = _inheritExpiredPool(poolIds[i]);
            _vote(poolIds[i], amounts[i], poolState, currentPeriod);
        }
    }

    function batchCancelVote(uint256[] memory poolIds, uint256[] memory amounts)
        public
    {
        if (poolIds.length != amounts.length) revert ArrayMismatch();
        updateVotePeriod();

        uint256 curPeriodId = getCurrentPeriodId();

        for (uint256 i = 0; i < poolIds.length; i++) {
            PoolPeriodState storage poolState = _inheritExpiredPool(poolIds[i]);
            _cancelVote(poolIds[i], curPeriodId, poolState, amounts[i]);
        }
    }

    function migrateVote(
        uint256[] memory fromPoolIds,
        uint256[] memory fromAmounts,
        uint256[] memory toPoolIds,
        uint256[] memory toAmounts
    ) external {
        if (
            fromPoolIds.length != fromAmounts.length ||
            toPoolIds.length != toAmounts.length
        ) revert ArrayMismatch();

        uint256 fromTotalAmount;
        uint256 toTotalAmount;

        for (uint256 i = 0; i < fromPoolIds.length; i++) {
            fromTotalAmount += fromAmounts[i];
        }

        for (uint256 i = 0; i < toPoolIds.length; i++) {
            toTotalAmount += toAmounts[i];
        }

        if (fromTotalAmount != toTotalAmount)
            revert AmountNotEqual(fromTotalAmount, toTotalAmount);

        batchCancelVote(fromPoolIds, fromAmounts);
        batchVote(toPoolIds, toAmounts);

        emit MigrateVote(
            msg.sender,
            getCurrentPeriodId(),
            fromPoolIds,
            fromAmounts,
            toPoolIds,
            toAmounts
        );
    }

    function _inheritExpiredPool(uint256 poolId)
        internal
        returns (PoolPeriodState storage curPoolState)
    {
        uint256 curPeriodId = getCurrentPeriodId();
        curPoolState = allPoolState[curPeriodId][poolId];

        if (curPeriodId == 0 || curPoolState.inherit) {
            return curPoolState;
        }

        uint256 lastUpdatePeriod = poolLastUpdatePeriod[poolId];
        PoolPeriodState memory lastPoolState = allPoolState[lastUpdatePeriod][poolId];

        curPoolState.inherit = true;
        curPoolState.score = lastPoolState.totalAmount;

        // Reset votable by admin, can't inherit last pool votable.
        if (!curPoolState.resetVotable) {
            curPoolState.votable = lastPoolState.votable;
        }
        curPoolState.totalAmount = lastPoolState.totalAmount;

        poolLastUpdatePeriod[poolId] = curPeriodId;

        emit InheritPool(
            poolId,
            curPeriodId,
            lastUpdatePeriod,
            lastPoolState.totalAmount,
            lastPoolState.votable
        );
    }

    function updatePoolHistory(uint256 poolId, uint256 needUpdatePeriodId)
        public
    {
        uint256 curPeriodId = getCurrentPeriodId();
        if (needUpdatePeriodId == 0 || needUpdatePeriodId > curPeriodId)
            revert NoNeedToUpdate(curPeriodId, needUpdatePeriodId);

        uint256 findedPeriodId = needUpdatePeriodId - 1;
        PoolPeriodState memory findedPeriodState;

        for (; findedPeriodId >= 0; findedPeriodId--) {
            findedPeriodState = allPoolState[findedPeriodId][poolId];
            if (findedPeriodState.inherit || findedPeriodId == 0) {
                break;
            }
        }

        for (uint256 i = needUpdatePeriodId; i > findedPeriodId; i--) {
            PoolPeriodState storage poolState = allPoolState[i][poolId];
            if (poolState.inherit) {
                continue;
            }

            poolState.inherit = true;
            poolState.score = findedPeriodState.totalAmount;
            poolState.totalAmount = findedPeriodState.totalAmount;
            if (!poolState.resetVotable) {
                poolState.votable = findedPeriodState.votable;
            }
        }

        uint256 lastUpdatePeriodId = poolLastUpdatePeriod[poolId];
        if (needUpdatePeriodId > lastUpdatePeriodId) {
            poolLastUpdatePeriod[poolId] = needUpdatePeriodId;
        }

        emit UpdatePoolHistory(
            poolId,
            curPeriodId,
            findedPeriodId,
            needUpdatePeriodId,
            findedPeriodState.totalAmount
        );
    }

    function setStablePools(uint256[] memory poolIds) external onlyAdmin{
        for (uint256 i = 0; i < poolIds.length; i++) {
            stablePools[poolIds[i]] = true;
        }
        emit UpdateStablePools(poolIds);
    }

    function setNonStablePools(uint256[] memory poolIds) external onlyAdmin {
        for (uint256 i = 0; i < poolIds.length; i++) {
            stablePools[poolIds[i]] = false;
        }
        emit UpdateStablePools(poolIds);
    }

    function getPoolInfo(uint256 poolId)
        external
        view
        returns (
            uint256 score,
            bool stable,
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
        (
            farmingToken,
            amount,
            rewardTokens,
            rewardPerBlock,
            accRewardPerShare,
            lastRewardBlock,
            startBlock,
            claimableInterval
        ) = Farming(farming).getPoolInfo(poolId);

        stable = stablePools[poolId];

        uint256 lastUpdatePeriod = poolLastUpdatePeriod[poolId];
        uint256 curPeriodId = getCurrentPeriodId();
        if (lastUpdatePeriod == curPeriodId) {
            score = allPoolState[curPeriodId][poolId].score;
        } else {
            score = allPoolState[lastUpdatePeriod][poolId].totalAmount;
        }
    }

    function getCurrentPeriodId() public view returns (uint256) {
        return nextVotePeriodID - 1;
    }
}
