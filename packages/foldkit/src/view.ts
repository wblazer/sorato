import * as Button from '@foldkit/ui/button'
import * as Checkbox from '@foldkit/ui/checkbox'
import * as Combobox from '@foldkit/ui/combobox'
import * as Dialog from '@foldkit/ui/dialog'
import * as Disclosure from '@foldkit/ui/disclosure'
import * as Input from '@foldkit/ui/input'
import * as Listbox from '@foldkit/ui/listbox'
import * as Switch from '@foldkit/ui/switch'
import * as Tabs from '@foldkit/ui/tabs'
import * as Textarea from '@foldkit/ui/textarea'
import type { MessageNodeResponse } from '@sorato/api'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import {
  ChangedDraft,
  ChangedSessionSearch,
  ChangedServerUrl,
  ClosedTab,
  ClearedError,
  ClickedCompact,
  ClickedConnect,
  ClickedNewTab,
  ClickedRunScenario,
  ClickedSend,
  ClickedStop,
  ClickedToggleTreePanel,
  OpenedOverlay,
  GotDialogMessage,
  GotModelComboboxMessage,
  GotProjectComboboxMessage,
  GotSidePanelTabsMessage,
  GotSettingsTabsMessage,
  SelectedBaseNode,
  SelectedRunHead,
  SelectedModel,
  SelectedSession,
  SelectedTab,
  ToggledDisclosure,
  ChangedSetting,
  ClickedCopySettings,
  ClickedResetSettings,
  ConfirmedResetSettings,
  GotListboxMessage,
  StartedResize,
  MovedResize,
  EndedResize,
  ToggledTreeCompactMode,
  ToggledGroupAgentSteps,
  AdjustedTreeCompactRange,
  ChangedCompactInstructions,
} from './main.ts'
import type { Message, Model } from './main.ts'
import { renderMarkdown } from './markdown.ts'
import { shouldExpandToolBlock } from './client-config.ts'
import { buildTreeModel, flattenTree, isNodeInRange } from './tree-model.ts'
import {
  messageParts,
  projectTranscriptBlocks,
  type ToolCallPart,
  type ToolResultPart,
  type TranscriptBlock,
  type TranscriptItem,
  type TranscriptPart,
} from './transcript.ts'

const button = (
  h: HtmlBuilder<Message>,
  label: string,
  message: Message,
  options: {
    disabled?: boolean
    className?: string
    ariaLabel?: string
  } = {}
) =>
  Button.view(
    {
      onClick: message,
      ...(options.disabled === undefined
        ? {}
        : { isDisabled: options.disabled }),
      toView: ({ button: attributes }) =>
        h.button(
          [
            ...attributes,
            h.Class(`ui-button ${options.className ?? ''}`),
            ...(options.ariaLabel === undefined
              ? []
              : [h.AriaLabel(options.ariaLabel)]),
          ],
          [label]
        ),
    },
    h
  )

const icon = (h: HtmlBuilder<Message>, name: string, className = ''): Html =>
  h.i([h.Class(`ph ph-${name} ph-icon ${className}`), h.AriaHidden(true)], [])

const ModelCombobox = Combobox.create<string>()
const ProjectCombobox = Combobox.create<string>()
const SidePanelTabs = Tabs.create<'tree' | 'diff'>()
const SettingsTabs = Tabs.create<'general' | 'keybinds'>()
type ListboxItem = { readonly value: string; readonly label: string }
const StringListbox = Listbox.create<ListboxItem, string>()

const listbox = (
  model: Listbox.Model,
  target: string,
  value: string,
  items: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  label: string,
  h: HtmlBuilder<Message>,
  isDisabled = false
): Html =>
  h.submodel({
    slotId: `listbox-${target}`,
    model,
    view: StringListbox.view,
    toParentMessage: (message) => GotListboxMessage({ target, message }),
    viewInputs: {
      items,
      itemToValue: (item) => item.value,
      maybeSelectedValue: Option.some(value),
      ariaLabel: label,
      buttonContent: h.span(
        [],
        [
          items.find((item) => item.value === value)?.label ?? value,
          icon(h, 'caret-down'),
        ]
      ),
      buttonClassName: 'ui-button listbox-button',
      itemsClassName: 'listbox-popover',
      backdropClassName: 'listbox-backdrop',
      isButtonDisabled: isDisabled,
      itemToConfig: (item) => ({
        content: h.span([], [item.label]),
        className: 'listbox-option',
      }),
      anchor: { portal: false },
    },
  })

const iconButton = (
  h: HtmlBuilder<Message>,
  graphic: Html,
  message: Message,
  ariaLabel: string,
  className = '',
  disabled = false
) =>
  Button.view(
    {
      onClick: message,
      isDisabled: disabled,
      toView: ({ button: attributes }) =>
        h.button(
          [
            ...attributes,
            h.Class(`ui-button icon-button ${className}`),
            h.AriaLabel(ariaLabel),
          ],
          [graphic]
        ),
    },
    h
  )

const plainContent = (node: MessageNodeResponse): string => {
  const content = node.encoded.content
  if (typeof content === 'string') return content
  if (content === undefined) return ''
  return content
    .map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') return part.text
      if (part.type === 'tool-call')
        return `${part.header?.title ?? part.name}\n${JSON.stringify(part.params, null, 2)}`
      if (part.type === 'tool-result') return `${part.name}\n${part.result}`
      if (part.type === 'file') return part.fileName ?? part.mediaType
      return ''
    })
    .join('\n')
}

const preview = (node: MessageNodeResponse) => {
  const content = plainContent(node).replace(/\s+/g, ' ').trim()
  return content.length > 0 ? content : '(empty)'
}

const sessionTitle = (session: Model['sessions'][number]): string =>
  session.title ?? `New Session - ${session.id}`

const selectedNodePath = (model: Model): ReadonlyArray<MessageNodeResponse> => {
  if (model.selectedBaseNodeId === null) return []
  const byId = new Map(model.nodes.map((node) => [node.id, node]))
  const path: Array<MessageNodeResponse> = []
  const seen = new Set<string>()
  let cursor: string | null = model.selectedBaseNodeId
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (node === undefined) return []
    path.push(node)
    cursor = node.parentId
  }
  return path.reverse()
}

const disclosure = (
  model: Model,
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  body: string,
  className: string
): Html =>
  Disclosure.view(
    {
      id: `disclosure-${id}`,
      isOpen: model.openDisclosures.includes(id),
      onToggle: (isOpen) => ToggledDisclosure({ id, isOpen }),
      toView: ({ button: toggle, panel, animatePanel }) =>
        h.div(
          [h.Key(id), h.Class(className)],
          [
            h.button(
              [...toggle, h.Class('disclosure-toggle')],
              [icon(h, 'caret-right'), h.span([], [label])]
            ),
            animatePanel(h.div(panel, [h.pre([], [body])])),
          ]
        ),
    },
    h
  )

const formatRelativeTime = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}

const jsonText = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return '[unprintable value]'
  }
}

const markdown = (
  h: HtmlBuilder<Message>,
  text: string,
  className: string
): Html => h.div([h.Class(className), h.InnerHTML(renderMarkdown(text))], [])

const filePart = (
  part: Extract<TranscriptPart, { readonly type: 'file' }>,
  h: HtmlBuilder<Message>
): Html =>
  part.mediaType.startsWith('image/') && typeof part.data === 'string'
    ? h.figure(
        [h.Class('message-image')],
        [
          h.img([h.Src(part.data), h.Alt(part.fileName ?? 'Image attachment')]),
          h.figcaption([], [`${part.fileName ?? 'Image'} · ${part.mediaType}`]),
        ]
      )
    : h.div(
        [h.Class('file-attachment')],
        [
          icon(h, 'file'),
          h.span([], [part.fileName ?? 'file']),
          h.code([], [part.mediaType]),
        ]
      )

