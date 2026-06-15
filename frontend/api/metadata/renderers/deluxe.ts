import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class DeluxeRenderer implements NFTRenderer {
  readonly styleName = 'deluxe'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — deluxe style (SMF ≥ 1000)
//
// Palette: true black, deep purple shimmer (#4a1a8a), platinum (#e8e0f0),
// gold (#d4af37). Iridescent gold→purple→teal gradient overlay. Per-bar
// gradients from original color to purple. Four-pointed diamond star top-right.
// Quad border: outer purple glow, gold line, gap, inner purple hairline.
// Platinum-white text with gold token ID. Maximum visual complexity.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Deluxe palette
const D = {
  bg0:          '#050407',   // true black
  bg1:          '#08060c',   // near-black purple
  bg2:          '#0a0810',   // deep purple-black
  border:       '#7a3abf',   // mid purple
  borderGold:   '#d4af37',   // gold
  borderDim:    '#3a1a60',   // dark purple
  accent:       '#d4af37',   // gold
  purple:       '#9060d0',   // bright purple
  teal:         '#30b0a0',   // iridescent teal
  textPrimary:  '#e8e0f0',   // platinum
  textGold:     '#d4af37',   // gold
  textDim:      '#6040a0',   // muted purple
  textValue:    '#f0ecf8',   // near-white platinum
  barTrack:     '#0a080f',   // very dark track
} as const

// Map asset colors → iridescent versions (desaturated toward purple)
function deluxeBarColor(assetColor: string): string {
  const map: Record<string, string> = {
    '#d4af37': '#d4af37',  // SMF gold → keep gold (signature)
    '#34d399': '#50d0b0',  // ERC20 green → iridescent teal
    '#60a5fa': '#80a0e0',  // AAVE blue → cool periwinkle
    '#2dd4bf': '#40c8c0',  // LP teal → bright teal
    '#94a3b8': '#b0a0d0',  // ETH silver → lavender silver
    '#a78bfa': '#c0a0f8',  // STAKING purple → bright purple
  }
  return map[assetColor] ?? '#9060d0'
}

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? '#50d0a0' : D.purple
  const statusLabel  = active ? 'Portfolio Active' : 'Reserve Mode'
  const statusBadgeW = active ? 142 : 120

  const LEFT    = 40
  const RIGHT   = 460
  const W       = 500
  const BAR_X   = 135
  const BAR_W   = 240
  const BAR_H   = 17
  const BAR_ROW = 40
  const PCT_X   = 388

  const headerH = 172
  const allocH  = 28 + bars.length * BAR_ROW + 16
  const holdH   = holdings.length > 0 ? 28 + Math.ceil(holdings.length / 2) * 40 + 10 : 0
  const footerH = 52
  const totalH  = Math.max(headerH + allocH + 28 + holdH + footerH, 520)

  const yTopLine    = 42
  const yTitle      = 68
  const yId         = 116
  const yBadge      = 142
  const yDiv1       = 170
  const yAllocLbl   = yDiv1 + 22
  const yBarsStart  = yAllocLbl + 16
  const yDiv2       = yBarsStart + bars.length * BAR_ROW + 10
  const yHoldLbl    = yDiv2 + 24
  const yHoldStart  = yHoldLbl + 20
  const yBottomLine = totalH - 42

  // Per-bar gradient defs: each bar gets original color → purple iridescent
  const barGradDefs = bars.map((bar: AssetBar, i: number) => {
    const col = deluxeBarColor(bar.color)
    return `<linearGradient id="dg${i}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${col}"/>
      <stop offset="70%"  stop-color="${D.purple}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${D.teal}"   stop-opacity="0.6"/>
    </linearGradient>`
  }).join('\n    ')

  // Allocation bars — iridescent per-bar gradients
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    const col   = deluxeBarColor(bar.color)
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${D.barTrack}" stroke="${D.borderDim}" stroke-width="0.5" stroke-opacity="0.5"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="url(#dg${i})" fill-opacity="0.8"/>
  <line x1="${BAR_X + 2}" y1="${by + 3}" x2="${BAR_X + Math.max(fillW - 4, 0)}" y2="${by + 3}"
    stroke="white" stroke-opacity="0.15" stroke-width="1"/>
  <text x="${PCT_X}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" text-anchor="end">${pct}</text>`
  }).join('')

  // Holdings grid
  const holdSvg = holdings.map((h: Holding, i: number) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${D.textDim}" fill-opacity="0.9" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${D.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Four-pointed diamond star top-right
  const stx = W - 52
  const sty = 52
  const starSize = 22
  const starInner = 8
  const starPoints = [0, 90, 180, 270].map(angle => {
    const outerRad = (angle * Math.PI) / 180
    const innerRad1 = ((angle + 45) * Math.PI) / 180
    const ox = stx + Math.cos(outerRad) * starSize
    const oy = sty + Math.sin(outerRad) * starSize
    const ix = stx + Math.cos(innerRad1) * starInner
    const iy = sty + Math.sin(innerRad1) * starInner
    return `${ox.toFixed(1)},${oy.toFixed(1)} ${ix.toFixed(1)},${iy.toFixed(1)}`
  }).join(' ')
  const diamondStar = `
  <!-- Diamond star glow -->
  <polygon points="${starPoints}" fill="${D.purple}" fill-opacity="0.15"/>
  <polygon points="${starPoints}" fill="none" stroke="${D.accent}" stroke-width="0.75" stroke-opacity="0.5"/>
  <circle cx="${stx}" cy="${sty}" r="3" fill="${D.accent}" fill-opacity="0.7"/>
  <!-- Outer glow rings -->
  <circle cx="${stx}" cy="${sty}" r="${starSize + 4}" fill="none"
    stroke="${D.purple}" stroke-opacity="0.1" stroke-width="2"/>
  <circle cx="${stx}" cy="${sty}" r="${starSize + 10}" fill="none"
    stroke="${D.purple}" stroke-opacity="0.05" stroke-width="3"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <!-- True-black to deep purple background -->
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%"   stop-color="${D.bg0}"/>
      <stop offset="60%"  stop-color="${D.bg2}"/>
      <stop offset="100%" stop-color="${D.bg1}"/>
    </linearGradient>
    <!-- Iridescent overlay: gold → purple → teal -->
    <linearGradient id="iris" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${D.accent}" stop-opacity="0.07"/>
      <stop offset="40%"  stop-color="${D.purple}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${D.teal}"   stop-opacity="0.04"/>
    </linearGradient>
    <clipPath id="card-clip">
      <rect width="${W}" height="${totalH}" rx="24"/>
    </clipPath>
    ${barGradDefs}
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <!-- Iridescent overlay -->
  <rect width="${W}" height="${totalH}" rx="24" fill="url(#iris)"/>

  <!-- Quad border: purple outer glow, gold line, gap, inner purple hairline -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${D.borderGold}" stroke-opacity="0.55" stroke-width="1.5"/>
  <rect x="4" y="4" width="${W - 8}" height="${totalH - 8}" rx="22"
    fill="none" stroke="${D.border}" stroke-opacity="0.25" stroke-width="1"/>
  <rect x="8" y="8" width="${W - 16}" height="${totalH - 16}" rx="20"
    fill="none" stroke="${D.borderDim}" stroke-opacity="0.2" stroke-width="0.5"/>

  <!-- Diamond star decoration -->
  ${diamondStar}

  <!-- Top accent bar — gold with purple fade -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="2" rx="0.75"
    fill="${D.accent}" fill-opacity="0.5"/>
  <rect x="${LEFT + 280}" y="${yTopLine}" width="140" height="2" rx="0.75"
    fill="${D.purple}" fill-opacity="0.3"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${D.textDim}" fill-opacity="0.9" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID — gold -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${D.textGold}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="5"
    fill="${statusColor}" fill-opacity="0.1"
    stroke="${statusColor}" stroke-opacity="0.35" stroke-width="0.75"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${statusColor}" fill-opacity="0.9"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 — purple with gold shimmer -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${D.border}" stroke-opacity="0.3" stroke-width="0.75"/>
  <line x1="${LEFT}" y1="${yDiv1 + 2}" x2="${LEFT + 60}" y2="${yDiv1 + 2}"
    stroke="${D.accent}" stroke-opacity="0.2" stroke-width="0.5"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${D.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${D.border}" stroke-opacity="0.2" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${D.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Bottom accent — gold + purple double line -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1.5"
    fill="${D.accent}" fill-opacity="0.35"/>
  <rect x="${LEFT}" y="${yBottomLine + 4}" width="420" height="0.5"
    fill="${D.purple}" fill-opacity="0.2"/>

  <!-- Style badge — gold -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${D.textGold}" fill-opacity="0.5" letter-spacing="2" text-anchor="end"
    font-weight="600">DELUXE</text>
</svg>`
}
