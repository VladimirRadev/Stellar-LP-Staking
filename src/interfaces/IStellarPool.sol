// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IStellarPool
/// @author Vladimir Radev
/// @notice Read-only view of the Stellar ETH/VLAD constant-product pool. Other Stellar repos copy this file
///         (for example Stellar Bank reads the spot price from it as a demo oracle).
interface IStellarPool {
    function getReserves() external view returns (uint256 ethReserve, uint256 vladReserve);
    function lastUpdateBlock() external view returns (uint256);
}
