#!/usr/bin/env node
/**
 * Re-base Desktop's package patches onto the currently installed Harness release.
 *
 * Each patched package is rebuilt from two inputs: the upstream patch for the new
 * release, when upstream ships one, plus the behavior delta extracted from the
 * previous release (see harness-fork-deltas.mjs). Both inputs are pre-checked with
 * `git apply --check` before either is written, so a package that cannot be ported
 * mechanically is reported and left pristine rather than half-patched — a silently
 * half-applied patch is the failure mode this exists to avoid.
 *
 *   node scripts/harness-port-patches.mjs \
 *     --deltas artifacts/harness-rc2-migration/deltas \
 *     --vendor packages/harness-0.1.5-rc.2 \
 *     --upstream-ref upstream/main \
 *     --only dsh,dsh-app-boot,dsh-llm-pi-ai,dsh-workspace
 *
 * The emitted `patches/<package>+<installed version>.patch` is verified by
 * reverse-applying it against the tree it was generated from, so every reported
 * success is a patch that demonstrably fits, not merely one that was written.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  diffPackageTrees,
  flattened,
  installedInto,
  makeScratch,
  packInto,
  patchFileBase,
  run,
  tarballPathFor,
  unpackInto
} from './harness-patch-lib.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs (argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    // A flag with no value must not swallow the following argument, which would
    // silently turn it into a value and switch the flag off.
    if (next === undefined || next.startsWith('--')) options[key] = true
    else {
      options[key] = next
      i += 1
    }
  }
  return options
}

/**
 * Package a patch file targets. Patch names join scope, package and version with
 * `+`, so the same name has to be normalized before two of them can be compared:
 * `@deepseek-ai+dsh-app-boot+0.1.5-rc.2.patch` and `@deepseek-ai/dsh-app-boot`
 * refer to one package.
 */
const patchPackage = fileName => {
  const parts = fileName.replace(/\.patch$/, '').split('+')
  return `${parts[0]}/${parts[1]}`
}

/** Upstream's patch for this package at the reference ref, if it publishes one. */
function upstreamPatch (ref, package_) {
  let listing = []
  try {
    listing = run('git', ['ls-tree', '--name-only', ref, 'patches/'], projectRoot).split('\n').filter(Boolean)
  } catch {
    listing = []
  }
  const match = listing
    .map(file => file.split('/').pop())
    .find(file => patchPackage(file) === package_)
  if (!match) return null
  return { name: match, content: run('git', ['show', `${ref}:patches/${match}`], projectRoot) }
}

function statsOf (text) {
  const lines = text.split('\n')
  return {
    files: lines.filter(l => l.startsWith('+++ b/')).length,
    added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
    removed: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length
  }
}

