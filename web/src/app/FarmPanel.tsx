import { useState } from 'react'
import { stellarFarmAbi, stellarPoolAbi } from '../abi'
import { useConnection } from 'wagmi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { ArrowIcon } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { StatTile } from '../shell/StatTile'
import { Tabs } from '../shell/Tabs'
import { TxButton } from '../shell/TxButton'
import {
  DEPLOYED,
  LP_ERRORS,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  formatPct,
  parseAmount,
  pct,
  useSettled,
  useTicker,
  usePoolState,
  useUserState,
} from './lib'
import { AmountField, InfoTip, Note, StepLabel } from './ui'

type Mode = 'deposit' | 'withdraw'
const MODES = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
] as const satisfies readonly { key: Mode; label: string }[]

/**
 * Pending rewards between refetches: the on-chain value at the block's timestamp, plus this wallet's share of
 * `rewardPerSecond` for every millisecond since that block. Re-rendered 10 times per second.
 */
function LivePending({
  pending,
  blockTimestamp,
  perSecond,
  digits = 6,
}: {
  pending: bigint | undefined
  blockTimestamp: bigint | undefined
  perSecond: bigint
  digits?: number
}) {
  const now = useTicker(100)
  if (pending === undefined) return <>—</>
  const elapsedMs = blockTimestamp ? Math.min(Math.max(0, now - Number(blockTimestamp) * 1000), 120_000) : 0
  return <>{formatToken(pending + (perSecond * BigInt(Math.floor(elapsedMs))) / 1000n, 18, digits)}</>
}

