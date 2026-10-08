// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StellarPool} from "../src/StellarPool.sol";
import {StellarFarm} from "../src/StellarFarm.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";

/// @notice Deploys StellarPool + StellarFarm against an already deployed VLAD token, gives the farm MINTER_ROLE
///         and seeds the pool with 0.002 ETH + 200 VLAD (opening price: 1 ETH = 100,000 VLAD).
/// @dev Env: PRIVATE_KEY (must be the VLAD admin and hold >= 200 VLAD plus the ETH), VLAD_TOKEN.
///      forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
contract Deploy is Script {
    uint256 internal constant REWARD_PER_SECOND = 1e16; // 0.01 VLAD per second
    uint256 internal constant SEED_VLAD = 200e18;
    uint256 internal constant SEED_ETH = 0.002 ether;

    function run() external returns (StellarPool pool, StellarFarm farm) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        IVladToken vlad = IVladToken(vm.envAddress("VLAD_TOKEN"));
        require(address(vlad).code.length > 0, "VLAD_TOKEN has no code on this chain");

        vm.startBroadcast(deployerKey);
        pool = new StellarPool(vlad);
        farm = new StellarFarm(pool, vlad, REWARD_PER_SECOND);
        vlad.grantRole(vlad.MINTER_ROLE(), address(farm));
        vlad.approve(address(pool), SEED_VLAD);
        pool.addLiquidity{value: SEED_ETH}(SEED_VLAD, 0);
        vm.stopBroadcast();

        console2.log("Deployer    ", vm.addr(deployerKey));
        console2.log("VLAD token  ", address(vlad));
        console2.log("StellarPool ", address(pool));
        console2.log("StellarFarm ", address(farm));
        console2.log("Farm is minter", vlad.hasRole(vlad.MINTER_ROLE(), address(farm)));
        console2.log("Seed LP minted", pool.balanceOf(vm.addr(deployerKey)));
    }
}
