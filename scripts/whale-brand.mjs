export const FISH_LOGO_VIEWBOX = { width: 23.16, height: 17.04 }

/**
 * Official DeepSeek whale path from Harness FishLogo.
 * @param sourceText - FishLogo.d.ts contents.
 * @returns SVG path data.
 */
export function readFishLogoPath(sourceText) {
  const match = sourceText.match(/FISH_LOGO_PATH = "([^"]+)"/u)
  if (!match) throw new Error('Could not read FISH_LOGO_PATH from FishLogo.d.ts')
  return match[1]
}

/**
 * Center the official whale in a canvas.
 * @param options.fill - path fill color.
 * @param options.width - canvas width.
 * @param options.height - canvas height.
 * @param options.path - FISH_LOGO_PATH.
 * @param options.padding - inset in canvas pixels.
 * @returns SVG markup.
 */
export function whaleMarkSvg({ fill, width, height, path: whalePath, padding }) {
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2
  const scale = Math.min(
    innerWidth / FISH_LOGO_VIEWBOX.width,
    innerHeight / FISH_LOGO_VIEWBOX.height
  )
  const whaleWidth = FISH_LOGO_VIEWBOX.width * scale
  const whaleHeight = FISH_LOGO_VIEWBOX.height * scale
  const x = (width - whaleWidth) / 2
  const y = (height - whaleHeight) / 2
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">
  <g transform="translate(${String(x)} ${String(y)}) scale(${String(scale)})">
    <path d="${whalePath}" fill="${fill}"/>
  </g>
</svg>`
}

/**
 * Dark rounded tile with a white whale, matching the previous app-icon chrome.
 * @param options.size - square edge in pixels.
 * @param options.path - FISH_LOGO_PATH.
 * @returns SVG markup.
 */
export function whaleAppIconSvg({ size, path: whalePath }) {
  const inset = size * (88 / 1024)
  const tile = size - inset * 2
  const radius = tile * 0.26
  const mark = whaleMarkSvg({
    fill: '#ffffff',
    width: tile,
    height: tile,
    path: whalePath,
    padding: tile * 0.18
  })
  const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/u, '').replace(/<\/svg>\s*$/u, '')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">
  <rect x="${String(inset)}" y="${String(inset)}" width="${String(tile)}" height="${String(tile)}" rx="${String(radius)}" fill="#111213"/>
  <g transform="translate(${String(inset)} ${String(inset)})">
    ${inner}
  </g>
</svg>`
}
