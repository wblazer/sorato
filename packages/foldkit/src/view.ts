import * as Button from '@foldkit/ui/button'
import * as Input from '@foldkit/ui/input'
import * as Select from '@foldkit/ui/select'
import * as Textarea from '@foldkit/ui/textarea'
import type { MessageNodeResponse } from '@sorato/api'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import {
  ChangedDraft,
  ChangedProjectFilter,
  ChangedServerUrl,
  ClearedError,
  ClickedCompact,
  ClickedConnect,
  ClickedCreateSession,
  ClickedRunScenario,
  ClickedSend,
  ClickedStop,
  SelectedCompactEnd,
  SelectedCompactStart,
  SelectedBaseNode,
  SelectedDevScenario,
  SelectedModel,
  SelectedProject,
  SelectedSession,
} from './main.ts'
import type { Message, Model } from './main.ts'

const button = (
  h: HtmlBuilder<Message>,
  label: string,
  message: Message,
  options: { disabled?: boolean; tone?: 'primary' | 'danger' } = {}
) =>
  Button.view(
    {
      onClick: message,
      ...(options.disabled === undefined
        ? {}
        : { isDisabled: options.disabled }),
      toView: ({ button: attributes }) =>
        h.button(
          [...attributes, h.Class(`button ${options.tone ?? ''}`)],
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
      if (part.type === 'text') return part.text
      if (part.type === 'reasoning') return part.text
      if (part.type === 'tool-call')
        return `${part.name}\n${JSON.stringify(part.params, null, 2)}`
      if (part.type === 'tool-result') return `${part.name}\n${part.result}`
      return JSON.stringify(part, null, 2)
    })
    .join('\n')
}

const transcriptNode = (
  node: MessageNodeResponse,
  model: Model,
  h: HtmlBuilder<Message>
): Html => {
  const role = node.encoded.role
  const isTool = role === 'tool' || plainContent(node).includes('tool-call')
  return h.article(
    [h.Class(`message ${isTool ? 'tool-card' : role}`)],
    [
      h.header(
        [],
        [
          h.strong([], [node.kind === 'summary' ? 'Summary' : role]),
          h.span([h.Class('node-id')], [node.id.slice(0, 8)]),
        ]
      ),
      h.pre([], [plainContent(node)]),
      button(
        h,
        model.selectedBaseNodeId === node.id
          ? 'Selected branch head'
          : 'Branch from here',
        SelectedBaseNode({ id: node.id }),
        { disabled: model.activeRunId !== null }
      ),
    ]
  )
}

const sidebar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const query = model.projectFilter.toLocaleLowerCase()
  const projects = model.projects.filter((project) =>
    `${project.name} ${project.path}`.toLocaleLowerCase().includes(query)
  )
  const sessions = model.sessions.filter(
    (session) =>
      session.projectId === model.selectedProjectId &&
      session.archivedAt === null
  )
  return h.aside(
    [h.Class('sidebar')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.span([h.Class('brand-mark')], ['S']),
          h.div([], [h.h1([], ['Sorato']), h.small([], ['Foldkit workspace'])]),
        ]
      ),
      Input.view(
        {
          id: 'project-filter',
          value: model.projectFilter,
          placeholder: 'Filter projects',
          onInput: (value) => ChangedProjectFilter({ value }),
          toView: ({ input, label }) =>
            h.div(
              [h.Class('field')],
              [
                h.label(label, ['Projects']),
                h.input([...input, h.Class('control')]),
              ]
            ),
        },
        h
      ),
      h.nav(
        [h.AriaLabel('Projects and sessions')],
        [
          h.ul(
            [h.Class('project-list')],
            projects.map((project) =>
              h.li(
                [h.Key(project.id)],
                [
                  button(h, project.name, SelectedProject({ id: project.id }), {
                    disabled: model.selectedProjectId === project.id,
                  }),
                  model.selectedProjectId === project.id
                    ? h.ul(
                        [h.Class('session-list')],
                        sessions.map((session) =>
                          h.li(
                            [h.Key(session.id)],
                            [
                              button(
                                h,
                                session.title ?? 'Untitled session',
                                SelectedSession({ id: session.id }),
                                {
                                  disabled:
                                    model.selectedSessionId === session.id,
                                }
                              ),
                            ]
                          )
                        )
                      )
                    : null,
                ]
              )
            )
          ),
        ]
      ),
      button(h, 'New session', ClickedCreateSession(), {
        disabled: model.selectedProjectId === null,
      }),
      scenarioLab(model, h),
    ]
  )
}

