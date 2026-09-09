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
 * Read the splash backgrounds the loader animation is matted against.
 *
 * The loader GIFs bake these colors into their anti-aliased edges, so page and
 * artwork may not drift apart. Both colors are read from the page instead of
 * being duplicated here, and each has to be declared exactly once.
 * @param sourceText - splash.html contents.
 * @returns `{ light, dark }` matte colors.
 */
export function readSplashMattes(sourceText) {
  return {
    light: readUniqueColor(sourceText, '--splash-matte-light'),
    dark: readUniqueColor(sourceText, '--splash-matte-dark')
  }
}

/**
 * @param sourceText - source to scan.
 * @param name - custom property name.
 * @returns the one declared hex color.
 */
function readUniqueColor(sourceText, name) {
  // The leading boundary is what keeps `--splash-matte-light` from being
  // satisfied by a longer property that merely ends with it.
  const pattern = new RegExp(
    `(?<![-\\w])${escapeRegExp(name)}\\s*:\\s*(#[0-9a-fA-F]{6})`,
    'gu'
  )
  const matches = [...sourceText.matchAll(pattern)].map((match) => match[1])
  if (matches.length !== 1) {
    throw new Error(
      `Could not read the splash matte from splash.html: expected exactly one "${name}: #rrggbb" declaration, found ${String(matches.length)}`
    )
  }
  return matches[0]
}

/**
 * A custom property name is CSS, not a pattern, so anything the engine reads
 * specially has to lose that reading. `-` is literal outside a character class
 * and stays untouched — escaping it would itself be an invalid `\u` escape.
 * @param text - string to use inside a RegExp.
 * @returns the same string with every metacharacter escaped.
 */
function escapeRegExp(text) {
  return text.replace(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)
}

/**
 * @param width - canvas width.
 * @param height - canvas height.
 * @param padding - inset in canvas pixels.
 * @returns uniform scale and the whale size it produces.
 */
