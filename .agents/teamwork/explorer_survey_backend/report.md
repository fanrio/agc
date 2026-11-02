# Backend Architecture & Data Model Survey Report

**Project**: `fanrio-auth` — SAP BDC & Databricks Authorization Management  
**Explorer Role**: Backend Architecture & Data Model Explorer  
**Date**: November 1, 2026  
**Status**: Investigation Complete  
**Related Documents**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`, `c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md`

---

## Executive Summary

The `fanrio-auth` application manages role-based access control and flattens multi-dimensional restriction rules for target analytics platforms. Currently, authorization replication relies on an asynchronous batch queue (`Replications` entity, `replicationQueueService.js`), which requires manual or scheduled execution of SAP Datasphere (BDC) task chains, even though the low-level SAP HANA database synchronization (`syncAssignmentToHana`) already executes directly.

This investigation establishes a comprehensive architectural blueprint to:
1. **Extend data models** in `db/schema.cds` and `srv/cortex_service.cds` to support **Multi-Target Platform Selection** (`targetPlatform`: `'DATASPHERE'`, `'DATABRICKS'`, `'BOTH'`) on Roles and Access Domains, and introduce **`DatabricksSettings`** for workspace and SQL warehouse connectivity.
2. **Decommission the asynchronous replication queue engine** (`Replications` entity, `replicationQueueService.js`, BDC task chain triggers and polling) cleanly and without breaking database integrity.
3. **Establish a direct real-time synchronization trigger architecture** across entity CRUD event hooks (`assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`), preserving the non-negotiable **Cartesian Product and Effective Restriction Resolution logic** for SAP HANA while adding real-time policy synchronization for Databricks Unity Catalog.
4. **Define the Databricks Unity Catalog Policy Synchronization Engine**, mapping all `fanrio-auth` restriction filter types into deterministic SQL row-filter predicates and synchronized flat authorization tables via Databricks SQL Statement Execution API.
5. **Establish a pluggable offline mock adapter architecture** ensuring unit and integration tests run offline without live Databricks or SAP cloud infrastructure.

---

## 1. CDS Schema & Service Projections (`db/schema.cds`, `srv/cortex_service.cds`)

### 1.1 Existing State Analysis
- **`Roles` (`db/schema.cds:63-77`)**: Has fields `ID`, `name`, `type` (`ORG_BASED | DERIVED | SINGLE`), `description`, `critical`, `environment`, `orgNode`, `accessDomain`, compositions for `parentRoles`, `childRoles`, `ownRestrictions`, `assignments`, `approvers`. Currently lacks target platform scoping.
- **`AccessDomains` (`db/schema.cds:36-46`)**: Represents access domains / streams (e.g. `SAL_CON`). Has fields `ID`, `name` (max 10 chars), `description`, `type`, `parent`, `children`, `attributes`, `restrictionFields`, `roleTemplateName`. Lacks target platform scoping.
- **`BdcSettings` (`db/schema.cds:114-132`)**: Configures connection to Datasphere/HANA. Contains `systemName`, `connectionType` (`OData | SAP Hana`), `environment`, `url`, `host`, `port`, `authType`, `space`, `username`, `password`, `tokenUrl`, `clientId`, `clientSecret`, `apiToken`, `taskChainFlat`, `isActive`.
- **`Replications` (`db/schema.cds:167-176`)**: Represents queued batch replication runs. Contains `cuid`, `replicationDate`, `status` (`Open`, `Running`, `Success`, `Failed`), `replicationRoles`, `environment`, `startTime`, `endTime`, `user`, `runId`.
- **`AppAuthorizations` (`db/schema.cds:142-161`)**: Stores per-user application permission flags, including `canManageReplications` (line 153).

### 1.2 Multi-Target Platform Selection Modeling (`targetPlatform`)
To support R1, both `Roles` and `AccessDomains` must support selecting `DATASPHERE`, `DATABRICKS`, or `BOTH`.

#### Type Definition in `db/schema.cds`:
```cds
type TargetPlatform : String(20) enum {
  DATASPHERE = 'DATASPHERE';
  DATABRICKS = 'DATABRICKS';
  BOTH       = 'BOTH';
};
```

#### Field Addition to `Roles`:
```cds
entity Roles : managed {
  key ID          : String(36)  @default : 'uuid()';
  name            : String(200) not null;
  type            : String(20)  not null;  // ORG_BASED | DERIVED | SINGLE | DRAGE
  description     : String(500);
  critical        : Boolean @default : false;
  targetPlatform  : TargetPlatform @default : 'DATASPHERE'; // DATASPHERE | DATABRICKS | BOTH
  environment     : Association to Environments;
  orgNode         : Association to OrgNodes;
  accessDomain    : Association to AccessDomains;
  // ... compositions
}
```

#### Field Addition to `AccessDomains`:
```cds
entity AccessDomains : managed {
  key ID            : String(36);
  name              : String(10) not null;
  description       : String(200);
  targetPlatform    : TargetPlatform @default : 'BOTH'; // Default for domain templates
  type              : Association to RestrictionFields;
  parent            : Association to AccessDomains;
  children          : Composition of many AccessDomains on children.parent = $self;
  attributes        : Composition of many AccessDomainAttributes on attributes.node = $self;
  restrictionFields : Composition of many AccessDomainFields on restrictionFields.domain = $self;
  roleTemplateName  : String(255);
}
```

#### Inheritance & Defaulting Rule:
1. If a role specifies an explicit `targetPlatform`, that value takes precedence.
2. If `targetPlatform` is omitted or null on role creation, the role inherits `targetPlatform` from its parent `accessDomain`.
3. If neither specifies it (e.g. legacy records), it defaults to `'DATASPHERE'` to guarantee 100% backward compatibility.

### 1.3 Databricks Settings Data Model (`DatabricksSettings`)
To support R4, administrators need to configure connection parameters for Databricks workspaces and SQL Warehouses.

#### Model in `db/schema.cds`:
```cds
entity DatabricksSettings : managed {
  key ID         : String(36) @default : 'uuid()';
  systemName     : String(100) not null;                        // e.g. 'Databricks AWS Prod'
  environment    : Association to Environments;                // 'D' | 'Q' | 'P'
  workspaceUrl   : String(255) not null;                        // e.g. 'https://adb-123456789.azuredatabricks.net'
  authType       : String(50)  @default : 'TOKEN';              // 'TOKEN' | 'OAUTH_M2M'
  apiToken       : String(500) @UI.Hidden;                      // PAT or Bearer token
  clientId       : String(100);                                 // Optional: OAuth M2M Client ID
  clientSecret   : String(255) @UI.Hidden;                      // Optional: OAuth M2M Secret
  targetCatalog  : String(100) not null;                        // Unity Catalog catalog (e.g. 'main')
  targetSchema   : String(100) @default : 'default';            // Unity Catalog schema
  sqlWarehouseId : String(100) not null;                        // SQL Warehouse ID for Statement Execution API
  isActive       : Boolean @default : true;
}
```

#### Service Projection in `srv/cortex_service.cds`:
```cds
entity DatabricksSettings as projection on db.DatabricksSettings;

