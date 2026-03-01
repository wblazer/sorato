/**
 * Tool barrel — re-exports all agent tools.
 *
 * The package.json `exports` map points `@agents/agent/tool` here.
 */

// Hashline protocol — content-hash anchored read + edit
export {
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
  encode,
  hashLine,
  HASH_LENGTH,
  parseAnchor,
  resolveAnchor,
} from './hashline/index.ts'
export type { Anchor } from './hashline/index.ts'

// Bash — shell command execution
export { Bash, BashHandler } from './bash.ts'

// WriteFile — file creation/overwrite
export { WriteFile, WriteFileHandler } from './write.ts'

// Glob — file pattern matching
export { Glob, GlobHandler } from './glob.ts'

// Grep — regex content search
export { Grep, GrepHandler } from './grep.ts'
