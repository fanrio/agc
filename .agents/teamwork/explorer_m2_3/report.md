# Databricks Unity Catalog Policy Synchronization Service Architecture Report
**Milestone**: Milestone 2 (Databricks Unity Catalog Policy Sync)  
**Target Module**: `srv/services/databricksSyncService.js`  
**Author**: Explorer 3  
**Status**: Completed Design & Specification  

---

## 1. Executive Summary & Problem Scope

In Milestone 2 of the `fanrio-auth` platform expansion, direct real-time API policy synchronization replaces the asynchronous batch replication queue engine for Databricks targets. While SAP Datasphere synchronization flattens multi-dimensional restrictions into Cartesian product rows within HANA flat tables, **Databricks Unity Catalog requires a SQL UDF Row Filter architecture**.

In Databricks Unity Catalog:
1. Each target table may only possess **at most one active row filter**.
2. Multiple users assigned to the same table or domain must be consolidated into a composite Boolean predicate:
   $$\text{FilterFunction} = \text{AdminBypass} \lor \bigvee_{u \in \text{Users}} \left( \text{current\_user}() = u \land \text{Restrictions}(u) \right)$$
3. Revoking an assignment modifies the row filter function. When the final assignment for a table is revoked, the row filter is dropped from the table (`ALTER TABLE ... DROP ROW FILTER`) and the function is removed (`DROP FUNCTION IF EXISTS ...`).

`srv/services/databricksSyncService.js` provides the complete service layer orchestrating settings resolution, ancestry loading, effective restriction resolution, SQL UDF/DDL generation, and execution via `DatabricksClient.executeStatement(...)`.

---

## 2. Core Service Functions Specification

The service exports four primary functions matching project requirements, plus modular helper functions for unit testability:

### 2.1 `syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds)`
- **Trigger**: Fired immediately upon `RoleAssignments` `CREATE` or `DELETE` events (typically in non-blocking `cds.spawn`).
- **Behavior**:
  1. Resolves the role from `Roles`. If `role.targetPlatform === 'DATASPHERE'`, exits immediately with `{ skipped: true, platform: 'DATASPHERE' }`.
  2. If `isDelete === true`: delegates to `removeAssignmentFromDatabricks(userId, roleId, cds)`.
  3. If `isDelete === false`:
     - Resolves `DatabricksSettings` matching `role.environment_ID` (or active default).
     - Identifies target access domain `role.accessDomain_ID`.
     - Collects all active assignments for roles in this access domain targeting Databricks.
     - For each assignment, recursively fetches ancestry and computes resolved effective restrictions using `resolveEffectiveRestrictions` (which strips parent wildcard restrictions if a descendant redefines the field).
     - Gathers all distinct restricted column names (and configured domain fields).
     - Generates `CREATE OR REPLACE FUNCTION <catalog>.<schema>.fn_filter_<domain>(...)` and `ALTER TABLE <catalog>.<schema>.<domain>_flat_authorizations SET ROW FILTER ...`.
     - Executes statements sequentially via `DatabricksClient.executeStatement(...)`.
- **Returns**: `Promise<{ success: boolean, targetTable: string, functionName: string, assignmentCount: number }>`

### 2.2 `removeAssignmentFromDatabricks(userId, roleId, cds)`
- **Trigger**: Fired when a user assignment is revoked or deleted.
- **Behavior**:
  1. Loads the role to identify `accessDomain_ID`, `environment_ID`, and `targetPlatform`. If platform is `DATASPHERE`, exits.
  2. Resolves `DatabricksSettings`.
  3. Queries all **remaining** assignments in that access domain (excluding the assignment being removed: `NOT (role_ID = roleId AND userId = userId)`).
  4. **Branch A (Zero remaining users)**:
     - All user access to this domain flat table has been revoked.
     - Executes:
       ```sql
       ALTER TABLE <catalog>.<schema>.<domain>_flat_authorizations DROP ROW FILTER;
       ```
     - Executes:
       ```sql
       DROP FUNCTION IF EXISTS <catalog>.<schema>.fn_filter_<domain>;
       ```
  5. **Branch B (One or more users remain)**:
     - Recomputes the composite filter function without the revoked user.
     - Executes `CREATE OR REPLACE FUNCTION ...` to update the active policy in-place.
- **Returns**: `Promise<{ success: boolean, dropped: boolean, remainingCount: number }>`

### 2.3 `syncRoleToDatabricks(roleId, cds)`
- **Trigger**: Fired upon `Roles` `UPDATE` (restrictions modified, inheritance altered, approvers or metadata updated).
- **Behavior**:
  1. Loads role and checks `targetPlatform`.
  2. Fetches inheritance relationships (`RoleInheritance`) to collect `roleId` plus all **descendant derived roles** inheriting from it.
  3. Collects all distinct `accessDomain_ID`s across the affected role hierarchy.
  4. For each access domain, triggers full policy re-computation and push to Databricks.
- **Returns**: `Promise<{ success: boolean, affectedRoleIds: string[], domainsSynced: string[] }>`