const toolCard = (
  model: Model,
  h: HtmlBuilder<Message>,
  call: ToolCallPart | undefined,
  result: ToolResultPart | undefined
): Html => {
  const id = call?.id ?? result?.id ?? 'unknown-tool'
  const header = call?.header ?? result?.header
  const title =
    header?.title ?? call?.name ?? `${result?.name ?? 'Tool'} Result`
  const display = result?.bodyDisplay
  const subtitle = header?.subtitle ?? display?.fileName
  const stats =
    display === undefined
      ? null
      : `+${display.summary.additions} −${display.summary.deletions}`
  const body = [
    ...(call === undefined
      ? []
      : [
          h.div(
            [h.Class('tool-body-section')],
            [h.span([], ['Parameters']), h.pre([], [jsonText(call.params)])]
          ),
        ]),
    ...(result === undefined
      ? []
      : [
          h.div(
            [h.Class('tool-body-section')],
            [h.span([], ['Result']), h.pre([], [jsonText(result.result)])]
          ),
        ]),
  ]
  const disclosureId = `tool:${id}`
  const defaultOpen = shouldExpandToolBlock(
    model.clientSettings.toolBlockExpansion,
    call?.name ?? result?.name ?? ''
  )
  return Disclosure.view(
    {
      id: `tool-${id}`,
      isOpen:
        model.openDisclosures.includes(disclosureId) ||
        (defaultOpen &&
          !model.openDisclosures.includes(`closed:${disclosureId}`)),
      onToggle: (isOpen) =>
        ToggledDisclosure({
          id: isOpen ? disclosureId : `closed:${disclosureId}`,
          isOpen: true,
        }),
      toView: ({ button: toggle, panel, animatePanel }) =>
        h.section(
          [
            h.Key(`tool:${id}`),
            h.Class(`tool-card ${result?.isFailure === true ? 'failed' : ''}`),
          ],
          [
            h.button(
              [...toggle, h.Class('tool-card-toggle')],
              [
                icon(
                  h,
                  result?.isFailure === true ? 'warning-circle' : 'wrench'
                ),
                h.span(
                  [h.Class('tool-card-heading')],
                  [
                    h.strong([], [title]),
                    subtitle === undefined ? null : h.code([], [subtitle]),
                  ]
                ),
                stats === null
                  ? null
                  : h.span([h.Class('diff-stats')], [stats]),
                icon(h, 'caret-right', 'tool-caret'),
              ]
            ),
            animatePanel(h.div([...panel, h.Class('tool-card-body')], body)),
          ]
        ),
    },
    h
  )
}

const partView = (
  item: TranscriptItem,
  model: Model,
  h: HtmlBuilder<Message>,
  markdownText: boolean
): Html | null => {
  if (item.type === 'combined-tool')
    return toolCard(model, h, item.call, item.result)
  if (item.type === 'interruption')
    return h.div(
      [h.Class('interruption-divider')],
      [h.span([], []), h.b([], ['Interrupted']), h.span([], [])]
    )
  const part = item.part
  if (
    (part.type === 'text' || part.type === 'reasoning') &&
    part.text.trim().length === 0
  )
    return null
  if (part.type === 'text')
    return markdownText
      ? markdown(h, part.text, 'assistant-copy typeset')
      : h.div([h.Class('plain-copy')], [part.text])
  if (part.type === 'reasoning')
    return h.div([h.Class('reasoning-copy')], [part.text])
  if (part.type === 'file') return filePart(part, h)
  if (part.type === 'tool-call') return toolCard(model, h, part, undefined)
  if (part.type === 'tool-result') return toolCard(model, h, undefined, part)
  return null
}

const sidebar = (model: Model, h: HtmlBuilder<Message>): Html => {
  return h.aside(
    [
      h.Class('app-sidebar'),
      h.Style({ '--sidebar-width': `${model.sidebarWidth}px` }),
    ],
    [
      h.div(
        [h.Class('sidebar-scroll')],
        [
          h.div(
            [h.Class('new-tab-row')],
            [
              Button.view(
                {
                  onClick: ClickedNewTab(),
                  toView: ({ button: a }) =>
                    h.button(
                      [...a, h.Class('ui-button new-tab-button')],
                      [icon(h, 'plus'), h.span([], ['New Tab'])]
                    ),
                },
                h
              ),
            ]
          ),
          h.nav(
            [h.Class('tab-list'), h.AriaLabel('Open sessions')],
            model.tabs.map((tab) => {
              const session = model.sessions.find(
                (candidate) => candidate.id === tab.sessionId
              )
              const title =
                session === undefined ? 'New Tab' : sessionTitle(session)
              return h.div(
                [
                  h.Key(tab.id),
                  h.Class(
                    `tab-row ${tab.id === model.activeTabId ? 'selected' : ''}`
                  ),
                ],
                [
                  Button.view(
                    {
                      onClick: SelectedTab({ id: tab.id }),
                      toView: ({ button: attributes }) =>
                        h.button(
                          [...attributes, h.Class('ui-button tab-button')],
                          [
                            h.span(
                              [
                                h.Class(
                                  `tab-status ${session?.status === 'running' ? 'running' : ''}`
                                ),
                              ],
                              []
                            ),
                            h.span([h.Class('tab-title')], [title]),
                          ]
                        ),
                    },
                    h
                  ),
                  iconButton(
                    h,
                    icon(h, 'x'),
                    ClosedTab({ id: tab.id }),
                    `Close ${title}`,
                    'tab-close'
                  ),
                ]
              )
            })
          ),
        ]
      ),
      h.div(
        [
          h.Class('resize-separator sidebar-resizer'),
          h.Role('separator'),
          h.AriaLabel('Resize sidebar'),
          h.OnPointerDown((_type, button, screenX) =>
            button === 0
              ? Option.some(
                  StartedResize({
                    target: 'sidebar',
                    x: screenX,
                    viewportWidth: model.viewportWidth,
                  })
                )
              : Option.none()
          ),
        ],
        []
      ),
      h.div(
        [h.Class('sidebar-footer')],
        [
          button(
            h,
            `${model.serverUrlInput}`,
            OpenedOverlay({ overlay: 'connection' }),
            {
              className: `connection-button ${model.status}`,
              ariaLabel: `Connection: ${model.serverUrlInput}`,
            }
          ),
          Button.view(
            {
              onClick: OpenedOverlay({ overlay: 'settings' }),
              toView: ({ button: a }) =>
                h.button(
                  [...a, h.Class('ui-button settings-button')],
                  [icon(h, 'gear'), h.span([], ['Settings'])]
                ),
            },
            h
          ),
          model.devScenarios === null
            ? null
            : button(h, 'Scenario Lab', OpenedOverlay({ overlay: 'lab' }), {
                className: 'dev-lab-button',
              }),
        ]
      ),
    ]
  )
}

