import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useReadContract, useAccount, useBalance } from 'wagmi'
import { formatEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI, CONTRACT_ADDRESS } from '../contracts'

export default function Header() {
  const { address } = useAccount()

  const { data: contractEth } = useBalance({
    address: CONTRACT_ADDRESS,
  })

  const { data: smfSupply } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfTotalSupply',
  })

  const { data: smfBalance } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address },
  })

  return (
    <header
      className="border-b px-6 py-4"
      style={{
        background: 'rgba(5, 25, 14, 0.92)',
        borderColor: 'rgba(212, 175, 55, 0.2)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl font-black tracking-tight text-gold">Smartfolio</span>
          <span className="badge-gold hidden sm:inline">v0</span>

          {/* Contract stats */}
          <div className="hidden md:flex items-center gap-4 ml-2" style={{ borderLeft: '1px solid rgba(212,175,55,0.2)', paddingLeft: '1rem' }}>
            <Stat label="ETH" value={contractEth ? parseFloat(formatEther(contractEth.value)).toFixed(4) : '—'} />
            <Stat label="SMF" value={smfSupply !== undefined ? smfSupply.toString() : '—'} />
            {address && smfBalance !== undefined && (
              <Stat label="Your SMF" value={smfBalance.toString()} highlight />
            )}
          </div>
        </div>
        <ConnectButton />
      </div>
    </header>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.7rem', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color: highlight ? '#d4af37' : 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