const connectionBar = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class('connection-bar')],
    [
      Input.view(
        {
          id: 'server-url',
          value: model.serverUrlInput,
          onInput: (value) => ChangedServerUrl({ value }),
          toView: ({ input, label }) =>
            h.div(
              [h.Class('server-field')],
              [
                h.label(label, ['Server URL']),
                h.input([...input, h.Class('control')]),
              ]
            ),
        },
        h
      ),
      button(
        h,
        model.status === 'loading' ? 'Connecting…' : 'Connect',
        ClickedConnect(),
        { disabled: model.status === 'loading' }
      ),
      h.span(
        [h.Class(`status ${model.status}`), h.Role('status')],
        [model.status]
      ),
    ]
  )

const composer = (model: Model, h: HtmlBuilder<Message>): Html => {
  const disabled =
    model.selectedSessionId === null ||
    model.selectedModelId === '' ||
    model.activeRunId !== null ||
    model.startingSessionId !== null
  return h.section(
    [h.Class('composer'), h.AriaLabel('Message composer')],
    [
      Select.view(
        {
          id: 'model',
          value: model.selectedModelId,
          isDisabled: model.selectedProjectId === null,
          onChange: (id) => SelectedModel({ id }),
          toView: ({ select, label }) =>
            h.div(
              [h.Class('field model-field')],
              [
                h.label(label, ['Model']),
                h.select(
                  [...select, h.Class('control')],
                  [
                    h.option([h.Value('')], ['Select model']),
                    ...model.models.map((item) =>
                      h.option(
                        [
                          h.Value(item.id),
                          h.Selected(item.id === model.selectedModelId),
                        ],
                        [`${item.provider} · ${item.name}`]
                      )
                    ),
                  ]
                ),
              ]
            ),
        },
        h
      ),
      Textarea.view(
        {
          id: 'prompt',
          value: model.draft,
          rows: 3,
          placeholder:
            model.selectedSessionId === null
              ? 'Select or create a session'
              : 'Ask Sorato…',
          isDisabled: disabled,
          onInput: (value) => ChangedDraft({ value }),
          toView: ({ textarea, label, description }) =>
            h.div(
              [h.Class('field prompt-field')],
              [
                h.label([...label, h.Class('sr-only')], ['Prompt']),
                h.textarea([...textarea, h.Class('control')], []),
                h.p(description, [
                  'Plain text; current branch head is used as the run base.',
                ]),
              ]
            ),
        },
        h
      ),
      h.div(
        [h.Class('composer-actions')],
        [
          model.activeRunId === null
            ? button(h, 'Send', ClickedSend(), {
                tone: 'primary',
                disabled: disabled || model.draft.trim() === '',
              })
            : button(h, 'Stop run', ClickedStop(), { tone: 'danger' }),
        ]
      ),
    ]
  )
}