/** Build the new patch file from the installed tree against its pristine tarball. */
async function generatePatch (options, package_, version) {
  const root = await makeScratch('harness-generate-')
  try {
    const vendored = tarballPathFor(path.resolve(projectRoot, options.vendor), package_, version)
    const tgz = existsSync(vendored) ? vendored : await packInto(package_, version, root)
    await unpackInto(tgz, package_, path.join(root, 'pre'))
    await installedInto(path.join(projectRoot, 'node_modules', package_), package_, path.join(root, 'post'))
    return diffPackageTrees(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const options = parseArgs(process.argv.slice(2))
const deltasDir = path.resolve(projectRoot, options.deltas)
const ref = options['upstream-ref'] ?? 'upstream/main'
// `none` ports the fork behavior onto the pristine release, which is the only
// decomposition that applies cleanly: the fork delta already carries upstream's
// older patch content. `upstream` layers it over upstream's patch for this
// release, which double-applies wherever the two overlap and is only useful for
// packages whose fork delta is genuinely additive.
const baseline = options.baseline ?? 'none'
const manifest = JSON.parse(await readFile(path.join(deltasDir, 'manifest.json'), 'utf8'))
const matchesToken = (package_, token) => package_ === token || package_.endsWith(`/${token}`)
const filter = options.only ? options.only.split(',') : null
const targets = manifest.filter(entry => !filter || filter.some(token => matchesToken(entry.package, token)))

if (targets.length === 0) {
  console.error('没有匹配的补丁（检查 --only）')
  process.exit(2)
}

const report = []
for (const entry of targets) {
  const package_ = entry.package
  const record = { package: package_, status: 'pending', superseded: entry.patchFile }
  const scratch = await makeScratch('harness-port-')
  try {
    const installed = JSON.parse(await readFile(path.join(projectRoot, 'node_modules', package_, 'package.json'), 'utf8')).version
    record.installed = installed
    const targetFile = path.join(projectRoot, 'patches', `${patchFileBase(package_, installed)}.patch`)
    record.target = path.relative(projectRoot, targetFile)
    if (existsSync(targetFile) && !options.force) {
      record.status = 'exists'
      console.log(`skip   ${package_.padEnd(48)} 目标补丁已存在`)
      report.push(record)
      continue
    }

    const upstream = upstreamPatch(ref, package_)
    // Upstream ships a patch for this package: record it either way, so a package
    // ported from the fork delta alone is visibly marked rather than quietly
    // missing whatever upstream added to its own patch.
    record.upstreamAvailable = upstream?.name ?? null
    const deltaPath = path.join(deltasDir, `${flattened(package_)}.delta.patch`)
    if (upstream) await writeFile(path.join(scratch, 'upstream.patch'), upstream.content)

    // Check every input before touching the tree: discovering that the delta does
    // not fit after the baseline is already in would leave the package
    // half-patched.
    // `--from-tree` regenerates a patch from a tree that was edited by hand, for
    // the conflicts that no mechanical port can settle. Nothing is applied in
    // this mode; the verification below is what makes the hand edit trustworthy.
    if (!options['from-tree']) {
      if (upstream && baseline === 'upstream') {
        run('git', ['apply', '-p1', '--check', path.join(scratch, 'upstream.patch')], projectRoot)
      }
      run('git', ['apply', '-p1', '--ignore-whitespace', '--check', deltaPath], projectRoot)
      if (upstream && baseline === 'upstream') {
        record.upstream = upstream.name
        run('git', ['apply', '-p1', path.join(scratch, 'upstream.patch')], projectRoot)
      }
      run('git', ['apply', '-p1', '--ignore-whitespace', deltaPath], projectRoot)
    } else {
      record.mode = 'from-tree'
    }

    const patch = await generatePatch(options, package_, installed)
    if (!patch.trim()) throw new Error('生成的补丁为空')
    // Reverse-applying against the tree just produced proves the patch describes
    // the installed state exactly.
    const verify = path.join(scratch, 'verify.patch')
    await writeFile(verify, patch)
    run('git', ['apply', '-R', '--check', verify], projectRoot)
    await writeFile(targetFile, patch)

    const stats = statsOf(patch)
    record.status = 'ported'
    record.stats = stats
    const mode = record.upstream
      ? '上游基线 + fork 差量'
      : record.upstreamAvailable
        ? '仅 fork 差量（上游另有补丁，需对照）'
        : 'fork 差量（上游无补丁）'
    console.log(`ok     ${package_.padEnd(48)} ${installed}  ${mode}  ${stats.files} 文件 +${stats.added}/-${stats.removed}`)
  } catch (error) {
    record.status = 'conflict'
    record.error = error.message
    console.log(`CONFLICT ${package_.padEnd(46)} ${error.message}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  report.push(record)
}

await mkdir(path.resolve(projectRoot, 'artifacts/harness-rc2-migration'), { recursive: true })
const conflicts = report.filter(r => r.status === 'conflict')
console.log(`\n处理 ${report.length} 个 | 成功 ${report.filter(r => r.status === 'ported').length} | 跳过 ${report.filter(r => r.status === 'exists').length} | 冲突 ${conflicts.length}`)
if (conflicts.length > 0) {
  console.log('需人工处理:')
  conflicts.forEach(r => console.log(`  · ${r.package}: ${r.error}`))
  process.exitCode = 1
}
