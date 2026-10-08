import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia (source of truth: deployments/sepolia.json).
 * The zero address is a placeholder: the UI shows a "not deployed yet" state for it.
 */
export const addresses = {
  vladToken: '0x49ba857d553ef219B144b200F41acaf8CB6768E9',
  pool: '0xAC08AA11850cf015160A93DAD746CA480407b7Ae',
  farm: '0x7b4B7137992625F98d4A3436D52366FfA84EC3DE',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
  { label: 'StellarPool (sLP)', address: addresses.pool },
  { label: 'StellarFarm', address: addresses.farm },
]
