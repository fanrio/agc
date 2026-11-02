## 2026-11-01T20:44:56Z
You are Explorer 1 for Milestone 1 (Data Model, Settings & Pluggable Driver) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_1

You MUST read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Git branch: feature/databricks-direct-sync

Your focus:
1. Examine `db/schema.cds` and `srv/cortex_service.cds`.
2. Detail the exact CDS definitions needed for:
   - `type TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; };`
   - Adding `targetPlatform : TargetPlatform default 'DATASPHERE';` to `Roles`.
   - Adding `targetPlatform : TargetPlatform default 'BOTH';` to `AccessDomains`.
   - Creating entity `DatabricksSettings : cuid, managed` with fields: `systemName`, `environment`, `workspaceUrl`, `authType`, `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive`.
   - Projection of `DatabricksSettings` in `srv/cortex_service.cds`.
   - Creation of CSV seed `db/data/fanrio.auth-DatabricksSettings.csv` (headers).
   - Execution plan for `npx cds deploy`.
3. Provide precise before/after code blocks and verification steps for Worker.
Write your report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_1\report.md`.
Send a completion message to parent when done.
