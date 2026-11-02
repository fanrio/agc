# Milestone 2 Investigation Report: Databricks Effective Restriction Resolution & Role Inheritance

**Explorer 2**: Effective Restriction Resolution & Policy Aggregation  
**Target File**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2\report.md`  
**Date**: 2026-11-01  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_2`  
**Git Branch**: `feature/databricks-direct-sync`  

---

## 1. Executive Summary

In Milestone 2, `fanrio-auth` transitions to direct real-time policy synchronization for Databricks Unity Catalog. Unlike SAP HANA (which writes individual Cartesian product rows into a flat database table), Databricks Unity Catalog enforces row-level security using a **single Table Row Filter function** applied via `ALTER TABLE <catalog>.<schema>.<table> SET ROW FILTER <func> ON (<columns>)`.

This architectural difference requires:
1. **Accurate Resolution of Effective Restrictions**: Resolving the complete inheritance chain (`fetchRoleAncestryChain`) and ensuring descendant explicit restrictions override ancestor pattern/wildcard restrictions (`*`, `?`, `ALL`, `CP`), while preserving non-wildcard restrictions across multi-level inheritance chains (depth $\ge 3$).
2. **Cross-Platform Inheritance Support**: Derived roles targeting `DATABRICKS` or `BOTH` must inherit restrictions from parent roles regardless of whether the parent role's `targetPlatform` is `DATASPHERE`, `DATABRICKS`, or `BOTH`.
3. **Domain-Level Policy Aggregation**: All role assignments within an Access Domain (or table) must be consolidated into a unified SQL boolean expression:
   - Restrictions across different fields within a role are joined with `AND`.
   - Multiple alternative restrictions on the same field are joined with `OR`.
   - Multiple roles assigned to the same user are joined with `OR` under that user's identity: `(current_user() = 'user' AND ((role1) OR (role2)))`.
   - Multiple users assigned to the table are joined with `OR`.
   - Administrator bypass is prepended with `is_account_group_member('admin') OR`.
4. **Idempotent Lifecycle Management**: When assignments are created or updated, the filter function is recreated and re-applied; when all assignments for a domain are revoked, the filter is dropped via `ALTER TABLE ... DROP ROW FILTER` and `DROP FUNCTION IF EXISTS`.

---

## 2. Examination of Existing Codebase

### 2.1 `srv/lib/resolveEffectiveRestrictions.js`

The function `resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances = [])` computes the flattened list of effective restrictions for a role by traversing its inheritance graph.

#### Algorithmic Flow
1. **Pre-Indexing**:
   - `rolesMap`: Map of `roleId -> role` ($O(1)$ lookup).
   - `inheritanceMap`: Map of `role_ID -> Array<RoleInheritance>` ($O(1)$ parent lookups).
   - `restrictionsMap`: Map of `role_ID -> Array<Restriction>` ($O(1)$ restriction lookups).
2. **DAG Traversal (`walk(currentRoleId, isOwn)`)**:
   - Maintains a `visiting` Set for cycle detection. If `visiting.has(currentRoleId)`: throws `Error("Circular inheritance detected at role: ...")`.
   - Maintains a `resolved` Set to avoid redundant traversals in diamond inheritance / DAG patterns.
   - **Post-order / Ancestor-first Traversal**:
     ```javascript
     const parents = inheritanceMap.get(currentRoleId) || [];
     for (const relation of parents) {
       walk(relation.parent_ID, false);
     }
     const ownRestrictions = restrictionsMap.get(currentRoleId) || [];
     for (const restriction of ownRestrictions) {
       result.push({
         restrictionId: restriction.ID,
         field: restriction.field,
         filterType: restriction.filterType,
         value: restriction.value,
         sourceRoleId: currentRoleId,
         sourceRoleName: role.name,
         isOwn: isOwn,
       });
     }
     ```
     Because parents are visited before the current role pushes its own restrictions, the resulting `result` array is ordered strictly from root ancestors to leaf descendants.

