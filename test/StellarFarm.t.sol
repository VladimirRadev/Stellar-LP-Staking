// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {StellarPool} from "../src/StellarPool.sol";
import {StellarFarm} from "../src/StellarFarm.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";
import {MockVlad} from "./mocks/MockVlad.sol";

contract StellarFarmTest is Test {
    uint256 internal constant RATE = 1e16; // 0.01 VLAD per second, same as the deploy script

    MockVlad internal vlad;
    StellarPool internal pool;
    StellarFarm internal farm;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Harvest(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);

    function setUp() public {
        vlad = new MockVlad();
        vlad.grantRole(vlad.MINTER_ROLE(), address(this));
        pool = new StellarPool(vlad);
        farm = new StellarFarm(pool, IVladToken(address(vlad)), RATE);
        vlad.grantRole(vlad.MINTER_ROLE(), address(farm));

        // Alice seeds the pool (1 ETH + 100 VLAD -> 1e19 - 1000 sLP) and hands 4 sLP to Bob.
        vm.deal(alice, 10 ether);
        vlad.mint(alice, 100e18);
        vm.startPrank(alice);
        vlad.approve(address(pool), 100e18);
        pool.addLiquidity{value: 1 ether}(100e18, 0);
        assertTrue(pool.transfer(bob, 4e18));
        pool.approve(address(farm), type(uint256).max);
        vm.stopPrank();
        vm.prank(bob);
        pool.approve(address(farm), type(uint256).max);
    }

    function _deposit(address user, uint256 amount) internal {
        vm.prank(user);
        farm.deposit(amount);
    }

    function test_SingleStakerPendingEqualsRateTimesDtAndHarvestMints() public {
        _deposit(alice, 1e18);
        skip(100);
        assertEq(farm.pendingReward(alice), RATE * 100);

        vm.expectEmit(address(farm));
        emit Harvest(alice, RATE * 100);
        vm.prank(alice);
        farm.harvest();

        assertEq(vlad.balanceOf(alice), RATE * 100, "reward is minted");
        assertEq(farm.pendingReward(alice), 0);
        (uint256 amount, uint256 rewardDebt) = farm.userInfo(alice);
        assertEq(amount, 1e18);
        assertEq(rewardDebt, amount * farm.accRewardPerShare() / 1e18);
    }

    function test_TwoStakersSplitProportionallyAndWithdrawUpdatesDebt() public {
        _deposit(alice, 2e18);
        skip(100); // Alice alone: 1 VLAD
        _deposit(bob, 3e18);
        skip(100); // 2:3 split of 1 VLAD -> Alice 0.4, Bob 0.6
        assertEq(farm.pendingReward(alice), 1.4e18);
        assertEq(farm.pendingReward(bob), 0.6e18);

        uint256 lpBefore = pool.balanceOf(alice);
        vm.prank(alice);
        farm.withdraw(1e18);
        assertEq(pool.balanceOf(alice) - lpBefore, 1e18);
        assertEq(vlad.balanceOf(alice), 1.4e18, "withdraw pays pending");
        (uint256 amount, uint256 rewardDebt) = farm.userInfo(alice);
        assertEq(amount, 1e18);
        assertEq(rewardDebt, farm.accRewardPerShare(), "debt reset to amount * acc");
        assertEq(farm.pendingReward(alice), 0);
        assertEq(farm.totalStaked(), 4e18);

        skip(100); // 1:3 split of 1 VLAD -> Alice 0.25, Bob 0.75
        assertEq(farm.pendingReward(alice), 0.25e18);
        assertEq(farm.pendingReward(bob), 1.35e18);

        vm.expectRevert(StellarFarm.InsufficientStake.selector);
        vm.prank(alice);
        farm.withdraw(1e18 + 1);
    }

    function test_NoRewardsAccrueWhileNothingStaked() public {
        skip(1000);
        _deposit(alice, 1e18);
        assertEq(farm.accRewardPerShare(), 0);
        assertEq(farm.lastRewardTime(), block.timestamp);
        assertEq(farm.pendingReward(alice), 0);

        skip(10);
        vm.prank(alice);
        farm.withdraw(1e18);
        assertEq(vlad.balanceOf(alice), RATE * 10, "only the staked seconds pay");
        assertEq(farm.totalStaked(), 0);

        skip(500); // empty farm: these 500 seconds are skipped, not owed to anyone
        _deposit(bob, 1e18);
        skip(10);
        assertEq(farm.pendingReward(bob), RATE * 10);
    }

    function test_EmergencyWithdrawForfeitsAndSetRateOnlyOwner() public {
        _deposit(alice, 1e18);
        skip(100);
        assertEq(farm.pendingReward(alice), RATE * 100);

        // Even with MINTER_ROLE revoked, emergencyWithdraw still works because it never mints.
        vlad.revokeRole(vlad.MINTER_ROLE(), address(farm));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(farm), vlad.MINTER_ROLE()
            )
        );
        vm.prank(alice);
        farm.harvest();

        uint256 lpBefore = pool.balanceOf(alice);
        vm.prank(alice);
        farm.emergencyWithdraw();
        assertEq(pool.balanceOf(alice) - lpBefore, 1e18);
        assertEq(vlad.balanceOf(alice), 0, "rewards forfeited");
        (uint256 amount, uint256 rewardDebt) = farm.userInfo(alice);
        assertEq(amount + rewardDebt, 0);
        assertEq(farm.pendingReward(alice), 0);
        assertEq(farm.totalStaked(), 0);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vm.prank(bob);
        farm.setRewardPerSecond(1);

        // The owner's rate change accrues the old rate first.
        vlad.grantRole(vlad.MINTER_ROLE(), address(farm));
        _deposit(bob, 1e18);
        skip(100);
        vm.expectEmit(address(farm));
        emit RewardRateUpdated(RATE, 2 * RATE);
        farm.setRewardPerSecond(2 * RATE);
        assertEq(farm.lastRewardTime(), block.timestamp);
        skip(100);
        assertEq(farm.pendingReward(bob), RATE * 100 + 2 * RATE * 100);
    }
}