function fitWhale(width, height, padding) {
  const scale = Math.min(
    (width - padding * 2) / FISH_LOGO_VIEWBOX.width,
    (height - padding * 2) / FISH_LOGO_VIEWBOX.height
  )
  return {
    scale,
    whaleWidth: FISH_LOGO_VIEWBOX.width * scale,
    whaleHeight: FISH_LOGO_VIEWBOX.height * scale
  }
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
  const { scale, whaleWidth, whaleHeight } = fitWhale(width, height, padding)
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
 * Light rounded tile with the official black whale.
 * @param options.size - square edge in pixels.
 * @param options.path - FISH_LOGO_PATH.
 * @returns SVG markup.
 */
export function whaleAppIconSvg({ size, path: whalePath }) {
  const inset = size * (88 / 1024)
  const tile = size - inset * 2
  const radius = tile * 0.26
  const mark = whaleMarkSvg({
    fill: '#000000',
    width: tile,
    height: tile,
    path: whalePath,
    padding: tile * 0.16
  })
  const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/u, '').replace(/<\/svg>\s*$/u, '')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">
  <rect x="${String(inset)}" y="${String(inset)}" width="${String(tile)}" height="${String(tile)}" rx="${String(radius)}" fill="#ffffff"/>
  <g transform="translate(${String(inset)} ${String(inset)})">
    ${inner}
  </g>
</svg>`
}

/**
 * Startup loader: the official whale drifting on a slow swell, drawn into the
 * 16:9 slot the splash has always used.
 *
 * The canvas is deliberately far larger than the 196 CSS px the splash renders
 * it at. The GIF carries one-bit transparency and no partial alpha, so every
 * edge pixel the renderer leaves behind is one the page has to rescue; drawing
 * at roughly 3x lets the page's own downscale do the final anti-aliasing.
 * Shrinking the canvas saves a few dozen kilobytes and spends that edge.
 */
export const SPLASH_LOADER = Object.freeze({
  width: 640,
  height: 360,
  padding: 40,
  frames: 40,
  delayMs: 50,
  offsetY: 14,
  rotateDeg: 2.2
})

/**
 * Sample one whole period of the swim cycle.
 *
 * The whale rises through the middle of its travel and pitches up at the top
 * of it, a quarter period apart, so the motion reads as swimming. Sampling
 * `count` points across exactly one period (and never the repeated endpoint)
 * is what makes the GIF loop without a hitch.
 * @param options.count - frames per loop.
 * @param options.offsetY - vertical travel in canvas pixels.
 * @param options.rotateDeg - pitch amplitude in degrees.
 * @param options.delayMs - per-frame delay, on the GIF centisecond grid.
 * @returns frame steps for `whaleLoaderFrameSvg` and the GIF encoder.
 */
export function whaleLoaderFrames({
  count = SPLASH_LOADER.frames,
  offsetY = SPLASH_LOADER.offsetY,
  rotateDeg = SPLASH_LOADER.rotateDeg,
  delayMs = SPLASH_LOADER.delayMs
} = {}) {
  if (!Number.isInteger(count) || count < 4) {
    throw new Error(`Loader frame count must be an integer of at least 4, got ${String(count)}`)
  }
  if (!Number.isFinite(offsetY) || offsetY < 0) {
    throw new Error(`Loader travel must be a finite non-negative offset, got ${String(offsetY)}`)
  }
  if (!Number.isFinite(rotateDeg) || Math.abs(rotateDeg) >= 90) {
    throw new Error(`Loader pitch must stay under 90 degrees, got ${String(rotateDeg)}`)
  }
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    throw new Error(`Loader frame delay must be positive, got ${String(delayMs)}`)
  }
  // GIF counts delay in whole centiseconds, so a 33 ms request would be encoded
  // as 30 ms and the loop would silently run shorter than the log claims.
  if (!Number.isInteger(delayMs / 10)) {
    throw new Error(`Loader frame delay must be a whole number of centiseconds, got ${String(delayMs)}`)
  }
  return Array.from({ length: count }, (_unused, index) => {
    const phase = (Math.PI * 2 * index) / count
    return {
      offsetY: offsetY * Math.sin(phase),
      rotateDeg: rotateDeg * Math.cos(phase),
      delayMs
    }
  })
}

/**
 * One loader frame: the whale pitched about its own center and drifted down
 * the canvas, so the composition never slides sideways.
 * @param options.fill - path fill color.
 * @param options.width - canvas width.
 * @param options.height - canvas height.
 * @param options.path - FISH_LOGO_PATH.
 * @param options.padding - inset in canvas pixels.
 * @param options.offsetY - vertical drift in canvas pixels.
 * @param options.rotateDeg - pitch in degrees.
 * @returns SVG markup.
 */
export function whaleLoaderFrameSvg({
  fill,
  width,
  height,
  path: whalePath,
  padding,
  offsetY = 0,
  rotateDeg = 0
}) {
  const { scale } = fitWhale(width, height, padding)
  const center = `${String(width / 2)} ${String(height / 2 + offsetY)}`
  const origin = `${String(-FISH_LOGO_VIEWBOX.width / 2)} ${String(-FISH_LOGO_VIEWBOX.height / 2)}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">
  <g transform="translate(${center}) rotate(${String(rotateDeg)}) scale(${String(scale)}) translate(${origin})">
    <path d="${whalePath}" fill="${fill}"/>
  </g>
</svg>`
}

/**
 * The box the whale sweeps across the whole loop.
 *
 * Rasterizing 40 frames to discover that the pitch clips the canvas is a slow
 * way to learn it, so the swept extents are computed from the same transform.
 * @param options.width - canvas width.
 * @param options.height - canvas height.
 * @param options.padding - inset in canvas pixels.
 * @param options.offsetY - vertical travel in canvas pixels.
 * @param options.rotateDeg - pitch amplitude in degrees.
 * @returns the tightest canvas inset the animation keeps, per edge.
 */
export function whaleLoaderSweep({
  width,
  height,
  padding,
  offsetY,
  rotateDeg
}) {
  const { whaleWidth, whaleHeight } = fitWhale(width, height, padding)
  const radians = (Math.abs(rotateDeg) * Math.PI) / 180
  const halfWidth = whaleWidth / 2
  const halfHeight = whaleHeight / 2
  // The whale turns about its own center, so the swept box stays symmetric and
  // one inset per axis says the whole story.
  const sweptHalfWidth = Math.abs(halfWidth * Math.cos(radians))
    + Math.abs(halfHeight * Math.sin(radians))
  const sweptHalfHeight = Math.abs(halfWidth * Math.sin(radians))
    + Math.abs(halfHeight * Math.cos(radians))
    + Math.abs(offsetY)
  const horizontal = width / 2 - sweptHalfWidth
  const vertical = height / 2 - sweptHalfHeight
  return { horizontal, vertical, minimumInset: Math.min(horizontal, vertical) }
}
