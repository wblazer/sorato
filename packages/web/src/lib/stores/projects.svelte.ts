import { ProjectsApi } from '$lib/connection-services.js'
import { runConnectionPromise } from '$lib/connection-runtime.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { Project } from '$lib/types.js'
import { Effect } from 'effect'
import { modelsStore } from './models.svelte.js'

function createProjectStore() {
  let projects = $state<Project[]>([])
  let selectedProjectId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  function fetchProjects() {
    const clearLoading = Effect.sync(() => {
      loading = false
    })

    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        loading = true
        error = null
      })

      const projectsApi = yield* ProjectsApi
      const result = yield* projectsApi.list()

      yield* Effect.sync(() => {
        projects = [...result]
        if (!selectedProjectId && projects.length > 0) {
          selectedProjectId = projects[0]?.id ?? null
        }
        if (selectedProjectId) {
          void runConnectionPromise(modelsStore.load(selectedProjectId))
        }
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
        })
      ),
      Effect.ensuring(clearLoading)
    )
  }

  function createLocalProject(path: string) {
    return Effect.gen(function* () {
      const projectsApi = yield* ProjectsApi
      const project = yield* projectsApi.create(path)

      return yield* Effect.sync(() => {
        const created: Project = project
        projects = [created, ...projects]
        selectProject(created.id)
        return created
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const failedProject = null
          error = cause.message
          return failedProject
        })
      )
    )
  }

  function selectProject(id: string | null) {
    selectedProjectId = id
    if (id) void runConnectionPromise(modelsStore.load(id))
  }

  function archiveProject(id: string, archiveSessions: boolean) {
    return Effect.gen(function* () {
      const projectsApi = yield* ProjectsApi
      yield* projectsApi.archive(id, archiveSessions)

      return yield* Effect.sync(() => {
        projects = projects.filter((project) => project.id !== id)
        if (selectedProjectId === id) {
          const nextProject = projects[0] ?? null
          selectProject(nextProject?.id ?? null)
        }
        return true
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
          return false
        })
      )
    )
  }

  function getProject(id: string | null): Project | null {
    const missingProject = null
    if (!id) return missingProject
    return projects.find((project) => project.id === id) ?? missingProject
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
    archiveProject,
    selectProject,
    getProject,
  }
}

export const projectStore = createProjectStore()
