import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// The market is Profile-owned in Harness 0.2. Keep its older compatibility
// fixture outside the production node_modules so it cannot shadow that copy.
export function legacyMarketFixture(): string {
  // registry.npmjs.org/dshmarket/-/dshmarket-1.45.1.tgz, immutable npm SHA-512.
  const tarball = resolve('test/fixtures/dshmarket-1.45.1.tgz')
  const digest = createHash('sha512').update(readFileSync(tarball)).digest('base64')
  if (digest !== 'Vmn+nuwBNtaE+VkQ9Flw3llrx0rCugEzGYYcS7xFoIx7uhKowRVz4LSDNFG4qeYOhFm2r+oi3qXcGRpy7Tf1Sw==') {
    throw new Error('Legacy market fixture integrity mismatch')
  }
  const root = resolve('.build/market-legacy/node_modules/dshmarket')
  if (!existsSync(resolve(root, 'package.json'))) {
    mkdirSync(root, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', root, '--strip-components=1'])
  }
  return root
}
