# Milestone 2 Empirical Challenge Report: Databricks Policy Sync Lifecycle

- **Agent**: Challenger 2 (Milestone 2)
- **Role**: critic / specialist
- **Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\challenger_m2_2`
- **Branch**: `feature/databricks-direct-sync`
- **Date**: 2026-11-01
- **Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 Evaluated Scope
Under instructions from `DISPATCH.md`, this review empirically stress-tested the policy synchronization lifecycle in `srv/services/databricksSyncService.js` and `srv/lib/databricksMockAdapter.js`:
1. Multi-user concurrent policy updates across the same access domain.
2. Full lifecycle: adding user 1, adding user 2, updating user 1's role, removing user 1, removing user 2.
3. Verification that `DatabricksMockAdapter` records the exact expected DDL statements:
   - `CREATE OR REPLACE FUNCTION` on updates
   - `ALTER TABLE ... SET ROW FILTER` on attachment
   - `ALTER TABLE ... DROP ROW FILTER` followed by `DROP FUNCTION IF EXISTS` when 0 users remain.
4. Table naming, function naming, special characters, and sanitized domains.
5. Error handling, adapter failure modes, and platform skipping (`DATASPHERE`).

### 1.2 Created Test Artifact
- `test/challenger_m2_2_stress.test.js`: Comprehensive empirical stress test suite containing 5 major test suites and 6 test blocks specifically targeting concurrency, complete lifecycle, DDL inspection, identifier sanitization, and fault injection.

### 1.3 Verbatim Execution Commands and Outputs

1. **Empirical Challenger Stress Test Execution**:
   Command: `node --test test/challenger_m2_2_stress.test.js`
   Result:
   ```
   ▶ Challenger 2 Empirical Stress Tests: Databricks Policy Sync Lifecycle & Concurrency
     ✔ 1. Multi-User Concurrent Policy Updates across the Same Domain (771.0925ms)
     ✔ 2. Full Lifecycle Sequence with State Transitions & Complete Revocation (116.6179ms)
     ✔ 3. Exact DDL Statement Verification in DatabricksMockAdapter (87.9212ms)
     ✔ 4. Table Naming, Function Naming, Special Characters & Sanitization (1.8365ms)
     ✔ 5. Adapter Failure Modes, Error Recovery & Platform Skipping (84.4295ms)
   ✔ Challenger 2 Empirical Stress Tests: Databricks Policy Sync Lifecycle & Concurrency (1870.5433ms)
   ℹ tests 6
   ℹ suites 0
   ℹ pass 6
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 2603.2652
   ```

2. **Full Integration Test Suite Execution**:
   Command: `npm run test`
   Result:
   ```
   > fanrio-cortex@1.0.0 test
   > cds test --profile test

   Running 10 test suites... 

     ✔  test\challenger_m2_1_stress.test.js 
     ✔  test\databricks_client.test.js 
     ✔  test\databricks_stress.test.js 
     ✔  test\auth_enforcement.test.js 
     ✔  test\challenger_m1_2_stress.test.js 
     ✔  test\challenger_m2_2_stress.test.js 
     ✔  test\databricks_sync.test.js 
     ✔  test\dynamic_generation.test.js 
     ✔  test\e2e_direct_sync.test.js 
     ✔  test\backend_tests.test.js 

    198 in 10 suites passed 
    5.690s 
   ```

3. **Frontend Production Build**:
   Command: `npm run build --prefix app/catalog`
   Result:
   ```
   > catalog@1.0.0 build
   > vite build

   vite v8.0.16 building client environment for production...
   transforming...✓ 2850 modules transformed.
   rendering chunks...
   computing gzip size...
   dist/index.html                                        1.45 kB │ gzip:   0.67 kB
   ...
   ✓ built in 1.01s
   ```

---

## 2. Logic Chain

1. **Multi-User Concurrent Policy Updates (Suite 1)**:
   - *Observation*: Tested 10 concurrent assignment syncs across the same access domain using `Promise.all` (`test/challenger_m2_2_stress.test.js:129-140`).
   - *Reasoning*: Each assignment synchronization reads the domain roles and assignments and builds an idempotent composite DNF return expression. In the mock adapter, all 10 concurrent statements completed without race conditions, and the final filter function `fn_filter_<domain>` contained `current_user() = 'user_i'` for every single user (0 through 9). Mixed concurrent updates and removals (3 users removed while 1 updated) correctly purged the revoked users while maintaining retained users in the return expression.

2. **Full Lifecycle Sequence & Revocation (Suite 2)**:
   - *Observation*: Step 2.1 added User 1 (Country = 'DE', Plant IN ('DE01', 'DE02')); Step 2.2 added User 2 (Region = 'APAC'); Step 2.3 updated User 1 to ROLE_1_V2 (Country = 'FR', CompanyCode = '1000'); Step 2.4 removed User 1; Step 2.5 removed User 2 (`test/challenger_m2_2_stress.test.js:219-417`).
   - *Reasoning*:
     - In Step 2.1, `fn_filter` was created and row filter attached with columns `(Country, Plant)`.
     - In Step 2.2, `fn_filter` was updated to contain both User 1 and User 2.
     - In Step 2.3, updating User 1 replaced the previous restriction predicates with `Country = 'FR'` and `CompanyCode = '1000'` without corrupting User 2's `Region = 'APAC'` predicate.
     - In Step 2.4, removing User 1 reduced `remainingCount` to 1, updating `fn_filter` to only contain User 2 while keeping the row filter attached to the table (`appliedRowFilters.size === 1`).
     - In Step 2.5, removing User 2 reduced `remainingCount` to 0 (`dropped: true`), successfully dropping the row filter from the table and deleting the function from the catalog (`appliedRowFilters.size === 0`, `filterFunctions.size === 0`).

3. **Exact DDL Statements Recorded in DatabricksMockAdapter (Suite 3)**:
   - *Observation*: Inspected `mockAdapter.getExecutedStatements()` across all lifecycle stages (`test/challenger_m2_2_stress.test.js:423-537`).
   - *Reasoning*:
     - On initial creation: Statement 1 was `CREATE OR REPLACE FUNCTION <catalog>.<schema>.fn_filter_<domain>(<signature>) RETURN <expr>;` and Statement 2 was `ALTER TABLE <catalog>.<schema>.<domain>_flat_authorizations SET ROW FILTER <func> ON (<cols>);`.
     - On partial revocation (users remain): exactly 1 statement executed (`CREATE OR REPLACE FUNCTION ...`). The service correctly avoids re-executing `ALTER TABLE ... SET ROW FILTER` when the filter is already attached.
     - On complete revocation (0 users remain): exactly 2 statements executed in strict order:
       1. `ALTER TABLE <catalog>.<schema>.<domain>_flat_authorizations DROP ROW FILTER;`
       2. `DROP FUNCTION IF EXISTS <catalog>.<schema>.fn_filter_<domain>;`
     - This order is required by Databricks Unity Catalog because a SQL function cannot be dropped while actively referenced by an existing table row filter.

4. **Table Naming, Function Naming & Domain Sanitization (Suite 4)**:
   - *Observation*: Evaluated `sanitizeDomainName` and `resolveTargetNaming` across edge cases, punctuation, spaces, accents, and SQL injection payloads (`test/challenger_m2_2_stress.test.js:543-620`).
   - *Reasoning*:
     - Punctuation like `"Sales-EMEA"` sanitizes to `sales_emea`; `"Finance / Controlling (FICO)"` sanitizes to `finance___controlling__fico`.
     - SQL injection payloads like `"sec'; DROP TABLE auth; --"` sanitize strictly to `sec___drop_table_auth`, completely stripping quotes, semicolons, and dashes.
     - Leading and trailing underscores are stripped (`replace(/^_+|_+$/g, '')`), and empty/all-special strings fall back safely to `'global'`.
     - Custom catalog (`targetCatalog`) and schema (`targetSchema`) settings are properly bound into `fullTableName` and `fullFuncName`.
     - Unsafe column names (with spaces or invalid identifier characters) are filtered out to prevent DDL syntax errors, and empty column lists fall back safely to `['id']`.

5. **Fault Injection & Platform Skipping (Suite 5)**:
   - *Observation*: Evaluated `AUTH_FAIL` (401), `WAREHOUSE_UNAVAILABLE` (503), `TIMEOUT` (504), simulated DROP statement errors, and `DATASPHERE` target platform (`test/challenger_m2_2_stress.test.js:625-738`).
   - *Reasoning*:
     - Errors are propagated with correct HTTP status codes when `executeStatement` fails.
     - Non-critical DROP errors during assignment revocation are caught and logged as notices without crashing the service or leaving unhandled rejections.
     - Roles with `targetPlatform: 'DATASPHERE'` are cleanly skipped (`skipped: true, platform: 'DATASPHERE'`) without issuing any Databricks DDL.

---

## 3. Caveats

No caveats.
The service and mock adapter implementation are verified to be thread-safe in Node.js event-loop concurrency, enforce exact DDL statement ordering, handle all edge cases on names and identifiers cleanly, and pass all 10 test suites (198 tests) with 0 regressions.

---

## 4. Conclusion

**Verdict: APPROVE**

The Databricks Unity Catalog Policy Synchronization implementation in `srv/services/databricksSyncService.js` and `srv/lib/databricksMockAdapter.js`:
- Successfully handles concurrent multi-user policy synchronization without state corruption.
- Correctly handles the complete lifecycle of adding, updating, and revoking role assignments.
- Executes and records the exact expected DDL statements: `CREATE OR REPLACE FUNCTION` on updates, `ALTER TABLE ... SET ROW FILTER` on attachment, and `ALTER TABLE ... DROP ROW FILTER` followed by `DROP FUNCTION IF EXISTS` upon complete revocation.
- Robustly sanitizes domain and identifier names, neutralizing SQL injection vectors.
- Fully satisfies all requirements for Milestone 2.

---

## 5. Verification Method

To independently verify the empirical stress tests and full regression suite:

1. **Run Challenger 2 Empirical Stress Test Suite**:
   ```powershell
   node --test test/challenger_m2_2_stress.test.js
   ```
   *Expected outcome*: 6 tests pass, 0 fail.

2. **Run Full Backend Integration Test Suite**:
   ```powershell
   npm run test
   ```
   *Expected outcome*: 198 tests pass across 10 test suites, 0 fail.

3. **Run Frontend Production Build**:
   ```powershell
   npm run build --prefix app/catalog
   ```
   *Expected outcome*: Production bundle builds in ~1s with 0 errors.
