import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({ realpath: vi.fn(), readFile: vi.fn() }))
vi.mock('node:fs/promises', () => fs)
import { serveWebDocument } from '../../src/main/shell/window/web-document'

it('refuses physical assets on a different Windows drive before reading bytes', async () => {
  const directory = resolve('frontend')
  const outside = process.platform === 'win32'
    ? `${directory[0]?.toUpperCase() === 'D' ? 'E' : 'D'}:\\private\\credentials.txt`
    : '/outside-frontend/credentials.txt'
  fs.realpath.mockResolvedValueOnce(directory).mockResolvedValueOnce(outside)
  fs.readFile.mockResolvedValue(Buffer.from('private fixture'))
  const response = await serveWebDocument(new Request('dsh-app://app/assets/link.txt'), directory)
  expect(response.status).toBe(404)
  expect(fs.readFile).not.toHaveBeenCalled()
})
