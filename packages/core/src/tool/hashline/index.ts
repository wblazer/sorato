/**
 * Hashline tool bundle — Read + Edit sharing content-hash anchors.
 *
 * Import the pair together since they form a protocol:
 *   import { Read, Edit, ... } from './hashline'
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
  Read,
  ReadHandler,
  Edit,
  EditHandler,
} from './tools.ts'
