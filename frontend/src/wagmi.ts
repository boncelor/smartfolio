import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { sepolia } from 'viem/chains'

export const wagmiConfig = getDefaultConfig({
  appName: 'Smartfolio',
  projectId: 'smartfolio-local-dev',
  chains: [sepolia],
  ssr: false,
})
