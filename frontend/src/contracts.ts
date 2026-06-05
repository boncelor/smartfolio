import artifact from '../../build/contracts/Smartfolio.json'

// Derive contract address: prefer env var, then first deployed network address
function resolveAddress(): `0x${string}` {
  const envAddr = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined
  if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
    return envAddr as `0x${string}`
  }

  const networks = artifact.networks as Record<string, { address: string }>
  const addresses = Object.values(networks).map((n) => n.address)
  if (addresses.length > 0) {
    return addresses[0] as `0x${string}`
  }

  return '0x0000000000000000000000000000000000000000'
}

export const CONTRACT_ADDRESS: `0x${string}` = resolveAddress()

export const SMARTFOLIO_ABI = [
  // View functions
  {
    name: 'tokenInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'circulatingSupply', type: 'uint256' },
          { name: 'totalMinted', type: 'uint256' },
          { name: 'maxSupply', type: 'uint256' },
          { name: 'reserve', type: 'uint256' },
          { name: 'backingPerToken', type: 'uint256' },
          { name: 'currentTierIndex', type: 'uint256' },
          { name: 'currentPrice', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'mintCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'burnRefund',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'gross', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
      { name: 'net', type: 'uint256' },
    ],
  },
  {
    name: 'portfolioActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'portfolioHoldings',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'deployedEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'reserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'maxBurnFeeRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'paused',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'keeper',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Write functions
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'burn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'divest',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [],
  },
  // Events
  {
    name: 'Minted',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'ethPaid', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Burned',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'ethRefunded', type: 'uint256', indexed: false },
      { name: 'feePaid', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Divested',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'ethReceived', type: 'uint256', indexed: false },
    ],
  },
] as const