const systemTranscript = (
  block: TranscriptBlock,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const node = block.messages[0]
  if (node === undefined) return h.div([], [])
  const encoded = node.encoded
  const display = 'display' in encoded ? encoded.display : undefined
  const source = 'source' in encoded ? encoded.source : undefined
  const title =
    node.kind === 'summary'
      ? 'Summary'
      : (display?.title ??
        (source === 'agents-md' ? 'AGENTS.md' : 'System Prompt'))
  const loadedPath =
    encoded.role === 'system' ? encoded.metadata?.loaded?.path : undefined
  const subtitle =
    display?.subtitle ?? (source === 'agents-md' ? loadedPath : undefined)
  return Disclosure.view(
    {
      id: `system-${node.id}`,
      isOpen:
        model.openDisclosures.includes(node.id) ||
        (model.clientSettings.expandSystemMessagesByDefault &&
          !model.openDisclosures.includes(`closed:${node.id}`)),
      onToggle: (isOpen) =>
        ToggledDisclosure({
          id: isOpen ? node.id : `closed:${node.id}`,
          isOpen: true,
        }),
      toView: ({ button: toggle, panel, animatePanel }) =>
        h.section(
          [h.Key(node.id), h.Class('system-message')],
          [
            h.button(
              [...toggle, h.Class('system-toggle')],
              [
                icon(
                  h,
                  node.kind === 'summary' ? 'article' : 'terminal-window'
                ),
                h.strong([], [title]),
                subtitle === undefined ? null : h.code([], [subtitle]),
                icon(h, 'caret-right', 'system-caret'),
              ]
            ),
            animatePanel(
              h.div(
                [...panel, h.Class('system-body')],
                block.items.map((item) => partView(item, model, h, false))
              )
            ),
          ]
        ),
    },
    h
  )
}

const userTranscript = (
  block: TranscriptBlock,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const node = block.messages[0]
  if (node === undefined) return h.div([], [])
  const parts = messageParts(node)
  const images = parts.filter(
    (part): part is Extract<TranscriptPart, { readonly type: 'file' }> =>
      part.type === 'file' &&
      part.mediaType.startsWith('image/') &&
      typeof part.data === 'string'
  )
  const bubbleParts = parts.filter(
    (
      part
    ): part is Extract<TranscriptPart, { readonly type: 'text' | 'file' }> =>
      part.type === 'text' ||
      (part.type === 'file' && !part.mediaType.startsWith('image/'))
  )
  return h.article(
    [h.Key(node.id), h.Class('message-row user-message')],
    [
      images.length === 0
        ? null
        : h.div(
            [h.Class('user-images'), h.AriaLabel('Message image attachments')],
            images.map((part) => filePart(part, h))
          ),
      bubbleParts.length === 0
        ? null
        : h.div(
            [h.Class('user-bubble')],
            bubbleParts.map((part) =>
              part.type === 'text'
                ? h.div([h.Class('plain-copy')], [part.text])
                : filePart(part, h)
            )
          ),
      h.div(
        [h.Class('user-meta')],
        [
          h.span(
            [],
            [
              new Date(node.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              }),
            ]
          ),
          iconButton(
            h,
            icon(h, 'git-branch'),
            SelectedBaseNode({ id: node.id }),
            'Branch from this message',
            'message-action',
            model.activeRunId !== null
          ),
        ]
      ),
    ]
  )
}

const assistantTranscript = (
  block: TranscriptBlock,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const representative =
    block.messages.find((message) => message.modelCall !== null) ??
    block.messages[0]
  const modelCall = representative?.modelCall
  const run = block.messages.find((message) => message.run !== null)?.run
  const metadata: string[] = []
  if (modelCall !== null && modelCall !== undefined) {
    metadata.push(`${modelCall.providerId}/${modelCall.modelId}`)
    if (modelCall.startedAt !== null)
      metadata.push(
        `${Math.max(0, Math.floor((modelCall.finishedAt - modelCall.startedAt) / 1000))}s`
      )
    if (modelCall.actualCostMicrosUsd !== null)
      metadata.push(
        `$${(modelCall.actualCostMicrosUsd / 1_000_000).toFixed(4)}`
      )
  }
  if (run?.status === 'interrupted') metadata.push('interrupted')
  const visible = block.items
    .map((item) => ({ item, view: partView(item, model, h, true) }))
    .filter(({ view }) => view !== null)
  return h.article(
    [h.Key(block.key), h.Class('message-row assistant-message')],
    [
      ...visible.map(({ item, view }) =>
        h.div(
          [
            h.Class('assistant-transcript-item'),
            h.DataAttribute(
              'transcript-kind',
              item.type === 'combined-tool'
                ? 'tool'
                : item.type === 'message'
                  ? item.part.type
                  : item.type
            ),
          ],
          [view]
        )
      ),
      metadata.length === 0
        ? null
        : h.div([h.Class('assistant-meta')], [metadata.join(' · ')]),
    ]
  )
}

const transcriptBlock = (
  block: TranscriptBlock,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const node = block.messages[0]
  if (node === undefined) return h.div([], [])
  const role = node.encoded.role
  if (
    role === 'system' ||
    (node.kind === 'summary' &&
      model.clientSettings.transcriptDisplayMode === 'pretty')
  ) {
    return systemTranscript(block, model, h)
  }
  if (role === 'user') return userTranscript(block, model, h)
  return assistantTranscript(block, model, h)
}

const activityRows = (
  model: Model,
  h: HtmlBuilder<Message>
): ReadonlyArray<Html> =>
  model.activity.map((item) =>
    item.kind === 'tool-call' || item.kind === 'tool-result'
      ? disclosure(
          model,
          h,
          item.id,
          item.title,
          item.body,
          `tool-message ${item.failed ? 'failed' : ''}`
        )
      : h.article(
          [
            h.Key(item.id),
            h.Class(`message-row assistant-message ${item.kind}`),
          ],
          [
            item.kind === 'reasoning'
              ? h.div([h.Class('reasoning-copy')], [item.body])
              : h.div([h.Class('assistant-copy')], [item.body]),
            h.div([h.Class('assistant-meta visible')], ['•••']),
          ]
        )
  )

const transcript = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('transcript-frame')],
    [
      h.section(
        [
          h.Class('transcript'),
          h.AriaLabel('Conversation transcript'),
          h.AriaLive('polite'),
        ],
        [
          ...projectTranscriptBlocks(selectedNodePath(model), {
            pretty: model.clientSettings.transcriptDisplayMode === 'pretty',
          }).map((block) => transcriptBlock(block, model, h)),
          ...(model.activeRunId !== null &&
          model.selectedRunId === model.activeRunId
            ? activityRows(model, h)
            : []),
          model.nodes.length === 0 && model.activity.length === 0
            ? h.p([h.Class('empty-transcript')], ['No messages yet.'])
            : null,
        ]
      ),
    ]
  )

const modelSelect = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'model-combobox',
    model: model.modelCombobox,
    view: ModelCombobox.view,
    toParentMessage: (message) => GotModelComboboxMessage({ message }),
    viewInputs: {
      items: model.models
        .filter((item) =>
          `${item.id} ${item.name} ${item.provider}`
            .toLowerCase()
            .includes(model.modelCombobox.inputValue.toLowerCase())
        )
        .map((item) => item.id),
      maybeSelectedValue:
        model.selectedModelId === ''
          ? Option.none()
          : Option.some(model.selectedModelId),
      restingInputValue:
        model.models.find((item) => item.id === model.selectedModelId)?.name ??
        '',
      itemToValue: (item) => item,
      itemToDisplayText: (id) =>
        model.models.find((item) => item.id === id)?.name ?? id,
      itemToConfig: (id) => ({
        content: h.div(
          [],
          [
            h.strong(
              [],
              [model.models.find((item) => item.id === id)?.name ?? id]
            ),
            h.small(
              [],
              [model.models.find((item) => item.id === id)?.provider ?? '']
            ),
          ]
        ),
      }),
      isDisabled: model.selectedProjectId === null,
      ariaLabel: 'Model',
      inputPlaceholder: 'Search models…',
      className: 'model-control combo-control',
      inputClassName: 'combo-input',
      itemsClassName: 'combo-items',
      buttonClassName: 'model-select',
      buttonContent: h.span(
        [],
        [
          model.models.find((item) => item.id === model.selectedModelId)
            ?.name ?? 'Select model',
          icon(h, 'caret-down'),
        ]
      ),
      anchor: { placement: 'top-start' },
    },
  })

