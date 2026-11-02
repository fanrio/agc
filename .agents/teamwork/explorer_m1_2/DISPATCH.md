## 2026-11-01T20:44:56Z
You are Explorer 2 for Milestone 1 (Data Model, Settings & Pluggable Driver) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2

You MUST read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Git branch: feature/databricks-direct-sync

Your focus:
1. Design `srv/lib/databricksClient.js` and `srv/lib/databricksMockAdapter.js`:
   - Pluggable adapter architecture: `DatabricksClient.setAdapter(customAdapter)`.
   - Auto-mocking: if `process.env.CDS_ENV === 'test'` or `process.env.NODE_ENV === 'test'` or `isMockUrl(workspaceUrl)`, default to `DatabricksMockAdapter`.
   - `DatabricksMockAdapter` implementation: in-memory state tracking `executedStatements` (array of `{ warehouseId, statement, catalog, schema, timestamp }`), `filterFunctions` (Map of function name -> definition), `appliedRowFilters` (Map of table -> filter function), `connectionTests`.
   - Methods: `executeStatement({ warehouseId, statement, catalog, schema })`, `testConnection(settings)`, `getExecutedStatements()`, `reset()`, `setFailureMode(mode)`.
   - Real HTTP adapter using Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`).
2. Provide exact code designs and exports for Worker.
Write your report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2\report.md`.
Send a completion message to parent when done.