export function FarmPanel({ onGoToPool }: { onGoToPool: () => void }) {
  const p = usePoolState()
  const user = useUserState()
  const [mode, setMode] = useState<Mode>('deposit')

  const { isConnected, chainId } = useConnection()
  const onSepolia = isConnected && chainId === CHAIN_ID
  const connected = !!user.address
  const staked = user.staked ?? 0n
  const totalStaked = p.totalStaked ?? 0n
  const rate = p.rewardPerSecond ?? 0n
  const myPerSecond = totalStaked > 0n ? (rate * staked) / totalStaked : 0n
  const farmShare = connected ? pct(staked, totalStaked) : undefined

  // Value of all staked sLP in VLAD: one sLP is worth 2 × its VLAD side (the ETH side is worth the same at spot).
  const stakedValueVlad =
    p.lpSupply && p.reserveVlad !== undefined ? (2n * p.reserveVlad * totalStaked) / p.lpSupply : undefined
  const apr =
    stakedValueVlad && stakedValueVlad > 0n ? Number((rate * SECONDS_PER_YEAR * 10_000n) / stakedValueVlad) / 100 : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-2 content-start gap-3">
        <StatTile
          label="Your staked sLP"
          value={connected ? formatToken(staked, 18, 4) : '—'}
          unit="sLP"
          loading={user.isLoading}
          hint={connected ? `${formatPct(farmShare, 2)} of the farm` : 'connect a wallet'}
        />
        <StatTile
          label="Pending rewards"
          value={
            connected ? (
              <LivePending
                pending={user.pending}
                blockTimestamp={user.blockTimestamp}
                perSecond={myPerSecond}
                digits={4}
              />
            ) : (
              '—'
            )
          }
          unit="VLAD"
          loading={user.isLoading}
          highlight
          hint={connected ? `+${formatToken(myPerSecond * SECONDS_PER_DAY, 18, 2)} VLAD per day` : 'connect a wallet'}
        />
        <StatTile
          label="Total staked"
          value={formatToken(p.totalStaked, 18, 4)}
          unit="sLP"
          loading={p.isLoading}
          hint={p.lpSupply ? `${formatPct(pct(totalStaked, p.lpSupply))} of all sLP` : undefined}
        />
        <StatTile
          label="Reward rate"
          value={p.rewardPerSecond !== undefined ? formatToken(rate * SECONDS_PER_DAY, 18, 2) : '—'}
          unit="VLAD/day"
          loading={p.isLoading}
          hint={p.rewardPerSecond !== undefined ? `${formatToken(rate, 18, 4)} VLAD per second` : undefined}
        />
        <div className="relative col-span-2">
          <StatTile
            label="Estimated APR"
            value={apr !== undefined ? formatPct(apr, 1) : totalStaked === 0n && DEPLOYED ? '∞' : '—'}
            loading={p.isLoading}
            highlight
            hint={
              apr !== undefined
                ? 'paid in VLAD · same for every staker'
                : DEPLOYED
                  ? 'nobody is staking yet: the first staker earns every reward'
                  : 'needs the deployed pool and farm'
            }
          />
          <InfoTip label="How the APR is estimated" className="absolute right-4 top-4 sm:right-5 sm:top-5">
              <span className="block font-semibold text-text">How the APR is estimated</span>
              <span className="mt-1.5 block">
                APR = (VLAD you earn per year) ÷ (value of your staked sLP in VLAD).
              </span>
              <span className="mt-1.5 block font-mono text-[0.7rem] text-accent-2">
                earned/yr = rewardPerSecond × 31,536,000 × yourStake ÷ totalStaked
              </span>
              <span className="mt-1 block font-mono text-[0.7rem] text-accent-2">
                value = 2 × reserveVlad × yourStake ÷ sLP supply
              </span>
              <span className="mt-1.5 block">
                Each sLP holds an ETH side and a VLAD side of equal value at the spot price, so its value in VLAD is
                twice its VLAD side. Your stake cancels out, so every staker sees the same APR. It ignores price moves
                and changes in total staked.
              </span>
          </InfoTip>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Farm</p>
            <h3 className="mt-1 text-xl font-semibold">Stake sLP, earn VLAD</h3>
          </div>
          <Tabs tabs={MODES} value={mode} onChange={setMode} label="Farm action" />
        </div>

        <div className="mt-5">
          {mode === 'deposit' ? <Deposit onGoToPool={onGoToPool} /> : <Withdraw />}
        </div>

        <div className="mt-6 border-t border-border/70 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">Pending rewards</p>
              <p className="mt-1 truncate font-mono text-2xl font-semibold tabular-nums text-accent-2">
                {connected ? (
                  <LivePending pending={user.pending} blockTimestamp={user.blockTimestamp} perSecond={myPerSecond} />
                ) : (
                  '—'
                )}{' '}
                <span className="text-sm text-muted">VLAD</span>
              </p>
            </div>
          </div>
          {/* The deposit/withdraw form above already shows the connect or switch-network prompt. */}
          {onSepolia ? (
            <div className="mt-3">
              <TxButton
                request={{ address: addresses.farm, abi: stellarFarmAbi, functionName: 'harvest' }}
                disabled={!DEPLOYED || !user.pending || user.pending === 0n}
                errorMessages={LP_ERRORS}
                className="h-12 w-full"
              >
                Harvest VLAD
              </TxButton>
              <EmergencyWithdraw staked={staked} pending={user.pending} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Deposit({ onGoToPool }: { onGoToPool: () => void }) {
  const user = useUserState()
  const [text, setText] = useState('')
  const amount = parseAmount(text) ?? 0n
  const rawExceeds = user.lpBalance !== undefined && amount > user.lpBalance
  const rawNeedsApproval = amount > 0n && (user.lpAllowance ?? 0n) < amount
  const settled = useSettled(text, amount > 0n && !rawExceeds && !rawNeedsApproval)
  const exceeds = rawExceeds && !settled
  const needsApproval = rawNeedsApproval && !settled
  const ready = DEPLOYED && amount > 0n && !exceeds
  const noLp = !!user.address && user.lpBalance === 0n

  return (
    <div className="space-y-4">
      <AmountField
        label="sLP to stake"
        symbol="sLP"
        value={text}
        onChange={setText}
        balance={user.lpBalance}
        balanceLabel="Wallet"
        max={user.lpBalance}
        error={exceeds ? 'Exceeds your sLP wallet balance.' : undefined}
        hint="Depositing also pays out any pending rewards."
      />
      {noLp ? (
        <Note>
          You have no sLP yet.{' '}
          <button type="button" className="link inline-flex items-center gap-1 font-medium" onClick={onGoToPool}>
            Add liquidity in the Pool tab <ArrowIcon size={13} />
          </button>
        </Note>
      ) : null}
      <NetworkGate connectMessage="Connect MetaMask to stake sLP.">
        {needsApproval ? (
          <div>
            <StepLabel step={1} total={2}>
              Allow the farm to take {formatToken(amount, 18, 4)} sLP
            </StepLabel>
            <TxButton
              key="approve"
              request={{
                address: addresses.pool,
                abi: stellarPoolAbi,
                functionName: 'approve',
                args: [addresses.farm, amount],
              }}
              disabled={!ready}
              errorMessages={LP_ERRORS}
              className="h-12 w-full"
            >
              Approve sLP
            </TxButton>
          </div>
        ) : (
          <div>
            {ready ? (
              <StepLabel step={2} total={2}>
                Allowance ready · stake
              </StepLabel>
            ) : null}
            <TxButton
              key="deposit"
              request={{ address: addresses.farm, abi: stellarFarmAbi, functionName: 'deposit', args: [amount] }}
              disabled={!ready}
              errorMessages={LP_ERRORS}
              onConfirmed={() => setText('')}
              className="h-12 w-full text-base"
            >
              {!DEPLOYED ? 'Farm not deployed yet' : amount === 0n ? 'Enter an sLP amount' : 'Deposit sLP'}
            </TxButton>
          </div>
        )}
      </NetworkGate>
    </div>
  )
}

function Withdraw() {
  const user = useUserState()
  const [text, setText] = useState('')
  const amount = parseAmount(text) ?? 0n
  const staked = user.staked ?? 0n
  const rawExceeds = user.staked !== undefined && amount > staked
  const settled = useSettled(text, amount > 0n && !rawExceeds)
  const exceeds = rawExceeds && !settled
  const ready = DEPLOYED && amount > 0n && !exceeds

  return (
    <div className="space-y-4">
      <AmountField
        label="sLP to unstake"
        symbol="sLP"
        value={text}
        onChange={setText}
        balance={user.staked}
        balanceLabel="Staked"
        max={user.staked}
        error={exceeds ? 'More than you have staked.' : undefined}
        hint="Withdrawing also pays out any pending rewards."
      />
      <NetworkGate connectMessage="Connect MetaMask to unstake sLP.">
        <TxButton
          request={{ address: addresses.farm, abi: stellarFarmAbi, functionName: 'withdraw', args: [amount] }}
          disabled={!ready}
          errorMessages={LP_ERRORS}
          onConfirmed={() => setText('')}
          className="h-12 w-full text-base"
        >
          {!DEPLOYED ? 'Farm not deployed yet' : amount === 0n ? 'Enter an sLP amount' : 'Withdraw sLP'}
        </TxButton>
      </NetworkGate>
    </div>
  )
}

/** Exit without rewards. Hidden behind an explicit confirmation because it forfeits everything pending. */
function EmergencyWithdraw({ staked, pending }: { staked: bigint; pending: bigint | undefined }) {
  const [open, setOpen] = useState(false)
  const [understood, setUnderstood] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        className="mt-3 w-full text-center text-xs text-muted underline-offset-4 transition hover:text-danger hover:underline disabled:opacity-40"
        disabled={staked === 0n}
        onClick={() => setOpen(true)}
      >
        Emergency withdraw…
      </button>
    )
  }

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-danger/30 bg-danger/[0.05] p-4">
      <p className="font-display font-semibold text-danger">Emergency withdraw</p>
      <p className="text-sm leading-relaxed text-text/85">
        Returns all {formatToken(staked, 18, 4)} staked sLP at once and <strong>forfeits</strong>{' '}
        {pending !== undefined ? `${formatToken(pending, 18, 4)} VLAD of` : 'all'} pending rewards. It never mints, so
        it works even if the farm loses MINTER_ROLE. Use it only when a normal withdraw fails.
      </p>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text/90">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-danger)]"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        I understand that my pending rewards are lost.
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="sm:flex-1">
          <TxButton
            request={{ address: addresses.farm, abi: stellarFarmAbi, functionName: 'emergencyWithdraw' }}
            disabled={!DEPLOYED || !understood || staked === 0n}
            errorMessages={LP_ERRORS}
            onConfirmed={() => {
              setOpen(false)
              setUnderstood(false)
            }}
            className="w-full bg-none bg-danger text-bg shadow-none hover:shadow-none"
          >
            Withdraw and forfeit rewards
          </TxButton>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false)
            setUnderstood(false)
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
