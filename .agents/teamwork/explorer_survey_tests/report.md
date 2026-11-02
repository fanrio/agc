# Test Suite Survey & Offline Mock Adapter Architecture (R5)
**Author**: Test Suite & Offline Mock Adapter Explorer  
**Date**: November 2026  
**Target Branch**: `feature/databricks-direct-sync`  
**Workspace**: `c:\Users\Fan\Documents\fanrio-auth`

---

## 1. Executive Summary

This report establishes the baseline survey of the existing `fanrio-auth` backend test infrastructure, catalogs all active test assertions and runtime references to the retiring `Replications` queue engine and BDC task chains, and provides a production-grade architectural specification for the **Pluggable Driver/Adapter Interface and Offline Databricks Mock Adapter (Requirement R5)**. 

All 60 existing backend tests (`backend_tests.test.js`, `auth_enforcement.test.js`, `dynamic_generation.test.js`) pass cleanly with Node.js built-in `node:test` runner when executed sequentially (`--test-concurrency=1`) under the in-memory SQLite profile (`CDS_ENV=test`). Retiring the asynchronous `Replications` queue requires replacing two major test blocks in `backend_tests.test.js` and `auth_enforcement.test.js` with direct real-time synchronization tests, removing `queueReplication` triggers across four handler/service modules, and introducing a mock adapter that intercepts Databricks REST API and SQL Warehouse DDL calls in-memory without live cloud infrastructure.

---

## 2. Current Test Infrastructure & Execution Model

### 2.1 Test Runner & Toolchain
The project utilizes Node.js's native test runner (`node:test`) and assertion library (`node:assert`).
- **Node version**: Node.js v24.18.0
- **Runner**: `node --test`
- **Root test script in `package.json`**: `"test": "cds test --profile test"`
- **DevDependencies**: `@cap-js/cds-test: ^1.0.1`, `@cap-js/sqlite: ^3.0.2`

### 2.2 Server Bootstrapping & In-Memory Database
Each test file bootstraps the SAP CAP application in-process via:
```javascript
const cds = require('@sap/cds');
const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');
```

When CAP boots in the test environment, the `package.json` configuration dictates database behavior:
```json
"[test]": {
  "features": {
    "in_memory_db": true
  },
  "requires": {
    "db": {
      "kind": "sqlite",
      "credentials": {
        "url": ":memory:"
      }
    }
  }
}
```
When `CDS_ENV=test` is active:
1. CAP initializes SQLite strictly in memory (`:memory:`), avoiding disk I/O on `sqlite.db`.
2. CDS automatically migrates the CDS schema from `db/schema.cds` and deploys initial CSV seed files from `db/data/`.
3. The in-memory database is reset per process lifecycle.

### 2.3 Execution Constraints & Test Execution Findings
During our direct survey, three operational nuances were observed:
1. **Parallel SQLite Locking**: If multiple test suites (`backend_tests.test.js`, `auth_enforcement.test.js`, `dynamic_generation.test.js`) are executed concurrently in the same process tree or access the same database file, SQLite throws:
   ```
   Error: 500 - database is locked (ERR_SQLITE_ERROR, errcode: 5)
   ```
   **Fix/Standard**: Tests must be executed with `--test-concurrency=1` or separated per file.
2. **`@cap-js/cds-test` Reporter EPERM**: When running `npm run test` (`cds test --profile test`), `@cap-js/cds-test/bin/reporter.js:177` attempts to write `~/.cds-test-recent.json` (`require('os').userInfo().homedir + '/.cds-test-recent.json'`). On Windows sandboxes or restricted profiles, this throws `Error: EPERM: operation not permitted, open 'C:\Users\Fan\.cds-test-recent.json'`.
3. **Windows Sandbox Network Sockets**: Node.js `fetch` against localhost in sandboxed environments can encounter `connect EACCES ::1:50092`. Running with proper sandbox bypass (`BypassSandbox: true` or native environment) resolves this immediately.

**Verified Clean Execution Command**:
```powershell
$env:CDS_ENV="test"; node --test --test-concurrency=1 test/backend_tests.test.js test/auth_enforcement.test.js test/dynamic_generation.test.js
```
*Result*: **60 tests passed, 0 failed, duration ~10.7s**.

