import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { publishPreparedRuntime } from '../scripts/office-runtime/publish-runtime.mjs'

const temporary = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-publish-'))
  temporary.push(root)
  const source = join(root, 'prepared'), destination = join(root, 'runtime')
  await mkdir(source)
  await writeFile(join(source, 'marker'), 'new payload')
  return { source, destination }
}

it('publishes the prepared directory after a transient Windows rename lock', async () => {
  const { source, destination } = await fixture()
  const renameDirectory = vi.fn(rename)
    .mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))
    .mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EBUSY' }))
  await publishPreparedRuntime(source, destination, { platform: 'win32', renameDirectory, wait: async () => {} })
  expect(await readFile(join(destination, 'marker'), 'utf8')).toBe('new payload')
  expect(renameDirectory).toHaveBeenCalledTimes(3)
})

it('bounds retries and preserves both directories and the original persistent error', async () => {
  const { source, destination } = await fixture()
  await mkdir(destination)
  await writeFile(join(destination, 'marker'), 'old payload')
  const denied = Object.assign(new Error('persistent lock'), { code: 'EACCES' })
  const renameDirectory = vi.fn().mockRejectedValue(denied)
  const wait = vi.fn(async () => {})
  await expect(publishPreparedRuntime(source, destination, { platform: 'win32', renameDirectory, wait })).rejects.toBe(denied)
  expect(renameDirectory).toHaveBeenCalledTimes(7)
  expect(wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBeLessThanOrEqual(3150)
  expect(await readFile(join(source, 'marker'), 'utf8')).toBe('new payload')
  expect(await readFile(join(destination, 'marker'), 'utf8')).toBe('old payload')
})

it.each([{ platform: 'linux', code: 'EPERM' }, { platform: 'win32', code: 'ENOSPC' }])('does not retry unrelated errors: %j', async ({ platform, code }) => {
  const error = Object.assign(new Error('not a transient Windows lock'), { code })
  const renameDirectory = vi.fn().mockRejectedValue(error)
  const wait = vi.fn()
  await expect(publishPreparedRuntime('source', 'destination', { platform, renameDirectory, wait })).rejects.toBe(error)
  expect(renameDirectory).toHaveBeenCalledOnce()
  expect(wait).not.toHaveBeenCalled()
})
