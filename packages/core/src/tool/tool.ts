/**
 * Tool barrel — re-exports all agent tools.
 *
 * The package.json `exports` map points `@sorato/core/tool` here.
 */

// Hashline protocol — content-hash anchored read + edit
export {
  Read,
  ReadHandler,
  Edit,
  EditHandler,
  encode,
  hashLine,
  HASH_LENGTH,
  parseAnchor,
  resolveAnchor,
} from './hashline/index.ts'
export type { Anchor } from './hashline/index.ts'

// Bash — shell command execution
export { Bash, BashHandler } from './bash.ts'

// Write — file creation/overwrite
export { Write, WriteHandler } from './write.ts'

// Glob — file pattern matching
export { Glob, GlobHandler } from './glob.ts'

// Grep — regex content search
export { Grep, GrepHandler } from './grep.ts'

// WebFetch — web content retrieval
export { WebFetch, WebFetchHandler, WebFetchError } from './web-fetch.ts'