### 2.4 Existing Mocking Patterns
The codebase currently uses two distinct mocking patterns for external systems:

1. **HANA Driver Dependency Injection & Require Cache Mocking**:
   In `test/backend_tests.test.js`, `test/auth_enforcement.test.js`, and `test/dynamic_generation.test.js`:
   ```javascript
   const mockHana = {
     createConnection: () => ({
       connect: (params, cb) => cb(null),
       setAutoCommit: (auto, cb) => cb(null),
       commit: (cb) => cb(null),
       rollback: (cb) => cb(null),
       prepare: (sql, cb) => cb(null, { exec: (params, cb) => cb(null) }),
       exec: (sql, paramsOrCb, maybeCb) => {
         const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
         cb(null, []);
       },
       disconnect: (cb) => cb ? cb() : null
     })
   };
   require('module')._cache[require.resolve('@sap/hana-client')] = {
     id: require.resolve('@sap/hana-client'),
     filename: require.resolve('@sap/hana-client'),
     loaded: true,
     exports: mockHana
   };
   const HanaClient = require('./../srv/lib/hanaClient');
   HanaClient.setDriver(mockHana);
   ```
2. **Global Fetch Monkey-Patching for BDC / Datasphere REST Calls**:
   In `test/backend_tests.test.js` (lines 38–178):
   `global.fetch` is monkey-patched to intercept:
   - `/api/v1/datasphere/consumption/catalog/spaces`
   - `/api/v1/datasphere/consumption/catalog/assets`
   - `/api/v1/datasphere/consumption/relational/`
   - `/api/v1/datasphere/tasks/chains/`
   - `/api/v1/datasphere/tasks/logs/`
   - `/api/v1/scim2/Users`
   - OAuth token URLs

---

## 3. Inventory of `Replications` & Batch Task Chains in Code & Tests

### 3.1 Test Suite Assertions

| File | Line Numbers | Test Description | What is Currently Asserted |
|---|---|---|---|
| `test/backend_tests.test.js` | 924–990 | `triggerReplication and checkReplicationStatuses triggers` | • Inserts row into `fanrio.auth.Replications` (`status: 'Open'`).<br>• Calls `POST /odata/v4/auth/triggerReplication`, asserts `res.data.success === true`.<br>• Asserts `Replications(ID)` status transitions to `'Running'` and `runId` is set.<br>• Calls `POST /odata/v4/auth/checkReplicationStatuses`.<br>• Updates `runId` to simulate completed task-chain log.<br>• Calls `checkReplicationStatuses` again and asserts status transitions to `'Success'`. |
| `test/backend_tests.test.js` | 872–922 | `runBdcTaskChain and fetchBdcTaskChainLog actions` | • Creates BDC connection.<br>• Calls `POST /odata/v4/auth/runBdcTaskChain` with `taskChainId: 'mock-chain-1'`.<br>• Asserts logId returned.<br>• Calls `POST /odata/v4/auth/fetchBdcTaskChainLog`. |
| `test/auth_enforcement.test.js` | 144–189 | `Replications authorization enforcement` | • Seeds user with `canManageReplications: false`.<br>• Asserts `POST /odata/v4/auth/triggerReplication` returns `403 Forbidden`.<br>• Updates user with `canManageReplications: true`.<br>• Asserts `triggerReplication` returns `200 OK`. |
| `test/auth_enforcement.test.js` | 623, 758 | User fixtures | Includes `canManageReplications: false` in test user definitions. |

### 3.2 Service Layer & Handler References to Retire

