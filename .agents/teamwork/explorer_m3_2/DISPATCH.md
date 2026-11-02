# Dispatch — Explorer M3-2 (Handlers & DRAGE Engine Wiring)

## Mission
Investigate and design event handler refactoring for Milestone 3 (Direct Real-Time Multi-Target Sync).

## Context & Inputs
- Authoritative request: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project specification: `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
- Agent rules & critical constraints: `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
- Assignment handlers: `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\assignmentHandlers.js`
- Role handlers: `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\roleHandlers.js`
- Restriction handlers: `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\restrictionHandlers.js`
- DRAGE dynamic sync service: `c:\Users\Fan\Documents\fanrio-auth\srv\services\dynamicSyncService.js`

## Key Questions & Analysis Scope
1. In `assignmentHandlers.js`:
   - Inspect `after CREATE`: currently calls `syncAssignmentToHana` in `cds.spawn` and `queueReplication`. How to replace with `directSyncDispatcher.dispatchAssignmentSync(...)` and completely remove `queueReplication`.
   - Inspect `after DELETE`: currently calls `syncAssignmentToHana` with `isDelete = true` and `queueReplication`. How to replace with `directSyncDispatcher.dispatchAssignmentRemoval(...)` and completely remove `queueReplication`.
2. In `roleHandlers.js`:
   - Inspect `after UPDATE`: currently calls `syncRoleAssignmentsToHana` in `cds.spawn` and `queueReplication`. How to replace with `directSyncDispatcher.dispatchRoleSync(...)` and completely remove `queueReplication`.
   - Inspect `RoleInheritance` handlers or derived role cascading: ensure changes in parent roles or inheritance trigger multi-target direct sync.
3. In `restrictionHandlers.js`:
   - Inspect `after CREATE`, `UPDATE`, `DELETE`: currently queues replication. How to trigger direct sync for the parent role via `directSyncDispatcher.dispatchRoleSync(...)` and remove `queueReplication`.
4. In `dynamicSyncService.js`:
   - How DRAGE batch generated assignments/roles should trigger direct sync instead of calling `queueReplication`.

## Output
Write your findings and implementation recommendation to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2\handoff.md`.
Report back when done via `send_message`.


## 2026-11-02T11:18:53Z
You are Explorer M3-2 for Milestone 3 (Handlers & DRAGE Engine Wiring).
Your working directory is `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2`.
You MUST read:
1. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
3. `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
4. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2\DISPATCH.md`
5. `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\assignmentHandlers.js`
6. `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\roleHandlers.js`
7. `c:\Users\Fan\Documents\fanrio-auth\srv\handlers\restrictionHandlers.js`
8. `c:\Users\Fan\Documents\fanrio-auth\srv\services\dynamicSyncService.js`

Investigate how to update event hooks:
- Replace `syncAssignmentToHana` & `queueReplication` in `assignmentHandlers.js` with direct sync dispatching on CREATE and DELETE.
- Replace `syncRoleAssignmentsToHana` & `queueReplication` in `roleHandlers.js` on role UPDATE and inheritance changes.
- Update `restrictionHandlers.js` to trigger direct role sync instead of queueReplication.
- Update `dynamicSyncService.js` to dispatch direct sync for generated roles/assignments.
- Ensure all calls run safely in `cds.spawn` non-blocking background contexts.

Deliver your comprehensive handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2\handoff.md`.
Communicate results back to parent via send_message. Do NOT write source code files.
