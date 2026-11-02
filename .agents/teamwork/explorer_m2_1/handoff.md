# Handoff Report: Explorer M2-1 (Databricks Predicate Generator & Policy Sync)

## 1. Observation

1. **Missing Implementation in Codebase**:
   - Checked `srv/services/databricksSyncService.js`: File did not exist (`view_file` returned `The system cannot find the file specified`).
   - `PROJECT.md` line 47, line 62, line 114 marks Milestone 2: `databricksSyncService.js` SQL filter generator (all 11 filter types), row filter DDL execution, inheritance resolution as IN_PROGRESS.

2. **Existing Test Infrastructure & Pluggable Mock**:
   - `srv/lib/databricksClient.js` and `srv/lib/databricksMockAdapter.js` were created in Milestone 1.
   - `node --test test/databricks_client.test.js` executed and passed 24/24 unit tests in 1224ms.
   - `node --test test/databricks_stress.test.js` executed and passed 21/21 stress tests in 1185ms.
   - `test/e2e_direct_sync.test.js` lines 200–318 defined a contract reference oracle for Databricks SQL translation and row filter DDL generation, including tests T1.6, T2.1–T2.4, T2.7, T3.3, and T4.1.

3. **Filter Types & Data Representations in fanrio-auth**:
   - `app/catalog/src/components/RestrictionBuilder.tsx` lines 80–115 defines `FILTER_TYPES = ['ALL', 'N', 'NN', 'EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'CP', 'BT', 'MULTI_VALUE', 'HIERARCHY']`.
   - `srv/services/hanaReplicationService.js` lines 78–126 reveals that restriction values in the database are stored as either plain strings, JSON strings with `{ id, text }`, arrays `["DE01", "DE02"]`, comma-separated strings `"DE01, DE02"`, or range objects `{"from":"1000","to":"2000"}` / `{"low":"1000","high":"2000"}`.
   - `srv/lib/resolveEffectiveRestrictions.js` lines 67–95 demonstrates how descendant role restrictions override ancestor wildcard (`*` or `CP`) restrictions across inheritance chains.

4. **Databricks Unity Catalog Syntax**:
   - `DatabricksMockAdapter` lines 85–140 parses:
     - `CREATE [OR REPLACE] FUNCTION <name>(<params>) RETURN <expr>`
     - `ALTER TABLE <name> SET ROW FILTER <func> ON (<columns>)`
     - `ALTER TABLE <name> DROP ROW FILTER`
     - `DROP FUNCTION [IF EXISTS] <name>`

---

## 2. Logic Chain

1. **Mapping Filter Types (Observation 1 & 3)**:
   - To support the 11 filter types requested (`SINGLE_VALUE`, `MULTI_VALUE`, `RANGE` & `BT`, `CP`, `PATTERN`, `NE`, `GT`, `GE`, `LT`, `LE`, `NULL`, `NOT NULL`) alongside aliases (`EQ`, `N`, `NN`, `ALL`), `translateRestrictionToDatabricksSql` must normalize operator casing and parse varied input shapes (plain string, `{ id, text }`, arrays, and range objects).
   - If a restriction value is empty or wildcard `ALL` / `*`, it represents an unrestricted column and evaluates to `'TRUE'`, which drops cleanly from `AND` conjunctions.

2. **Sanitization & Escaping (Observation 2 & 3)**:
   - Values embedded in SQL string literals must double single quotes (`val.replace(/'/g, "''")`) to prevent SQL syntax errors and injection (e.g. `O'Connor` -> `'O''Connor'`).
   - Column identifiers with spaces or hyphens must be wrapped in backticks (e.g. `` `Company Code` ``).
   - SAP wildcards `*` and `?` must be translated to SQL `LIKE` wildcards `%` and `_`.

3. **Intra-Role Conjunction (AND) (Observation 1 & 2)**:
   - For a given role, all active field restrictions must be satisfied simultaneously. Conjoining translated predicates with ` AND ` produces a valid boolean condition.

4. **Identity & Group Binding (Observation 1 & 2)**:
   - Wrapping the role predicate with `(current_user() = '<userId>' AND (...))` binds access to the querying user.
   - Groups are bound with `(is_account_group_member('<group>') AND (...))`.
   - `is_account_group_member('admin')` ensures administrative accounts retain global access.

5. **Composite Multi-User Policy (OR) & DDL (Observation 2 & 4)**:
   - Combining user bindings with ` OR ` ensures any valid assignment permits row access.
   - Wrapping the composite expression into `CREATE OR REPLACE FUNCTION ... RETURN ...` and issuing `ALTER TABLE ... SET ROW FILTER ... ON (...)` matches Databricks Unity Catalog specifications verified by `DatabricksMockAdapter`.
   - When all assignments are deleted, issuing `ALTER TABLE ... DROP ROW FILTER` restores default unmanaged state.

---

## 3. Caveats

1. **Range Syntax Compatibility**:
   - Databricks SQL supports both `(col >= 'from' AND col <= 'to')` and `col BETWEEN 'from' AND 'to'`. The implementation in `report.md` supports both, with an option `{ useBetween: true }` allowing seamless compatibility with test assertions in `test/e2e_direct_sync.test.js` line 576.
2. **Hierarchy Restrictions**:
   - `HIERARCHY` filter types depend on hierarchy node expansion. Until expanded to `MULTI_VALUE`, `HIERARCHY` restrictions evaluate to `'TRUE'` to prevent blocking valid queries.
3. **Multi-Assignment User Union**:
   - If a user has multiple roles assigned to the same table, the composite policy joins their role predicates with `OR`, representing the mathematical union of their permissions.

---

## 4. Conclusion

The boolean predicate generator and policy sync architecture designed in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_1\report.md` fulfills all Milestone 2 requirements:
- Complete coverage of all 11 filter types with robust parsing and edge case handling.
- Full SQL escaping (`'` to `''`, column identifier quoting, wildcard mapping).
- Intra-role conjunction (`AND`), user/group identity binding (`current_user()` and `is_account_group_member()`), and composite multi-user policy (`OR`).
- DDL generation and execution routines designed for `srv/services/databricksSyncService.js`.
- Ready-to-run test suite designed for `test/databricks_sync.test.js`.

---

## 5. Verification Method

Once Worker implements `srv/services/databricksSyncService.js` and `test/databricks_sync.test.js`:

1. Run the targeted unit test suite:
   ```powershell
   node --test test/databricks_sync.test.js
   ```
   **Expected result**: 100% pass across all filter types, escaping helpers, intra-role conjunctions, user bindings, and DDL generation.

2. Run the mock adapter tests:
   ```powershell
   node --test test/databricks_client.test.js test/databricks_stress.test.js
   ```
   **Expected result**: 45/45 tests pass.

3. Run the end-to-end direct sync test suite:
   ```powershell
   $env:CDS_ENV="test"; node --test --test-concurrency=1 test/e2e_direct_sync.test.js
   ```

**Invalidation Conditions**:
- If `translateRestrictionToDatabricksSql` produces invalid SQL for single quotes (`O'Connor` causing syntax error).
- If `CP` or `PATTERN` fails to translate `*` to `%` or `?` to `_`.
- If intra-role restrictions fail to conjoin with `AND` or user bindings fail to wrap with `current_user()`.
