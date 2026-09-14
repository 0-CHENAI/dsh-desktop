/**
 * Shared helpers for moving Desktop's package patches across Harness releases.
 *
 * Both sides of that job need the same two primitives: unpack a pinned release
 * into a layout a patch can target, and diff two such layouts in the shape
 * patch-package reads (`-p1`, paths under `node_modules/<scope>/<name>`).
 *
 * Patches are generated here rather than with `patch-package --make` because
 * makePatch re-installs the package from the registry into a scratch folder,
 * which is both slow and unavailable offline; the vendored tarball is the same
 * bytes and is already on disk.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export function run (file, args, cwd) {
  try {
    return execFileSync(file, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const detail = (error.stderr ?? error.message).toString().trim().split('\n').slice(0, 6).join(' | ')
    throw new Error(detail)
  }
}

/** `git diff --no-index` exits 1 when the trees differ, which is the normal case. */
export function runDiff (args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (error.status === 1 && error.stdout) return error.stdout
    const detail = (error.stderr ?? error.message).toString().trim().split('\n').slice(0, 6).join(' | ')
    throw new Error(detail)
  }
}

/** `@deepseek-ai+dsh-llm-pi-ai+0.1.5-rc.1.patch` -> package name and version. */
export function parsePatchFileName (name) {
  const parts = name.replace(/\.patch$/, '').split('+')
  return { package: `${parts[0]}/${parts[1]}`, version: parts.slice(2).join('+') }
}

export const flattened = name => name.replace('@', '').replace('/', '-')

/**
 * patch-package's file name for a package at a version: the scope keeps its `@`
 * and only the `/` becomes `+`, as in `@deepseek-ai+dsh+0.1.5-rc.2.patch`.
 */
export const patchFileBase = (package_, version) => `${package_.replace('/', '+')}+${version}`

/** The tarball a vendored package+version lives in, or null when it is not vendored. */
export const tarballPathFor = (vendorDir, package_, version) => {
  const bucket = package_ === '@deepseek-ai/dsh' || package_.startsWith('@deepseek-ai/dsh-') ? 'npm-dsh' : 'npm-vendor'
  return path.join(vendorDir, bucket, `${flattened(package_)}-${version}.tgz`)
}

/** Pull a non-vendored package from the registry, so the base is never an already patched tree. */
export async function packInto (package_, version, directory, registry = 'https://registry.npmmirror.com') {
  const out = path.join(directory, 'pack')
  await mkdir(out, { recursive: true })
  run('npm', ['pack', `${package_}@${version}`, '--pack-destination', out, `--registry=${registry}`, '--silent'])
  const [file] = (await readdir(out)).filter(name => name.endsWith('.tgz'))
  if (!file) throw new Error(`npm pack produced no tarball for ${package_}@${version}`)
  return path.join(out, file)
}

/** Unpack a tarball to `<prefix>/node_modules/<scope>/<name>`, the layout `-p1` expects. */
export async function unpackInto (tgzPath, package_, prefixDirectory) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'harness-unpack-'))
  const parent = path.join(prefixDirectory, 'node_modules', path.dirname(package_))
  await mkdir(parent, { recursive: true })
  run('tar', ['-xzf', tgzPath, '-C', scratch])
  await rename(path.join(scratch, 'package'), path.join(parent, path.basename(package_)))
  await rm(scratch, { recursive: true, force: true })
}

/** Copy a directory that already holds an installed package into the same layout. */
export async function installedInto (packageDirectory, package_, prefixDirectory) {
  const destination = path.join(prefixDirectory, 'node_modules', package_)
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(packageDirectory, destination, { recursive: true })
}

/**
 * Diff two package trees into a patch file body.
 *
 * git labels its own `a/` `b/` on top of the tree names, which would bake
 * `a/pre/...` into every path; collapsing those back gives the `-p1` shape that
 * patch-package and `git apply` both accept against a repository root.
 */
export function diffPackageTrees (root, { files = [] } = {}) {
  const raw = runDiff(
    ['-c', 'core.quotepath=false', 'diff', '--no-index', '--no-color', '--unified=3', '--', 'pre', 'post'],
    root
  )
  return raw
    .split('\n')
    .map(line => {
      if (line.startsWith('diff --git a/pre/')) return line.replace('a/pre/', 'a/').replace('b/post/', 'b/')
      if (line.startsWith('--- a/pre/')) return `--- a/${line.slice('--- a/pre/'.length)}`
      if (line.startsWith('+++ b/post/')) return `+++ b/${line.slice('+++ b/post/'.length)}`
      return line
    })
    .join('\n')
}

export async function makeScratch (prefix = 'harness-') {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

export function sha512 (buffer) {
  return createHash('sha512').update(buffer).digest('base64')
}