| Component | File Path | Existing Behavior | Required Modification |
|---|---|---|---|
| **Replication Queue Service** | `srv/services/replicationQueueService.js` | Manages `fanrio.auth.Replications` table, inserts 'Open' entries, polls task chains, handles status lifecycle. | **Retire completely** or replace with direct real-time sync service. |
| **Assignment Handlers** | `srv/handlers/assignmentHandlers.js`<br>(Lines 177–187, 245–252, 274–277) | On CREATE/UPDATE/DELETE of `RoleAssignments`, calls `queueReplication(role.name, ...)`. Also runs HANA sync in `cds.spawn`. | **Remove all `queueReplication` calls**. Execute direct real-time sync to target platforms (`DATASPHERE` via HANA, `DATABRICKS` via Databricks client, or `BOTH`). |
| **Role Handlers** | `srv/handlers/roleHandlers.js`<br>(Lines 419–423) | On UPDATE of `Roles`, calls `queueReplication(...)` and runs HANA sync in background. | **Remove `queueReplication`**. Execute direct real-time sync for affected platform(s). |
| **Restriction Handlers** | `srv/handlers/restrictionHandlers.js`<br>(Lines 124, 187, 237) | On CREATE/UPDATE/DELETE of `Restrictions`, calls `queueReplication(...)`. | **Remove `queueReplication`**. Execute direct real-time sync. |
| **DRAGE Service** | `srv/services/dynamicSyncService.js`<br>(Lines 270, 369, 418) | Calls `queueReplication` after generating dynamic roles/assignments. | **Remove `queueReplication`**. Ensure generated assignments trigger direct sync. |
| **System Handlers** | `srv/handlers/systemHandlers.js`<br>(Lines 120–130) | `before(['CREATE','UPDATE','DELETE'], 'Replications')` and `before(['triggerReplication','checkReplicationStatuses'])` enforce `canManageReplications`. | **Remove handler hooks** for retired entities/actions. |
| **Service Projections & Actions** | `srv/cortex_service.cds`<br>(Lines 30, 150–158) | Projects `entity Replications as projection on db.Replications;` and actions `triggerReplication()`, `checkReplicationStatuses()`. | **Remove `Replications` entity projection and actions**. |
| **Service Wiring** | `srv/cortex_service.js`<br>(Lines 26, 61, 156, 230–232) | Wires `queueReplication`, `triggerReplication`, `checkReplicationStatuses`. | **Remove wiring**. |
| **Frontend UI & API** | `app/catalog/src/components/ReplicationsView.jsx`<br>`app/catalog/src/api.js`<br>`app/catalog/src/App.jsx` | Renders replications table and trigger button; exports `getReplications`, `triggerReplication`, `checkReplicationStatuses`. | **Delete `ReplicationsView.jsx`**, remove navigation item from `App.jsx`, remove API methods. |

---

## 4. Testability & Offline Mock Adapter Architecture (Requirement R5)

To satisfy Requirement R5 without requiring live Databricks cloud infrastructure during development and CI testing, we design a pluggable driver/adapter architecture mirroring the proven pattern of `HanaClient`.

### 4.1 Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        fanrio-auth Service Layer                       │
│     (assignmentHandlers, roleHandlers, databricksSyncService)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Calls high-level operations
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          DatabricksClient                              │
│   - Coordinates sync operations & SQL generation                       │
│   - Static driver/adapter registry: DatabricksClient.setAdapter(...)   │
│   - Auto-detects test environment -> defaults to DatabricksMockAdapter │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
    (Production)    │                                │   (Unit / Integration Tests)
                    ▼                                ▼
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│     DatabricksRestAdapter       │    │      DatabricksMockAdapter      │
│  - Databricks SQL Warehouse API │    │  - 100% in-memory simulation    │
│  - Bearer / OAuth M2M           │    │  - Zero network/cloud calls     │
│  - Live Unity Catalog DDL       │    │  - Recorded actions & DDL store │
│  - HTTPS fetch execution        │    │  - Failure simulation engine    │
└─────────────────────────────────┘    └────────────────┬────────────────┘
                                                        │
                                                        ▼
                                       ┌─────────────────────────────────┐
                                       │       Recorded State Store      │
                                       │  - executedStatements: []       │
                                       │  - filterFunctions: Map         │
                                       │  - appliedRowFilters: Map       │
                                       │  - connectionTests: []          │
                                       └─────────────────────────────────┘
```

### 4.2 Adapter Interface (`IDatabricksAdapter`)
All Databricks drivers must implement the following contract:

```javascript
/**
 * @typedef {Object} DatabricksConnectionSetting
 * @property {string} workspaceUrl
 * @property {string} authType - 'TOKEN' | 'OAUTH_M2M'
 * @property {string} [apiToken]
 * @property {string} [clientId]
 * @property {string} [clientSecret]
 * @property {string} warehouseId
 * @property {string} catalog
 * @property {string} schema
 */

