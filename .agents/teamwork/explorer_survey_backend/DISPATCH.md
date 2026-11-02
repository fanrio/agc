# DISPATCH: Backend Architecture & Data Model Survey
Read ORIGINAL_REQUEST.md at c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
Read .agents/AGENTS.md for architecture rules.
Investigate backend schema, services, handlers, Databricks Unity Catalog sync, and settings.
Write full report to report.md.
## 2026-11-01T20:33:24Z
Sender: 73fff16a-762a-415c-9766-3f2b6b8bc4e4 (parent)
Priority: MESSAGE_PRIORITY_HIGH

You are the Backend Architecture & Data Model Explorer for the fanrio-auth project.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_backend

You MUST read the authoritative user request at:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
and the project guide at:
c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Your task is to conduct a thorough code-level survey of the backend:
1. Examine `db/schema.cds` and `srv/cortex_service.cds`:
   - Inspect how `Roles`, `RoleAssignments`, `Streams` (Access Domains), `BdcSettings`, and `Replications` are defined.
   - Determine how `targetPlatform` enum/string (`DATASPHERE`, `DATABRICKS`, `BOTH`) should be added to `Roles` and `Streams` (defaulting to `DATASPHERE` or `BOTH` as appropriate).
   - Determine the data model for `DatabricksSettings` (workspaceUrl, apiToken, targetCatalog, targetSchema, sqlWarehouseId, etc.) in `db/schema.cds` and `srv/cortex_service.cds`.
   - Determine how `Replications` entity should be cleanly retired/removed or marked deprecated without breaking DB integrity. Remember the rule: `cds deploy` is used for schema migrations.
2. Examine `srv/handlers/roleHandlers.js` & `srv/handlers/assignmentHandlers.js`:
   - Trace how role creation/update/deletion and assignment creation/deletion currently queue replications via `replicationQueueService.js` and call `syncAssignmentToHana`.
   - Design the direct real-time synchronization trigger architecture: when an assignment or role changes, how to immediately trigger direct synchronization to the configured target platform(s) (`DATASPHERE` -> HANA flat table; `DATABRICKS` -> Databricks Unity Catalog; `BOTH` -> both).
3. Examine `srv/services/replicationQueueService.js` and `srv/services/hanaReplicationService.js`:
   - Note the CRITICAL REPLICATION RULE from AGENTS.md: Cartesian product & effective restriction resolution MUST be preserved for Datasphere/HANA.
   - Plan how `replicationQueueService.js` should be replaced / decommissioned, ensuring no background task-chain polling or orphaned replication queue states remain.
4. Investigate Databricks Unity Catalog Policy Synchronization:
   - How restrictions (SINGLE_VALUE, MULTI_VALUE, RANGE, BT, PATTERN) translate into Unity Catalog SQL row-level filter expressions (e.g. `CREATE OR REPLACE FUNCTION filter_func(col STRING) RETURN col = 'X' ... ALTER TABLE ... SET ROW FILTER ...`).
   - How column masks or grants can be mapped if needed.
   - REST API endpoints vs SQL Warehouse statement execution for Databricks Unity Catalog.
5. Identify all touchpoints in `srv/` and `srv/services/` that need updates.

Write your comprehensive findings and recommendations into:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_backend\report.md

When complete, send a message to parent summarizing your findings and referencing the report path.
