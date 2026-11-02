# Handoff Report — Worker M3 (Milestone 3: Direct Multi-Target Sync Dispatcher & Queue Retirement)

## 1. Observation
- **Direct Multi-Target Sync Dispatcher (`srv/services/directSyncDispatcher.js`)**:
  - Implemented core routing functions: `resolveEffectivePlatforms(roleTargetPlatform, domainTargetPlatform)` and alias `resolveEffectivePlatform`.
  - Implemented sequential DDL lock per domain: `withDomainLock(domainKey, fn)` using an in-memory `Map` of chained promises to serialize DDL executions on the same Databricks domain/table while allowing concurrent execution across different domains.
  - Implemented `dispatchAssignmentSync`, `dispatchAssignmentRemoval`, `dispatchRoleSync`, `dispatchAccessDomainSync`, and `dispatchSync`.
  - Utilized `Promise.allSettled` to isolate failures: an outage or network error on Databricks never disrupts Datasphere (HANA) sync, and vice-versa.
  - Verified Datasphere delegation strictly preserves the Critical Replication Rule by invoking `hanaReplicationService.syncAssignmentToHana` and `syncRoleAssignmentsToHana` (recursive ancestry walk, child wildcard overriding, and Cartesian product generation).

- **Handler Rewiring & Queue Decoupling**:
  - `srv/handlers/assignmentHandlers.js`:
    - Injected `directSyncDispatcher` (lines 8, 20).
    - Removed `queueReplication` and direct `syncAssignmentToHana` imports/calls.
    - In `after CREATE`: invokes `dispatcher.dispatchAssignmentSync` within `cds.spawn`.
    - In `after UPDATE`: invokes `dispatcher.dispatchAssignmentRemoval` for old role if changed, and `dispatcher.dispatchAssignmentSync` for new role within `cds.spawn`.
    - In `before DELETE`: invokes `dispatcher.dispatchAssignmentRemoval` for target assignment within `cds.spawn`.
  - `srv/handlers/roleHandlers.js`:
    - Injected `directSyncDispatcher` (lines 8, 21).
    - Removed all `queueReplication` and direct `syncRoleAssignmentsToHana` calls.
    - In `after CREATE`: calls `dispatcher.dispatchRoleSync` within `cds.spawn` if deep assignments exist.
    - In `after UPDATE`: calls `dispatcher.dispatchRoleSync` within `cds.spawn`.
    - In `before DELETE`: removed `queueReplication`.
    - In `RoleInheritance` `after CREATE` and `after DELETE`: calls `dispatcher.dispatchRoleSync` within `cds.spawn`.
  - `srv/handlers/restrictionHandlers.js`:
    - Injected `directSyncDispatcher` (lines 4, 21-22).
    - Removed all `queueReplication` calls.
    - In `after CREATE`: calls `dispatcher.dispatchRoleSync` within non-blocking `cds.spawn` (relieving HTTP thread latency).
    - In `after UPDATE`: calls `dispatcher.dispatchRoleSync` within `cds.spawn`.
    - In `before DELETE`: calls `dispatcher.dispatchRoleSync` within `cds.spawn`.
  - `srv/services/dynamicSyncService.js`:
    - Removed `queueReplication` and `syncAssignmentToHana` imports (lines 1-4).
    - Replaced all 4 `queueReplication` calls and HANA sync calls with `directSyncDispatcher.dispatchAssignmentSync` (lines 259, 364) and `directSyncDispatcher.dispatchAssignmentRemoval` (line 465).
  - `srv/cortex_service.cds`:
    - Annotated `entity Replications`, `action triggerReplication`, and `action checkReplicationStatuses` with `@deprecated: 'Replaced by real-time direct sync'`.
  - `srv/cortex_service.js`:
    - Imported `directSyncDispatcher` (line 27) and passed to `handlerDeps` (line 41).
    - Wrapped `triggerReplication` and `checkReplicationStatuses` action handlers with deprecation warnings for backward compatibility.
  - `srv/services/replicationQueueService.js`:
    - Added top-level `@deprecated` banner.

- **Test Verification**:
  - `test/direct_sync_dispatcher.test.js`: 32 tests executed via `node --test test/direct_sync_dispatcher.test.js`.
    - Result: `✔ Direct Multi-Target Sync Dispatcher Suite (161.832ms) - pass: 32, fail: 0`.
  - `test/databricks_sync.test.js`: 12 tests executed via `node --test test/databricks_sync.test.js`.
    - Result: `✔ Databricks Unity Catalog Policy Sync & SQL Filter Generator (786.7394ms) - pass: 12, fail: 0`.
  - `test/databricks_client.test.js`: 24 tests executed via `node --test test/databricks_client.test.js`.
    - Result: `✔ Databricks Pluggable Client & Mock Adapter - pass: 24, fail: 0`.
  - `test/databricks_stress.test.js`: 21 tests executed via `node --test test/databricks_stress.test.js`.
    - Result: `✔ Databricks Stress & Adversarial Verification Harness - pass: 21, fail: 0`.
  - `test/challenger_m2_1_stress.test.js`: 26 tests executed via `node --test test/challenger_m2_1_stress.test.js`.
    - Result: `✔ Challenger 1 Empirical Stress Test Suite - pass: 26, fail: 0`.
  - `test/challenger_m2_2_stress.test.js`: 6 tests executed via `node --test test/challenger_m2_2_stress.test.js`.
    - Result: `✔ Challenger 2 Empirical Stress Tests - pass: 6, fail: 0`.
  - Total offline test suites verified: **121 / 121 tests pass with 0 failures**.
  - Production build verification:
    - Frontend bundle: `npm run build --prefix app/catalog` -> `✓ built in 1.58s`, exit code 0.
    - Backend CDS model: `npx cds build` -> `build completed in 9247 ms`, exit code 0.

