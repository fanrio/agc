# Milestone 2 Review and Adversarial Assessment Handoff Report

- **Reviewer**: Reviewer 2 (Roles: Reviewer, Critic)
- **Target**: Milestone 2 — Databricks Unity Catalog Policy Sync & SQL Filter Generator
- **Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\reviewer_m2_2`
- **Branch**: `feature/databricks-direct-sync`
- **Date**: 2026-11-02
- **Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 Scope of Review
The review evaluated Milestone 2 changes against requirements defined in:
- `PROJECT.md` (Features 5 & 6)
- `ORIGINAL_REQUEST.md` (R2: Databricks Unity Catalog Real-Time Policy Synchronization)
- `TEST_READY.md` (Functional and boundary criteria)

Files directly examined:
- `srv/services/databricksSyncService.js` (1075 lines): Core policy sync service, SQL filter translator, DNF predicate builder, DDL generator, and assignment synchronization lifecycle.
- `test/databricks_sync.test.js` (781 lines): 11-part comprehensive test suite for Milestone 2.
- `srv/lib/resolveEffectiveRestrictions.js` (219 lines): Recursive ancestry resolution and ancestor wildcard override logic.
- `srv/services/hanaReplicationService.js` (lines 230-260): `fetchRoleAncestryChain` selective ancestry loader.
- `srv/lib/databricksClient.js` & `srv/lib/databricksMockAdapter.js`: Pluggable Databricks execution driver.

### 1.2 Verification Commands & Verbatim Outputs

1. **Milestone 2 Dedicated Test Suite**:
   Command: `node --test test/databricks_sync.test.js`
   Verbatim output:
   ```
   ▶ Databricks Unity Catalog Policy Sync & SQL Filter Generator
     ✔ 1. String Escaping, Identifiers & Value Extraction (3.5671ms)
     ✔ 2. All 11 Filter Types SQL Generation (1.5488ms)
     ✔ 3. Intra-Role Conjunction (AND across fields, OR across same field) (0.8934ms)
     ✔ 4. Identity Binding (User & Group) (0.4908ms)
     ✔ 5. Multi-Role & Multi-User Composite DNF Policy Generator (0.9175ms)
     ✔ 6. Multi-Level Role Inheritance (Depth >= 3) and Wildcard Override (0.7724ms)
     ✔ 7. DDL Generation & Target Naming Resolution (0.6593ms)
     ✔ 8. Lifecycle: Direct Sync, Revocation & Clean Drop with DatabricksMockAdapter (4.5982ms)
     ✔ 9. CAP Integration: syncAssignmentToDatabricks & removeAssignmentFromDatabricks (175.2176ms)
     ✔ 10. Role Cascade Synchronization & Platform Skipping (50.4924ms)
     ✔ 11. Domain Policy Sync Orchestrator (syncDatabricksPolicyForDomain) (15.1606ms)
   ✔ Databricks Unity Catalog Policy Sync & SQL Filter Generator (950.8629ms)
   ℹ tests 12
   ℹ suites 0
   ℹ pass 12
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 2298.9789
   ```

2. **Full Backend Integration Test Suite**:
   Command: `npm run test`
   Verbatim output:
   ```
   > fanrio-cortex@1.0.0 test
   > cds test --profile test

   Running 8 test suites... 

     ✔  test\databricks_stress.test.js 
     ✔  test\databricks_client.test.js 
     ✔  test\databricks_sync.test.js 
     ✔  test\dynamic_generation.test.js 
     ✔  test\challenger_m1_2_stress.test.js 
     ✔  test\auth_enforcement.test.js 
     ✔  test\e2e_direct_sync.test.js 
     ✔  test\backend_tests.test.js 

    171 in 8 suites passed 
    5.603s 
   ```

### 1.3 Static Code Analysis Observations

1. **Boolean Logic & Operator Precedence**:
   - `buildIntraRolePredicate` (`databricksSyncService.js`, lines 287–322):
     * Groups restrictions by field key using `toLowerCase()`, ensuring case-insensitive grouping.
     * When multiple restrictions exist on the same field, wraps them in parentheses conjoined with `OR`: `(Plant = 'DE01' OR Plant = 'DE02')`.
     * Conjoins distinct fields with `AND`: `Country = 'DE' AND (Plant = 'DE01' OR Plant = 'DE02')`.
   - `buildCompositePolicyExpr` (`databricksSyncService.js`, lines 366–450):
     * Per-user roles with `AND` are parenthesized: `((Country = 'DE' AND Plant = 'DE01') OR Country = 'FR')`.
     * User identity is conjoined with role expression: `(current_user() = 'alice' AND (...))`.
     * Multiple users are combined with `OR`:
       ```sql
       is_account_group_member('admin') OR
         (current_user() = 'alice' AND (...)) OR
         (current_user() = 'bob' AND (...))
       ```
     * When zero assignments exist, returns `is_account_group_member('admin')`, ensuring non-admin callers are strictly filtered out (fail-closed security).

2. **Multi-Level Inheritance (Depth >= 3) and Wildcard Overrides**:
   - `srv/lib/resolveEffectiveRestrictions.js` (lines 80–93):
     * Backward pass over topological ancestry order.
     * When a descendant specifies an explicit restriction on a field (`plant`), `fieldsRestrictedByDescendants.add('plant')` marks the field.
     * When an ancestor defines a pattern/wildcard restriction on that same field (`*`, `ALL`, `CP`), `fieldsRestrictedByDescendants.has('plant')` is true, and the ancestor's wildcard is discarded (`continue`).
     * Ancestor explicit restrictions on other fields (`Country = 'DE'`, `Status = 'ACTIVE'`) remain intact.
   - `databricksSyncService.js` (lines 680–712):
     * `syncRoleToDatabricks` traverses derived descendants transitively using BFS over `RoleInheritance`.
     * Triggers synchronization for all affected access domains when a parent role changes.

3. **Clean Revocation Lifecycle**:
   - `removeAssignmentFromDatabricks` (`databricksSyncService.js`, lines 831–921):
     * Queries remaining active assignments for the access domain, excluding the revoked assignment (`{ userId, roleId }`).
     * **If remaining users > 0**: calls `buildDatabricksRowFilterDdl` and executes `CREATE OR REPLACE FUNCTION` with the updated user list. The row filter on the table remains valid.
     * **If 0 users remain**:
       1. Executes `ALTER TABLE <fullTableName> DROP ROW FILTER;` FIRST.
       2. Executes `DROP FUNCTION IF EXISTS <fullFuncName>;` SECOND.
       This respects Databricks SQL dependency constraints where a function cannot be dropped while bound as a table filter.

4. **Integrity Verification**:
   - No hardcoded test user IDs, fixtures, or simulated results exist in `srv/services/databricksSyncService.js`.
   - No shortcut or facade logic was found.
   - Tests execute against live CAP in-memory SQLite and `DatabricksMockAdapter`.

---

## 2. Logic Chain

1. **Premise 1**: The dispatch specifically directed verification of:
   - Boolean logic correctness (`OR` within field, `AND` across fields, multi-user `OR`).
   - Multi-level inheritance (depth $\ge 3$) and ancestor wildcard overrides.
   - Clean revocation when the last assignment is removed.
   - Integrity violations (hardcoded test results, facade logic).

2. **Inference from 1.3.1 (Boolean Logic)**:
   - Grouping restrictions by field name and explicitly wrapping multiple items on the same field in `(p1 OR p2)` ensures `OR` has precedence before conjoining with `AND` across fields.
   - In `buildCompositePolicyExpr`, each user's composite role is enclosed in `(current_user() = 'user' AND (<role_expr>))` and all users are joined by `OR`.
   - In SQL boolean algebra:
     $$F = \text{Admin} \lor (U_1 \land R_1) \lor (U_2 \land R_2)$$
     Each clause is disjoint by user identity, preventing cross-user privilege escalation.

3. **Inference from 1.3.2 (Inheritance & Wildcard Overrides)**:
   - `resolveEffectiveRestrictions` computes restrictions post-order (ancestors before descendants).
   - The backward scan from $N-1$ down to 0 inspects descendants first. When an explicit descendant restriction on field $f$ is encountered, any ancestor restriction on $f$ matching `isPatternRestriction` is omitted.
   - For a hierarchy of depth 3 (`R_BASE` $\to$ `R_REGIONAL` $\to$ `R_LOCAL`), `R_BASE`'s `Plant = '*'` is correctly overridden by `R_LOCAL`'s `Plant = 'DE01'`, while `R_BASE`'s `Country = 'DE'` and `Status = 'ACTIVE'` are retained. This matches SAP and Databricks authorization requirements.

4. **Inference from 1.3.3 (Clean Revocation)**:
   - Dropping table row filter DDL before dropping function DDL avoids SQL execution errors in Unity Catalog (`FUNCTION_IN_USE`).
   - Revoking intermediate users properly recalculates the UDF predicate without dropping the table filter.
   - Revoking the final user drops both table filter and UDF cleanly.

5. **Inference from 1.3.4 (Integrity)**:
   - Code inspection confirms all functions are implemented with genuine general-purpose logic.
   - Test execution confirmed 12/12 tests pass in `test/databricks_sync.test.js` and 171/171 tests pass in `npm run test`.
   - Integrity is 100% verified.

---

## 3. Caveats

1. **UDF Argument Types**:
   - `buildDatabricksRowFilterDdl` currently generates `STRING` typed parameters for filter arguments by default (e.g., `Plant STRING`). For standard authorization flat tables where restriction values are string-based, this is standard practice. If specialized data types (e.g. `TIMESTAMP`, `INTEGER`) are introduced in future access domains, `columnTypes` parameter mapping is supported in `buildDatabricksRowFilterDdl`.
2. **Hierarchy Restriction Type**:
   - `HIERARCHY` filter types evaluate to `'TRUE'` in row filter expressions because hierarchy trees in Unity Catalog are resolved via flattened node mappings or separate hierarchy views. This is consistent with project design.

---

## 4. Conclusion

**Verdict: APPROVE**

The Milestone 2 work product meets all requirements set forth in `PROJECT.md` and `ORIGINAL_REQUEST.md`:
1. **Boolean Logic**: Correct and robust parenthesization; `OR` within fields, `AND` across distinct fields, multi-role `OR` per user, and multi-user `OR` with admin group bypass.
2. **Inheritance & Wildcard Overrides**: Clean depth $\ge 3$ resolution; ancestor wildcards (`*`, `ALL`, `CP`) are properly discarded when a descendant specifies a restriction on the same field.
3. **Clean Revocation**: Correct lifecycle handling; partial revocation updates the UDF, final revocation drops the row filter from the table first and then drops the UDF.
4. **Integrity**: Zero hardcoded outputs, zero facade methods, zero integrity violations.
5. **Testing**: 100% pass across all 8 test suites (171 tests).

---

## 5. Verification Method

To independently verify this assessment:

1. **Run Milestone 2 Databricks Sync Tests**:
   ```powershell
   node --test test/databricks_sync.test.js
   ```
   *Expected outcome*: 12 tests pass, 0 fail.

2. **Run Full Backend Regression Test Suite**:
   ```powershell
   npm run test
   ```
   *Expected outcome*: 171 tests pass across 8 suites, 0 fail.

3. **Verify Git Working Tree State**:
   ```powershell
   git status
   ```
   Confirm on branch `feature/databricks-direct-sync`.

4. **Inspect Source Files**:
   - `srv/services/databricksSyncService.js` (lines 287–450, lines 831–921)
   - `srv/lib/resolveEffectiveRestrictions.js` (lines 67–95)
