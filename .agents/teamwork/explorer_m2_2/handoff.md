# Handoff Report: Databricks Unity Catalog Effective Restriction Resolution & Policy Aggregation

**Author**: Explorer 2  
**Role**: Investigation & Synthesis (Milestone 2)  
**Location**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2\handoff.md`  
**Related Document**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2\report.md`  
**Git Branch**: `feature/databricks-direct-sync`  
**Date**: 2026-11-01  

---

## 1. Observation

1. **`srv/lib/resolveEffectiveRestrictions.js` lines 10–95**:
   - `resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances = [])` uses a depth-first traversal with a `visiting` set detecting cycles (throws `Error("Circular inheritance detected at role: ...")`) and a `resolved` set skipping repeated nodes in DAGs.
   - At lines 42–58, parents are visited recursively *before* own restrictions are added:
     ```javascript
     const parents = inheritanceMap.get(currentRoleId) || [];
     for (const relation of parents) {
       walk(relation.parent_ID, false);
     }
     const ownRestrictions = restrictionsMap.get(currentRoleId) || [];
     for (const restriction of ownRestrictions) {
       result.push({ ... });
     }
     ```
     This produces an ancestor-first array order in `result`.
   - At lines 71–93, a backward pass from leaf descendants to root ancestors discards ancestor wildcard restrictions:
     ```javascript
     const isPatternRestriction = (r) => {
       if (!r) return false;
       const ft = (r.filterType || '').toUpperCase();
       const val = String(r.value || '').trim();
       if (ft === 'ALL' || ft === 'CP') return true;
       if (val === '*' || val.includes('*') || val.includes('?')) return true;
       return false;
     };

     for (let i = result.length - 1; i >= 0; i--) {
       const r = result[i];
       const fieldLower = r.field.toLowerCase();

       if (isPatternRestriction(r)) {
         if (fieldsRestrictedByDescendants.has(fieldLower)) {
           continue; // discard ancestor pattern/wildcard restriction
         }
       }

       fieldsRestrictedByDescendants.add(fieldLower);
       finalResult.unshift(r);
     }
     ```

2. **`srv/services/hanaReplicationService.js` lines 234–259**:
   - `fetchRoleAncestryChain(db, roleId, entities)` uses a queue-based BFS over `RoleInheritance` to gather all ancestor role IDs, followed by `SELECT.from(Roles)` and `SELECT.from(Restrictions)` for those IDs.
   - It is already exported at line 444: `module.exports = { ... fetchRoleAncestryChain, ... }`.

3. **`test/backend_tests.test.js` lines 362–398**:
   - Test `resolveEffectiveRestrictions overrides parent wildcard restriction if child restricts same field`: Parent has `Country = '*'`, Child has `Country = 'DE'`. The resolved array contains solely `Country = 'DE'`.

4. **`test/e2e_direct_sync.test.js` lines 839–875 (Test T2.7)**:
   - Chain: Grandparent A (`Plant = '*'`, `Country = 'DE'`) $\to$ Parent B $\to$ Child C (`Plant = 'DE01'`).
   - `resolveEffectiveRestrictions('role_c', roles, restrictions, inheritances)` successfully produces 2 restrictions: `Plant = 'DE01'` and `Country = 'DE'`.
   - Execution confirms this unit test passes cleanly under Node v24.

5. **`test/e2e_direct_sync.test.js` lines 984–1013 (Test T3.3)**:
   - Verifies that multiple users assigned to the same role generate composite `OR` predicates: `current_user() = 'alice@fanrio.corp' ... OR current_user() = 'bob@fanrio.corp' ...`.

6. **`test/e2e_direct_sync.test.js` lines 1020–1168 (Test T4.1)**:
   - Verifies full policy lifecycle: create role $\to$ assign Alice $\to$ assign Bob $\to$ revoke Alice $\to$ revoke Bob $\to$ `ALTER TABLE ... DROP ROW FILTER` and drop function.

---

## 2. Logic Chain

1. From Observation 1 & 3: `resolveEffectiveRestrictions` visits descendants after ancestors in `result`, then iterates backwards from `result.length - 1` down to `0`. Any field defined by a descendant is added to `fieldsRestrictedByDescendants`. When an ancestor restriction on that field has `filterType === 'ALL'`, `filterType === 'CP'`, or `val.includes('*')` / `val.includes('?')`, it is skipped. Therefore, ancestor wildcards are discarded while explicit descendant restrictions prevail.

2. From Observation 1 & 4: In multi-level inheritance chains (depth $\ge 3$), this backward traversal applies transitively. Even if the wildcard was introduced 2 or more levels up (Grandparent), because the descendant at the leaf adds the field to `fieldsRestrictedByDescendants`, any upstream pattern restriction on that field is discarded, while non-pattern restrictions from all levels are retained.