const composer = (model: Model, h: HtmlBuilder<Message>): Html => {
  const disabled =
    model.selectedProjectId === null ||
    model.selectedModelId === '' ||
    model.activeRunId !== null ||
    model.startingSessionId !== null
  const placeholder =
    model.selectedProjectId === null
      ? 'Choose a project to start'
      : model.startingSessionId !== null
        ? 'Creating session...'
        : 'What would you like to do?'

  return h.section(
    [h.Class('composer-wrap'), h.AriaLabel('Message composer')],
    [
      model.compactingRunId === null
        ? null
        : h.details(
            [h.Class('summary-activity'), h.Open(true)],
            [
              h.summary(
                [],
                [
                  icon(h, 'arrows-clockwise'),
                  h.strong([], ['Generating summary']),
                ]
              ),
              h.pre(
                [],
                [model.compactionActivity.map((item) => item.body).join('\n')]
              ),
            ]
          ),
      model.error === null
        ? null
        : h.div(
            [h.Class('composer-status'), h.Role('alert')],
            [
              h.div(
                [],
                [h.strong([], ['Request failed']), h.p([], [model.error])]
              ),
              button(h, '×', ClearedError(), {
                className: 'icon-button',
                ariaLabel: 'Dismiss error',
              }),
            ]
          ),
      Textarea.view(
        {
          id: 'prompt',
          value: model.draft,
          rows: 1,
          placeholder,
          isDisabled: disabled,
          onInput: (value) => ChangedDraft({ value }),
          toView: ({ textarea, label }) =>
            h.div(
              [],
              [
                h.label([...label, h.Class('sr-only')], ['Prompt']),
                h.textarea(
                  [
                    ...textarea,
                    h.Class('composer-input'),
                    h.OnKeyDownPreventDefault((key, modifiers) =>
                      key === 'Enter' && !modifiers.shiftKey
                        ? Option.some(ClickedSend())
                        : Option.none()
                    ),
                  ],
                  []
                ),
              ]
            ),
        },
        h
      ),
      h.div(
        [h.Class('composer-toolbar')],
        [
          h.div(
            [h.Class('composer-tools')],
            [
              modelSelect(model, h),
              model.models.find((item) => item.id === model.selectedModelId)
                ?.capabilities.reasoning
                ? button(
                    h,
                    `Think: ${model.models.find((item) => item.id === model.selectedModelId)?.capabilities.thinkingLevels[0] ?? 'on'}`,
                    SelectedModel({ id: model.selectedModelId }),
                    { className: 'thinking-button' }
                  )
                : null,
            ]
          ),
          model.activeRunId === null
            ? iconButton(
                h,
                icon(h, 'arrow-up'),
                ClickedSend(),
                'Send message',
                'submit-button',
                disabled || model.draft.trim() === ''
              )
            : iconButton(
                h,
                icon(h, 'stop'),
                ClickedStop(),
                'Stop run',
                'submit-button stop-button'
              ),
        ]
      ),
    ]
  )
}

const newSessionStage = (model: Model, h: HtmlBuilder<Message>): Html => {
  const recent = [...model.sessions]
    .filter((session) => session.archivedAt === null)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 6)
  return h.div(
    [h.Class('new-session-stage')],
    [
      h.div(
        [h.Class('new-session-content')],
        [
          recent.length === 0
            ? null
            : h.section(
                [h.Class('resume-sessions')],
                [
                  h.h2([], ['Resume a session']),
                  h.div(
                    [h.Class('resume-body')],
                    [
                      Button.view(
                        {
                          onClick: OpenedOverlay({ overlay: 'search' }),
                          toView: ({ button: a }) =>
                            h.button(
                              [
                                ...a,
                                h.Class(
                                  'ui-button outline-button search-button'
                                ),
                              ],
                              [
                                icon(h, 'magnifying-glass'),
                                h.span([], ['Search sessions']),
                              ]
                            ),
                        },
                        h
                      ),
                      h.div(
                        [h.Class('recent-sessions')],
                        [
                          h.h3([], ['Recent Sessions']),
                          ...recent.map((session) => {
                            const project = model.projects.find(
                              (candidate) => candidate.id === session.projectId
                            )
                            const timestamp =
                              session.lastUserMessageAt ?? session.updatedAt
                            return Button.view(
                              {
                                onClick: SelectedSession({ id: session.id }),
                                toView: ({ button: attributes }) =>
                                  h.button(
                                    [...attributes, h.Class('recent-session')],
                                    [
                                      h.span(
                                        [h.Class('recent-session-copy')],
                                        [
                                          h.span(
                                            [h.Class('recent-session-title')],
                                            [sessionTitle(session)]
                                          ),
                                          h.span(
                                            [h.Class('recent-session-project')],
                                            [project?.name ?? 'Unknown project']
                                          ),
                                        ]
                                      ),
                                      h.span(
                                        [h.Class('recent-session-time')],
                                        [formatRelativeTime(timestamp)]
                                      ),
                                    ]
                                  ),
                              },
                              h
                            )
                          }),
                        ]
                      ),
                    ]
                  ),
                ]
              ),
          recent.length === 0
            ? null
            : h.div(
                [h.Class('or-divider')],
                [h.span([], []), h.strong([], ['or']), h.span([], [])]
              ),
          h.section(
            [h.Class('start-session')],
            [
              h.h2([], ['Start session in']),
              h.submodel({
                slotId: 'project-combobox',
                model: model.projectCombobox,
                view: ProjectCombobox.view,
                toParentMessage: (message) =>
                  GotProjectComboboxMessage({ message }),
                viewInputs: {
                  items: model.projects
                    .filter((project) =>
                      `${project.name} ${project.path}`
                        .toLowerCase()
                        .includes(
                          model.projectCombobox.inputValue.toLowerCase()
                        )
                    )
                    .map((project) => project.id),
                  maybeSelectedValue:
                    model.selectedProjectId === null
                      ? Option.none()
                      : Option.some(model.selectedProjectId),
                  restingInputValue:
                    model.projects.find(
                      (project) => project.id === model.selectedProjectId
                    )?.name ?? '',
                  itemToValue: (id) => id,
                  itemToDisplayText: (id) =>
                    model.projects.find((project) => project.id === id)?.name ??
                    id,
                  itemToConfig: (id) => {
                    const project = model.projects.find(
                      (candidate) => candidate.id === id
                    )
                    return {
                      content: h.span(
                        [h.Class('project-copy')],
                        [
                          h.strong([], [project?.name ?? id]),
                          h.small([], [project?.path ?? '']),
                        ]
                      ),
                    }
                  },
                  ariaLabel: 'Project',
                  inputPlaceholder: 'Search projects…',
                  className: 'project-combo combo-control',
                  inputClassName: 'combo-input',
                  itemsClassName: 'combo-items',
                  buttonClassName: 'project-select',
                  buttonContent: h.span(
                    [h.Class('project-trigger')],
                    [
                      icon(h, 'folder-open'),
                      h.span(
                        [h.Class('project-copy')],
                        [
                          h.strong(
                            [],
                            [
                              model.projects.find(
                                (project) =>
                                  project.id === model.selectedProjectId
                              )?.name ?? 'Select project',
                            ]
                          ),
                          h.small(
                            [],
                            [
                              model.projects.find(
                                (project) =>
                                  project.id === model.selectedProjectId
                              )?.path ?? '',
                            ]
                          ),
                        ]
                      ),
                      icon(h, 'caret-down'),
                    ]
                  ),
                },
              }),
            ]
          ),
        ]
      ),
    ]
  )
}