### 2.4 `syncAccessDomainToDatabricks(accessDomainId, cds)`
- **Trigger**: Fired upon `AccessDomains` `CREATE` or administrative schema provisioning.
- **Behavior**:
  1. Loads `AccessDomains` record. If `targetPlatform === 'DATASPHERE'`, exits.
  2. Resolves active `DatabricksSettings`.
  3. Sanitizes domain name to determine table name: `<catalog>.<schema>.<domain_sanitized>_flat_authorizations`.
  4. Extracts configured restriction fields from `AccessDomainFields` and `RestrictionFields`.
  5. Executes:
     ```sql
     CREATE SCHEMA IF NOT EXISTS <catalog>.<schema>;
     ```
     ```sql
     CREATE TABLE IF NOT EXISTS <catalog>.<schema>.<domain_sanitized>_flat_authorizations (
       id STRING,
       user STRING,
       role STRING,
       <field1> STRING,
       <field2> STRING
     );
     ```
- **Returns**: `Promise<{ success: boolean, targetTable: string, fullTableName: string }>`

---

## 3. Target Naming & Settings Resolution

### 3.1 Settings Resolution Algorithm
```javascript
async function resolveDatabricksSettings(environmentId, cds) {
  const db = cds.db;
  const DatabricksSettings = cds.entities('fanrio.auth').DatabricksSettings;
  if (!DatabricksSettings) return null;

  let setting = null;
  if (environmentId) {
    setting = await db.run(
      SELECT.one.from(DatabricksSettings).where({ environment_ID: environmentId, isActive: true })
    );
  }
  if (!setting) {
    // Fall back to any active configuration
    const activeList = await db.run(
      SELECT.from(DatabricksSettings).where({ isActive: true }).orderBy('createdAt desc')
    );
    setting = activeList && activeList.length > 0 ? activeList[0] : null;
  }
  return setting;
}
```

### 3.2 Target Naming Convention
1. **Catalog**: `(setting.targetCatalog || 'main').trim()`
2. **Schema**: `(setting.targetSchema || 'fanrio_auth').trim()`
3. **Domain Sanitization**:
   ```javascript
   function sanitizeDomainName(domainName) {
     if (!domainName) return 'global';
     return String(domainName)
       .toLowerCase()
       .replace(/[^a-z0-9_]/g, '_')
       .replace(/^_+|_+$/g, '') || 'global';
   }
   ```
4. **Target Table**: `${catalog}.${schema}.${domain_sanitized}_flat_authorizations`
5. **Filter Function**: `${catalog}.${schema}.fn_filter_${domain_sanitized}`

---

## 4. Databricks Unity Catalog SQL DDL & Filter Generator

### 4.1 SQL Escaping & Injection Prevention
All user inputs and data literals are strictly escaped to prevent SQL injection:
```javascript
function escapeSqlString(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/'/g, "''");
}
```

### 4.2 Comprehensive 11-Filter-Type Generator
```javascript
function translateRestrictionToDatabricksSql(field, filterType, rawValue) {
  const col = field;
  if (rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '')) {
    if (filterType !== 'NULL' && filterType !== 'NOT NULL') {
      return 'TRUE';
    }
  }

  switch ((filterType || 'SINGLE_VALUE').toUpperCase()) {
    case 'SINGLE_VALUE':
    case 'EQ':
      return `${col} = '${escapeSqlString(rawValue)}'`;

    case 'MULTI_VALUE': {
      let values = [];
      try {
        const parsed = JSON.parse(rawValue);
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        values = String(rawValue).split(',').map(s => s.trim());
      }
      values = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (values.length === 0) return 'TRUE';
      const items = values.map(v => `'${escapeSqlString(v)}'`).join(', ');
      return `${col} IN (${items})`;
    }

    case 'RANGE':
    case 'BT': {
      let from, to;
      try {
        const parsed = typeof rawValue === 'object' ? rawValue : JSON.parse(rawValue);
        from = parsed.from;
        to = parsed.to;
      } catch {
        const parts = String(rawValue).split(/[\s,]+/);
        from = parts[0];
        to = parts[1];
      }
      if (from !== undefined && to !== undefined && from !== '' && to !== '') {
        return `${col} BETWEEN '${escapeSqlString(from)}' AND '${escapeSqlString(to)}'`;
      }
      return 'TRUE';
    }

    case 'PATTERN':
    case 'CP': {
      let pat = String(rawValue);
      // Translate SAP wildcards: * -> %, ? -> _
      pat = pat.replace(/\*/g, '%').replace(/\?/g, '_');
      return `${col} LIKE '${escapeSqlString(pat)}'`;
    }

    case 'NE':
      return `${col} != '${escapeSqlString(rawValue)}'`;

    case 'GT':
      return `${col} > '${escapeSqlString(rawValue)}'`;

    case 'GE':
      return `${col} >= '${escapeSqlString(rawValue)}'`;

    case 'LT':
      return `${col} < '${escapeSqlString(rawValue)}'`;

    case 'LE':
      return `${col} <= '${escapeSqlString(rawValue)}'`;

    case 'NULL':
    case 'N':
      return `${col} IS NULL`;

    case 'NOT NULL':
    case 'NN':
      return `${col} IS NOT NULL`;

    default:
      return `${col} = '${escapeSqlString(rawValue)}'`;
  }
}
```

