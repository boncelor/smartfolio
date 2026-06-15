import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class GoldRenderer implements NFTRenderer {
  readonly styleName = 'gold'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — stone style (baseline)
// Visual treatment: placeholder — to be defined later
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? '#34d399' : '#d4af37'
  const statusLabel  = active ? 'Portfolio Active' : 'Reserve Mode'
  const statusBadgeW = active ? 140 : 118

  const LEFT   = 40
  const RIGHT  = 460
  const W      = 500
  const BAR_X  = 135
  const BAR_W  = 240
  const BAR_H  = 18
  const BAR_ROW = 40
  const PCT_X  = 388

  const headerH = 172
  const allocH  = 28 + bars.length * BAR_ROW + 16
  const holdH   = 28 + Math.ceil(holdings.length / 2) * 40 + 10
  const footerH = 48
  const totalH  = Math.max(headerH + allocH + 28 + holdH + footerH, 520)

  const yTopLine   = 42
  const yTitle     = 68
  const yId        = 116
  const yBadge     = 142
  const yDiv1      = 170
  const yAllocLbl  = yDiv1 + 22
  const yBarsStart = yAllocLbl + 16
  const yDiv2      = yBarsStart + bars.length * BAR_ROW + 10
  const yHoldLbl   = yDiv2 + 24
  const yHoldStart = yHoldLbl + 20
  const yBottomLine = totalH - 38

  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    return `
  <text x="${LEFT}" y="${by + 14}" font-family="sans-serif" font-size="11.5"
    fill="${bar.color}" font-weight="700" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by + 1}" width="${BAR_W}" height="${BAR_H}" rx="4"
    fill="${bar.color}" fill-opacity="0.08"/>
  <rect x="${BAR_X}" y="${by + 1}" width="${fillW}" height="${BAR_H}" rx="4"
    fill="${bar.color}" fill-opacity="0.65"/>
  <text x="${PCT_X}" y="${by + 14}" font-family="sans-serif" font-size="11.5"
    fill="${bar.color}" fill-opacity="0.9" font-weight="700" text-anchor="end">${pct}</text>`
  }).join('')

  const holdSvg = holdings.map((h: Holding, i: number) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${h.color}" fill-opacity="0.55" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="#f3e5ab" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#12110a"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#d4af37" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#d4af37" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <rect width="${W}" height="${totalH}" fill="url(#shine)" rx="24"/>
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="#d4af37" stroke-opacity="0.3" stroke-width="1.5"/>
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="1.5" rx="1"
    fill="#d4af37" fill-opacity="0.45"/>
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="3" font-weight="600">SMARTFOLIO</text>
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="#f3e5ab" font-weight="bold">#${tokenId}</text>
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="11"
    fill="${statusColor}" fill-opacity="0.12"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="4"
    fill="${statusColor}" fill-opacity="0.9"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="#d4af37" stroke-opacity="0.15" stroke-width="1"/>
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="#d4af37" fill-opacity="0.45" letter-spacing="2.5" font-weight="600">ALLOCATION</text>
  ${barsSvg}
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="#d4af37" stroke-opacity="0.12" stroke-width="1"/>
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="#d4af37" fill-opacity="0.45" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1" rx="0.5"
    fill="#d4af37" fill-opacity="0.2"/>
</svg>`
}
