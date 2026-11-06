'use strict';

/**
 * DatabricksSyncService
 *
 * Implements real-time synchronization of authorization roles and assignments
 * to Databricks Unity Catalog SQL UDF Row Filters and flat authorization tables.
 *
 * Capabilities:
 *  - Enforces all 11 filter types with SQL character escaping and SAP wildcard translation.
 *  - Builds Disjunctive Normal Form (DNF) boolean predicates:
 *      * Intra-role: distinct fields with AND, multiple restrictions on the same field with OR.
 *      * Multi-role per user: combined with OR under user identity binding.
 *      * Multi-user: combined with OR with admin group bypass.
 *  - Integrates resolveEffectiveRestrictions and fetchRoleAncestryChain to support
 *    multi-level role inheritance (depth >= 3) and ancestor wildcard override.
 *  - Executes DDL via DatabricksClient (CREATE/REPLACE FUNCTION, ALTER TABLE SET/DROP ROW FILTER).
 */

const DatabricksClient = require('../lib/databricksClient');
const { resolveEffectiveRestrictions } = require('../lib/resolveEffectiveRestrictions');
const { fetchRoleAncestryChain } = require('./hanaReplicationService');

/**
 * Escapes literal strings for SQL expressions by doubling internal single quotes.
 * @param {any} val
 * @returns {string}
 */
function escapeSqlString(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Escapes SQL column identifiers, wrapping special names or keywords in backticks.
 * @param {string} col
 * @returns {string}
 */
function escapeIdentifier(col) {
  if (!col) return '';
  const clean = String(col).trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(clean)) {
    return clean;
  }
  return `\`${clean.replace(/`/g, '``')}\``;
}

/**
 * Sanitizes an access domain name for use in table and function identifiers.
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
 * Extracts a primitive ID string from a raw value or enriched { id, text } object.
 * Preserves RANGE/BT JSON structures.
 * @param {any} val
 * @returns {string}
 */
function extractId(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.from !== undefined || val.to !== undefined || val.low !== undefined || val.high !== undefined) {
      return val;
    }
    return String(val.id ?? val.key ?? val.value ?? '');
  }
  const str = String(val).trim();
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.from !== undefined || parsed.to !== undefined || parsed.low !== undefined || parsed.high !== undefined) {
          return str;
        }
        if (parsed.id !== undefined) return String(parsed.id);
        if (parsed.key !== undefined) return String(parsed.key);
        if (parsed.value !== undefined) return String(parsed.value);
      }
    } catch {}
  }
  return str;
}

/**
 * Translates a single restriction into a Databricks SQL boolean predicate.
 * Supports polymorphic calling signatures:
 *   - translateRestrictionToSql(restrObject, colNameOverride, options)
 *   - translateRestrictionToSql(fieldName, filterType, rawValue, options)
 *
 * @param {object|string} restrOrField
 * @param {string} [colOrType]
 * @param {any} [valueOrOptions]
 * @param {object} [maybeOptions]
 * @returns {string} SQL boolean predicate
 */
