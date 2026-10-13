/** Three-way migration of fork customizations onto the patched upstream release.
 * Old tarballs stay immutable; every result is regenerated against a pristine
 * new tarball. Conflicting packages remain in staging, never half-installed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unpackInto, parsePatchFileName, tarballPathFor } from './harness-patch-lib.mjs'

const root = path.resolve(import.meta.dirname, '..')
// git apply inside a repository subdirectory filters root-relative paths.
// An independent temporary root avoids silently skipped node_modules hunks.
const stage = await mkdtemp(path.join(tmpdir(), 'dsh-harness-020-'))
const fromRef = process.argv[2] ?? 'HEAD'
const upstreamRef = process.argv[3] ?? 'upstream/main'
const oldVendor = path.join(root, 'packages/harness-0.1.5-rc.2')
const newVendor = path.join(root, 'packages/harness-0.2.0-rc.2')
const run = (args, cwd = root) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const listing = ref => run(['ls-tree', '-r', '--name-only', ref, 'patches/']).trim().split('\n').filter(Boolean)
const prior = listing(fromRef)
const incoming = listing(upstreamRef)
const provenance = JSON.parse(await readFile(path.join(newVendor, 'provenance.json'), 'utf8'))
await mkdir(stage, { recursive: true })
await mkdir(path.join(root, '.build/harness-migration'), { recursive: true })
await writeFile(path.join(root, '.build/harness-migration/latest.json'), JSON.stringify({ stage }) + '\n')

async function pristine(packageName, version, vendor, output) {
  let tarball = tarballPathFor(vendor, packageName, version)
  if (!existsSync(tarball)) {
    const metadata = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2f')}/${version}`, { signal: AbortSignal.timeout(30_000) })
    if (!metadata.ok) throw new Error(`${packageName}: metadata HTTP ${metadata.status}`)
    const { dist } = await metadata.json()
    const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`${packageName}: tarball HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const [algorithm, digest] = dist.integrity.split('-')
    if (createHash(algorithm).update(bytes).digest('base64') !== digest) throw new Error(`${packageName}: integrity mismatch`)
    tarball = path.join(stage, `${packageName.replace(/[@/]/g, '-')}-${version}.tgz`)
    await writeFile(tarball, bytes)
  }
  await unpackInto(tarball, packageName, output)
}

async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), name))
    else result.push(name)
  }
  return result
}

const report = []
for (const patch of prior) {
  const { package: name, version } = parsePatchFileName(path.basename(patch))
  const upstream = incoming.find(file => parsePatchFileName(path.basename(file)).package === name)
  const next = provenance[name]?.version ?? (upstream ? parsePatchFileName(path.basename(upstream)).version : version)
  const directory = path.join(stage, name.replace(/[@/]/g, '-'))
  const record = { name, previous: version, next, conflicts: [], status: 'pending' }
  try {
    if (existsSync(directory)) throw new Error('Staging already exists; inspect or select a fresh staging root before retrying')
    await pristine(name, version, oldVendor, path.join(directory, 'old-pre'))
    await cp(path.join(directory, 'old-pre'), path.join(directory, 'old-post'), { recursive: true })
    const patchFile = path.join(directory, 'prior.patch')
    await writeFile(patchFile, run(['show', `${fromRef}:${patch}`]))
    run(['apply', '--ignore-whitespace', patchFile], path.join(directory, 'old-post'))
    await pristine(name, next, newVendor, path.join(directory, 'pre'))
    await cp(path.join(directory, 'pre'), path.join(directory, 'post'), { recursive: true })
    if (upstream) {
      const input = path.join(directory, 'upstream.patch')
      await writeFile(input, run(['show', `${upstreamRef}:${upstream}`]))
      run(['apply', '--ignore-whitespace', input], path.join(directory, 'post'))
    }
    const relative = path.join('node_modules', name)
    const oldBase = path.join(directory, 'old-pre', relative)
    const oldPatched = path.join(directory, 'old-post', relative)
    const newPatched = path.join(directory, 'post', relative)
    for (const file of await files(oldPatched)) {
      const oldPath = path.join(oldBase, file), ours = path.join(oldPatched, file), target = path.join(newPatched, file)
      const before = existsSync(oldPath) ? await readFile(oldPath) : Buffer.alloc(0)
      const after = await readFile(ours)
      if (before.equals(after)) continue
      if (!existsSync(oldPath)) await writeFile(oldPath, '')
      if (!existsSync(target)) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, '') }
      let merged
      try { merged = run(['merge-file', '-p', '--diff3', '-L', 'new-upstream', '-L', 'old-pristine', '-L', 'fork', target, oldPath, ours]) }
      catch (error) {
        if (error.status > 0 && error.status <= 127 && error.stdout) { merged = error.stdout; record.conflicts.push(file) }
        else throw error
      }
      await writeFile(target, merged)
    }
    if (record.conflicts.length) record.status = 'conflict'
    else {
      const generated = diffPackageTrees(directory)
      if (generated.trim()) await writeFile(path.join(root, 'patches', `${name.replace('/', '+')}+${next}.patch`), generated)
      await cp(newPatched, path.join(root, 'node_modules', name), { recursive: true })
      record.status = generated.trim() ? 'ported' : 'superseded'
    }
  } catch (error) { record.status = 'error'; record.error = error.message }
  report.push(record)
  console.log(JSON.stringify(record))
}
await writeFile(path.join(stage, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (report.some(row => ['error', 'conflict'].includes(row.status))) process.exitCode = 1