/**
 * Interface contract for Databricks adapters
 */
class IDatabricksAdapter {
  /**
   * Tests connectivity, catalog, and warehouse access
   * @param {DatabricksConnectionSetting} setting
   * @returns {Promise<{ success: boolean, message: string, catalogs?: string[] }>}
   */
  async testConnection(setting) {}

  /**
   * Executes arbitrary SQL statement via Databricks SQL Warehouse API
   * @param {DatabricksConnectionSetting} setting
   * @param {string} statement
   * @returns {Promise<{ status: string, statementId: string, result?: any }>}
   */
  async executeStatement(setting, statement) {}

  /**
   * Creates or replaces a Unity Catalog Row-Level Filter SQL Function
   * @param {DatabricksConnectionSetting} setting
   * @param {{ functionName: string, columns: Array<{name: string, type: string}>, returnExpression: string }} definition
   * @returns {Promise<{ success: boolean, ddl: string }>}
   */
  async createOrReplaceFilterFunction(setting, definition) {}

  /**
   * Applies a row filter to a target table
   * @param {DatabricksConnectionSetting} setting
   * @param {{ tableName: string, functionName: string, onColumns: string[] }} mapping
   * @returns {Promise<{ success: boolean, ddl: string }>}
   */
  async applyRowFilter(setting, mapping) {}

  /**
   * Removes row filter from target table
   * @param {DatabricksConnectionSetting} setting
   * @param {string} tableName
   * @returns {Promise<{ success: boolean, ddl: string }>}
   */
  async removeRowFilter(setting, tableName) {}

  /**
   * Drops a filter function
   * @param {DatabricksConnectionSetting} setting
   * @param {string} functionName
   * @returns {Promise<{ success: boolean, ddl: string }>}
   */
  async dropFilterFunction(setting, functionName) {}
}
```

### 4.3 Offline Mock Adapter Specification (`DatabricksMockAdapter`)
The `DatabricksMockAdapter` implements `IDatabricksAdapter` with detailed inspection methods for test assertions:

```javascript
'use strict';

class DatabricksMockAdapter {
  constructor() {
    this.reset();
  }

  reset() {
    this.executedStatements = [];
    this.filterFunctions = new Map(); // functionName -> { definition, ddl, createdAt }
    this.appliedRowFilters = new Map(); // tableName -> { functionName, onColumns, ddl, appliedAt }
    this.connectionTests = [];
    this.simulatedFailures = new Map(); // keyword/type -> error object
  }

  /**
   * Configures simulated error for testing error-recovery and negative test cases
   * @param {'auth'|'warehouse'|'sql'|'timeout'} failureType 
   * @param {Error|{status: number, message: string}} error 
   */
  setFailure(failureType, error) {
    this.simulatedFailures.set(failureType, error);
  }

  clearFailure(failureType) {
    this.simulatedFailures.delete(failureType);
  }

  async testConnection(setting) {
    this.connectionTests.push({ timestamp: new Date().toISOString(), setting });
    if (this.simulatedFailures.has('auth')) throw this.simulatedFailures.get('auth');
    if (this.simulatedFailures.has('warehouse')) throw this.simulatedFailures.get('warehouse');
    if (!setting.workspaceUrl || (!setting.apiToken && !setting.clientSecret)) {
      return { success: false, message: 'Invalid credentials or missing workspace URL.' };
    }
    return {
      success: true,
      message: 'Successfully connected to Databricks workspace and verified SQL Warehouse.',
      catalogs: [setting.catalog || 'main', 'samples', 'system']
    };
  }

