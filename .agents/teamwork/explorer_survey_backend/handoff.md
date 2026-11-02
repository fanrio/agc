# Handoff Report: Backend Architecture & Data Model Survey

**Agent**: Backend Architecture & Data Model Explorer  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_backend`  
**Handoff Type**: Hard (Investigation complete)  
**Deliverable**: Comprehensive report at `report.md`  

---

## 1. Observation

1. **Database Schema & Projections**:
   - `Roles` in `db/schema.cds:63-77` and `srv/cortex_service.cds:18-21` currently has fields `name`, `type`, `description`, `critical`, `environment`, `orgNode`, `accessDomain` plus child compositions, but no target platform scoping field.
   - `AccessDomains` in `db/schema.cds:36-46` currently has `name`, `description`, `type`, `parent`, `children`, `attributes`, `restrictionFields`, `roleTemplateName`, but no target platform scoping field.
   - `BdcSettings` in `db/schema.cds:114-132` stores SAP Datasphere/HANA connection credentials (`systemName`, `connectionType`, `url`, `host`, `port`, `authType`, `space`, `username`, `password`, `tokenUrl`, `clientId`, `clientSecret`, `apiToken`, `taskChainFlat`, `isActive`).
   - `Replications` in `db/schema.cds:167-176` stores queued batch replication jobs with `status` (`Open`, `Running`, `Success`, `Failed`) and is projected in `srv/cortex_service.cds:30`.
   - `AppAuthorizations` in `db/schema.cds:153` defines `canManageReplications: Boolean @default: false;`.

2. **Entity Event Handlers & Replication Queue**:
   - `srv/handlers/assignmentHandlers.js`:
     - Line 182: `after CREATE` runs `syncAssignmentToHana(...)` in `cds.spawn` and calls `queueReplication(role.name, role.environment_ID, actorUser)`.
     - Lines 247 & 251: `after UPDATE` calls `queueReplication(...)`.
     - Line 276: `before DELETE` calls `queueReplication(...)` and line 299 runs `syncAssignmentToHana(..., isDelete=true)` in `cds.spawn`.
   - `srv/handlers/roleHandlers.js`:
     - Line 292: `after CREATE` calls `queueReplication(...)`.
     - Line 419: `after UPDATE` calls `queueReplication(...)` and line 431 runs `syncRoleAssignmentsToHana(id)` in `cds.spawn`.
     - Line 457: `before DELETE` calls `queueReplication(...)`.
     - Lines 475 & 503: `RoleInheritance` `after CREATE` and `after DELETE` call `syncRoleAssignmentsToHana(roleId)` in `cds.spawn`.
   - `srv/handlers/restrictionHandlers.js`:
     - Lines 124, 185, 228: calls `queueReplication(...)` on `after CREATE`, `after UPDATE`, and `before DELETE`.
   - `srv/services/dynamicSyncService.js`:
     - Lines 270, 369, 463, 488: calls `queueReplication(cds, Replications, ...)` for dynamic DRAGE rule sync.

3. **Replication Queue Engine & Actions**:
   - `srv/services/replicationQueueService.js`: Defines `queueReplication`, `checkAndUpdateRunningReplications`, and `makeTriggerReplicationHandler`.
   - `srv/cortex_service.cds:150-158`: Defines actions `action triggerReplication()` and `action checkReplicationStatuses()`.
   - `srv/cortex_service.js:230-238`: Wires `triggerReplication` and `checkReplicationStatuses`.

4. **HANA Replication & Critical Rule**:
   - `srv/services/hanaReplicationService.js:24-43`: `cartesianProduct(obj)` computes the combinatorial product across restriction fields.
   - `srv/services/hanaReplicationService.js:58-159`: `buildFlatAuthorizationsForHana` constructs flat authorization rows, appending numeric suffixes (`_1`, `_2`) if multiple combinations exist.
   - `srv/lib/resolveEffectiveRestrictions.js`: Recursively resolves parent and ancestor restrictions, discarding ancestor wildcards if overridden by descendants.
   - `srv/lib/hanaClient.js`: Contains `syncAssignment`, `createCustomFlatTable`, and `createCustomHierTable`.

5. **Test Suite Resources**:
   - `test/backend_tests.test.js:924-991`: Contains test 10 (`triggerReplication and checkReplicationStatuses triggers`) asserting queue transitions (`Open` -> `Running` -> `Success`) via mock Datasphere task chain endpoints.

---

## 2. Logic Chain

1. **Direct Synchronization vs Batch Queue (R1 & R3)**:
   - In the existing architecture, `syncAssignmentToHana` already executes direct SQL DML against HANA flat tables in `cds.spawn`.
   - The `queueReplication` mechanism and `Replications` table were exclusively used to queue external SAP Datasphere task chain triggers (`ts_authorization_flat`), which is now being retired.
   - Therefore, replacing `queueReplication` with a direct synchronization dispatcher (`directSyncDispatcher`) eliminates the intermediate queue, removes the need for `Replications`, and transitions synchronization to immediate real-time execution across target platforms.

2. **Multi-Target Platform Routing (R1)**:
   - Introducing `targetPlatform: TargetPlatform` (`DATASPHERE`, `DATABRICKS`, `BOTH`) on `Roles` and `AccessDomains` allows granular platform routing.
   - Defaulting `Roles.targetPlatform` to inherit from its `AccessDomain`, and defaulting to `'DATASPHERE'` if unspecified, guarantees zero regression for existing roles.
   - The sync dispatcher inspects `targetPlatform`: if it includes `DATASPHERE`, it invokes `hanaReplicationService`; if it includes `DATABRICKS`, it invokes `databricksSyncService`; if `BOTH`, it triggers both.

3. **Unity Catalog Policy Synchronization (R2)**:
   - In Databricks Unity Catalog, row filters must be defined via SQL DDL (`CREATE OR REPLACE FUNCTION ... RETURN <predicate>` and `ALTER TABLE ... SET ROW FILTER ...`).
   - The Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`) using a configured `sqlWarehouseId` provides full DDL execution capability.
   - All 11 filter types (`SINGLE_VALUE`, `MULTI_VALUE`, `RANGE`, `BT`, `CP`, `PATTERN`, `NE`, `GT`, `GE`, `LT`, `LE`, `NULL`, `NOT NULL`) translate directly to deterministic SQL boolean predicates combined with intra-role `AND` and user/role `OR` expressions matching `current_user()`.
   - In parallel, maintaining a synchronized authorization flat table (`<catalog>.<schema>.<domain>_flat_authorizations`) mirrors HANA's proven Cartesian product structure.

