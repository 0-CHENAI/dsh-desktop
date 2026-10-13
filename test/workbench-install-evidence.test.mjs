import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstallEvidence } from '../packages/dsh-desktop-workbenches/install-evidence.mjs'
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(spec = 'file:/development/local') {
  const home = await mkdtemp(join(tmpdir(), 'dsh-install-evidence-')); roots.push(home)
  const profile = join(home, 'profiles', 'web'), directory = join(profile, 'node_modules', 'workbench')
  await mkdir(directory, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { workbench: spec } }))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'workbench', version: '1.0.0', description: 'Actual local description', author: { name: 'Local Author' }, dsh: { client: { entry: './client.js' } } }))
  await writeFile(join(directory, 'client.js'), 'local code')
  return { home, directory }
}
describe('actual workbench installation evidence', () => {
  it('does not infer market origin from a stale same-version install record', async () => {
    const { home } = await fixture()
    const result = await readInstallEvidence({ 'o/workbench': { pluginName: 'workbench', version: '1.0.0', source: 'npm' } }, home)
    expect(result.workbench).toMatchObject({ origin: 'local', version: '1.0.0', metadata: { author: 'Local Author', description: 'Actual local description' } })
  })
  it('keeps legacy market archive records unknown when their original source cannot be proved', async () => {
    const { home } = await fixture('file:/tmp/market-release/package.tgz')
    const result = await readInstallEvidence({ 'o/workbench': { pluginName: 'workbench', source: 'release', version: '1.0.0' } }, home)
    expect(result.workbench.origin).toBe('unknown')
  })

  it('verifies market content and detects same-version code replacement', async () => {
    const { home, directory } = await fixture('1.0.0')
    const initial = (await readInstallEvidence({}, home, ['workbench'])).workbench
    expect(initial.origin).toBe('unknown')
    const records = { 'o/workbench': { pluginName: 'workbench', version: '1.0.0', fingerprint: initial.fingerprint } }
    expect((await readInstallEvidence(records, home)).workbench.origin).toBe('market')
    await writeFile(join(directory, 'client.js'), 'different code, unchanged version')
    const next = (await readInstallEvidence(records, home)).workbench
    expect(next.origin).toBe('unknown')
    expect(next.fingerprint).not.toBe(initial.fingerprint)
  })
  it('reads real generation IDs, source specs, and local metadata translations', async () => {
    const { home } = await fixture('1.0.0')
    const root = join(home, 'profiles', '.generations'), id = 'workbench+1.0.0+abc123'
    const directory = join(root, 'live', id, 'node_modules', 'workbench')
    await mkdir(join(directory, 'locale'), { recursive: true })
    await writeFile(join(root, 'desired.json'), JSON.stringify([id]))
    await writeFile(join(root, 'live', id, 'generation.json'), JSON.stringify({ pluginName: 'workbench', version: '1.0.0', sourceSpec: 'file:/development/workbench' }))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'workbench', version: '1.0.0', dsh: { client: { entry: './client.js' } } }))
    await writeFile(join(directory, 'locale', 'zh.json'), JSON.stringify({ meta: { title: '本机名称', description: '本机说明' } }))
    await writeFile(join(directory, 'locale', 'en.json'), JSON.stringify({ meta: { title: 'Actual name', description: 'Actual description' } }))
    const result = (await readInstallEvidence({}, home, ['workbench'])).workbench
    expect(result).toMatchObject({ origin: 'local', metadata: { title: '本机名称', titleEn: 'Actual name', description: '本机说明', descriptionEn: 'Actual description' } })
  })

  it('keeps declared or present unreadable packages unknown while absent packages stay absent', async () => {
    const { home, directory } = await fixture()
    await writeFile(join(directory, 'package.json'), '{invalid')
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.origin).toBe('unknown')
    await rm(directory, { recursive: true })
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.origin).toBe('unknown')
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dependencies: {} }))
    expect(await readInstallEvidence({}, home, ['workbench'])).toEqual({})
  })

  it('does not follow plugin-owned symlinks as verified content', async () => {
    const { home, directory } = await fixture()
    const { symlink } = await import('node:fs/promises')
    await symlink('/tmp', join(directory, 'external'))
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.fingerprint).toBeUndefined()
  })
})
