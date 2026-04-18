import type { Plugin } from '@opencode-ai/plugin'

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join, dirname, resolve, relative, basename } from 'node:path'
import { homedir } from 'node:os'

const DOC_FILENAME = 'DOCS.md'
const CACHE_DIR = join(homedir(), '.cache', 'opencode', 'docs-autoload')
const CACHE_TTL_DAYS = 14

type ReadToolInput = {
  readonly args?: {
    readonly filePath?: string
  }
}

function getSessionCacheFile(sessionID: string): string {
  mkdirSync(CACHE_DIR, { recursive: true })
  return join(CACHE_DIR, `${sessionID}.json`)
}

function loadSessionState(sessionID: string): Set<string> {
  const cacheFile = getSessionCacheFile(sessionID)
  if (!existsSync(cacheFile)) return new Set()
  try {
    const data = JSON.parse(readFileSync(cacheFile, 'utf-8'))
    return new Set(data.loadedNodes || [])
  } catch {
    return new Set()
  }
}

function saveSessionState(sessionID: string, loadedNodes: Set<string>) {
  const cacheFile = getSessionCacheFile(sessionID)
  writeFileSync(
    cacheFile,
    JSON.stringify({
      loadedNodes: Array.from(loadedNodes),
      lastUpdated: new Date().toISOString(),
    })
  )
}

function cleanupOldCaches() {
  if (!existsSync(CACHE_DIR)) return
  const now = Date.now()
  const maxAge = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  try {
    for (const file of readdirSync(CACHE_DIR)) {
      if (!file.endsWith('.json')) continue
      const filePath = join(CACHE_DIR, file)
      if (now - statSync(filePath).mtimeMs > maxAge) {
        unlinkSync(filePath)
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Walk from `startDir` up to `root` (inclusive), collecting any DOCS.md files found.
 * Returns them in ancestor-first order (outermost directory first).
 */
function discoverAncestorDocs(
  startDir: string,
  root: string
): Array<{ absolutePath: string; relativePath: string }> {
  const found: Array<{ absolutePath: string; relativePath: string }> = []
  let current = resolve(startDir)
  const resolvedRoot = resolve(root)

  while (current.startsWith(resolvedRoot)) {
    const docPath = join(current, DOC_FILENAME)
    if (existsSync(docPath)) {
      found.push({
        absolutePath: docPath,
        relativePath: relative(resolvedRoot, docPath),
      })
    }
    if (current === resolvedRoot) break
    current = dirname(current)
  }

  // Reverse so parent nodes come before child nodes
  found.reverse()
  return found
}

export const DocsAutoloadPlugin: Plugin = async ({ worktree }) => {
  cleanupOldCaches()

  return {
    'tool.execute.after': async (input, output) => {
      if (input.tool !== 'read') return

      const filePath = (input as ReadToolInput).args?.filePath
      const sessionID = input.sessionID
      if (!filePath || !sessionID) return

      const resolvedPath = resolve(filePath)

      // Don't process files outside the worktree
      if (!resolvedPath.startsWith(resolve(worktree))) return

      const loadedNodes = loadSessionState(sessionID)

      const isExplicitDocRead = basename(resolvedPath) === DOC_FILENAME

      // For explicit DOCS.md reads, record the file itself as loaded.
      // Then still discover ancestors — the read file's own directory is the
      // starting point either way, but we exclude the file being read from
      // injection since the agent is already looking at its contents.
      if (isExplicitDocRead) {
        loadedNodes.add(resolvedPath)
      }

      // Discover ancestor DOCS.md files from the file's directory upward.
      // For explicit reads, start from the parent of the DOCS.md's directory
      // (the agent already has the content of the file they're reading).
      const startDir = isExplicitDocRead
        ? dirname(dirname(resolvedPath))
        : dirname(resolvedPath)

      // Guard: if startDir fell outside worktree (e.g. DOCS.md at worktree root)
      const resolvedWorktree = resolve(worktree)
      const ancestors = startDir.startsWith(resolvedWorktree)
        ? discoverAncestorDocs(startDir, worktree)
        : []

      const newNodes = ancestors.filter(
        (node) => !loadedNodes.has(node.absolutePath)
      )

      if (newNodes.length > 0) {
        const parts = newNodes.map((node) => {
          const content = readFileSync(node.absolutePath, 'utf-8')
          return `<autoloaded-docs>\n<path>${node.relativePath}</path>\n<content>\n${content}</content>\n</autoloaded-docs>`
        })

        output.output += `\n\n${parts.join('\n\n')}`

        for (const node of newNodes) {
          loadedNodes.add(node.absolutePath)
        }
      }

      saveSessionState(sessionID, loadedNodes)
    },

    event: async ({ event }) => {
      if (event.type !== 'session.deleted') return
      const sessionID = event.properties?.info?.id
      if (!sessionID) return
      try {
        const cacheFile = getSessionCacheFile(sessionID as string)
        if (existsSync(cacheFile)) unlinkSync(cacheFile)
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}
