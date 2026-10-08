# Stellar Swap & LP Staking — ETH/VLAD AMM + farm (Sepolia)

A constant-product ETH/VLAD exchange and a liquidity-mining farm on Ethereum Sepolia.
Provide ETH + VLAD to the pool, receive **sLP** (the pool's own LP token), stake sLP in the farm and earn
newly minted **$VLAD** every second.

> **Stellar** is a personal Web3 portfolio suite by Vladimir Radev, deployed on Ethereum **Sepolia**.
> It is unrelated to the Stellar (XLM) network. $VLAD ("Vladimir", 18 decimals) is a testnet token with no value.

## Architecture

```
            addLiquidity / removeLiquidity / swap*                 deposit / withdraw / harvest
  user ─────────────────────────────────────────► StellarPool ◄──── sLP ────── StellarFarm ◄──── user
                                                  (ERC-20 sLP)                     │
                                                       │ ETH + VLAD reserves       │ vlad.mint(user, pending)
                                                       ▼                           ▼
                                                  VladToken ($VLAD) ◄── MINTER_ROLE granted to the farm
                                                  (deployed by Stellar-Faucet)
```

| Contract | Role |
|---|---|
| `src/StellarPool.sol` | Constant-product AMM for native ETH and VLAD, 0.30% fee, the contract is the ERC-20 LP token `sLP`. |
| `src/StellarFarm.sol` | Single-pool MasterChef farm. Stakers of `sLP` share `rewardPerSecond` VLAD pro rata; rewards are minted. |
| `src/interfaces/IVladToken.sol` | Shared VLAD interface (identical in all Stellar repos). |
| `src/interfaces/IStellarPool.sol` | Read-only pool interface that other Stellar repos copy (`getReserves`, `lastUpdateBlock`). |

## Formulas

**Swap output** (fee `FEE_BPS = 30`, i.e. 0.30% stays in the pool):

```
amountOut = amountIn * 9970 * reserveOut / (reserveIn * 10000 + amountIn * 9970)
```

Because the fee stays in the reserves, `k = reserveEth * reserveVlad` never decreases after a swap.

**First liquidity deposit** (sets the price):

```
lp = sqrt(ethIn * vladIn) - MINIMUM_LIQUIDITY        // MINIMUM_LIQUIDITY = 1000 is minted to 0x…dEaD
```

**Later deposits** (`msg.value` decides the size; VLAD is pulled to match the current price):

```
vladNeeded = ceil(ethIn * reserveVlad / reserveEth)  // rounded up in the pool's favour, must be <= maxVlad
lp         = ethIn * totalSupply / reserveEth
```

**Withdrawal** (pro rata): `ethOut = lp * reserveEth / totalSupply`, `vladOut = lp * reserveVlad / totalSupply`.

**Farm accounting** (`ACC = 1e18`):

```
accRewardPerShare += (now - lastRewardTime) * rewardPerSecond * ACC / totalStaked   // skipped while totalStaked == 0
pending            = user.amount * accRewardPerShare / ACC - user.rewardDebt
```

## Security notes

- **Internal reserves.** `reserveEth` / `reserveVlad` are stored and updated only by the pool's own functions;
  they are never read from `address(this).balance` or `balanceOf`. Donated VLAD or force-sent ETH
  (e.g. via `selfdestruct`) cannot move the price; it is simply stranded.
- **No `receive()` / `fallback`.** A plain ETH transfer to the pool reverts.
- **Reentrancy.** Every state-changing pool and farm function is `nonReentrant` and follows
  checks-effects-interactions: state and events first, token transfers next, ETH (via `call`) last.
- **Slippage protection.** `minLp`, `maxVlad`, `minEth`/`minVlad` and `minVladOut`/`minEthOut` revert with `Slippage()`.
- **Inflation / first-depositor attack.** 1000 LP units are locked forever at `0x…dEaD`
  (OpenZeppelin v5 forbids minting to `address(0)`).
- **Minted rewards.** The farm holds VLAD's `MINTER_ROLE`, so emission is bounded only by `rewardPerSecond`
  (owner-controlled, `setRewardPerSecond` accrues the old rate first). `emergencyWithdraw` never calls `mint`,
  so stakers can always exit, even if the role is revoked.
- **AMM spot price is used by Stellar Bank as a demo oracle.** `getReserves()` + `lastUpdateBlock()` give a
  spot price that one large swap can move within a single block. This is acceptable for a testnet demo only;
  a production lender would use a TWAP or an external oracle.
- **Assumptions.** VLAD is a plain ERC-20 (no fee-on-transfer, no hooks). Testnet portfolio code, not audited.

## Deployed addresses (Sepolia)

| Contract | Address |
|---|---|
| VladToken ($VLAD) | TODO |
| StellarPool (sLP) | TODO |
| StellarFarm | TODO |

## Development

```bash
git clone --recurse-submodules https://github.com/VladimirRadev/Stellar-LP-Staking.git
cd Stellar-LP-Staking
forge build
forge test
```

Deploy (needs the VLAD admin key, ≥ 200 VLAD and ≥ 0.002 ETH plus gas on the deployer):

```bash
export PRIVATE_KEY=...            # never commit; .env* is git-ignored
export VLAD_TOKEN=0x...           # VladToken address from Stellar-Faucet
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify
```

The script deploys the pool, deploys the farm at 0.01 VLAD/s, grants the farm `MINTER_ROLE`, and seeds the pool
with 0.002 ETH + 200 VLAD (opening price 1 ETH = 100,000 VLAD).

## Part of the Stellar suite

| Repo | Site |
|---|---|
| [Stellar-Faucet](https://github.com/VladimirRadev/Stellar-Faucet) | https://vladimirradev.github.io/Stellar-Faucet/ |
| [Stellar-LP-Staking](https://github.com/VladimirRadev/Stellar-LP-Staking) | https://vladimirradev.github.io/Stellar-LP-Staking/ |
| [Stellar-Bank](https://github.com/VladimirRadev/Stellar-Bank) | https://vladimirradev.github.io/Stellar-Bank/ |
| [Stellar-Store](https://github.com/VladimirRadev/Stellar-Store) | https://vladimirradev.github.io/Stellar-Store/ |
| [Stellar-Arena](https://github.com/VladimirRadev/Stellar-Arena) | https://vladimirradev.github.io/Stellar-Arena/ |

## License

MIT
