#!/usr/bin/env node
/**
 * Materialize a pinned Harness release as local npm tarballs plus provenance.
 *
 * Desktop installs the Harness closure from vendored tarballs instead of the
 * registry, so every upgrade needs a new `packages/harness-<version>/` tree.
 * This script derives that tree from the previous one: the Harness family moves
 * to the requested version, the Cordis / CosmoKit / Schemastery vendor set keeps
 * its locked version, and any Harness package the registry has not published at
 * the requested version is deliberately left at its previous version and
 * reported, never dropped.
 *
 *   node scripts/fetch-harness-tarballs.mjs \
 *     --from packages/harness-0.1.5-rc.1/provenance.json \
 *     --to packages/harness-0.1.5-rc.2 \
 *     --version 0.1.5-rc.2
 *
 * Downloads are verified against the integrity value the registry publishes,
 * re-downloaded when a cached file fails that check, and resumable: a file that
 * already matches its integrity is reused, so an interrupted run can be rerun.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REGISTRY = 'https://registry.npmmirror.com'
const CONCURRENCY = 8

function parseArgs (argv) {
  const options = { registry: DEFAULT_REGISTRY, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--registry') options.registry = argv[++i]
    else if (arg === '--from') options.from = argv[++i]
    else if (arg === '--to') options.to = argv[++i]
    else if (arg === '--version') options.version = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  for (const key of ['from', 'to', 'version']) {
    if (!options[key]) throw new Error(`Missing required argument: --${key}`)
  }
  return options
}

const isHarnessPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
const tarballName = (name, version) => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
const encodedName = name => name.replace('/', '%2f')

async function fetchJson (url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

/**
 * Resolve one published version to its tarball location and integrity value.
 *
 * The version manifest is preferred because it is small; the full packument is
 * the fallback for registries that do not serve `/<name>/<version>`.
 */
async function resolveVersion (registry, name, version) {
  const candidates = [
    `${registry}/${encodedName(name)}/${version}`,
    `${registry}/${encodedName(name)}`
  ]
  let lastError
  for (const url of candidates) {
    try {
      const payload = await fetchJson(url)
      const entry = payload.dist ? payload : payload.versions?.[version]
      if (entry?.dist?.tarball && entry.dist.integrity) return entry.dist
      lastError = new Error(`No dist for ${name}@${version} at ${url}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function parseIntegrity (value) {
  const [algorithm, digest] = value.split('-')
  if (!algorithm || !digest) throw new Error(`Unparseable integrity value: ${value}`)
  return { algorithm, digest }
}

async function sha512 (filePath) {
  const buffer = await readFile(filePath)
  return createHash('sha512').update(buffer).digest('base64')
}

async function download (url, destination) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  // Write through a temporary name so an interrupted download never looks like a
  // complete tarball to a later run.
  const temporary = `${destination}.part`
  await writeFile(temporary, buffer)
  await rename(temporary, destination)
  return buffer.byteLength
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  const registry = options.registry.replace(/\/$/, '')
  const sourcePath = path.resolve(projectRoot, options.from)
  const targetDirectory = path.resolve(projectRoot, options.to)
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))

  const entries = Object.entries(source).map(([name, meta]) => ({
    name,
    // The vendor set is independent of the Harness release line; only the
    // Harness family follows it.
    version: isHarnessPackage(name) ? options.version : meta.version
  }))

  const provenance = {}
  const heldBack = []
  const summary = { downloaded: 0, reused: 0, bytes: 0, missing: [] }

  const queue = [...entries]
  async function worker () {
    while (queue.length > 0) {
      const { name, version } = queue.shift()
      const previous = source[name].version
      let heldNote = null
      let resolvedVersion = version
      let dist
      // A package the release line never published stays at its previous version.
      // Resolving the fallback inline (instead of requeueing) keeps this worker's
      // item owned: a requeued entry can outlive every other worker.
      try {
        dist = await resolveVersion(registry, name, version)
      } catch (error) {
        if (version !== options.version || previous === options.version) {
          summary.missing.push(`${name}@${version}: ${error.message}`)
          continue
        }
        dist = await resolveVersion(registry, name, previous)
        resolvedVersion = previous
        heldNote = `${name}@${previous} (无 ${options.version})`
      }
      const integrity = dist.integrity
      const { algorithm, digest } = parseIntegrity(integrity)
      const isVendor = !isHarnessPackage(name)
      const directory = path.join(targetDirectory, isVendor ? 'npm-vendor' : 'npm-dsh')
      const file = path.join(directory, tarballName(name, resolvedVersion))
      // Registries serve the unscoped basename, so reuse the published file name
      // rather than the flattened one used for the local file.
      const tarballUrl = `${registry}/${name}/-/${path.basename(new URL(dist.tarball).pathname)}`

      let size = 0
      if (!options.dryRun) {
        await mkdir(directory, { recursive: true })
        let cached = false
        try {
          cached = (await stat(file)).size > 0 && await sha512(file) === digest
        } catch {
          cached = false
        }
        if (cached) {
          summary.reused += 1
        } else {
          size = await download(dist.tarball, file)
          if (await sha512(file) !== digest) {
            throw new Error(`Integrity mismatch for ${name}@${resolvedVersion}: expected ${algorithm}-${digest}`)
          }
          summary.downloaded += 1
          summary.bytes += size
        }
      }

      provenance[name] = { version: resolvedVersion, dist: { tarball: tarballUrl, integrity } }
      if (heldNote) heldBack.push(heldNote)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const missingNames = entries.filter(e => !provenance[e.name]).map(e => `${e.name}@${e.version}`)
  if (summary.missing.length > 0 || missingNames.length > 0) {
    console.error('未解析到 registry 条目：')
    for (const item of [...summary.missing, ...missingNames]) console.error(`  x ${item}`)
    throw new Error(`${missingNames.length} 个包未能落到目标目录，拒绝写入 provenance.json`)
  }

  if (options.dryRun) {
    console.log(`dry-run: ${entries.length} 个包将写入 ${path.relative(projectRoot, targetDirectory)}`)
    for (const [name, meta] of Object.entries(provenance).sort(([a], [b]) => a.localeCompare(b))) {
      const expected = isHarnessPackage(name) ? options.version : source[name].version
      const note = meta.version === expected ? '' : '  <- 保持旧版本'
      console.log(`  ${name.padEnd(52)} ${meta.version}${note}`)
    }
    return
  }

  const ordered = Object.fromEntries(
    Object.keys(provenance).sort().map(name => [name, provenance[name]])
  )
  await writeFile(path.join(targetDirectory, 'provenance.json'), `${JSON.stringify(ordered, null, 2)}\n`)

  console.log(`目标目录: ${path.relative(projectRoot, targetDirectory)}`)
  console.log(`包总数: ${entries.length} | 新下载: ${summary.downloaded} | 复用: ${summary.reused} | 新增字节: ${(summary.bytes / 1024 / 1024).toFixed(1)}MB`)
  const harnessCount = Object.keys(ordered).filter(isHarnessPackage).length
  console.log(`npm-dsh: ${harnessCount} | npm-vendor: ${Object.keys(ordered).length - harnessCount}`)
  if (heldBack.length > 0) {
    console.log(`\n保持旧版本的包（${options.version} 尚未发布，属预期）：`)
    for (const item of [...new Set(heldBack)]) console.log(`  · ${item}`)
  }
}

await main()