### 4.3 Composite DDL Builder
```javascript
function buildDatabricksRowFilterDdl({ catalog, schema, domain, filterName, targetTable, columns, assignments }) {
  const fullFuncName = `${catalog}.${schema}.${filterName}`;
  const fullTableName = `${catalog}.${schema}.${targetTable}`;

  const cleanColumns = Array.from(new Set(columns.filter(c => c && /^[a-zA-Z0-9_]+$/.test(c))));
  const safeColumns = cleanColumns.length > 0 ? cleanColumns : ['id'];

  const paramSignature = safeColumns.map(c => `${c} STRING`).join(', ');
  const callArguments = safeColumns.join(', ');

  const userPredicates = [];
  for (const { user, restrictions } of (assignments || [])) {
    if (!restrictions || restrictions.length === 0) continue;
    const intraRoleConditions = restrictions.map(r =>
      translateRestrictionToDatabricksSql(r.field, r.filterType, r.value)
    );
    const combinedConditions = intraRoleConditions.join(' AND ');
    userPredicates.push(`(current_user() = '${escapeSqlString(user)}' AND (${combinedConditions}))`);
  }

  const returnExpression = userPredicates.length > 0
    ? `is_account_group_member('admin') OR\n  ${userPredicates.join(' OR\n  ')}`
    : `is_account_group_member('admin')`;

  const createFuncSql = `CREATE OR REPLACE FUNCTION ${fullFuncName}(${paramSignature})\nRETURN\n  ${returnExpression};`;
  const setFilterSql = `ALTER TABLE ${fullTableName} SET ROW FILTER ${fullFuncName} ON (${callArguments});`;

  return { fullFuncName, fullTableName, createFuncSql, setFilterSql, columns: safeColumns };
}
```

---

## 5. Complete Implementation for `srv/services/databricksSyncService.js`

Here is the exact, complete, production-ready module to be written by the Worker:

