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
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioSMFHoldings', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'reserve',              args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'balanceOf',            args: [address ?? '0x0000000000000000000000000000000000000000', id] },
    ],
    query: { enabled: isConnected && !!address && tokenId > 0 },
  })

  const smfHoldings  = data?.[0]?.status === 'success' ? (data[0].result as bigint)   : undefined
  const ethReserve   = data?.[1]?.status === 'success' ? (data[1].result as bigint)   : undefined
  const balance      = data?.[2]?.status === 'success' ? (data[2].result as bigint)   : undefined

  const hasNFT = balance !== undefined && balance > 0n

  const { writeContract: writeDivest, data: divestHash, isPending: divestPending, error: divestError, reset: resetDivest } = useWriteContract()
  const { isLoading: divestConfirming, isSuccess: divestConfirmed } = useWaitForTransactionReceipt({ hash: divestHash })

  function handleDivest() {
    resetDivest()
    writeDivest({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'divest', args: [id, 1n] })
  }

  if (!isConnected) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to exit.</p>
      </div>
    )
  }

  if (!hasNFT) return null

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-bold text-white">Exit NFT</h2>

      {/* What you'll receive */}
      <div className="space-y-2">
        {smfHoldings !== undefined && smfHoldings > 0n && (
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
        <div className="box-info text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Assets returned in-kind: SMF and ERC20 tokens transferred directly, AAVE and LP positions unwound to ETH.
        </div>
      </div>

      <button
        onClick={handleDivest}
        disabled={divestPending || divestConfirming}
        className="btn-money"
      >
        {divestPending ? 'Confirm in wallet…' : divestConfirming ? 'Divesting…' : 'Divest All'}
      </button>

      {divestConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Assets transferred successfully.</p>
      )}
      {divestError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>
          Error: {divestError.message}
        </p>
      )}
    </div>
  )
}
