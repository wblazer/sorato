import * as Button from '@foldkit/ui/button'
import * as Input from '@foldkit/ui/input'
import * as Select from '@foldkit/ui/select'
import * as Textarea from '@foldkit/ui/textarea'
import type { MessageNodeResponse } from '@sorato/api'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import {
  ChangedDraft,
  ChangedServerUrl,
  ClearedError,
  ClickedCompact,
  ClickedConnect,
  ClickedNewTab,
  ClickedRunScenario,
  ClickedSend,
  ClickedStop,
  ClickedToggleTreePanel,
  SelectedBaseNode,
  SelectedCompactEnd,
  SelectedCompactStart,
  SelectedDevScenario,
  SelectedModel,
  SelectedProject,
  SelectedSession,
  SelectedSidePanel,
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
  const sessions = [...model.sessions]
    .filter((session) => session.archivedAt === null)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  return h.aside(
    [h.Class('app-sidebar')],
    [
      h.div(
        [h.Class('sidebar-scroll')],
        [
          h.div(
            [h.Class('new-tab-row')],
            [
              button(h, '+  New Tab', ClickedNewTab(), {
                className: 'new-tab-button',
              }),
            ]
          ),
          h.nav(
            [h.Class('tab-list'), h.AriaLabel('Open sessions')],
            [
              model.selectedSessionId === null
                ? h.div(
                    [h.Class('tab-row selected')],
                    [
                      button(h, '    New Session', ClickedNewTab(), {
                        className: 'tab-button',
                      }),
                    ]
                  )
                : null,
              ...sessions.map((session) =>
                h.div(
                  [
                    h.Key(session.id),
                    h.Class(
                      `tab-row ${session.id === model.selectedSessionId ? 'selected' : ''}`
                    ),
                  ],
                  [
                    button(
                      h,
                      `${session.status === 'running' ? '●' : '  '} ${session.title ?? 'New Session'}`,
                      SelectedSession({ id: session.id }),
                      { className: 'tab-button' }
                    ),
                  ]
                )
              ),
            ]
          ),
        ]
      ),
      h.div(
        [h.Class('sidebar-footer')],
        [
          h.div(
            [h.Class('connection-control')],
            [
              Input.view(
                {
                  id: 'server-url',
                  value: model.serverUrlInput,
                  onInput: (value) => ChangedServerUrl({ value }),
                  toView: ({ input, label }) =>
                    h.div(
                      [h.Class('connection-field')],
                      [
                        h.label([...label, h.Class('sr-only')], ['Server URL']),
                        h.span(
                          [
                            h.Class(`connection-dot ${model.status}`),
                            h.Role('status'),
                            h.AriaLabel(`Connection status: ${model.status}`),
                          ],
                          ['●']
                        ),
                        h.input([
                          ...input,
                          h.Class('connection-input'),
                          h.AriaLabel('Server URL'),
                        ]),
                      ]
                    ),
                },
                h
              ),
              button(h, '↻', ClickedConnect(), {
                disabled: model.status === 'loading',
                className: 'icon-button',
                ariaLabel: 'Reconnect',
              }),
            ]
          ),
          button(h, '⚙  Settings', ClearedError(), {
            className: 'settings-button',
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

  if (role === 'system' || node.kind === 'summary') {
    return h.details(
      [h.Key(node.id), h.Class('system-message')],
      [
        h.summary([], [node.kind === 'summary' ? 'Summary' : 'System']),
        h.pre([], [body]),
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
          ...model.nodes.map((node) => transcriptNode(node, model, h)),
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
              button(h, '+', ClearedError(), {
                disabled,
                className: 'icon-button attach-button',
                ariaLabel: 'Attach image',
              }),
              modelSelect(model, h),
            ]
          ),
          model.activeRunId === null
            ? button(h, '↑', ClickedSend(), {
                disabled: disabled || model.draft.trim() === '',
                className: 'submit-button',
                ariaLabel: 'Send message',
              })
            : button(h, '■', ClickedStop(), {
                className: 'submit-button stop-button',
                ariaLabel: 'Stop run',
              }),
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
                  button(h, '⌕  Search sessions', ClearedError(), {
                    className: 'outline-button',
                  }),
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
                                    [session.title ?? 'New Session']
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
              Select.view(
                {
                  id: 'project',
                  value: model.selectedProjectId ?? '',
                  onChange: (id) => SelectedProject({ id }),
                  toView: ({ select, label }) =>
                    h.div(
                      [h.Class('project-control')],
                      [
                        h.label([...label, h.Class('sr-only')], ['Project']),
                        h.select(
                          [...select, h.Class('project-select')],
                          [
                            h.option([h.Value('')], ['Select project']),
                            ...model.projects.map((project) =>
                              h.option(
                                [
                                  h.Value(project.id),
                                  h.Selected(
                                    project.id === model.selectedProjectId
                                  ),
                                ],
                                [`▰  ${project.name} — ${project.path}`]
                              )
                            ),
                          ]
                        ),
                      ]
                    ),
                },
                h
              ),
            ]
          ),
        ]
      ),
    ]
  )
}

const treePanel = (model: Model, h: HtmlBuilder<Message>): Html => {
  const compactable = model.nodes.filter(
    (node) => node.encoded.role !== 'system'
  )
  const activeScenario = model.devScenarios?.scenarios.find(
    (scenario) => scenario.id === model.devScenarios?.activeScenario
  )
  const canCompact =
    model.selectedSessionId !== null &&
    model.selectedModelId !== '' &&
    model.selectedBaseNodeId !== null &&
    model.compactStartNodeId !== null &&
    model.compactEndNodeId !== null &&
    model.compactingRunId === null

  return h.aside(
    [h.Class('tree-panel')],
    [
      h.div(
        [h.Class('tree-header')],
        [
          button(h, '⌘  Tree', SelectedSidePanel({ panel: 'tree' }), {
            className: `panel-tab ${model.sidePanel === 'tree' ? 'selected' : ''}`,
            ariaLabel: 'Conversation tree',
          }),
          model.devScenarios === null
            ? null
            : button(h, '◈  Lab', SelectedSidePanel({ panel: 'lab' }), {
                className: `panel-tab ${model.sidePanel === 'lab' ? 'selected' : ''}`,
                ariaLabel: 'Scenario Lab',
              }),
          h.span([h.Class('panel-tab disabled')], ['Diff']),
        ]
      ),
      model.sidePanel === 'tree'
        ? h.div(
            [h.Class('tree-scroll')],
            [
              model.nodes.length === 0
                ? h.p([h.Class('tree-empty')], ['No messages yet.'])
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
            [h.Class('lab-panel')],
            [
              h.div(
                [h.Class('lab-title')],
                [h.h2([], ['Scenario Lab']), h.span([], ['DEV'])]
              ),
              h.p([], ['Deterministic full-stack agent exercises.']),
              model.devScenarios === null
                ? null
                : Select.view(
                    {
                      id: 'dev-scenario',
                      value: model.devScenarios.activeScenario ?? '',
                      isDisabled: model.scenarioBusy,
                      onChange: (id) =>
                        SelectedDevScenario({
                          id:
                            model.devScenarios?.scenarios.find(
                              (scenario) => scenario.id === id
                            )?.id ?? null,
                        }),
                      toView: ({ select, label }) =>
                        h.div(
                          [h.Class('lab-field')],
                          [
                            h.label(label, ['Mock scenario']),
                            h.select(
                              [...select],
                              [
                                h.option([h.Value('')], ['Disabled']),
                                ...(model.devScenarios?.scenarios ?? []).map(
                                  (scenario) =>
                                    h.option(
                                      [
                                        h.Value(scenario.id),
                                        h.Selected(
                                          scenario.id ===
                                            model.devScenarios?.activeScenario
                                        ),
                                      ],
                                      [scenario.label]
                                    )
                                ),
                              ]
                            ),
                          ]
                        ),
                    },
                    h
                  ),
              activeScenario === undefined
                ? null
                : h.div(
                    [h.Class('scenario-card')],
                    [
                      h.strong([], [activeScenario.label]),
                      h.p([], [activeScenario.description]),
                      h.div(
                        [h.Class('tag-list')],
                        activeScenario.tags.map((tag) =>
                          h.span([h.Key(tag)], [tag])
                        )
                      ),
                      button(h, 'Run selected scenario', ClickedRunScenario(), {
                        disabled:
                          model.selectedSessionId === null ||
                          model.activeRunId !== null,
                        className: 'accent-button',
                      }),
                    ]
                  ),
              h.div(
                [h.Class('lab-divider')],
                [
                  h.strong([], ['Summarization']),
                  h.span([], ['Select a range']),
                ]
              ),
              Select.view(
                {
                  id: 'compact-start',
                  value: model.compactStartNodeId ?? '',
                  isDisabled: compactable.length === 0,
                  onChange: (id) => SelectedCompactStart({ id }),
                  toView: ({ select, label }) =>
                    h.div(
                      [h.Class('lab-field')],
                      [
                        h.label(label, ['Summary start']),
                        h.select(
                          [...select],
                          compactable.map((node) =>
                            h.option([h.Value(node.id)], [preview(node)])
                          )
                        ),
                      ]
                    ),
                },
                h
              ),
              Select.view(
                {
                  id: 'compact-end',
                  value: model.compactEndNodeId ?? '',
                  isDisabled: compactable.length === 0,
                  onChange: (id) => SelectedCompactEnd({ id }),
                  toView: ({ select, label }) =>
                    h.div(
                      [h.Class('lab-field')],
                      [
                        h.label(label, ['Summary end']),
                        h.select(
                          [...select],
                          compactable.map((node) =>
                            h.option([h.Value(node.id)], [preview(node)])
                          )
                        ),
                      ]
                    ),
                },
                h
              ),
              button(
                h,
                model.compactingRunId === null
                  ? 'Summarize selected range'
                  : 'Summarizing…',
                ClickedCompact(),
                { disabled: !canCompact, className: 'outline-button' }
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
                  project === undefined
                    ? null
                    : h.span([h.Class('project-badge')], [project.name]),
                ]
              ),
              button(h, '▤', ClickedToggleTreePanel(), {
                className: 'tree-toggle',
                ariaLabel: model.treePanelOpen
                  ? 'Close side panel'
                  : 'Open side panel',
              }),
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

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title:
    model.selectedSessionId === null
      ? 'New Session · Sorato'
      : 'Session · Sorato',
  body: h.div(
    [h.Class('app-shell')],
    [sidebar(model, h), sessionShell(model, h)]
  ),
})
