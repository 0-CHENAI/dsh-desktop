import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export function macPackagePaths(outputDirectory, productName, artifactStem, arch) {
  if (!outputDirectory || !productName || !artifactStem || !arch) {
    throw new Error('output directory, product name, artifact stem, and architecture are required')
  }

  return {
    app: path.resolve(outputDirectory, `mac-${arch}`, `${productName}.app`),
    dmg: path.resolve(outputDirectory, `${artifactStem}.dmg`),
    zip: path.resolve(outputDirectory, `${artifactStem}.zip`)
  }
}

async function requirePath(target) {
  await stat(target).catch(() => {
    throw new Error(`Required macOS package path is missing: ${target}`)
  })
}

async function run(file, args, options = {}) {
  return execFile(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options })
}

async function signatureSummary(appPath) {
  const result = await run('/usr/bin/codesign', ['--display', '--verbose=4', appPath])
  const summary = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!summary.includes('Signature=adhoc') && !summary.includes('Authority=Developer ID Application')) {
    throw new Error(`${appPath} is not ad-hoc or Developer ID signed`)
  }
  return summary.includes('Signature=adhoc') ? 'ad-hoc' : 'Developer ID'
}

async function verifyApp(appPath) {
  await requirePath(appPath)
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  return signatureSummary(appPath)
}

async function assessGatekeeper(appPath, signature) {
  try {
    await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  } catch (error) {
    if (signature !== 'ad-hoc') throw error
    console.log(
      'Gatekeeper rejected the ad-hoc signature as expected; users must approve the app once in System Settings > Privacy & Security.'
    )
  }
}

export async function verifyMacPackage({ outputDirectory, productName, artifactStem, arch }) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS packages must be verified on macOS')
  }

  const paths = macPackagePaths(outputDirectory, productName, artifactStem, arch)
  await Promise.all(Object.values(paths).map(requirePath))

  const unpackedSignature = await verifyApp(paths.app)
  await assessGatekeeper(paths.app, unpackedSignature)

  const zipRoot = await mkdtemp(path.join(tmpdir(), 'dsh-macos-zip-'))
  const dmgRoot = await mkdtemp(path.join(tmpdir(), 'dsh-macos-dmg-'))
  let dmgMounted = false

  try {
    await run('/usr/bin/ditto', ['-x', '-k', paths.zip, zipRoot])
    const zipApp = path.join(zipRoot, `${productName}.app`)
    const zipSignature = await verifyApp(zipApp)
    await assessGatekeeper(zipApp, zipSignature)

    await run('/usr/bin/hdiutil', [
      'attach',
      paths.dmg,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      dmgRoot
    ])
    dmgMounted = true
    const dmgApp = path.join(dmgRoot, `${productName}.app`)
    const dmgSignature = await verifyApp(dmgApp)
    await assessGatekeeper(dmgApp, dmgSignature)

    if (new Set([unpackedSignature, zipSignature, dmgSignature]).size !== 1) {
      throw new Error('macOS package containers do not carry the same signature type')
    }

    console.log(
      `Verified ${unpackedSignature} signatures in the unpacked app, ZIP, and DMG for ${artifactStem}.`
    )
  } finally {
    if (dmgMounted) {
      await run('/usr/bin/hdiutil', ['detach', dmgRoot]).catch((error) => {
        console.error(`Unable to detach temporary disk image mount: ${error.message}`)
      })
    }
    await Promise.all([
      rm(zipRoot, { recursive: true, force: true }),
      rm(dmgRoot, { recursive: true, force: true })
    ])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outputDirectory, productName, artifactStem, arch] = process.argv.slice(2)
  await verifyMacPackage({ outputDirectory, productName, artifactStem, arch })
}
