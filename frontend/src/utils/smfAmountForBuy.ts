/**
 * Compute the number of SMF tokens purchasable with `ethAmount` wei,
 * given the SMF bonding curve tiers and current supply.
 *
 * Mirrors the buy-curve logic in SmartfolioERC20._smfMintCost, walking
 * tiers upward from `currentSupply` and flooring to full-token increments.
 */
export function smfAmountForBuy(
  ethAmount: bigint,
  tiers: readonly { threshold: bigint; pricePerToken: bigint }[],
  currentSupply: bigint,
): bigint {
  if (tiers.length === 0 || ethAmount === 0n) return 0n

  let supply = currentSupply
  let ethRemaining = ethAmount
  let amount = 0n
  const lastTier = tiers.length - 1

  for (let i = 0; i < tiers.length && ethRemaining > 0n; i++) {
    const price = tiers[i].pricePerToken
    if (price === 0n) continue

    let tokensInTier: bigint
    if (i < lastTier) {
      const tierCap = tiers[i].threshold
      if (supply >= tierCap) continue
      tokensInTier = tierCap - supply
    } else {
      tokensInTier = ethRemaining / price // open-ended last tier
    }

    const maxEthInTier = tokensInTier * price
    const ethToUse = ethRemaining < maxEthInTier ? ethRemaining : maxEthInTier
    const bought = ethToUse / price
    amount += bought
    supply += bought
    ethRemaining -= bought * price
  }

  return amount
}
