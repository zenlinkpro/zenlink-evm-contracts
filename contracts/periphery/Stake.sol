// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/AdminUpgradeable.sol";

contract Stake is ERC20, Pausable, ReentrancyGuard, AdminUpgradeable {
    using Math for uint256;
    using SafeMath for uint256;

    uint256 private constant BPS_MAX = 10000;

    IERC20 public immutable STAKED_TOKEN;
    IERC20 public immutable REWARD_TOKEN;
    uint256 public COOLDOWN_IN_SECONDS;
    uint256 public COOLDOWN_IN_DAYS;
    uint256 public BPS_PENALTY;
    mapping(address => uint256) public stakersCooldowns;

    event Staked(address indexed user, uint256 amount, uint256 share);
    event Cooldown(address indexed user);
    event Redeem(
        address indexed user,
        uint256 share,
        uint256 redeemAmount,
        uint256 penaltyAmount
    );
    event Recovered(address token, uint256 amount);
    event SetCooldownAndRageExitParam(
        uint256 coolDownInDays,
        uint256 bpsPenalty
    );

    constructor(
        IERC20 stakedToken,
        IERC20 rewardToken,
        address admin,
        uint256 coolDownInDay,
        uint256 bpsPenalty
    ) ERC20("Zenlink Staking", "sZlk") {
        require(coolDownInDay >= 1, "COOLDOWN_IN_DAYS less than 1 day");
        require(bpsPenalty <= BPS_MAX, "BPS_PENALTY larger than BPS_MAX");

        COOLDOWN_IN_DAYS = coolDownInDay;
        COOLDOWN_IN_SECONDS = COOLDOWN_IN_DAYS * 86400;
        BPS_PENALTY = bpsPenalty;
        STAKED_TOKEN = stakedToken;
        REWARD_TOKEN = rewardToken;

        _initializeAdmin(admin);
    }

    function pause() external onlyAdmin whenNotPaused {
        _pause();
    }

    function unpause() external onlyAdmin whenPaused {
        _unpause();
    }

    function setCooldownAndRageExitParam(
        uint256 _COOLDOWN_IN_DAYS,
        uint256 _BPS_PENALTY
    ) public onlyAdmin {
        require(_COOLDOWN_IN_DAYS >= 1, "COOLDOWN_IN_DAYS less than 1 day");
        require(_BPS_PENALTY <= BPS_MAX, "BPS_PENALTY larger than BPS_MAX");

        COOLDOWN_IN_DAYS = _COOLDOWN_IN_DAYS;
        COOLDOWN_IN_SECONDS = _COOLDOWN_IN_DAYS * 86400;
        BPS_PENALTY = _BPS_PENALTY;
        emit SetCooldownAndRageExitParam(_COOLDOWN_IN_DAYS, _BPS_PENALTY);
    }

    function cooldownRemainSeconds(address _account)
        external
        view
        returns (uint256)
    {
        uint256 cooldownTimestamp = stakersCooldowns[_account];
        if (
            (cooldownTimestamp == 0) ||
            (cooldownTimestamp.add(COOLDOWN_IN_SECONDS) <= block.timestamp)
        ) return 0;

        return cooldownTimestamp.add(COOLDOWN_IN_SECONDS).sub(block.timestamp);
    }

    function previewRageExit(address _account)
        external
        view
        returns (uint256 receiveAmount, uint256 penaltyAmount)
    {
        uint256 cooldownEndTimestamp = stakersCooldowns[_account].add(
            COOLDOWN_IN_SECONDS
        );
        uint256 totalStakedToken = STAKED_TOKEN.balanceOf(address(this));
        uint256 totalShares = totalSupply();
        uint256 share = balanceOf(_account);
        uint256 userTotalAmount = share.mul(totalStakedToken) / totalShares;

        if (block.timestamp > cooldownEndTimestamp) {
            // Normal redeem if cooldown period already passed
            receiveAmount = userTotalAmount;
            penaltyAmount = 0;
        } else {
            uint256 timeDiffInDays = Math.min(
                COOLDOWN_IN_DAYS,
                (cooldownEndTimestamp.sub(block.timestamp)).div(86400).add(1)
            );
            uint256 penaltyShare = share
                .mul(timeDiffInDays)
                .mul(BPS_PENALTY)
                .div(BPS_MAX)
                .div(COOLDOWN_IN_DAYS);
            receiveAmount = share.sub(penaltyShare).mul(totalStakedToken).div(
                totalShares
            );
            penaltyAmount = userTotalAmount.sub(receiveAmount);
        }
    }

    function _getNextCooldownTimestamp(
        uint256 _fromCooldownTimestamp,
        uint256 _amountToReceive,
        address _toAddress,
        uint256 _toBalance
    ) internal view returns (uint256) {
        uint256 toCooldownTimestamp = stakersCooldowns[_toAddress];
        if (toCooldownTimestamp == 0) {
            return 0;
        }

        uint256 fromCooldownTimestamp;
        // If sent from user who has not unstake, set fromCooldownTimestamp to current block timestamp,
        // i.e., pretend the user just unstake now.
        // This is to prevent user from bypassing cooldown by transferring to an already unstaked account.
        if (_fromCooldownTimestamp == 0) {
            fromCooldownTimestamp = block.timestamp;
        } else {
            fromCooldownTimestamp = _fromCooldownTimestamp;
        }

        // If `to` account has greater timestamp, i.e., `to` has to wait longer, the timestamp remains the same.
        if (fromCooldownTimestamp <= toCooldownTimestamp) {
            return toCooldownTimestamp;
        } else {
            // Otherwise, count in `from` account's timestamp to derive `to` account's new timestamp.

            // If the period between `from` and `to` account is greater than COOLDOWN_SECONDS,
            // reduce the period to COOLDOWN_SECONDS.
            // This is to prevent user from bypassing cooldown by early unstake with `to` account
            // and enjoy free cooldown bonus while waiting for `from` account to unstake.
            if (
                fromCooldownTimestamp.sub(toCooldownTimestamp) >
                COOLDOWN_IN_SECONDS
            ) {
                toCooldownTimestamp = fromCooldownTimestamp.sub(
                    COOLDOWN_IN_SECONDS
                );
            }

            toCooldownTimestamp = (
                _amountToReceive.mul(fromCooldownTimestamp).add(
                    _toBalance.mul(toCooldownTimestamp)
                )
            ).div(_amountToReceive.add(_toBalance));
            return toCooldownTimestamp;
        }
    }

    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal override whenNotPaused {
        uint256 balanceOfFrom = balanceOf(_from);
        uint256 balanceOfTo = balanceOf(_to);
        uint256 previousSenderCooldown = stakersCooldowns[_from];
        if (_from != _to) {
            stakersCooldowns[_to] = _getNextCooldownTimestamp(
                previousSenderCooldown,
                _amount,
                _to,
                balanceOfTo
            );
            // if cooldown was set and whole balance of sender was transferred - clear cooldown
            if (balanceOfFrom == _amount && previousSenderCooldown != 0) {
                stakersCooldowns[_from] = 0;
            }
        }

        super._transfer(_from, _to, _amount);
    }

    function _stake(address _account, uint256 _amount) internal {
        require(_amount > 0, "cannot stake 0 amount");

        uint256 totalStakedToken = STAKED_TOKEN.balanceOf(address(this));
        uint256 totalShares = totalSupply();
        uint256 share;
        if (totalShares == 0 || totalStakedToken == 0) {
            share = _amount;
        } else {
            share = _amount.mul(totalShares).div(totalStakedToken);
        }
        // Update staker's Cooldown timestamp
        stakersCooldowns[_account] = _getNextCooldownTimestamp(
            block.timestamp,
            share,
            _account,
            balanceOf(_account)
        );

        _mint(_account, share);
        emit Staked(_account, _amount, share);
    }

    function stake(uint256 _amount) public nonReentrant whenNotPaused {
        _stake(msg.sender, _amount);
        STAKED_TOKEN.transferFrom(msg.sender, address(this), _amount);
    }

    function unstake() public {
        require(balanceOf(msg.sender) > 0, "no share to unstake");
        require(stakersCooldowns[msg.sender] == 0, "already unstake");

        stakersCooldowns[msg.sender] = block.timestamp;
        emit Cooldown(msg.sender);
    }

    function _redeem(uint256 _share, uint256 _penalty) internal {
        require(_share != 0, "cannot redeem 0 share");

        uint256 totalRewardToken = REWARD_TOKEN.balanceOf(address(this));
        uint256 totalShares = totalSupply();

        uint256 userTotalAmount = _share
            .add(_penalty)
            .mul(totalRewardToken)
            .div(totalShares);
        uint256 redeemAmount = _share.mul(totalRewardToken).div(totalShares);
        uint256 penaltyAmount = userTotalAmount.sub(redeemAmount);

        uint256 totalStakedToken = STAKED_TOKEN.balanceOf(address(this));
        uint256 unstakeAmount = _share.add(_penalty).mul(totalStakedToken).div(
            totalShares
        );

        _burn(msg.sender, _share.add(_penalty));
        if (balanceOf(msg.sender) == 0) {
            stakersCooldowns[msg.sender] = 0;
        }

        STAKED_TOKEN.transfer(msg.sender, unstakeAmount);
        REWARD_TOKEN.transfer(msg.sender, redeemAmount);

        emit Redeem(msg.sender, _share, redeemAmount, penaltyAmount);
    }

    function redeem(uint256 _share) public nonReentrant {
        uint256 cooldownStartTimestamp = stakersCooldowns[msg.sender];
        require(cooldownStartTimestamp > 0, "not yet unstake");

        require(
            block.timestamp > cooldownStartTimestamp.add(COOLDOWN_IN_SECONDS),
            "Still in cooldown"
        );

        _redeem(_share, 0);
    }

    function rageExit() public nonReentrant {
        uint256 cooldownStartTimestamp = stakersCooldowns[msg.sender];
        require(cooldownStartTimestamp > 0, "not yet unstake");

        uint256 cooldownEndTimestamp = cooldownStartTimestamp.add(
            COOLDOWN_IN_SECONDS
        );
        uint256 share = balanceOf(msg.sender);
        if (block.timestamp > cooldownEndTimestamp) {
            // Normal redeem if cooldown period already passed
            _redeem(share, 0);
        } else {
            uint256 timeDiffInDays = Math.min(
                COOLDOWN_IN_DAYS,
                (cooldownEndTimestamp.sub(block.timestamp)).div(86400).add(1)
            );
            uint256 penalty = share
                .mul(timeDiffInDays)
                .mul(BPS_PENALTY)
                .div(BPS_MAX)
                .div(COOLDOWN_IN_DAYS);
            _redeem(share.sub(penalty), penalty);
        }
    }
}
