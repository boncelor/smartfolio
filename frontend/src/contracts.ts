function resolveAddress(): `0x${string}` {
  const envAddr = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined
  if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
    return envAddr as `0x${string}`
  }
  return '0x0000000000000000000000000000000000000000'
}

export const CONTRACT_ADDRESS: `0x${string}` = resolveAddress()

// Factory address — set VITE_FACTORY_ADDRESS after deploying SmartfolioTokenFactory
function resolveFactoryAddress(): `0x${string}` {
  const envAddr = import.meta.env.VITE_FACTORY_ADDRESS as string | undefined
  if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
    return envAddr as `0x${string}`
  }
  return '0x0000000000000000000000000000000000000000'
}

export const FACTORY_ADDRESS: `0x${string}` = resolveFactoryAddress()

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
    inputs: [
      { name: 'id', type: 'uint256' },
    ],
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
      { name: 'id', type: 'uint256' },
      { name: 'maxSmfBurn', type: 'uint256' },
    ],
    outputs: [],
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
  {
    name: 'getLPInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'active', type: 'bool' },
          { name: 'positionId', type: 'uint256' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'deployedEth', type: 'uint256' },
          { name: 'reserve', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getLeverageInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'collateralWeth', type: 'uint256' },
          { name: 'debtStable', type: 'uint256' },
          { name: 'ltvBps', type: 'uint256' },
          { name: 'healthFactor', type: 'uint256' },
          { name: 'ethPriceUsd', type: 'uint256' },
          { name: 'emergencyFloor', type: 'uint256' },
          { name: 'availableBorrows', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'checkLtv',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: 'ltvBps', type: 'uint256' }],
  },
  {
    name: 'getHealthFactor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: 'healthFactor', type: 'uint256' }],
  },
  {
    name: 'simulateLeverUp',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'stableAmount', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'sim',
        type: 'tuple',
        components: [
          { name: 'newLtvBps', type: 'uint256' },
          { name: 'newHealthFactor', type: 'uint256' },
          { name: 'wouldExceedCap', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'emergencyHealthFloor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
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
  // Leverage write functions
  {
    name: 'mintLeverage',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'divestLeverage',
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
    name: 'leverUp',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'stableToBorrow', type: 'uint256' },
      { name: 'minWethOut', type: 'uint256' },
      { name: 'poolFee', type: 'uint24' },
      { name: 'swapPath', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'leverDown',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'wethToWithdraw', type: 'uint256' },
      { name: 'minStableOut', type: 'uint256' },
      { name: 'poolFee', type: 'uint24' },
      { name: 'swapPath', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'emergencyDeleverage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'minStableOut', type: 'uint256' },
      { name: 'poolFee', type: 'uint24' },
      { name: 'swapPath', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'divestLP',
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
      { name: 'lpSwapAmountOutMin', type: 'uint256' },
      { name: 'lpAmount0Min', type: 'uint256' },
      { name: 'lpAmount1Min', type: 'uint256' },
    ],
    outputs: [],
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
  // ERC1155 approval (needed for wrapping)
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

export const FACTORY_ABI = [
  {
    name: 'wrappers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const SMARTFOLIO_TOKEN_ABI = [
  {
    name: 'wrap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'unwrap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'Wrapped',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Unwrapped',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const
