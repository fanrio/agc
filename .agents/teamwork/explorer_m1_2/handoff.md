# Handoff Report: Databricks Pluggable Driver & Mock Adapter (M1)

**Type**: Hard  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2`  
**Target Recipient**: Parent (`73fff16a-762a-415c-9766-3f2b6b8bc4e4`) & Worker

---

## 1. Observation

1. **Existing Driver Dependency Injection Patterns**:
   - `srv/lib/hanaClient.js:27-29`:
     ```javascript
     static setDriver(customDriver) {
       hanaDriver = customDriver;
     }
     ```
   - `test/backend_tests.test.js:34-35`:
     ```javascript
     const HanaClient = require('./../srv/lib/hanaClient');
     HanaClient.setDriver(mockHana);
     ```
   - Demonstrates project standard: static dependency injection for drivers allowing tests to substitute in-memory mocks without touching production invocation sites.

2. **Mock URL Detection**:
   - `srv/lib/urlUtils.js:9-21`:
     ```javascript
     const MOCK_URL_PATTERNS = ['mock', 'sandbox', 'test', 'localhost', 'example.com', '127.0.0.1'];
     function isMockUrl(url) {
       if (!url) return false;
       const lower = url.toLowerCase();
       return MOCK_URL_PATTERNS.some(p => lower.includes(p));
     }
     ```
   - Auto-mocking should leverage this existing shared utility function for consistency.

3. **Existing OAuth Client Patterns**:
   - `srv/lib/bdcClient.js:9-80`:
     - Implements `getAccessToken(tokenUrl, clientId, clientSecret)` with in-memory `tokenCache = new Map()`, Basic auth primary attempt, and URL-encoded body parameters fallback.
     - Databricks OAuth M2M (`/oidc/v1/token`) follows the identical OAuth 2.0 client credentials grant pattern.

4. **Environment Detection in CAP Service Layer**:
   - `srv/cortex_service.js:67-69` & `srv/lib/authGuard.js:9-11`:
     ```javascript
     const isTest = process.env.NODE_ENV === 'test' || 
                    process.execArgv.includes('--test') || 
                    (process.argv[1] && process.argv[1].includes('test'));
     ```
   - CDS test runner runs with profile `test` (`package.json:8` -> `"test": "cds test --profile test"`), setting `process.env.CDS_ENV === 'test'`.

5. **Interface Contracts in PROJECT.md**:
   - `PROJECT.md:92-100`:
     - `IDatabricksAdapter.executeStatement({ warehouseId, statement, catalog, schema })` -> Promise<{ statementId, status, manifest, result }>
     - `IDatabricksAdapter.testConnection({ workspaceUrl, apiToken, clientId, clientSecret, warehouseId })` -> Promise<{ success, message, httpStatus }>
     - `DatabricksMockAdapter` must expose `executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`, `reset()`, `setFailureMode(mode)`.

---

## 2. Logic Chain

1. **Pluggable Adapter Requirement**:
   - Based on Observation 1 and Observation 5, we define `DatabricksClient` with static methods `setAdapter(customAdapter)` and `resetAdapter()`, matching the established dependency injection style of `HanaClient.setDriver()`.
2. **Automatic Mock Selection**:
   - Based on Observation 2 and Observation 4, `DatabricksClient.getAdapter(options)` checks:
     - 1. Explicit override via `_adapter`
     - 2. Test runner environment (`CDS_ENV === 'test' || NODE_ENV === 'test' || process.execArgv.includes('--test')`)
     - 3. Mock URL detection via `isMockUrl(workspaceUrl)`
     - 4. Default to `DatabricksHttpAdapter`
   - This ensures offline tests run seamlessly without live Databricks cloud infrastructure or accidental outbound HTTP requests.
3. **Databricks SQL Statement Execution & Unity Catalog State Simulation**:
   - In Milestone 2, `databricksSyncService.js` will execute `CREATE OR REPLACE FUNCTION <func_name>` and `ALTER TABLE <table_name> SET ROW FILTER <func_name> ON (<columns>)`.
   - Based on Observation 5, `DatabricksMockAdapter` parses incoming SQL via regular expressions upon `executeStatement()`, populating `filterFunctions` (Map of function name -> definition) and `appliedRowFilters` (Map of table name -> metadata).
   - This provides direct test inspection capabilities: test assertions can verify that specific functions and row filters were generated and attached.
4. **Resilience & Error Simulation**:
   - `setFailureMode(mode)` allows tests to simulate authentication errors (`401`), syntax errors (`400`), warehouse unavailability (`503`), or network timeouts (`504`) without crashing the Node.js process.
   - `testConnection()` catches all exceptions and maps them to `{ success: false, message: err.message, httpStatus: status }`.

---

## 3. Caveats

1. **OAuth Service Principal Token Endpoint**:
   - Databricks standard workspace OAuth token endpoint is `POST /oidc/v1/token`. For Azure Databricks with Azure AD service principals, authentication can also be done via Azure AD STS (`login.microsoftonline.com`). The adapter provides `/oidc/v1/token` which works with native Databricks M2M OAuth and PAT tokens.
2. **SQL Polling Ceiling**:
   - DDL statements (`CREATE FUNCTION`, `ALTER TABLE`) execute within seconds on running warehouses. `waitTimeout` is set to `'30s'`. For asynchronous execution fallback, polling is capped at 30 iterations (30s) to prevent infinite loops.
3. **Identifier Normalization**:
   - Unity Catalog identifiers may include backticks (`` `catalog`.`schema`.`table` ``). The mock adapter automatically strips backticks to enable clean Map key lookups.

---

## 4. Conclusion

The design for `srv/lib/databricksClient.js` and `srv/lib/databricksMockAdapter.js` provides:
1. Complete offline capability and test-friendly in-memory state tracking (`executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`).
2. Robust auto-mocking based on test runner detection and `urlUtils.isMockUrl()`.
3. Fully functional HTTP adapter calling Databricks SQL Statement Execution API (`/api/2.0/sql/statements`) with token and OAuth service principal authentication.
4. Drop-in readiness for Worker implementation as detailed in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2\report.md`.

---

## 5. Verification Method

1. **Inspect Design Artifacts**:
   - Review complete class definitions in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2\report.md`.
2. **Post-Implementation Unit Test Command**:
   - Once Worker writes the files, run:
     ```powershell
     node --test test/databricks_client.test.js
     ```
   - Or test directly in node REPL:
     ```javascript
     const { DatabricksClient, DatabricksMockAdapter } = require('./srv/lib/databricksClient');
     const mock = new DatabricksMockAdapter();
     DatabricksClient.setAdapter(mock);
     await DatabricksClient.executeStatement({ warehouseId: 'wh-1', statement: 'CREATE OR REPLACE FUNCTION c.s.f(u STRING) RETURN true' });
     console.log(mock.getExecutedStatements().length === 1);
     console.log(mock.filterFunctions.has('c.s.f'));
     ```
3. **Invalidation Conditions**:
   - If `DatabricksClient.getAdapter()` fails to resolve to `DatabricksMockAdapter` when `process.env.NODE_ENV === 'test'`.
   - If `testConnection()` throws an uncaught error instead of returning `{ success: false, message: ... }`.
   - If `executedStatements` fails to record catalog, schema, or timestamp.
