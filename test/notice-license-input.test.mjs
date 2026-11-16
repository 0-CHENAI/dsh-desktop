import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('preserves the approved notice font license bytes on Windows and POSIX checkouts', () => {
  const file = 'packages/dsh-desktop-office/sources/curated/government-notice/OFL.txt'
  const bytes = readFileSync(file)
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903')
  expect(readFileSync('.gitattributes', 'utf8')).toContain(`${file} -text`)
})
