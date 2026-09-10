import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { installMarketGenerationCompatibility } from '../../build/market-generation-compat.mjs'
import { createDesktopPnpmService } from '../../packages/dsh-desktop-market-installer/index.js'
import { projectGenerations } from '../../packages/dsh-desktop-market-installer/generations/projection.mjs'

const home = await mkdtemp(join(tmpdir(), 'market-update-route-'))
process.env.DSH_HOME = home
for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'npm_config_proxy', 'npm_config_https_proxy']) delete process.env[key]
globalThis.fetch = async () => new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 })
const broken = process.argv.includes('--broken')
const invalidPatch = process.argv.includes('--invalid-patch')
const mismatch = process.argv.includes('--mismatch')
const unpatched = process.argv.includes('--unpatched')
const external = process.argv.find(arg => arg.startsWith('--market='))?.slice('--market='.length)
if (!unpatched) installMarketGenerationCompatibility()
const marketRoot = external ?? resolve('packages/dshmarket')
const { mountMarketRoutes } = await import(pathToFileURL(join(marketRoot, 'lib/routes.js')))
const { createDesktopPluginRuntime } = await import(pathToFileURL(join(marketRoot, 'lib/dsh-cli.js')))
const profile = join(home, 'profiles', 'web')
const services = []
function service(version) {
  const svc = createDesktopPnpmService({
    home, binDirectory: join(home, '.desktop-bin'), dshEntryPath: join(home, 'bin.js'),
    runGenerationInstall: async directory => {
      const pkg = join(directory, 'node_modules', 'widget')
      await mkdir(pkg, { recursive: true })
      await writeFile(join(pkg, 'package.json'), JSON.stringify({
        name: 'widget', version: mismatch && version === '2.0.0' ? '1.5.0' : version, main: 'index.js', dsh: { bundle: { patch: 'cordis.patch.yml' } }
      }))
      if (!broken || version === '1.0.0') await writeFile(join(pkg, 'index.js'), 'export const name = "widget";')
      await writeFile(join(pkg, 'cordis.patch.yml'), invalidPatch && version === '2.0.0' ? '[ invalid yaml' : '[]\n')
      await writeFile(join(directory, 'pnpm-lock.yaml'), `lock-${version}`)
      return { code: 0, output: '' }
    }
  })
  services.push(svc)
  return svc
}
let disposeRoutes
let runtime
try {
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'test-profile', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }))
  const first = service('1.0.0').runExternalMarketPluginInstall(['add', 'widget@1.0.0'], profile)
  first.stdout.resume(); first.stderr.resume()
  await first.done
  await projectGenerations(home)
  const activeLink = join(profile, 'node_modules', 'widget')
  const before = await readlink(activeLink)
  const routes = new Map()
  const updater = service('2.0.0')
  // Rollback requests install their requested exact version too.
  const rollback = service('1.0.0')
  runtime = createDesktopPluginRuntime({
    runPlugin: updater.runPlugin,
    runExternalMarketPluginInstall(args, ...rest) {
      return (args.includes('widget@1.0.0') ? rollback : updater).runExternalMarketPluginInstall(args, ...rest)
    }
  }, profile)
  disposeRoutes = mountMarketRoutes({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => {} } },
    loader: { entries: () => [] },
    plugin: () => ({ await: async () => {}, dispose: () => {} }),
  }, { profile: 'web', profileDirectory: profile, region: 'global', allowRestart: false }, runtime, () => ({ list: () => [] }))
  let status
  let payload
  const request = Readable.from([JSON.stringify({ name: 'widget', force: true })])
  request.method = 'POST'
  request.headers = { host: 'localhost', origin: 'http://localhost' }
  const response = { writeHead(code) { status = code }, end(body) { payload = JSON.parse(body) } }
  await routes.get('/dsh-market/update')(request, response)
  const activeVersion = JSON.parse(await readFile(join(activeLink, 'package.json'), 'utf8')).version
  console.log(JSON.stringify({ status, payload, activeVersion, linkUnchanged: before === await readlink(activeLink) }))
} finally {
  disposeRoutes?.()
  await runtime?.dispose()
  for (const svc of services) await svc.dispose()
  await rm(home, { recursive: true, force: true })
}
