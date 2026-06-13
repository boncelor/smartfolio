import { useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function ExitForm({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const id = BigInt(tokenId)

  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioActive',      args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioSMFHoldings', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'reserve',              args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'balanceOf',            args: [address ?? '0x0000000000000000000000000000000000000000', id] },
    ],
    query: { enabled: isConnected && !!address && tokenId > 0 },
  })

  const active       = data?.[0]?.status === 'success' ? (data[0].result as boolean)  : undefined
  const smfHoldings  = data?.[1]?.status === 'success' ? (data[1].result as bigint)   : undefined
  const ethReserve   = data?.[2]?.status === 'success' ? (data[2].result as bigint)   : undefined
  const balance      = data?.[3]?.status === 'success' ? (data[3].result as bigint)   : undefined

  const hasNFT = balance !== undefined && balance > 0n

  // withdrawSMF — pre-deployment exit
  const { writeContract: writeWithdraw, data: withdrawHash, isPending: withdrawPending, error: withdrawError, reset: resetWithdraw } = useWriteContract()
  const { isLoading: withdrawConfirming, isSuccess: withdrawConfirmed } = useWaitForTransactionReceipt({ hash: withdrawHash })

  // divest — post-deployment exit (minEthOut = 0 for now)
  const { writeContract: writeDivest, data: divestHash, isPending: divestPending, error: divestError, reset: resetDivest } = useWriteContract()
  const { isLoading: divestConfirming, isSuccess: divestConfirmed } = useWaitForTransactionReceipt({ hash: divestHash })

  function handleWithdraw() {
    resetWithdraw()
    writeWithdraw({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'withdrawSMF', args: [id] })
  }

  function handleDivest() {
    resetDivest()
    writeDivest({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'divest', args: [id, 1n, 0n] })
  }

  if (!isConnected) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to exit.</p>
      </div>
    )
  }

  if (!hasNFT) return null

  const confirmed = withdrawConfirmed || divestConfirmed
  const anyError  = withdrawError || divestError

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-bold text-white">Exit NFT</h2>

      {/* What you'll receive */}
      <div className="space-y-2">
        {active === false && smfHoldings !== undefined && smfHoldings > 0n && (
          <div className="flex items-center justify-between box-info text-sm">
            <span className="stat-label" style={{ marginBottom: 0 }}>SMF returned</span>
            <span className="font-semibold text-gold">{smfHoldings.toString()} SMF</span>
          </div>
        )}
        {ethReserve !== undefined && ethReserve > 0n && (
          <div className="flex items-center justify-between box-info text-sm">
            <span className="stat-label" style={{ marginBottom: 0 }}>ETH returned</span>
            <span className="font-semibold text-white">{formatEther(ethReserve)} ETH</span>
          </div>
        )}
        {active === true && (
          <div className="box-info text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            All deployed assets will be unwound and returned as ETH.
          </div>
        )}
      </div>

      {/* Action */}
      {active === false && (
        <button
          onClick={handleWithdraw}
          disabled={withdrawPending || withdrawConfirming}
          className="btn-money"
        >
          {withdrawPending ? 'Confirm in wallet…' : withdrawConfirming ? 'Withdrawing…' : 'Withdraw SMF'}
        </button>
      )}

      {active === true && (
        <button
          onClick={handleDivest}
          disabled={divestPending || divestConfirming}
          className="btn-money"
        >
          {divestPending ? 'Confirm in wallet…' : divestConfirming ? 'Divesting…' : 'Divest All'}
        </button>
      )}

      {confirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
          {withdrawConfirmed ? 'SMF returned to your wallet.' : 'Assets divested successfully.'}
        </p>
      )}
      {anyError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>
          Error: {anyError.message}
        </p>
      )}
    </div>
  )
}