const treePanel = (model: Model, h: HtmlBuilder<Message>): Html => {
  const selectedSession = model.sessions.find(
    (session) => session.id === model.selectedSessionId
  )
  const primaryRun = selectedSession?.activeRuns?.find(
    (run) => run.visibility === 'primary'
  )
  const tree = buildTreeModel(model.nodes, model.groupAgentSteps)
  const rows = flattenTree(tree, model.selectedBaseNodeId)
  const compactRows = rows.filter(
    (row) => row.inSelectedPath && row.item.message.encoded.role !== 'system'
  )
  const orderedCompactIds = compactRows.map((row) => row.item.id)
  const compactStartOwner =
    model.compactStartNodeId === null
      ? null
      : (tree.ownerByNodeId.get(model.compactStartNodeId) ?? null)
  const compactEndOwner =
    model.compactEndNodeId === null
      ? null
      : (tree.ownerByNodeId.get(model.compactEndNodeId) ?? null)
  const treeRow = (row: (typeof rows)[number], compact: boolean): Html => {
    const item = row.item
    const inRange = isNodeInRange(
      orderedCompactIds,
      compactStartOwner,
      compactEndOwner,
      item.id
    )
    const endpoint =
      item.id === compactStartOwner || item.id === compactEndOwner
    const gutters = Array.from({ length: row.depth }, (_, level) =>
      h.span(
        [
          h.Class('tree-gutter'),
          h.DataAttribute(
            'mark',
            level === row.depth - 1 && row.connector !== null
              ? row.connector
              : row.continuingLevels.has(level)
                ? 'vertical'
                : 'blank'
          ),
          h.DataAttribute('active', row.inSelectedPath ? 'true' : 'false'),
        ],
        []
      )
    )
    const target = item.compactEndNodeId
    return h.button(
      [
        h.Key(item.id),
        h.Class(
          `tree-row tone-${item.tone} ${row.selected ? 'selected' : ''} ${row.inSelectedPath ? 'in-path' : ''} ${inRange ? 'compact-in-range' : ''} ${endpoint ? 'compact-endpoint' : ''}`
        ),
        h.AriaLabel(
          `${compact ? 'Adjust compact range at' : 'Select branch'}: ${preview(item.displayMessage)}`
        ),
        h.DataAttribute('node-id', target),
        h.DataAttribute('connector', row.connector ?? 'none'),
        h.DataAttribute('selected-path', row.inSelectedPath ? 'true' : 'false'),
        h.DataAttribute('selected-head', row.selected ? 'true' : 'false'),
        h.DataAttribute('compact-range', inRange ? 'true' : 'false'),
        ...(compact ? [] : [h.OnClick(SelectedBaseNode({ id: target }))]),
        ...(compact
          ? [
              h.OnPointerDown((_type, button) =>
                button === 0
                  ? Option.some(
                      AdjustedTreeCompactRange({
                        startId: item.compactStartNodeId,
                        endId: item.compactEndNodeId,
                        phase: 'start',
                      })
                    )
                  : Option.none()
              ),
              ...(model.compactDragStartNodeId === null
                ? []
                : [
                    h.OnMouseEnter(
                      AdjustedTreeCompactRange({
                        startId: item.compactStartNodeId,
                        endId: item.compactEndNodeId,
                        phase: 'move',
                      })
                    ),
                  ]),
              h.OnPointerUp(() =>
                Option.some(
                  AdjustedTreeCompactRange({
                    startId: item.compactStartNodeId,
                    endId: item.compactEndNodeId,
                    phase: 'end',
                  })
                )
              ),
              h.OnKeyDownPreventDefault((key) =>
                key === 'Enter' || key === ' '
                  ? Option.some(
                      AdjustedTreeCompactRange({
                        startId: item.compactStartNodeId,
                        endId: item.compactEndNodeId,
                        phase: 'select',
                      })
                    )
                  : Option.none()
              ),
            ]
          : []),
      ],
      [
        h.span([h.Class('tree-gutters')], gutters),
        h.span(
          [
            h.Class('tree-icon'),
            h.DataAttribute('tone', item.tone),
            h.DataAttribute('in-path', row.inSelectedPath ? 'true' : 'false'),
            h.DataAttribute(
              'parent-connector',
              row.parentConnector ? 'true' : 'false'
            ),
            h.DataAttribute(
              'child-connector',
              row.childConnector ? 'true' : 'false'
            ),
            h.DataAttribute(
              'active-parent-connector',
              row.activeParentConnector ? 'true' : 'false'
            ),
            h.DataAttribute(
              'active-child-connector',
              row.activeChildConnector ? 'true' : 'false'
            ),
          ],
          [
            icon(
              h,
              item.tone === 'summary'
                ? 'file-text'
                : item.tone === 'user'
                  ? 'user'
                  : item.tone === 'tool'
                    ? 'wrench'
                    : item.tone === 'system'
                      ? 'gear'
                      : 'sparkle'
            ),
          ]
        ),
        h.span([h.Class('tree-preview')], [preview(item.displayMessage)]),
        ...(item.toolCount > 0
          ? [
              h.span(
                [h.Class('tree-group-badge')],
                [`${item.toolCount} ${item.toolCount === 1 ? 'tool' : 'tools'}`]
              ),
            ]
          : []),
      ]
    )
  }
  const runRow = (): Html | null =>
    primaryRun === undefined
      ? null
      : h.button(
          [
            h.Class(
              `tree-row tree-run-row ${model.selectedRunId === primaryRun.runId ? 'selected' : ''}`
            ),
            h.AriaLabel(
              primaryRun.kind === 'summary'
                ? 'Select summarizing range'
                : 'Select streaming branch'
            ),
            h.OnClick(
              SelectedRunHead({
                runId: primaryRun.runId,
                baseNodeId: primaryRun.baseNodeId,
              })
            ),
          ],
          [
            h.span(
              [
                h.Class('tree-icon'),
                h.DataAttribute(
                  'tone',
                  primaryRun.kind === 'summary' ? 'summary' : 'assistant'
                ),
              ],
              [icon(h, primaryRun.kind === 'summary' ? 'file-text' : 'sparkle')]
            ),
            h.span(
              [h.Class('tree-preview tree-run-preview')],
              [
                primaryRun.kind === 'summary'
                  ? 'Summarizing range…'
                  : 'Streaming branch…',
              ]
            ),
          ]
        )
  return h.aside(
    [
      h.Class('tree-panel'),
      h.Style({ '--tree-panel-width': `${model.treePanelWidth}px` }),
    ],
    [
      h.div(
        [
          h.Class('resize-separator tree-resizer'),
          h.Role('separator'),
          h.AriaLabel('Resize conversation panel'),
          h.OnPointerDown((_type, button, screenX) =>
            button === 0
              ? Option.some(
                  StartedResize({
                    target: 'tree',
                    x: screenX,
                    viewportWidth: model.viewportWidth,
                  })
                )
              : Option.none()
          ),
        ],
        []
      ),
      h.div(
        [h.Class('tree-header')],
        [
          h.submodel({
            slotId: 'side-panel-tabs',
            model: model.sidePanelTabs,
            view: SidePanelTabs.view,
            toParentMessage: (message) => GotSidePanelTabsMessage({ message }),
            viewInputs: {
              tabs: ['tree', 'diff'],
              selectedValue: model.sidePanel,
              ariaLabel: 'Side panel',
              toView: ({ tablist, tabs }) =>
                h.div(
                  tablist,
                  tabs.map((tab) =>
                    h.button(
                      [
                        ...tab.tab,
                        h.Class(
                          `ui-button panel-tab ${tab.isActive ? 'selected' : ''}`
                        ),
                      ],
                      [
                        icon(
                          h,
                          tab.value === 'tree' ? 'tree-structure' : 'git-diff'
                        ),
                        h.span([], [tab.value === 'tree' ? 'Tree' : 'Diff']),
                      ]
                    )
                  )
                ),
            },
          }),
        ]
      ),
      model.sidePanel === 'tree'
        ? h.div(
            [
              h.Class('tree-content'),
              h.Id('side-panel-tabs-panel-0'),
              h.Role('tabpanel'),
              h.AriaLabelledBy('side-panel-tabs-tab-0'),
              h.Tabindex(0),
            ],
            [
              model.nodes.length > 0
                ? h.div(
                    [h.Class('tree-controls')],
                    [
                      model.treeCompactMode
                        ? h.div(
                            [h.Class('tree-compact-heading')],
                            [
                              iconButton(
                                h,
                                icon(h, 'arrow-left'),
                                ToggledTreeCompactMode(),
                                'Back to tree'
                              ),
                              h.strong([], ['Select a range to compact']),
                            ]
                          )
                        : Button.view(
                            {
                              onClick: ToggledTreeCompactMode(),
                              toView: ({ button: attributes }) =>
                                h.button(
                                  [
                                    ...attributes,
                                    h.Class(
                                      'ui-button outline-button tree-compact-toggle tree-compact-button'
                                    ),
                                  ],
                                  [
                                    icon(h, 'file-text'),
                                    h.span([], ['Compact']),
                                  ]
                                ),
                            },
                            h
                          ),
                      Checkbox.view(
                        {
                          id: 'group-agent-steps',
                          isChecked: model.groupAgentSteps,
                          onToggle: (value) =>
                            ToggledGroupAgentSteps({ value }),
                          toView: ({ checkbox, label, hiddenInput }) =>
                            h.div(
                              [h.Class('tree-group-control')],
                              [
                                h.span(
                                  [...checkbox, h.Class('checkbox-control')],
                                  [icon(h, 'check')]
                                ),
                                h.label(label, ['Group agent steps']),
                                h.input([...hiddenInput, h.Class('sr-only')]),
                              ]
                            ),
                        },
                        h
                      ),
                    ]
                  )
                : null,
              h.div(
                [h.Class('tree-scroll')],
                [
                  model.nodes.length === 0
                    ? h.div(
                        [h.Class('tree-empty')],
                        [
                          h.strong(
                            [],
                            [
                              model.selectedSessionId === null
                                ? 'No session selected'
                                : 'No messages yet',
                            ]
                          ),
                          h.p(
                            [],
                            [
                              model.selectedSessionId === null
                                ? 'Choose an existing session or send a message to start one.'
                                : 'Send a message to begin this conversation.',
                            ]
                          ),
                        ]
                      )
                    : h.div(
                        [
                          h.Class(
                            `tree-list ${model.treeCompactMode ? 'compact-mode' : ''}`
                          ),
                        ],
                        [
                          ...(model.treeCompactMode ? compactRows : rows).map(
                            (row) => treeRow(row, model.treeCompactMode)
                          ),
                          ...(model.treeCompactMode ? [] : [runRow()]),
                        ]
                      ),
                ]
              ),
              model.treeCompactMode && model.nodes.length > 0
                ? h.div(
                    [h.Class('tree-compact-footer')],
                    [
                      Textarea.view(
                        {
                          id: 'compact-instructions',
                          value: model.compactInstructions,
                          rows: 3,
                          placeholder: 'Optional summarizer instructions',
                          onInput: (value) =>
                            ChangedCompactInstructions({ value }),
                          toView: ({ textarea, label }) =>
                            h.div(
                              [],
                              [
                                h.label(
                                  [...label, h.Class('sr-only')],
                                  ['Summarizer instructions']
                                ),
                                h.textarea(
                                  [
                                    ...textarea,
                                    h.Class('compact-instructions'),
                                  ],
                                  []
                                ),
                              ]
                            ),
                        },
                        h
                      ),
                      button(h, 'Generate summary', ClickedCompact(), {
                        className: 'accent-button',
                        disabled:
                          model.compactStartNodeId === null ||
                          model.compactEndNodeId === null,
                      }),
                    ]
                  )
                : null,
            ]
          )
        : h.div(
            [
              h.Class('tree-scroll'),
              h.Id('side-panel-tabs-panel-1'),
              h.Role('tabpanel'),
              h.AriaLabelledBy('side-panel-tabs-tab-1'),
              h.Tabindex(0),
            ],
            [
              h.div(
                [h.Class('tree-empty')],
                [
                  h.strong([], ['No file changes']),
                  h.p(
                    [],
                    [
                      model.selectedSessionId === null
                        ? 'Choose an existing session or send a message to start one.'
                        : 'File changes from tool calls will appear here.',
                    ]
                  ),
                ]
              ),
            ]
          ),
    ]
  )
}

