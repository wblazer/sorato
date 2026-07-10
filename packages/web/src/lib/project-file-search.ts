import { ProjectsApi } from '$lib/connection-services.js'
import { Effect } from 'effect'

export function searchProjectFiles(projectId: string, query: string) {
  return Effect.gen(function* () {
    const projects = yield* ProjectsApi
    return yield* projects.searchFiles(projectId, query, 20)
  })
}
