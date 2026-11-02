# Handoff Report — Explorer M2_3 (Databricks Policy Sync Service)

**Milestone**: Milestone 2 (Databricks Unity Catalog Policy Sync)  
**Author**: Explorer 3  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3`  
**Recipient**: Parent / Orchestrator (`73fff16a-762a-415c-9766-3f2b6b8bc4e4`) & Worker  

---

## 1. Observation

1. **Existing Pluggable Client Interface**:
   In `srv/lib/databricksClient.js:374-473` and `srv/lib/databricksMockAdapter.js:84-140`, `DatabricksClient.executeStatement(...)` and `DatabricksMockAdapter` already support executing and tracking SQL statements. Specifically, `DatabricksMockAdapter` regexes parse:
   - `CREATE [OR REPLACE] FUNCTION [IF NOT EXISTS] <name>(<params>) RETURN <expr>` (lines 85–101)
   - `DROP FUNCTION [IF EXISTS] <name>` (lines 104–110)
   - `ALTER TABLE <name> SET ROW FILTER <func> ON (<columns>)` (lines 113–131)
   - `ALTER TABLE <name> DROP ROW FILTER` (lines 133–140)
2. **Data Model & Schema**:
   In `db/schema.cds:142-154`, `DatabricksSettings` is defined with fields:
   `systemName`, `environment`, `workspaceUrl`, `authType` (`TOKEN`, `SERVICE_PRINCIPAL`), `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive`.
   In `db/schema.cds:5-9, 52, 76`, `TargetPlatform` enum (`DATASPHERE`, `DATABRICKS`, `BOTH`) exists on `Roles` and `AccessDomains`.
3. **HANA Replication Parallelism**:
   In `srv/services/hanaReplicationService.js:234-259, 273-361`, `syncAssignmentToHana` loads ancestry via `fetchRoleAncestryChain`, resolves restrictions via `resolveEffectiveRestrictions`, flattens rows to custom flat tables `${cleanAccessDomainName}_flat_authorizations`, and is called asynchronously inside `cds.spawn` in `assignmentHandlers.js:178-186`.
4. **Target Naming & Lifecycle Requirements**:
   In `TEST_INFRA.md:86-125` and `test/e2e_direct_sync.test.js:293-318, 1068-1153`:
   - Target table format: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations`.
   - Filter function format: `<catalog>.<schema>.fn_filter_<domain_sanitized>`.
   - A table can have only one row filter; multiple users assigned to the table are joined with `OR` and prefixed with `is_account_group_member('admin') OR`.
   - Revoking all users from a table drops the row filter (`ALTER TABLE ... DROP ROW FILTER`) and drops the function (`DROP FUNCTION IF EXISTS ...`).
5. **Existing Client Tests Status**:
   Running `node --test test/databricks_client.test.js` executed 24 tests across 6 suites with 24 pass, 0 fail.

---

## 2. Logic Chain

1. **Target Separation based on TargetPlatform** (from Observation 2):
   When `syncAssignmentToDatabricks`, `syncRoleToDatabricks`, or `syncAccessDomainToDatabricks` is called, the target platform must be inspected. If `role.targetPlatform === 'DATASPHERE'`, Databricks synchronization must immediately exit without executing statements. If `DATABRICKS` or `BOTH`, Databricks synchronization proceeds.
2. **Dynamic Composite Policy Generation vs Cartesian Product** (from Observation 1 & 4):
   Unlike SAP Datasphere which writes a Cartesian product of restriction rows to a flat table, Databricks Unity Catalog restricts rows via SQL functions attached to tables. Because Databricks allows only one row filter per table, the service must aggregate all users assigned to roles targeting the same access domain and synthesize a composite SQL UDF returning:
   `is_account_group_member('admin') OR (current_user() = 'alice' AND (...)) OR (current_user() = 'bob' AND (...))`.
3. **Assignment Revocation & Table Cleanliness** (from Observation 1 & 4):
   When `removeAssignmentFromDatabricks` is triggered, the remaining active assignments for that access domain are queried.
   - If other users remain: the function is updated with the remaining users via `CREATE OR REPLACE FUNCTION`.
   - If 0 users remain: the row filter must be detached via `ALTER TABLE ... DROP ROW FILTER` and the function deleted via `DROP FUNCTION IF EXISTS`, matching `DatabricksMockAdapter` tracking.
4. **Settings & Naming Independence** (from Observation 2 & 4):
   `resolveDatabricksSettings(environmentId, cds)` selects the active settings for the role's environment, falling back to the active default. Catalog and schema default to `main` and `fanrio_auth` if unspecified. Access domain names are sanitized via `sanitizeDomainName` (`toLowerCase().replace(/[^a-z0-9_]/g, '_')`).
5. **Testability & Non-Regression** (from Observation 1 & 5):
   By delegating all statement execution to `DatabricksClient.executeStatement(...)`, unit and integration tests run 100% offline using `DatabricksMockAdapter` without requiring live cloud credentials.

---

## 3. Caveats

1. **Event Handler Wiring (Milestone 3)**:
   This explorer report covers the architecture and implementation of `srv/services/databricksSyncService.js` (Milestone 2). Event hooks in `srv/handlers/assignmentHandlers.js` and `srv/handlers/roleHandlers.js` will wire into `directSyncDispatcher.js` in Milestone 3. However, `databricksSyncService.js` is designed so it can be called directly or via dispatcher.
2. **Databricks SQL Warehouse DDL Latency**:
   In live environments (unlike in-memory mock), SQL statement execution may take 1–3 seconds. Therefore, when invoked from event handlers, execution should remain asynchronous inside `cds.spawn`.
3. **Empty Domain Handling**:
   If a role does not belong to any Access Domain (`accessDomain_ID == null`), the naming falls back to `global` (`global_flat_authorizations` and `fn_filter_global`).

---

## 4. Conclusion

`srv/services/databricksSyncService.js` is fully specified and ready for immediate implementation by the Worker.
The design delivers:
- All 4 required service functions: `syncRoleToDatabricks`, `syncAssignmentToDatabricks`, `syncAccessDomainToDatabricks`, `removeAssignmentFromDatabricks`.
- Full resolution of `DatabricksSettings` and sanitized target naming (`<catalog>.<schema>.<domain>_flat_authorizations`, `<catalog>.<schema>.fn_filter_<domain>`).
- Full support for all 11 filter types with SQL character escaping.
- Composite multi-user Boolean predicate generation with administrative bypass.
- Complete drop-in code in `report.md` (Section 5) and companion test suite in `report.md` (Section 6).

---

## 5. Verification Method

1. **Verify Report Existence & Completeness**:
   Inspect `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3\report.md`.
2. **Verify Client Test Baseline**:
   Run:
   ```powershell
   node --test test/databricks_client.test.js
   ```
   Must pass with 24/24 passing tests.
3. **Worker Implementation Verification**:
   After Worker writes `srv/services/databricksSyncService.js` and `test/databricks_sync.test.js`, run:
   ```powershell
   node --test test/databricks_sync.test.js
   ```
   All unit and integration tests must pass.
4. **Invalidation Conditions**:
   - If `DatabricksMockAdapter` fails to record `CREATE OR REPLACE FUNCTION` or `ALTER TABLE ... SET ROW FILTER`, check SQL string spacing.
   - If single quotes in user IDs or filter values cause SQL syntax errors, verify `escapeSqlString` is applied.
