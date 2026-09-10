import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The market is user-installed (including self-updates), so patching only the
// bundled copy misses it. Adapt these two stable integration points in memory;
// immutable generations and the upstream files on disk remain untouched.
export function adaptMarketGenerationSource(source, moduleName) {
  if (source.includes('validationProfileDir')) return source
  if (moduleName === 'dsh-cli.js') {
    const anchor = 'exitCode: outcome.exitCode,'
    if (source.split(anchor).length !== 2) throw new Error('unsupported market runtime contract')
    return source.replace(anchor, `${anchor}\n          validationProfileDir: outcome.validationProfileDir,`)
  }
  const start = source.indexOf('const result = await runPlugin(config.profile, addArgs);')
  const end = source.indexOf('const youngRelease =', start)
  if (start < 0 || end < 0) throw new Error('unsupported market update contract')
  let validation = source.slice(start, end)
  // Keep mutations/rollback pointed at the real profile. Only post-install
  // inspection uses the candidate composition, including its entry artifacts,
  // version, bundle trial and compatibility checks. CLI runs have no view.
  const patterns = [
    'readInstalledVersion(config.profile, name, activeProfileDir)',
    'hasLoadableEntry(activeProfileDir, name)',
    'readBundleStack(activeProfileDir)',
    'trialValidate(activeProfileDir, stack.community)',
    'verifyActivation(config.profile, name, liveNames(), activeProfileDir, disabled.has(name))',
    'assessProfile(config.profile, activeProfileDir)',
    'checkClientBundle(config.profile, name, activeProfileDir)',
    'brokenClientBundles(config.profile, activeProfileDir)',
  ]
  for (const pattern of patterns) {
    if (!validation.includes(pattern)) throw new Error(`unsupported market validation: ${pattern}`)
    validation = validation.replaceAll(pattern, pattern.replace('activeProfileDir', '(result.validationProfileDir ?? activeProfileDir)'))
  }
  const activationAnchor = 'const after = assessProfile('
  if (!validation.includes(activationAnchor)) throw new Error('unsupported market activation contract')
  validation = validation.replace(activationAnchor, `if (result.validationProfileDir && activation[name].state !== 'disabled' && activation[name].state !== 'broken') {
    activation[name] = { ...activation[name], state: 'restart', hot: false,
      reasons: ['新版本已安装，重启 DSH Desktop 后生效。 / The new version is installed; restart DSH Desktop to apply it.'] };
  }
  ${activationAnchor}`)
  return source.slice(0, start) + validation + source.slice(end)
}

export function installMarketGenerationCompatibility() {
  const adapted = new Map()
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      const { url } = resolved
      if (!url.startsWith('file:') || !/\/dshmarket\/lib\/(dsh-cli|routes)\.js$/u.test(url)) return resolved
      if (adapted.has(url)) return adapted.get(url)
      const path = fileURLToPath(url)
      const manifest = JSON.parse(readFileSync(join(dirname(path), '..', 'package.json'), 'utf8'))
      if (manifest.name !== 'dshmarket') return resolved
      const source = readFileSync(path, 'utf8')
      try {
        let patched = adaptMarketGenerationSource(source, url.endsWith('/routes.js') ? 'routes.js' : 'dsh-cli.js')
        // A global load hook changes Node 24.9's CJS/ESM linking even for
        // unrelated modules (jsdom fails with "module is not linked"). Only
        // redirect the two market modules; retain their original import base.
        patched = patched.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/gmu,
          (_match, bindings, _quote, target) => `import ${bindings} from ${JSON.stringify(nextResolve(target, { ...context, parentURL: url }).url)}`)
          .replaceAll('import.meta.url', JSON.stringify(url))
        const result = { url: `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`, format: 'module', shortCircuit: true }
        adapted.set(url, result)
        return result
      } catch (error) {
        process.stderr.write(`[desktop] market generation compatibility unavailable (${manifest.version}): ${error.message}\n`)
        return resolved
      }
    }
  })
}
