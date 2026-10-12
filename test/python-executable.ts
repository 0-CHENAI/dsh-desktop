import { resolve } from 'node:path'

// pretest prepares the pinned Office Python; avoid Windows Store python3 aliases.
export const pythonExecutable = process.platform === 'win32'
  ? resolve('.build/office-runtime/primary-runtime/dependencies/python/python.exe')
  : 'python3'
