# Dispatch — Explorer M3-1 (Direct Sync Dispatcher Design)

## Mission
Investigate and design `srv/services/directSyncDispatcher.js` for Milestone 3 (Direct Real-Time Multi-Target Sync).

## Context & Inputs
- Authoritative request: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project specification: `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
- Agent rules & critical constraints: `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
- Databricks sync implementation: `c:\Users\Fan\Documents\fanrio-auth\srv\services\databricksSyncService.js`
- HANA replication implementation: `c:\Users\Fan\Documents\fanrio-auth\srv\services\hanaReplicationService.js`

## Key Questions & Analysis Scope
1. How `directSyncDispatcher` should inspect `targetPlatform` on `Roles` (`DATASPHERE`, `DATABRICKS`, `BOTH`) and `AccessDomains`.
2. For DATASPHERE/BOTH: how to invoke HANA replication (`syncAssignmentToHana`, `syncRoleAssignmentsToHana`) while strictly preserving the Critical Replication Rule (Cartesian product flattening and effective restriction resolution).
3. For DATABRICKS/BOTH: how to invoke Databricks sync (`syncAssignmentToDatabricks`, `syncRoleToDatabricks`, `removeAssignmentFromDatabricks`).
4. What parameter signature and return values `dispatchAssignmentSync`, `dispatchAssignmentRemoval`, and `dispatchRoleSync` should provide.
5. Error handling, logging, and concurrency considerations within `cds.spawn`.

## Output
Write your findings and implementation recommendation to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1\handoff.md`.
Report back when done via `send_message`.


## 2026-11-02T11:18:53Z
You are Explorer M3-1 for Milestone 3 (Direct Multi-Target Sync Dispatcher).
Your working directory is `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1`.
You MUST read:
1. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
3. `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`
4. `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1\DISPATCH.md`
5. `c:\Users\Fan\Documents\fanrio-auth\srv\services\databricksSyncService.js`
6. `c:\Users\Fan\Documents\fanrio-auth\srv\services\hanaReplicationService.js`

Analyze and design `srv/services/directSyncDispatcher.js`:
- Inspect role and access domain `targetPlatform` (`DATASPHERE`, `DATABRICKS`, `BOTH`).
- Route to HANA (`syncAssignmentToHana`, `syncRoleAssignmentsToHana`) preserving the critical Cartesian product rule.
- Route to Databricks (`syncAssignmentToDatabricks`, `syncRoleToDatabricks`, `removeAssignmentFromDatabricks`).
- Provide concrete method signatures for assignment sync, removal, and role sync.
- Provide error handling, logging, and concurrency strategies.

Deliver your comprehensive handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1\handoff.md`.
Communicate results back to parent via send_message. Do NOT write source code files.
