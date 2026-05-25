import type { Project } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { modelsStore } from './models.svelte.js'

function createProjectStore() {
  let projects = $state<Project[]>([])
  let selectedProjectId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function fetchProjects() {
    loading = true
    error = null
    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/projects`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      projects = await res.json()
      if (!selectedProjectId && projects.length > 0) {
        selectedProjectId = projects[0]?.id ?? null
      }
      if (selectedProjectId) void modelsStore.load(selectedProjectId)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to fetch projects'
    } finally {
      loading = false
    }
  }

  async function createLocalProject(path: string): Promise<Project | null> {
    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'local-directory', path }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const project: Project = await res.json()
      projects = [project, ...projects]
      selectProject(project.id)
      return project
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create project'
      return null
    }
  }

  function selectProject(id: string | null) {
    selectedProjectId = id
    if (id) void modelsStore.load(id)
  }

  function getProject(id: string | null): Project | null {
    if (!id) return null
    return projects.find((project) => project.id === id) ?? null
  }

  return {
    get projects() {
      return projects
    },
    get selectedProjectId() {
      return selectedProjectId
    },
    get selectedProject() {
      return getProject(selectedProjectId)
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    fetchProjects,
    createLocalProject,
    selectProject,
    getProject,
  }
}

export const projectStore = createProjectStore()
