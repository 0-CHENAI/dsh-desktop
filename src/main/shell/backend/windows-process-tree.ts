import { execFile } from 'node:child_process'

/** A verified owned Host PID, never a shell command or process-name pattern. */
export function windowsProcessTreeKillArguments(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid Windows process id: ${pid}`)
  return ['/pid', String(pid), '/t', '/f']
}

/** Last resort after graceful Host shutdown expires; includes orphan-prone tool children. */
export function terminateWindowsProcessTree(pid: number): Promise<void> {
  const args = windowsProcessTreeKillArguments(pid)
  return new Promise((resolve, reject) => {
    execFile('taskkill', args, { windowsHide: true, timeout: 5_000 }, error => {
      if (error === null) resolve()
      else reject(new Error(`Unable to stop owned Host process tree ${pid}`, { cause: error }))
    })
  })
}
