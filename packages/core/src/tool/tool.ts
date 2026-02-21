/**
 * Tool barrel — re-exports all agent tools.
 *
 * The package.json `exports` map points `@agents/core/tool` here.
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
