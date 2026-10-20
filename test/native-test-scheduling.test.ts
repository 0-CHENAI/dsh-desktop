import { afterEach, expect, it, vi } from 'vitest'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')

afterEach(() => {
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
  if (archDescriptor) Object.defineProperty(process, 'arch', archDescriptor)
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function configuration(platform: string, ci: string, arch = 'x64') {
  vi.stubEnv('CI', ci)
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform })
  Object.defineProperty(process, 'arch', { ...archDescriptor, value: arch })
  vi.resetModules()
  return (await import('../vitest.config')).default
}

it.each([['win32', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']])('serializes every native CI suite on %s/%s without excluding tests', async (platform, arch) => {
  const config = await configuration(platform, 'true', arch)
  expect(config.test?.fileParallelism).toBe(false)
  expect(config.test?.include).toEqual(['test/**/*.{test,spec}.{ts,js,mjs}'])
  expect(config.test?.exclude).toBeUndefined()
})

it('keeps local test file parallelism available', async () => {
  expect((await configuration('win32', '')).test?.fileParallelism).toBe(true)
})

it('does not serialize non-native CI checks', async () => {
  expect((await configuration('linux', 'true')).test?.fileParallelism).toBe(true)
})
