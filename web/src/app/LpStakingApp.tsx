import { useState } from 'react'
import { formatToken } from '../shell/format'
import { ArrowIcon, StarGlyph } from '../shell/icons'
import { getSite } from '../shell/sites'
import { Tabs } from '../shell/Tabs'
import { FarmPanel } from './FarmPanel'
import { DEPLOYED, SECONDS_PER_DAY, formatPrice, toFloat, usePoolState } from './lib'
import { PoolPanel } from './PoolPanel'
import { SwapPanel } from './SwapPanel'
import { TokenIcon } from './ui'

const TABS = [
  { key: 'swap', label: 'Swap' },
  { key: 'pool', label: 'Pool' },
  { key: 'farm', label: 'Farm' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** The tab comes from the URL hash (#swap, #pool, #farm) so other Stellar apps can deep-link. */
function initialTab(): TabKey {
  const hash = window.location.hash.slice(1)
  return TABS.find((t) => t.key === hash)?.key ?? 'swap'
}

export function LpStakingApp() {
  const [tab, setTab] = useState<TabKey>(initialTab)

  function changeTab(key: TabKey) {
    setTab(key)
    window.history.replaceState(null, '', `#${key}`)
  }

  return (
    <div className="space-y-12 sm:space-y-16">
      {!DEPLOYED ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-warning">
          Contracts are not deployed yet. The addresses in <code className="font-mono">config/addresses.ts</code> are
          placeholders, so on-chain reads are switched off.
        </div>
      ) : null}

      <section className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        <div className="min-w-0 pt-2">
          <p className="eyebrow inline-flex items-center gap-2">
            <StarGlyph size={12} /> Stellar suite · AMM + farm
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Swap, pool &amp; farm{' '}
            <span className="bg-gradient-to-r from-lime via-accent-2 to-accent bg-clip-text text-transparent">$VLAD</span>
          </h1>
          <p className="mt-5 max-w-xl text-[0.95rem] leading-relaxed text-muted">
            A constant-product ETH/VLAD exchange with a 0.30% fee. Add liquidity to receive sLP, the pool&apos;s own LP
            token that earns the swap fees, then stake sLP in the farm to earn freshly minted VLAD every second. Everything
            runs on the Ethereum Sepolia testnet.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {['x · y = k', '0.30% swap fee', 'sLP = LP token', 'VLAD minted per second'].map((label) => (
              <span key={label} className="chip font-mono text-xs text-text/85">
                {label}
              </span>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#app" className="btn btn-primary" onClick={() => changeTab('swap')}>
              Start swapping <ArrowIcon size={16} />
            </a>
            <a href="#app" className="btn btn-ghost" onClick={() => changeTab('farm')}>
              Go to the farm
            </a>
          </div>
        </div>

        <MarketCard />
      </section>

      <section id="app" aria-labelledby="app-heading" className="scroll-mt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Trade &amp; earn</p>
            <h2 id="app-heading" className="mt-2 text-2xl font-semibold sm:text-3xl">
              {tab === 'swap' ? 'Swap' : tab === 'pool' ? 'Provide liquidity' : 'Liquidity mining'}
            </h2>
          </div>
          <Tabs tabs={TABS} value={tab} onChange={changeTab} label="Choose a section" />
        </div>
        <div className="mt-6">
          {tab === 'swap' ? <SwapPanel /> : tab === 'pool' ? <PoolPanel /> : <FarmPanel onGoToPool={() => changeTab('pool')} />}
        </div>
      </section>

      <HowItWorks />
    </div>
  )
}

function MarketCard() {
  const p = usePoolState()
  const spot = p.reserveEth && p.reserveVlad !== undefined ? toFloat(p.reserveVlad) / toFloat(p.reserveEth) : undefined
  const inverse = p.reserveVlad && p.reserveEth !== undefined ? toFloat(p.reserveEth) / toFloat(p.reserveVlad) : undefined

  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/20 blur-3xl"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Live market</p>
        <span className="font-mono text-xs text-muted">
          {p.lastUpdateBlock !== undefined ? `synced at block #${p.lastUpdateBlock.toString()}` : 'ETH / VLAD'}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="flex -space-x-2">
          <TokenIcon symbol="ETH" size={34} />
          <TokenIcon symbol="VLAD" size={34} />
        </span>
        <div className="min-w-0">
          {p.isLoading ? (
            <span className="skeleton h-8 w-48" />
          ) : (
            <p className="truncate font-mono text-2xl font-semibold tabular-nums sm:text-3xl">
              1 ETH = {formatPrice(spot)} <span className="text-base text-muted">VLAD</span>
            </p>
          )}
          <p className="mt-0.5 truncate font-mono text-xs text-muted">1 VLAD = {formatPrice(inverse)} ETH</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        <MarketStat label="ETH reserve" value={formatToken(p.reserveEth, 18, 6)} unit="ETH" loading={p.isLoading} />
        <MarketStat label="VLAD reserve" value={formatToken(p.reserveVlad)} unit="VLAD" loading={p.isLoading} />
        <MarketStat
          label="TVL (ETH-eq.)"
          value={p.reserveEth !== undefined ? formatToken(2n * p.reserveEth, 18, 6) : '—'}
          unit="ETH"
          loading={p.isLoading}
        />
        <MarketStat
          label="Farm emits"
          value={p.rewardPerSecond !== undefined ? formatToken(p.rewardPerSecond * SECONDS_PER_DAY, 18, 0) : '—'}
          unit="VLAD/day"
          loading={p.isLoading}
        />
      </dl>
      <p className="mt-4 text-xs text-muted">Reserves refresh every 12 seconds. Spot price = VLAD reserve ÷ ETH reserve.</p>
    </div>
  )
}

function MarketStat({ label, value, unit, loading }: { label: string; value: string; unit: string; loading: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-bg/40 p-3.5">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
        {loading ? (
          <span className="skeleton h-6 w-20" />
        ) : (
          <span className="truncate font-mono text-lg font-semibold tabular-nums">{value}</span>
        )}
        <span className="shrink-0 text-xs text-muted">{unit}</span>
      </dd>
    </div>
  )
}

const HOW_IT_WORKS = [
  {
    title: 'Constant product',
    formula: 'x · y = k\nout = in·9970·R_out\n  / (R_in·10000 + in·9970)',
    text: 'The pool holds ETH (x) and VLAD (y). A swap must keep their product k from falling, so the price moves along the curve as the reserves change. Reserves are tracked inside the contract, never read from balances.',
  },
  {
    title: '0.30% fee',
    formula: 'FEE_BPS = 30\nk_after ≥ k_before',
    text: 'Every swap leaves 0.30% of the input in the pool. Nobody withdraws the fee separately: it raises the reserves, so each sLP token redeems for slightly more ETH and VLAD over time.',
  },
  {
    title: 'sLP, the LP token',
    formula: 'first: √(eth·vlad) − 1000\nlater: eth·supply / R_eth',
    text: 'The pool contract is itself the ERC-20 LP token. The first deposit locks 1000 wei of sLP at 0x…dEaD forever. Removing liquidity burns sLP and returns your pro-rata share of both reserves.',
  },
  {
    title: 'MasterChef accounting',
    formula: 'acc += dt·rate·1e18\n       / totalStaked\npending = amount·acc\n  / 1e18 − rewardDebt',
    text: 'The farm streams rewardPerSecond VLAD across all staked sLP. Each deposit, withdraw or harvest settles your share and resets rewardDebt. Rewards are minted by the farm, which holds MINTER_ROLE on VLAD.',
  },
] as const

function HowItWorks() {
  const bank = getSite('bank')
  return (
    <section aria-labelledby="how-it-works">
      <div className="card p-5 sm:p-8">
        <p className="eyebrow">How it works</p>
        <h2 id="how-it-works" className="mt-2 text-2xl font-semibold sm:text-3xl">
          Four ideas behind the pool and the farm
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item, i) => (
            <div key={item.title} className="flex min-w-0 flex-col rounded-2xl border border-border/80 bg-bg/40 p-4">
              <span className="font-mono text-xs text-accent-2">0{i + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-bg/70 p-3 font-mono text-[0.72rem] leading-relaxed text-accent-2">
                {item.formula}
              </pre>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-text/90">The AMM spot price is also the demo price feed for Stellar Bank.</p>
          <a className="link inline-flex shrink-0 items-center gap-1 font-medium" href={bank.url}>
            Open {bank.name} <ArrowIcon size={14} />
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          A spot price from one small pool can be moved by a single large swap, which is fine for a testnet demo but
          not for a production lender.
        </p>
      </div>
    </section>
  )
}