function translateRestrictionToSql(restrOrField, colOrType, valueOrOptions, maybeOptions) {
  let field;
  let filterType;
  let rawValue;
  let options = {};

  if (typeof restrOrField === 'object' && restrOrField !== null && !Array.isArray(restrOrField)) {
    // restr object passed
    field = colOrType || restrOrField.field;
    filterType = restrOrField.filterType;
    rawValue = restrOrField.value;
    options = (typeof valueOrOptions === 'object' && valueOrOptions !== null) ? valueOrOptions : (maybeOptions || {});
  } else {
    field = restrOrField;
    filterType = colOrType;
    rawValue = valueOrOptions;
    options = (typeof maybeOptions === 'object' && maybeOptions !== null) ? maybeOptions : {};
  }

  const col = escapeIdentifier(field);
  const type = (filterType || 'SINGLE_VALUE').toUpperCase();

  // Null operators do not require a value
  if (type === 'NULL' || type === 'N') {
    return `${col} IS NULL`;
  }
  if (type === 'NOT NULL' || type === 'NN') {
    return `${col} IS NOT NULL`;
  }
  if (type === 'ALL' || rawValue === '*') {
    return 'TRUE';
  }

  // Blank/null values for other operators evaluate to TRUE (unrestricted)
  if (rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '')) {
    return 'TRUE';
  }

  switch (type) {
    case 'SINGLE_VALUE':
    case 'EQ': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} = '${escapeSqlString(val)}'`;
    }

    case 'MULTI_VALUE':
    case 'IN': {
      let values = [];
      if (Array.isArray(rawValue)) {
        values = rawValue;
      } else if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            values = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            values = trimmed.split(',').map(s => s.trim());
          }
        } else {
          values = trimmed.split(',').map(s => s.trim());
        }
      } else {
        values = [rawValue];
      }

      const extracted = values
        .map(v => extractId(v))
        .filter(v => v !== null && v !== undefined && String(v).trim() !== '');

      if (extracted.length === 0) return 'TRUE';
      const items = extracted.map(v => `'${escapeSqlString(v)}'`).join(', ');
      return `${col} IN (${items})`;
    }

    case 'RANGE':
    case 'BT': {
      let from;
      let to;
      if (typeof rawValue === 'object' && rawValue !== null) {
        from = rawValue.from ?? rawValue.low;
        to = rawValue.to ?? rawValue.high;
      } else {
        const str = String(rawValue).trim();
        if (str.startsWith('{') && str.endsWith('}')) {
          try {
            const parsed = JSON.parse(str);
            if (parsed && typeof parsed === 'object') {
              from = parsed.from ?? parsed.low;
              to = parsed.to ?? parsed.high;
            }
          } catch {}
        }
        if (from === undefined || to === undefined) {
          const parts = str.split(/\s+(?:to|-)\s+|[,\s]+/);
          if (parts.length >= 2) {
            from = parts[0];
            to = parts[1];
          }
        }
      }

      from = extractId(from);
      to = extractId(to);

      if (from !== undefined && to !== undefined && from !== '' && to !== '') {
        if (options.useBetween === false) {
          return `(${col} >= '${escapeSqlString(from)}' AND ${col} <= '${escapeSqlString(to)}')`;
        }
        return `${col} BETWEEN '${escapeSqlString(from)}' AND '${escapeSqlString(to)}'`;
      }
      return 'TRUE';
    }

    case 'PATTERN':
    case 'CP': {
      let pat = String(rawValue);
      pat = escapeSqlString(pat);
      pat = pat.replace(/\*/g, '%').replace(/\?/g, '_');
      return `${col} LIKE '${pat}'`;
    }

    case 'NE':
    case '<>':
    case '!=': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} != '${escapeSqlString(val)}'`;
    }

    case 'GT':
    case '>': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} > '${escapeSqlString(val)}'`;
    }

    case 'GE':
    case '>=': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} >= '${escapeSqlString(val)}'`;
    }

    case 'LT':
    case '<': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} < '${escapeSqlString(val)}'`;
    }

    case 'LE':
    case '<=': {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} <= '${escapeSqlString(val)}'`;
    }

    case 'HIERARCHY':
      return 'TRUE';

    default: {
      const val = extractId(rawValue);
      if (!val) return 'TRUE';
      return `${col} = '${escapeSqlString(val)}'`;
    }
  }
}

// Alias matching Explorer reports
const translateRestrictionToDatabricksSql = translateRestrictionToSql;

/**
 * Combines all intra-role restrictions for a single role:
 *  - Multiple restrictions on the same field are combined with OR.
 *  - Restrictions on distinct fields are combined with AND.
 *
 * @param {Array<object>} restrictions
 * @param {object} [options]
 * @returns {string}
 */
