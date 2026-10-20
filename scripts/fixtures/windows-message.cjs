// Isolated native test probe. Only message this test's live window; never log
// off, shut down Windows, broadcast, or target a window from another process.
const { createRequire } = require('node:module')
const { join, isAbsolute } = require('node:path')

const [project, handleText, messageText, ownerText] = process.argv.slice(2)
const message = Number(messageText), owner = Number(ownerText)
if (process.platform !== 'win32' || !project || !isAbsolute(project) ||
  !/^\d+$/.test(handleText || '') || BigInt(handleText) <= 0n || BigInt(handleText) > 0xffffffffffffffffn ||
  ![0x11, 0x16].includes(message) || !Number.isSafeInteger(owner) || owner <= 0) {
  throw new Error('Invalid isolated Windows message probe arguments')
}
if (owner !== process.ppid) throw new Error('Probe can only message its parent Electron process')

// Reuse the locked binding already exercised by the packaged native probe.
// A separate process keeps the target Electron message loop free to receive it.
const requireHost = createRequire(join(project, 'package.json'))
const koffi = requireHost('koffi')
const user32 = koffi.load('user32.dll')
const ownerOf = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *owner)')
const send = user32.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t window, uint32_t message, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)')
const handle = BigInt(handleText), actualOwner = [0]
if (!ownerOf(handle, actualOwner) || actualOwner[0] !== owner) throw new Error('Window no longer belongs to this test process')
if (!send(handle, message, message === 0x16 ? 1 : 0, 0, 3, 2000, [0])) {
  throw new Error('The isolated test window did not acknowledge its native message')
}
