# Milestone 1: Data Model, Settings & Pluggable Driver — Handoff Report

## 1. Observation

### Code and Configuration Modifications
1. **`db/schema.cds`**:
   - Lines 5–9: Defined `type TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; };`.
   - Line 45: Added `targetPlatform : TargetPlatform default 'BOTH';` to `entity AccessDomains`.
   - Line 67: Added `targetPlatform : TargetPlatform default 'DATASPHERE';` to `entity Roles`.
   - Lines 131–143: Defined entity `DatabricksSettings : cuid, managed` with fields `systemName`, `environment`, `workspaceUrl`, `authType` (`TOKEN` / `SERVICE_PRINCIPAL`), `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, and `isActive` (default `true`).

2. **`srv/cortex_service.cds`**:
   - Line 36: Added projection `entity DatabricksSettings as projection on db.DatabricksSettings;`.
   - Lines 106–110: Added action `action testDatabricksConnection(settingId: UUID) returns { success : Boolean; message : String; httpStatus : Integer; };`.

3. **`db/data/fanrio.auth-DatabricksSettings.csv`**:
   - Created seed file with header:
     `ID,systemName,environment_ID,workspaceUrl,authType,apiToken,clientId,clientSecret,targetCatalog,targetSchema,sqlWarehouseId,isActive`.

4. **`srv/lib/databricksMockAdapter.js`**:
   - Created `DatabricksMockAdapter` with in-memory stores:
     - `executedStatements` (array of `{ warehouseId, statement, catalog, schema, timestamp }`)
     - `filterFunctions` (Map of `{ functionName, params, returnExpr, statement, catalog, schema, timestamp }`)
     - `appliedRowFilters` (Map of `{ table, filterFunction, columns, statement, catalog, schema, timestamp }`)
     - `connectionTests` (array of `{ settings, timestamp, result }`)
     - `failureMode` (`AUTH_FAIL`, `AUTH_FAILED`, `SQL_SYNTAX_ERROR`, `WAREHOUSE_UNAVAILABLE`, `TIMEOUT`, `NETWORK_ERROR`, custom Error)
     - `statementHandlers` (Map of patterns/regex to custom handlers)
   - Genuine Unity Catalog DDL parsing for:
     - `CREATE [OR REPLACE] FUNCTION ... RETURN ...`
     - `DROP FUNCTION [IF EXISTS] ...`
     - `ALTER TABLE ... SET ROW FILTER ... ON (...)`
     - `ALTER TABLE ... DROP ROW FILTER`
   - Implemented `testConnection(settings)`, `executeStatement(params)`, `getExecutedStatements()`, `reset()`, `setFailureMode(mode)`.

5. **`srv/lib/databricksClient.js`**:
   - Implemented `DatabricksHttpAdapter` for real cloud interaction:
     - Normalizes workspace URLs (`normalizeWorkspaceUrl`).
     - Supports `TOKEN` (Personal Access Token) and `SERVICE_PRINCIPAL` (OAuth M2M token fetch from `/oidc/v1/token` with in-memory caching).
     - Calls Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`) with synchronous timeout and asynchronous polling for PENDING/RUNNING statements.
     - Tests connection against SQL warehouse or workspace REST APIs.
   - Implemented `DatabricksClient` facade:
     - Dependency injection: `setAdapter(customAdapter)`, `resetAdapter()`, `getMockAdapter()`.
     - Adapter resolution precedence: explicit adapter override > test environment detection (`CDS_ENV === 'test'` or `NODE_ENV === 'test'` or `--test`) > mock workspace URL detection (`isMockUrl(workspaceUrl)`) > real HTTP adapter.
     - Static execution methods: `executeStatement(statementConfig, settingsConfig)` and `testConnection(settings)`.
     - Dual-module export: supports both default object and destructuring require patterns.

6. **`srv/handlers/systemHandlers.js`**:
   - Lines 14, 27: Protected `DatabricksSettings` under `canManageSettings` on `CREATE`, `UPDATE`, `DELETE`, and direct `READ`.
   - Lines 33–42: Added `after READ` handler to strip sensitive credentials (`apiToken`, `clientSecret`) from `DatabricksSettings`.
   - Line 116: Added `'testDatabricksConnection'` to administrative action authorization checks requiring `canManageSettings`.