function buildIntraRolePredicate(restrictions, options = {}) {
  if (!restrictions || !Array.isArray(restrictions) || restrictions.length === 0) {
    return 'TRUE';
  }

  // Group restrictions by field name (case-insensitively, preserving original identifier)
  const byField = new Map();
  for (const r of restrictions) {
    if (!r || !r.field) continue;
    const key = String(r.field).trim().toLowerCase();
    if (!byField.has(key)) {
      byField.set(key, { fieldName: r.field, items: [] });
    }
    byField.get(key).items.push(r);
  }

  if (byField.size === 0) return 'TRUE';

  const fieldPredicates = [];
  for (const [, { fieldName, items }] of byField.entries()) {
    const preds = items
      .map(r => translateRestrictionToSql(r, fieldName, options))
      .filter(p => p && p !== 'TRUE');

    if (preds.length === 0) continue;
    if (preds.length === 1) {
      fieldPredicates.push(preds[0]);
    } else {
      fieldPredicates.push(`(${preds.join(' OR ')})`);
    }
  }

  if (fieldPredicates.length === 0) return 'TRUE';
  if (fieldPredicates.length === 1) return fieldPredicates[0];
  return fieldPredicates.join(' AND ');
}

/**
 * Binds a role predicate to a user identity or group.
 *
 * @param {string} identity - User ID/email or group name
 * @param {string} rolePredicate - Result from buildIntraRolePredicate
 * @param {object} [options]
 * @param {boolean} [options.isGroup=false]
 * @returns {string}
 */
function buildUserBindingPredicate(identity, rolePredicate, options = {}) {
  const safeId = escapeSqlString(identity);
  const isGroup = options.isGroup || (identity && String(identity).startsWith('group:'));
  const cleanId = isGroup && String(identity).startsWith('group:') ? safeId.replace(/^group:/, '') : safeId;

  const identityClause = isGroup
    ? `is_account_group_member('${cleanId}')`
    : `current_user() = '${safeId}'`;

  if (!rolePredicate || rolePredicate === 'TRUE') {
    return `(${identityClause})`;
  }

  const cleanRolePred = rolePredicate.startsWith('(') && rolePredicate.endsWith(')')
    ? rolePredicate.slice(1, -1)
    : rolePredicate;

  return `(${identityClause} AND (${cleanRolePred}))`;
}

/**
 * Combines multiple user/role assignments into a composite DNF policy return expression.
 *
 * Structure:
 *   is_account_group_member('admin') OR
 *   (current_user() = 'alice' AND (role1 OR role2)) OR
 *   (current_user() = 'bob' AND (role3))
 *
 * @param {Array<object>} assignments - Array of assignments
 * @param {object} [options]
 * @param {string} [options.adminGroup='admin']
 * @returns {string}
 */
function buildCompositePolicyExpr(assignments, options = {}) {
  const adminGroup = options.adminGroup || 'admin';
  const adminClause = `is_account_group_member('${escapeSqlString(adminGroup)}')`;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return adminClause;
  }

  // Group assignments by identity
  const userMap = new Map();
  for (const item of assignments) {
    if (!item) continue;
    const userId = item.userId ?? item.user ?? item.userName;
    if (!userId) continue;

    const key = String(userId).trim();
    if (!userMap.has(key)) {
      userMap.set(key, {
        userId: key,
        isGroup: !!(item.isGroup || key.startsWith('group:')),
        roleRestrictionSets: []
      });
    }

    const entry = userMap.get(key);
    if (item.roles && Array.isArray(item.roles)) {
      for (const r of item.roles) {
        if (r && Array.isArray(r.restrictions)) {
          entry.roleRestrictionSets.push(r.restrictions);
        }
      }
    } else if (item.restrictions && Array.isArray(item.restrictions)) {
      entry.roleRestrictionSets.push(item.restrictions);
    }
  }

  if (userMap.size === 0) {
    return adminClause;
  }

  const userPredicates = [];

  for (const [, { userId, isGroup, roleRestrictionSets }] of userMap.entries()) {
    const rolePreds = [];

    for (const restrs of roleRestrictionSets) {
      const intra = buildIntraRolePredicate(restrs, options);
      if (intra === 'TRUE') {
        rolePreds.push('TRUE');
      } else if (intra) {
        if (intra.includes(' AND ') && !intra.startsWith('(')) {
          rolePreds.push(`(${intra})`);
        } else {
          rolePreds.push(intra);
        }
      }
    }

    const safeId = escapeSqlString(userId);
    const cleanId = isGroup && safeId.startsWith('group:') ? safeId.replace(/^group:/, '') : safeId;
    const identityClause = isGroup
      ? `is_account_group_member('${cleanId}')`
      : `current_user() = '${safeId}'`;

    if (rolePreds.length === 0 || rolePreds.includes('TRUE')) {
      userPredicates.push(`(${identityClause})`);
    } else if (rolePreds.length === 1) {
      const single = rolePreds[0];
      const cleanSingle = single.startsWith('(') && single.endsWith(')')
        ? single.slice(1, -1)
        : single;
      userPredicates.push(`(${identityClause} AND (${cleanSingle}))`);
    } else {
      // Multi-role per user: combined with OR
      const orCombined = rolePreds.join(' OR ');
      userPredicates.push(`(${identityClause} AND (${orCombined}))`);
    }
  }

  if (userPredicates.length === 0) {
    return adminClause;
  }

  return `${adminClause} OR\n  ${userPredicates.join(' OR\n  ')}`;
}

