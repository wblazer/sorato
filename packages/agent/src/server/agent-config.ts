import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from 'effect/unstable/http'
import { Config, Layer } from 'effect'
import {
  LocalSandboxLive,
  Toolkit,
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
  WriteFile,
  WriteFileHandler,
  Bash,
  BashHandler,
  Glob,
  GlobHandler,
  Grep,
  GrepHandler,
} from '../index.ts'

export const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools for reading, editing, writing, and searching files, as well as running shell commands. Use them as needed to help the user.

When the user asks you to do something:
1. Think about what needs to be done
2. Use the appropriate tools to accomplish the task
3. Explain what you did

Be concise and direct.`

export const AllTools = Toolkit.make(
  ReadFile,
  EditFile,
  WriteFile,
  Bash,
  Glob,
  Grep
)

export const AllToolsLayer = AllTools.toLayer({
  ...ReadFileHandler,
  ...EditFileHandler,
  ...WriteFileHandler,
  ...BashHandler,
  ...GlobHandler,
  ...GrepHandler,
})

export const ModelLive = AnthropicLanguageModel.layer({
  model: 'claude-sonnet-4-20250514',
}).pipe(
  Layer.provide(
    AnthropicClient.layerConfig({
      apiKey: Config.redacted('ANTHROPIC_API_KEY'),
    })
  ),
  Layer.provide(FetchHttpClient.layer)
)

export const AgentLive = Layer.mergeAll(
  AllToolsLayer,
  LocalSandboxLive,
  ModelLive
)
