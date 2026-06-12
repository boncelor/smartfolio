function resolveAddress(): `0x${string}` {
  const envAddr = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined
  if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
    return envAddr as `0x${string}`
  }
  return '0x0000000000000000000000000000000000000000'
}

export const CONTRACT_ADDRESS: `0x${string}` = resolveAddress()

// SMF address — set VITE_SMF_ADDRESS after deploying SmartfolioERC20
function resolveSMFAddress(): `0x${string}` {
  const envAddr = import.meta.env.VITE_SMF_ADDRESS as string | undefined
  if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
    return envAddr as `0x${string}`
  }
  return '0x0000000000000000000000000000000000000000'
}

export const SMF_ADDRESS: `0x${string}` = resolveSMFAddress()

export const SMF_ABI = [
  {
    name: 'smfTotalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'smfMintCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'smfForNFT',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'smfRequired', type: 'uint256' },
      { name: 'ethNeeded', type: 'uint256' },
    ],
  },
  {
    name: 'smfForReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'ethAmount', type: 'uint256' }],
    outputs: [{ name: 'smfRequired', type: 'uint256' }],
  },
  {
    name: 'buySMF',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'mintNFT',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'maxSmfBurn', type: 'uint256' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    name: 'addToNFT',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'ethAmount', type: 'uint256' },
      { name: 'maxSmfBurn', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'smfBurnValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'ethOut', type: 'uint256' }],
  },
  {
    name: 'sellSMF',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'NFTMinted',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'smfBurned', type: 'uint256', indexed: false },
      { name: 'ethLocked', type: 'uint256', indexed: false },
    ],
  },
] as const

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
    inputs: [{ name: 'amount', type: 'uint256' }],
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
    name: 'globalTotalMinted',
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
  // Leverage views
  {
    name: 'isLeverageToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'lpActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Write functions
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
  {
    name: 'deploy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'erc20MinAmounts', type: 'uint256[]' },
      { name: 'smfMinAmount', type: 'uint256' },
      { name: 'lpSwapAmountOutMin', type: 'uint256' },
      { name: 'lpAmount0Min', type: 'uint256' },
      { name: 'lpAmount1Min', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'rebalance',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      {
        name: 'instructions',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'isSell', type: 'bool' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'poolFee', type: 'uint24' },
          { name: 'swapPath', type: 'bytes' },
          { name: 'sellSwapPath', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'getPortfolioConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'assetType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'weightBps', type: 'uint16' },
          { name: 'poolFee', type: 'uint24' },
          { name: 'swapFee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'swapPath', type: 'bytes' },
          { name: 'sellSwapPath', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'setPortfolioConfig',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      {
        name: 'assets',
        type: 'tuple[]',
        components: [
          { name: 'assetType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'weightBps', type: 'uint16' },
          { name: 'poolFee', type: 'uint24' },
          { name: 'swapFee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'swapPath', type: 'bytes' },
          { name: 'sellSwapPath', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'getPortfolioTierInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'smfWeightBps', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
  },
  {
    name: 'portfolioSMFHoldings',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'smfContract',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getPortfolioLPInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'positionId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'aaveWeth', type: 'uint256' },
    ],
  },
  {
    name: 'portfolioAaveWeth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
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