  async executeStatement(setting, statement) {
    const entry = {
      timestamp: new Date().toISOString(),
      warehouseId: setting.warehouseId,
      catalog: setting.catalog,
      schema: setting.schema,
      statement: statement.trim()
    };
    this.executedStatements.push(entry);

    if (this.simulatedFailures.has('sql')) {
      throw this.simulatedFailures.get('sql');
    }

    // Auto-parse DDL to maintain mock state
    const cleanSql = statement.trim();
    if (/^CREATE OR REPLACE FUNCTION/i.test(cleanSql)) {
      const match = cleanSql.match(/CREATE OR REPLACE FUNCTION\s+([\w\.]+)/i);
      const funcName = match ? match[1] : 'unknown_func';
      this.filterFunctions.set(funcName, { ddl: cleanSql, updatedAt: new Date().toISOString() });
    } else if (/^ALTER TABLE\s+([\w\.]+)\s+SET ROW FILTER\s+([\w\.]+)\s+ON\s+\(([^)]+)\)/i.test(cleanSql)) {
      const match = cleanSql.match(/ALTER TABLE\s+([\w\.]+)\s+SET ROW FILTER\s+([\w\.]+)\s+ON\s+\(([^)]+)\)/i);
      if (match) {
        this.appliedRowFilters.set(match[1], {
          functionName: match[2],
          onColumns: match[3].split(',').map(s => s.trim()),
          ddl: cleanSql
        });
      }
    } else if (/^ALTER TABLE\s+([\w\.]+)\s+DROP ROW FILTER/i.test(cleanSql)) {
      const match = cleanSql.match(/ALTER TABLE\s+([\w\.]+)\s+DROP ROW FILTER/i);
      if (match) this.appliedRowFilters.delete(match[1]);
    } else if (/^DROP FUNCTION IF EXISTS\s+([\w\.]+)/i.test(cleanSql)) {
      const match = cleanSql.match(/DROP FUNCTION IF EXISTS\s+([\w\.]+)/i);
      if (match) this.filterFunctions.delete(match[1]);
    }

    return { status: 'SUCCEEDED', statementId: `mock-stmt-${Date.now()}` };
  }

  async createOrReplaceFilterFunction(setting, { functionName, columns, returnExpression }) {
    const fullFuncName = `${setting.catalog}.${setting.schema}.${functionName}`;
    const colDefs = columns.map(c => `${c.name} ${c.type || 'STRING'}`).join(', ');
    const ddl = `CREATE OR REPLACE FUNCTION ${fullFuncName}(${colDefs}) RETURN ${returnExpression};`;
    return this.executeStatement(setting, ddl);
  }

  async applyRowFilter(setting, { tableName, functionName, onColumns }) {
    const fullTableName = `${setting.catalog}.${setting.schema}.${tableName}`;
    const fullFuncName = `${setting.catalog}.${setting.schema}.${functionName}`;
    const ddl = `ALTER TABLE ${fullTableName} SET ROW FILTER ${fullFuncName} ON (${onColumns.join(', ')});`;
    return this.executeStatement(setting, ddl);
  }

  async removeRowFilter(setting, tableName) {
    const fullTableName = `${setting.catalog}.${setting.schema}.${tableName}`;
    const ddl = `ALTER TABLE ${fullTableName} DROP ROW FILTER;`;
    return this.executeStatement(setting, ddl);
  }

  async dropFilterFunction(setting, functionName) {
    const fullFuncName = `${setting.catalog}.${setting.schema}.${functionName}`;
    const ddl = `DROP FUNCTION IF EXISTS ${fullFuncName};`;
    return this.executeStatement(setting, ddl);
  }

  // --- Inspection APIs for Test Assertions ---

  getExecutedStatements() {
    return [...this.executedStatements];
  }

  getLastStatement() {
    return this.executedStatements[this.executedStatements.length - 1];
  }

  findStatementMatching(pattern) {
    return this.executedStatements.find(s => 
      pattern instanceof RegExp ? pattern.test(s.statement) : s.statement.includes(pattern)
    );
  }

  getFilterFunction(fullNameOrShort) {
    for (const [key, val] of this.filterFunctions.entries()) {
      if (key === fullNameOrShort || key.endsWith(`.${fullNameOrShort}`)) return val;
    }
    return null;
  }

  getAppliedRowFilter(tableName) {
    for (const [key, val] of this.appliedRowFilters.entries()) {
      if (key === tableName || key.endsWith(`.${tableName}`)) return val;
    }
    return null;
  }
}

module.exports = DatabricksMockAdapter;
```

### 4.4 Client Wrapper & Adapter Injection (`DatabricksClient`)
In `srv/lib/databricksClient.js`:
```javascript
'use strict';

const DatabricksMockAdapter = require('./databricksMockAdapter');
const DatabricksRestAdapter = require('./databricksRestAdapter');