// Aliases for composite expression builder
const buildCompositeReturnExpression = buildCompositePolicyExpr;
const buildCompositeUserPredicates = buildCompositePolicyExpr;

/**
 * Resolves active DatabricksSettings for an environment (or active default).
 * @param {string} [environmentId]
 * @param {object} [cds]
 * @returns {Promise<object|null>}
 */
async function resolveDatabricksSettings(environmentId, cds) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const DatabricksSettings = entities.DatabricksSettings;

  if (!DatabricksSettings) {
    if (DatabricksClient.isTestEnvironment()) {
      return {
        targetCatalog: 'main',
        targetSchema: 'default',
        sqlWarehouseId: 'mock-wh',
        isActive: true
      };
    }
    return null;
  }

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

  if (!setting && DatabricksClient.isTestEnvironment()) {
    return {
      targetCatalog: 'main',
      targetSchema: 'default',
      sqlWarehouseId: 'mock-wh',
      isActive: true
    };
  }

  return setting;
}

/**
 * Resolves catalog, schema, table, and function names for an access domain.
 * @param {string} domainName
 * @param {object} setting
 * @returns {{ catalog: string, schema: string, domainSanitized: string, targetTable: string, filterName: string, fullTableName: string, fullFuncName: string }}
 */
function resolveTargetNaming(domainName, setting = {}) {
  const catalog = (setting.targetCatalog || 'main').trim();
  const schema = (setting.targetSchema || 'default').trim();
  const domainSanitized = sanitizeDomainName(domainName);
  const targetTable = `${domainSanitized}_flat_authorizations`;
  const filterName = `fn_filter_${domainSanitized}`;

  return {
    catalog,
    schema,
    domainSanitized,
    targetTable,
    filterName,
    fullTableName: `${catalog}.${schema}.${targetTable}`,
    fullFuncName: `${catalog}.${schema}.${filterName}`
  };
}

/**
 * Builds composite Unity Catalog SQL UDF Row Filter DDL and ALTER TABLE statements.
 *
 * @param {object} params
 * @param {string} params.catalog
 * @param {string} params.schema
 * @param {string} [params.domain]
 * @param {string} params.filterName
 * @param {string} params.targetTable
 * @param {string[]} params.columns
 * @param {object} [params.columnTypes]
 * @param {Array<object>} params.assignments
 * @param {object} [params.options]
 * @returns {{ fullFuncName: string, fullTableName: string, createFuncSql: string, setFilterSql: string, dropFilterSql: string, dropFuncSql: string, columns: string[] }}
 */