7. **`srv/cortex_service.js`**:
   - Imported `DatabricksClient` and destructured `DatabricksSettings`.
   - Wired `testDatabricksConnection` action handler with parameter validation (`settingId`), database record lookup, workspace URL check (`http://` or `https://`), credentials check (`apiToken` or `clientId`/`clientSecret`), and error-safe delegation to `DatabricksClient.testConnection` returning `{ success, message, httpStatus }`.

8. **`test/databricks_client.test.js`**:
   - Created comprehensive unit test suite covering DDL statement recording, Unity Catalog parsing, connection verification, failure mode injection, reset, adapter resolution, auto-mocking, and URL/token utilities.
   - Result: 24 of 24 tests passed.

9. **`test/backend_tests.test.js`**:
   - Added test block `DatabricksSettings CRUD & testDatabricksConnection action` testing creation, sensitive credential stripping on read, update, happy path connection tests for TOKEN and SERVICE_PRINCIPAL, input validation failure branches (bad URL, missing token, missing client secret, 404 non-existent ID, 400 missing parameter), and simulated remote failures (401, 502).

10. **`test/auth_enforcement.test.js`**:
    - Added test block `testDatabricksConnection and DatabricksSettings require canManageSettings permission` verifying anonymous 403 rejection, non-admin 403 rejection on action and CRUD, and admin 200 success.

### Direct Command Executions and Output
1. Database Deployment (`npx cds deploy`):
   ```
   > init from db\data\fanrio.auth-Roles.csv 
   > init from db\data\fanrio.auth-Restrictions.csv 
   > init from db\data\fanrio.auth-RestrictionFields.csv 
   > init from db\data\fanrio.auth-Replications.csv 
   > init from db\data\fanrio.auth-OrgNodes.csv 
   > init from db\data\fanrio.auth-OrgNodeAttributes.csv 
   > init from db\data\fanrio.auth-Environments.csv 
   > init from db\data\fanrio.auth-DatabricksSettings.csv 
   > init from db\data\fanrio.auth-BdcSettings.csv 
   > init from db\data\fanrio.auth-AccessDomains.csv 
   > init from db\data\fanrio.auth-AccessDomainFields.csv 
   > init from db\data\fanrio.auth-AccessDomainAttributes.csv 
   /> successfully deployed to sqlite.db 
   ```
   Verified SQLite schema: table `fanrio_auth_DatabricksSettings` created with all 16 columns; table `fanrio_auth_Roles` updated with `targetPlatform NVARCHAR(20) DEFAULT 'DATASPHERE'`.

2. Unit Test Suite (`node --test test/databricks_client.test.js`):
   ```
   ✔ Databricks Pluggable Client & Mock Adapter (Unit Tests)
   ℹ tests 24
   ℹ suites 6
   ℹ pass 24
   ℹ fail 0
   ```

3. Full Project Test Suite (`npm run test`):
   ```
   Running 5 test suites... 
     ✔  test\auth_enforcement.test.js 
     ✔  test\databricks_client.test.js 
     ✔  test\dynamic_generation.test.js 
     ✔  test\backend_tests.test.js 
     ✔  test\e2e_direct_sync.test.js 

    112 in 5 suites passed 
    6.856s 
    Exit code: 0
   ```

4. Frontend Production Build (`npm run build --prefix app/catalog`):
   ```
   vite v8.0.16 building client environment for production...
   ✓ built in 1.04s
   Exit code: 0
   ```

---

## 2. Logic Chain

1. **Schema and Data Model Compatibility**:
   - `Roles.targetPlatform` defaulting to `'DATASPHERE'` ensures that all existing tests and features that do not specify a platform remain 100% backward-compatible.
   - `AccessDomains.targetPlatform` defaulting to `'BOTH'` satisfies the multi-target architecture where domains encompass both platforms.
   - `DatabricksSettings` extending `cuid, managed` provides standard UUID primary keys and audit metadata (`createdAt`, `createdBy`, `modifiedAt`, `modifiedBy`).
   - Running `npx cds deploy` updated `sqlite.db` and seeded `DatabricksSettings` cleanly without schema drift.

