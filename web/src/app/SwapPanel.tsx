import { useState } from 'react'
import { parseEventLogs, type Hash } from 'viem'
import { useTransactionReceipt } from 'wagmi'
import { iVladTokenAbi, stellarPoolAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { CheckIcon } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { Tabs } from '../shell/Tabs'
import { TxButton } from '../shell/TxButton'
import {
  DEPLOYED,
  FEE_BPS,
  GAS_RESERVE,
  LP_ERRORS,
  applySlippage,
  formatPct,
  formatPrice,
  getAmountOut,
  parseAmount,
  sanitizeAmount,
  toFloat,
  toInputString,
  usePoolState,
  useSettled,
  useUserState,
} from './lib'
import { AmountField, DetailRow, Details, Note, StepLabel, TokenIcon, type TokenSymbol } from './ui'

type Direction = 'ethToVlad' | 'vladToEth'

const DIRECTIONS = [
  { key: 'ethToVlad', label: 'ETH → VLAD' },
  { key: 'vladToEth', label: 'VLAD → ETH' },
] as const satisfies readonly { key: Direction; label: string }[]

const SLIPPAGE_PRESETS = [10, 50, 100] as const // basis points: 0.1%, 0.5%, 1%

const fmt = (value: bigint) => formatPrice(toFloat(value))

export function SwapPanel() {
  const { reserveEth, reserveVlad } = usePoolState()
  const user = useUserState()

  const [direction, setDirection] = useState<Direction>('ethToVlad')
  const [amount, setAmount] = useState('')
  const [presetBps, setPresetBps] = useState<number>(50)
  const [customSlippage, setCustomSlippage] = useState('')
  const [lastSwap, setLastSwap] = useState<Hash>()

  const ethIn = direction === 'ethToVlad'
  const inSymbol: TokenSymbol = ethIn ? 'ETH' : 'VLAD'
  const outSymbol: TokenSymbol = ethIn ? 'VLAD' : 'ETH'
  const reserveIn = ethIn ? reserveEth : reserveVlad
  const reserveOut = ethIn ? reserveVlad : reserveEth
  const hasReserves = reserveIn !== undefined && reserveOut !== undefined && reserveIn > 0n && reserveOut > 0n

  const amountIn = parseAmount(amount) ?? 0n
  const amountOut = hasReserves ? getAmountOut(amountIn, reserveIn, reserveOut) : undefined

  const customValue = Number(customSlippage)
  const customValid = customSlippage !== '' && customValue > 0 && customValue <= 50
  const slippageBps = customValid ? Math.round(customValue * 100) : presetBps
  const minOut = amountOut !== undefined ? applySlippage(amountOut, BigInt(slippageBps)) : undefined

  const balance = ethIn ? user.ethBalance : user.vladBalance
  const max = balance === undefined ? undefined : ethIn ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance
  const rawExceeds = balance !== undefined && amountIn > balance

  // Price impact without the fee: amountInAfterFee / (reserveIn + amountInAfterFee).
  const inAfterFee = (amountIn * (10_000n - FEE_BPS)) / 10_000n
  const impact =
    hasReserves && amountIn > 0n ? Number((inAfterFee * 1_000_000n) / (reserveIn + inAfterFee)) / 10_000 : undefined
  const execRate = amountIn > 0n && amountOut ? toFloat(amountOut) / toFloat(amountIn) : undefined
  const fee = (amountIn * FEE_BPS) / 10_000n
  const rawNeedsApproval = !ethIn && amountIn > 0n && (user.vladAllowance ?? 0n) < amountIn
  const settled = useSettled(`${direction}:${amount}`, amountIn > 0n && !rawExceeds && !rawNeedsApproval)
  const exceeds = rawExceeds && !settled
  const needsApproval = rawNeedsApproval && !settled

  const canSwap = DEPLOYED && hasReserves && amountIn > 0n && !!amountOut && amountOut > 0n && !exceeds
  const impactTone = impact === undefined ? undefined : impact >= 15 ? 'danger' : impact >= 5 ? 'warn' : undefined

  function flip() {
    setDirection(ethIn ? 'vladToEth' : 'ethToVlad')
    setAmount('')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Swap</p>
            <h3 className="mt-1 text-xl font-semibold">Trade ETH and VLAD</h3>
          </div>
          <Tabs
            tabs={DIRECTIONS}
            value={direction}
            onChange={(d) => {
              setDirection(d)
              setAmount('')
            }}
            label="Swap direction"
          />
        </div>

        <div className="mt-5">
          <AmountField
            label="You pay"
            symbol={inSymbol}
            value={amount}
            onChange={setAmount}
            balance={balance}
            max={max}
            error={exceeds ? `Exceeds your ${inSymbol} balance.` : undefined}
            hint={ethIn && max !== undefined ? 'MAX keeps 0.001 ETH for gas.' : undefined}
          />
          <div className="relative z-10 -my-2.5 flex justify-center">
            <button
              type="button"
              onClick={flip}
              aria-label="Flip swap direction"
              className="grid size-10 place-items-center rounded-xl border border-border bg-surface-2 text-muted shadow-card transition hover:rotate-180 hover:border-accent-2/50 hover:text-accent-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
              </svg>
            </button>
          </div>
          <AmountField
            label="You receive (estimated)"
            symbol={outSymbol}
            value={amountOut && amountOut > 0n ? toInputString(amountOut) : ''}
            readOnly
            balance={ethIn ? user.vladBalance : user.ethBalance}
          />
        </div>

        <SlippageControl
          presetBps={presetBps}
          onPreset={(bps) => {
            setPresetBps(bps)
            setCustomSlippage('')
          }}
          custom={customSlippage}
          onCustom={setCustomSlippage}
          customValid={customValid}
          effectiveBps={slippageBps}
        />

        <div className="mt-4">
          <Details>
            <DetailRow label="Rate">
              {execRate !== undefined ? `1 ${inSymbol} = ${formatPrice(execRate)} ${outSymbol}` : '—'}
            </DetailRow>
            <DetailRow label="Price impact" tone={impactTone}>
              {formatPct(impact)}
            </DetailRow>
            <DetailRow label="LP fee (0.30%)">
              {amountIn > 0n ? `${formatToken(fee, 18, 6)} ${inSymbol}` : '—'}
            </DetailRow>
            <DetailRow label={`Minimum received (−${slippageBps / 100}%)`}>
              {minOut !== undefined && amountIn > 0n ? `${formatToken(minOut, 18, 6)} ${outSymbol}` : '—'}
            </DetailRow>
          </Details>
        </div>

        {impactTone === 'danger' ? (
          <div className="mt-3">
            <Note tone="danger">
              This trade moves the price by {formatPct(impact)}. The pool is small, so try a smaller amount.
            </Note>
          </div>
        ) : null}

        <div className="mt-5">
          <NetworkGate connectMessage="Connect MetaMask to swap on Sepolia.">
            {needsApproval ? (
              <div>
                <StepLabel step={1} total={2}>
                  Allow the pool to take {formatToken(amountIn, 18, 4)} VLAD
                </StepLabel>
                <TxButton
                  key="approve"
                  request={{
                    address: addresses.vladToken,
                    abi: iVladTokenAbi,
                    functionName: 'approve',
                    args: [addresses.pool, amountIn],
                  }}
                  disabled={!canSwap}
                  errorMessages={LP_ERRORS}
                  className="h-12 w-full"
                >
                  Approve VLAD
                </TxButton>
              </div>
            ) : (
              <div>
                {!ethIn && amountIn > 0n ? (
                  <StepLabel step={2} total={2}>
                    Allowance ready · swap
                  </StepLabel>
                ) : null}
                <TxButton
                  key={`swap-${direction}`}
                  request={
                    ethIn
                      ? {
                          address: addresses.pool,
                          abi: stellarPoolAbi,
                          functionName: 'swapEthForVlad',
                          args: [minOut ?? 0n],
                          value: amountIn,
                        }
                      : {
                          address: addresses.pool,
                          abi: stellarPoolAbi,
                          functionName: 'swapVladForEth',
                          args: [amountIn, minOut ?? 0n],
                        }
                  }
                  disabled={!canSwap}
                  errorMessages={LP_ERRORS}
                  onConfirmed={(hash) => {
                    setLastSwap(hash)
                    setAmount('')
                  }}
                  className="h-12 w-full text-base"
                >
                  {!DEPLOYED
                    ? 'Pool not deployed yet'
                    : amountIn === 0n
                      ? 'Enter an amount'
                      : exceeds
                        ? `Insufficient ${inSymbol}`
                        : `Swap ${inSymbol} for ${outSymbol}`}
                </TxButton>
              </div>
            )}
          </NetworkGate>
        </div>

        {lastSwap ? <SwapResult hash={lastSwap} /> : null}
      </div>

      <QuoteBreakdown
        ethIn={ethIn}
        amountIn={amountIn}
        amountOut={amountOut}
        reserveEth={reserveEth}
        reserveVlad={reserveVlad}
      />
    </div>
  )
}

function SlippageControl({
  presetBps,
  onPreset,
  custom,
  onCustom,
  customValid,
  effectiveBps,
}: {
  presetBps: number
  onPreset: (bps: number) => void
  custom: string
  onCustom: (value: string) => void
  customValid: boolean
  effectiveBps: number
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="text-sm text-muted">Slippage tolerance</span>
      <div className="flex items-center gap-1.5">
        {SLIPPAGE_PRESETS.map((bps) => {
          const active = !customValid && presetBps === bps
          return (
            <button
              key={bps}
              type="button"
              aria-pressed={active}
              onClick={() => onPreset(bps)}
              className={`h-8 rounded-lg border px-2.5 font-mono text-xs transition ${
                active
                  ? 'border-accent-2/60 bg-accent/15 text-accent-2'
                  : 'border-border bg-surface/60 text-muted hover:text-text'
              }`}
            >
              {bps / 100}%
            </button>
          )
        })}
        <label
          className={`flex h-8 w-[5.5rem] items-center rounded-lg border px-2 font-mono text-xs ${
            customValid ? 'border-accent-2/60 bg-accent/15 text-accent-2' : 'border-border bg-surface/60 text-muted'
          }`}
        >
          <span className="sr-only">Custom slippage in percent</span>
          <input
            className="w-full min-w-0 bg-transparent text-right outline-none placeholder:text-muted/50"
            inputMode="decimal"
            placeholder="custom"
            value={custom}
            onChange={(e) => onCustom(sanitizeAmount(e.target.value, 2))}
          />
          <span className="pl-0.5">%</span>
        </label>
      </div>
      {effectiveBps > 500 ? (
        <p className="w-full text-xs text-warning">High tolerance: a front-runner could take up to {effectiveBps / 100}%.</p>
      ) : null}
    </div>
  )
}

/** The swap formula with the live numbers plugged in, and the pool state after the trade. */
function QuoteBreakdown({
  ethIn,
  amountIn,
  amountOut,
  reserveEth,
  reserveVlad,
}: {
  ethIn: boolean
  amountIn: bigint
  amountOut: bigint | undefined
  reserveEth: bigint | undefined
  reserveVlad: bigint | undefined
}) {
  const known = reserveEth !== undefined && reserveVlad !== undefined
  const trading = known && amountIn > 0n && amountOut !== undefined && amountOut > 0n
  const rIn = ethIn ? reserveEth : reserveVlad
  const rOut = ethIn ? reserveVlad : reserveEth
  const nextEth = trading ? (ethIn ? reserveEth + amountIn : reserveEth - amountOut) : reserveEth
  const nextVlad = trading ? (ethIn ? reserveVlad - amountOut : reserveVlad + amountIn) : reserveVlad
  const spot = known && reserveEth > 0n ? toFloat(reserveVlad) / toFloat(reserveEth) : undefined
  const nextSpot = nextEth && nextVlad ? toFloat(nextVlad) / toFloat(nextEth) : undefined
  const inSym = ethIn ? 'ETH' : 'VLAD'

  return (
    <div className="card flex flex-col p-4 sm:p-6">
      <p className="eyebrow">Quote breakdown</p>
      <h3 className="mt-1 text-xl font-semibold">How your quote is computed</h3>
      <p className="mt-2 text-sm text-muted">
        The quote is calculated in your browser from the pool reserves, with exactly the formula the contract uses in{' '}
        <code className="font-mono text-text/80">getAmountOut</code>.
      </p>

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border/80 bg-bg/60 p-3.5 font-mono text-[0.78rem] leading-relaxed text-text/90">
        <span className="text-muted">out = in × 9970 × R_out</span>
        {'\n'}
        <span className="text-muted">      / (R_in × 10000 + in × 9970)</span>
        {trading && rIn !== undefined && rOut !== undefined ? (
          <>
            {'\n\n'}
            <span className="text-accent-2">in</span> = {fmt(amountIn)} {inSym}
            {'\n'}
            <span className="text-accent-2">R_in</span> = {fmt(rIn)} · <span className="text-accent-2">R_out</span> ={' '}
            {fmt(rOut)}
            {'\n'}
            <span className="text-accent-2">out</span> = {fmt(amountOut)} {ethIn ? 'VLAD' : 'ETH'}
          </>
        ) : null}
      </pre>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <ReserveBox symbol="ETH" now={reserveEth} next={trading ? nextEth : undefined} />
        <ReserveBox symbol="VLAD" now={reserveVlad} next={trading ? nextVlad : undefined} />
      </div>

      <div className="mt-4">
        <Details>
          <DetailRow label="Spot price now">{spot !== undefined ? `1 ETH = ${formatPrice(spot)} VLAD` : '—'}</DetailRow>
          <DetailRow label="After your trade">
            {trading && nextSpot !== undefined ? `1 ETH = ${formatPrice(nextSpot)} VLAD` : '—'}
          </DetailRow>
          <DetailRow label="k = R_eth × R_vlad">
            {trading ? 'grows by the fee' : known ? 'constant without trades' : '—'}
          </DetailRow>
        </Details>
      </div>
    </div>
  )
}

function ReserveBox({ symbol, now, next }: { symbol: TokenSymbol; now: bigint | undefined; next: bigint | undefined }) {
  const up = next !== undefined && now !== undefined && next > now
  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-surface/40 p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <TokenIcon symbol={symbol} size={18} /> {symbol} reserve
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums">
        {now !== undefined ? fmt(now) : '—'}
      </p>
      {next !== undefined ? (
        <p className={`mt-0.5 truncate font-mono text-xs tabular-nums ${up ? 'text-accent-2' : 'text-warning'}`}>
          → {fmt(next)}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-muted/70">enter an amount</p>
      )}
    </div>
  )
}

