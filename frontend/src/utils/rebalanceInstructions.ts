import { type PublicClient } from 'viem'
import { QUOTER_V2_ADDRESS, QUOTER_V2_ABI } from '../contracts'

export interface PortfolioAsset {
  assetType: number    // 0=ERC20, 1=AAVE, 2=LP, 3=SMF, 4=STAKING
  token: string
  weightBps: number
  poolFee: number
  swapFee: number
  tickLower: number
  tickUpper: number
  swapPath: string
  sellSwapPath: string
}

export interface RebalanceInstruction {
  token: string
  isSell: boolean
  amountIn: bigint
  amountOutMin: bigint
  poolFee: number
  swapPath: string
  sellSwapPath: string
}

export interface RebalancePreview {
  instructions: RebalanceInstruction[]
  sells: { token: string; amountIn: bigint; estimatedWeth: bigint; poolFee: number }[]
  buys:  { token: string; amountIn: bigint; weightBps: number; poolFee: number }[]
  totalWethIn: bigint
  error: string | null
}

const SLIPPAGE_BPS = 50n  // 0.5%

/**
 * Build rebalance instructions for ERC20 assets only.
 *
 * Strategy: sell ALL current ERC20 holdings → collect WETH → re-buy according
 * to current config weights. SMF, AAVE, and LP slices are skipped.
 *
 * @param config        Current portfolio config from getPortfolioConfig()
 * @param holdings      Map of token address → current holding amount
 * @param wethAddress   WETH contract address
 * @param publicClient  viem PublicClient (for Quoter simulation)
 */
export async function buildRebalanceInstructions(
  config: PortfolioAsset[],
  holdings: Record<string, bigint>,
  wethAddress: string,
  publicClient: PublicClient,
): Promise<RebalancePreview> {
  const erc20Assets = config.filter(a => a.assetType === 0)  // ERC20 only

  if (erc20Assets.length === 0) {
    return { instructions: [], sells: [], buys: [], totalWethIn: 0n, error: 'No ERC20 assets in config to rebalance.' }
  }

  // --- Sells: quote each ERC20 holding → WETH ---
  const sells: RebalancePreview['sells'] = []
  let totalWethIn = 0n

  for (const asset of erc20Assets) {
    const amountIn = holdings[asset.token.toLowerCase()] ?? holdings[asset.token] ?? 0n
    if (amountIn === 0n) continue

    let estimatedWeth = 0n
    try {
      const result = await publicClient.simulateContract({
        address: QUOTER_V2_ADDRESS,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn:           asset.token as `0x${string}`,
          tokenOut:          wethAddress as `0x${string}`,
          amountIn,
          fee:               asset.poolFee,
          sqrtPriceLimitX96: 0n,
        }],
      })
      estimatedWeth = result.result[0]
    } catch {
      return {
        instructions: [], sells: [], buys: [], totalWethIn: 0n,
        error: `Could not get quote for ${asset.token} — pool may not have liquidity on this network.`,
      }
    }

    sells.push({ token: asset.token, amountIn, estimatedWeth, poolFee: asset.poolFee })
    totalWethIn += estimatedWeth
  }

  if (totalWethIn === 0n) {
    return { instructions: [], sells: [], buys: [], totalWethIn: 0n, error: 'No ERC20 holdings to rebalance.' }
  }

  // Total weight of ERC20 assets only (for proportional buy allocation)
  const totalErc20WeightBps = erc20Assets.reduce((s, a) => s + a.weightBps, 0)

  // --- Buys: allocate totalWethIn proportionally across ERC20 assets ---
  const buys: RebalancePreview['buys'] = []
  let wethAllocated = 0n

  for (let i = 0; i < erc20Assets.length; i++) {
    const asset = erc20Assets[i]
    const amountIn = i === erc20Assets.length - 1
      ? totalWethIn - wethAllocated   // last asset gets remainder to avoid rounding dust
      : (totalWethIn * BigInt(asset.weightBps)) / BigInt(totalErc20WeightBps)

    if (amountIn === 0n) continue
    wethAllocated += amountIn
    buys.push({ token: asset.token, amountIn, weightBps: asset.weightBps, poolFee: asset.poolFee })
  }

  // --- Assemble instructions: sells first, then buys ---
  const instructions: RebalanceInstruction[] = []

  for (const sell of sells) {
    const asset = erc20Assets.find(a => a.token === sell.token)!
    const amountOutMin = (sell.estimatedWeth * (10000n - SLIPPAGE_BPS)) / 10000n
    instructions.push({
      token:        sell.token,
      isSell:       true,
      amountIn:     sell.amountIn,
      amountOutMin,
      poolFee:      sell.poolFee,
      swapPath:     '0x',
      sellSwapPath: asset.sellSwapPath ?? '0x',
    })
  }

  for (const buy of buys) {
    instructions.push({
      token:        buy.token,
      isSell:       false,
      amountIn:     buy.amountIn,
      amountOutMin: 0n,  // slippage on buys is acceptable; keeper can tighten if needed
      poolFee:      buy.poolFee,
      swapPath:     '0x',
      sellSwapPath: '0x',
    })
  }

  return { instructions, sells, buys, totalWethIn, error: null }
}
