import { useAccount, useReadContract } from 'wagmi'
import { formatEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

export default function SMFInfoCard() {
  const { address } = useAccount()

  const { data: totalSupply } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfTotalSupply',
  })

  const { data: feeBps } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'conversionFeeBps',
  })

  const { data: balance } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address },
  })

  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-bold text-white">SMF Token</h2>
      <div className="grid grid-cols-3 gap-3">
        <div className="box-info flex flex-col gap-1">
          <span className="stat-label">Circulating Supply</span>
          <span className="font-semibold text-gold">
            {totalSupply !== undefined ? totalSupply.toString() : '—'}
          </span>
        </div>
        <div className="box-info flex flex-col gap-1">
          <span className="stat-label">Conversion Fee</span>
          <span className="font-semibold text-gold">
            {feeBps !== undefined ? `${Number(feeBps) / 100}%` : '—'}
          </span>
        </div>
        <div className="box-info flex flex-col gap-1">
          <span className="stat-label">Your Balance</span>
          <span className="font-semibold text-gold">
            {balance !== undefined ? balance.toString() : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
