# BRIEFING — 2026-11-02T12:26:00Z

## Mission
Investigate and design the retirement of the replication queue engine and service cleanup for Milestone 3.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Investigator, Synthesizer
- Working directory: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3
- Original parent: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Milestone: Milestone 3 (Queue Engine Retirement & Service Cleanup)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement / do NOT modify source code files
- Only write within c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3
- Follow 5-Component Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- Communicate results back to parent via send_message

## Current Parent
- Conversation ID: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Updated: 2026-11-02T12:26:00Z

## Investigation State
- **Explored paths**:
  - `srv/cortex_service.cds` (Replications projection, triggerReplication, checkReplicationStatuses)
  - `srv/cortex_service.js` (Action bindings, boundQueueReplication, handlerDeps)
  - `srv/services/replicationQueueService.js` (queueReplication, checkAndUpdateRunningReplications, makeTriggerReplicationHandler)
  - `srv/handlers/assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js` (queueReplication calls in CRUD hooks)
  - `srv/services/dynamicSyncService.js` (DRAGE queueReplication calls)
  - `srv/handlers/systemHandlers.js` (canManageReplications checks)
  - `test/backend_tests.test.js`, `test/auth_enforcement.test.js`, `test/e2e_direct_sync.test.js` (Replications & queue test coverage)
- **Key findings**:
  - `queueReplication` is imported and called across 5 files: `cortex_service.js`, `assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js`.
  - All `queueReplication` invocations must be eliminated in M3 in favor of direct sync dispatching (`directSyncDispatcher.js`).
  - `triggerReplication` and `checkReplicationStatuses` actions are currently tested by `backend_tests.test.js` (L1070-1136) and `auth_enforcement.test.js` (L162-185).
  - Hard-deleting these actions in M3 would prematurely fail these tests before M5.
  - A two-phase migration plan is required: In M3, decouple all CRUD events from `queueReplication`, annotate actions & `Replications` entity with `@deprecated`, and retain backward-compatible deprecation handlers; in M5, replace obsolete assertions with direct sync assertions and hard-remove the actions and `replicationQueueService.js`.
  - The DB entity `Replications` in `db/schema.cds` must be kept intact for schema stability and migration safety.
- **Unexplored areas**: None. Comprehensive codebase scan complete.

## Key Decisions Made
- Recommend 2-Phase Deprecation Strategy: M3 wiring severance + `@deprecated` annotations; M5 test suite replacement + hard removal.
- Annotate `Replications` entity in `srv/cortex_service.cds` with `@deprecated: 'Replaced by real-time direct sync'`.
- Decommission `replicationQueueService.js` in M3 by marking it deprecated, and delete it in M5.

## Artifact Index
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\DISPATCH.md` — Inbound instructions and dispatch history
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\BRIEFING.md` — Situational awareness and working memory
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\progress.md` — Liveness heartbeat
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\handoff.md` — Comprehensive 5-component handoff report