3. **Backward-Pass Wildcard Discarding (`isPatternRestriction`)**:
   ```javascript
   const finalResult = [];
   const fieldsRestrictedByDescendants = new Set();

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
   **Mechanism**:
   - Descendant restrictions appear at the end of `result` and are visited first.
   - Any descendant restriction adds `fieldLower` to `fieldsRestrictedByDescendants`.
   - When an ancestor restriction on the same field is encountered:
     - If it matches `isPatternRestriction` (`ALL`, `CP`, or value containing `*` or `?`), and `fieldsRestrictedByDescendants.has(fieldLower)` is true, it is discarded (`continue`).
     - If it is an explicit non-pattern restriction, it is preserved.
   - This satisfies the critical replication rule: **descendant roles override parent wildcard restrictions when redefining the same field**.

### 2.2 Role Ancestry Chain Loading (`srv/services/hanaReplicationService.js`)

In `hanaReplicationService.js` (lines 234–259), `fetchRoleAncestryChain` loads only the subgraph of roles and restrictions required for resolving a role's effective restrictions:

```javascript
async function fetchRoleAncestryChain(db, roleId, entities) {
  const { Roles, Restrictions, RoleInheritance } = entities;
  const roleIds = new Set([roleId]);
  const queue = [roleId];
  const allInheritances = [];

  while (queue.length > 0) {
    const currId = queue.shift();
    const parents = await db.run(SELECT.from(RoleInheritance).where({ role_ID: currId }));
    for (const p of parents) {
      allInheritances.push(p);
      if (!roleIds.has(p.parent_ID)) {
        roleIds.add(p.parent_ID);
        queue.push(p.parent_ID);
      }
    }
  }

  const roleIdsArray = Array.from(roleIds);
  const [allRoles, allRestrictions] = await Promise.all([
    db.run(SELECT.from(Roles).where({ ID: { in: roleIdsArray } })),
    db.run(SELECT.from(Restrictions).where({ role_ID: { in: roleIdsArray } }))
  ]);

  return { allRoles, allRestrictions, allInheritances };
}
```

#### Key Observations
1. **Selective Loading**: Only ancestor roles and their restrictions are fetched ($O(\text{ancestors})$), avoiding full-table scans.
2. **Cycle Safety**: `roleIds.has(p.parent_ID)` prevents duplicate enqueuing if a cycle exists in DB.
3. **Reusability**: `fetchRoleAncestryChain` is already exported from `srv/services/hanaReplicationService.js` and can be utilized directly by the Databricks sync service.

---

## 3. Design: Effective Restriction Resolution for Databricks

### 3.1 Platform Neutrality & Cross-Platform Inheritance
- In `fanrio-auth`, role inheritance models authorization semantics (e.g., "North Regional Sales inherits from Global Sales Base").
- The parent role might have `targetPlatform: 'DATASPHERE'`, while the derived child has `targetPlatform: 'DATABRICKS'` or `'BOTH'`.
- **Rule**: `resolveEffectiveRestrictions` operates purely on role metadata and restrictions. When generating Databricks policies for a child role, all inherited restrictions from its parent roles are included in the child's Databricks policy, regardless of the parent's `targetPlatform`. (Verified in `test/e2e_direct_sync.test.js` test case `T3.2`).

### 3.2 Handling Multi-Level Inheritance ($\text{Depth} \ge 3$)
Consider a 4-level hierarchy:
- **Level 1 (Grandparent A)**: `Country = '*'`, `Plant = '*'`, `Status = 'ACTIVE'`
- **Level 2 (Parent B)**: `Region = 'EMEA'`
- **Level 3 (Child C)**: `Country = 'DE'`
- **Level 4 (Grandchild D)**: `Plant = 'DE01'`

When resolving effective restrictions for **Grandchild D**:
1. Traversal order: Level 1 $\to$ Level 2 $\to$ Level 3 $\to$ Level 4.
2. Descendants visited first during backward pass:
   - `Plant = 'DE01'` (Level 4) registers `plant` in `fieldsRestrictedByDescendants`.
   - `Country = 'DE'` (Level 3) registers `country` in `fieldsRestrictedByDescendants`.
   - `Region = 'EMEA'` (Level 2) registers `region`.
   - `Status = 'ACTIVE'` (Level 1) registers `status`.
   - `Plant = '*'` (Level 1): `isPatternRestriction` is true; `plant` is in `fieldsRestrictedByDescendants` $\to$ **DISCARDED**.
   - `Country = '*'` (Level 1): `isPatternRestriction` is true; `country` is in `fieldsRestrictedByDescendants` $\to$ **DISCARDED**.
3. **Resolved Result for Grandchild D**:
   - `Status = 'ACTIVE'` (inherited from Grandparent A)
   - `Region = 'EMEA'` (inherited from Parent B)
   - `Country = 'DE'` (inherited from Child C)
   - `Plant = 'DE01'` (own restriction of Grandchild D)
4. Databricks SQL predicate:
   `(Status = 'ACTIVE' AND Region = 'EMEA' AND Country = 'DE' AND Plant = 'DE01')`.

### 3.3 Access Domain Scoping & Target Table Naming
- In Databricks Unity Catalog, row filters attach to target tables:
  - Default flat table name: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations` (e.g. `main.auth.sales_flat_authorizations`).
  - Filter function name: `<catalog>.<schema>.fn_filter_<domain_sanitized>` (e.g. `main.auth.fn_filter_sales`).