action testDatabricksConnection(settingId: UUID) returns {
  success : Boolean;
  message : String;
};
```

#### Seed File Requirement:
Create `db/data/fanrio.auth-DatabricksSettings.csv`:
```csv
ID,systemName,environment_ID,workspaceUrl,authType,apiToken,clientId,clientSecret,targetCatalog,targetSchema,sqlWarehouseId,isActive
default-databricks,Databricks Dev Workspace,D,https://mock-databricks.fanrio.corp,TOKEN,mock-token-databricks,,,dev_catalog,auth_policies,mock-warehouse-01,true
```

### 1.4 Clean Retirement & Migration Strategy for `Replications`
Rule from `AGENTS.md`: `cds deploy` is used for schema migrations in SQLite (`sqlite.db`).

#### Deprecation & Retirement Steps:
1. **Database Schema (`db/schema.cds`)**:
   Mark entity as deprecated, keeping table structure intact or removing after updating all dependencies:
   ```cds
   @deprecated: 'Replication queue is decommissioned in favor of direct real-time sync'
   entity Replications : cuid {
     replicationDate  : DateTime;
     status           : String(20) not null;
     replicationRoles : String(1000) not null;
     environment      : Association to Environments;
     startTime        : DateTime;
     endTime          : DateTime;
     user             : String(200);
     runId            : String(100);
   }
   ```
2. **OData Service Exposure (`srv/cortex_service.cds`)**:
   - Remove `entity Replications as projection on db.Replications;` (or mark `@readonly @deprecated`).
   - Remove actions: `action triggerReplication()` and `action checkReplicationStatuses()`.
3. **Seed File (`db/data/fanrio.auth-Replications.csv`)**:
   Keep header-only with 0 rows so `cds deploy` generates/clears cleanly.
4. **AppAuthorizations (`db/schema.cds`)**:
   Retain `canManageReplications: Boolean @default: false;` in the schema for backward compatibility so existing user permission payloads and test suites do not break with missing properties, but mark it `@deprecated`. Settings for Databricks and direct sync will be governed by `canManageSettings`.
5. **Run `npx cds deploy`**:
   Regenerates SQLite schema cleanly.

---

## 2. Event Handlers & Real-Time Sync Trigger Architecture

### 2.1 Current Event Flow Analysis

| Entity | Event | Current Behavior | Problem |
|---|---|---|---|
| `RoleAssignments` | `after CREATE` | Calls `syncAssignmentToHana(...)` in `cds.spawn` + calls `queueReplication(role.name, ...)` | Creates 'Open' replication entry; requires external task chain trigger. |
| `RoleAssignments` | `after UPDATE` | Writes audit log + calls `queueReplication(...)` | Does not sync HANA directly; creates queued replication. |
| `RoleAssignments` | `before DELETE` | Calls `queueReplication(...)` + calls `syncAssignmentToHana(..., isDelete=true)` in `cds.spawn` | Deletes from HANA flat table but leaves queue record. |
| `Roles` | `after CREATE` | Writes audit log + calls `queueReplication(...)` | Role has no assignments yet, queue record is redundant. |
| `Roles` | `after UPDATE` | Writes audit log + calls `queueReplication(...)` + calls `syncRoleAssignmentsToHana(roleId)` in `cds.spawn` | Syncs HANA in background, but also adds queue record. |
| `Roles` | `before DELETE` | Writes audit log + calls `queueReplication(...)` + processes cascading delete | Queue record added for deleted role. |
| `RoleInheritance` | `after CREATE/DELETE` | Calls `syncRoleAssignmentsToHana(roleId)` in `cds.spawn` | Syncs HANA, no Databricks sync. |
| `Restrictions` | `after CREATE/UPDATE/DELETE` | Calls `queueReplication(...)` + calls `syncRoleAssignmentsToHana(roleId)` | Syncs HANA, adds queue record. |
| `DynamicGenerationRules` | `syncDynamicRule` | Calls `syncAssignmentToHana(...)` + calls `queueReplication(...)` | DRAGE creates roles/assignments and queues replications. |

### 2.2 Direct Real-Time Multi-Target Synchronization Architecture

```
                       ┌───────────────────────────────────────────────┐
                       │          Role / Assignment Event Hook         │
                       │    (CREATE / UPDATE / DELETE / CASCADE)       │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                       ┌───────────────────────────────────────────────┐
                       │          Audit Log Record Insertion           │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                       ┌───────────────────────────────────────────────┐
                       │           Direct Sync Dispatcher              │
                       │  Resolve role & domain targetPlatform:        │
                       │     ['DATASPHERE', 'DATABRICKS', 'BOTH']      │
                       └───────────────┬───────────────┬───────────────┘
                                       │               │
                     targetPlatform    │               │ targetPlatform
                    includes DATASPHERE│               │ includes DATABRICKS
                                       ▼               ▼
                       ┌───────────────────────┐ ┌───────────────────────────┐
                       │  HanaReplication      │ │  DatabricksSyncService    │
                       │  Service              │ │                           │
                       │  - resolveEffective   │ │  - resolveEffective      │
                       │    Restrictions       │ │    Restrictions           │
                       │  - Cartesian product  │ │  - Generate Row Filter DDL│
                       │  - syncAssignment     │ │  - Execute SQL via        │
                       │    (HANA flat/hier)   │ │    Databricks SQL API     │
                       └───────────────────────┘ └───────────────────────────┘
