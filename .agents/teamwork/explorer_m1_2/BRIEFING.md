# BRIEFING — 2026-11-01T20:46:00Z

## Mission
Design `srv/lib/databricksClient.js` and `srv/lib/databricksMockAdapter.js` for Milestone 1: pluggable adapter architecture, auto-mocking, in-memory mock adapter, real HTTP Databricks SQL Statement Execution API client, and clean API for the Worker.

## 🔒 My Identity
- Archetype: explorer
- Roles: read-only investigation, architectural design, synthesis
- Working directory: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_2
- Original parent: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Milestone: M1: Data Model, Settings & Pluggable Driver

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in production source files.
- All proposals must be written to report.md, handoff.md, or files in our directory.
- Preserve existing patterns in fanrio-auth (`urlUtils.js`, `hanaClient.js`, `bdcClient.js`).
- Support Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`).
- Auto-mock when `CDS_ENV === 'test'`, `NODE_ENV === 'test'`, or `isMockUrl(workspaceUrl)`.
- In-memory inspection stores on Mock adapter (`executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`).

## Current Parent
- Conversation ID: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Updated: 2026-11-01T20:46:00Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`, `PROJECT.md`, `AGENTS.md`
  - `srv/lib/urlUtils.js`, `srv/lib/bdcClient.js`, `srv/lib/hanaClient.js`, `srv/lib/authGuard.js`, `srv/cortex_service.js`
  - `explorer_m1_1/DISPATCH.md`, `explorer_m1_3/DISPATCH.md`
- **Key findings**:
  - Pluggable adapter architecture: `DatabricksClient.setAdapter(customAdapter)` and `resetAdapter()`.
  - Auto-mocking rule: `CDS_ENV === 'test' || NODE_ENV === 'test' || isMockUrl(workspaceUrl)`.
  - In-memory mock adapter `DatabricksMockAdapter` with `executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`, `reset()`, `setFailureMode(mode)`.
  - Complete SQL parsing in mock adapter for `CREATE OR REPLACE FUNCTION` and `ALTER TABLE SET/DROP ROW FILTER`.
  - Real HTTP execution with Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`), polling on `PENDING`/`RUNNING`, and OAuth M2M `/oidc/v1/token` token caching.
- **Unexplored areas**:
  - None for M1 Driver/Mock scope. Downstream policy generation handled in M2 (`databricksSyncService.js`).

## Key Decisions Made
- Separate files: `srv/lib/databricksMockAdapter.js` and `srv/lib/databricksClient.js` (which also exports `DatabricksMockAdapter` for convenience).
- Support both `warehouseId` and `sqlWarehouseId` parameters.
- Provide clean 5-component handoff report and code templates in `report.md`.

## Artifact Index
- `DISPATCH.md` — incoming prompt from parent
- `progress.md` — heartbeat and task progress
- `BRIEFING.md` — persistent working memory
- `report.md` — detailed design report with complete implementation code for Worker
- `handoff.md` — 5-component handoff report for parent & worker

