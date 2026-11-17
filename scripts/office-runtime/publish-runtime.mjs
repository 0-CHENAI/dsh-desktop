import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Publish a prepared payload atomically; Windows may briefly lock the new binaries. */
export async function publishPreparedRuntime(source, destination, {
  platform = process.platform,
  renameDirectory = rename,
  wait = delay
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await renameDirectory(source, destination)
      return
    } catch (error) {
      // Keep the payload intact between attempts and propagate the original
      // filesystem error after at most 3.15 seconds. Never copy or unlink it.
      if (platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt >= 6) throw error
      await wait(50 * 2 ** attempt)
    }
  }
}