const sessionShell = (model: Model, h: HtmlBuilder<Message>): Html => {
  const session = model.sessions.find(
    (candidate) => candidate.id === model.selectedSessionId
  )
  const project = model.projects.find(
    (candidate) =>
      candidate.id === (session?.projectId ?? model.selectedProjectId)
  )
  return h.main(
    [h.Class('session-shell')],
    [
      h.div(
        [h.Class('session-main')],
        [
          h.header(
            [h.Class('session-header')],
            [
              h.div(
                [h.Class('session-heading')],
                [
                  h.h1([], [session?.title ?? 'New Session']),
                  project === undefined || session === undefined
                    ? null
                    : h.span([h.Class('project-badge')], [project.name]),
                ]
              ),
              iconButton(
                h,
                icon(h, 'sidebar-simple'),
                ClickedToggleTreePanel(),
                model.treePanelOpen ? 'Close side panel' : 'Open side panel',
                'tree-toggle'
              ),
            ]
          ),
          model.selectedSessionId === null
            ? newSessionStage(model, h)
            : transcript(model, h),
          composer(model, h),
        ]
      ),
      model.treePanelOpen
        ? h.div(
            [
              h.Class('tree-spacer'),
              h.Style({ '--tree-panel-width': `${model.treePanelWidth}px` }),
            ],
            []
          )
        : null,
      model.treePanelOpen ? treePanel(model, h) : null,
    ]
  )
}