- The list of columns required in the function signature `(<col1> STRING, <col2> STRING)` is the union of all restricted fields across all roles belonging to that domain.

### 3.4 Multi-Role User Aggregation & Disjunctive Normal Form (DNF)

In Unity Catalog, only **one** filter function is active on a table at a time. The function must evaluate all permissions for all users:

#### Structure of Composite Return Expression
$$\text{Return} = \text{AdminBypass} \lor \bigvee_{u \in \text{Users}} \left( \text{current\_user}() = u \land \bigvee_{r \in \text{Roles}(u)} \text{Predicate}(r) \right)$$

Where for each role $r$:
$$\text{Predicate}(r) = \bigwedge_{f \in \text{Fields}(r)} \left( \bigvee_{v \in \text{Values}(r, f)} \text{Condition}(f, v) \right)$$

1. **Intra-Role Conjunction (`AND`)**: Different fields within the same role must all be satisfied: `(Country = 'DE' AND Plant = 'DE01')`.
2. **Alternative Field Values (`OR`)**: If multiple restrictions are defined for the same field in a role, they represent alternative allowed values: `(Plant = 'DE01' OR Plant = 'DE02')`.
3. **Multi-Role Disjunction (`OR`)**: If a user is assigned multiple roles on the same domain, having access under *any* of those roles grants access:
   ```sql
   (current_user() = 'alice@fanrio.com' AND (
     (Country = 'DE' AND Plant = 'DE01') OR
     (Country = 'FR')
   ))
   ```
4. **Multi-User Disjunction (`OR`)**: Different users' clauses are joined with `OR`.
5. **Admin Access**: `is_account_group_member('admin') OR` is placed at the top so administrators bypass row filter restrictions.

---

## 4. Helper Functions & Data Transformation Logic for Worker

The following reference implementations are provided for Worker to integrate into `srv/services/databricksSyncService.js` and/or `srv/lib/resolveEffectiveRestrictions.js`.

### 4.1 Domain-Wide Assignment & Restriction Aggregator
```javascript
'use strict';

const { resolveEffectiveRestrictions } = require('../lib/resolveEffectiveRestrictions');

/**
 * Loads all assignments for roles within an Access Domain targeting Databricks,
 * resolves effective restrictions for each role, and computes distinct restricted columns.
 *
 * @param {object} db       - CAP database connection (cds.db)
 * @param {string} domainId - AccessDomain ID
 * @param {object} entities - { Roles, Restrictions, RoleInheritance, RoleAssignments }
 * @returns {Promise<{ assignments: Array, distinctColumns: string[] }>}
 */
async function getDomainDatabricksAssignments(db, domainId, entities) {
  const { Roles, Restrictions, RoleInheritance, RoleAssignments } = entities;

  // 1. Fetch all roles in domain targeting DATABRICKS or BOTH
  const domainRoles = await db.run(
    SELECT.from(Roles).where({
      accessDomain_ID: domainId,
      targetPlatform: { in: ['DATABRICKS', 'BOTH'] }
    })
  );

  if (!domainRoles || domainRoles.length === 0) {
    return { assignments: [], distinctColumns: [] };
  }

  const domainRoleIds = domainRoles.map(r => r.ID);

  // 2. Fetch assignments for these roles
  const assignments = await db.run(
    SELECT.from(RoleAssignments).where({ role_ID: { in: domainRoleIds } })
  );

  if (!assignments || assignments.length === 0) {
    return { assignments: [], distinctColumns: [] };
  }

  // 3. Collect ancestry graph for all domain roles
  const allInheritances = (await db.run(SELECT.from(RoleInheritance))) || [];
  const allRelevantRoleIds = new Set(domainRoleIds);
  const queue = [...domainRoleIds];

  while (queue.length > 0) {
    const currId = queue.shift();
    for (const inh of allInheritances.filter(i => i && i.role_ID === currId)) {
      if (!allRelevantRoleIds.has(inh.parent_ID)) {
        allRelevantRoleIds.add(inh.parent_ID);
        queue.push(inh.parent_ID);
      }
    }
  }

  const relevantIdsArray = Array.from(allRelevantRoleIds);
  const [allRoles, allRestrictions] = await Promise.all([
    db.run(SELECT.from(Roles).where({ ID: { in: relevantIdsArray } })),
    db.run(SELECT.from(Restrictions).where({ role_ID: { in: relevantIdsArray } }))
  ]);

  // 4. Resolve effective restrictions per role
  const roleRestrictionsCache = new Map();
  for (const rId of domainRoleIds) {
    const resolved = resolveEffectiveRestrictions(rId, allRoles, allRestrictions, allInheritances);
    roleRestrictionsCache.set(rId, resolved);
  }

  // 5. Build assignments list with resolved restrictions and extract distinct columns
  const userAssignments = [];
  const distinctColumnsSet = new Set();

  for (const assign of assignments) {
    const restrs = roleRestrictionsCache.get(assign.role_ID) || [];
    if (restrs.length > 0) {
      userAssignments.push({
        assignmentId: assign.ID,
        userId: assign.userId,
        userName: assign.userName,
        roleId: assign.role_ID,
        restrictions: restrs
      });
      for (const r of restrs) {
        if (r.field) distinctColumnsSet.add(r.field);
      }
    }
  }

  return {
    assignments: userAssignments,
    distinctColumns: Array.from(distinctColumnsSet)
  };
}
```

