import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'

const ganache = defineChain({
  id: 1337,
  name: 'Ganache',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
    },
  },
})

export const wagmiConfig = getDefaultConfig({
  appName: 'Smartfolio',
  projectId: 'smartfolio-local-dev',
  chains: [ganache],
  ssr: false,
})
