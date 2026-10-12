// Mechanical patch regeneration from the pinned tarball (no registry dependency).
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { diffPackageTrees, installedInto, makeScratch, unpackInto } from './harness-patch-lib.mjs'

const pkg = '@deepseek-ai/dsh-client-ui-chat'
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const tarball = manifest.dependencies[pkg].replace(/^file:/, '')
const version = JSON.parse(await readFile(`node_modules/${pkg}/package.json`, 'utf8')).version
const scratch = await makeScratch('dsh-chat-patch-')
await unpackInto(path.resolve(tarball), pkg, path.join(scratch, 'pre'))
await installedInto(path.resolve('node_modules', pkg), pkg, path.join(scratch, 'post'))
// Ignore the editor's final newline in the generated bundle; keep the diff behavioral.
for (const side of ['pre', 'post']) {
  const file = path.join(scratch, side, 'node_modules', pkg, 'lib/client.js')
  await writeFile(file, (await readFile(file, 'utf8')).trimEnd() + '\n')
}
const patch = diffPackageTrees(scratch)
await writeFile(`patches/${pkg.replace('/', '+')}+${version}.patch`, patch)
console.log(`Regenerated chat patch from ${tarball}; comparison retained at ${scratch}`)
