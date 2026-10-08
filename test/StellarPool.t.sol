// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StellarPool} from "../src/StellarPool.sol";
import {MockVlad} from "./mocks/MockVlad.sol";

contract StellarPoolTest is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockVlad internal vlad;
    StellarPool internal pool;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Mint(address indexed to, uint256 ethIn, uint256 vladIn, uint256 lp);
    event Swap(address indexed trader, uint256 ethIn, uint256 vladIn, uint256 ethOut, uint256 vladOut);

    function setUp() public {
        vlad = new MockVlad();
        vlad.grantRole(vlad.MINTER_ROLE(), address(this));
        pool = new StellarPool(vlad);
        for (uint256 i; i < 2; ++i) {
            address user = i == 0 ? alice : bob;
            vm.deal(user, 100 ether);
            vlad.mint(user, 100_000e18);
            vm.prank(user);
            vlad.approve(address(pool), type(uint256).max);
        }
    }

    function _add(address user, uint256 eth, uint256 maxVlad, uint256 minLp) internal returns (uint256) {
        vm.prank(user);
        return pool.addLiquidity{value: eth}(maxVlad, minLp);
    }

    function test_FirstAddMintsSqrtMinusMinimumToDead() public {
        uint256 root = Math.sqrt(1 ether * 100e18); // = 1e19
        vm.expectEmit(address(pool));
        emit Mint(alice, 1 ether, 100e18, root - 1000);
        uint256 lp = _add(alice, 1 ether, 100e18, 0);

        assertEq(lp, root - pool.MINIMUM_LIQUIDITY());
        assertEq(pool.balanceOf(alice), lp);
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.totalSupply(), root);
        (uint256 ethReserve, uint256 vladReserve) = pool.getReserves();
        assertEq(ethReserve, 1 ether);
        assertEq(vladReserve, 100e18);
        assertEq(address(pool).balance, 1 ether);
        assertEq(vlad.balanceOf(address(pool)), 100e18);
        assertEq(pool.lastUpdateBlock(), block.number);
    }

    function test_SecondAddPullsProportionalVladRoundedUp() public {
        _add(alice, 3 ether, 1000e18, 0);
        uint256 supplyBefore = pool.totalSupply();
        (uint256 quotedVlad, uint256 quotedLp) = pool.quoteAddLiquidity(1 ether);
        // 1 ETH * 1000 VLAD / 3 ETH = 333.333... VLAD -> the pool rounds up in its own favour.
        assertEq(quotedVlad, 333_333_333_333_333_333_334);
        assertEq(quotedVlad, uint256(1 ether) * 1000e18 / 3 ether + 1);

        uint256 bobVladBefore = vlad.balanceOf(bob);
        uint256 lp = _add(bob, 1 ether, 500e18, 0);

        assertEq(bobVladBefore - vlad.balanceOf(bob), quotedVlad, "pulls exactly the proportional amount");
        assertEq(lp, quotedLp);
        assertEq(lp, uint256(1 ether) * supplyBefore / 3 ether);
        (uint256 ethReserve, uint256 vladReserve) = pool.getReserves();
        assertEq(ethReserve, 4 ether);
        assertEq(vladReserve, 1000e18 + quotedVlad);
    }

    function test_RevertWhen_AddLiquiditySlippage() public {
        _add(alice, 1 ether, 100e18, 0);
        (uint256 vladNeeded, uint256 lpOut) = pool.quoteAddLiquidity(0.5 ether);

        vm.expectRevert(StellarPool.Slippage.selector);
        _add(bob, 0.5 ether, vladNeeded, lpOut + 1); // minLp not met

        vm.expectRevert(StellarPool.Slippage.selector);
        _add(bob, 0.5 ether, vladNeeded - 1, 0); // maxVlad too low

        assertEq(_add(bob, 0.5 ether, vladNeeded, lpOut), lpOut);
    }

    function test_RemoveLiquidityReturnsProRata() public {
        uint256 aliceLp = _add(alice, 1 ether, 100e18, 0);
        uint256 bobLp = _add(bob, 0.5 ether, 50e18, 0);
        assertEq(bobLp, 5e18);

        uint256 bobEthBefore = bob.balance;
        uint256 bobVladBefore = vlad.balanceOf(bob);
        vm.prank(bob);
        (uint256 ethOut, uint256 vladOut) = pool.removeLiquidity(bobLp, 0.5 ether, 50e18);
        assertEq(ethOut, 0.5 ether);
        assertEq(vladOut, 50e18);
        assertEq(bob.balance - bobEthBefore, 0.5 ether);
        assertEq(vlad.balanceOf(bob) - bobVladBefore, 50e18);
        assertEq(pool.balanceOf(bob), 0);

        uint256 half = aliceLp / 2;
        uint256 supply = pool.totalSupply();
        (uint256 ethReserve, uint256 vladReserve) = pool.getReserves();
        vm.prank(alice);
        (ethOut, vladOut) = pool.removeLiquidity(half, 0, 0);
        assertEq(ethOut, half * ethReserve / supply);
        assertEq(vladOut, half * vladReserve / supply);
        (uint256 ethAfter, uint256 vladAfter) = pool.getReserves();
        assertEq(ethAfter, ethReserve - ethOut);
        assertEq(vladAfter, vladReserve - vladOut);
        assertEq(address(pool).balance, ethAfter);
    }

    function test_SwapEthForVladMatchesQuoteAndKNonDecreasing() public {
        _add(alice, 10 ether, 1000e18, 0);
        (uint256 e0, uint256 v0) = pool.getReserves();
        uint256 expected = pool.getAmountOut(1 ether, e0, v0);
        assertEq(expected, uint256(1 ether) * 9970 * v0 / (e0 * 10_000 + uint256(1 ether) * 9970));

        uint256 bobVladBefore = vlad.balanceOf(bob);
        vm.expectEmit(address(pool));
        emit Swap(bob, 1 ether, 0, 0, expected);
        vm.prank(bob);
        uint256 out = pool.swapEthForVlad{value: 1 ether}(expected);

        assertEq(out, expected);
        assertEq(vlad.balanceOf(bob) - bobVladBefore, expected);
        (uint256 e1, uint256 v1) = pool.getReserves();
        assertEq(e1, e0 + 1 ether);
        assertEq(v1, v0 - expected);
        assertGt(e1 * v1, e0 * v0, "k grows by the fee");

        // No receive()/fallback: plain ETH sent to the pool is rejected.
        vm.prank(bob);
        (bool ok,) = address(pool).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_SwapVladForEthSendsEthAndRevertsOnSlippage() public {
        _add(alice, 10 ether, 1000e18, 0);
        (uint256 e0, uint256 v0) = pool.getReserves();
        uint256 expected = pool.getAmountOut(100e18, v0, e0);

        vm.expectRevert(StellarPool.Slippage.selector);
        vm.prank(bob);
        pool.swapVladForEth(100e18, expected + 1);

        uint256 bobEthBefore = bob.balance;
        vm.prank(bob);
        uint256 out = pool.swapVladForEth(100e18, expected);

        assertEq(out, expected);
        assertEq(bob.balance - bobEthBefore, expected);
        (uint256 e1, uint256 v1) = pool.getReserves();
        assertEq(e1, e0 - expected);
        assertEq(v1, v0 + 100e18);
        assertEq(address(pool).balance, e1);
        assertGe(e1 * v1, e0 * v0);
    }

    function testFuzz_GetAmountOutBounds(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view {
        amountIn = bound(amountIn, 1, 1e30);
        reserveIn = bound(reserveIn, 1, 1e30);
        reserveOut = bound(reserveOut, 1, 1e30);

        uint256 out = pool.getAmountOut(amountIn, reserveIn, reserveOut);

        assertEq(out, amountIn * 9970 * reserveOut / (reserveIn * 10_000 + amountIn * 9970), "formula");
        assertLt(out, reserveOut, "never drains the output reserve");
        assertLe(out, Math.mulDiv(amountIn, reserveOut, reserveIn), "never better than the spot price");
        assertGe((reserveIn + amountIn) * (reserveOut - out), reserveIn * reserveOut, "k non-decreasing");
    }
}
