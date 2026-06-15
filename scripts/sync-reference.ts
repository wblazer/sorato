#!/usr/bin/env bun
/**
 * Syncs reference repos into `.reference/` based on `.reference/manifest.json`.
 *
 * Each repo is cloned as a *blobless* partial clone (`--filter=blob:none`) so we
 * skip the bulk of git history blobs but can still check out any pinned commit.
 *
 * `ref` may be:
 *   - a tag      (e.g. "effect@4.0.0-beta.74")  -> pinned, reproducible
 *   - a commit   (40-char sha)                  -> pinned, reproducible
 *   - a branch   (e.g. "main")                  -> tracks that branch
 *   - "latest"   -> tracks the remote's default branch HEAD
 *
 * Optional per-repo fields:
 *   - sparse: string[]  -> sparse-checkout only these paths
 *
 * Usage:
 *   bun run reference:sync            # sync all repos
 *   bun run reference:sync effect-v4  # sync only named repos
 */
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface RepoSpec {
  name: string
  url: string
  ref: string
  sparse?: string[]
}

interface Manifest {
  repos: RepoSpec[]
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const referenceDir = join(root, '.reference')
const manifestPath = join(referenceDir, 'manifest.json')

const manifest = (await Bun.file(manifestPath).json()) as Manifest

const filter = new Set(Bun.argv.slice(2))
const repos =
  filter.size > 0
    ? manifest.repos.filter((r) => filter.has(r.name))
    : manifest.repos

if (repos.length === 0) {
  console.error(
    filter.size > 0
      ? `No repos matched: ${[...filter].join(', ')}`
      : 'No repos in manifest.'
  )
  process.exit(1)
}

/** Resolve a ref to a concrete commit sha against the remote. */
async function resolveRemoteCommit(url: string, ref: string): Promise<string> {
  if (ref === 'latest') {
    const out = await $`git ls-remote --symref ${url} HEAD`.text()
    // First non-symref line: "<sha>\tHEAD"
    const line = out.split('\n').find((l) => /^[0-9a-f]{40}\s/.test(l))
    if (!line)
      throw new Error(`Could not resolve default branch HEAD for ${url}`)
    return line.split(/\s+/)[0]!
  }
  if (/^[0-9a-f]{40}$/.test(ref)) return ref
  // Tag or branch: prefer the dereferenced tag object (^{}) if present.
  const out =
    await $`git ls-remote ${url} refs/tags/${ref}^{} refs/tags/${ref} refs/heads/${ref}`.text()
  const lines = out.split('\n').filter(Boolean)
  const deref = lines.find((l) => l.includes(`refs/tags/${ref}^{}`))
  const direct = lines[0]
  const chosen = deref ?? direct
  if (!chosen) throw new Error(`Could not resolve ref "${ref}" for ${url}`)
  return chosen.split(/\s+/)[0]!
}

async function currentCommit(dest: string): Promise<string | null> {
  try {
    return (await $`git -C ${dest} rev-parse HEAD`.text()).trim()
  } catch {
    return null
  }
}

async function syncRepo(repo: RepoSpec): Promise<void> {
  const dest = join(referenceDir, repo.name)
  const target = await resolveRemoteCommit(repo.url, repo.ref)
  const have = existsSync(join(dest, '.git')) ? await currentCommit(dest) : null

  if (have === target) {
    console.log(`✓ ${repo.name} up to date (${target.slice(0, 10)})`)
    return
  }

  if (!have) {
    console.log(`↓ cloning ${repo.name} @ ${repo.ref}`)
    await $`git clone --filter=blob:none --no-checkout ${repo.url} ${dest}`.quiet()
  } else {
    console.log(`↻ updating ${repo.name} -> ${repo.ref}`)
  }

  if (repo.sparse && repo.sparse.length > 0) {
    await $`git -C ${dest} sparse-checkout set ${repo.sparse}`.quiet()
  }

  // Make sure the target commit is fetched, then check it out detached.
  await $`git -C ${dest} fetch --filter=blob:none origin ${target}`.quiet()
  await $`git -C ${dest} checkout --detach --force ${target}`.quiet()

  console.log(`✓ ${repo.name} @ ${repo.ref} (${target.slice(0, 10)})`)
}

let failed = 0
for (const repo of repos) {
  try {
    await syncRepo(repo)
  } catch (err) {
    failed++
    console.error(`✗ ${repo.name}: ${err instanceof Error ? err.message : err}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} repo(s) failed to sync.`)
  process.exit(1)
}
