# Project: fanrio-auth (Multi-Target Direct Real-Time Sync: Databricks & SAP Datasphere)

## Architecture
The application is extended to support both SAP Datasphere (HANA flat tables) and Databricks (Unity Catalog row-level filters and access grants) via direct, real-time synchronization upon role assignment and definition changes, completely retiring the asynchronous batch replication queue engine.

```
                      ┌─────────────────────────────────────────┐
                      │          React Frontend (Vite)          │
                      │  - Role Wizard (Platform Selector)      │
                      │  - Databricks Settings View (Admin)     │
                      │  - Roles Dashboard (Platform Badges)    │
                      └────────────────────┬────────────────────┘
                                           │ OData v4
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │          CAP Node.js Service            │
                      │   srv/handlers/ (role, assignment)      │
                      └─────────────┬───────────────────────────┘
                                    │ cds.spawn (real-time)
                                    ▼
                      ┌─────────────────────────────────────────┐
                      │        Direct Sync Dispatcher           │
                      │   inspects role/domain targetPlatform   │
                      └──────┬───────────────────────────┬──────┘
                             │                           │
         targetPlatform:     │                           │ targetPlatform:
      DATASPHERE or BOTH     ▼                           ▼ DATABRICKS or BOTH
  ┌───────────────────────────────────┐  ┌───────────────────────────────────┐
  │      HANA Replication Service     │  │     Databricks Sync Service       │
  │ - Cartesian product preservation  │  │ - Unity Catalog SQL UDF Row Filter│
  │ - Effective restriction resolution│  │ - ALTER TABLE ... SET ROW FILTER  │
  │ - Direct flat table writes (DML)  │  │ - Direct SQL Execution API / REST │
  └─────────────────┬─────────────────┘  └─────────────────┬─────────────────┘
                    │                                      │
                    ▼                                      ▼
             SAP HANA Database                   Databricks Unity Catalog
           (or in-memory mock)                  (or DatabricksMockAdapter)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | TargetPlatform Enum & Data Model | Add `TargetPlatform` enum (`DATASPHERE`, `DATABRICKS`, `BOTH`) to `Roles` and `AccessDomains` in `db/schema.cds` and `srv/cortex_service.cds`. | M1 | R1 |
| 2 | DatabricksSettings Data Model | Add `DatabricksSettings` entity to `db/schema.cds` and projection to `srv/cortex_service.cds`. | M1 | R4 |
| 3 | Pluggable DatabricksClient & Mock Adapter | Implement `DatabricksClient` with `IDatabricksAdapter` interface and `DatabricksMockAdapter` for offline execution. | M1 | R5 |
| 4 | Test Databricks Connection Action | Implement `testDatabricksConnection` OData action in `srv/cortex_service.js` with credentials validation. | M1 | R4 |
| 5 | Databricks Unity Catalog Policy Sync Service | Implement `databricksSyncService.js` translating all restriction types into SQL UDF row filter predicates and DDL. | M2 | R2 |
| 6 | Effective Restriction Resolution for Databricks | Integrate `resolveEffectiveRestrictions` into Databricks sync to handle hierarchy and parent wildcard overrides. | M2 | R2 |
| 7 | Direct Multi-Target Sync Dispatcher | Implement `directSyncDispatcher` routing changes to HANA, Databricks, or both based on `targetPlatform`. | M3 | R1 |
| 8 | Event Handler Direct Real-Time Wiring | Update `assignmentHandlers.js`, `roleHandlers.js`, and `restrictionHandlers.js` to trigger direct sync in `cds.spawn`. | M3 | R1 |
| 9 | Retirement of Replication Queue Engine | Remove all `queueReplication` calls; retire `replicationQueueService.js` and obsolete OData actions; deprecate `Replications`. | M3 | R3 |
| 10 | Frontend Replication Queue UI Retirement | Remove `ReplicationsView` from `App.tsx` routes, navigation tabs, and `api.ts`. Deprecate `canManageReplications` cleanly. | M4 | R3 |
| 11 | Frontend Target Platform Selection | Add `targetPlatform` selection in `Wizard` (`StepOrigin`, `StepReview`), `AccessDomainsView`, and badges/filters in `RolesDashboard`. | M4 | R1 |
| 12 | Frontend Databricks Settings Administration | Create `DatabricksSettingsView.tsx` tab in `SystemView.tsx` with connection form and live "Test Connection" button. | M4 | R4 |
| 13 | Test Suite Migration & Queue Assertion Removal | Replace obsolete `Replications` assertions in `test/backend_tests.test.js` and `test/auth_enforcement.test.js`. | M5 | R3, R5 |
| 14 | Automated Multi-Target & Databricks Sync Tests | Create comprehensive tests verifying direct sync, SQL filter generation, mock adapter recording, and admin settings. | M5 | R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Data Model, Settings & Pluggable Driver | Schema extensions (`TargetPlatform`, `DatabricksSettings`), `DatabricksClient`, `DatabricksMockAdapter`, `testDatabricksConnection` action. | none | DONE |
| 2 | M2: Databricks Unity Catalog Policy Sync | `databricksSyncService.js` SQL filter generator (all 11 filter types), row filter DDL execution, inheritance resolution. | M1 | DONE |
| 3 | M3: Direct Real-Time Sync & Queue Retirement | `directSyncDispatcher.js`, handler event updates in `assignmentHandlers.js`, `roleHandlers.js`, removal of `queueReplication` and queue actions. | M1, M2 | DONE |
| 4 | M4: Frontend UI Platform Selection & Admin Settings | `App.tsx` and `api.ts` cleanup (retire `ReplicationsView`), `useWizardState.ts` & `StepOrigin.tsx` platform selector, `DatabricksSettingsView.tsx` in `SystemView.tsx`. | M1 | DONE |
| 5 | M5: E2E Integration, Test Suite Pass & Hardening | Replace obsolete queue tests in existing test suite, add comprehensive offline tests, pass 100% backend tests & frontend build. | M1, M2, M3, M4 | DONE |

## Interface Contracts

### Backend ↔ Frontend OData Interface
- `Roles`: `targetPlatform` (`'DATASPHERE'`, `'DATABRICKS'`, `'BOTH'`) - default `'DATASPHERE'`
- `AccessDomains`: `targetPlatform` (`'DATASPHERE'`, `'DATABRICKS'`, `'BOTH'`) - default `'BOTH'`
- `DatabricksSettings`:
  ```
  ID: UUID
  systemName: String(100)
  environment: Association to Environments
  workspaceUrl: String(255)
  authType: String(20) enum { TOKEN, SERVICE_PRINCIPAL }
  apiToken: String(500)
  clientId: String(100)
  clientSecret: String(500)
  targetCatalog: String(100)
  targetSchema: String(100)
  sqlWarehouseId: String(100)
  isActive: Boolean
  ```
- Action `testDatabricksConnection`:
  ```
  action testDatabricksConnection(settingId: UUID) returns { success: Boolean; message: String; httpStatus: Integer; };
  ```

### Pluggable Databricks Driver / Mock Adapter Interface
- `IDatabricksAdapter`:
  - `executeStatement({ warehouseId, statement, catalog, schema })`: Promise<{ statementId, status, manifest, result }>
  - `testConnection({ workspaceUrl, apiToken, clientId, clientSecret, warehouseId })`: Promise<{ success, message, httpStatus }>
- `DatabricksMockAdapter`:
  - Implements `IDatabricksAdapter` in-memory.
  - Exposes inspection stores: `executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`.
  - Exposes `reset()`, `setFailureMode(mode)`.

### Direct Sync Dispatcher Interface
- `dispatchSync({ action, roleId, userId, actorUser, environmentId, isDelete })`:
  - Loads role, resolved restrictions, targetPlatform.
  - If `targetPlatform` contains `DATASPHERE`: calls `syncAssignmentToHana` / `syncRoleAssignmentsToHana`.
  - If `targetPlatform` contains `DATABRICKS`: calls `syncRoleToDatabricks` / `syncAssignmentToDatabricks`.
  - Fully decoupled from any `Replications` entity or task chains.

## Code Layout
- Backend Schema: `db/schema.cds`
- Backend Service Projection: `srv/cortex_service.cds`
- Backend Service Wiring: `srv/cortex_service.js`
- Databricks Client: `srv/lib/databricksClient.js`
- Databricks Mock Adapter: `srv/lib/databricksMockAdapter.js`
- Databricks Sync Service: `srv/services/databricksSyncService.js`
- Direct Sync Dispatcher: `srv/services/directSyncDispatcher.js`
- Event Handlers: `srv/handlers/assignmentHandlers.js`, `srv/handlers/roleHandlers.js`, `srv/handlers/restrictionHandlers.js`
- Frontend API Client: `app/catalog/src/api.ts`
- Frontend Shell: `app/catalog/src/App.tsx`
- Frontend Wizard: `app/catalog/src/components/Wizard/`
- Frontend Settings: `app/catalog/src/components/DatabricksSettingsView.tsx`, `app/catalog/src/components/SystemView.tsx`
- Backend Tests: `test/backend_tests.test.js`, `test/databricks_sync.test.js`, `test/auth_enforcement.test.js`
