import { expect, it } from 'vitest'
import config, { nativeTestFileParallelism } from '../vitest.config'

it.each(['win32', 'darwin'] as const)('serializes every native CI suite on %s independently of architecture', platform => {
  expect(nativeTestFileParallelism(platform, 'true')).toBe(false)
})

it('applies the actual host policy without excluding native coverage', () => {
  expect(config.test?.fileParallelism).toBe(nativeTestFileParallelism(process.platform, process.env.CI))
  expect(config.test?.include).toEqual(['test/**/*.{test,spec}.{ts,js,mjs}'])
  expect(config.test?.exclude).toBeUndefined()
})

it('keeps local test file parallelism available', () => {
  expect(nativeTestFileParallelism('win32', '')).toBe(true)
})

it('does not serialize non-native CI checks', () => {
  expect(nativeTestFileParallelism('linux', 'true')).toBe(true)
})