### 4.2 Composite User Predicate Generator
```javascript
/**
 * Safely escapes single quotes in SQL literals.
 */
function escapeSqlString(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/'/g, "''");
}

/**
 * Builds the composite SQL boolean return expression for the Unity Catalog filter UDF.
 * Aggregates across users and multiple roles per user.
 *
 * @param {Array<{userId: string, restrictions: Array}>} assignments
 * @param {Function} translateRestrictionToDatabricksSql - individual restriction SQL translator
 * @returns {string} SQL RETURN body expression
 */
function buildCompositeUserPredicates(assignments, translateRestrictionToDatabricksSql) {
  // Group assignments by userId
  const userRoleMap = new Map();
  for (const a of assignments) {
    if (!a.restrictions || a.restrictions.length === 0) continue;
    if (!userRoleMap.has(a.userId)) {
      userRoleMap.set(a.userId, []);
    }
    userRoleMap.get(a.userId).push(a.restrictions);
  }

  if (userRoleMap.size === 0) {
    return "is_account_group_member('admin')";
  }

  const userPredicates = [];

  for (const [userId, roleRestrictionsList] of userRoleMap.entries()) {
    const rolePredicates = [];

    for (const restrs of roleRestrictionsList) {
      // Group restrictions by field within the role
      const byField = new Map();
      for (const r of restrs) {
        if (!byField.has(r.field)) byField.set(r.field, []);
        byField.get(r.field).push(r);
      }

      const fieldClauses = [];
      for (const [field, rList] of byField.entries()) {
        const fieldPreds = rList
          .map(r => translateRestrictionToDatabricksSql(r.field, r.filterType, r.value))
          .filter(p => p && p !== 'TRUE');

        if (fieldPreds.length === 0) continue;
        if (fieldPreds.length === 1) {
          fieldClauses.push(fieldPreds[0]);
        } else {
          fieldClauses.push(`(${fieldPreds.join(' OR ')})`);
        }
      }

      if (fieldClauses.length > 0) {
        rolePredicates.push(`(${fieldClauses.join(' AND ')})`);
      } else {
        rolePredicates.push('TRUE');
      }
    }

    if (rolePredicates.length === 0) continue;

    let userFilter;
    if (rolePredicates.includes('TRUE')) {
      userFilter = 'TRUE';
    } else if (rolePredicates.length === 1) {
      userFilter = rolePredicates[0];
    } else {
      userFilter = `(${rolePredicates.join(' OR ')})`;
    }

    const escapedUser = escapeSqlString(userId);
    userPredicates.push(`(current_user() = '${escapedUser}' AND ${userFilter})`);
  }

  if (userPredicates.length === 0) {
    return "is_account_group_member('admin')";
  }

  return `is_account_group_member('admin') OR\n  ${userPredicates.join(' OR\n  ')}`;
}
```

