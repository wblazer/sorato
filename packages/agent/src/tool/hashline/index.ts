/**
 * Hashline tool bundle — ReadFile + EditFile sharing content-hash anchors.
 *
 * Import the pair together since they form a protocol:
 *   import { ReadFile, EditFile, ... } from './hashline'
 */
export {
  encode,
  hashLine,
  HASH_LENGTH,
  parseAnchor,
  resolveAnchor,
} from './encoding.ts'
export type { Anchor } from './encoding.ts'
export {
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
} from './tools.ts'
