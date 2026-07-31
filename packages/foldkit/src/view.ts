import * as Button from '@foldkit/ui/button'
import * as Input from '@foldkit/ui/input'
import * as Select from '@foldkit/ui/select'
import * as Textarea from '@foldkit/ui/textarea'
import type { MessageNodeResponse } from '@sorato/api'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import {
  ChangedDraft,
  ChangedSessionSearch,
  ChangedServerUrl,
  ClosedTab,
  ClosedOverlay,
  ClearedError,
  ClickedCompact,
  ClickedConnect,
  ClickedNewTab,
  ClickedRunScenario,
  ClickedSend,
  ClickedStop,
  ClickedToggleTreePanel,
  OpenedOverlay,
  SelectedBaseNode,
  SelectedCompactEnd,
  SelectedCompactStart,
  SelectedDevScenario,
  SelectedModel,
  SelectedProject,
  SelectedSession,
  SelectedSidePanel,
  SelectedTab,
} from './main.ts'
import type { Message, Model } from './main.ts'

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

const icon = (h: HtmlBuilder<Message>, path: string, className = ''): Html =>
  h.svg(
    [
      h.Class(`ph-icon ${className}`),
      h.ViewBox('0 0 24 24'),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('1.75'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    [h.path([h.D(path)], [])]
  )

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

const systemLabel = (node: MessageNodeResponse): string => {
  if (node.kind === 'summary') return 'Summary'
  const body = plainContent(node)
  return body.includes('Project-specific instructions')
    ? 'AGENTS.md'
    : 'System Prompt'
}

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

const sidebar = (model: Model, h: HtmlBuilder<Message>): Html => {
  return h.aside(
    [h.Class('app-sidebar')],
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
                      [icon(h, 'M12 5v14M5 12h14'), h.span([], ['New Tab'])]
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
                    icon(h, 'M6 6l12 12M18 6 6 18'),
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
        [h.Class('sidebar-footer')],
        [
          button(
            h,
            `${model.serverUrlInput}`,
            OpenedOverlay({ overlay: 'settings' }),
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
                  [
                    icon(
                      h,
                      'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6L16.6 7.4M7.4 16.6 6 18m12 0-1.4-1.4M7.4 7.4 6 6'
                    ),
                    h.span([], ['Settings']),
                  ]
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

const transcriptNode = (
  node: MessageNodeResponse,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const role = node.encoded.role
  const body = plainContent(node)
  if (role === 'system' || node.kind === 'summary') {
    return h.details(
      [h.Key(node.id), h.Class('system-message')],
      [h.summary([], [systemLabel(node)]), h.pre([], [body])]
    )
  }

  if (role === 'user') {
    return h.article(
      [h.Key(node.id), h.Class('message-row user-message')],
      [
        h.div([h.Class('user-bubble')], [h.div([], [body])]),
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
            button(h, '↗', SelectedBaseNode({ id: node.id }), {
              disabled: model.activeRunId !== null,
              className: 'message-action',
              ariaLabel: 'Branch from this message',
            }),
          ]
        ),
      ]
    )
  }

  if (role === 'tool') {
    return h.details(
      [h.Key(node.id), h.Class('tool-message')],
      [h.summary([], ['Tool result']), h.pre([], [body])]
    )
  }

  return h.article(
    [h.Key(node.id), h.Class('message-row assistant-message')],
    [
      h.div([h.Class('assistant-copy')], [body]),
      h.div(
        [h.Class('assistant-meta')],
        [
          node.modelCall === null
            ? node.run?.status === 'interrupted'
              ? 'interrupted'
              : ''
            : `${node.modelCall.providerId}/${node.modelCall.modelId}`,
        ]
      ),
    ]
  )
}

const activityRows = (
  model: Model,
  h: HtmlBuilder<Message>
): ReadonlyArray<Html> =>
  model.activity.map((item) =>
    item.kind === 'tool-call' || item.kind === 'tool-result'
      ? h.details(
          [
            h.Key(item.id),
            h.Class(`tool-message ${item.failed ? 'failed' : ''}`),
          ],
          [h.summary([], [item.title]), h.pre([], [item.body])]
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
          ...selectedNodePath(model).map((node) =>
            transcriptNode(node, model, h)
          ),
          ...activityRows(model, h),
          model.nodes.length === 0 && model.activity.length === 0
            ? h.p([h.Class('empty-transcript')], ['No messages yet.'])
            : null,
        ]
      ),
    ]
  )

const modelSelect = (model: Model, h: HtmlBuilder<Message>): Html =>
  Select.view(
    {
      id: 'model',
      value: model.selectedModelId,
      isDisabled: model.selectedProjectId === null,
      onChange: (id) => SelectedModel({ id }),
      toView: ({ select, label }) =>
        h.div(
          [h.Class('model-control')],
          [
            h.label([...label, h.Class('sr-only')], ['Model']),
            h.select(
              [...select, h.Class('model-select')],
              [
                h.option([h.Value('')], ['Select model']),
                ...model.models.map((item) =>
                  h.option(
                    [
                      h.Value(item.id),
                      h.Selected(item.id === model.selectedModelId),
                    ],
                    [item.name]
                  )
                ),
              ]
            ),
          ]
        ),
    },
    h
  )

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
                  icon(h, 'M12 3a9 9 0 1 1-9 9'),
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
                icon(h, 'M12 19V5m-6 6 6-6 6 6'),
                ClickedSend(),
                'Send message',
                'submit-button',
                disabled || model.draft.trim() === ''
              )
            : iconButton(
                h,
                icon(h, 'M8 8h8v8H8z'),
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
                                icon(
                                  h,
                                  'M21 21l-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0'
                                ),
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
              (() => {
                const selected = model.projects.find(
                  (p) => p.id === model.selectedProjectId
                )
                const next =
                  model.projects[
                    (Math.max(
                      0,
                      model.projects.findIndex(
                        (p) => p.id === model.selectedProjectId
                      )
                    ) +
                      1) %
                      Math.max(1, model.projects.length)
                  ]
                return Button.view(
                  {
                    onClick: SelectedProject({ id: next?.id ?? '' }),
                    isDisabled: model.projects.length === 0,
                    toView: ({ button: a }) =>
                      h.button(
                        [
                          ...a,
                          h.Class('project-select'),
                          h.Role('combobox'),
                          h.AriaLabel('Project'),
                        ],
                        [
                          icon(h, 'M3 7.5h7l2 2h9v9H3z'),
                          h.span(
                            [h.Class('project-copy')],
                            [
                              h.strong(
                                [],
                                [selected?.name ?? 'Select project']
                              ),
                              selected ? h.small([], [selected.path]) : null,
                            ]
                          ),
                          icon(h, 'm8 10 4 4 4-4'),
                        ]
                      ),
                  },
                  h
                )
              })(),
            ]
          ),
        ]
      ),
    ]
  )
}

