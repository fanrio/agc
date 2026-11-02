# DISPATCH: Worker M5 — Full E2E Integration, Legacy Queue Hard Deletion & Hardening

**Timestamp**: 2026-11-02T18:38:00Z
**Agent**: Worker M5
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m5`
**Target Branch**: `feature/databricks-direct-sync`

---

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

---

## Authoritative Inputs
Before writing any code, you MUST view and follow:
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md`
- `c:\Users\Fan\Documents\fanrio-auth\PROJECT.md`
- `c:\Users\Fan\Documents\fanrio-auth\TEST_INFRA.md`
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m5_1\handoff.md` (Legacy Queue Hard Deletion)
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m5_2\handoff.md` (Test Suite Migration)
- `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m5_3\handoff.md` (Dispatcher Hardening & E2E Assertion Alignment)

---

## Exclusive File Write Ownership
You have exclusive write access to:
1. `srv/services/directSyncDispatcher.js`
2. `srv/services/replicationQueueService.js` (delete file)
3. `srv/cortex_service.cds`
4. `srv/cortex_service.js`
5. `srv/handlers/systemHandlers.js`
6. `db/schema.cds`
7. `db/data/fanrio.auth-Replications.csv` (delete file)
8. `test/backend_tests.test.js`
9. `test/auth_enforcement.test.js`
10. `test/e2e_direct_sync.test.js`

---

## Exact Tasks to Implement

### Task 1: Direct Sync Dispatcher Hardening (`srv/services/directSyncDispatcher.js`)
Per Explorer M5-3 handoff report:
1. **Issue A (`withDomainLock` line 34-49)**:
   Fix the Promise comparison reference bug that causes a lock map memory leak:
   ```javascript
   const currentPromise = prev.then(() => next, () => next);
   domainLocks.set(key, currentPromise);
   try {
     await prev;
     return await fn();
   } finally {
     release();
     if (domainLocks.get(key) === currentPromise) {
       domainLocks.delete(key);
     }
   }
   ```
2. **Issue B (Object spread precedence & non-throwing error omission)**:
   In `dispatchAssignmentSync` (lines 266-274), `dispatchAssignmentRemoval` (lines 361-368), and `dispatchRoleSync` (lines 433-441):
   Change result formatting so that `isSuccess` takes precedence and non-throwing errors are pushed to `results.errors`:
   ```javascript
   const isSuccess = dbResult?.success !== false || dbResult?.skipped === true;
   results.databricks = { ...dbResult, success: isSuccess, platform: 'DATABRICKS' };
   if (!isSuccess && !dbResult?.skipped) {
     results.errors.push({ platform: 'DATABRICKS', message: dbResult?.error || dbResult?.reason || 'Databricks sync failed' });
   }
   ```

### Task 2: Legacy Queue Hard Deletion
Per Explorer M5-1 handoff report:
1. Delete `srv/services/replicationQueueService.js`.
2. In `srv/cortex_service.cds`: Remove `entity Replications`, `action triggerReplication`, and `action checkReplicationStatuses`.
3. In `srv/cortex_service.js`: Remove `replicationQueueService` import and all action handlers for `triggerReplication` and `checkReplicationStatuses`.
4. In `srv/handlers/systemHandlers.js`: Remove lines 132-142 containing `.before` authorization hooks on `Replications`, `triggerReplication`, and `checkReplicationStatuses`.
5. In `db/schema.cds`: Remove `entity Replications`.
6. Delete `db/data/fanrio.auth-Replications.csv`.
7. Execute `npx cds deploy` to synchronize the SQLite database schema.

### Task 3: Test Suite Migration
Per Explorer M5-2 handoff report:
1. In `test/backend_tests.test.js`:
   Replace Section 10 (lines 1069–1136) batch queue assertions with direct multi-target sync assertions.
   - Assert `DatabricksMockAdapter` records DDL statements on assignment `CREATE` and `DELETE`.
   - Assert that calling retired queue endpoints (`/odata/v4/auth/Replications`, `triggerReplication`, `checkReplicationStatuses`) returns HTTP 404 (Not Found).
   - Preserve all existing Cartesian product HANA tests (lines 1138–1220) intact.
2. In `test/auth_enforcement.test.js`:
   Migrate lines 144–189 to decommission guards asserting that retired `triggerReplication` returns 404 regardless of permission flags.

### Task 4: E2E Direct Sync Suite Alignment (`test/e2e_direct_sync.test.js`)
Per Explorer M5-3 handoff report:
1. Line 917 (Test T3.1): Align statement count assertion to account for live `restrictionHandlers.js` execution:
   `assert.ok(mockDatabricksAdapter.getExecutedStatements().length >= 1, 'Databricks received DDL statement');`
2. Line 1087 (Test T4.1): Align initial statement count assertion to account for live CRUD handlers:
   `assert.ok(mockDatabricksAdapter.getExecutedStatements().length >= 2, 'Databricks received initial policy statements');`

---

## Mandatory Verification Steps
You must run the following commands and include full stdout in your handoff report:
1. `npx cds deploy`
2. `npm run build --prefix app/catalog`
3. Test executions with `$env:CDS_ENV="test"` and sequential concurrency (`--test-concurrency=1`):
   - `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/backend_tests.test.js test/auth_enforcement.test.js test/dynamic_generation.test.js`
   - `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/direct_sync_dispatcher.test.js test/databricks_sync.test.js test/databricks_client.test.js test/databricks_stress.test.js`
   - `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/e2e_direct_sync.test.js`
   - Run all test suites across the repository to verify 100% pass rate.

---

## Output Requirements
Write your detailed handoff report to:
`c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m5\handoff.md`
Report structure:
1. **Observation**: Exact files created, modified, or deleted.
2. **Logic Chain**: Technical rationale and details of changes.
3. **Caveats**: Any edge cases or limitations.
4. **Conclusion**: Implementation summary.
5. **Verification**: Full command lines and outputs for builds and tests.