3. From Observation 2: `fetchRoleAncestryChain` loads only the connected subgraph of ancestor roles and their restrictions from the database using BFS, avoiding full-table scans. Because it operates on database entities `Roles`, `Restrictions`, and `RoleInheritance`, it is completely platform-agnostic and can be directly reused for Databricks.

4. From Observation 5 & 6: Databricks Unity Catalog applies row-level security using a single Row Filter function per table. Therefore:
   - All role assignments belonging to the Access Domain / table must be combined into a single function return expression.
   - For each user $u$, all roles assigned to $u$ targeting the table must be disjoined: $( \text{role}_1 \lor \text{role}_2 )$.
   - Each role's restrictions across fields must be conjoined: $( \text{field}_1 \land \text{field}_2 )$.
   - Across different users, expressions are joined with `OR`: $( \text{current\_user}() = u_1 \land \dots ) \lor ( \text{current\_user}() = u_2 \land \dots )$.
   - Administrator bypass is prepended with `is_account_group_member('admin') OR`.
   - When all assignments are deleted, dropping the filter via `ALTER TABLE ... DROP ROW FILTER;` and `DROP FUNCTION IF EXISTS ...;` cleanly restores table access without orphaned policies.

---

## 3. Caveats

1. **Hierarchy Restrictions in Databricks**: Unlike SAP HANA which writes hierarchy records into a separate `_hier_authorizations` flat table, Databricks Unity Catalog SQL row filters evaluate column values directly. Hierarchical filters without explicit leaf values evaluate to `TRUE` (unrestricted) unless mapped to a specific column condition.
2. **Multiple Explicit Restrictions on Same Field within a Single Role**: If a role defines two separate explicit restrictions on the same field (e.g. `Company = '1000'` and `Company = '2000'`), in Databricks boolean logic they must be combined with `OR` (i.e. `(Company = '1000' OR Company = '2000')`), because `AND` would evaluate to `FALSE`. The provided helper `buildCompositeUserPredicates` groups restrictions by field to ensure `OR` semantics for intra-field alternatives and `AND` semantics across distinct fields.
3. **No Active Assignments / Empty Domain**: When 0 assignments remain for a domain, the filter must be dropped rather than creating a function with no user predicates, otherwise all non-admin users would be blocked from querying the table.

---

## 4. Conclusion

- `srv/lib/resolveEffectiveRestrictions.js` and `fetchRoleAncestryChain` are directly compatible with Databricks Unity Catalog policy synchronization and require no modifications to their core resolution logic.
- Effective restrictions for Databricks target roles are resolved by calling `fetchRoleAncestryChain` followed by `resolveEffectiveRestrictions`, which cleanly handles multi-level inheritance (depth $\ge 3$) and wildcard overrides.
- Databricks policy synchronization must operate at the **Access Domain (table)** level, aggregating all user assignments across all roles for that domain into a single composite filter function using Disjunctive Normal Form (DNF).
- Full reference implementations of `getDomainDatabricksAssignments`, `buildCompositeUserPredicates`, and `syncDomainPoliciesToDatabricks` are documented in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2\report.md` for Worker.

---

## 5. Verification Method

To verify these findings and the contract implementations independently:

1. **Unit Verification of Wildcard Override & Multi-Level Inheritance (Depth $\ge 3$)**:
   ```powershell
   $env:CDS_ENV="test"; node --test --test-name-pattern="T2.7" test/e2e_direct_sync.test.js
   ```
   *Expected output*: Subtest `T2.7: Multi-level role inheritance depth (>=3) overrides parent wildcards for Databricks` passes.

2. **Unit Verification of Multiple Users Composite Predicate**:
   ```powershell
   $env:CDS_ENV="test"; node --test --test-name-pattern="T3.3" test/e2e_direct_sync.test.js
   ```
   *Expected output*: Subtest `T3.3: Multiple users assigned to the same Databricks role generates composite OR predicates` passes.

3. **Backend Integration Tests**:
   ```powershell
   $env:CDS_ENV="test"; node --test --test-name-pattern="resolveEffectiveRestrictions" test/backend_tests.test.js
   ```
   *Expected output*: `resolveEffectiveRestrictions action` and `resolveEffectiveRestrictions overrides parent wildcard restriction` pass.

4. **Invalidation Condition**:
   - If an ancestor wildcard is retained when a descendant specifies an explicit value, `assert.strictEqual(countryRestrictions.length, 1)` or `assert.strictEqual(plantRestr.value, 'DE01')` will fail.
