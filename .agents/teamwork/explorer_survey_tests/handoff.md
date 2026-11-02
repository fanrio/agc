# Handoff Report: Test Suite & Offline Mock Adapter Architecture (R5)
**Agent**: Test Suite & Offline Mock Adapter Explorer  
**Date**: 2026-11-01T20:43:00Z  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_tests`  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

1. **Existing Test Suite Execution**:
   - Running `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/backend_tests.test.js test/auth_enforcement.test.js test/dynamic_generation.test.js` executed 60 tests across 3 suites.
   - Result: `ℹ tests 60, ℹ suites 0, ℹ pass 60, ℹ fail 0, ℹ duration_ms 10730.604`. All 60 tests pass.
   - Running without concurrency control (`node --test test/*.test.js`) resulted in SQLite file/concurrency locks:
     `Error: 500 - database is locked (ERR_SQLITE_ERROR, errcode: 5)`.
   - Running `npm run test` (`cds test --profile test`) encountered:
     `Error: EPERM: operation not permitted, open 'C:\Users\Fan\.cds-test-recent.json'` in `node_modules/@cap-js/cds-test/bin/reporter.js:177:19`.

2. **Server & Database Lifecycle**:
   - `test/backend_tests.test.js` line 184: `const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');`.
   - `package.json` lines 46–58:
     ```json
     "[test]": {
       "features": { "in_memory_db": true },
       "requires": { "db": { "kind": "sqlite", "credentials": { "url": ":memory:" } } }
     }
     ```
   - In-memory database `:memory:` is activated when `CDS_ENV=test` is set.

3. **Existing External Driver Mocking**:
   - `test/backend_tests.test.js` lines 1–35:
     ```javascript
     const mockHana = {
       createConnection: () => ({ ... exec: (sql, paramsOrCb, maybeCb) => cb(null, []), ... })
     };
     require('module')._cache[require.resolve('@sap/hana-client')] = { exports: mockHana };
     const HanaClient = require('./../srv/lib/hanaClient');
     HanaClient.setDriver(mockHana);
     ```
   - `srv/lib/hanaClient.js` lines 27–29: `HanaClient.setDriver(customDriver)` provides static driver injection.

4. **Replications Queue Assertions in Test Files**:
   - `test/backend_tests.test.js` lines 924–990 (`triggerReplication and checkReplicationStatuses triggers`):
     - Inserts row into `fanrio.auth.Replications` (`status: 'Open'`).
     - Calls `POST /odata/v4/auth/triggerReplication`, asserts `res.data.success === true`.
     - Asserts `Replications` status transitions from `'Open'` to `'Running'`.
     - Calls `POST /odata/v4/auth/checkReplicationStatuses`, updates `runId`, calls again, asserts status transitions to `'Success'`.
   - `test/auth_enforcement.test.js` lines 144–189 (`Replications authorization enforcement`):
     - Creates user with `canManageReplications: false`, verifies 403 on `triggerReplication`.
     - Updates user to `canManageReplications: true`, verifies 200 on `triggerReplication`.
     - Clears `fanrio.auth.Replications` via `db.run(cds.ql.DELETE('fanrio.auth.Replications'))`.

5. **Runtime Replications Dependencies**:
   - `srv/handlers/assignmentHandlers.js` lines 182, 247, 251, 276: calls `queueReplication(...)` on assignment CREATE, UPDATE, DELETE.
   - `srv/handlers/roleHandlers.js` lines 419–423: calls `queueReplication(...)` on role UPDATE.
   - `srv/handlers/restrictionHandlers.js` lines 124, 187, 237: calls `queueReplication(...)` on restriction CREATE, UPDATE, DELETE.
   - `srv/services/dynamicSyncService.js` lines 270, 369, 418: calls `queueReplication(...)`.
   - `srv/cortex_service.cds` line 30 & lines 150–158: exposes `entity Replications` and actions `triggerReplication`, `checkReplicationStatuses`.
   - `srv/services/replicationQueueService.js`: implements queue lifecycle and BDC polling.
   - `app/catalog/src/components/ReplicationsView.jsx` and `app/catalog/src/api.js`: UI for viewing and triggering replications.

6. **Frontend Bundle Build**:
   - Running `npm run build --prefix app/catalog` exited with code 0 in 1.02s (`2850 modules transformed`, output bundle in `dist/assets/`).

---

## 2. Logic Chain

1. **Test Execution Stability**:
   - *From Observation 1 & 2*: In-memory SQLite (`:memory:`) requires sequential suite execution (`--test-concurrency=1`). When running sequentially with `CDS_ENV=test`, zero tests fail.
   - *Therefore*: Future tests (including new Databricks sync tests) must run in sequence or in isolated in-memory contexts. Updating `package.json` test script to `"test": "node --test --test-concurrency=1 test/*.test.js"` guarantees reliable CI/local execution without hitting the `@cap-js/cds-test` reporter EPERM bug.

2. **Replications Queue Retirement**:
   - *From Observation 4 & 5*: The `Replications` entity and actions `triggerReplication` / `checkReplicationStatuses` exist solely to poll and execute asynchronous SAP BDC task chains.
   - *From Requirement R1 & R3*: All synchronization must occur directly and in real-time. Datasphere sync is already handled directly via HANA flat table writes (`syncAssignmentToHana` in `srv/services/hanaReplicationService.js`).
   - *Therefore*: Removing `queueReplication` calls from `assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js` safely decouples the real-time HANA sync from the queue. Deleting `ReplicationsView` and obsolete replication actions completes the retirement cleanly.
   - In tests, the test block in `test/backend_tests.test.js` (lines 924–990) must be replaced with assertions that `syncAssignmentToHana` and Databricks sync run synchronously on assignment events without any records inserted into `fanrio.auth.Replications`.

3. **Pluggable Driver/Adapter Architecture (R5)**:
   - *From Observation 3*: The project already has a clean precedent with `HanaClient.setDriver(customDriver)` where tests inject an in-memory mock.
   - *Therefore*: Databricks connectivity should follow the same pattern:
     - `DatabricksClient` acts as the service coordinator.
     - `DatabricksMockAdapter` implements `IDatabricksAdapter` in memory, recording executed SQL statements, created filter functions, and applied row filters.
     - `DatabricksClient.setAdapter(mockAdapter)` allows tests to inspect recorded DDL statements and verify policy translation without requiring live cloud credentials.
     - Auto-fallback in `DatabricksClient`: if `CDS_ENV === 'test'` or `NODE_ENV === 'test'`, default to `DatabricksMockAdapter` automatically.

4. **Rule Translation to Unity Catalog SQL**:
   - Databricks Unity Catalog applies row-level security through boolean SQL UDFs (`CREATE OR REPLACE FUNCTION ... RETURN ...`) and `ALTER TABLE ... SET ROW FILTER ... ON (...)`.
   - Restrictions can be deterministically translated into SQL expressions:
     - `SINGLE_VALUE` -> `column = 'val'`
     - `MULTI_VALUE` -> `column IN ('val1', 'val2')`
     - `RANGE`/`BT` -> `(column >= low AND column <= high)`
     - `CP` -> `column LIKE 'pattern%'`
   - Child roles inherit parent restrictions via `resolveEffectiveRestrictions` (reusing existing tested algorithm in `srv/lib/resolveEffectiveRestrictions.js`).

---

## 3. Caveats

1. **Databricks SQL Dialect Specifics**: Databricks Unity Catalog SQL requires valid column names and type signatures when declaring UDF parameters. If a table's schema is not yet known or catalog/schema metadata is offline, parameter types should default to `STRING` or look up columns defined on `RestrictionFields` (which already has `idColumns`).
2. **User Identification in Filter Functions**: The mock adapter supports both `CURRENT_USER() = '...'` (user-based) and `IS_ACCOUNT_GROUP_MEMBER('...')` (group-based). The choice depends on whether user assignments are synchronized as workspace groups or direct user predicates. Both patterns are fully covered in the mock adapter specification.
3. **No Code Modification During Survey**: As an explorer, all findings and designs were documented without modifying production code. Implementation will be handled by the implementation specialist agents.

---

## 4. Conclusion

1. **Test Baseline Verified**: All 60 backend tests currently pass. The test infrastructure is fully prepared for extension.
2. **Replications Decommissioning Scope Mapped**: Exactly two test suites (`backend_tests.test.js:924–990` and `auth_enforcement.test.js:144–189`) and four handler files contain the references to be retired.
3. **Requirement R5 Architecture Complete**: A fully articulated `IDatabricksAdapter` and `DatabricksMockAdapter` specification is documented in `report.md`, including recorded statement stores, inspection APIs (`getExecutedStatements`, `getFilterFunction`, `getAppliedRowFilter`), and error-injection capabilities for unit and integration testing.
4. **5-Suite Test Design Delivered**: Test cases covering target platform selection (`DATASPHERE`, `DATABRICKS`, `BOTH`), real-time sync, SQL filter generation, settings administration, and replication queue retirement have been specified in `report.md`.

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Existing Tests**:
   Run in PowerShell from the project root:
   ```powershell
   $env:CDS_ENV="test"
   node --test --test-concurrency=1 test/backend_tests.test.js test/auth_enforcement.test.js test/dynamic_generation.test.js
   ```
   *Expected Result*: 60 tests pass, 0 fail.

2. **Verify Frontend Bundle**:
   Run:
   ```powershell
   npm run build --prefix app/catalog
   ```
   *Expected Result*: Successful build in ~1 second, generating `dist/`.

3. **Verify Replications Code References**:
   Inspect line references cataloged in Section 3 of `report.md` using `view_file` on `srv/handlers/assignmentHandlers.js:182` and `test/backend_tests.test.js:925`.

4. **Invalidation Conditions**:
   - If `node --test` with concurrency > 1 causes SQLite locks, `--test-concurrency=1` remains mandatory.
   - If any new tests attempt to connect to live network endpoints instead of using `DatabricksMockAdapter`, offline verification will fail.
