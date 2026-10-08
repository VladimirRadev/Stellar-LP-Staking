// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVladToken} from "./interfaces/IVladToken.sol";

/// @title StellarFarm
/// @author Vladimir Radev
/// @notice Single-pool MasterChef-style farm: stake sLP, earn VLAD at `rewardPerSecond`, split pro rata by stake.
/// @dev Rewards are minted on payout through `vlad.mint`, so this contract must hold the token's MINTER_ROLE.
///      `emergencyWithdraw` never mints, so stakers can always exit even if that role is revoked.
contract StellarFarm is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e18;

    IERC20 public immutable lpToken;
    IVladToken public immutable vlad;
    uint256 public rewardPerSecond;
    uint256 public lastRewardTime;
    uint256 public accRewardPerShare;
    uint256 public totalStaked;

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    mapping(address => UserInfo) public userInfo;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed user, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);

    error ZeroAmount();
    error InsufficientStake();

    constructor(IERC20 lpToken_, IVladToken vlad_, uint256 rewardPerSecond_) Ownable(msg.sender) {
        lpToken = lpToken_;
        vlad = vlad_;
        rewardPerSecond = rewardPerSecond_;
        lastRewardTime = block.timestamp;
    }

    /// @notice Accrues rewards up to now. While nothing is staked the clock just moves forward (nothing accrues).
    function updatePool() public {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= lastRewardTime) return;
        if (totalStaked != 0) {
            accRewardPerShare += (block.timestamp - lastRewardTime) * rewardPerSecond * ACC / totalStaked;
        }
        lastRewardTime = block.timestamp;
    }

    /// @notice Stakes `amount` sLP and pays out any pending VLAD.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        updatePool();
        UserInfo storage user = userInfo[msg.sender];
        uint256 pending = _pending(user);
        user.amount += amount;
        user.rewardDebt = user.amount * accRewardPerShare / ACC;
        totalStaked += amount;
        emit Deposit(msg.sender, amount);
        lpToken.safeTransferFrom(msg.sender, address(this), amount);
        _payReward(msg.sender, pending);
    }

    /// @notice Unstakes `amount` sLP and pays out any pending VLAD.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        UserInfo storage user = userInfo[msg.sender];
        if (amount > user.amount) revert InsufficientStake();
        updatePool();
        uint256 pending = _pending(user);
        user.amount -= amount;
        user.rewardDebt = user.amount * accRewardPerShare / ACC;
        totalStaked -= amount;
        emit Withdraw(msg.sender, amount);
        lpToken.safeTransfer(msg.sender, amount);
        _payReward(msg.sender, pending);
    }

    /// @notice Mints the caller's pending VLAD without changing the stake.
    function harvest() external nonReentrant {
        updatePool();
        UserInfo storage user = userInfo[msg.sender];
        uint256 pending = _pending(user);
        user.rewardDebt = user.amount * accRewardPerShare / ACC;
        _payReward(msg.sender, pending);
    }

    /// @notice Returns the whole stake immediately and forfeits all pending rewards. Never calls `mint`.
    function emergencyWithdraw() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        uint256 amount = user.amount;
        if (amount == 0) revert InsufficientStake();
        user.amount = 0;
        user.rewardDebt = 0;
        totalStaked -= amount;
        emit EmergencyWithdraw(msg.sender, amount);
        lpToken.safeTransfer(msg.sender, amount);
    }

    /// @notice VLAD that `account` could harvest right now.
    function pendingReward(address account) external view returns (uint256) {
        UserInfo storage user = userInfo[account];
        uint256 acc = accRewardPerShare;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > lastRewardTime && totalStaked != 0) {
            acc += (block.timestamp - lastRewardTime) * rewardPerSecond * ACC / totalStaked;
        }
        return user.amount * acc / ACC - user.rewardDebt;
    }

    /// @notice Changes the emission rate. Rewards up to now are accrued at the old rate first.
    function setRewardPerSecond(uint256 newRate) external onlyOwner {
        updatePool();
        emit RewardRateUpdated(rewardPerSecond, newRate);
        rewardPerSecond = newRate;
    }

    function _pending(UserInfo storage user) private view returns (uint256) {
        return user.amount * accRewardPerShare / ACC - user.rewardDebt;
    }

    function _payReward(address to, uint256 amount) private {
        if (amount == 0) return;
        emit Harvest(to, amount);
        vlad.mint(to, amount);
    }
}
