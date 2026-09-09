import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  SPLASH_LOADER,
  readFishLogoPath,
  readSplashMattes,
  whaleLoaderFrameSvg,
  whaleLoaderFrames,
  whaleLoaderSweep
} from './whale-brand.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = path.join(projectRoot, 'build')
const fishLogoTypes = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-primitives',
  'lib',
  'types',
  'FishLogo.d.ts'
)
const splashHtml = path.join(buildDirectory, 'splash.html')

/** A pixel whose render alpha is at least this keeps the rendered color. */
const COVERAGE_THRESHOLD = 128

const variants = [
  { destination: 'dsh-loader.gif', fill: '#000000', matte: 'light' },
  { destination: 'dsh-loader-dark.gif', fill: '#ffffff', matte: 'dark' }
]

/**
 * One frame as RGBA that a GIF encoder may turn into 1-bit transparency.
 *
 * GIF has one transparent color and no partial alpha, so anti-aliased edges
 * would leave a halo of the wrong color around the silhouette. Each frame is
 * therefore flattened onto the very background the splash paints behind it, and
 * the encoder is handed a hard transparency mask taken from the render's own
 * alpha channel: the edge colors are then the ones the page composites itself.
 * @param svg - frame markup.
 * @param matte - splash background the frame is drawn on.
 * @returns RGBA PNG buffer.
 */
async function mattedFrame(svg, matte) {
  const image = sharp(Buffer.from(svg))
  const [flat, coverage] = await Promise.all([
    image.clone().flatten({ background: matte }).png().toBuffer(),
    image
      .clone()
      .ensureAlpha()
      .extractChannel(3)
      .threshold(COVERAGE_THRESHOLD)
      .png()
      .toBuffer()
  ])
  return sharp(flat).joinChannel(coverage).png().toBuffer()
}

/**
 * @param options.fill - whale color.
 * @param options.matte - splash background the frames are matted onto.
 * @param options.steps - frames of one swim cycle.
 * @param options.path - FISH_LOGO_PATH.
 * @returns animated GIF buffer.
 */
async function loaderGif({ fill, matte, steps, path: whalePath }) {
  const pages = []
  for (const step of steps) {
    pages.push(
      await mattedFrame(
        whaleLoaderFrameSvg({
          fill,
          width: SPLASH_LOADER.width,
          height: SPLASH_LOADER.height,
          padding: SPLASH_LOADER.padding,
          path: whalePath,
          offsetY: step.offsetY,
          rotateDeg: step.rotateDeg
        }),
        matte
      )
    )
  }
  return sharp(pages, { join: { animated: true } })
    .gif({ delay: steps.map((step) => step.delayMs), loop: 0 })
    .toBuffer()
}

/**
 * Read a written loader back from disk. A splash that stops looping, drops a
 * frame, or encodes its delay somewhere other than the requested 50 ms is not
 * something anyone can see before launching the app, so the encoder's own
 * report on the finished file is what the script trusts.
 * @param destination - path of the GIF that was just written.
 * @param expected - frame count and per-frame delay the animation was built from.
 * @returns the loop length in seconds, summed from the encoded delays.
 */
async function verifyLoader(destination, { frames, delayMs }) {
  const encoded = await sharp(destination, { animated: true }).metadata()
  const delays = encoded.delay ?? []
  if (encoded.pages !== frames || delays.length !== frames) {
    throw new Error(
      `${path.basename(destination)} encoded ${String(encoded.pages ?? 0)} page(s) and ${String(delays.length)} delay(s), expected ${String(frames)}`
    )
  }
  if (encoded.loop !== 0) {
    throw new Error(`${path.basename(destination)} would stop looping after ${String(encoded.loop)} run(s)`)
  }
  const drifted = delays.find((delay) => Math.abs(delay - delayMs) > 1)
  if (drifted !== undefined) {
    throw new Error(
      `${path.basename(destination)} encoded a ${String(drifted)}ms frame instead of ${String(delayMs)}ms`
    )
  }
  return delays.reduce((total, delay) => total + delay, 0) / 1000
}

const whalePath = readFishLogoPath(await readFile(fishLogoTypes, 'utf8'))
const mattes = readSplashMattes(await readFile(splashHtml, 'utf8'))
const steps = whaleLoaderFrames()

const sweep = whaleLoaderSweep({
  width: SPLASH_LOADER.width,
  height: SPLASH_LOADER.height,
  padding: SPLASH_LOADER.padding,
  offsetY: SPLASH_LOADER.offsetY,
  rotateDeg: SPLASH_LOADER.rotateDeg
})
if (sweep.minimumInset < 0) {
  throw new Error(
    `Loader animation would clip the canvas by ${String(Math.abs(sweep.minimumInset))}px; lower the travel or the pitch`
  )
}

const written = []
let loopSeconds = 0
for (const variant of variants) {
  const gif = await loaderGif({
    fill: variant.fill,
    matte: mattes[variant.matte],
    steps,
    path: whalePath
  })
  const destination = path.join(buildDirectory, variant.destination)
  await writeFile(destination, gif)
  loopSeconds = await verifyLoader(destination, {
    frames: steps.length,
    delayMs: SPLASH_LOADER.delayMs
  })
  written.push(`${variant.destination} (${String((await stat(destination)).size)} bytes)`)
}

console.log(
  `Generated ${written.join(', ')}: ${String(steps.length)} whale frames, ${String(loopSeconds.toFixed(2))}s loop, matted to ${mattes.light} / ${mattes.dark}.`
)
