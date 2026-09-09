import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  FISH_LOGO_VIEWBOX,
  SPLASH_LOADER,
  readFishLogoPath,
  readSplashMattes,
  whaleLoaderFrameSvg,
  whaleLoaderFrames,
  whaleLoaderSweep
} from '../scripts/whale-brand.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const loaderCanvas = {
  width: SPLASH_LOADER.width,
  height: SPLASH_LOADER.height,
  padding: SPLASH_LOADER.padding,
  offsetY: SPLASH_LOADER.offsetY,
  rotateDeg: SPLASH_LOADER.rotateDeg
}

/**
 * Read what an animated GIF actually promises a browser: frame count, per-frame
 * delay, disposal, and the loop count. Written by hand because a decoder would
 * only prove the file opens, and none of these are its job.
 * @param bytes - GIF file contents.
 * @returns the header facts the splash depends on.
 */
function readGifHeader(bytes) {
  const signature = bytes.subarray(0, 6).toString('latin1')
  const screen = bytes[10]
  let cursor = 13
  if (screen & 0x80) cursor += 3 * (2 << (screen & 7))
  /** @type {Array<{delayCs: number, disposal: number, transparent: boolean, rect: number[]}>} */
  const frames = []
  let loopCount = null
  while (cursor < bytes.length) {
    const marker = bytes[cursor]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = bytes[cursor + 1]
      const blocks = readSubBlocks(bytes, cursor + 2)
      if (label === 0xf9) {
        const graphic = blocks[0]
        frames.push({
          delayCs: graphic.readUInt16LE(1),
          disposal: (graphic[0] >> 2) & 7,
          transparent: (graphic[0] & 1) === 1,
          rect: null
        })
      } else if (label === 0xff && blocks[0]?.subarray(0, 11).toString('latin1') === 'NETSCAPE2.0') {
        loopCount = blocks[1]?.readUInt16LE(1) ?? null
      }
      cursor = endOfSubBlocks(bytes, cursor + 2)
      continue
    }
    if (marker === 0x2c) {
      const rect = [
        bytes.readUInt16LE(cursor + 1),
        bytes.readUInt16LE(cursor + 3),
        bytes.readUInt16LE(cursor + 5),
        bytes.readUInt16LE(cursor + 7)
      ]
      const localTable = bytes[cursor + 9]
      cursor += 10
      if (localTable & 0x80) cursor += 3 * (2 << (localTable & 7))
      cursor = endOfSubBlocks(bytes, cursor + 1)
      frames[frames.length - 1].rect = rect
      continue
    }
    throw new Error(`Unexpected GIF block marker 0x${marker.toString(16)} at ${String(cursor)}`)
  }
  return { signature, width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), frames, loopCount }
}

/**
 * @param bytes - GIF file contents.
 * @param start - offset of the first sub-block length byte.
 * @returns every non-empty sub-block in the run.
 */
function readSubBlocks(bytes, start) {
  const blocks = []
  let cursor = start
  while (bytes[cursor] !== 0) {
    const size = bytes[cursor]
    blocks.push(bytes.subarray(cursor + 1, cursor + 1 + size))
    cursor += size + 1
  }
  return blocks
}

/**
 * @param bytes - GIF file contents.
 * @param start - offset of the first sub-block length byte.
 * @returns offset just past the zero-length terminator.
 */
function endOfSubBlocks(bytes, start) {
  let cursor = start
  while (bytes[cursor] !== 0) cursor += bytes[cursor] + 1
  return cursor + 1
}

/**
 * The box the painted pixels occupy, at the same coverage decision the GIF
 * encoder was handed. A silhouette is what survives GIF's one-bit alpha, so it
 * is what the committed file can be held to.
 * @param decoded - raw RGBA buffer and its dimensions.
 * @param threshold - alpha a pixel needs before it counts as painted.
 * @returns `[left, top, right, bottom]` of the painted pixels.
 */
function paintedBox({ data, info }, threshold) {
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] < threshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return [left, top, right, bottom]
}

