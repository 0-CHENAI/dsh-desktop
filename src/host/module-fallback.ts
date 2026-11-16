import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Only missing shared Harness peers may cross from a physical plugin to this installation. */
export function registerHostModuleFallback(installationAnchor: string): () => void {
  const hostUrl = pathToFileURL(installationAnchor).href
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        // Exports refusals are intentional, not missing peers. Ordinary third-
        // party dependencies and a plugin's own installed peers keep precedence.
        if (!specifier.startsWith('@deepseek-ai/') || !(error instanceof Error)
          || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
        try {
          return nextResolve(specifier, { ...context, parentURL: hostUrl })
        } catch (hostError) {
          const detail = hostError instanceof Error ? hostError.message : String(hostError)
          error.message += `\nDesktop host fallback from ${hostUrl} also failed: ${detail}`
          error.cause ??= hostError
          throw error
        }
      }
    }
  })
  return () => hooks.deregister()
}
