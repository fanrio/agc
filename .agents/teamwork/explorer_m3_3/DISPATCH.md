# Dispatch — Explorer M3-3 (Queue Retirement & Service Projections)

## Mission
Investigate and design the retirement of the replication queue engine and OData cleanup for Milestone 3.

## Context & Inputs
- Authoritative request: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project specification: `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
- Agent rules & critical constraints: `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
- OData service definitions: `c:\Users\Fan\Documents\fanrio-auth\srv\cortex_service.cds`
- CAP service wiring: `c:\Users\Fan\Documents\fanrio-auth\srv\cortex_service.js`
- Replication queue service: `c:\Users\Fan\Documents\fanrio-auth\srv\services\replicationQueueService.js`
- Tests referencing replication queue: check `test/backend_tests.test.js`, `test/auth_enforcement.test.js`

## Key Questions & Analysis Scope
1. In `srv/cortex_service.cds`:
   - Identify obsolete actions: `triggerReplication`, `checkReplicationStatuses`. How to deprecate or remove them cleanly.
   - Entity `Replications`: how to annotate with `@deprecated: 'Replaced by real-time direct sync'` without breaking existing DB schema or migrations.
2. In `srv/cortex_service.js`:
   - Inspect registration and calls to `triggerReplicationHandler` and `checkAndUpdateRunningReplications`.
   - How to safely remove these action bindings while maintaining stub responses if legacy clients call them, or removing them cleanly per `ORIGINAL_REQUEST.md`.
3. In `srv/services/replicationQueueService.js`:
   - Determine which functions are safe to decommission and whether any helpers are still needed anywhere.
4. Scan entire codebase for imports/references to `queueReplication` and `replicationQueueService.js`.

## Output
Write your findings and implementation recommendation to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\handoff.md`.
Report back when done via `send_message`.


## 2026-11-02T11:18:53Z
You are Explorer M3-3 for Milestone 3 (Queue Engine Retirement & Service Cleanup).
Your working directory is `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3`.
You MUST read:
1. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
3. `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
4. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\DISPATCH.md`
5. `c:\Users\Fan\Documents\fanrio-auth\srv\cortex_service.cds`
6. `c:\Users\Fan\Documents\fanrio-auth\srv\cortex_service.js`
7. `c:\Users\Fan\Documents\fanrio-auth\srv\services\replicationQueueService.js`

Investigate how to retire the replication queue engine:
- Identify and plan deprecation/removal of `triggerReplication` and `checkReplicationStatuses` in `cortex_service.cds` and `cortex_service.js`.
- Annotate `Replications` entity with `@deprecated: 'Replaced by real-time direct sync'` while keeping DB entity intact for migration safety.
- Scan codebase for any remaining imports/calls to `queueReplication` and `replicationQueueService.js`.
- Specify migration plan so existing tests won't break prematurely before Milestone 5.

Deliver your comprehensive handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\handoff.md`.
Communicate results back to parent via send_message. Do NOT write source code files.
