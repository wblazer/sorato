import { Layer } from 'effect'
import {
  Bash,
  BashHandler,
  Edit,
  EditHandler,
  Glob,
  GlobHandler,
  Grep,
  GrepHandler,
  LocalSandboxLive,
  Read,
  ReadHandler,
  Toolkit,
  Write,
  WriteHandler,
} from '@sorato/core'

export const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools for reading, editing, writing, and searching files, as well as running shell commands. Use them as needed to help the user.

When the user asks you to do something:
1. Think about what needs to be done
2. Use the appropriate tools to accomplish the task
3. Explain what you did

Be concise and direct.`

export const AllTools = Toolkit.make(Read, Edit, Write, Bash, Glob, Grep)

export const AllToolsLayer = AllTools.toLayer({
  ...ReadHandler,
  ...EditHandler,
  ...WriteHandler,
  ...BashHandler,
  ...GlobHandler,
  ...GrepHandler,
})

export const AgentLive = Layer.mergeAll(AllToolsLayer, LocalSandboxLive)
