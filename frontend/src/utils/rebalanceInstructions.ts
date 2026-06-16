import { type PublicClient } from 'viem'
import { QUOTER_V2_ADDRESS, QUOTER_V2_ABI, SMF_ADDRESS } from '../contracts'

export interface PortfolioAsset {
  assetType: number    // 0=ERC20, 1=AAVE, 2=LP, 3=SMF, 4=STAKING, 5=ETH
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

export interface SellEntry {
  token: string
  label: string
  amountIn: bigint        // token wei for ERC20; SMF wei for SMF
  estimatedEth: bigint
  poolFee: number
  isSMF: boolean
}

export interface BuyEntry {
  token: string
  label: string
  amountIn: bigint        // ETH wei to spend
  weightBps: number
  poolFee: number
  isSMF: boolean
}

export interface RebalancePreview {
  instructions: RebalanceInstruction[]
  sells: SellEntry[]
  buys: BuyEntry[]
  totalEthIn: bigint      // ETH accumulated from all sells → reserve
  error: string | null
}

const SLIPPAGE_BPS = 50n  // 0.5%

/**
 * Build rebalanceAll instructions for a full portfolio rebalance.
 *
 * Flow:
 *   1. Sell overweight SMF via bonding curve → ETH → reserve
 *   2. Sell overweight ERC20s via Uniswap → WETH → ETH → reserve
 *   3. Buy underweight ERC20s with ETH from reserve
 *   4. Buy underweight SMF last with ETH from reserve via bonding curve
 *
 * Total portfolio value is estimated from: SMF holdings (via smfBurnValue),
 * ERC20 holdings (via Uniswap quotes), and ETH in reserve. AAVE and LP
 * slices are excluded from rebalancing.
 *
 * @param config          Portfolio config from getPortfolioConfig()
 * @param smfHoldings     Current portfolioSMFHoldings[id] in wei
 * @param erc20Holdings   Map of token address (lowercase) → current holding in wei
 * @param ethReserve      Current reserve[id] in wei (ETH sitting undeployed)
 * @param wethAddress     WETH contract address
 * @param publicClient    viem PublicClient (for quotes)
 * @param smfBurnValueFn  Function to get ETH value for selling N whole SMF tokens
 */
export async function buildRebalanceAllInstructions(
  config: PortfolioAsset[],
  smfHoldings: bigint,
  erc20Holdings: Record<string, bigint>,
  ethReserve: bigint,
  wethAddress: string,
  publicClient: PublicClient,
  smfBurnValueFn: (wholeTokens: bigint) => Promise<bigint>,
): Promise<RebalancePreview> {

  const smfAsset  = config.find(a => a.assetType === 3)
  const erc20Assets = config.filter(a => a.assetType === 0)
  const totalBps  = config.reduce((s, a) => s + a.weightBps, 0)

  // ---- Step 1: value all current holdings ----

  // SMF value: convert holdings to whole tokens, get ETH from bonding curve
  const smfWholeTokens = smfHoldings / BigInt(1e18)
  let smfEthValue = 0n
  if (smfWholeTokens > 0n) {
    try {
      smfEthValue = await smfBurnValueFn(smfWholeTokens)
    } catch {
      return { instructions: [], sells: [], buys: [], totalEthIn: 0n,
        error: 'Could not get SMF sell quote from bonding curve.' }
    }
  }

  // ERC20 values: quote each via Uniswap
  const erc20EthValues: Record<string, bigint> = {}
  for (const asset of erc20Assets) {
    const holding = erc20Holdings[asset.token.toLowerCase()] ?? 0n
    if (holding === 0n) { erc20EthValues[asset.token.toLowerCase()] = 0n; continue }
    try {
      const result = await publicClient.simulateContract({
        address: QUOTER_V2_ADDRESS,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: asset.token as `0x${string}`,
          tokenOut: wethAddress as `0x${string}`,
          amountIn: holding,
          fee: asset.poolFee,
          sqrtPriceLimitX96: 0n,
        }],
      })
      erc20EthValues[asset.token.toLowerCase()] = result.result[0]
    } catch {
      return { instructions: [], sells: [], buys: [], totalEthIn: 0n,
        error: `Could not get Uniswap quote for token ${asset.token}.` }
    }
  }

  const totalEthValue = smfEthValue + Object.values(erc20EthValues).reduce((s, v) => s + v, 0n) + ethReserve

  if (totalEthValue === 0n) {
    return { instructions: [], sells: [], buys: [], totalEthIn: 0n,
      error: 'Portfolio has no rebalanceable value (no SMF, ERC20 holdings, or ETH reserve).' }
  }

  // ---- Step 2: compute targets ----

  // SMF target ETH value
  const smfTargetEth = smfAsset
    ? (totalEthValue * BigInt(smfAsset.weightBps)) / BigInt(totalBps)
    : 0n

  // ERC20 targets
  const erc20Targets: { asset: PortfolioAsset; targetEth: bigint; currentEth: bigint }[] = erc20Assets.map(a => ({
    asset: a,
    targetEth: (totalEthValue * BigInt(a.weightBps)) / BigInt(totalBps),
    currentEth: erc20EthValues[a.token.toLowerCase()] ?? 0n,
  }))

  // ETH reserve target (ETH-slice assets stay in reserve — not touched here)
  // We treat the current ethReserve as available capital for rebalancing

  // ---- Step 3: build sell instructions ----

  const sells: SellEntry[] = []
  const buys: BuyEntry[] = []
  const instructions: RebalanceInstruction[] = []

  // SMF sell (if overweight)
  if (smfAsset && smfEthValue > smfTargetEth && smfWholeTokens > 0n) {
    const excessEth = smfEthValue - smfTargetEth
    // Determine how many whole SMF tokens to sell to cover excessEth
    // Approximate: sell proportional fraction of holdings
    const tokensToSell = (smfWholeTokens * excessEth) / smfEthValue
    if (tokensToSell > 0n) {
      let sellEthEstimate = 0n
      try { sellEthEstimate = await smfBurnValueFn(tokensToSell) } catch { /* ignore */ }
      const minEthOut = (sellEthEstimate * (10000n - SLIPPAGE_BPS)) / 10000n

      sells.push({
        token:         SMF_ADDRESS,
        label:         'SMF',
        amountIn:      tokensToSell * BigInt(1e18),  // back to wei for instruction
        estimatedEth:  sellEthEstimate,
        poolFee:       0,
        isSMF:         true,
      })
      instructions.push({
        token:        SMF_ADDRESS,
        isSell:       true,
        amountIn:     tokensToSell * BigInt(1e18),
        amountOutMin: minEthOut,
        poolFee:      0,
        swapPath:     '0x',
        sellSwapPath: '0x',
      })
    }
  }

  // ERC20 sells (if overweight)
  for (const { asset, targetEth, currentEth } of erc20Targets) {
    if (currentEth <= targetEth) continue
    const holding = erc20Holdings[asset.token.toLowerCase()] ?? 0n
    if (holding === 0n) continue

    // Sell the fraction of holdings proportional to excess value
    const tokensToSell = (holding * (currentEth - targetEth)) / currentEth
    if (tokensToSell === 0n) continue

    const estimatedEth = erc20EthValues[asset.token.toLowerCase()] ?? 0n
    const estimatedSellEth = (estimatedEth * (currentEth - targetEth)) / currentEth
    const minEthOut = (estimatedSellEth * (10000n - SLIPPAGE_BPS)) / 10000n

    sells.push({
      token:        asset.token,
      label:        asset.token.slice(0, 8) + '…',
      amountIn:     tokensToSell,
      estimatedEth: estimatedSellEth,
      poolFee:      asset.poolFee,
      isSMF:        false,
    })
    instructions.push({
      token:        asset.token,
      isSell:       true,
      amountIn:     tokensToSell,
      amountOutMin: minEthOut,
      poolFee:      asset.poolFee,
      swapPath:     '0x',
      sellSwapPath: asset.sellSwapPath ?? '0x',
    })
  }

  const totalEthIn = sells.reduce((s, e) => s + e.estimatedEth, 0n) + ethReserve

  // ---- Step 4: build buy instructions (ERC20 first, SMF last) ----

  let ethAvailable = totalEthIn

  // ERC20 buys (underweight)
  for (const { asset, targetEth, currentEth } of erc20Targets) {
    if (currentEth >= targetEth) continue
    const ethToBuy = targetEth - currentEth
    const actualEthToBuy = ethToBuy > ethAvailable ? ethAvailable : ethToBuy
    if (actualEthToBuy === 0n) continue

    ethAvailable -= actualEthToBuy
    buys.push({
      token:    asset.token,
      label:    asset.token.slice(0, 8) + '…',
      amountIn: actualEthToBuy,
      weightBps: asset.weightBps,
      poolFee:  asset.poolFee,
      isSMF:   false,
    })
    instructions.push({
      token:        asset.token,
      isSell:       false,
      amountIn:     actualEthToBuy,
      amountOutMin: 0n,
      poolFee:      asset.poolFee,
      swapPath:     asset.swapPath ?? '0x',
      sellSwapPath: '0x',
    })
  }

  // SMF buy last (underweight)
  if (smfAsset && smfEthValue < smfTargetEth && ethAvailable > 0n) {
    const ethToBuy = smfTargetEth - smfEthValue
    const actualEthToBuy = ethToBuy > ethAvailable ? ethAvailable : ethToBuy

    buys.push({
      token:    SMF_ADDRESS,
      label:    'SMF',
      amountIn: actualEthToBuy,
      weightBps: smfAsset.weightBps,
      poolFee:  0,
      isSMF:   true,
    })
    instructions.push({
      token:        SMF_ADDRESS,
      isSell:       false,
      amountIn:     actualEthToBuy,
      amountOutMin: 0n,   // contract auto-computes 1% slippage for SMF buys
      poolFee:      0,
      swapPath:     '0x',
      sellSwapPath: '0x',
    })
  }

  if (instructions.length === 0) {
    return { instructions: [], sells: [], buys: [], totalEthIn: 0n,
      error: 'Portfolio is already balanced — no rebalancing needed.' }
  }

  return { instructions, sells, buys, totalEthIn, error: null }
}