const scenarioLab = (model: Model, h: HtmlBuilder<Message>): Html | null => {
  const status = model.devScenarios
  if (status === null) return null
  const active = status.scenarios.find(
    (scenario) => scenario.id === status.activeScenario
  )
  const compactable = model.nodes.filter(
    (node) => node.encoded.role !== 'system'
  )
  const canRun =
    active !== undefined &&
    model.selectedSessionId !== null &&
    model.activeRunId === null &&
    model.startingSessionId === null
  const canCompact =
    model.selectedSessionId !== null &&
    model.selectedModelId !== '' &&
    model.selectedBaseNodeId !== null &&
    model.compactStartNodeId !== null &&
    model.compactEndNodeId !== null &&
    model.compactingRunId === null

  return h.section(
    [h.Class('scenario-lab'), h.AriaLabel('Development scenario lab')],
    [
      h.div(
        [h.Class('lab-heading')],
        [
          h.div(
            [],
            [
              h.h2([], ['Scenario Lab']),
              h.p([], ['Deterministic full-stack agent exercises']),
            ]
          ),
          h.span([h.Class('dev-badge')], ['DEV']),
        ]
      ),
      Select.view(
        {
          id: 'dev-scenario',
          value: status.activeScenario ?? '',
          isDisabled: model.scenarioBusy,
          onChange: (id) =>
            SelectedDevScenario({
              id:
                status.scenarios.find((scenario) => scenario.id === id)?.id ??
                null,
            }),
          toView: ({ select, label }) =>
            h.div(
              [h.Class('field')],
              [
                h.label(label, ['Mock scenario']),
                h.select(
                  [...select, h.Class('control')],
                  [
                    h.option([h.Value('')], ['Disabled']),
                    ...status.scenarios.map((scenario) =>
                      h.option(
                        [
                          h.Value(scenario.id),
                          h.Selected(scenario.id === status.activeScenario),
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
      active === undefined
        ? h.p(
            [h.Class('lab-hint')],
            ['Choose a scenario to expose the mock model without an API key.']
          )
        : h.div(
            [h.Class('scenario-description')],
            [
              h.strong([], [active.label]),
              h.p([], [active.description]),
              h.div(
                [h.Class('tag-list')],
                active.tags.map((tag) => h.span([h.Key(tag)], [tag]))
              ),
              button(h, 'Run selected scenario', ClickedRunScenario(), {
                tone: 'primary',
                disabled: !canRun,
              }),
            ]
          ),
      h.details(
        [h.Class('lab-tools')],
        [
          h.summary([], ['Branching & summarization']),
          h.p(
            [],
            [
              'Use “Branch from here” on any transcript node, or compact a selected range below.',
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
                  [h.Class('field')],
                  [
                    h.label(label, ['Summary start']),
                    h.select(
                      [...select, h.Class('control')],
                      compactable.map((node) =>
                        h.option(
                          [
                            h.Value(node.id),
                            h.Selected(node.id === model.compactStartNodeId),
                          ],
                          [`${node.encoded.role} · ${node.id.slice(0, 8)}`]
                        )
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
                  [h.Class('field')],
                  [
                    h.label(label, ['Summary end']),
                    h.select(
                      [...select, h.Class('control')],
                      compactable.map((node) =>
                        h.option(
                          [
                            h.Value(node.id),
                            h.Selected(node.id === model.compactEndNodeId),
                          ],
                          [`${node.encoded.role} · ${node.id.slice(0, 8)}`]
                        )
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
            { disabled: !canCompact }
          ),
        ]
      ),
    ]
  )
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: model.selectedSessionId === null ? 'Sorato' : 'Session · Sorato',
  body: h.div(
    [h.Class('app-shell')],
    [
      connectionBar(model, h),
      sidebar(model, h),
      h.main(
        [h.Class('workspace')],
        [
          model.error === null
            ? null
            : h.div(
                [h.Class('error-banner'), h.Role('alert')],
                [h.p([], [model.error]), button(h, 'Dismiss', ClearedError())]
              ),
          model.selectedSessionId === null
            ? h.section(
                [h.Class('empty-state')],
                [
                  h.h2([], ['Choose a session']),
                  h.p(
                    [],
                    [
                      'Select a project, then open or create a session to begin.',
                    ]
                  ),
                ]
              )
            : h.section(
                [
                  h.Class('conversation'),
                  h.AriaLabel('Conversation transcript'),
                  h.AriaLive('polite'),
                ],
                [
                  h.h2([h.Class('sr-only')], ['Conversation']),
                  ...model.nodes.map((node) => transcriptNode(node, model, h)),
                  ...model.activity.map((item) =>
                    h.article(
                      [
                        h.Key(item.id),
                        h.Class(
                          `stream-card ${item.kind} ${item.failed ? 'failed' : ''}`
                        ),
                      ],
                      [h.strong([], [item.title]), h.pre([], [item.body])]
                    )
                  ),
                  model.nodes.length === 0 && model.activity.length === 0
                    ? h.p(
                        [h.Class('empty-transcript')],
                        ['No messages yet. Start a run below.']
                      )
                    : null,
                ]
              ),
          composer(model, h),
        ]
      ),
    ]
  ),
})
