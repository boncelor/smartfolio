export interface AssetBar {
  label: string
  weightBps: number
  color: string
}

export interface Holding {
  label: string
  value: string
  color: string
}

export interface RenderContext {
  tokenId: number
  active: boolean
  smfAmount: number   // whole tokens (smfHoldingsRaw / 1e18), ready for display and thresholds
  bars: AssetBar[]
  holdings: Holding[]
}

export interface NFTRenderer {
  readonly styleName: string
  render(ctx: RenderContext): string  // returns SVG string
}
