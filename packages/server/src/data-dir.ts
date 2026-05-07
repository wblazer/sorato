import { homedir } from 'node:os'
import { join } from 'node:path'

export const dataDir =
  process.env.SORATO_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'sorato'
  )