const treePanel = (model: Model, h: HtmlBuilder<Message>): Html => {
  return h.aside(
    [h.Class('tree-panel')],
    [
      h.div(
        [h.Class('tree-header')],
        [
          Button.view(
            {
              onClick: SelectedSidePanel({ panel: 'tree' }),
              toView: ({ button: a }) =>
                h.button(
                  [
                    ...a,
                    h.Class(
                      `ui-button panel-tab ${model.sidePanel === 'tree' ? 'selected' : ''}`
                    ),
                    h.AriaLabel('Conversation tree'),
                  ],
                  [
                    icon(
                      h,
                      'M6 3v12a3 3 0 0 0 3 3h9M6 8h8a3 3 0 0 1 3 3v10M3 3h6M14 21h6'
                    ),
                    h.span([], ['Tree']),
                  ]
                ),
            },
            h
          ),
          button(h, 'Diff', SelectedSidePanel({ panel: 'diff' }), {
            className: `panel-tab ${model.sidePanel === 'diff' ? 'selected' : ''}`,
          }),
        ]
      ),
      model.sidePanel === 'tree'
        ? h.div(
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
                    [h.Class('tree-list')],
                    model.nodes.map((node, index) =>
                      button(
                        h,
                        `${node.kind === 'summary' ? '◆' : node.encoded.role === 'user' ? '●' : node.encoded.role === 'tool' ? '◇' : '■'}  ${preview(node)}`,
                        SelectedBaseNode({ id: node.id }),
                        {
                          className: `tree-row tone-${node.kind === 'summary' ? 'summary' : node.encoded.role} ${node.id === model.selectedBaseNodeId ? 'selected' : ''} depth-${Math.min(index, 3)}`,
                        }
                      )
                    )
                  ),
            ]
          )
        : h.div(
            [h.Class('tree-scroll')],
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
                icon(h, 'M4 5h16v14H4zm11 0v14'),
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
      model.treePanelOpen ? h.div([h.Class('tree-spacer')], []) : null,
      model.treePanelOpen ? treePanel(model, h) : null,
    ]
  )
}

