# Orchestration Plan: Databricks & Multi-Target Direct Sync

## Objective
Extend `fanrio-auth` to support both Databricks and SAP Datasphere via direct real-time API synchronization, completely replacing the batch replication queue engine and task chains, as specified in `ORIGINAL_REQUEST.md`.

## Phase 0: Survey & Scope Mapping
1. Dispatch 3 parallel Explorers:
   - Explorer 1 (Backend Architecture & Data Model): Examine `db/schema.cds`, `srv/cortex_service.cds`, `srv/cortex_service.js`, `srv/handlers/roleHandlers.js`, `srv/handlers/assignmentHandlers.js`, `srv/services/replicationQueueService.js`, `srv/services/hanaReplicationService.js`, `srv/lib/bdcClient.js`, `srv/lib/hanaClient.js`. Map exact changes needed to retire `Replications`, add `targetPlatform` (`DATASPHERE`, `DATABRICKS`, `BOTH`), implement Databricks client / mock adapter, and implement Unity Catalog SQL DDL / row-level filters.
   - Explorer 2 (Frontend & Administration UI): Examine `app/catalog/src/` (App.jsx, api.js, Wizard, RolesDashboard, AdministrationView, BdcSettingsView, ReplicationsView). Map exact changes needed to remove `ReplicationsView`, add Databricks settings tab/view, and add platform selection to Role/Access Domain forms.
   - Explorer 3 (Testing & Quality Assurance): Examine `test/backend_tests.test.js`, `test/dynamic_generation.test.js`, `test/auth_enforcement.test.js`. Map tests asserting on `Replications`, test requirements for offline Databricks mock adapter, and how to verify real-time sync.
2. Synthesize findings into `PROJECT.md` at project root with Architecture, Feature Inventory, Milestones, and Interface Contracts.

## Dual Track Execution
- Track A: E2E Testing Track (designs test harness and test cases covering all requirements)
- Track B: Implementation Track
  - Milestone 1: DB Schema, Entity Projections, Databricks Settings & Mock Adapter Architecture
  - Milestone 2: Databricks Unity Catalog Policy Sync Service & DDL/Filter Generator
  - Milestone 3: Real-Time Multi-Target Synchronization Engine & Assignment Handlers
  - Milestone 4: Retirement of Replication Queue Engine & UI Cleanup (frontend & backend)
  - Milestone 5: Full E2E Integration, Challenger Verification & Forensic Integrity Audit