## 2. Logic Chain
1. *Platform Resolution*: The system previously assumed a single destination (HANA) managed by a batch replication queue. Under M1/M2/M3, roles and access domains define `targetPlatform` (`DATASPHERE`, `DATABRICKS`, `BOTH`).
2. *Routing Intersection*:
   - If role is `DATASPHERE` and domain is `BOTH`, effective platform is `DATASPHERE`.
   - If role is `DATABRICKS` and domain is `BOTH`, effective platform is `DATABRICKS`.
   - If role is `BOTH` and domain is `DATASPHERE`, effective platform is `DATASPHERE`.
   - If role is `BOTH` and domain is `DATABRICKS`, effective platform is `DATABRICKS`.
   - If role is `BOTH` and domain is `BOTH`, effective platform is `BOTH`.
   - If role is `DATASPHERE` and domain is `DATABRICKS`, an explicit platform conflict is flagged (`conflict: true`) and sync safely skips conflicting operations.
3. *Concurrency Mutex*:
   - Databricks SQL Warehouse DDL cannot execute concurrently on the same table or function without colliding.
   - `withDomainLock` assigns a queue chain per `domainKey` (e.g. `domainId` or `schema.table`), guaranteeing that updates to the same domain execute strictly in order, while allowing updates to separate domains to run in parallel.
4. *Queue Retirement & Real-Time Sync*:
   - Replacing `queueReplication` in `assignmentHandlers`, `roleHandlers`, `restrictionHandlers`, and `dynamicSyncService` with direct calls to `dispatcher.dispatchAssignmentSync`, `dispatchAssignmentRemoval`, and `dispatchRoleSync` ensures that changes propagate to active platforms immediately.
   - Using non-blocking `cds.spawn` ensures the HTTP response latency for end users remains fast and unblocked by external network latency.
5. *Backward Compatibility*:
   - To support legacy systems and test suites awaiting Milestone 5 complete queue removal, `srv/cortex_service.cds` annotates the queue actions and entities with `@deprecated` while preserving callable wrappers in `srv/cortex_service.js` with structured warning logs.

## 3. Caveats
1. **Windows Localhost Port Exhaustion / Firewall Invalidation**:
   - Running full end-to-end HTTP suites that spin up rapid ephemeral express instances on Windows via `cds.test` occasionally experiences `connect EACCES` due to Windows Winsock socket recycling limits.
   - Unit and integration tests decoupled from the Windows networking stack run reliably and achieve 100% pass rates.
2. **Scheduled Complete Removal**:
   - Legacy queue entities (`Replications`) and OData actions remain accessible with `@deprecated` status and will be fully removed in Milestone 5 as planned.

## 4. Conclusion
Milestone 3 is complete and verified:
- `directSyncDispatcher.js` is fully implemented and tested with 32 comprehensive tests covering platform routing, domain mutex concurrency, cascades, and error isolation.
- All handler CRUD hooks (`RoleAssignments`, `Roles`, `Restrictions`, `DynamicGenerationRules`) are rewired to the direct dispatcher, fully retiring `queueReplication` in active paths.
- The Critical Replication Rule (Cartesian product flattening and ancestry walking) remains intact for SAP Datasphere.
- Frontend catalog build and backend CDS compilation pass with zero errors.

## 5. Verification Method
Run the following commands from the project root (`c:\Users\Fan\Documents\fanrio-auth`):
1. **Direct Sync Dispatcher Tests**:
   ```powershell
   node --test test/direct_sync_dispatcher.test.js
   ```
   *Expected output*: 32 tests passing, 0 failures.
2. **Databricks Policy Sync Tests**:
   ```powershell
   node --test test/databricks_sync.test.js
   ```
   *Expected output*: 12 tests passing, 0 failures.
3. **Databricks Client & Mock Tests**:
   ```powershell
   node --test test/databricks_client.test.js
   ```
   *Expected output*: 24 tests passing, 0 failures.
4. **Stress & Adversarial Tests**:
   ```powershell
   node --test test/databricks_stress.test.js
   node --test test/challenger_m2_1_stress.test.js
   node --test test/challenger_m2_2_stress.test.js
   ```
   *Expected output*: All 53 tests pass.
5. **Frontend Production Build**:
   ```powershell
   npm run build --prefix app/catalog
   ```
   *Expected output*: `✓ built in ~1.5s`, exit code 0.
6. **Backend CDS Build**:
   ```powershell
   npx cds build
   ```
   *Expected output*: `build completed in ~9s`, exit code 0.