function buildDatabricksRowFilterDdl({ catalog, schema, domain, filterName, targetTable, columns, columnTypes = {}, assignments, options = {} }) {
  const cat = escapeIdentifier(catalog || 'main');
  const sch = escapeIdentifier(schema || 'default');
  const safeFilterName = escapeIdentifier(filterName);
  const safeTargetTable = escapeIdentifier(targetTable);
  const fullFuncName = `${cat}.${sch}.${safeFilterName}`;
  const fullTableName = `${cat}.${sch}.${safeTargetTable}`;

  const cleanColumns = Array.from(new Set((columns || []).filter(c => c && /^[a-zA-Z0-9_]+$/.test(c))));
  const safeColumns = cleanColumns.length > 0 ? cleanColumns : ['id'];

  const paramSignature = safeColumns.map(c => `${c} ${columnTypes[c] || 'STRING'}`).join(', ');
  const callArguments = safeColumns.join(', ');

  const returnExpression = buildCompositePolicyExpr(assignments, options);

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
    dropFuncSql,
    columns: safeColumns
  };
}

// Alias matching Explorer reports
const buildUnityCatalogRowFilterDdl = buildDatabricksRowFilterDdl;

/**
 * Internal helper to load all active assignments and resolved restrictions for an access domain.
 * @private
 */
async function loadDomainAssignmentsWithRestrictions(accessDomainId, cds, excludeAssignment = null) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { Roles, RoleAssignments, Restrictions, RoleInheritance, AccessDomainFields, RestrictionFields } = entities;

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
      assignmentId: assign.ID,
      userId: assign.userId,
      user: assign.userId,
      roleId: assign.role_ID,
      restrictions: resolved
    });
  }

  // Include any explicitly configured fields in AccessDomainFields
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
      // Non-fatal if association is unconfigured
    }
  }

  return {
    assignments: userAssignments,
    columns: Array.from(columnSet)
  };
}

/**
 * Re-computes and syncs policies for all assignments of a role and its derived descendants.
 * @param {string} roleId
 * @param {object} [cds]
 * @returns {Promise<object>}
 */
async function syncRoleToDatabricks(roleId, cds) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { Roles, RoleInheritance } = entities;

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
    const syncRes = await syncAssignmentToDatabricks(null, null, roleId, false, cdsConn, domainId);
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
 *
 * @param {string} [assignmentId]
 * @param {string} [userId]
 * @param {string} roleId
 * @param {boolean} [isDelete=false]
 * @param {object} [cds]
 * @param {string} [forcedDomainId]
 * @returns {Promise<object>}
 */
