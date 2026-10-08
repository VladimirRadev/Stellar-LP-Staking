import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { iVladTokenAbi, stellarPoolAbi } from '../abi'
import { addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { NetworkGate } from '../shell/NetworkGate'
import { StatTile } from '../shell/StatTile'
import { Tabs } from '../shell/Tabs'
import { TxButton } from '../shell/TxButton'
import {
  DEPLOYED,
  GAS_RESERVE,
  LIQUIDITY_SLIPPAGE_BPS,
  LP_ERRORS,
  MINIMUM_LIQUIDITY,
  applySlippage,
  formatPct,
  formatPrice,
  parseAmount,
  pct,
  poolContract,
  sqrt,
  toFloat,
  toInputString,
  useDebounced,
  usePoolState,
  useSettled,
  useUserState,
} from './lib'
import { AmountField, DetailRow, Details, Note, StepLabel } from './ui'

type Mode = 'add' | 'remove'
const MODES = [
  { key: 'add', label: 'Add' },
  { key: 'remove', label: 'Remove' },
] as const satisfies readonly { key: Mode; label: string }[]

export function PoolPanel() {
  const p = usePoolState()
  const user = useUserState()
  const [mode, setMode] = useState<Mode>('add')

  const known = p.reserveEth !== undefined && p.reserveVlad !== undefined && p.lpSupply !== undefined
  const ethPerVlad = known && p.reserveVlad! > 0n ? toFloat(p.reserveEth!) / toFloat(p.reserveVlad!) : undefined
  const vladPerEth = known && p.reserveEth! > 0n ? toFloat(p.reserveVlad!) / toFloat(p.reserveEth!) : undefined
  const owned = (user.lpBalance ?? 0n) + (user.staked ?? 0n)
  const share = known && user.lpBalance !== undefined ? pct(owned, p.lpSupply!) : undefined
  const myEth = known && p.lpSupply! > 0n ? (owned * p.reserveEth!) / p.lpSupply! : undefined
  const myVlad = known && p.lpSupply! > 0n ? (owned * p.reserveVlad!) / p.lpSupply! : undefined
  const connected = !!user.address

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="ETH reserve" value={formatToken(p.reserveEth, 18, 6)} unit="ETH" loading={p.isLoading} />
          <StatTile label="VLAD reserve" value={formatToken(p.reserveVlad)} unit="VLAD" loading={p.isLoading} />
          <StatTile
            label="1 ETH in VLAD"
            value={formatPrice(vladPerEth)}
            unit="VLAD"
            loading={p.isLoading}
            hint="spot price"
          />
          <StatTile
            label="1 VLAD in ETH"
            value={formatPrice(ethPerVlad)}
            unit="ETH"
            loading={p.isLoading}
            hint="spot price"
          />
          <StatTile
            label="Pool TVL"
            value={p.reserveEth !== undefined ? formatToken(2n * p.reserveEth, 18, 6) : '—'}
            unit="ETH"
            loading={p.isLoading}
            hint="ETH-equivalent: 2 × ETH reserve"
          />
          <StatTile
            label="sLP total supply"
            value={formatToken(p.lpSupply, 18, 4)}
            unit="sLP"
            loading={p.isLoading}
            hint="incl. 1000 wei locked forever"
          />
          <StatTile
            label="Your sLP (wallet)"
            value={connected ? formatToken(user.lpBalance, 18, 4) : '—'}
            unit="sLP"
            loading={user.isLoading}
            hint={connected ? `+ ${formatToken(user.staked ?? 0n, 18, 4)} staked in the farm` : 'connect a wallet'}
          />
          <StatTile
            label="Your pool share"
            value={connected ? formatPct(share, 4) : '—'}
            loading={user.isLoading}
            highlight
            hint={connected ? 'wallet + staked sLP' : 'connect a wallet'}
          />
        </div>

        <div className="card p-4 sm:p-5">
          <p className="eyebrow">Your position</p>
          <p className="mt-2 font-mono text-lg font-semibold tabular-nums sm:text-xl">
            {connected && myEth !== undefined && myVlad !== undefined ? (
              <>
                {formatToken(myEth, 18, 6)} <span className="text-sm text-muted">ETH</span> +{' '}
                {formatToken(myVlad, 18, 2)} <span className="text-sm text-muted">VLAD</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className="mt-1 text-xs text-muted">
            What your sLP (wallet + farm) would redeem for right now. Swap fees stay in the pool, so this grows with volume.
          </p>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Liquidity</p>
            <h3 className="mt-1 text-xl font-semibold">{mode === 'add' ? 'Add liquidity' : 'Remove liquidity'}</h3>
          </div>
          <Tabs tabs={MODES} value={mode} onChange={setMode} label="Liquidity action" />
        </div>
        <div className="mt-5">{mode === 'add' ? <AddLiquidity /> : <RemoveLiquidity />}</div>
      </div>
    </div>
  )
}

function AddLiquidity() {
  const p = usePoolState()
  const user = useUserState()
  const [ethText, setEthText] = useState('')
  const [vladText, setVladText] = useState('')

  const empty = p.lpSupply === 0n
  const ethIn = parseAmount(ethText) ?? 0n
  const debouncedEth = useDebounced(ethIn)
  const quote = useReadContract({
    ...poolContract,
    functionName: 'quoteAddLiquidity',
    args: [debouncedEth],
    query: { enabled: DEPLOYED && !empty && debouncedEth > 0n, refetchInterval: 12_000 },
  })
  const quoteFresh = debouncedEth === ethIn && !quote.isFetching
  const quoted = !empty && ethIn > 0n && debouncedEth === ethIn ? quote.data : undefined

  // First deposit: the user picks both amounts and pays exactly them.
  const firstVlad = parseAmount(vladText) ?? 0n
  const firstRoot = sqrt(ethIn * firstVlad)
  const firstLp = firstRoot > MINIMUM_LIQUIDITY ? firstRoot - MINIMUM_LIQUIDITY : 0n

  const vladNeeded = empty ? firstVlad : quoted?.[0]
  const lpOut = empty ? firstLp : quoted?.[1]
  // Later deposits: allow the VLAD side 0.5% of price movement; the contract pulls only what it needs.
  const maxVlad =
    vladNeeded === undefined ? undefined : empty ? vladNeeded : (vladNeeded * (10_000n + LIQUIDITY_SLIPPAGE_BPS) + 9_999n) / 10_000n
  const minLp = lpOut !== undefined ? applySlippage(lpOut, LIQUIDITY_SLIPPAGE_BPS) : undefined

  const ethMax = user.ethBalance === undefined ? undefined : user.ethBalance > GAS_RESERVE ? user.ethBalance - GAS_RESERVE : 0n
  const rawEthExceeds = user.ethBalance !== undefined && ethIn > user.ethBalance
  const rawVladExceeds = user.vladBalance !== undefined && vladNeeded !== undefined && vladNeeded > user.vladBalance
  const rawNeedsApproval = maxVlad !== undefined && maxVlad > 0n && (user.vladAllowance ?? 0n) < maxVlad
  const settled = useSettled(
    `${ethText}:${vladText}`,
    ethIn > 0n && !!vladNeeded && !rawEthExceeds && !rawVladExceeds && !rawNeedsApproval,
  )
  const ethExceeds = rawEthExceeds && !settled
  const vladExceeds = rawVladExceeds && !settled
  const needsApproval = rawNeedsApproval && !settled
  const newSupply = p.lpSupply !== undefined && lpOut !== undefined ? p.lpSupply + lpOut + (empty ? MINIMUM_LIQUIDITY : 0n) : undefined
  const shareAfter = lpOut !== undefined && newSupply ? pct(lpOut, newSupply) : undefined
  const openingPrice = empty && ethIn > 0n && firstVlad > 0n ? toFloat(firstVlad) / toFloat(ethIn) : undefined

  const ready =
    DEPLOYED && ethIn > 0n && !!vladNeeded && vladNeeded > 0n && !!lpOut && lpOut > 0n && !ethExceeds && !vladExceeds

  return (
    <div className="space-y-4">
      {empty ? (
        <Note tone="warn">
          The pool is empty. As the first depositor you set the opening price with the ratio of your two amounts, and
          1000 wei of sLP is locked forever at 0x…dEaD.
        </Note>
      ) : null}

      <div>
        <AmountField
          label="ETH to deposit"
          symbol="ETH"
          value={ethText}
          onChange={setEthText}
          balance={user.ethBalance}
          max={ethMax}
          error={ethExceeds ? 'Exceeds your ETH balance.' : undefined}
        />
        <div className="relative z-10 -my-2.5 flex justify-center" aria-hidden>
          <span className="grid size-9 place-items-center rounded-xl border border-border bg-surface-2 font-mono text-lg text-muted">
            +
          </span>
        </div>
        <AmountField
          label={empty ? 'VLAD to deposit' : 'VLAD needed (from quoteAddLiquidity)'}
          symbol="VLAD"
          value={
            empty
              ? vladText
              : vladNeeded !== undefined
                ? toInputString(vladNeeded)
                : ethIn > 0n && !quoteFresh
                  ? '…'
                  : ''
          }
          onChange={empty ? setVladText : undefined}
          readOnly={!empty}
          balance={user.vladBalance}
          max={empty ? user.vladBalance : undefined}
          error={vladExceeds ? 'Exceeds your VLAD balance.' : undefined}
          hint={!empty ? 'Rounded up in the pool’s favour, exactly like the contract.' : undefined}
        />
      </div>

      <Details>
        {empty ? (
          <DetailRow label="Opening price">{openingPrice !== undefined ? `1 ETH = ${formatPrice(openingPrice)} VLAD` : '—'}</DetailRow>
        ) : null}
        <DetailRow label="sLP you receive">{lpOut !== undefined && ethIn > 0n ? formatToken(lpOut, 18, 6) : '—'}</DetailRow>
        <DetailRow label="Minimum sLP (99.5%)">{minLp !== undefined && ethIn > 0n ? formatToken(minLp, 18, 6) : '—'}</DetailRow>
        {!empty ? (
          <DetailRow label="Max VLAD (+0.5%)">{maxVlad !== undefined ? formatToken(maxVlad, 18, 6) : '—'}</DetailRow>
        ) : null}
        <DetailRow label="Your share of new deposits">{shareAfter !== undefined && ethIn > 0n ? formatPct(shareAfter, 4) : '—'}</DetailRow>
      </Details>

      <NetworkGate connectMessage="Connect MetaMask to provide liquidity.">
        {needsApproval ? (
          <div>
            <StepLabel step={1} total={2}>
              Allow the pool to take up to {formatToken(maxVlad, 18, 4)} VLAD
            </StepLabel>
            <TxButton
              key="approve"
              request={{
                address: addresses.vladToken,
                abi: iVladTokenAbi,
                functionName: 'approve',
                args: [addresses.pool, maxVlad],
              }}
              disabled={!ready}
              errorMessages={LP_ERRORS}
              className="h-12 w-full"
            >
              Approve VLAD
            </TxButton>
          </div>
        ) : (
          <div>
            {ready ? (
              <StepLabel step={2} total={2}>
                Allowance ready · deposit
              </StepLabel>
            ) : null}
            <TxButton
              key="add"
              request={{
                address: addresses.pool,
                abi: stellarPoolAbi,
                functionName: 'addLiquidity',
                args: [maxVlad ?? 0n, minLp ?? 0n],
                value: ethIn,
              }}
              disabled={!ready}
              errorMessages={LP_ERRORS}
              onConfirmed={() => {
                setEthText('')
                setVladText('')
              }}
              className="h-12 w-full text-base"
            >
              {!DEPLOYED ? 'Pool not deployed yet' : ethIn === 0n ? 'Enter an ETH amount' : 'Add liquidity'}
            </TxButton>
          </div>
        )}
      </NetworkGate>
    </div>
  )
}

function RemoveLiquidity() {
  const p = usePoolState()
  const user = useUserState()
  const [lpText, setLpText] = useState('')

  const lp = parseAmount(lpText) ?? 0n
  const rawExceeds = user.lpBalance !== undefined && lp > user.lpBalance
  const settled = useSettled(lpText, lp > 0n && !rawExceeds)
  const exceeds = rawExceeds && !settled
  const supply = p.lpSupply ?? 0n
  const ethOut = supply > 0n && p.reserveEth !== undefined ? (lp * p.reserveEth) / supply : undefined
  const vladOut = supply > 0n && p.reserveVlad !== undefined ? (lp * p.reserveVlad) / supply : undefined
  const minEth = ethOut !== undefined ? applySlippage(ethOut, LIQUIDITY_SLIPPAGE_BPS) : undefined
  const minVlad = vladOut !== undefined ? applySlippage(vladOut, LIQUIDITY_SLIPPAGE_BPS) : undefined
  const ready = DEPLOYED && lp > 0n && !exceeds && !!ethOut && !!vladOut

  return (
    <div className="space-y-4">
      <AmountField
        label="sLP to burn"
        symbol="sLP"
        value={lpText}
        onChange={setLpText}
        balance={user.lpBalance}
        max={user.lpBalance}
        error={exceeds ? 'Exceeds your sLP wallet balance.' : undefined}
      />

      {user.staked && user.staked > 0n ? (
        <Note>
          {formatToken(user.staked, 18, 4)} sLP is staked in the farm. Withdraw it in the Farm tab first to remove that
          part.
        </Note>
      ) : null}

      <Details>
        <DetailRow label="You receive ETH">{ethOut !== undefined && lp > 0n ? formatToken(ethOut, 18, 6) : '—'}</DetailRow>
        <DetailRow label="You receive VLAD">{vladOut !== undefined && lp > 0n ? formatToken(vladOut, 18, 4) : '—'}</DetailRow>
        <DetailRow label="Minimum ETH (−0.5%)">{minEth !== undefined && lp > 0n ? formatToken(minEth, 18, 6) : '—'}</DetailRow>
        <DetailRow label="Minimum VLAD (−0.5%)">{minVlad !== undefined && lp > 0n ? formatToken(minVlad, 18, 4) : '—'}</DetailRow>
      </Details>

      <NetworkGate connectMessage="Connect MetaMask to remove liquidity.">
        <TxButton
          request={{
            address: addresses.pool,
            abi: stellarPoolAbi,
            functionName: 'removeLiquidity',
            args: [lp, minEth ?? 0n, minVlad ?? 0n],
          }}
          disabled={!ready}
          errorMessages={LP_ERRORS}
          onConfirmed={() => setLpText('')}
          className="h-12 w-full text-base"
        >
          {!DEPLOYED ? 'Pool not deployed yet' : lp === 0n ? 'Enter an sLP amount' : 'Remove liquidity'}
        </TxButton>
      </NetworkGate>
    </div>
  )
}
