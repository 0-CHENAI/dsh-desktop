import { defineConfig } from 'vitest/config'

// Keep this policy pure: spoofing process.platform while importing Vitest can
// make Rollup try to load a native binary for a different host.
export function nativeTestFileParallelism(platform: NodeJS.Platform, ci: string | undefined): boolean {
  return !(ci && (platform === 'darwin' || platform === 'win32'))
}

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.{ts,js,mjs}'],
    // Native suites launch Office/Electron helpers as well as unpacking archives.
    // Bound CI contention on both Mac architectures and Windows; keep every
    // assertion and timeout instead of excluding native integration coverage.
    fileParallelism: nativeTestFileParallelism(process.platform, process.env.CI),
    testTimeout: 60_000
  }
})