const overlay = (model: Model, h: HtmlBuilder<Message>): Html | null => {
  if (model.overlay === null) return null
  const close = iconButton(
    h,
    icon(h, 'M6 6l12 12M18 6 6 18'),
    ClosedOverlay(),
    'Close dialog',
    'modal-close'
  )
  const filtered = model.sessions.filter((session) =>
    sessionTitle(session)
      .toLowerCase()
      .includes(model.sessionSearch.toLowerCase())
  )
  const title =
    model.overlay === 'search'
      ? 'Search sessions'
      : model.overlay === 'settings'
        ? 'Connection settings'
        : 'Scenario Lab'
  const compactableNodes = selectedNodePath(model).filter(
    (node) => node.encoded.role !== 'system'
  )
  return h.div(
    [h.Class('modal-backdrop'), h.Role('presentation')],
    [
      h.section(
        [
          h.Class('modal-card'),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabel(title),
        ],
        [
          h.header(
            [],
            [
              h.div(
                [],
                [
                  h.h2([], [title]),
                  model.overlay === 'lab'
                    ? h.span([h.Class('dev-pill')], ['DEV'])
                    : null,
                ]
              ),
              close,
            ]
          ),
          model.overlay === 'search'
            ? h.div(
                [h.Class('modal-body search-modal')],
                [
                  Input.view(
                    {
                      id: 'session-search',
                      value: model.sessionSearch,
                      onInput: (value) => ChangedSessionSearch({ value }),
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
            : model.overlay === 'settings'
              ? h.div(
                  [h.Class('modal-body')],
                  [
                    h.p(
                      [h.Class('modal-description')],
                      ['Connect Sorato to a local coordinator.']
                    ),
                    Input.view(
                      {
                        id: 'settings-url',
                        value: model.serverUrlInput,
                        onInput: (value) => ChangedServerUrl({ value }),
                        toView: ({ input, label }) =>
                          h.div(
                            [h.Class('settings-field')],
                            [
                              h.label(label, ['Server URL']),
                              h.input([
                                ...input,
                                h.Class('modal-input'),
                                h.AriaLabel('Server URL'),
                              ]),
                            ]
                          ),
                      },
                      h
                    ),
                    button(
                      h,
                      model.status === 'loading' ? 'Connecting…' : 'Reconnect',
                      ClickedConnect(),
                      {
                        disabled: model.status === 'loading',
                        className: 'accent-button modal-action',
                      }
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
                    Select.view(
                      {
                        id: 'overlay-scenario',
                        value: model.devScenarios?.activeScenario ?? '',
                        isDisabled:
                          model.scenarioBusy ||
                          model.startingSessionId !== null ||
                          model.activeRunId !== null ||
                          model.compactingRunId !== null,
                        onChange: (id) =>
                          SelectedDevScenario({
                            id:
                              model.devScenarios?.scenarios.find(
                                (s) => s.id === id
                              )?.id ?? null,
                          }),
                        toView: ({ select, label }) =>
                          h.div(
                            [h.Class('lab-field')],
                            [
                              h.label(label, ['Scenario']),
                              h.select(
                                [...select],
                                [
                                  h.option([h.Value('')], ['Disabled']),
                                  ...(model.devScenarios?.scenarios ?? []).map(
                                    (s) => h.option([h.Value(s.id)], [s.label])
                                  ),
                                ]
                              ),
                            ]
                          ),
                      },
                      h
                    ),
                    model.activeRunId === null
                      ? button(
                          h,
                          'Run selected scenario',
                          ClickedRunScenario(),
                          {
                            className: 'accent-button',
                            disabled:
                              model.devScenarios?.activeScenario == null,
                          }
                        )
                      : button(h, 'Stop scenario', ClickedStop(), {
                          className: 'accent-button',
                        }),
                    h.h3([], ['Summarization']),
                    h.div(
                      [h.Class('summary-range')],
                      (['start', 'end'] as const).map((edge) =>
                        Select.view(
                          {
                            id: `overlay-${edge}`,
                            value:
                              edge === 'start'
                                ? (model.compactStartNodeId ?? '')
                                : (model.compactEndNodeId ?? ''),
                            onChange: (id) =>
                              edge === 'start'
                                ? SelectedCompactStart({ id })
                                : SelectedCompactEnd({ id }),
                            toView: ({ select, label }) =>
                              h.div(
                                [h.Class('lab-field')],
                                [
                                  h.label(label, [
                                    edge === 'start'
                                      ? 'Start node'
                                      : 'End node',
                                  ]),
                                  h.select(
                                    [...select],
                                    compactableNodes.map((n) =>
                                      h.option([h.Value(n.id)], [preview(n)])
                                    )
                                  ),
                                ]
                              ),
                          },
                          h
                        )
                      )
                    ),
                    button(h, 'Summarize selected range', ClickedCompact(), {
                      className: 'outline-button',
                    }),
                  ]
                ),
        ]
      ),
    ]
  )
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title:
    model.selectedSessionId === null
      ? 'New Session · Sorato'
      : 'Session · Sorato',
  body: h.div(
    [h.Class('app-shell')],
    [sidebar(model, h), sessionShell(model, h), overlay(model, h)]
  ),
})