const overlay = (model: Model, h: HtmlBuilder<Message>): Html | null => {
  if (model.overlay === null) return null
  const filtered = model.sessions.filter((session) =>
    sessionTitle(session)
      .toLowerCase()
      .includes(model.sessionSearch.toLowerCase())
  )
  const title =
    model.overlay === 'search'
      ? 'Search sessions'
      : model.overlay === 'connection'
        ? 'Connection settings'
        : model.overlay === 'settings'
          ? 'Settings'
          : 'Scenario Lab'
  const descriptionText =
    model.overlay === 'search'
      ? 'Search sessions by title or identifier.'
      : model.overlay === 'connection'
        ? 'Connect Sorato to a server. Reconnecting reloads the workspace and closes open sessions.'
        : model.overlay === 'settings'
          ? 'Configure local transcript and keyboard preferences.'
          : 'Run deterministic full-stack agent scenarios and summarization tools.'
  const compactableNodes = selectedNodePath(model).filter(
    (node) => node.encoded.role !== 'system'
  )
  return h.submodel({
    slotId: 'app-overlay',
    model: model.dialog,
    view: Dialog.view,
    toParentMessage: (message) => GotDialogMessage({ message }),
    viewInputs: {
      toView: ({
        dialog,
        backdrop,
        panel,
        title: titleAttributes,
        description,
        initialFocus,
        closeButton,
        isVisible,
      }) =>
        h.dialog(
          [...dialog, h.Class('modal-dialog')],
          isVisible
            ? [
                h.div([...backdrop, h.Class('modal-backdrop')], []),
                h.section(
                  [...panel, h.Class('modal-card')],
                  [
                    h.header(
                      [],
                      [
                        h.div(
                          [],
                          [
                            h.h2(titleAttributes, [title]),
                            model.overlay === 'lab'
                              ? h.span([h.Class('dev-pill')], ['DEV'])
                              : null,
                          ]
                        ),
                        h.button(
                          [
                            ...closeButton,
                            ...initialFocus,
                            h.Class('ui-button icon-button modal-close'),
                            h.AriaLabel('Close dialog'),
                          ],
                          [icon(h, 'x')]
                        ),
                      ]
                    ),
                    h.p(
                      [...description, h.Class('sr-only')],
                      [descriptionText]
                    ),
                    model.overlay === 'search'
                      ? h.div(
                          [h.Class('modal-body search-modal')],
                          [
                            Input.view(
                              {
                                id: 'session-search',
                                value: model.sessionSearch,
                                onInput: (value) =>
                                  ChangedSessionSearch({ value }),
                                toView: ({ input, label }) =>
                                  h.div(
                                    [],
                                    [
                                      h.label(
                                        [...label, h.Class('sr-only')],
                                        ['Search sessions']
                                      ),
                                      h.input([
                                        ...input,
                                        h.Class('modal-input'),
                                        h.Placeholder('Search by title…'),
                                        h.AriaLabel('Search sessions'),
                                      ]),
                                    ]
                                  ),
                              },
                              h
                            ),
                            h.div(
                              [h.Class('search-results')],
                              filtered.length === 0
                                ? [h.p([], ['No sessions found.'])]
                                : filtered.map((session) =>
                                    button(
                                      h,
                                      sessionTitle(session),
                                      SelectedSession({ id: session.id }),
                                      { className: 'search-result' }
                                    )
                                  )
                            ),
                          ]
                        )
                      : model.overlay === 'connection'
                        ? h.div(
                            [h.Class('modal-body connection-settings')],
                            [
                              h.p(
                                [h.Class('modal-description')],
                                [descriptionText]
                              ),
                              Input.view(
                                {
                                  id: 'server-url',
                                  value: model.serverUrlInput,
                                  onInput: (value) =>
                                    ChangedServerUrl({ value }),
                                  toView: ({ input, label }) =>
                                    h.div(
                                      [h.Class('connection-field')],
                                      [
                                        h.label(label, ['Server URL']),
                                        h.input([
                                          ...input,
                                          h.Class('modal-input'),
                                          h.Placeholder(
                                            'http://127.0.0.1:3100'
                                          ),
                                        ]),
                                      ]
                                    ),
                                },
                                h
                              ),
                              button(
                                h,
                                model.status === 'loading'
                                  ? 'Connecting…'
                                  : 'Reconnect',
                                ClickedConnect(),
                                { disabled: model.status === 'loading' }
                              ),
                              model.status === 'ready'
                                ? h.p(
                                    [h.Class('connection-status')],
                                    [
                                      `Connected${model.serverVersion === null ? '' : ` · ${model.serverVersion}`}`,
                                    ]
                                  )
                                : model.error === null
                                  ? null
                                  : h.p(
                                      [
                                        h.Class('connection-error'),
                                        h.Role('alert'),
                                      ],
                                      [model.error]
                                    ),
                            ]
                          )
                        : model.overlay === 'settings'
                          ? h.div(
                              [h.Class('modal-body settings-shell')],
                              [
                                h.submodel({
                                  slotId: 'settings-tabs',
                                  model: model.settingsTabs,
                                  view: SettingsTabs.view,
                                  toParentMessage: (message) =>
                                    GotSettingsTabsMessage({ message }),
                                  viewInputs: {
                                    tabs: ['general', 'keybinds'],
                                    selectedValue: model.settingsTab,
                                    ariaLabel: 'Settings sections',
                                    orientation: 'Vertical',
                                    toView: ({ tablist, tabs }) =>
                                      h.nav(
                                        [...tablist, h.Class('settings-nav')],
                                        tabs.map((tab) =>
                                          h.button(
                                            [
                                              ...tab.tab,
                                              h.Class(
                                                `ui-button settings-tab ${tab.isActive ? 'selected' : ''}`
                                              ),
                                            ],
                                            [
                                              tab.value === 'general'
                                                ? 'General'
                                                : 'Keybinds',
                                            ]
                                          )
                                        )
                                      ),
                                  },
                                }),
                                model.settingsTab === 'keybinds'
                                  ? h.div(
                                      [
                                        h.Class('settings-content'),
                                        h.Id('settings-tabs-panel-1'),
                                        h.Role('tabpanel'),
                                        h.AriaLabelledBy('settings-tabs-tab-1'),
                                        h.Tabindex(0),
                                      ],
                                      [
                                        h.h3([], ['Keybinds']),
                                        h.p(
                                          [h.Class('modal-description')],
                                          [
                                            'Keyboard shortcuts will be configurable here.',
                                          ]
                                        ),
                                      ]
                                    )
                                  : h.div(
                                      [
                                        h.Class('settings-content'),
                                        h.Id('settings-tabs-panel-0'),
                                        h.Role('tabpanel'),
                                        h.AriaLabelledBy('settings-tabs-tab-0'),
                                        h.Tabindex(0),
                                      ],
                                      [
                                        h.h3([], ['General']),
                                        Switch.view(
                                          {
                                            id: 'expand-system',
                                            isChecked:
                                              model.clientSettings
                                                .expandSystemMessagesByDefault,
                                            onToggle: (value) =>
                                              ChangedSetting({
                                                setting: 'system',
                                                value,
                                              }),
                                            toView: ({
                                              button: toggle,
                                              label,
                                              description: desc,
                                            }) =>
                                              h.div(
                                                [h.Class('setting-row')],
                                                [
                                                  h.div(
                                                    [],
                                                    [
                                                      h.label(label, [
                                                        'Expand system messages by default',
                                                      ]),
                                                      h.p(desc, [
                                                        'Show system message contents without opening each one.',
                                                      ]),
                                                    ]
                                                  ),
                                                  h.button(
                                                    [
                                                      ...toggle,
                                                      h.Class('switch'),
                                                    ],
                                                    [h.span([], [])]
                                                  ),
                                                ]
                                              ),
                                          },
                                          h
                                        ),
                                        Switch.view(
                                          {
                                            id: 'expand-tools',
                                            isChecked:
                                              model.clientSettings
                                                .toolBlockExpansion.default,
                                            onToggle: (value) =>
                                              ChangedSetting({
                                                setting: 'tool-default',
                                                value,
                                              }),
                                            toView: ({
                                              button: toggle,
                                              label,
                                              description: desc,
                                            }) =>
                                              h.div(
                                                [h.Class('setting-row')],
                                                [
                                                  h.div(
                                                    [],
                                                    [
                                                      h.label(label, [
                                                        'Expand tool blocks by default',
                                                      ]),
                                                      h.p(desc, [
                                                        'Default disclosure state for tool calls.',
                                                      ]),
                                                    ]
                                                  ),
                                                  h.button(
                                                    [
                                                      ...toggle,
                                                      h.Class('switch'),
                                                    ],
                                                    [h.span([], [])]
                                                  ),
                                                ]
                                              ),
                                          },
                                          h
                                        ),
                                        h.h4([], ['Per-tool defaults']),
                                        ...(model.handshakeLoading &&
                                        model.serverTools.length === 0
                                          ? [h.p([], ['Loading tools…'])]
                                          : Object.keys(model.toolListboxes)
                                              .sort()
                                              .map((name) =>
                                                h.div(
                                                  [
                                                    h.Key(name),
                                                    h.Class(
                                                      'setting-row tool-setting'
                                                    ),
                                                  ],
                                                  [
                                                    h.div(
                                                      [],
                                                      [
                                                        h.strong(
                                                          [],
                                                          [
                                                            model.serverTools.find(
                                                              (tool) =>
                                                                tool.name ===
                                                                name
                                                            )?.displayName ??
                                                              name,
                                                          ]
                                                        ),
                                                        h.code(
                                                          [],
                                                          [
                                                            `${name}${model.serverTools.some((tool) => tool.name === name) ? '' : ' (not on current server)'}`,
                                                          ]
                                                        ),
                                                      ]
                                                    ),
                                                    listbox(
                                                      model.toolListboxes[
                                                        name
                                                      ] ??
                                                        Listbox.init({
                                                          id: `tool-${name}`,
                                                        }),
                                                      name,
                                                      Object.hasOwn(
                                                        model.clientSettings
                                                          .toolBlockExpansion
                                                          .tools,
                                                        name
                                                      )
                                                        ? model.clientSettings
                                                            .toolBlockExpansion
                                                            .tools[name]
                                                          ? 'expanded'
                                                          : 'collapsed'
                                                        : 'default',
                                                      [
                                                        {
                                                          value: 'default',
                                                          label: `Default (${model.clientSettings.toolBlockExpansion.default ? 'expanded' : 'collapsed'})`,
                                                        },
                                                        {
                                                          value: 'expanded',
                                                          label: 'Expanded',
                                                        },
                                                        {
                                                          value: 'collapsed',
                                                          label: 'Collapsed',
                                                        },
                                                      ],
                                                      `${name} disclosure default`,
                                                      h
                                                    ),
                                                  ]
                                                )
                                              )),
                                        h.div(
                                          [h.Class('setting-row')],
                                          [
                                            h.div(
                                              [],
                                              [
                                                h.strong(
                                                  [],
                                                  ['Transcript display mode']
                                                ),
                                                h.p(
                                                  [],
                                                  [
                                                    'Choose rich rendering or the raw transcript.',
                                                  ]
                                                ),
                                              ]
                                            ),
                                            listbox(
                                              model.transcriptListbox,
                                              'transcript',
                                              model.clientSettings
                                                .transcriptDisplayMode,
                                              [
                                                {
                                                  value: 'pretty',
                                                  label: 'Pretty',
                                                },
                                                {
                                                  value: 'raw',
                                                  label: 'Raw',
                                                },
                                              ],
                                              'Transcript display mode',
                                              h
                                            ),
                                          ]
                                        ),
                                        Object.keys(model.clientConfigOverrides)
                                          .length === 0
                                          ? null
                                          : h.section(
                                              [h.Class('local-changes')],
                                              [
                                                h.h3([], ['Local changes']),
                                                button(
                                                  h,
                                                  model.settingsCopied
                                                    ? 'Copied!'
                                                    : 'Copy Settings',
                                                  ClickedCopySettings()
                                                ),
                                                model.settingsResetConfirm
                                                  ? h.div(
                                                      [],
                                                      [
                                                        h.p(
                                                          [],
                                                          [
                                                            'Discard all local changes? This cannot be undone.',
                                                          ]
                                                        ),
                                                        button(
                                                          h,
                                                          'Confirm reset',
                                                          ConfirmedResetSettings(),
                                                          {
                                                            className:
                                                              'danger-button',
                                                          }
                                                        ),
                                                      ]
                                                    )
                                                  : button(
                                                      h,
                                                      'Reset to defaults',
                                                      ClickedResetSettings(),
                                                      {
                                                        className:
                                                          'outline-button',
                                                      }
                                                    ),
                                              ]
                                            ),
                                        model.settingsSaving
                                          ? h.p(
                                              [h.Class('saving-status')],
                                              ['Saving…']
                                            )
                                          : null,
                                        model.settingsError === null
                                          ? null
                                          : h.div(
                                              [
                                                h.Class('settings-error'),
                                                h.Role('alert'),
                                              ],
                                              [
                                                h.strong(
                                                  [],
                                                  ['Settings error']
                                                ),
                                                h.p([], [model.settingsError]),
                                              ]
                                            ),
                                      ]
                                    ),
                              ]
                            )
                          : h.div(
                              [h.Class('modal-body lab-overlay')],
                              [
                                h.p(
                                  [h.Class('modal-description')],
                                  [
                                    'Deterministic full-stack agent exercises and summarization tools.',
                                  ]
                                ),
                                listbox(
                                  model.scenarioListbox,
                                  'scenario',
                                  model.devScenarios?.activeScenario ?? '',
                                  [
                                    { value: '', label: 'Disabled' },
                                    ...(
                                      model.devScenarios?.scenarios ?? []
                                    ).map((scenario) => ({
                                      value: scenario.id,
                                      label: scenario.label,
                                    })),
                                  ],
                                  'Scenario',
                                  h,
                                  model.activeRunId !== null ||
                                    model.startingSessionId !== null ||
                                    model.compactingRunId !== null ||
                                    model.scenarioBusy
                                ),
                                model.activeRunId === null
                                  ? button(
                                      h,
                                      'Run selected scenario',
                                      ClickedRunScenario(),
                                      {
                                        className: 'accent-button',
                                        disabled:
                                          model.devScenarios?.activeScenario ==
                                          null,
                                      }
                                    )
                                  : button(h, 'Stop scenario', ClickedStop(), {
                                      className: 'accent-button',
                                    }),
                                h.h3([], ['Summarization']),
                                h.div(
                                  [h.Class('summary-range')],
                                  (['start', 'end'] as const).map((edge) =>
                                    listbox(
                                      edge === 'start'
                                        ? model.compactStartListbox
                                        : model.compactEndListbox,
                                      `compact-${edge}`,
                                      edge === 'start'
                                        ? (model.compactStartNodeId ?? '')
                                        : (model.compactEndNodeId ?? ''),
                                      compactableNodes.map((node) => ({
                                        value: node.id,
                                        label: preview(node),
                                      })),
                                      edge === 'start'
                                        ? 'Start node'
                                        : 'End node',
                                      h
                                    )
                                  )
                                ),
                                button(
                                  h,
                                  'Summarize selected range',
                                  ClickedCompact(),
                                  {
                                    className: 'outline-button',
                                  }
                                ),
                              ]
                            ),
                  ]
                ),
              ]
            : []
        ),
    },
  })
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title:
    model.selectedSessionId === null
      ? 'New Session · Sorato'
      : 'Session · Sorato',
  body: h.div(
    [
      h.Class('app-shell'),
      ...(model.compactDragStartNodeId === null
        ? []
        : [
            h.OnPointerUp(() =>
              Option.some(
                AdjustedTreeCompactRange({
                  startId: model.compactStartNodeId ?? '',
                  endId: model.compactEndNodeId ?? '',
                  phase: 'end',
                })
              )
            ),
          ]),
    ],
    [
      sidebar(model, h),
      sessionShell(model, h),
      overlay(model, h),
      model.resizing === null
        ? null
        : h.div(
            [
              h.Class(`resize-capture ${model.resizing.target}`),
              h.OnPointerMove((_sx, _sy, _type) =>
                Option.some(MovedResize({ x: _sx }))
              ),
              h.OnPointerUp(() => Option.some(EndedResize())),
              h.OnPointerLeave(() => Option.some(EndedResize())),
            ],
            []
          ),
    ]
  ),
})