async function syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds, forcedDomainId = null) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { Roles, AccessDomains } = entities;

  if (isDelete) {
    return removeAssignmentFromDatabricks(userId, roleId, cdsConn);
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

  const setting = await resolveDatabricksSettings(role?.environment_ID, cdsConn);
  if (!setting) {
    console.warn(`[DatabricksSync] No active DatabricksSettings found. Skipping policy sync.`);
    return { success: false, skipped: true, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const naming = resolveTargetNaming(domainName, setting);
  const { assignments, columns } = await loadDomainAssignmentsWithRestrictions(domainId, cdsConn);

  // If assignment is not yet saved to DB but provided in call, synthesize it
  if (userId && roleId && !assignments.some(a => a.userId === userId && a.roleId === roleId)) {
    const ancestry = await fetchRoleAncestryChain(db, roleId, { Roles: entities.Roles, Restrictions: entities.Restrictions, RoleInheritance: entities.RoleInheritance });
    const resolved = resolveEffectiveRestrictions(roleId, ancestry.allRoles, ancestry.allRestrictions, ancestry.allInheritances);
    assignments.push({
      assignmentId,
      userId,
      user: userId,
      roleId,
      restrictions: resolved
    });
    for (const r of resolved) {
      if (r.field && !columns.includes(r.field)) columns.push(r.field);
    }
  }

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
 *
 * @param {string} userId
 * @param {string} roleId
 * @param {object} [cds]
 * @returns {Promise<object>}
 */
async function removeAssignmentFromDatabricks(userId, roleId, cds) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { Roles, AccessDomains } = entities;

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

  const setting = await resolveDatabricksSettings(role?.environment_ID, cdsConn);
  if (!setting) {
    return { success: false, skipped: true, reason: 'NO_ACTIVE_SETTINGS' };
  }

  const naming = resolveTargetNaming(domainName, setting);
  const { assignments, columns } = await loadDomainAssignmentsWithRestrictions(domainId, cdsConn, { userId, roleId });

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
 * Provisions schema and target flat table for an Access Domain on Databricks.
 * @param {string} accessDomainId
 * @param {object} [cds]
 * @returns {Promise<object>}
 */
async function syncAccessDomainToDatabricks(accessDomainId, cds) {
  const cdsConn = cds || require('@sap/cds');
  const db = cdsConn.db || (await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { AccessDomains, AccessDomainFields, RestrictionFields } = entities;

  const domain = await db.run(SELECT.one.from(AccessDomains).where({ ID: accessDomainId }));
  if (!domain) {
    return { success: false, skipped: true, reason: 'DOMAIN_NOT_FOUND' };
  }

  if (domain.targetPlatform === 'DATASPHERE') {
    return { success: true, skipped: true, platform: 'DATASPHERE' };
  }

  const setting = await resolveDatabricksSettings(null, cdsConn);
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

/**
 * Domain-level policy sync orchestrator matching Explorer 1 & 2 interfaces.
 *
 * @param {object} params
 * @param {string} params.domainName
 * @param {string} [params.environmentId]
 * @param {object} [deps]
 * @returns {Promise<{ success: boolean, actions?: string[], reason?: string }>}
 */
async function syncDatabricksPolicyForDomain({ domainName, environmentId }, deps = {}) {
  const cdsConn = deps.cds || require('@sap/cds');
  const db = deps.db || (cdsConn.db ? cdsConn.db : await cdsConn.connect.to('db'));
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db.entities;
  const { AccessDomains } = entities;

  const domain = await db.run(SELECT.one.from(AccessDomains).where({ name: domainName }));
  const domainId = domain?.ID || domainName;

  const setting = await resolveDatabricksSettings(environmentId, cdsConn);
  if (!setting) {
    return { success: false, reason: 'No active DatabricksSettings found' };
  }

  const { assignments } = await loadDomainAssignmentsWithRestrictions(domainId, cdsConn);
  const naming = resolveTargetNaming(domainName, setting);

  if (assignments.length === 0) {
    try {
      await DatabricksClient.executeStatement({
        warehouseId: setting.sqlWarehouseId,
        statement: `ALTER TABLE ${naming.fullTableName} DROP ROW FILTER;`,
        catalog: naming.catalog,
        schema: naming.schema
      });
    } catch {}

    try {
      await DatabricksClient.executeStatement({
        warehouseId: setting.sqlWarehouseId,
        statement: `DROP FUNCTION IF EXISTS ${naming.fullFuncName};`,
        catalog: naming.catalog,
        schema: naming.schema
      });
    } catch {}

    return { success: true, actions: ['DROPPED_ROW_FILTER'] };
  }

  await syncAssignmentToDatabricks(null, null, null, false, cdsConn, domainId);
  return { success: true, actions: ['CREATED_FUNCTION', 'SET_ROW_FILTER'] };
}

module.exports = {
  escapeSqlString,
  escapeIdentifier,
  sanitizeDomainName,
  extractId,
  translateRestrictionToSql,
  translateRestrictionToDatabricksSql,
  buildIntraRolePredicate,
  buildUserBindingPredicate,
  buildCompositePolicyExpr,
  buildCompositeReturnExpression,
  buildCompositeUserPredicates,
  resolveDatabricksSettings,
  resolveTargetNaming,
  buildDatabricksRowFilterDdl,
  buildUnityCatalogRowFilterDdl,
  syncRoleToDatabricks,
  syncAssignmentToDatabricks,
  removeAssignmentFromDatabricks,
  syncAccessDomainToDatabricks,
  syncDatabricksPolicyForDomain
};
