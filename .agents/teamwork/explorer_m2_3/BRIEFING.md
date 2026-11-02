# BRIEFING — 2026-11-01T21:19:15Z

## Mission
Design srv/services/databricksSyncService.js and related Databricks Unity Catalog policy sync integration for Milestone 2.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_3
- Original parent: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Milestone: Milestone 2 (Databricks Unity Catalog Policy Sync)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in source code
- Write only to working directory .agents/teamwork/explorer_m2_3/
- Design srv/services/databricksSyncService.js and related integration
- Follow project conventions in AGENTS.md, PROJECT.md, and TEST_INFRA.md

## Current Parent
- Conversation ID: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Updated: 2026-11-01T21:15:02Z

## Investigation State
- **Explored paths**:
  - `srv/lib/databricksClient.js` & `srv/lib/databricksMockAdapter.js` (M1 pluggable driver)
  - `db/schema.cds` (DatabricksSettings, Roles, AccessDomains, RoleAssignments, TargetPlatform enum)
  - `srv/cortex_service.cds` & `srv/cortex_service.js` (service wiring and projections)
  - `srv/services/hanaReplicationService.js` (ancestry chain loading, effective restrictions, Cartesian flattening)
  - `srv/lib/resolveEffectiveRestrictions.js` (recursive inheritance, pattern override)
  - `srv/handlers/assignmentHandlers.js`, `roleHandlers.js`, `accessDomainHandlers.js`
  - `test/e2e_direct_sync.test.js`, `test/databricks_client.test.js`, `TEST_INFRA.md`
- **Key findings**:
  - Unity Catalog requires single row filter per table; multiple users on the same table must be unified into composite boolean OR predicates with `current_user() = '...'` binding and admin bypass `is_account_group_member('admin')`.
  - Target naming: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations` for table, `<catalog>.<schema>.fn_filter_<domain_sanitized>` for function.
  - When last user is revoked, table filter must be dropped via `ALTER TABLE ... DROP ROW FILTER` and function dropped via `DROP FUNCTION IF EXISTS ...`.
  - DatabricksClient facade automatically routes to `DatabricksMockAdapter` during tests, perfectly matching regex-based DDL statement parsing.
- **Unexplored areas**: None for M2 scope; all requirements and edge cases mapped out.

## Key Decisions Made
- Service design provides 4 core exported functions: `syncRoleToDatabricks`, `syncAssignmentToDatabricks`, `syncAccessDomainToDatabricks`, `removeAssignmentFromDatabricks`.
- Included helper exports for modular testing: `resolveDatabricksSettings`, `resolveTargetNaming`, `translateRestrictionToDatabricksSql`, `buildDatabricksRowFilterDdl`.
- Documented full implementation ready for Worker, complete with error handling, SQL escaping, and dedicated test suite `test/databricks_sync.test.js`.

## Artifact Index
- DISPATCH.md — Incoming parent dispatch message
- BRIEFING.md — Persistent working memory
- progress.md — Liveness heartbeat and step tracking
- report.md — Comprehensive architecture & design report for Worker
- handoff.md — 5-Component handoff report
