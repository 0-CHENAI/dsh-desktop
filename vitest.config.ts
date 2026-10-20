import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.{ts,js,mjs}'],
    // Native suites launch Office/Electron helpers as well as unpacking archives.
    // Bound CI contention on both Mac architectures and Windows; keep every
    // assertion and timeout instead of excluding native integration coverage.
    fileParallelism: !(
      process.env.CI &&
      (process.platform === 'darwin' || process.platform === 'win32')
    ),
    testTimeout: 60_000
  }
})
