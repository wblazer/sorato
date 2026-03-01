export interface Session {
  id: string
  directory: string
  title: string | null
  headId: string | null
  createdAt: number
  updatedAt: number
}