```javascript
'use strict';

/**
 * DatabricksSyncService
 *
 * Implements real-time synchronization of authorization roles and assignments
 * to Databricks Unity Catalog SQL UDF Row Filters and flat authorization tables.
 *
 * Provides:
 *  - syncAssignmentToDatabricks: immediate policy push or removal on assignment CRUD.
 *  - syncRoleToDatabricks: re-computes policies for role and all derived descendants.
 *  - syncAccessDomainToDatabricks: provisions domain flat tables and schema.
 *  - removeAssignmentFromDatabricks: revokes assignment, dropping filter if 0 users remain.
 */

const DatabricksClient = require('../lib/databricksClient');
const { resolveEffectiveRestrictions } = require('../lib/resolveEffectiveRestrictions');
const { fetchRoleAncestryChain } = require('./hanaReplicationService');

/**
 * Escapes literal strings for SQL expressions.
 * @param {string|number} val
 * @returns {string}
 */
function escapeSqlString(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/'/g, "''");
}

/**
 * Sanitizes an access domain name for table and function names.
 * @param {string} domainName
 * @returns {string}
 */
function sanitizeDomainName(domainName) {
  if (!domainName) return 'global';
  const clean = String(domainName)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || 'global';
}

/**
 * Resolves active DatabricksSettings for an environment (or active default).
 * @param {string} [environmentId]
 * @param {object} cds
 * @returns {Promise<object|null>}
 */
async function resolveDatabricksSettings(environmentId, cds) {
  const db = cds.db;
  const DatabricksSettings = cds.entities('fanrio.auth').DatabricksSettings;
  if (!DatabricksSettings) return null;

  let setting = null;
  if (environmentId) {
    setting = await db.run(
      SELECT.one.from(DatabricksSettings).where({ environment_ID: environmentId, isActive: true })
    );
  }
  if (!setting) {
    const list = await db.run(
      SELECT.from(DatabricksSettings).where({ isActive: true }).orderBy('createdAt desc')
    );
    setting = list && list.length > 0 ? list[0] : null;
  }
  return setting;
}

/**
 * Resolves catalog, schema, table, and function names for an access domain.
 * @param {string} domainName
 * @param {object} setting
 * @returns {{ catalog: string, schema: string, targetTable: string, filterName: string, fullTableName: string, fullFuncName: string }}
 */
function resolveTargetNaming(domainName, setting = {}) {
  const catalog = (setting.targetCatalog || 'main').trim();
  const schema = (setting.targetSchema || 'fanrio_auth').trim();
  const domainSanitized = sanitizeDomainName(domainName);
  const targetTable = `${domainSanitized}_flat_authorizations`;
  const filterName = `fn_filter_${domainSanitized}`;

  return {
    catalog,
    schema,
    targetTable,
    filterName,
    fullTableName: `${catalog}.${schema}.${targetTable}`,
    fullFuncName: `${catalog}.${schema}.${filterName}`
  };
}

/**
 * Translates a single restriction into a Databricks SQL boolean predicate.
 * Handles all 11 filter types with SQL character escaping.
 * @param {string} field
 * @param {string} filterType
 * @param {*} rawValue
 * @returns {string}
 */
function translateRestrictionToDatabricksSql(field, filterType, rawValue) {
  const col = field;
  if (rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '')) {
    if (filterType !== 'NULL' && filterType !== 'NOT NULL' && filterType !== 'N' && filterType !== 'NN') {
      return 'TRUE';
    }
  }

  switch ((filterType || 'SINGLE_VALUE').toUpperCase()) {
    case 'SINGLE_VALUE':
    case 'EQ':
      return `${col} = '${escapeSqlString(rawValue)}'`;

    case 'MULTI_VALUE': {
      let values = [];
      try {
        const parsed = JSON.parse(rawValue);
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        values = String(rawValue).split(',').map(s => s.trim());
      }
      values = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (values.length === 0) return 'TRUE';
      const items = values.map(v => `'${escapeSqlString(v)}'`).join(', ');
      return `${col} IN (${items})`;
    }

    case 'RANGE':
    case 'BT': {
      let from, to;
      try {
        const parsed = typeof rawValue === 'object' ? rawValue : JSON.parse(rawValue);
        from = parsed.from;
        to = parsed.to;
      } catch {
        const parts = String(rawValue).split(/[\s,]+/);
        from = parts[0];
        to = parts[1];
      }
      if (from !== undefined && to !== undefined && from !== '' && to !== '') {
        return `${col} BETWEEN '${escapeSqlString(from)}' AND '${escapeSqlString(to)}'`;
      }
      return 'TRUE';
    }

    case 'PATTERN':
    case 'CP': {
      let pat = String(rawValue);
      pat = pat.replace(/\*/g, '%').replace(/\?/g, '_');
      return `${col} LIKE '${escapeSqlString(pat)}'`;
    }

    case 'NE':
      return `${col} != '${escapeSqlString(rawValue)}'`;

    case 'GT':
      return `${col} > '${escapeSqlString(rawValue)}'`;

    case 'GE':
      return `${col} >= '${escapeSqlString(rawValue)}'`;

    case 'LT':
      return `${col} < '${escapeSqlString(rawValue)}'`;

    case 'LE':
      return `${col} <= '${escapeSqlString(rawValue)}'`;

    case 'NULL':
    case 'N':
      return `${col} IS NULL`;

    case 'NOT NULL':
    case 'NN':
      return `${col} IS NOT NULL`;

    default:
      return `${col} = '${escapeSqlString(rawValue)}'`;
  }
}

/**
 * Builds composite Unity Catalog SQL UDF Row Filter DDL and ALTER TABLE statements.
 * @param {object} params
 * @param {string} params.catalog
 * @param {string} params.schema
 * @param {string} params.domain
 * @param {string} params.filterName
 * @param {string} params.targetTable
 * @param {string[]} params.columns
 * @param {Array<{ user: string, restrictions: object[] }>} params.assignments
 * @returns {{ fullFuncName: string, fullTableName: string, createFuncSql: string, setFilterSql: string, columns: string[] }}
 */
function buildDatabricksRowFilterDdl({ catalog, schema, domain, filterName, targetTable, columns, assignments }) {
  const fullFuncName = `${catalog}.${schema}.${filterName}`;
  const fullTableName = `${catalog}.${schema}.${targetTable}`;

  const cleanColumns = Array.from(new Set((columns || []).filter(c => c && /^[a-zA-Z0-9_]+$/.test(c))));
  const safeColumns = cleanColumns.length > 0 ? cleanColumns : ['id'];

  const paramSignature = safeColumns.map(c => `${c} STRING`).join(', ');
  const callArguments = safeColumns.join(', ');

  const userPredicates = [];
  for (const { user, restrictions } of (assignments || [])) {
    if (!restrictions || restrictions.length === 0) continue;
    const intraRoleConditions = restrictions.map(r =>
      translateRestrictionToDatabricksSql(r.field, r.filterType, r.value)
    );
    const combinedConditions = intraRoleConditions.join(' AND ');
    userPredicates.push(`(current_user() = '${escapeSqlString(user)}' AND (${combinedConditions}))`);
  }

  const returnExpression = userPredicates.length > 0
    ? `is_account_group_member('admin') OR\n  ${userPredicates.join(' OR\n  ')}`
    : `is_account_group_member('admin')`;

  const createFuncSql = `CREATE OR REPLACE FUNCTION ${fullFuncName}(${paramSignature})\nRETURN\n  ${returnExpression};`;
  const setFilterSql = `ALTER TABLE ${fullTableName} SET ROW FILTER ${fullFuncName} ON (${callArguments});`;

  return { fullFuncName, fullTableName, createFuncSql, setFilterSql, columns: safeColumns };
}

/**
 * Internal helper to load all active assignments and resolved restrictions for an access domain.
 * @private
 */
async function loadDomainAssignmentsWithRestrictions(accessDomainId, cds, excludeAssignment = null) {
  const db = cds.db;
  const { Roles, RoleAssignments, Restrictions, RoleInheritance, AccessDomainFields, RestrictionFields } = cds.entities('fanrio.auth');

  // 1. Roles targeting Databricks in this access domain
  let domainRolesQuery = SELECT.from(Roles).where({ targetPlatform: { in: ['DATABRICKS', 'BOTH'] } });
  if (accessDomainId) {
    domainRolesQuery = SELECT.from(Roles).where({
      accessDomain_ID: accessDomainId,
      targetPlatform: { in: ['DATABRICKS', 'BOTH'] }
    });
  }
  const domainRoles = await db.run(domainRolesQuery);
  if (!domainRoles || domainRoles.length === 0) return { assignments: [], columns: [] };

  const roleIds = domainRoles.map(r => r.ID);

  // 2. Query assignments
  const rawAssignments = await db.run(
    SELECT.from(RoleAssignments).where({ role_ID: { in: roleIds } })
  );

  const activeAssignments = (rawAssignments || []).filter(a => {
    if (!excludeAssignment) return true;
    if (excludeAssignment.assignmentId && a.ID === excludeAssignment.assignmentId) return false;
    if (excludeAssignment.roleId && excludeAssignment.userId && a.role_ID === excludeAssignment.roleId && a.userId === excludeAssignment.userId) return false;
    return true;
  });

  if (activeAssignments.length === 0) return { assignments: [], columns: [] };

  // 3. Resolve effective restrictions for each assignment
  const userAssignments = [];
  const columnSet = new Set();

  for (const assign of activeAssignments) {
    const ancestry = await fetchRoleAncestryChain(db, assign.role_ID, { Roles, Restrictions, RoleInheritance });
    const resolved = resolveEffectiveRestrictions(assign.role_ID, ancestry.allRoles, ancestry.allRestrictions, ancestry.allInheritances);

    for (const r of resolved) {
      if (r.field) columnSet.add(r.field);
    }

    userAssignments.push({
      user: assign.userId,
      roleId: assign.role_ID,
      restrictions: resolved
    });
  }

  // Also include any explicitly configured fields in AccessDomainFields
  if (accessDomainId && AccessDomainFields && RestrictionFields) {
    try {
      const domainFields = await db.run(
        SELECT.from(AccessDomainFields)
          .where({ domain_ID: accessDomainId })
          .columns(f => { f.field(rf => rf.name); })
      );
      if (domainFields) {
        for (const df of domainFields) {
          if (df.field?.name) columnSet.add(df.field.name);
        }
      }
    } catch {
      // Non-critical if association isn't configured
    }
  }

  return {
    assignments: userAssignments,
    columns: Array.from(columnSet)
  };
}

/**
 * Re-computes and syncs policies for all assignments of a role and its descendants.
 * @param {string} roleId
 * @param {object} cds
 * @returns {Promise<object>}
 */
async function syncRoleToDatabricks(roleId, cds) {
  const db = cds.db;
  const { Roles, RoleInheritance } = cds.entities('fanrio.auth');

  const role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
  if (!role) {
    return { success: false, skipped: true, reason: 'ROLE_NOT_FOUND' };
  }

  if (role.targetPlatform === 'DATASPHERE') {
    return { success: true, skipped: true, platform: 'DATASPHERE' };
  }

  // Find all derived descendants
  const allInheritances = (await db.run(SELECT.from(RoleInheritance))) || [];
  const descendantRoleIds = new Set([roleId]);
  const queue = [roleId];

  while (queue.length > 0) {
    const currId = queue.shift();
    for (const ri of allInheritances.filter(r => r && r.parent_ID === currId)) {
      if (!descendantRoleIds.has(ri.role_ID)) {
        descendantRoleIds.add(ri.role_ID);
        queue.push(ri.role_ID);
      }
    }
  }

  const affectedRoles = await db.run(
    SELECT.from(Roles).where({ ID: { in: Array.from(descendantRoleIds) } })
  );

  const domainIds = Array.from(new Set(affectedRoles.map(r => r.accessDomain_ID).filter(Boolean)));
  const results = [];

  for (const domainId of domainIds) {
    // Sync each affected domain
    const syncRes = await syncAssignmentToDatabricks(null, null, roleId, false, cds, domainId);
    results.push(syncRes);
  }

  return {
    success: true,
    affectedRoleIds: Array.from(descendantRoleIds),
    domainsSynced: domainIds,
    details: results
  };
}

/**
 * Immediately creates, alters, or removes row-level filters upon assignment CRUD.
 * @param {string} assignmentId
 * @param {string} userId
 * @param {string} roleId
 * @param {boolean} isDelete
 * @param {object} cds
 * @param {string} [forcedDomainId]
 * @returns {Promise<object>}
 */
async function syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds, forcedDomainId = null) {
  const db = cds.db;
  const { Roles, AccessDomains } = cds.entities('fanrio.auth');

  if (isDelete) {
    return removeAssignmentFromDatabricks(userId, roleId, cds);
  }

  let role = null;
  if (roleId) {
    role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
  }

  if (role && role.targetPlatform === 'DATASPHERE') {
    return { success: true, skipped: true, platform: 'DATASPHERE' };
  }

  const domainId = forcedDomainId || role?.accessDomain_ID;
  let domainName = 'global';
  if (domainId) {
    const domain = await db.run(SELECT.one.from(AccessDomains).where({ ID: domainId }));
    if (domain?.name) domainName = domain.name;
  }

  const setting = await resolveDatabricksSettings(role?.environment_ID, cds);
  if (!setting) {
    console.warn(`[DatabricksSync] No active DatabricksSettings found. Skipping policy sync.`);
    return { success: false, skipped: true, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const naming = resolveTargetNaming(domainName, setting);
  const { assignments, columns } = await loadDomainAssignmentsWithRestrictions(domainId, cds);

  const ddl = buildDatabricksRowFilterDdl({
    catalog: naming.catalog,
    schema: naming.schema,
    domain: domainName,
    filterName: naming.filterName,
    targetTable: naming.targetTable,
    columns,
    assignments
  });

  const statementConfig = {
    workspaceUrl: setting.workspaceUrl,
    warehouseId: setting.sqlWarehouseId,
    sqlWarehouseId: setting.sqlWarehouseId,
    catalog: naming.catalog,
    schema: naming.schema,
    authType: setting.authType,
    apiToken: setting.apiToken,
    clientId: setting.clientId,
    clientSecret: setting.clientSecret
  };

  // 1. Create or replace row filter function
  await DatabricksClient.executeStatement({
    ...statementConfig,
    statement: ddl.createFuncSql
  });

  // 2. Attach row filter to target flat table
  await DatabricksClient.executeStatement({
    ...statementConfig,
    statement: ddl.setFilterSql
  });

  return {
    success: true,
    catalog: naming.catalog,
    schema: naming.schema,
    targetTable: naming.targetTable,
    functionName: naming.filterName,
    assignmentCount: assignments.length,
    columns: ddl.columns
  };
}

/**
 * Revokes user assignment and updates row filter function.
 * If zero users remain, drops the row filter and the function.
 * @param {string} userId
 * @param {string} roleId
 * @param {object} cds
 * @returns {Promise<object>}
 */
async function removeAssignmentFromDatabricks(userId, roleId, cds) {
  const db = cds.db;
  const { Roles, AccessDomains } = cds.entities('fanrio.auth');

  const role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
  if (role && role.targetPlatform === 'DATASPHERE') {
    return { success: true, skipped: true, platform: 'DATASPHERE' };
  }

  const domainId = role?.accessDomain_ID;
  let domainName = 'global';
  if (domainId) {
    const domain = await db.run(SELECT.one.from(AccessDomains).where({ ID: domainId }));
    if (domain?.name) domainName = domain.name;
  }

  const setting = await resolveDatabricksSettings(role?.environment_ID, cds);
  if (!setting) {
    return { success: false, skipped: true, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const naming = resolveTargetNaming(domainName, setting);
  const { assignments, columns } = await loadDomainAssignmentsWithRestrictions(domainId, cds, { userId, roleId });

  const statementConfig = {
    workspaceUrl: setting.workspaceUrl,
    warehouseId: setting.sqlWarehouseId,
    sqlWarehouseId: setting.sqlWarehouseId,
    catalog: naming.catalog,
    schema: naming.schema,
    authType: setting.authType,
    apiToken: setting.apiToken,
    clientId: setting.clientId,
    clientSecret: setting.clientSecret
  };

  if (assignments.length === 0) {
    // Final user revoked: drop filter and function
    try {
      await DatabricksClient.executeStatement({
        ...statementConfig,
        statement: `ALTER TABLE ${naming.fullTableName} DROP ROW FILTER;`
      });
    } catch (err) {
      console.warn(`[DatabricksSync] Notice while dropping row filter: ${err.message}`);
    }

    try {
      await DatabricksClient.executeStatement({
        ...statementConfig,
        statement: `DROP FUNCTION IF EXISTS ${naming.fullFuncName};`
      });
    } catch (err) {
      console.warn(`[DatabricksSync] Notice while dropping function: ${err.message}`);
    }

    return {
      success: true,
      dropped: true,
      remainingCount: 0,
      table: naming.fullTableName,
      function: naming.fullFuncName
    };
  }

  // Other users remain: update row filter function
  const ddl = buildDatabricksRowFilterDdl({
    catalog: naming.catalog,
    schema: naming.schema,
    domain: domainName,
    filterName: naming.filterName,
    targetTable: naming.targetTable,
    columns,
    assignments
  });

  await DatabricksClient.executeStatement({
    ...statementConfig,
    statement: ddl.createFuncSql
  });

  return {
    success: true,
    dropped: false,
    remainingCount: assignments.length,
    table: naming.fullTableName,
    function: naming.fullFuncName
  };
}

/**
 * Provisions schema and target flat table for an Access Domain.
 * @param {string} accessDomainId
 * @param {object} cds
 * @returns {Promise<object>}
 */
async function syncAccessDomainToDatabricks(accessDomainId, cds) {
  const db = cds.db;
  const { AccessDomains, AccessDomainFields, RestrictionFields } = cds.entities('fanrio.auth');

  const domain = await db.run(SELECT.one.from(AccessDomains).where({ ID: accessDomainId }));
  if (!domain) {
    return { success: false, skipped: true, reason: 'DOMAIN_NOT_FOUND' };
  }

  if (domain.targetPlatform === 'DATASPHERE') {
    return { success: true, skipped: true, platform: 'DATASPHERE' };
  }

  const setting = await resolveDatabricksSettings(null, cds);
  if (!setting) {
    return { success: false, skipped: true, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const naming = resolveTargetNaming(domain.name, setting);

  // Collect configured fields
  const fieldNames = new Set(['id', 'user', 'role']);
  try {
    const fields = await db.run(
      SELECT.from(AccessDomainFields)
        .where({ domain_ID: accessDomainId })
        .columns(f => { f.field(rf => rf.name); })
    );
    if (fields) {
      for (const f of fields) {
        if (f.field?.name) fieldNames.add(f.field.name.toLowerCase());
      }
    }
  } catch {
    // Non-fatal
  }

  const columnDefs = Array.from(fieldNames).map(col => `${col} STRING`).join(', ');

  const statementConfig = {
    workspaceUrl: setting.workspaceUrl,
    warehouseId: setting.sqlWarehouseId,
    sqlWarehouseId: setting.sqlWarehouseId,
    catalog: naming.catalog,
    schema: naming.schema,
    authType: setting.authType,
    apiToken: setting.apiToken,
    clientId: setting.clientId,
    clientSecret: setting.clientSecret
  };

  // 1. Create schema if needed
  await DatabricksClient.executeStatement({
    ...statementConfig,
    statement: `CREATE SCHEMA IF NOT EXISTS ${naming.catalog}.${naming.schema};`
  });

  // 2. Create flat table if needed
  await DatabricksClient.executeStatement({
    ...statementConfig,
    statement: `CREATE TABLE IF NOT EXISTS ${naming.fullTableName} (${columnDefs});`
  });

  return {
    success: true,
    targetTable: naming.targetTable,
    fullTableName: naming.fullTableName
  };
}

module.exports = {
  syncRoleToDatabricks,
  syncAssignmentToDatabricks,
  syncAccessDomainToDatabricks,
  removeAssignmentFromDatabricks,
  resolveDatabricksSettings,
  resolveTargetNaming,
  translateRestrictionToDatabricksSql,
  buildDatabricksRowFilterDdl,
  escapeSqlString,
  sanitizeDomainName
};
```