4. **Preservation of the Critical Replication Rule**:
   - `AGENTS.md` strictly forbids modifying the Cartesian product flattening or effective restriction resolution for HANA.
   - The direct sync dispatcher keeps `resolveEffectiveRestrictions` and `buildFlatAuthorizationsForHana` intact, merely decoupling them from `queueReplication`.

5. **Offline Testability (R5)**:
   - `DatabricksClient` utilizes a pluggable adapter pattern (`DatabricksClient.setAdapter(...)`) and `urlUtils.isMockUrl(...)` check, mirroring `HanaClient.setDriver(...)`.
   - This enables tests in `test/backend_tests.test.js` to execute completely offline without network or cloud accounts.

---

## 3. Caveats

1. **Table Names in Databricks**:
   In Unity Catalog, tables are addressed via a three-level namespace: `<catalog>.<schema>.<table>`. `DatabricksSettings` provides default `targetCatalog` and `targetSchema`. Target table names within an AccessDomain should match the AccessDomain's sanitized name (e.g. `sal_con_flat_authorizations`).
2. **Databricks SQL Warehouse Warm-up**:
   In live production environments, Databricks serverless or classic SQL warehouses may have a cold-start delay (10-30 seconds). Asynchronous execution inside `cds.spawn` ensures this never blocks the user's HTTP request.
3. **Database Migration with `cds deploy`**:
   Adding `DatabricksSettings` and adding columns to `Roles` and `AccessDomains` requires running `npx cds deploy` so SQLite schema tables are properly updated in development and test environments.

---

## 4. Conclusion

1. **Data Model**:
   - Add `TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; }`.
   - Add `targetPlatform` to `Roles` (default `'DATASPHERE'`) and `AccessDomains` (default `'BOTH'`).
   - Add `DatabricksSettings` (`ID`, `systemName`, `environment`, `workspaceUrl`, `authType`, `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive`).
   - Mark `Replications` and `canManageReplications` as `@deprecated`.
2. **Handler Trigger Architecture**:
   - Remove all calls to `queueReplication`.
   - Introduce `directSyncDispatcher` called from `assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js` in `cds.spawn`.
3. **Queue Decommissioning**:
   - Retire `replicationQueueService.js` and remove OData actions `triggerReplication` and `checkReplicationStatuses`.
4. **Databricks Policy Sync**:
   - Implement `DatabricksClient` using Databricks SQL Statement Execution API (`/api/2.0/sql/statements`) with pluggable mock adapter support.
   - Implement `databricksSyncService.js` translating restrictions into SQL row-filter expressions and managing flat authorization tables.
5. **Report**:
   - Detailed findings, code snippets, and migration matrix documented in `report.md`.

---

## 5. Verification Method

To verify these findings and proposed architecture independently:

1. **Inspect Schema & Service definitions**:
   - `db/schema.cds`: verify existing entity definitions for `Roles`, `AccessDomains`, `BdcSettings`, `Replications`.
   - `srv/cortex_service.cds`: verify OData projections and actions.
2. **Inspect Existing Replication Flow**:
   - Check `srv/handlers/assignmentHandlers.js` lines 180-185, 245-252, 275-278.
   - Check `srv/handlers/roleHandlers.js` lines 292, 419, 457.
   - Check `srv/services/replicationQueueService.js` lines 32-53, 62-144, 155-243.
3. **Validate Existing Backend Tests**:
   - Run `npm run test` from project root to verify baseline test runner passes.
4. **Inspect Generated Report**:
   - Read `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_backend\report.md`.
