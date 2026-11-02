# Original User Request

## Initial Request — 2026-11-01T20:30:34Z

Extend the authorization management application (`fanrio-auth`) to support both Databricks and SAP Datasphere via direct real-time API synchronization, completely replacing the batch replication queue engine and task chains.

Working directory: c:\Users\Fan\Documents\fanrio-auth
Integrity mode: development

## Requirements

### R1. Multi-Target Platform Selection & Direct Sync Architecture
Support both Databricks and SAP Datasphere as target platforms. Allow administrators and users to specify the target platform (`DATASPHERE`, `DATABRICKS`, or `BOTH`) on Roles and Access Domains. Synchronizations must occur in real-time upon assignment/role changes directly against target platform APIs/connections rather than being queued for batch processing.

### R2. Databricks Unity Catalog Real-Time Policy Synchronization
Implement a direct Databricks synchronization client and service. When role assignments or restriction rules targeting Databricks are created, updated, or deleted, the service immediately creates, alters, or removes corresponding Databricks Unity Catalog row-level filters, column masks, or access grants via Databricks REST API / SQL Warehouse DDL.

### R3. Retirement of Replication Queue Engine & UI Cleanup
Retire the asynchronous replication queue mechanism:
- Remove reliance on `Replications` queue entity and BDC task-chain trigger polling.
- Remove the `ReplicationsView` navigation and tab from the UI.
- Transition Datasphere synchronization to direct real-time HANA table synchronization.

### R4. Databricks Connection Settings & Administration
Add Databricks workspace connection management (workspace URL, authentication tokens/service principals, target catalog/schema) in the administration area alongside existing settings.

### R5. Testability & Offline Mock Adapter Architecture
Implement Databricks connectivity with a pluggable driver/adapter and mock support so that unit and integration tests run offline without live Databricks cloud infrastructure.

## Verification Resources
- Existing backend test suite: `test/backend_tests.test.js`, `test/auth_enforcement.test.js`, `test/dynamic_generation.test.js`
- Target: Test suite passes with replication queue replaced by direct real-time sync tests.
- Frontend build command: `npm run build --prefix app/catalog`

## Acceptance Criteria

### Platform Selection & Direct Sync
- [ ] Roles and Access Domains support selecting `DATASPHERE`, `DATABRICKS`, or `BOTH`.
- [ ] Role assignment changes trigger immediate direct synchronization to the configured target platform(s).

### Databricks Unity Catalog Integration
- [ ] Restriction rules translate accurately into Databricks Unity Catalog SQL row-level filter expressions.
- [ ] Databricks connection settings can be maintained in the administration UI and validated via an API test action.

### Decommissioning of Replication Queue
- [ ] `ReplicationsView` and obsolete replication queue triggers are removed from the frontend and service layer.
- [ ] No background task-chain polling or orphaned replication queue states remain.

### Quality & Non-Regression
- [ ] Backend test suite runs and passes cleanly with new direct synchronization tests.
- [ ] Production frontend bundle (`npm run build --prefix app/catalog`) builds with zero errors.

## Follow-up — 2026-11-01T20:33:55Z

User instruction: All changes and commits must be made in the new git branch 'feature/databricks-direct-sync'. The workspace has been switched to branch 'feature/databricks-direct-sync'. Please ensure all specialists and subagents work on this branch.
