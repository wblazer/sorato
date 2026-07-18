// Migration 003 was reshaped during development. Reapplying its idempotent DDL
// lets databases that observed the earlier shape converge without a reset.
export { default } from './003-durable-sync-events.ts'
