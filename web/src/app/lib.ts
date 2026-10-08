import { useEffect, useState } from 'react'
import { formatUnits, multicall3Abi, parseUnits, zeroAddress } from 'viem'
import { useBalance, useConnection, useReadContracts } from 'wagmi'
import { iVladTokenAbi, stellarFarmAbi, stellarPoolAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import type { ErrorMessages } from '../shell/errors'
import { isConfiguredAddress } from '../shell/format'
import { sepolia } from '../shell/wagmi'

/** All three contracts must be real deployments before the page reads anything on-chain. */
export const DEPLOYED =
  isConfiguredAddress(addresses.vladToken) && isConfiguredAddress(addresses.pool) && isConfiguredAddress(addresses.farm)

export const poolContract = { address: addresses.pool, abi: stellarPoolAbi, chainId: CHAIN_ID } as const
export const farmContract = { address: addresses.farm, abi: stellarFarmAbi, chainId: CHAIN_ID } as const
export const vladContract = { address: addresses.vladToken, abi: iVladTokenAbi, chainId: CHAIN_ID } as const
const multicall = { address: sepolia.contracts.multicall3.address, abi: multicall3Abi, chainId: CHAIN_ID } as const

/** Pool constants mirrored from StellarPool.sol. */
export const FEE_BPS = 30n
export const MINIMUM_LIQUIDITY = 1000n
export const SECONDS_PER_DAY = 86_400n
export const SECONDS_PER_YEAR = 31_536_000n
/** ETH kept back by the MAX button so the wallet can still pay gas. */
export const GAS_RESERVE = parseUnits('0.001', 18)
/** Fixed 0.5% tolerance used for liquidity actions. */
export const LIQUIDITY_SLIPPAGE_BPS = 50n

/** Readable sentences for the custom errors of StellarPool, StellarFarm and the VLAD token. */
export const LP_ERRORS: ErrorMessages = {
  Slippage: () =>
    'The price moved past your slippage limit (or the output rounds to zero). Refresh the quote or raise the tolerance.',
  InsufficientLiquidity: () => 'The pool does not have enough liquidity for this amount.',
  ZeroAmount: () => 'Enter an amount greater than zero.',
  InsufficientStake: () => 'You are trying to withdraw more sLP than you have staked.',
  EthTransferFailed: () => 'The pool could not send ETH to your address.',
  ERC20InsufficientBalance: () => 'Your token balance is too low for this amount.',
  AccessControlUnauthorizedAccount: () =>
    'The farm cannot mint VLAD rewards right now (it is missing MINTER_ROLE). Your stake is safe: use Emergency withdraw to exit.',
}

/** Same formula as StellarPool.getAmountOut (floor division, 0.30% fee). */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const amountInWithFee = amountIn * (10_000n - FEE_BPS)
  return (amountInWithFee * reserveOut) / (reserveIn * 10_000n + amountInWithFee)
}

/** amount * (1 - bps / 10000), rounded down: the minimum the user accepts. */
export const applySlippage = (amount: bigint, bps: bigint) => (amount * (10_000n - bps)) / 10_000n

/** Integer square root (Babylonian method), matches OpenZeppelin Math.sqrt rounding down. */
export function sqrt(value: bigint): bigint {
  if (value < 2n) return value
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}

/** Parses a decimal string into base units; undefined for empty or invalid input. */
export function parseAmount(value: string, decimals = 18): bigint | undefined {
  if (!value || value === '.') return undefined
  try {
    return parseUnits(value, decimals)
  } catch {
    return undefined
  }
}

/** Keeps only digits and one dot, with at most `decimals` fraction digits. */
export function sanitizeAmount(raw: string, decimals = 18): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, decimals)}` : whole
}

export const toFloat = (value: bigint, decimals = 18) => Number(formatUnits(value, decimals))

/** Up to `maxDecimals` fraction digits, no thousands separators or trailing zeros: for showing inside an input. */
export function toInputString(value: bigint, maxDecimals = 6): string {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

/** Price-style number: 100,000 / 1.2345 / 0.00001234. */
export function formatPrice(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 1_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

export function formatPct(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n > 0 && n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`
  return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })}%`
}

/** Share of `part` in `whole` as a percentage number. */
export const pct = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0)

/** Pool-wide reads, refreshed every 12 s so quotes stay live. */
export function usePoolState() {
  const query = useReadContracts({
    contracts: [
      { ...poolContract, functionName: 'getReserves' },
      { ...poolContract, functionName: 'totalSupply' },
      { ...poolContract, functionName: 'lastUpdateBlock' },
      { ...farmContract, functionName: 'totalStaked' },
      { ...farmContract, functionName: 'rewardPerSecond' },
    ],
    query: { enabled: DEPLOYED, refetchInterval: 12_000 },
  })
  const reserves = query.data?.[0]?.result
  return {
    reserveEth: reserves?.[0],
    reserveVlad: reserves?.[1],
    lpSupply: query.data?.[1]?.result,
    lastUpdateBlock: query.data?.[2]?.result,
    totalStaked: query.data?.[3]?.result,
    rewardPerSecond: query.data?.[4]?.result,
    isLoading: DEPLOYED && query.isLoading,
  }
}

/**
 * Reads for the connected wallet, refreshed every 8 s. All of them go into one Multicall3 call, so the
 * returned `blockTimestamp` is the timestamp of the exact block `pendingReward` was computed at.
 */
export function useUserState() {
  const { address } = useConnection()
  const account = address ?? zeroAddress
  const enabled = DEPLOYED && !!address
  const eth = useBalance({ address, chainId: CHAIN_ID, query: { enabled: !!address, refetchInterval: 12_000 } })
  const query = useReadContracts({
    contracts: [
      { ...vladContract, functionName: 'balanceOf', args: [account] },
      { ...vladContract, functionName: 'allowance', args: [account, addresses.pool] },
      { ...poolContract, functionName: 'balanceOf', args: [account] },
      { ...poolContract, functionName: 'allowance', args: [account, addresses.farm] },
      { ...farmContract, functionName: 'userInfo', args: [account] },
      { ...farmContract, functionName: 'pendingReward', args: [account] },
      { ...multicall, functionName: 'getCurrentBlockTimestamp' },
    ],
    query: { enabled, refetchInterval: 8_000 },
  })
  const data = enabled ? query.data : undefined
  return {
    address,
    ethBalance: address ? eth.data?.value : undefined,
    vladBalance: data?.[0]?.result,
    vladAllowance: data?.[1]?.result,
    lpBalance: data?.[2]?.result,
    lpAllowance: data?.[3]?.result,
    staked: data?.[4]?.result?.[0],
    pending: data?.[5]?.result,
    blockTimestamp: data?.[6]?.result,
    isLoading: enabled && query.isLoading,
  }
}

/** `value`, updated only after it has been stable for `delayMs`. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/**
 * True once `ok` has been true for this exact `input`, until the input changes. Without it, a refetch that lands
 * while a transaction is still being mined (balance or allowance already spent) would flip the form back to
 * "Approve" or "exceeds balance" and unmount the pending TxButton before it sees the receipt.
 */
export function useSettled(input: string, ok: boolean): boolean {
  const [okFor, setOkFor] = useState<string>()
  if (ok && input !== '' && okFor !== input) setOkFor(input)
  return ok || (input !== '' && okFor === input)
}

/** Date.now() refreshed every `intervalMs` (used for the smooth pending-reward counter). */
export function useTicker(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
