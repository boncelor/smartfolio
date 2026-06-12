import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { sepolia } from 'viem/chains'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string

export const wagmiConfig = getDefaultConfig({
  appName: 'Smartfolio',
  projectId,
  chains: [sepolia],
  ssr: false,
})
