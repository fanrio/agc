# BRIEFING — 2026-11-01T20:41:00Z

## Mission
Conduct a thorough backend architecture and data model survey for multi-target platform support (Databricks + Datasphere) and replication queue retirement in fanrio-auth.

## 🔒 My Identity
- Archetype: explorer
- Roles: Backend Architecture & Data Model Explorer
- Working directory: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_backend
- Original parent: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Milestone: survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Support both Databricks and SAP Datasphere (`DATASPHERE`, `DATABRICKS`, `BOTH`)
- Databricks Unity Catalog real-time policy synchronization (row filters, column masks, grants)
- Direct real-time synchronization replacing asynchronous replication queue engine and task chains
- Preserve Cartesian product & effective restriction resolution for Datasphere/HANA (CRITICAL REPLICATION RULE)
- Testability with offline mock adapter architecture

## Current Parent
- Conversation ID: 73fff16a-762a-415c-9766-3f2b6b8bc4e4
- Updated: not yet

## Investigation State
- **Explored paths**: `db/schema.cds`, `srv/cortex_service.cds`, `srv/cortex_service.js`, `srv/handlers/roleHandlers.js`, `srv/handlers/assignmentHandlers.js`, `srv/handlers/restrictionHandlers.js`, `srv/handlers/accessDomainHandlers.js`, `srv/handlers/systemHandlers.js`, `srv/services/replicationQueueService.js`, `srv/services/hanaReplicationService.js`, `srv/services/dynamicSyncService.js`, `srv/services/orgRoleGeneratorService.js`, `srv/lib/hanaClient.js`, `srv/lib/bdcClient.js`, `srv/lib/resolveEffectiveRestrictions.js`, `test/backend_tests.test.js`, `test/auth_enforcement.test.js`.
- **Key findings**: Complete survey produced; direct real-time sync architecture designed; Databricks Unity Catalog SQL translation mapped for all 11 filter types; replication queue retirement planned; Cartesian product rule strictly preserved; pluggable mock adapter designed.
- **Unexplored areas**: None — full backend survey completed.

## Key Decisions Made
- `targetPlatform` enum (`DATASPHERE`, `DATABRICKS`, `BOTH`) added to `Roles` (default `DATASPHERE`) and `AccessDomains` (default `BOTH`).
- `DatabricksSettings` modeled with `workspaceUrl`, `apiToken`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `authType`.
- Direct real-time synchronization triggers immediately in `cds.spawn` on assignment and role CRUD without queueing.
- Databricks policy sync uses Databricks SQL Statement Execution API (`/api/2.0/sql/statements`) with a pluggable adapter for 100% offline testing.
- `Replications` entity marked `@deprecated` and actions `triggerReplication` and `checkReplicationStatuses` removed.

## Artifact Index
- `report.md` — Comprehensive findings and architectural recommendations (full report)
- `handoff.md` — 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification)
- `progress.md` — Liveness heartbeat