### 4.3 Unity Catalog Policy DDL Generator
```javascript
/**
 * Generates the full CREATE OR REPLACE FUNCTION and ALTER TABLE SET/DROP ROW FILTER DDL.
 */
function buildUnityCatalogPolicyDdl({ catalog, schema, filterName, targetTable, columns, assignments, translateFn }) {
  const fullFuncName = `${catalog}.${schema}.${filterName}`;
  const fullTableName = `${catalog}.${schema}.${targetTable}`;

  const paramSignature = columns.length > 0
    ? columns.map(c => `${c} STRING`).join(', ')
    : 'dummy STRING';
  const callArguments = columns.length > 0
    ? columns.join(', ')
    : 'dummy';

  const returnExpression = buildCompositeUserPredicates(assignments, translateFn);

  const createFuncSql = `CREATE OR REPLACE FUNCTION ${fullFuncName}(${paramSignature})\nRETURN\n  ${returnExpression};`;
  const setFilterSql = `ALTER TABLE ${fullTableName} SET ROW FILTER ${fullFuncName} ON (${callArguments});`;
  const dropFilterSql = `ALTER TABLE ${fullTableName} DROP ROW FILTER;`;
  const dropFuncSql = `DROP FUNCTION IF EXISTS ${fullFuncName};`;

  return {
    fullFuncName,
    fullTableName,
    createFuncSql,
    setFilterSql,
    dropFilterSql,
    dropFuncSql
  };
}
```

### 4.4 Domain Sync Orchestration (`databricksSyncService.js`)
```javascript
/**
 * Re-computes and syncs policies for an entire Access Domain on Databricks.
 * Handles both active policy creation and clean removal if no assignments remain.
 *
 * @param {object} cds           - CAP cds instance
 * @param {string} domainId      - AccessDomain ID
 * @param {string} environmentId - Role environment ID (for matching DatabricksSettings)
 */
async function syncDomainPoliciesToDatabricks(cds, domainId, environmentId) {
  const db = cds.db;
  const { DatabricksSettings, AccessDomains } = cds.entities('fanrio.auth');
  const entities = cds.entities('fanrio.auth');

  // 1. Resolve Databricks connection settings
  let setting = null;
  if (environmentId) {
    setting = await db.run(SELECT.one.from(DatabricksSettings).where({ environment_ID: environmentId, isActive: true }));
  }
  if (!setting) {
    setting = await db.run(SELECT.one.from(DatabricksSettings).where({ isActive: true }));
  }

  if (!setting) {
    console.warn('[DatabricksSync] No active DatabricksSettings found. Skipping policy sync.');
    return { success: false, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const catalog = setting.targetCatalog || 'main';
  const schema = setting.targetSchema || 'default';
  const warehouseId = setting.sqlWarehouseId || 'default';

  // 2. Resolve domain naming
  const domain = await db.run(SELECT.one.from(AccessDomains).where({ ID: domainId }));
  const cleanDomain = domain?.name
    ? domain.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
    : 'domain';

  const filterName = `fn_filter_${cleanDomain}`;
  const targetTable = `${cleanDomain}_flat_authorizations`;

  // 3. Load assignments and effective restrictions
  const { assignments, distinctColumns } = await getDomainDatabricksAssignments(db, domainId, entities);

  const DatabricksClient = require('../lib/databricksClient');

  if (assignments.length === 0) {
    // No assignments remain -> Clean up policy from Databricks
    console.log(`[DatabricksSync] No active assignments for domain [${cleanDomain}]. Dropping row filter.`);
    try {
      await DatabricksClient.executeStatement({
        warehouseId,
        statement: `ALTER TABLE ${catalog}.${schema}.${targetTable} DROP ROW FILTER;`,
        catalog,
        schema
      });
    } catch (e) {
      console.warn(`[DatabricksSync] Drop row filter skipped/warning: ${e.message}`);
    }

    try {
      await DatabricksClient.executeStatement({
        warehouseId,
        statement: `DROP FUNCTION IF EXISTS ${catalog}.${schema}.${filterName};`,
        catalog,
        schema
      });
    } catch (e) {
      console.warn(`[DatabricksSync] Drop function skipped/warning: ${e.message}`);
    }

    return { success: true, action: 'DROPPED' };
  }

  // 4. Generate policy DDL
  const { translateRestrictionToDatabricksSql } = require('./databricksSyncService');
  const ddl = buildUnityCatalogPolicyDdl({
    catalog,
    schema,
    filterName,
    targetTable,
    columns: distinctColumns,
    assignments,
    translateFn: translateRestrictionToDatabricksSql
  });

  // 5. Execute DDL on Databricks
  await DatabricksClient.executeStatement({
    warehouseId,
    statement: ddl.createFuncSql,
    catalog,
    schema
  });

  await DatabricksClient.executeStatement({
    warehouseId,
    statement: ddl.setFilterSql,
    catalog,
    schema
  });

  console.log(`[DatabricksSync] Successfully applied row filter ${ddl.fullFuncName} on ${ddl.fullTableName}`);
  return { success: true, action: 'APPLIED', ddl };
}
```

