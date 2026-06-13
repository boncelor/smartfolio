import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

type Action = 'mint' | 'burn'

export default function SMFPanel() {
  const [action, setAction] = useState<Action>('mint')
  const [amount, setAmount] = useState('')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValid = parsedAmount > 0

  const { data: balance } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address },
  })

  const { data: buyCost } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfMintCost',
    args: [BigInt(parsedAmount)],
    query: { enabled: action === 'mint' && isValid },
  })

  const { data: burnValue } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfBurnValue',
    args: [BigInt(parsedAmount)],
    query: { enabled: action === 'burn' && isValid },
  })

  const { data: sellFeeData } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfSellFee',
    args: [BigInt(parsedAmount)],
    query: { enabled: action === 'burn' && isValid },
  })

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

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
      // minEthOut = 95% of net (5% slippage tolerance)
      const minEthOut = burnValue * 95n / 100n
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'sellSMF',
        args: [BigInt(parsedAmount), minEthOut],
      })
    }
  }

  const maxBurn = balance !== undefined ? Number(balance) : undefined

  const isDisabled = !isConnected || isPending || isConfirming || (
    action === 'mint' ? (buyCost === undefined || !isValid) :
    (burnValue === undefined || !isValid || (maxBurn !== undefined && parsedAmount > maxBurn))
  )

  return (
    <div className="card space-y-4">
      {/* Action sub-tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setAction('mint'); setAmount('') }}
          title="Mint SMF"
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded transition-colors ${
            action === 'mint' ? 'tab-active-gold-pill' : 'tab-inactive'
          }`}
        >
          {/* Hammer icon */}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/>
            <path d="m18 15 4-4"/>
            <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>
          </svg>
          Mint
        </button>
        <button
          onClick={() => { setAction('burn'); setAmount('') }}
          title="Burn SMF"
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded transition-colors ${
            action === 'burn' ? 'tab-active-gold-pill' : 'tab-inactive'
          }`}
        >
          {/* Flame icon */}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
          Burn
        </button>
      </div>

      {/* Amount input */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="stat-label">SMF amount</label>
          {action === 'burn' && balance !== undefined && (
            <button
              className="text-xs"
              style={{ color: 'rgba(212,175,55,0.6)' }}
              onClick={() => setAmount(balance.toString())}
            >
              Balance: {balance.toString()} SMF
            </button>
          )}
        </div>
        <div className="relative flex items-center">
          <input
            type="number"
            min={1}
            step={1}
            max={action === 'burn' && maxBurn !== undefined ? maxBurn : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-money pr-16"
          />
          <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
            SMF
          </span>
        </div>
        {action === 'burn' && maxBurn !== undefined && parsedAmount > maxBurn && (
          <p className="text-xs" style={{ color: '#f87171' }}>Exceeds your balance of {maxBurn} SMF</p>
        )}
      </div>

      {/* Simulation info */}
      <div className="space-y-2">
        {action === 'mint' && buyCost !== undefined && isValid && (
          <div className="flex items-center justify-between box-info">
            <span className="stat-label" style={{ marginBottom: 0 }}>Cost</span>
            <span className="font-semibold text-gold">{formatEther(buyCost)} ETH</span>
          </div>
        )}
        {action === 'burn' && sellFeeData !== undefined && isValid && (
          <div className="box-info space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="stat-label" style={{ marginBottom: 0 }}>Gross</span>
              <span className="text-white font-medium">{formatEther((sellFeeData as [bigint, bigint])[0] + (sellFeeData as [bigint, bigint])[1])} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="stat-label" style={{ marginBottom: 0 }}>Fee</span>
              <span style={{ color: '#fb923c' }} className="font-medium">{formatEther((sellFeeData as [bigint, bigint])[0])} ETH</span>
            </div>
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: 'rgba(212,175,55,0.12)' }}>
              <span className="stat-label" style={{ marginBottom: 0 }}>You receive</span>
              <span className="font-bold text-gold">{formatEther((sellFeeData as [bigint, bigint])[1])} ETH</span>
            </div>
          </div>
        )}
      </div>

      <button onClick={handleSubmit} disabled={isDisabled} className="btn-money">
        {isPending ? 'Confirm in wallet…' : isConfirming ? 'Processing…' : action === 'mint' ? 'Mint SMF' : 'Burn SMF'}
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
