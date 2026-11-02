# DISPATCH: Milestone 1 Explorer 3 (testDatabricksConnection OData Action & Service Wiring)
Scope: M1 - Action definition in srv/cortex_service.cds, wiring in srv/cortex_service.js, credentials validation, error handling, and test integration.
Read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- .agents/AGENTS.md
Git branch: feature/databricks-direct-sync
Working directory: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_3
Write findings and implementation strategy to report.md.

## 2026-11-01T20:44:56Z
Sender: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
Message:
You are Explorer 3 for Milestone 1 (Data Model, Settings & Pluggable Driver) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_3

You MUST read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Git branch: feature/databricks-direct-sync

Your focus:
1. Examine `srv/cortex_service.cds` and `srv/cortex_service.js`.
2. Detail the exact design for action `testDatabricksConnection`:
   - Action signature in `srv/cortex_service.cds`:
     `action testDatabricksConnection(settingId: UUID) returns { success: Boolean; message: String; httpStatus: Integer; };`
   - Permission checking in `authGuard.js`: check `canManageSettings`.
   - Service implementation in `srv/cortex_service.js`: loads `DatabricksSettings` by `settingId`, validates required fields (`workspaceUrl`, auth credentials), calls `DatabricksClient.testConnection(setting)`.
   - Error handling: gracefully catches network errors or invalid credential responses, returning `{ success: false, message: err.message, httpStatus: 400/502 }` without crashing the CAP server.
3. Provide exact code designs and test cases for Worker.
Write your report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m1_3\report.md`.
Send a completion message to parent when done.
