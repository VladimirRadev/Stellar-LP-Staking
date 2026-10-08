# Stellar Swap & LP Staking — ETH/VLAD AMM + farm (Sepolia)

**Live app:** https://vladimirradev.github.io/Stellar-LP-Staking/

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

## Web app

**Live:** https://vladimirradev.github.io/Stellar-LP-Staking/

A React 19 + wagmi 3 + viem single-page app in `web/`, built on the shared Stellar scaffold
(`web/src/shell/` is byte-identical across the five Stellar repos). MetaMask only, Sepolia only, no backend.

| Tab | What it does |
|---|---|
| **Swap** | ETH → VLAD or VLAD → ETH. The quote is computed in the browser from `getReserves()` with the same formula as `getAmountOut`. Shows rate, price impact, LP fee, slippage tolerance (default 0.5%) and the resulting `minOut`. VLAD → ETH runs an Approve step first. After confirmation it shows the amounts from the `Swap` event and the new reserves from the `Sync` event. |
| **Pool** | Reserves, spot price both ways, TVL in ETH-equivalent, sLP supply, your sLP and pool share. Add liquidity: enter ETH, `quoteAddLiquidity` returns the VLAD needed and the sLP out; the app approves VLAD (+0.5% buffer) and calls `addLiquidity` with `minLp` = 99.5%. Remove liquidity: enter sLP, the app shows the pro-rata ETH/VLAD and sends 0.5% slippage minimums. |
| **Farm** | Your stake, pending VLAD (refetched every 8 s and interpolated every 100 ms from `rewardPerSecond` and your share), total staked, reward rate per day and an estimated APR. Approve sLP → Deposit, Withdraw, Harvest, and Emergency withdraw behind a confirmation. |

Custom errors (`Slippage`, `InsufficientLiquidity`, `ZeroAmount`, `InsufficientStake`, ...) are decoded into readable
sentences before the wallet opens, because every transaction is simulated first.

Run it locally (Node 22.12+):

```bash
forge build                 # the ABIs come from out/
cd web
npm ci
npm run sync-abi            # copies StellarPool, StellarFarm and IVladToken ABIs into src/abi/
npm run dev
```

Contract addresses live in `web/src/config/addresses.ts`. While they are the zero address the page shows a
"not deployed yet" banner and switches on-chain reads off. GitHub Pages deploys `web/` on every push to `main`
(`.github/workflows/pages.yml`).

## Deployed addresses (Sepolia, chain id 11155111)

| Contract | Address | Deploy tx |
|---|---|---|
| VladToken ($VLAD) | [`0x49ba857d553ef219B144b200F41acaf8CB6768E9`](https://eth-sepolia.blockscout.com/address/0x49ba857d553ef219B144b200F41acaf8CB6768E9) | [`0x3b24505f…f9f5d3`](https://eth-sepolia.blockscout.com/tx/0x3b24505f6310f9ee43a43465e923814519b6e66197674b612910591aa0f9f5d3) (Stellar-Faucet) |
| StellarPool (sLP) | [`0xAC08AA11850cf015160A93DAD746CA480407b7Ae`](https://eth-sepolia.blockscout.com/address/0xAC08AA11850cf015160A93DAD746CA480407b7Ae) | [`0x004b3b12…5e4f3e`](https://eth-sepolia.blockscout.com/tx/0x004b3b127807d35cfa28a817fccf409c82c1461095bb44809ef5de42055e4f3e) |
| StellarFarm | [`0x7b4B7137992625F98d4A3436D52366FfA84EC3DE`](https://eth-sepolia.blockscout.com/address/0x7b4B7137992625F98d4A3436D52366FfA84EC3DE) | [`0xf8bc1221…80f6b8`](https://eth-sepolia.blockscout.com/tx/0xf8bc1221ddcbd823219c3992f631d9339c24287860046cd75e439a9c7780f6b8) |

`MINTER_ROLE` was granted to the farm in tx [`0xf23b75b3…c5d613`](https://eth-sepolia.blockscout.com/tx/0xf23b75b37aeed36556217120b9fad675046724be820370cc31bf0537fec5d613). The pool was seeded with 0.02 ETH + 2000 VLAD
(opening price 1 ETH = 100,000 VLAD) in tx [`0x61c19ab1…69547d`](https://eth-sepolia.blockscout.com/tx/0x61c19ab1f9cba45c8e96c29b7bf7b63ed7956a0fcf6713f70b89e1d2cd69547d). Both contracts are verified on Sourcify (exact match)
and Blockscout. Blocks, gas and costs are in [`deployments/sepolia.json`](deployments/sepolia.json).

## Development

```bash
git clone --recurse-submodules https://github.com/VladimirRadev/Stellar-LP-Staking.git
cd Stellar-LP-Staking
forge build
forge test
```

Deploy (needs the VLAD admin key, at least 2000 VLAD, and 0.02 ETH plus gas on the deployer):

```bash
set -a; source /path/to/deployer.env; set +a   # PRIVATE_KEY lives outside the repo; .env* is git-ignored
export VLAD_TOKEN=0x49ba857d553ef219B144b200F41acaf8CB6768E9
forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --slow --skip-simulation -vvv
```

The script sends exactly five transactions: deploy the pool, deploy the farm at 0.0001 VLAD/s (8.64 VLAD/day),
grant the farm `MINTER_ROLE`, approve 2000 VLAD, and seed the pool with 0.02 ETH + 2000 VLAD
(opening price 1 ETH = 100,000 VLAD).

- `--skip-simulation`: Sepolia's current fork prices contract creation far above forge's local simulation, so the
  gas limits are taken from the Sepolia node instead.
- `--slow`: the deployer is an EIP-7702 delegated account and nodes accept only one in-flight transaction for it.
  If a transaction is rejected with "in-flight transaction limit reached", wait ~20 s and rerun with `--resume`.

**Farm economics.** 0.0001 VLAD/s is 3,153.6 VLAD per year. The seed pool is worth 2 × 2000 = 4,000 VLAD, so while
all seed sLP is staked the estimated APR is 3,153.6 / 4,000 ≈ 79%. The APR falls as more liquidity is staked.

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
