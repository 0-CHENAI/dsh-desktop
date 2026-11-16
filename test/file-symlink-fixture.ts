import { symlink } from 'node:fs/promises'
import type { TestContext } from 'vitest'

/** File symlinks need a Windows privilege; directory cases always use junctions. */
export async function fileSymlinkFixture(target: string, path: string, test: TestContext, type: 'file' | 'dir' = 'file'): Promise<void> {
  try {
    await symlink(target, path, type)
  } catch (error) {
    if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') {
      test.skip()
    }
    throw error
  }
}