let currentAdapter = null;

class DatabricksClient {
  static getAdapter() {
    if (!currentAdapter) {
      const isTest = process.env.NODE_ENV === 'test' || process.env.CDS_ENV === 'test';
      currentAdapter = isTest ? new DatabricksMockAdapter() : new DatabricksRestAdapter();
    }
    return currentAdapter;
  }

  static setAdapter(adapter) {
    currentAdapter = adapter;
  }

  static reset() {
    if (currentAdapter && typeof currentAdapter.reset === 'function') {
      currentAdapter.reset();
    }
  }

  static async testConnection(setting) {
    return this.getAdapter().testConnection(setting);
  }

  static async executeStatement(setting, statement) {
    return this.getAdapter().executeStatement(setting, statement);
  }

  static async createOrReplaceFilterFunction(setting, def) {
    return this.getAdapter().createOrReplaceFilterFunction(setting, def);
  }

  static async applyRowFilter(setting, mapping) {
    return this.getAdapter().applyRowFilter(setting, mapping);
  }

  static async removeRowFilter(setting, tableName) {
    return this.getAdapter().removeRowFilter(setting, tableName);
  }
}

module.exports = DatabricksClient;
```

---

## 5. Restriction Rule to Databricks Unity Catalog SQL Translation Engine

### 5.1 Unity Catalog Row-Level Security Mechanism
Databricks Unity Catalog implements Row-Level Security (RLS) via user-defined filter functions attached to tables. 
The SQL UDF returns a `BOOLEAN` result. A row is visible to a querying user if and only if the function returns `TRUE`.

### 5.2 Translation Rules per Filter Type

| Filter Type in `Restrictions` | DB Stored Value Example | Databricks SQL Expression Generator | Example Output Expression |
|---|---|---|---|
| `SINGLE_VALUE` | `'DE'` | Escapes single quotes (`'` -> `''`). Checks equality. | `Country = 'DE'` |
| `MULTI_VALUE` | `'["DE01","DE02"]'` or `'DE01,DE02'` | Parses JSON or CSV array. Converts to SQL `IN` list. | `Plant IN ('DE01', 'DE02')` |
| `RANGE` or `BT` | `'{"from":"1000","to":"5000"}'` | Parses range bounds. Numeric or string comparison. | `(Amount >= 1000 AND Amount <= 5000)` |
| `CP` / `PATTERN` | `'CC%'` or `'US*'` | Replaces wildcard `*` with SQL `%`. Generates `LIKE`. | `CompanyCode LIKE 'CC%'` |
| Multiple Fields in Role | Multiple restrictions | Conjunction of field conditions. | `(Country = 'DE' AND Plant IN ('DE01', 'DE02'))` |
| Role Inheritance (`DERIVED`) | Recursively resolved via `resolveEffectiveRestrictions` | Follows critical rule: overrides parent wildcard if child redefines field. | Effective restrictions translated as single consolidated role clause. |

### 5.3 User / Session Identification in Databricks Unity Catalog
Databricks SQL provides two primary built-in context functions for row filters:
1. `CURRENT_USER()`: Returns the authenticated workspace user email (e.g. `'alice.smith@fanrio.com'`).
2. `IS_ACCOUNT_GROUP_MEMBER('group_name')`: Evaluates whether the session user belongs to the specified group/role.

**Recommended Policy Architecture**:
When assignments map individual users to roles:
```sql
CREATE OR REPLACE FUNCTION main.finance.otc_row_filter(Country STRING, Plant STRING)
RETURN
  (CURRENT_USER() = 'alice.smith@fanrio.com' AND (Country = 'DE' AND Plant IN ('DE01', 'DE02')))
  OR
  (CURRENT_USER() = 'bob.martin@fanrio.com' AND (Country = 'US'))
  OR
  (IS_ACCOUNT_GROUP_MEMBER('fanrio_admins'));
```
When an assignment is created or deleted, `databricksSyncService` regenerates the SQL function definition for the affected domain/table and executes the `CREATE OR REPLACE FUNCTION` statement immediately.

---

## 6. Comprehensive Test Suite Design Matrix