/** After a confirmed swap: the amounts from the Swap event and the reserves from the Sync event. */
function SwapResult({ hash }: { hash: Hash }) {
  const receipt = useTransactionReceipt({ hash, chainId: CHAIN_ID })
  if (!receipt.data) return null
  const poolLogs = receipt.data.logs.filter((l) => l.address.toLowerCase() === addresses.pool.toLowerCase())
  const swap = parseEventLogs({ abi: stellarPoolAbi, logs: poolLogs, eventName: 'Swap' })[0]
  const sync = parseEventLogs({ abi: stellarPoolAbi, logs: poolLogs, eventName: 'Sync' })[0]
  if (!swap) return null

  const { ethIn, vladIn, ethOut, vladOut } = swap.args
  const soldEth = ethIn > 0n
  const paid = soldEth ? ethIn : vladIn
  const got = soldEth ? vladOut : ethOut
  const rate = paid > 0n ? toFloat(got) / toFloat(paid) : undefined

  return (
    <div className="mt-5 rounded-2xl border border-accent-2/30 bg-accent/[0.07] p-4 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 font-medium text-accent-2">
        <CheckIcon size={16} /> Swap confirmed
      </p>
      <p className="mt-2 text-text/90">
        You paid <span className="font-mono">{formatToken(paid, 18, 6)}</span> {soldEth ? 'ETH' : 'VLAD'} and received{' '}
        <span className="font-mono">{formatToken(got, 18, 6)}</span> {soldEth ? 'VLAD' : 'ETH'}.
      </p>
      {rate !== undefined ? (
        <p className="mt-1 text-muted">
          Effective rate: 1 {soldEth ? 'ETH' : 'VLAD'} = {formatPrice(rate)} {soldEth ? 'VLAD' : 'ETH'}
        </p>
      ) : null}
      {sync ? (
        <p className="mt-2 border-t border-accent-2/20 pt-2 text-muted">
          <span className="font-mono text-xs uppercase tracking-wider text-accent-2">Sync</span> · block #
          {receipt.data.blockNumber.toString()}: reserves are now{' '}
          <span className="font-mono text-text/90">{formatToken(sync.args.reserveEth, 18, 6)}</span> ETH and{' '}
          <span className="font-mono text-text/90">{formatToken(sync.args.reserveVlad, 18, 2)}</span> VLAD (1 ETH ={' '}
          {formatPrice(toFloat(sync.args.reserveVlad) / toFloat(sync.args.reserveEth))} VLAD).
        </p>
      ) : null}
    </div>
  )
}