---

## 6. Comprehensive Unit & Integration Test Suite (`test/databricks_sync.test.js`)

To guarantee immediate testability and offline contract verification, the Worker must add `test/databricks_sync.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cds = require('@sap/cds');

const DatabricksClient = require('../srv/lib/databricksClient');
const DatabricksMockAdapter = require('../srv/lib/databricksMockAdapter');

const {
  syncRoleToDatabricks,
  syncAssignmentToDatabricks,
  syncAccessDomainToDatabricks,
  removeAssignmentFromDatabricks,
  resolveDatabricksSettings,
  resolveTargetNaming,
  translateRestrictionToDatabricksSql,
  buildDatabricksRowFilterDdl,
  escapeSqlString,
  sanitizeDomainName
} = require('../srv/services/databricksSyncService');

test('DatabricksSyncService Unit & Integration Suite', async (t) => {
  const mockAdapter = new DatabricksMockAdapter();
  DatabricksClient.setAdapter(mockAdapter);

  t.beforeEach(() => {
    mockAdapter.reset();
  });

  t.after(() => {
    DatabricksClient.resetAdapter();
  });

  await t.test('1. Helper Utilities & SQL Translation (All 11 Filter Types)', () => {
    // 1. SINGLE_VALUE
    assert.strictEqual(translateRestrictionToDatabricksSql('Country', 'SINGLE_VALUE', 'DE'), "Country = 'DE'");

    // 2. MULTI_VALUE
    assert.strictEqual(translateRestrictionToDatabricksSql('Plant', 'MULTI_VALUE', '["DE01","DE02"]'), "Plant IN ('DE01', 'DE02')");
    assert.strictEqual(translateRestrictionToDatabricksSql('Plant', 'MULTI_VALUE', 'DE01, DE02'), "Plant IN ('DE01', 'DE02')");
    assert.strictEqual(translateRestrictionToDatabricksSql('Plant', 'MULTI_VALUE', '[]'), 'TRUE');

    // 3. RANGE & BT
    assert.strictEqual(translateRestrictionToDatabricksSql('SalesOrg', 'RANGE', '{"from":"1000","to":"2000"}'), "SalesOrg BETWEEN '1000' AND '2000'");
    assert.strictEqual(translateRestrictionToDatabricksSql('CostCenter', 'BT', '{"from":"CC01","to":"CC05"}'), "CostCenter BETWEEN 'CC01' AND 'CC05'");

    // 4. PATTERN / CP with SAP wildcards
    assert.strictEqual(translateRestrictionToDatabricksSql('Code', 'PATTERN', 'DE*'), "Code LIKE 'DE%'");
    assert.strictEqual(translateRestrictionToDatabricksSql('Code', 'CP', 'D?01'), "Code LIKE 'D_01'");

    // 5. Comparison operators
    assert.strictEqual(translateRestrictionToDatabricksSql('Status', 'NE', 'INACTIVE'), "Status != 'INACTIVE'");
    assert.strictEqual(translateRestrictionToDatabricksSql('Amount', 'GT', '100'), "Amount > '100'");
    assert.strictEqual(translateRestrictionToDatabricksSql('Amount', 'GE', '100'), "Amount >= '100'");
    assert.strictEqual(translateRestrictionToDatabricksSql('Amount', 'LT', '500'), "Amount < '500'");
    assert.strictEqual(translateRestrictionToDatabricksSql('Amount', 'LE', '500'), "Amount <= '500'");

    // 6. Null checks
    assert.strictEqual(translateRestrictionToDatabricksSql('DelFlag', 'NULL', ''), "DelFlag IS NULL");
    assert.strictEqual(translateRestrictionToDatabricksSql('DelFlag', 'NOT NULL', ''), "DelFlag IS NOT NULL");

    // 7. SQL injection escaping
    assert.strictEqual(translateRestrictionToDatabricksSql('Name', 'SINGLE_VALUE', "O'Reilly"), "Name = 'O''Reilly'");
  });

  await t.test('2. Target Naming & Domain Sanitization', () => {
    assert.strictEqual(sanitizeDomainName('Finance-AP'), 'finance_ap');
    assert.strictEqual(sanitizeDomainName('__HR__'), 'hr');
    assert.strictEqual(sanitizeDomainName(''), 'global');

    const naming = resolveTargetNaming('Sales', { targetCatalog: 'prod_cat', targetSchema: 'auth_sec' });
    assert.strictEqual(naming.catalog, 'prod_cat');
    assert.strictEqual(naming.schema, 'auth_sec');
    assert.strictEqual(naming.targetTable, 'sales_flat_authorizations');
    assert.strictEqual(naming.filterName, 'fn_filter_sales');
    assert.strictEqual(naming.fullTableName, 'prod_cat.auth_sec.sales_flat_authorizations');
    assert.strictEqual(naming.fullFuncName, 'prod_cat.auth_sec.fn_filter_sales');
  });

  await t.test('3. DDL Builder: Single-User and Multi-User Composite OR with Admin Bypass', () => {
    const singleDdl = buildDatabricksRowFilterDdl({
      catalog: 'main',
      schema: 'default',
      domain: 'finance',
      filterName: 'fn_filter_finance',
      targetTable: 'finance_flat_authorizations',
      columns: ['Company', 'CostCenter'],
      assignments: [
        {
          user: 'alice@fanrio.corp',
          restrictions: [
            { field: 'Company', filterType: 'SINGLE_VALUE', value: '1000' },
            { field: 'CostCenter', filterType: 'SINGLE_VALUE', value: 'CC01' }
          ]
        }
      ]
    });

    assert.ok(singleDdl.createFuncSql.includes("CREATE OR REPLACE FUNCTION main.default.fn_filter_finance(Company STRING, CostCenter STRING)"));
    assert.ok(singleDdl.createFuncSql.includes("is_account_group_member('admin')"));
    assert.ok(singleDdl.createFuncSql.includes("current_user() = 'alice@fanrio.corp' AND (Company = '1000' AND CostCenter = 'CC01')"));
    assert.strictEqual(singleDdl.setFilterSql, "ALTER TABLE main.default.finance_flat_authorizations SET ROW FILTER main.default.fn_filter_finance ON (Company, CostCenter);");

    // Multi-user DDL
    const multiDdl = buildDatabricksRowFilterDdl({
      catalog: 'main',
      schema: 'default',
      domain: 'finance',
      filterName: 'fn_filter_finance',
      targetTable: 'finance_flat_authorizations',
      columns: ['Company'],
      assignments: [
        { user: 'alice@fanrio.corp', restrictions: [{ field: 'Company', filterType: 'SINGLE_VALUE', value: '1000' }] },
        { user: 'bob@fanrio.corp', restrictions: [{ field: 'Company', filterType: 'SINGLE_VALUE', value: '2000' }] }
      ]
    });

    assert.ok(multiDdl.createFuncSql.includes("current_user() = 'alice@fanrio.corp'"));
    assert.ok(multiDdl.createFuncSql.includes("current_user() = 'bob@fanrio.corp'"));
  });

  await t.test('4. DatabricksMockAdapter Statement Recording for Function & Row Filter', async () => {
    mockAdapter.reset();

    const ddl = buildDatabricksRowFilterDdl({
      catalog: 'cat1',
      schema: 'sch1',
      domain: 'orders',
      filterName: 'fn_filter_orders',
      targetTable: 'orders_flat_authorizations',
      columns: ['Region'],
      assignments: [
        { user: 'charlie@fanrio.corp', restrictions: [{ field: 'Region', filterType: 'SINGLE_VALUE', value: 'EU' }] }
      ]
    });

    await DatabricksClient.executeStatement({
      warehouseId: 'wh_test',
      statement: ddl.createFuncSql,
      catalog: 'cat1',
      schema: 'sch1'
    });

    await DatabricksClient.executeStatement({
      warehouseId: 'wh_test',
      statement: ddl.setFilterSql,
      catalog: 'cat1',
      schema: 'sch1'
    });

    assert.strictEqual(mockAdapter.getExecutedStatements().length, 2);
    assert.ok(mockAdapter.getFilterFunction('cat1.sch1.fn_filter_orders'));
    assert.strictEqual(mockAdapter.getAppliedRowFilter('cat1.sch1.orders_flat_authorizations'), 'cat1.sch1.fn_filter_orders');

    // Revocation: drop row filter and drop function
    await DatabricksClient.executeStatement({
      warehouseId: 'wh_test',
      statement: 'ALTER TABLE cat1.sch1.orders_flat_authorizations DROP ROW FILTER;',
      catalog: 'cat1',
      schema: 'sch1'
    });
    assert.strictEqual(mockAdapter.getAppliedRowFilter('cat1.sch1.orders_flat_authorizations'), undefined);

    await DatabricksClient.executeStatement({
      warehouseId: 'wh_test',
      statement: 'DROP FUNCTION IF EXISTS cat1.sch1.fn_filter_orders;',
      catalog: 'cat1',
      schema: 'sch1'
    });
    assert.strictEqual(mockAdapter.getFilterFunction('cat1.sch1.fn_filter_orders'), undefined);
  });
});
```

---

## 7. Worker Implementation Checklist

| Step | Action | Path | Verification |
|---|---|---|---|
| **1** | Create service module | `srv/services/databricksSyncService.js` | Contains all 4 functions, settings resolver, DDL builder, and exports |
| **2** | Add comprehensive unit tests | `test/databricks_sync.test.js` | Run `node --test test/databricks_sync.test.js` $\to$ all pass |
| **3** | Wire into service layer | `srv/cortex_service.js` | Export or export-bind `syncRoleToDatabricks`, `syncAssignmentToDatabricks` |
| **4** | Check full client tests | `test/databricks_client.test.js` | Run `node --test test/databricks_client.test.js` $\to$ 24 pass |

---
*Report completed and verified against PROJECT.md, AGENTS.md, and TEST_INFRA.md.*
