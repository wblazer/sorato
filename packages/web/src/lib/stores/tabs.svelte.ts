import type { AppTab, Session } from '$lib/types.js'
import { messagesStore } from './messages.svelte.js'

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
  let tabs = $state<AppTab[]>([newTab()])
  let activeTabId = $state(tabs[0]?.id ?? '')

  const activeTab = $derived(
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null
  )

  function setActiveTab(id: string) {
    activeTabId = id
    const tab = tabs.find((item) => item.id === id)
    if (tab?.sessionId) void messagesStore.loadMessages(tab.sessionId)
    if (!tab?.sessionId) messagesStore.clear()
  }

  function openNewTab() {
    const tab = newTab()
    tabs = [...tabs, tab]
    activeTabId = tab.id
    messagesStore.clear()
  }

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = tabs.filter((tab) => tab.id !== id)
    tabs = next.length > 0 ? next : [newTab()]
    if (activeTabId === id) {
      const replacement = tabs[Math.max(0, index - 1)] ?? tabs[0]
      if (replacement) setActiveTab(replacement.id)
    }
  }

  function setDraftProject(tabId: string, projectId: string | null) {
    tabs = tabs.map((tab) =>
      tab.id === tabId ? { ...tab, projectId, updatedAt: Date.now() } : tab
    )
  }

  function attachSession(tabId: string, session: Session) {
    tabs = tabs.map((tab) =>
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
    )
  }

  function updateSessionTitle(sessionId: string, title: string | null) {
    tabs = tabs.map((tab) =>
      tab.sessionId === sessionId
        ? { ...tab, title, updatedAt: Date.now() }
        : tab
    )
  }

  return {
    get tabs() {
      return tabs
    },
    get activeTabId() {
      return activeTabId
    },
    get activeTab() {
      return activeTab
    },
    setActiveTab,
    openNewTab,
    closeTab,
    setDraftProject,
    attachSession,
    updateSessionTitle,
  }
}

export const tabStore = createTabStore()
