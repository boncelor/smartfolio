import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

interface Props {
  tokenId: number
}

type Action = 'mint' | 'burn' | 'nftMint' | 'add'

const ACTION_LABELS: Record<Action, string> = {
  mint:    'Mint SMF',
  burn:    'Burn SMF',
  nftMint: 'Mint NFT',
  add:     'Add to NFT',
}

export default function SMFPanel({ tokenId }: Props) {
  const [action, setAction] = useState<Action>('mint')
  const [amount, setAmount] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValid = parsedAmount > 0

  // --- Mint SMF: cost in ETH ---
  const { data: buyCost } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfMintCost',
    args: [BigInt(parsedAmount)],
    query: { enabled: action === 'mint' && isValid },
  })

  // --- Burn SMF: ETH received ---
  const { data: burnValue } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfBurnValue',
    args: [BigInt(parsedAmount)],
    query: { enabled: action === 'burn' && isValid },
  })

  // --- Mint NFT: SMF required + fee ---
  const { data: mintSimulation } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [BigInt(tokenId), BigInt(parsedAmount)],
    query: { enabled: action === 'nftMint' && isValid },
  })
  const smfForMint = mintSimulation?.[0]
  const feeForMint = mintSimulation?.[1]

  // --- Add to NFT: ETH amount input, SMF required ---
  const parsedEth = (() => {
    try { return parseEther(amount || '0') } catch { return 0n }
  })()
  const { data: smfForAdd } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForReserve',
    args: [parsedEth],
    query: { enabled: action === 'add' && parsedEth > 0n },
  })

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function slippageFactor() {
    const pct = parseFloat(slippagePct) || 1
    return 1 + pct / 100
  }

  function handleSubmit() {
    if (!address) return

    if (action === 'mint' && buyCost !== undefined && isValid) {
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'buySMF',
        args: [BigInt(parsedAmount)],
        value: buyCost,
      })
    }

    if (action === 'burn' && burnValue !== undefined && isValid) {
      const minEthOut = BigInt(Math.floor(Number(burnValue) * (1 - (parseFloat(slippagePct) || 1) / 100)))
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'sellSMF',
        args: [BigInt(parsedAmount), minEthOut],
      })
    }

    if (action === 'nftMint' && smfForMint !== undefined && isValid) {
      const maxBurn = BigInt(Math.ceil(Number(smfForMint) * slippageFactor()))
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'mintNFT',
        args: [BigInt(tokenId), BigInt(parsedAmount), maxBurn],
      })
    }

    if (action === 'add' && smfForAdd !== undefined && parsedEth > 0n) {
      const maxBurn = BigInt(Math.ceil(Number(smfForAdd) * slippageFactor()))
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'addToNFT',
        args: [BigInt(tokenId), parsedEth, maxBurn],
      })
    }
  }

  const isDisabled = !isConnected || isPending || isConfirming || (
    action === 'mint'    ? (buyCost === undefined || !isValid) :
    action === 'burn'    ? (burnValue === undefined || !isValid) :
    action === 'nftMint' ? (smfForMint === undefined || !isValid) :
    (smfForAdd === undefined || parsedEth === 0n)
  )

  const amountLabel = action === 'add' ? 'ETH to add' : action === 'nftMint' ? 'NFT amount' : 'SMF amount'
  const amountUnit  = action === 'add' ? 'ETH' : action === 'nftMint' ? 'tokens' : 'SMF'
  const needsSlippage = action !== 'mint'

  return (
    <div className="card space-y-4">
      {/* Action sub-tabs */}
      <div className="flex gap-1 flex-wrap">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <button
            key={a}
            onClick={() => { setAction(a); setAmount('') }}
            className={`px-4 py-2 text-sm font-semibold rounded transition-colors ${
              action === a ? 'tab-active-gold' : 'tab-inactive'
            }`}
          >
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="space-y-1">
        <label className="stat-label">{amountLabel}</label>
        <div className="relative flex items-center">
          <input
            type="number"
            min={action === 'add' ? 0 : 1}
            step={action === 'add' ? '0.001' : 1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-money pr-16"
          />
          <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
            {amountUnit}
          </span>
        </div>
      </div>

      {/* Slippage */}
      {needsSlippage && (
        <div className="space-y-1">
          <label className="stat-label">Slippage tolerance</label>
          <div className="relative flex items-center" style={{ maxWidth: '8rem' }}>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={slippagePct}
              onChange={(e) => setSlippagePct(e.target.value)}
              className="input-money pr-8"
            />
            <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>%</span>
          </div>
        </div>
      )}

      {/* Simulation info */}
      <div className="space-y-2">
        {action === 'mint' && buyCost !== undefined && isValid && (
          <div className="flex items-center justify-between box-info">
            <span className="stat-label" style={{ marginBottom: 0 }}>Cost</span>
            <span className="font-semibold text-gold">{formatEther(buyCost)} ETH</span>
          </div>
        )}
        {action === 'burn' && burnValue !== undefined && isValid && (
          <div className="flex items-center justify-between box-info">
            <span className="stat-label" style={{ marginBottom: 0 }}>You receive</span>
            <span className="font-semibold text-gold">{formatEther(burnValue)} ETH</span>
          </div>
        )}
        {action === 'nftMint' && smfForMint !== undefined && isValid && (
          <>
            <div className="flex items-center justify-between box-info">
              <span className="stat-label" style={{ marginBottom: 0 }}>SMF to burn</span>
              <span className="font-semibold text-gold">{smfForMint.toString()} SMF</span>
            </div>
            <div className="flex items-center justify-between box-info">
              <span className="stat-label" style={{ marginBottom: 0 }}>Conversion fee</span>
              <span className="font-semibold" style={{ color: '#f87171' }}>
                {feeForMint !== undefined ? formatEther(feeForMint) + ' ETH' : '—'}
              </span>
            </div>
          </>
        )}
        {action === 'add' && smfForAdd !== undefined && parsedEth > 0n && (
          <div className="flex items-center justify-between box-info">
            <span className="stat-label" style={{ marginBottom: 0 }}>SMF to burn</span>
            <span className="font-semibold text-gold">{smfForAdd.toString()} SMF</span>
          </div>
        )}
      </div>

      <button onClick={handleSubmit} disabled={isDisabled} className="btn-money">
        {isPending ? 'Confirm in wallet…' : isConfirming ? 'Processing…' : ACTION_LABELS[action]}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Success! Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
      {!isConnected && (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to continue.</p>
      )}
    </div>
  )
}
