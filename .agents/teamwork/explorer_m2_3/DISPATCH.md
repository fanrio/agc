## 2026-11-01T21:15:02Z
You are Explorer 3 for Milestone 2 (Databricks Unity Catalog Policy Sync) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3

You MUST read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md
- c:\Users\Fan\Documents\fanrio-auth\TEST_INFRA.md

Git branch: feature/databricks-direct-sync

Your focus:
1. Design `srv/services/databricksSyncService.js`:
   - Service functions:
     * `syncRoleToDatabricks(roleId, cds)`: re-computes and syncs policies for all assignments of this role.
     * `syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds)`: immediately creates, alters, or removes row-level filters.
     * `syncAccessDomainToDatabricks(accessDomainId, cds)`: provisions flat table or catalog/schema targets if needed.
     * `removeAssignmentFromDatabricks(userId, roleId, cds)`: updates filter function when user assignment is revoked. If no users remain, drops row filter via `ALTER TABLE ... DROP ROW FILTER` and drops function.
   - Target naming resolution:
     * Load `DatabricksSettings` (default active or matching role's environment). Extract `targetCatalog` (e.g. `main`), `targetSchema` (e.g. `fanrio_auth`), `sqlWarehouseId`.
     * Target table: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations` or domain's configured table name.
     * Filter function name: `<catalog>.<schema>.fn_filter_<domain_sanitized>`.
   - Statement execution via `DatabricksClient.executeStatement(...)`.
2. Provide complete service structure, error handling, and test integration for Worker.
Write your report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3\report.md`.
Send a completion message to parent when done.
