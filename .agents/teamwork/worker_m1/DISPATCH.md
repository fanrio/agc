## 2026-11-01T20:55:30Z
You are the Implementation Worker for Milestone 1 (Data Model, Settings & Pluggable Driver) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m1

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

You MUST read:
- The authoritative user request: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- The project specification: c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- The project rules: c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md
- Explorer M1-1 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_1\report.md
- Explorer M1-2 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2\report.md
- Explorer M1-3 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_3\report.md

Git branch: feature/databricks-direct-sync

Your implementation scope:
1. `db/schema.cds`:
   - Define `type TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; };`.
   - Add `targetPlatform : TargetPlatform default 'DATASPHERE';` to entity `Roles`.
   - Add `targetPlatform : TargetPlatform default 'BOTH';` to entity `AccessDomains`.
   - Define entity `DatabricksSettings : cuid, managed` with fields: `systemName`, `environment : Association to Environments;`, `workspaceUrl`, `authType : String(20) enum { TOKEN; SERVICE_PRINCIPAL; } default 'TOKEN';`, `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive : Boolean default true;`.
2. `srv/cortex_service.cds`:
   - Add projection: `entity DatabricksSettings as projection on db.DatabricksSettings;`.
   - Add action: `action testDatabricksConnection(settingId: UUID) returns { success: Boolean; message: String; httpStatus: Integer; };`.
3. `db/data/fanrio.auth-DatabricksSettings.csv`:
   - Create seed file with header: `ID,systemName,environment_ID,workspaceUrl,authType,apiToken,clientId,clientSecret,targetCatalog,targetSchema,sqlWarehouseId,isActive`.
4. Deploy the schema changes to SQLite:
   - Run `npx cds deploy` using run_command (with BypassSandbox: true). Verify `sqlite.db` is updated.
5. `srv/lib/databricksMockAdapter.js`:
   - Implement `DatabricksMockAdapter` with in-memory stores (`executedStatements`, `filterFunctions` Map, `appliedRowFilters` Map, `connectionTests` array).
   - Implement `executeStatement({ warehouseId, statement, catalog, schema })` parsing Unity Catalog DDL (`CREATE OR REPLACE FUNCTION ...`, `ALTER TABLE ... SET ROW FILTER ...`).
   - Implement `testConnection(settings)`.
   - Implement inspection methods: `getExecutedStatements()`, `reset()`, `setFailureMode(mode)`.
6. `srv/lib/databricksClient.js`:
   - Implement `DatabricksClient` with `setAdapter(adapter)`, `resetAdapter()`, `getAdapter(options)`.
   - Auto-mocking: if `process.env.CDS_ENV === 'test'`, `process.env.NODE_ENV === 'test'`, running under `--test`, or `isMockUrl(workspaceUrl)`, use `DatabricksMockAdapter`.
   - Implement `DatabricksHttpAdapter` calling Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`) with TOKEN and SERVICE_PRINCIPAL OAuth token handling.
   - Delegate `executeStatement` and `testConnection` to the active adapter.
7. `srv/handlers/systemHandlers.js`:
   - Add `DatabricksSettings` and `testDatabricksConnection` to `canManageSettings` authorization guards.
8. `srv/cortex_service.js`:
   - Wire `testDatabricksConnection` handler: load setting by `settingId`, validate inputs, call `DatabricksClient.testConnection`, return result.
9. Verification:
   - Create unit tests in `test/databricks_client.test.js` verifying adapter switching, mock statement execution, inspection methods, and failure injection.
   - Add tests for `DatabricksSettings` CRUD and `testDatabricksConnection` action to `test/backend_tests.test.js` and `test/auth_enforcement.test.js`.
   - Run the test suite: `npm run test` (with `BypassSandbox: true`). Ensure all tests pass.
10. Write your handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m1\handoff.md` with:
    - Observation (files changed, build/test commands run)
    - Logic Chain
    - Caveats
    - Conclusion
    - Verification commands and exact outputs
11. Send a completion message to parent when finished.
