import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatUnits } from 'viem'
import { formatToken } from '../shell/format'
import { StarGlyph } from '../shell/icons'
import { sanitizeAmount } from './lib'

export type TokenSymbol = 'ETH' | 'VLAD' | 'sLP'

/** Ethereum diamond, drawn in the suite's palette. */
function EthGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 5 12.2 12 16l7-3.8L12 2z" fill="#e7f3ec" fillOpacity="0.9" />
      <path d="M12 17.4 5 13.6 12 22l7-8.4-7 3.8z" fill="#8fa89b" />
    </svg>
  )
}

/** Small round token badge: ETH diamond, VLAD star, or the stacked sLP mark. */
export function TokenIcon({ symbol, size = 22 }: { symbol: TokenSymbol; size?: number }) {
  const inner = Math.round(size * 0.6)
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full border border-border bg-surface-2"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {symbol === 'ETH' ? (
        <EthGlyph size={inner} />
      ) : symbol === 'VLAD' ? (
        <StarGlyph size={inner} />
      ) : (
        <span className="font-mono text-[0.55rem] font-semibold text-accent-2">LP</span>
      )}
    </span>
  )
}

export function TokenPill({ symbol }: { symbol: TokenSymbol }) {
  return (
    <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-2/80 pl-1.5 pr-3 text-sm font-semibold">
      <TokenIcon symbol={symbol} size={24} />
      {symbol}
    </span>
  )
}

type AmountFieldProps = {
  label: string
  symbol: TokenSymbol
  value: string
  onChange?: (value: string) => void
  /** Wallet balance (or other upper bound) shown under the input. */
  balance?: bigint
  balanceLabel?: string
  /** Value the MAX button fills in. Hidden when undefined. */
  max?: bigint
  readOnly?: boolean
  error?: string
  hint?: ReactNode
  decimals?: number
}

/** Big amount input with a token pill, balance line and MAX button. */
export function AmountField({
  label,
  symbol,
  value,
  onChange,
  balance,
  balanceLabel = 'Balance',
  max,
  readOnly,
  error,
  hint,
  decimals = symbol === 'ETH' ? 6 : 4,
}: AmountFieldProps) {
  const id = useId()
  return (
    <div
      className={`rounded-2xl border bg-bg/50 p-3.5 transition sm:p-4 ${
        error ? 'border-danger/50' : 'border-border focus-within:border-accent-2/50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        {balance !== undefined ? (
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span className="truncate">
              {balanceLabel}: <span className="font-mono text-text/80">{formatToken(balance, 18, decimals)}</span>
            </span>
            {max !== undefined && onChange ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-accent-2/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wider text-accent-2 transition hover:border-accent-2/60 disabled:opacity-40"
                disabled={max <= 0n}
                onClick={() => onChange(formatUnits(max > 0n ? max : 0n, 18))}
              >
                MAX
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          className="w-full min-w-0 bg-transparent font-mono text-2xl font-semibold tabular-nums text-text outline-none placeholder:text-muted/40 read-only:cursor-default sm:text-[1.65rem]"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={value}
          readOnly={readOnly}
          onChange={onChange ? (e) => onChange(sanitizeAmount(e.target.value)) : undefined}
        />
        <TokenPill symbol={symbol} />
      </div>
      {error ? (
        <p className="mt-2 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-2 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

/** One label/value line inside a details box. */
export function DetailRow({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-text/90'
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={`min-w-0 break-words text-right font-mono tabular-nums ${color}`}>{children}</span>
    </div>
  )
}

export function Details({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/60 rounded-2xl border border-border/80 bg-surface/40 px-4 py-1.5">{children}</div>
}

/** "Step 1 of 2 · Approve VLAD" label above a transaction button. */
export function StepLabel({ step, total, children }: { step: number; total: number; children: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-xs text-muted">
      <span className="rounded-md border border-border bg-surface-2/70 px-1.5 py-0.5 font-mono text-[0.65rem] text-accent-2">
        {step}/{total}
      </span>
      {children}
    </p>
  )
}

/**
 * Info bubble. Opens on mouse hover, keyboard focus or tap. The bubble is positioned against the nearest
 * `relative` ancestor and spans its full width, so place it inside a `relative` container. Position the button
 * with `className` (for example `absolute right-4 top-4`): the root span stays unpositioned on purpose, so it
 * does not become the bubble's containing block.
 */
export function InfoTip({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)

  // Close on a tap or click anywhere else (touch browsers do not always blur the button).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <span
      ref={root}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className={`inline-grid size-5 place-items-center rounded-full border font-mono text-[0.65rem] font-semibold transition ${
          open ? 'border-accent-2/60 text-accent-2' : 'border-border text-muted hover:text-text'
        } ${className}`}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className="absolute inset-x-0 top-full z-30 mt-2 block rounded-xl border border-border bg-surface-2 p-3.5 text-left text-xs leading-relaxed text-text/90 shadow-card"
        >
          {children}
        </span>
      ) : null}
    </span>
  )
}

/** Muted callout box. */
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'danger' }) {
  const styles =
    tone === 'danger'
      ? 'border-danger/30 bg-danger/[0.06] text-danger'
      : tone === 'warn'
        ? 'border-warning/30 bg-warning/[0.06] text-warning'
        : 'border-accent/25 bg-accent/[0.06] text-text/85'
  return <div className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${styles}`}>{children}</div>
}
