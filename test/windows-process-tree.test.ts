import { describe, expect, it } from 'vitest'
import { windowsProcessTreeKillArguments } from '../src/main/runtime/harness-runtime'

describe('Windows Harness process-tree cleanup', () => {
  it('force-terminates the detached process and all descendants', () => {
    expect(windowsProcessTreeKillArguments(4242)).toEqual(['/pid', '4242', '/t', '/f'])
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid process id (%s)', (pid) => {
    expect(() => windowsProcessTreeKillArguments(pid)).toThrow(/Invalid Windows process id/)
  })
})