// ---------------------------------------------------------------------------
// Legacy ERC20-only builder (kept for reference — buildRebalanceAllInstructions
// supersedes this for full rebalances)
// ---------------------------------------------------------------------------

export interface RebalancePreviewLegacy {
  instructions: RebalanceInstruction[]
  sells: { token: string; amountIn: bigint; estimatedWeth: bigint; poolFee: number }[]
  buys:  { token: string; amountIn: bigint; weightBps: number; poolFee: number }[]
  totalWethIn: bigint
  error: string | null
}

export async function buildRebalanceInstructions(
  config: PortfolioAsset[],
  holdings: Record<string, bigint>,
  wethAddress: string,
  publicClient: PublicClient,
): Promise<RebalancePreviewLegacy> {
  const erc20Assets = config.filter(a => a.assetType === 0)

  if (erc20Assets.length === 0) {
    return { instructions: [], sells: [], buys: [], totalWethIn: 0n, error: 'No ERC20 assets in config to rebalance.' }
  }

  const sells: RebalancePreviewLegacy['sells'] = []
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
      return { instructions: [], sells: [], buys: [], totalWethIn: 0n,
        error: `Could not get quote for ${asset.token} — pool may not have liquidity on this network.` }
    }

    sells.push({ token: asset.token, amountIn, estimatedWeth, poolFee: asset.poolFee })
    totalWethIn += estimatedWeth
  }

  if (totalWethIn === 0n) {
    return { instructions: [], sells: [], buys: [], totalWethIn: 0n, error: 'No ERC20 holdings to rebalance.' }
  }

  const totalErc20WeightBps = erc20Assets.reduce((s, a) => s + a.weightBps, 0)
  const buys: RebalancePreviewLegacy['buys'] = []
  let wethAllocated = 0n

  for (let i = 0; i < erc20Assets.length; i++) {
    const asset = erc20Assets[i]
    const amountIn = i === erc20Assets.length - 1
      ? totalWethIn - wethAllocated
      : (totalWethIn * BigInt(asset.weightBps)) / BigInt(totalErc20WeightBps)
    if (amountIn === 0n) continue
    wethAllocated += amountIn
    buys.push({ token: asset.token, amountIn, weightBps: asset.weightBps, poolFee: asset.poolFee })
  }

  const instructions: RebalanceInstruction[] = []

  for (const sell of sells) {
    const asset = erc20Assets.find(a => a.token === sell.token)!
    const amountOutMin = (sell.estimatedWeth * (10000n - SLIPPAGE_BPS)) / 10000n
    instructions.push({
      token: sell.token, isSell: true, amountIn: sell.amountIn, amountOutMin,
      poolFee: sell.poolFee, swapPath: '0x', sellSwapPath: asset.sellSwapPath ?? '0x',
    })
  }

  for (const buy of buys) {
    instructions.push({
      token: buy.token, isSell: false, amountIn: buy.amountIn, amountOutMin: 0n,
      poolFee: buy.poolFee, swapPath: '0x', sellSwapPath: '0x',
    })
  }

  return { instructions, sells, buys, totalWethIn, error: null }
}
