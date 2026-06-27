import { Schema } from 'effect'
import type { AppTab, Session } from '$lib/types.js'
import {
  getJsonWithSchema,
  setJsonWithSchema,
  storageKey,
} from '$lib/storage.js'
import { connectionsStore } from './connections.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { Effect } from 'effect'

interface TabSet {
  readonly tabs: AppTab[]
  readonly activeTabId: string | null
}

const tabsKey = (connectionId: string | undefined) =>
  storageKey('connection', connectionId, 'tabs')

const AppTabSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  kind: Schema.Literals(['new', 'session']),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

const TabSetSchema = Schema.Struct({
  tabs: Schema.Array(AppTabSchema),
  activeTabId: Schema.NullOr(Schema.String),
})

type PersistedTabSet = typeof TabSetSchema.Type

const newTab = (): AppTab => {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    sessionId: null,
    projectId: null,
    title: null,
    kind: 'new',
    createdAt: now,
    updatedAt: now,
  }
}

function createTabStore() {
  let tabSets = $state<Record<string, TabSet>>({})
  const fallbackTabSet = initialTabSet()

  function activeConnectionKey(): string {
    return connectionsStore.activeConnection?.id ?? '__no_connection__'
  }

  function activeStorageKey(): string | null {
    const id = connectionsStore.activeConnection?.id
    return id ? tabsKey(id) : null
  }

  function initialTabSet(): TabSet {
    const tab = newTab()
    return { tabs: [tab], activeTabId: tab.id }
  }

  function getTabSet(): TabSet {
    return tabSets[activeConnectionKey()] ?? fallbackTabSet
  }

  function normalizeTabSet(
    value: PersistedTabSet | TabSet | null
  ): TabSet | undefined {
    if (!value || value.tabs.length === 0) return undefined

    const ids = new Set<string>()
    const tabs = value.tabs.filter((tab) => {
      if (ids.has(tab.id)) return false
      ids.add(tab.id)
      return true
    })
    if (tabs.length === 0) return undefined

    const activeTabId = tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0].id
    return { tabs, activeTabId }
  }

  function readPersistedTabSet(): TabSet | undefined {
    const key = activeStorageKey()
    if (!key) return undefined
    return normalizeTabSet(
      getJsonWithSchema(key, Schema.NullOr(TabSetSchema), null)
    )
  }

  function persistTabSet(tabSet: TabSet) {
    const key = activeStorageKey()
    if (!key) return
    setJsonWithSchema(
      key,
      TabSetSchema,
      normalizeTabSet(tabSet) ?? initialTabSet()
    )
  }

  function ensureTabSet(): TabSet {
    const key = activeConnectionKey()
    const existing = tabSets[key]
    if (existing) return existing
    const created = readPersistedTabSet() ?? initialTabSet()
    tabSets = { ...tabSets, [key]: created }
    return created
  }

  function setTabSet(next: TabSet) {
    const normalized = normalizeTabSet(next) ?? initialTabSet()
    tabSets = { ...tabSets, [activeConnectionKey()]: normalized }
    persistTabSet(normalized)
  }

  function ensureActiveConnectionTabSet() {
    ensureTabSet()
  }

  function reconcileSessions(sessions: ReadonlyArray<Session>) {
    const state = ensureTabSet()
    const knownSessionIds = new Set(sessions.map((session) => session.id))
    const tabs = state.tabs.filter(
      (tab) => tab.sessionId === null || knownSessionIds.has(tab.sessionId)
    )
    if (tabs.length === state.tabs.length) return

    const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : (tabs[0]?.id ?? null)
    setTabSet(tabs.length === 0 ? initialTabSet() : { tabs, activeTabId })
  }

  function loadActiveTabMessages() {
    const tab = activeTab()
    if (tab?.sessionId) return messagesStore.loadMessages(tab.id, tab.sessionId)
    return Effect.void
  }

  function activeTab(): AppTab | null {
    const state = getTabSet()
    return state.activeTabId
      ? (state.tabs.find((tab) => tab.id === state.activeTabId) ?? null)
      : null
  }

  function setActiveTab(id: string) {
    const state = ensureTabSet()
    setTabSet({ ...state, activeTabId: id })
    const tab = state.tabs.find((item) => item.id === id)
    if (!tab?.sessionId) messagesStore.clearActiveStream()
  }

  function openNewTab() {
    const state = ensureTabSet()
    const tab = newTab()
    setTabSet({ tabs: [tab, ...state.tabs], activeTabId: tab.id })
    messagesStore.clearActiveStream()
  }

  function closeTab(id: string) {
    const state = ensureTabSet()
    const index = state.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return

    const next = state.tabs.filter((tab) => tab.id !== id)

    if (state.activeTabId === id) {
      const replacement = next[Math.max(0, index - 1)] ?? next[0] ?? null
      if (replacement) {
        setTabSet({ tabs: next, activeTabId: replacement.id })
        setActiveTab(replacement.id)
      } else {
        setTabSet({ tabs: next, activeTabId: null })
        messagesStore.clearActiveStream()
      }
      messagesStore.clearTab(id)
    } else {
      setTabSet({ ...state, tabs: next })
      messagesStore.clearTab(id)
    }
  }

  function activateAdjacentTab(direction: 1 | -1) {
    const state = ensureTabSet()
    if (state.tabs.length < 2) return
    const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    if (index < 0) return

    const nextIndex =
      (index + direction + state.tabs.length) % state.tabs.length
    setActiveTab(state.tabs[nextIndex].id)
  }

  function activateNextTab() {
    activateAdjacentTab(1)
  }

  function activatePreviousTab() {
    activateAdjacentTab(-1)
  }

  function setDraftProject(tabId: string, projectId: string | null) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, projectId, updatedAt: Date.now() } : tab
      ),
    })
  }

  function resetActiveTabToNewSession() {
    const state = ensureTabSet()
    if (!state.activeTabId) {
      openNewTab()
      return
    }

    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              sessionId: null,
              title: null,
              kind: 'new' as const,
              updatedAt: Date.now(),
            }
          : tab
      ),
    })
    messagesStore.clearTab(state.activeTabId)
    messagesStore.clearActiveStream()
  }

  function clearProject(projectId: string) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.projectId === projectId && tab.sessionId === null
          ? { ...tab, projectId: null, updatedAt: Date.now() }
          : tab
      ),
    })
  }

  function attachSession(tabId: string, session: Session) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              kind: 'session',
              sessionId: session.id,
              projectId: session.projectId,
              title: session.title,
              updatedAt: Date.now(),
            }
          : tab
      ),
    })
  }

  function updateSessionTitle(sessionId: string, title: string | null) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.sessionId === sessionId
          ? { ...tab, title, updatedAt: Date.now() }
          : tab
      ),
    })
  }

  return {
    get tabs() {
      return getTabSet().tabs
    },
    get activeTabId() {
      return getTabSet().activeTabId
    },
    get activeTab() {
      return activeTab()
    },
    setActiveTab,
    openNewTab,
    closeTab,
    activateNextTab,
    activatePreviousTab,
    resetActiveTabToNewSession,
    setDraftProject,
    clearProject,
    attachSession,
    updateSessionTitle,
    ensureActiveConnectionTabSet,
    reconcileSessions,
    loadActiveTabMessages,
  }
}

export const tabStore = createTabStore()