2. **Pluggable Driver & Mock Adapter Logic**:
   - Offline tests and local environments must not depend on live Databricks cloud infrastructure.
   - `DatabricksMockAdapter` genuinely parses Unity Catalog DDL (`CREATE OR REPLACE FUNCTION ... RETURN ...`, `DROP FUNCTION ...`, `ALTER TABLE ... SET ROW FILTER ... ON (...)`, `ALTER TABLE ... DROP ROW FILTER`) and records statements and parsed entities in memory.
   - `DatabricksClient.getAdapter()` checks if a test environment is detected (`CDS_ENV === 'test'`, `NODE_ENV === 'test'`, `--test` arg) or if the workspace URL is a mock URL (`urlUtils.isMockUrl`), automatically routing to `DatabricksMockAdapter`.
   - `DatabricksClient.setAdapter()` allows tests to inject custom spies or adapters.

3. **Security and RBAC**:
   - Connection testing and workspace configuration expose sensitive network and credential metadata.
   - Protecting `DatabricksSettings` CRUD/READ and `testDatabricksConnection` action with `canManageSettings` prevents privilege escalation.
   - Stripping `apiToken` and `clientSecret` in `after READ` ensures secrets are never leaked to the frontend or unprivileged callers.

4. **Validation and Error Resilience**:
   - `testDatabricksConnection` validates workspace URLs and credentials before executing network calls.
   - Errors are caught and returned as structured `{ success: false, message: '...', httpStatus: 400 | 401 | 502 }` payloads without crashing or throwing unhandled exceptions in the CAP service runtime.

5. **Test Progression**:
   - Implementing `targetPlatform` and `DatabricksSettings` resolved the 7 pre-existing failures in `test/e2e_direct_sync.test.js`, bringing the entire test suite across all 5 test suites to 112 passing tests with zero failures.

---

## 3. Caveats

- **Live Cloud Connectivity**: The `DatabricksHttpAdapter` implementation complies with the Databricks SQL Statement Execution API and OAuth M2M `/oidc/v1/token` specifications; in this environment, it was verified with unit tests and mock adapters, as live cloud credentials were not provided.
- **Milestone Scope**: This milestone delivers the data model, settings entity, pluggable driver, connection testing action, and security layer. Policy translation (translating all 11 restriction types into Databricks SQL UDFs) is scheduled for Milestone 2, and direct sync dispatching is scheduled for Milestone 3.

---

## 4. Conclusion

Milestone 1 (Data Model, Settings & Pluggable Driver) is 100% complete:
- Data model extensions (`TargetPlatform`, `DatabricksSettings`) are deployed to `sqlite.db` and exposed via OData v4 in `srv/cortex_service.cds`.
- `DatabricksMockAdapter` and `DatabricksClient` provide pluggable, auto-mocking execution with in-memory DDL parsing.
- `testDatabricksConnection` action is guarded by `canManageSettings`, validates inputs, and returns structured diagnostics.
- All 112 tests across 5 test suites pass cleanly (`npm run test`), and the frontend production bundle builds without errors (`npm run build --prefix app/catalog`).

---

## 5. Verification Method

To independently verify the implementation:

1. **Verify CDS compilation and SQLite schema**:
   ```powershell
   npx cds compile db/schema.cds --to sql
   node -e "const cds = require('@sap/cds'); (async () => { const db = await cds.connect.to('db'); const ds = await db.run('PRAGMA table_info(fanrio_auth_DatabricksSettings)'); console.log('DatabricksSettings:', ds.map(c => c.name)); const r = await db.run('PRAGMA table_info(fanrio_auth_Roles)'); console.log('Roles targetPlatform:', r.find(c => c.name === 'targetPlatform')); process.exit(0); })();"
   ```

2. **Run unit tests for DatabricksClient and MockAdapter**:
   ```powershell
   node --test test/databricks_client.test.js
   ```

3. **Run the complete test suite**:
   ```powershell
   npm run test
   ```
   Expected: 112 tests across 5 test suites pass (`auth_enforcement.test.js`, `databricks_client.test.js`, `dynamic_generation.test.js`, `backend_tests.test.js`, `e2e_direct_sync.test.js`).

4. **Verify frontend production build**:
   ```powershell
   npm run build --prefix app/catalog
   ```
   Expected: Vite builds successfully with zero errors.

5. **Invalidation conditions**:
   - Any failure in `npm run test`.
   - Missing `targetPlatform` on `Roles` or `AccessDomains`.
   - Missing `DatabricksSettings` projection or `testDatabricksConnection` action.
   - Unauthenticated or non-admin access permitted to `DatabricksSettings` or `testDatabricksConnection`.