```

#### Key Architecture Principles:
1. **Immediate Execution**: No `queueReplication` call, no `Replications` table row created.
2. **Platform Scoping**:
   - If `targetPlatform === 'DATASPHERE'`: invoke Datasphere/HANA sync only.
   - If `targetPlatform === 'DATABRICKS'`: invoke Databricks Unity Catalog sync only.
   - If `targetPlatform === 'BOTH'`: invoke both in parallel or sequence.
3. **Asynchronous Execution Context (`cds.spawn`)**:
   To ensure fast HTTP response times for UI and API clients (sub-100ms response rather than blocking on remote Databricks/HANA network calls), the direct synchronization executes inside `cds.spawn({ user: req?.user }, async () => { ... })`.
   - Any connection or statement errors are caught and logged with `console.error`.
   - Failures write an `ERROR` entry to `AuditLogs` so administrators can diagnose issues without blocking standard transactional CRUD operations.

---

## 3. Preserving the Critical Replication Rule & Decommissioning the Queue

### 3.1 Non-Negotiable Replication Rule (Datasphere / HANA)
As mandated in `AGENTS.md`:
> [!IMPORTANT]
> **CRITICAL REPLICATION RULE — DO NOT CHANGE THIS LOGIC:**
> 1. Determine Effective role authorization (recursively walking parent chains, and overriding parent wildcard restrictions if a descendant role redefines the same field).
> 2. Create HANA records based on the result of step 1 (Cartesian Product of all restriction values).
> 3. Save the Cartesian product result rows into the HANA flat tables (delete old rows first, then insert new ones).

**Confirmation & Verification**:
- `srv/lib/resolveEffectiveRestrictions.js` (`resolveEffectiveRestrictions`): Preserved in its entirety.
- `srv/services/hanaReplicationService.js`:
  - `buildFlatAuthorizationsForHana`: Group by field, compute Cartesian product of restriction values, assign `_1`, `_2` suffixes if multiple combinations.
  - `buildHierAuthorizationsForHana`: Map hierarchy directory prefixes and node IDs for Datasphere DAC.
  - `syncAssignmentToHana`: Transactional DELETE + INSERT in `HanaClient.syncAssignment` and `HanaClient.syncCustomAssignment`.
  - `syncRoleAssignmentsToHana`: Batch-resolves all assignments of a role and descendant derived roles.

### 3.2 Plan for Decommissioning `replicationQueueService.js`
1. **Remove `queueReplication` Calls**:
   - `srv/handlers/assignmentHandlers.js`: Lines 182, 247, 251, 276.
   - `srv/handlers/roleHandlers.js`: Lines 292, 419, 457.
   - `srv/handlers/restrictionHandlers.js`: Lines 124, 185, 228.
   - `srv/services/dynamicSyncService.js`: Lines 270, 369, 463, 488.
2. **Remove Polling & Action Handlers**:
   - Decommission `checkAndUpdateRunningReplications` and `makeTriggerReplicationHandler` in `srv/services/replicationQueueService.js`.
   - Remove `triggerReplication` and `checkReplicationStatuses` action implementations in `srv/cortex_service.js` (lines 230-238).
3. **No Orphaned Background Timers**:
   Currently, the application has no active `setInterval` or cron timers running in Node.js for replication; it only executed on demand or when polled by frontend `checkReplicationStatuses`. Deleting the action handlers and UI calls completely eliminates any background polling.

---

## 4. Databricks Unity Catalog Policy Synchronization Design

### 4.1 Databricks Unity Catalog Security Primitives
In Databricks Unity Catalog:
1. **Row-Level Security (Row Filters)**:
   A scalar user-defined function (UDF) that returns a `BOOLEAN`. Applied to a table via:
   ```sql
   ALTER TABLE <catalog>.<schema>.<table>
   SET ROW FILTER <catalog>.<schema>.<function_name> ON (<column_1>, <column_2>, ...);
   ```
2. **Column Masks**:
   A scalar function that transforms column values for unauthorized users:
   ```sql
   ALTER TABLE <catalog>.<schema>.<table>
   ALTER COLUMN <column> SET MASK <catalog>.<schema>.<mask_func>;
   ```
3. **Table Permissions (Grants)**:
   ```sql
   GRANT SELECT ON TABLE <catalog>.<schema>.<table> TO `<user_principal>`;
   ```

### 4.2 Translation Matrix: Restrictions to Unity Catalog SQL Expressions

Every restriction in `fanrio-auth` maps cleanly into SQL predicates:

| Restriction `filterType` | Stored Value Format | Example Value | Unity Catalog SQL Predicate |
|---|---|---|---|
| `SINGLE_VALUE` | Plain string or `{id, text}` | `"DE01"` | `col = 'DE01'` |
| `MULTI_VALUE` | JSON array or comma-sep | `["DE01","DE02"]` | `col IN ('DE01', 'DE02')` |
| `RANGE` | JSON `{"from": "10", "to": "50"}` | `{"from":10,"to":50}` | `col BETWEEN '10' AND '50'` (or numeric) |
| `BT` | JSON `{"from": "10", "to": "50"}` | `{"from":10,"to":50}` | `col BETWEEN '10' AND '50'` |
| `CP` / `PATTERN` | Wildcard string (`%` or `*`) | `"US*"` or `"CC_1%"` | `col LIKE 'US%'` (wildcard translated: `*` $\to$ `%`, `?` $\to$ `_`) |
| `NE` | Plain string | `"RESTRICTED"` | `col != 'RESTRICTED'` |
| `GT` / `GE` | Numeric / string | `"100"` | `col > '100'` / `col >= '100'` |
| `LT` / `LE` | Numeric / string | `"500"` | `col < '500'` / `col <= '500'` |
| `ALL` | Ignored | `""` | `TRUE` |
| `N` (Null) | None | `""` | `col IS NULL` |
| `NN` (Not Null) | None | `""` | `col IS NOT NULL` |

### 4.3 Composite Predicate Construction (Roles & Users)

1. **Intra-Role Rule (AND)**:
   Restrictions on different fields within the same role are combined with `AND`:
   $$\text{Predicate}_{\text{Role}} = (\text{Field}_1 \text{ condition}) \land (\text{Field}_2 \text{ condition}) \land \dots$$
2. **User Assignment Scope (current_user() match)**:
   In Databricks SQL, `current_user()` returns the email/username of the query runner.
   $$\text{Predicate}_{\text{UserRole}} = (\text{current\_user}() = '\text{alice@example.com}' \land \text{Predicate}_{\text{Role}})$$
3. **Multi-Role / Multi-User Scope (OR)**:
   If a user has multiple roles, or multiple users are assigned to domain tables:
   ```sql
   CREATE OR REPLACE FUNCTION dev_catalog.auth_policies.sales_domain_filter(country STRING, plant STRING)
   RETURN
     is_account_group_member('admin') OR
     (current_user() = 'alice@example.com' AND (country = 'DE' AND plant IN ('DE01', 'DE02'))) OR
     (current_user() = 'bob@example.com' AND (country = 'FR' AND plant = 'FR01'));
   ```

### 4.4 Synchronized Databricks Authorization Table (Dual Architecture)
In addition to direct SQL row filter functions, Databricks Unity Catalog supports storing the flattened authorizations in an authorization flat table:
`<catalog>.<schema>.<domain_name>_flat_authorizations`:
```sql
CREATE TABLE IF NOT EXISTS dev_catalog.auth_policies.sales_flat_authorizations (
  id STRING,
  user_id STRING,
  role_name STRING,
  field STRING,
  operator STRING,
  low STRING,
  high STRING,
  original_role STRING,
  created_timestamp TIMESTAMP,
  changed_timestamp TIMESTAMP
);
```
**Advantage**:
- Maintains exact parity with SAP HANA's Cartesian product tables.
- Allows Databricks queries to use either a subquery-based row filter:
  ```sql
  CREATE OR REPLACE FUNCTION dev_catalog.auth_policies.filter_by_table(f_name STRING, f_val STRING)
  RETURN
    is_account_group_member('admin') OR
    EXISTS (
      SELECT 1 FROM dev_catalog.auth_policies.sales_flat_authorizations
      WHERE user_id = current_user() AND field = f_name AND low = f_val
    );
  ```
  OR direct SQL DDL generation.

### 4.5 Execution Method: REST API vs SQL Warehouse Statement Execution

| Aspect | Unity Catalog REST API (`/api/2.1/unity-catalog/*`) | Databricks SQL Statement Execution API (`/api/2.0/sql/statements`) |
|---|---|---|
| **Capabilities** | Metadata CRUD (Catalogs, Schemas, Tables, Volumes). Can view function definitions. | Full SQL execution: `CREATE OR REPLACE FUNCTION`, `ALTER TABLE SET ROW FILTER`, `INSERT`, `DELETE`, `GRANT`. |
| **Row Filter Support** | ❌ Cannot define or bind row filters via JSON payload. | ✅ Full native support for Unity Catalog SQL DDL. |
| **Performance** | Fast HTTP response for metadata inspection. | Fast execution when SQL Warehouse is running. Configurable `wait_timeout: '30s'`. |
| **Authentication** | Bearer Token / OAuth M2M. | Bearer Token / OAuth M2M. |
| **Recommendation** | Use for testing catalog/schema existence if needed. | **Primary execution engine** for all policy, table, and grant synchronization. |

---

## 5. Testability & Offline Mock Adapter Architecture (R5)

To guarantee that unit and integration tests run offline without connecting to live Databricks cloud workspaces:

### 5.1 Pluggable Adapter Pattern in `DatabricksClient`
Mirroring `HanaClient.setDriver(mockHana)`:
```javascript
class DatabricksClient {
  static setAdapter(customAdapter) {
    this._customAdapter = customAdapter;
  }

  static async executeStatement(setting, statement) {
    if (this._customAdapter) {
      return this._customAdapter.execute(setting, statement);
    }
    if (isMockUrl(setting.workspaceUrl)) {
      return this._mockExecute(setting, statement);
    }
    // Real fetch to /api/2.0/sql/statements
  }
}
```

### 5.2 Mock Execution Capabilities
1. Intercepts `CREATE OR REPLACE FUNCTION`, `ALTER TABLE SET ROW FILTER`, `INSERT`, `DELETE`.
2. Stores executed DDL/DML in an in-memory statement history array for test assertions.
3. Simulates connection test responses for `isMockUrl(setting.workspaceUrl)`.
4. Enables backend tests (`test/backend_tests.test.js`) to assert:
   - DDL statements generated for each filter type.
   - Assignment deletion removes rows or alters function predicates.
   - Multi-target dispatch sends to both HANA and Databricks mocks simultaneously.

---

## 6. Complete Touchpoint Matrix

The following table details all code-level touchpoints required across the backend:

| File Path | Component | Planned Changes | Rationale |
|---|---|---|---|
| `db/schema.cds` | Data Model | 1. Add `TargetPlatform` enum (`DATASPHERE`, `DATABRICKS`, `BOTH`).<br>2. Add `targetPlatform` to `Roles` and `AccessDomains`.<br>3. Add `DatabricksSettings` entity.<br>4. Mark `Replications` as `@deprecated`. | Multi-target platform selection and Databricks connection support. |
| `srv/cortex_service.cds` | OData Projection | 1. Project `DatabricksSettings`.<br>2. Add `testDatabricksConnection` action.<br>3. Remove `triggerReplication` and `checkReplicationStatuses` actions.<br>4. Remove/deprecate `Replications` projection. | Expose Databricks settings to admin UI; retire replication queue endpoints. |
| `srv/cortex_service.js` | Service Wiring | 1. Import `DatabricksClient` and Databricks sync handlers.<br>2. Wire `testDatabricksConnection`.<br>3. Remove `replicationQueueService` wiring and `boundQueueReplication`.<br>4. Pass multi-target sync dependencies into handler registrations. | Central wiring layer updates. |
| `srv/handlers/roleHandlers.js` | Event Hooks | 1. Remove `queueReplication` on `CREATE`, `UPDATE`, `DELETE`.<br>2. On `UPDATE`, `DELETE`, and `RoleInheritance` changes, dispatch real-time sync to target platform(s). | Immediate real-time sync for roles. |
| `srv/handlers/assignmentHandlers.js` | Event Hooks | 1. Remove `queueReplication` on `CREATE`, `UPDATE`, `DELETE`.<br>2. In `after CREATE`, `after UPDATE`, and `before DELETE`, dispatch real-time sync to HANA and/or Databricks. | Immediate real-time sync for user assignments. |
| `srv/handlers/restrictionHandlers.js` | Event Hooks | 1. Remove `queueReplication`.<br>2. Dispatch real-time sync to target platform(s) on restriction CRUD. | Immediate sync on restriction edits. |
| `srv/handlers/accessDomainHandlers.js` | Event Hooks | 1. In `after CREATE`, if `targetPlatform` includes `DATABRICKS`, initialize Databricks catalog/schema resources.<br>2. In `before DELETE`, drop Databricks custom tables/filters. | Multi-target lifecycle for access domains. |
| `srv/handlers/systemHandlers.js` | Security Hooks | 1. Add `DatabricksSettings` to `before(['CREATE','UPDATE','DELETE'], ...)` and `READ` requiring `canManageSettings`.<br>2. Add `testDatabricksConnection` protection.<br>3. Mask `apiToken` and `clientSecret` on READ.<br>4. Remove `Replications` protections. | Secure Databricks credentials. |
| `srv/lib/databricksClient.js` | New Lib | Implement low-level Databricks SQL Statement Execution API client with pluggable mock adapter. | Low-level Databricks driver. |
| `srv/services/databricksSyncService.js` | New Service | Implement Unity Catalog SQL filter generation, assignment syncing, and table synchronization. | Databricks policy synchronization logic. |
| `srv/services/directSyncDispatcher.js` | New Service | Coordinate dispatching assignment/role changes to HANA and/or Databricks based on `targetPlatform`. | Centralized multi-platform sync dispatching. |
| `srv/services/replicationQueueService.js` | Service | Decommission / deprecate. | Decommission queue engine. |
| `srv/services/dynamicSyncService.js` | DRAGE Engine | Replace `queueReplication` with direct sync dispatching for DRAGE-generated roles. | Immediate sync for DRAGE engine. |
| `db/data/fanrio.auth-DatabricksSettings.csv` | Seed Data | Create initial seed file for `DatabricksSettings`. | Pre-populate default connection for testing. |
| `db/data/fanrio.auth-Replications.csv` | Seed Data | Empty header-only seed. | Clean DB initialization. |
| `test/backend_tests.test.js` | Test Suite | Replace replication queue test 10 with direct real-time sync tests for Databricks and Datasphere. | Verify direct synchronization and R1-R5. |

---

## 7. Recommended Implementation Sequence

To minimize risk and ensure continuous testability, implementation should proceed in three distinct slices:

1. **Phase 1: Schema & Data Model Evolution**
   - Add `TargetPlatform` and `targetPlatform` to `Roles` and `AccessDomains` in `db/schema.cds`.
   - Add `DatabricksSettings` entity and seed file.
   - Run `npx cds deploy` and verify SQLite migrations.
2. **Phase 2: Databricks Client, Mock Adapter & Policy Generator**
   - Implement `srv/lib/databricksClient.js` with mock adapter support.
   - Implement `srv/services/databricksSyncService.js` (SQL filter generation & DDL execution).
   - Write unit tests verifying SQL translation across all 11 filter types.
3. **Phase 3: Direct Sync Dispatcher & Queue Decommissioning**
   - Implement `directSyncDispatcher.js`.
   - Update `roleHandlers.js`, `assignmentHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js` to dispatch to target platforms and remove `queueReplication`.
   - Retire `replicationQueueService.js` and remove OData actions from `cortex_service.cds`.
   - Update `test/backend_tests.test.js` to assert real-time sync execution across both platforms.
