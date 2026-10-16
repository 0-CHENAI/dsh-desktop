// Installation identity comes from the installed package, never a matching listing.
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const safeName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const literal = value => typeof value === 'string' ? value : undefined

const fingerprintCache = new Map()
async function fingerprint(directory, sourceSpec) {
  const hash = createHash('sha256')
  let size = 0, count = 0
  const files = []
  async function walk(relative = '', depth = 0) {
    if (depth > 30) throw new Error('Package nesting exceeds limits')
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      if (++count > 10000) throw new Error('Package evidence exceeds limits')
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error('Package contains an unverified symlink')
      if (entry.isDirectory()) await walk(path, depth + 1)
      else if (entry.isFile()) {
        const info = await stat(join(directory, path))
        size += info.size
        if (size > 64 * 1024 * 1024) throw new Error('Package evidence exceeds limits')
        files.push({ path, signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}` })
      }
    }
  }
  await walk()
  const signature = JSON.stringify([sourceSpec, files])
  const cached = fingerprintCache.get(directory)
  if (cached?.signature === signature) return cached.digest
  hash.update(directory).update('\0').update(typeof sourceSpec === 'string' ? sourceSpec : '').update('\0')
  for (const file of files) hash.update(file.path).update('\0').update(await readFile(join(directory, file.path))).update('\0')
  const digest = hash.digest('hex')
  if (fingerprintCache.size > 128) fingerprintCache.clear()
  fingerprintCache.set(directory, { signature, digest })
  return digest
}

export async function readInstallEvidence(installs, home = process.env.DSH_HOME || join(homedir(), '.dsh'), requestedNames = []) {
  const profile = join(home, 'profiles', 'web')
  const dependencies = await json(join(profile, 'package.json')).then(value => value.dependencies || {}, () => ({}))
  const generations = new Map()
  try {
    const root = join(home, 'profiles', '.generations')
    for (const id of await json(join(root, 'desired.json'))) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9._+-]+$/.test(id)) continue
      const directory = join(root, 'live', id)
      const generation = await json(join(directory, 'generation.json'))
      if (safeName.test(generation.pluginName)) generations.set(generation.pluginName, { directory: join(directory, 'node_modules', generation.pluginName), sourceSpec: generation.sourceSpec })
    }
  } catch { /* Legacy profiles have no generation registry; inspect their dependency tree. */ }
  const packages = {}
  const names = new Set([...requestedNames, ...Object.values(installs).map(item => item?.pluginName)])
  for (const name of names) {
    if (typeof name !== 'string' || !safeName.test(name)) continue
    const generation = generations.get(name)
    const candidate = generation?.directory || join(profile, 'node_modules', name)
    // Missing evidence must not make an existing or declared install look absent.
    const present = generation || Object.hasOwn(dependencies, name) || await lstat(candidate).then(() => true, error => error.code !== 'ENOENT')
    if (present) packages[name] = { origin: 'unknown', metadata: {} }
    try {
      const directory = await realpath(candidate)
      const manifest = await json(join(directory, 'package.json'))
      if (manifest.name !== name || !manifest.dsh?.client) continue
      const sourceSpec = generation?.sourceSpec || dependencies[name]
      const digest = await fingerprint(directory, sourceSpec).catch(() => undefined)
      const record = Object.values(installs).find(item => item?.pluginName === name && digest && item.fingerprint === digest)
      const historical = Object.values(installs).find(item => item?.pluginName === name && !item.fingerprint)
      const ambiguousArchive = historical && typeof sourceSpec === 'string' && /\.(?:tgz|tar\.gz)(?:$|[?#])/.test(sourceSpec)
      const local = !ambiguousArchive && typeof sourceSpec === 'string' && /^(?:file:|link:|\/|[A-Za-z]:[\\/]|\.\.?[\\/])/.test(sourceSpec)
      const author = typeof manifest.author === 'string' ? manifest.author : literal(manifest.author?.name)
      const zh = await json(join(directory, 'locale', 'zh.json')).then(value => value.meta || {}, () => ({}))
      const en = await json(join(directory, 'locale', 'en.json')).then(value => value.meta || {}, () => ({}))
      packages[name] = {
        version: literal(manifest.version), fingerprint: digest,
        origin: record ? 'market' : local ? 'local' : 'unknown',
        metadata: {
          title: literal(zh.title), titleEn: literal(en.title),
          description: literal(zh.description) || literal(manifest.description), descriptionEn: literal(en.description),
          author, repository: typeof manifest.repository === 'string' ? manifest.repository : literal(manifest.repository?.url)
        }
      }
    } catch { /* An unreadable package has no reliable source or metadata evidence. */ }
  }
  return packages
}
