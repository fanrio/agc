## 2026-11-01T21:24:37Z
You are the Implementation Worker for Milestone 2 (Databricks Unity Catalog Policy Sync) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m2

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

You MUST read:
- The authoritative user request: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- The project specification: c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- The project rules: c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md
- The test infrastructure: c:\Users\Fan\Documents\fanrio-auth\TEST_INFRA.md
- Explorer M2-1 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_1\report.md
- Explorer M2-2 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2\report.md
- Explorer M2-3 Report: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3\report.md

Git branch: feature/databricks-direct-sync

Your implementation scope:
1. `srv/services/databricksSyncService.js`:
   - Enforce the 11 filter types with SQL character escaping:
     `SINGLE_VALUE`, `MULTI_VALUE`, `RANGE`, `BT`, `CP`, `PATTERN`, `NE`, `GT`, `GE`, `LT`, `LE`, `NULL`, `NOT NULL`.
   - Implement Disjunctive Normal Form (DNF) boolean predicate builder:
     * Intra-role: restrictions on distinct fields combined with `AND`. Multiple restrictions on the same field combined with `OR`.
     * Multi-role per user: combined with `OR`.
     * Multi-user: combined with `OR`, wrapped with `(current_user() = 'user' AND (...))`.
     * Administrator bypass: `is_account_group_member('admin') OR ...`.
   - Effective restriction resolution: integrate `resolveEffectiveRestrictions` and `fetchRoleAncestryChain` (from `srv/lib/resolveEffectiveRestrictions.js` and `srv/services/hanaReplicationService.js`) to resolve inherited restrictions across `DERIVED` roles, correctly discarding ancestor wildcards when overridden by descendants.
   - Core exported service functions:
     * `syncRoleToDatabricks(roleId, cds)`
     * `syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds)`
     * `syncAccessDomainToDatabricks(accessDomainId, cds)`
     * `removeAssignmentFromDatabricks(userId, roleId, cds)`
     * `translateRestrictionToSql(restr, colName)`
     * `buildCompositePolicyExpr(assignments)`
   - Target naming resolution:
     * Target table: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations`.
     * Filter function name: `<catalog>.<schema>.fn_filter_<domain_sanitized>`.
   - DDL execution via `DatabricksClient.executeStatement(...)`:
     * `CREATE OR REPLACE FUNCTION <catalog>.<schema>.fn_filter_<domain>(<params>) RETURN <predicate>;`
     * `ALTER TABLE <catalog>.<schema>.<domain>_flat_authorizations SET ROW FILTER <catalog>.<schema>.fn_filter_<domain> ON (<columns>);`
     * If 0 users remain for the domain/table: `ALTER TABLE ... DROP ROW FILTER` and `DROP FUNCTION IF EXISTS ...`
2. `test/databricks_sync.test.js`:
   - Comprehensive unit & integration test suite covering:
     * All 11 filter types translation.
     * SQL character escaping (single quotes).
     * Multi-value arrays and comma-separated values.
     * Multi-level role inheritance (depth >= 3) and wildcard override.
     * Multi-user composite policy generation.
     * Revocation and clean drop when 0 users remain.
3. Verification:
   - Run tests: `npm run test` (with `BypassSandbox: true`).
   - Run frontend build: `npm run build --prefix app/catalog` (with `BypassSandbox: true`).
   - Ensure all tests pass with 0 failures and build succeeds with 0 errors.
4. Write your handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m2\handoff.md` with full details of changes, commands run, and test outputs.
5. Send a completion message to parent when finished.
