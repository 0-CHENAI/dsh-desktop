#!/usr/bin/env node
/**
 * Extract what the Desktop patches actually change, as diffs against pristine
 * Harness tarballs, so they can be re-based onto a new Harness version.
 *
 * A patch file mixes two things: where the target code happens to sit in one
 * specific release, and the behavior Desktop wants. Only the second one carries
 * over an upgrade. Diffs taken against the pristine tarball separate them, and
 * the apply step doubles as a check that every patch still fits the release it
 * names.
 *
 *   node scripts/harness-fork-deltas.mjs extract \
 *     --vendor packages/harness-0.1.5-rc.1 --patches patches \
 *     --out artifacts/harness-rc2-migration/deltas
 *
 * The layout mirrors what patch-package sees at install time: the tarball is
 * unpacked under `node_modules/<scope>/<name>` and the patch is applied there
 * with `-p1`. The emitted delta uses the same `a/` `b/` prefixes, so it can be
 * applied to the next release's tree the same way.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs (argv) {
  const options = { command: argv[0] }
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i]
  }
  return options
}

function run (file, args, cwd) {
  try {
    return execFileSync(file, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const detail = (error.stderr ?? error.message).toString().trim().split('\n').slice(0, 4).join(' | ')
    throw new Error(detail)
  }
}

/** `git diff --no-index` exits 1 on differences, which is the expected outcome. */
function runDiff (args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (error.status === 1 && error.stdout) return error.stdout
    const detail = (error.stderr ?? error.message).toString().trim().split('\n').slice(0, 4).join(' | ')
    throw new Error(detail)
  }
}

/** `@deepseek-ai+dsh-llm-pi-ai+0.1.5-rc.1.patch` -> package name and version. */
export function parsePatchFileName (name) {
  const parts = name.replace(/\.patch$/, '').split('+')
  return { package: `${parts[0]}/${parts[1]}`, version: parts.slice(2).join('+') }
}

const flattened = name => name.replace('@', '').replace('/', '-')

const tarballFor = (vendorDir, package_, version) => {
  const bucket = package_.startsWith('@deepseek-ai/') && (package_ === '@deepseek-ai/dsh' || package_.startsWith('@deepseek-ai/dsh-'))
    ? 'npm-dsh'
    : 'npm-vendor'
  return path.join(vendorDir, bucket, `${flattened(package_)}-${version}.tgz`)
}

/** Unpack a tarball into `<root>/<prefix>/node_modules/<scope>/<name>`. */
async function unpackInto (tgzPath, package_, prefixDirectory) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'harness-unpack-'))
  const parent = path.join(prefixDirectory, 'node_modules', path.dirname(package_))
  await mkdir(parent, { recursive: true })
  run('tar', ['-xzf', tgzPath, '-C', scratch])
  await rename(path.join(scratch, 'package'), path.join(parent, path.basename(package_)))
  await rm(scratch, { recursive: true, force: true })
}

/**
 * Some patched packages are not part of the vendored Harness closure; pull
 * those pristine from the registry instead of reading an already patched
 * `node_modules`.
 */
async function packInto (package_, version, directory) {
  const out = path.join(directory, 'pack')
  await mkdir(out, { recursive: true })
  run('npm', ['pack', `${package_}@${version}`, '--pack-destination', out, '--registry=https://registry.npmmirror.com', '--silent'])
  const [file] = (await readdir(out)).filter(name => name.endsWith('.tgz'))
  if (!file) throw new Error(`npm pack 未产出 tarball: ${package_}@${version}`)
  return path.join(out, file)
}

async function extractOne (options, patchFile) {
  const { package: package_, version } = parsePatchFileName(patchFile)
  const patchText = await readFile(path.join(path.resolve(projectRoot, options.patches), patchFile), 'utf8')

  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-delta-'))
  try {
    const vendored = tarballFor(path.resolve(projectRoot, options.vendor), package_, version)
    const tgzPath = await readFile(vendored).then(() => vendored).catch(() => packInto(package_, version, root))
    await unpackInto(tgzPath, package_, path.join(root, 'post'))
    await cp(path.join(root, 'post'), path.join(root, 'pre'), { recursive: true })
    await writeFile(path.join(root, 'fork.patch'), patchText)
    run('git', ['apply', '-p1', '--ignore-whitespace', path.join(root, 'fork.patch')], path.join(root, 'post'))
    const delta = runDiff(['-c', 'core.quotepath=false', 'diff', '--no-index', '--no-color', '--unified=3', 'pre', 'post'], root)
    // git prefixes its labels with a/ b/ on top of the two tree names, which would
    // bake `a/pre/...` into every path. Collapse them back to patch-package's
    // `-p1` shape: `a/node_modules/<pkg>/...`.
    const normalized = delta
      .split('\n')
      .map(line => {
        if (line.startsWith('diff --git a/pre/')) return line.replace('a/pre/', 'a/').replace('b/post/', 'b/')
        if (line.startsWith('--- a/pre/')) return `--- a/${line.slice('--- a/pre/'.length)}`
        if (line.startsWith('+++ b/post/')) return `+++ b/${line.slice('+++ b/post/'.length)}`
        return line
      })
      .join('\n')
    return {
      package: package_,
      version,
      delta: normalized,
      binary: normalized.includes('GIT binary patch'),
      files: [...normalized.matchAll(/^\+\+\+ b\/(\S+)/gm)].map(m => m[1])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function commandExtract (options) {
  const outDir = path.resolve(projectRoot, options.out)
  await mkdir(outDir, { recursive: true })
  const patchesDir = path.resolve(projectRoot, options.patches)
  const filter = options.only ? options.only.split(',') : null
  const patchFiles = (await readdir(patchesDir))
    .filter(name => name.endsWith('.patch'))
    .filter(name => !filter || filter.some(f => name.includes(f)))
    .sort()

  let failed = 0
  const manifest = []
  for (const patchFile of patchFiles) {
    try {
      const result = await extractOne(options, patchFile)
      const outFile = path.join(outDir, `${flattened(result.package)}.delta.patch`)
      await writeFile(outFile, result.delta)
      manifest.push({
        patchFile,
        package: result.package,
        version: result.version,
        delta: path.relative(projectRoot, outFile),
        touched: result.files,
        binary: result.binary
      })
      console.log(`ok   ${result.package.padEnd(50)} ${result.version}  ${result.files.length} 个文件${result.binary ? '  [含二进制]' : ''}`)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${patchFile.padEnd(56)} ${error.message}`)
    }
  }

  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\n共 ${patchFiles.length} 个补丁 | 提取成功 ${manifest.length} | 失败 ${failed}`)
  console.log(`清单: ${path.relative(projectRoot, path.join(outDir, 'manifest.json'))}`)
  if (failed > 0) process.exitCode = 1
}

const options = parseArgs(process.argv.slice(2))
if (options.command !== 'extract') {
  console.error('用法: harness-fork-deltas.mjs extract --vendor <dir> --patches <dir> --out <dir> [--only a,b]')
  process.exit(2)
}
await commandExtract(options)
