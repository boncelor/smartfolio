import type { NFTRenderer } from './types.js'
import { StoneRenderer }  from './stone.js'
import { WoodRenderer }   from './wood.js'
import { CopperRenderer } from './copper.js'
import { SilverRenderer } from './silver.js'
import { GoldRenderer }   from './gold.js'
import { DeluxeRenderer } from './deluxe.js'

// Instantiated once per cold start — all renderers are stateless
const RENDERERS = {
  stone:  new StoneRenderer(),
  wood:   new WoodRenderer(),
  copper: new CopperRenderer(),
  silver: new SilverRenderer(),
  gold:   new GoldRenderer(),
  deluxe: new DeluxeRenderer(),
} as const

/**
 * Select a renderer based on portfolio status and SMF holdings.
 * @param active     Whether the portfolio has been deployed (portfolioActive)
 * @param smfAmount  Whole SMF tokens held (smfHoldingsRaw / 1e18)
 */
export function selectRenderer(active: boolean, smfAmount: number): NFTRenderer {
  if (!active || smfAmount === 0) return RENDERERS.stone
  if (smfAmount < 1)              return RENDERERS.wood
  if (smfAmount < 10)             return RENDERERS.copper
  if (smfAmount < 100)            return RENDERERS.silver
  if (smfAmount < 1000)           return RENDERERS.gold
  return RENDERERS.deluxe
}