---

## 5. Walkthrough Scenarios

### Scenario 1: Multi-Level Inheritance ($\text{Depth} = 3$) with Wildcard Override
- **Setup**:
  - `ROLE_BASE` (Single): `Plant = '*'`, `Country = 'DE'`
  - `ROLE_REGIONAL` (Derived, inherits `ROLE_BASE`): `Region = 'EU'`
  - `ROLE_LOCAL` (Derived, inherits `ROLE_REGIONAL`): `Plant = 'DE01'`
- **Effective Resolution for `ROLE_LOCAL`**:
  - `Plant = '*'` is overridden by `Plant = 'DE01'` because `isPatternRestriction('*')` is true.
  - `Country = 'DE'` is preserved from `ROLE_BASE`.
  - `Region = 'EU'` is preserved from `ROLE_REGIONAL`.
- **Generated Role Predicate**:
  `(Country = 'DE' AND Region = 'EU' AND Plant = 'DE01')`.

### Scenario 2: Multiple Roles Assigned to Single User
- **Setup**: User `alice@fanrio.com` is assigned:
  1. `ROLE_DE`: `Country = 'DE'`, `Plant IN ('DE01', 'DE02')`
  2. `ROLE_FR`: `Country = 'FR'`
- **Generated Return Clause for Alice**:
  ```sql
  (current_user() = 'alice@fanrio.com' AND (
    (Country = 'DE' AND Plant IN ('DE01', 'DE02')) OR
    (Country = 'FR')
  ))
  ```

### Scenario 3: Complete Policy Lifecycle (Create $\to$ Add User $\to$ Revoke $\to$ Drop)
1. **Assign Alice**: `CREATE OR REPLACE FUNCTION` created with Alice; `ALTER TABLE SET ROW FILTER` executed.
2. **Assign Bob**: `CREATE OR REPLACE FUNCTION` updated with `(current_user() = 'alice' ...) OR (current_user() = 'bob' ...)`.
3. **Revoke Alice**: `CREATE OR REPLACE FUNCTION` updated with Bob only.
4. **Revoke Bob**: 0 assignments remain $\to$ `ALTER TABLE ... DROP ROW FILTER;` followed by `DROP FUNCTION IF EXISTS ...;` executed.

---

## 6. Verification and Edge Cases

| Test Case | Condition | Expected Behavior |
|---|---|---|
| **Cycle in Inheritance** | Role A $\to$ Role B $\to$ Role A | `resolveEffectiveRestrictions` detects cycle via `visiting` set and throws readable error. |
| **No Active Assignments** | Role assignments table empty for domain | Drops row filter (`ALTER TABLE ... DROP ROW FILTER`) and drops function. |
| **Ancestor Non-Wildcard Conflict** | Ancestor has `Field = 'A'`, child has `Field = 'B'` | Both explicit conditions preserved. If on same field, joined with `OR` in SQL clause. |
| **Mixed Target Platforms** | Derived role targets `DATABRICKS`, parent targets `DATASPHERE` | All parent restrictions inherited and applied to Databricks table. |
| **SQL Escaping** | Values contain single quotes (e.g. `O'Connor`) | Escaped to `O''Connor` preventing syntax errors / SQL injection. |
| **SAP Wildcards** | Values contain `*` and `?` | Translated to `%` and `_` with SQL `LIKE` operator. |

This specification provides Worker with the exact architecture, data transformations, and algorithms needed to complete Milestone 2.