describe('splash loader animation', () => {
  it('bakes the two backgrounds the splash page paints', async () => {
    const splash = await readFile(path.join(projectRoot, 'build', 'splash.html'), 'utf8')
    const mattes = readSplashMattes(splash)
    expect(mattes).toEqual({ light: '#f8f8f6', dark: '#141416' })

    // Both colors are read from the page, so a page that stops declaring them
    // — or declares one twice, which would silently pick an arbitrary edge —
    // has to stop the generator instead of baking a stale halo.
    expect(() => readSplashMattes(splash.replace('--splash-matte-dark:', '--other:'))).toThrow(
      /splash-matte-dark/u
    )
    expect(() => readSplashMattes(`${splash}\n:root{--splash-matte-light:#000000;}`)).toThrow(
      /splash-matte-light/u
    )
  })

  it('samples one swim cycle that joins back onto itself', () => {
    const steps = whaleLoaderFrames()
    expect(steps).toHaveLength(SPLASH_LOADER.frames)
    expect(steps.every((step) => step.delayMs === SPLASH_LOADER.delayMs)).toBe(true)

    // The loop is seamless when the step across the seam is no coarser than the
    // steps inside the loop, which only holds if the endpoint is never sampled.
    const interior = steps.slice(1).map((step, index) =>
      Math.abs(step.offsetY - steps[index].offsetY)
    )
    const seam = Math.abs(steps[0].offsetY - steps[steps.length - 1].offsetY)
    expect(seam).toBeLessThanOrEqual(Math.max(...interior) * 1.05)
    expect(Math.max(...interior)).toBeGreaterThan(0)
  })

  it('refuses travel and timing that no GIF encoder could honor', () => {
    expect(() => whaleLoaderFrames({ count: 3 })).toThrow(/at least 4/u)
    expect(() => whaleLoaderFrames({ count: 12.5 })).toThrow(/at least 4/u)
    expect(() => whaleLoaderFrames({ offsetY: -1 })).toThrow(/non-negative/u)
    expect(() => whaleLoaderFrames({ offsetY: Number.POSITIVE_INFINITY })).toThrow(/non-negative/u)
    expect(() => whaleLoaderFrames({ rotateDeg: 90 })).toThrow(/under 90/u)
    expect(() => whaleLoaderFrames({ delayMs: 0 })).toThrow(/positive/u)
    expect(() => whaleLoaderFrames({ delayMs: Number.NaN })).toThrow(/positive/u)
    // GIF cannot express 33 ms; encoding it as 30 would shorten the loop.
    expect(() => whaleLoaderFrames({ delayMs: 33 })).toThrow(/centisecond/u)
  })

  it('keeps the whole sweep inside the canvas it renders into', () => {
    const sweep = whaleLoaderSweep(loaderCanvas)
    expect(sweep.minimumInset).toBeGreaterThan(0)

    // The guard is only worth having if a coarser swell actually trips it.
    const overflowing = whaleLoaderSweep({ ...loaderCanvas, offsetY: 120 })
    expect(overflowing.minimumInset).toBeLessThan(0)
  })

  it('draws the whale alone, pitched about its own center', async () => {
    const dts = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-primitives',
        'lib',
        'types',
        'FishLogo.d.ts'
      ),
      'utf8'
    )
    const whalePath = readFishLogoPath(dts)
    const frame = whaleLoaderFrameSvg({
      fill: '#000000',
      ...loaderCanvas,
      path: whalePath,
      offsetY: 6,
      rotateDeg: 1.1
    })
    expect(frame).toContain(whalePath)
    expect(frame).toContain('rotate(1.1)')
    // Pitched about its own center, and never off the middle of the canvas.
    expect(frame).toContain(
      `translate(320 ${String(SPLASH_LOADER.height / 2 + 6)}) rotate(1.1)`
    )
    expect(frame).toContain(
      `translate(${String(-FISH_LOGO_VIEWBOX.width / 2)} ${String(-FISH_LOGO_VIEWBOX.height / 2)})`
    )
    // The old mark was a window frame with three dots and a tail; none of that
    // may come back inside the loader.
    expect(frame).not.toMatch(/<(rect|circle)/u)
  })

  it.each([
    ['dsh-loader.gif', SPLASH_LOADER.frames],
    ['dsh-loader-dark.gif', SPLASH_LOADER.frames]
  ])('ships %s as a looping full-canvas whale', async (asset, expectedFrames) => {
    const bytes = await readFile(path.join(projectRoot, 'build', asset))
    const header = readGifHeader(bytes)
    expect(header.signature).toBe('GIF89a')
    expect([header.width, header.height]).toEqual([SPLASH_LOADER.width, SPLASH_LOADER.height])
    expect(header.frames).toHaveLength(expectedFrames)
    expect(header.loopCount).toBe(0)
    // 50 ms is 5 GIF centiseconds; a rounded delay would drift the 2 s loop.
    expect(header.frames.map((frame) => frame.delayCs)).toEqual(
      Array.from({ length: expectedFrames }, () => Math.round(SPLASH_LOADER.delayMs / 10))
    )
    // Every frame repaints the whole canvas and restores it afterwards, so no
    // frame can leave a ghost of the whale behind it.
    expect(header.frames.every((frame) => frame.transparent)).toBe(true)
    expect(header.frames.map((frame) => frame.rect)).toEqual(
      Array.from(
        { length: expectedFrames },
        () => [0, 0, SPLASH_LOADER.width, SPLASH_LOADER.height]
      )
    )
  })

  it('commits artwork the script itself still draws', async () => {
    // Committed rasters are the whole point of this feature and the easiest
    // thing in the repo to leave behind, so the shipped first frame is compared
    // against a fresh render of the same frame. A different mark, a different
    // swell, or a splash background the GIFs were never re-matted onto all
    // move this box or this difference.
    const dts = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-primitives',
        'lib',
        'types',
        'FishLogo.d.ts'
      ),
      'utf8'
    )
    const splash = await readFile(path.join(projectRoot, 'build', 'splash.html'), 'utf8')
    const mattes = readSplashMattes(splash)
    const whalePath = readFishLogoPath(dts)
    const first = whaleLoaderFrames()[0]

    for (const [asset, fill, matte] of [
      ['dsh-loader.gif', '#000000', mattes.light],
      ['dsh-loader-dark.gif', '#ffffff', mattes.dark]
    ]) {
      const bytes = await readFile(path.join(projectRoot, 'build', asset))
      const frame = whaleLoaderFrameSvg({
        fill,
        ...loaderCanvas,
        path: whalePath,
        offsetY: first.offsetY,
        rotateDeg: first.rotateDeg
      })
      const committed = await sharp(bytes, { animated: true, page: 0, pages: 1 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const drawn = await sharp(Buffer.from(frame))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      expect([committed.info.width, committed.info.height]).toEqual([
        drawn.info.width,
        drawn.info.height
      ])
      // GIF carries no partial alpha, so both sides are reduced to the same
      // coverage decision the encoder was handed.
      const committedBox = paintedBox(committed, 128)
      const drawnBox = paintedBox(drawn, 128)
      for (const [index, value] of drawnBox.entries()) {
        expect(Math.abs(committedBox[index] - value)).toBeLessThanOrEqual(2)
      }

      const flat = await sharp(bytes, { animated: true, page: 0, pages: 1 })
        .flatten({ background: matte })
        .raw()
        .toBuffer()
      const reference = await sharp(Buffer.from(frame))
        .flatten({ background: matte })
        .raw()
        .toBuffer()
      let total = 0
      for (const [index, value] of flat.entries()) {
        total += Math.abs(value - reference[index])
      }
      // Measured against the committed file: the GIF's own quantisation costs
      // 0.28 of mean channel difference, an inverted whale costs 59, and a
      // background the frames were never re-matted onto costs 6. Anything past
      // 2 is a real difference, not a rounding one.
      expect(total / flat.length).toBeLessThan(2)
    }
  })

  it('rebuilds both committed loaders from FishLogo and the splash page', async () => {
    const generator = await readFile(
      path.join(projectRoot, 'scripts', 'generate-splash-loader.mjs'),
      'utf8'
    )
    expect(generator).toContain("from './whale-brand.mjs'")
    expect(generator).toContain('FishLogo.d.ts')
    expect(generator).toContain('splash.html')
    expect(generator).toContain('readSplashMattes')
    expect(generator).toContain("'dsh-loader.gif'")
    expect(generator).toContain("'dsh-loader-dark.gif'")

    // Assets are committed, so the only thing keeping them rebuildable is the
    // documented entry point next to the one for the app icons.
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    )
    expect(packageJson.scripts['splash:generate']).toBe('node scripts/generate-splash-loader.mjs')
  })
})
