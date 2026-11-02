# Dispatch — Worker M3 (Direct Real-Time Multi-Target Sync & Queue Retirement)

## Mission
Implement Milestone 3 (Direct Real-Time Multi-Target Sync Dispatcher & Event Handlers Wiring) based on the synthesized designs of Explorers M3-1, M3-2, and M3-3.

## Context & Inputs
- Authoritative request: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project specification: `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
- Agent rules & critical constraints: `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
- Explorer M3-1 Report: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1\handoff.md`
- Explorer M3-2 Report: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2\handoff.md`
- Explorer M3-3 Report: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3\handoff.md`

## Files to Create / Modify
1. Create `srv/services/directSyncDispatcher.js`:
   - Implement `resolveEffectivePlatform(role, domain)`.
   - Implement `dispatchAssignmentSync({ assignmentId, userId, roleId, isDelete, cds, forcedDomainId })`.
   - Implement `dispatchAssignmentRemoval({ assignmentId, userId, roleId, cds, forcedDomainId })`.
   - Implement `dispatchRoleSync(roleId, cds)`.
   - Implement `dispatchAccessDomainSync(accessDomainId, cds)`.
   - Implement `dispatchSync({ action, targetPlatform, roleId, userId, restrictions, ... })` - universal contract for E2E tests (Test T1.7).
   - Domain-level Promise mutex to serialize Databricks DDL operations per domain.
   - Fault-tolerant multi-target execution with `Promise.allSettled`.
   - CRITICAL REPLICATION RULE: Delegate to `hanaReplicationService.syncAssignmentToHana` and `syncRoleAssignmentsToHana` for Datasphere/HANA, strictly preserving Cartesian product flattening and effective restriction resolution.
   - Delegate to `databricksSyncService.syncAssignmentToDatabricks`, `syncRoleToDatabricks`, `removeAssignmentFromDatabricks`, `syncAccessDomainToDatabricks` for Databricks.
2. Update `srv/handlers/assignmentHandlers.js`:
   - On CREATE and DELETE, call `directSyncDispatcher` in `cds.spawn({ user: req?.user })`.
   - Remove all calls and imports of `queueReplication`.
3. Update `srv/handlers/roleHandlers.js`:
   - On role UPDATE and `RoleInheritance` CREATE/DELETE, call `directSyncDispatcher.dispatchRoleSync` in `cds.spawn`.
   - Remove all calls and imports of `queueReplication`.
4. Update `srv/handlers/restrictionHandlers.js`:
   - On restriction CREATE, UPDATE, DELETE, call `directSyncDispatcher.dispatchRoleSync` in non-blocking `cds.spawn`.
   - Remove all calls and imports of `queueReplication`.
5. Update `srv/services/dynamicSyncService.js`:
   - Replace `queueReplication` with direct sync calls.
   - Remove `queueReplication` import.
6. Update `srv/cortex_service.cds`:
   - Annotate `Replications` projection with `@deprecated: 'Replaced by real-time direct sync'`.
   - Annotate `triggerReplication` and `checkReplicationStatuses` actions with `@deprecated: 'Replaced by real-time direct sync'`.
7. Update `srv/cortex_service.js`:
   - Wire `directSyncDispatcher`.
   - Retain backward-compatible action wrappers for `triggerReplication` and `checkReplicationStatuses` returning `{ success: true, message: 'Direct sync active; replication queue retired' }` with deprecation notice logging so existing test suites do not break prematurely before Milestone 5.
8. Create `test/direct_sync_dispatcher.test.js`:
   - Comprehensive test suite covering platform resolution, routing to HANA only, Databricks only, and both, concurrency mutex, and error resilience.

## Mandatory Anti-Cheating Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
- Run `node --test test/direct_sync_dispatcher.test.js`
- Run full backend test suite: `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/*.test.js` (or `npm run test`)
- Run frontend build: `npm run build --prefix app/catalog`
- Document all commands, line changes, and output in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m3\handoff.md`.


## 2026-11-02T11:28:26Z
You are Worker M3 for Milestone 3 (Direct Multi-Target Sync Dispatcher & Queue Retirement).
Your working directory is `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m3`.
