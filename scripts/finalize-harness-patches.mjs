/** Regenerate reviewed migration trees and prove patches reverse-apply exactly. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { diffPackageTrees } from './harness-patch-lib.mjs'

const root = path.resolve(import.meta.dirname, '..')
const { stage } = JSON.parse(await readFile(path.join(root, '.build/harness-migration/latest.json'), 'utf8'))
const report = JSON.parse(await readFile(path.join(stage, 'report.json'), 'utf8'))
let failed = 0
for (const record of report) {
  delete record.error
  // This non-Harness adapter was separately recaptured against npm's pristine
  // 0.87.1 package with patch-package, not the migration's old 0.85.1 tree.
  if (record.name === '@earendil-works/pi-ai') {
    await readFile(path.join(root, 'patches/@earendil-works+pi-ai+0.87.1.patch'), 'utf8')
    record.next = '0.87.1'
    record.status = 'recaptured'
    console.log(JSON.stringify(record))
    continue
  }
  // Harness 0.2 has a native model search; retaining the former search would
  // double-own its input and React refs. Verify it through the native UI tests.
  if (record.name === '@deepseek-ai/dsh-client-ui-model-selection') {
    record.status = 'native-replacement'
    console.log(JSON.stringify(record))
    continue
  }
  const directory = path.join(stage, record.name.replace(/[@/]/g, '-'))
  const target = path.join(directory, 'post/node_modules', record.name)
  try {
    for (const file of record.conflicts) {
      const text = await readFile(path.join(target, file), 'utf8')
      if (/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m.test(text)) throw new Error(`unresolved ${file}`)
      if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(target, file)], { stdio: 'pipe' })
    }
    const patch = diffPackageTrees(directory)
    const verify = path.join(directory, 'result.patch')
    await writeFile(verify, patch)
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '-R', '--check', verify], { cwd: path.join(directory, 'post'), stdio: 'pipe' })
    const patchTarget = path.join(root, 'patches', `${record.name.replace('/', '+')}+${record.next}.patch`)
    await writeFile(`${patchTarget}.tmp`, patch)
    await rename(`${patchTarget}.tmp`, patchTarget)
    record.status = 'ported'
  } catch (error) {
    record.status = 'needs-review'
    record.error = String(error.stderr ?? error.message)
    failed++
  }
  console.log(JSON.stringify(record))
}
await writeFile(path.join(stage, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (failed) process.exitCode = 1