The following test suites must be implemented in `test/databricks_sync.test.js` and integrated with `test/backend_tests.test.js` and `test/auth_enforcement.test.js`.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 New & Updated Test Suites               │
                  └────────────────────────────┬────────────────────────────┘
                                               │
         ┌─────────────────────────┬───────────┴─────────────┬──────────────────────────┐
         ▼                         ▼                         ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│ Suite 1:        │       │ Suite 2:        │       │ Suite 3:         │       │ Suite 4:        │
│ Target Platform │       │ Direct Real-    │       │ SQL Row Filter   │       │ Settings & Conn │
│ Selection       │       │ Time Sync       │       │ Translation      │       │ Test Action     │
│ - DATASPHERE    │       │ - Role Assign   │       │ - SINGLE, MULTI  │       │ - Test action   │
│ - DATABRICKS    │       │ - Role Delete   │       │ - RANGE, CP      │       │ - Error branch  │
│ - BOTH          │       │ - No queue rows │       │ - Derivation     │       │ - Masked secret │
└─────────────────┘       └─────────────────┘       └──────────────────┘       └─────────────────┘
```

### Suite 1: Target Platform Selection (`DATASPHERE`, `DATABRICKS`, `BOTH`)
- **File**: `test/databricks_sync.test.js`
- **Test Cases**:
  1. `Roles creation with targetPlatform = 'DATASPHERE'`: Validates default and persistence in DB.
  2. `Roles creation with targetPlatform = 'DATABRICKS'`: Validates explicit selection.
  3. `Roles creation with targetPlatform = 'BOTH'`: Validates dual-target platform assignment.
  4. `AccessDomains creation with targetPlatform`: Validates domain-level default platform propagation to roles.
  5. `Reject invalid targetPlatform value`: Rejects values other than `DATASPHERE`, `DATABRICKS`, `BOTH` with 400.

### Suite 2: Immediate Direct Real-Time Sync on Assignment Changes
- **File**: `test/databricks_sync.test.js` (and replacement in `test/backend_tests.test.js`)
- **Setup**: Active `BdcSettings` (HANA) and active `DatabricksSettings` initialized in test memory. `DatabricksClient.setAdapter(mockAdapter)`.
- **Test Cases**:
  1. **DATASPHERE Role Assignment CREATE**:
     - Create role with `targetPlatform: 'DATASPHERE'`, add restriction, create `RoleAssignment`.
     - *Assert*: `HanaClient.syncAssignment` / HANA flat table received records.
     - *Assert*: `mockAdapter.getExecutedStatements().length === 0` (Databricks NOT touched).
     - *Assert*: No rows inserted into `fanrio.auth.Replications`.
  2. **DATABRICKS Role Assignment CREATE**:
     - Create role with `targetPlatform: 'DATABRICKS'`, add restriction, create `RoleAssignment`.
     - *Assert*: `mockAdapter.getExecutedStatements()` contains `CREATE OR REPLACE FUNCTION` and `ALTER TABLE ... SET ROW FILTER`.
     - *Assert*: HANA driver received 0 records for this assignment.
     - *Assert*: No rows inserted into `fanrio.auth.Replications`.
  3. **BOTH Target Role Assignment CREATE**:
     - Create role with `targetPlatform: 'BOTH'`, add restriction, create `RoleAssignment`.
     - *Assert*: Both HANA sync and Databricks sync executed immediately.
     - *Assert*: No rows inserted into `fanrio.auth.Replications`.
  4. **Role Assignment DELETE**:
     - Delete assignment for `DATABRICKS` role.
     - *Assert*: `mockAdapter.getExecutedStatements()` contains updated function without deleted user or `DROP ROW FILTER` if no users remain.
     - *Assert*: No background queue entries created.
  5. **Restriction UPDATE on active role**:
     - Update restriction value from `'DE'` to `'US'`.
     - *Assert*: Immediate re-sync to Databricks with updated SQL expression in function DDL.

### Suite 3: SQL Row-Level Filter Expression Translation
- **File**: `test/databricks_sync.test.js`
- **Unit & Integration Test Cases**:
  1. `Translate SINGLE_VALUE restriction`: Field `'Country'`, Value `'DE'` -> `Country = 'DE'`.
  2. `Translate MULTI_VALUE restriction`: Field `'Plant'`, Value `'["DE01","DE02"]'` -> `Plant IN ('DE01', 'DE02')`.
  3. `Translate RANGE / BT restriction`: Field `'Amount'`, Value `'{"from":100,"to":500}'` -> `(Amount >= 100 AND Amount <= 500)`.
  4. `Translate CP pattern restriction`: Field `'CompanyCode'`, Value `'CC*'` -> `CompanyCode LIKE 'CC%'`.
  5. `Translate Multi-Field Conjunction`: Role with Country and Plant -> `(Country = 'DE' AND Plant IN ('DE01', 'DE02'))`.
  6. `Translate Derived Role with Wildcard Override`: Parent has `Country = '*'`, Child has `Country = 'US'`. Child correctly overrides parent wildcard in Databricks filter SQL.
  7. `SQL Injection Prevention`: Field value containing quotes (`"'; DROP TABLE users; --"`) is strictly escaped to prevent SQL injection in Databricks DDL.

### Suite 4: Databricks Connection Settings & Test Action
- **File**: `test/databricks_sync.test.js` (and `test/auth_enforcement.test.js`)
- **Test Cases**:
  1. `CRUD on DatabricksSettings`: Insert, read, update, delete connection settings.
  2. `Sensitive credential masking`: Confirm `apiToken` and `clientSecret` have `@UI.Hidden` and are not leaked in standard reads.
  3. `testDatabricksConnection OData Action - Success Branch`:
     - Invokes `POST /odata/v4/auth/testDatabricksConnection(settingId=...)`.
     - Mock adapter returns success; action responds with `{ success: true, message: ..., catalogs: '...' }`.
  4. `testDatabricksConnection OData Action - Failure Branch`:
     - Injects failure into mock adapter (`mockAdapter.setFailure('auth', new Error('Invalid token'))`).
     - Action responds with `{ success: false, message: 'Invalid token' }`.
  5. `Authorization Protection`:
     - User without `canManageSettings` gets `403 Forbidden` on DatabricksSettings modification and test action.

### Suite 5: Clean Decommissioning & Retirement of Replication Queue
- **File**: `test/backend_tests.test.js` and `test/auth_enforcement.test.js`
- **Verification Cases**:
  1. `Verify absence of Replications entity in OData metadata`:
     - Call `GET /odata/v4/auth/$metadata`.
     - *Assert*: `Replications` entity type is absent.
  2. `Verify rejection of retired actions`:
     - Calling `POST /odata/v4/auth/triggerReplication` returns 404 Not Found (or gracefully removed).
     - Calling `POST /odata/v4/auth/checkReplicationStatuses` returns 404 Not Found.
  3. `Verify no orphaned timers or background polling`:
     - Ensure no `setInterval` or background task chains are spawned on application boot.
  4. `Frontend production compilation`:
     - `npm run build --prefix app/catalog` succeeds with 0 errors without `ReplicationsView`.

---

## 7. Actionable Recommendations for Implementation

1. **Test Runner Command**:
   Update `package.json` to ensure clean, non-locking test runs on all platforms:
   ```json
   "test": "node --test --test-concurrency=1 test/*.test.js"
   ```
2. **Pluggable Adapter Factory**:
   Create `srv/lib/databricksMockAdapter.js`, `srv/lib/databricksRestAdapter.js`, and `srv/lib/databricksClient.js`. 
   Have `DatabricksClient` automatically default to `DatabricksMockAdapter` if `process.env.NODE_ENV === 'test'` or `process.env.CDS_ENV === 'test'`.
3. **Database Migration Synchronization**:
   When adding `targetPlatform` to `Roles` and `AccessDomains` in `db/schema.cds`, and introducing `DatabricksSettings`, immediately run:
   ```powershell
   npx cds deploy
   ```
   to keep the SQLite schema synchronized.
4. **Preserve Core Cartesian Resolution**:
   Respect the critical replication rule in `AGENTS.md`: when resolving effective restrictions for Databricks, invoke `resolveEffectiveRestrictions(role_ID, ...)` from `srv/lib/resolveEffectiveRestrictions.js` directly, guaranteeing identical parent-inheritance semantics across both Datasphere and Databricks.
