'use strict';

/**
 * HanaReplicationService
 *
 * Encapsulates all logic for replicating role assignment data to SAP HANA
 * flat tables. Previously embedded as nested helper functions inside
 * authorization-service.js (L193-314).
 *
 * Dependencies are injected to keep this module unit-testable in isolation.
 */

const { resolveEffectiveRestrictions } = require('../lib/resolveEffectiveRestrictions');

/**
 * Converts resolved CAP restrictions into HANA flat-table row objects.
 * Handles SINGLE_VALUE, RANGE, MULTI_VALUE, and PATTERN filter types.
 *
 * @param {object[]} restrictions  - resolved restriction list from resolveEffectiveRestrictions()
 * @param {string}   roleName      - the role's display name (written to ROLE column)
 * @param {string}   userId        - the assigned user (written to USER column)
 * @returns {object[]} flat row entries ready for HanaClient.syncAssignment()
 */
function cartesianProduct(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];

  let results = [{}];
  for (const key of keys) {
    const nextResults = [];
    const valArray = obj[key];
    for (const res of results) {
      for (const val of valArray) {
        nextResults.push({
          ...res,
          [key]: val
        });
      }
    }
    results = nextResults;
  }
  return results;
}

/**
 * Extracts the raw ID string from a stored restriction value.
 * Handles enriched {id, text} objects (new format) as well as plain strings (legacy).
 * @param {string|object} val - stored value or parsed item
 * @returns {string}
 */
function extractId(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return String(val.id ?? '');
  return String(val);
}


function buildFlatAuthorizationsForHana(restrictions, roleName, userId) {
  // Group resolved restrictions by field name
  const restrictionsByField = {};
  for (const r of restrictions) {
    if (r.filterType === 'HIERARCHY') continue; // Skip HIERARCHY types for flat table
    if (!restrictionsByField[r.field]) {
      restrictionsByField[r.field] = [];
    }
    restrictionsByField[r.field].push(r);
  }

  const fieldValues = {};
  for (const field of Object.keys(restrictionsByField)) {
    const list = restrictionsByField[field];
    const vals = [];
    for (const r of list) {
      let op  = r.filterType;
      let low = r.value;
      let high = '';

      // Unwrap {id, text} enriched single value (new format)
      if (low && typeof low === 'string') {
        try {
          const p = JSON.parse(low);
          if (p && typeof p === 'object' && !Array.isArray(p) && p.id !== undefined) {
            low = extractId(p);
          }
        } catch { /* plain string — leave as-is */ }
      }

      // Map legacy filterType names to HANA operators if needed
      if (r.filterType === 'SINGLE_VALUE') {
        op = 'EQ';
      } else if (r.filterType === 'PATTERN') {
        op = 'CP';
      } else if (r.filterType === 'RANGE') {
        op = 'BT';
      }

      if (op === 'BT' || op === 'BETWEEN' || String(op).toUpperCase() === 'BETWEEN' || String(r.filterType).toUpperCase() === 'BETWEEN' || String(r.filterType).toUpperCase() === 'RANGE') {
        op = 'BT';
        if (r.value) {
          if (typeof r.value === 'object') {
            low  = extractId(r.value.from !== undefined ? r.value.from : '');
            high = extractId(r.value.to   !== undefined ? r.value.to   : '');
          } else {
            try {
              const rangeObj = JSON.parse(r.value);
              low  = extractId(rangeObj.from !== undefined ? rangeObj.from : '');
              high = extractId(rangeObj.to   !== undefined ? rangeObj.to   : '');
            } catch (e) {
              console.warn(`[HanaReplication] Malformed RANGE/BT value for restriction ${r.restrictionId}: ${e.message}`);
            }
          }
        }
      }

      if (r.filterType === 'MULTI_VALUE') {
        op = 'EQ'; // HANA flat table doesn't have an IN list operator; it uses multiple EQ rows
        let values = [r.value];
        try {
          const parsed = JSON.parse(r.value);
          values = Array.isArray(parsed) ? parsed : [r.value];
        } catch (e) {
          console.warn(`[HanaReplication] Malformed MULTI_VALUE for restriction ${r.restrictionId}: ${e.message}`);
        }
        for (const val of values) {
          vals.push({ field, operator: op, low: extractId(val), high });
        }
      } else {
        if (['ALL', 'N', 'NN'].includes(op)) {
          low = '';
        }
        vals.push({ field, operator: op, low, high });
      }
    }
    fieldValues[field] = vals;
  }

  const finalEntries = [];
  const combinations = cartesianProduct(fieldValues);

  combinations.forEach((comb, combIdx) => {
    // If there is only one combination, keep the original role name.
    // Otherwise, append the 1-based running index (e.g. ROLE_1, ROLE_2, etc.)
    const suffixedRoleName = combinations.length > 1 ? `${roleName}_${combIdx + 1}` : roleName;

    for (const key of Object.keys(comb)) {
      const valObj = comb[key];
      finalEntries.push({
        userId,
        roleName: suffixedRoleName,
        field: valObj.field,
        operator: valObj.operator,
        low: valObj.low,
        high: valObj.high
      });
    }
  });

  return finalEntries;
}

function buildHierAuthorizationsForHana(restrictions, roleName, userId) {
  const entries = [];

  /**
   * Extracts the hierarchy directory identifier from a node ID.
   * DataSphere "Hierarchy with Directory" DAC maps:
   *   - HIERARCHY_IDENTIFIERS → Hierarchy Identifier (the directory prefix, e.g. 'DACH' from 'DACH/0')
   *   - ROOT_VALUES           → Hierarchy Node compound key (e.g. 'DACH/0')
   *
   * The directory prefix is everything before the first '/'.
   * If no separator is present, the full value is used.
   */
  function extractHierarchyId(nodeId) {
    if (!nodeId) return '';
    const slashIdx = String(nodeId).indexOf('/');
    return slashIdx > 0 ? String(nodeId).substring(0, slashIdx) : String(nodeId);
  }

  for (const r of restrictions) {
    if (r.filterType !== 'HIERARCHY') continue;
    
    let parsed = null;
    try {
      parsed = JSON.parse(r.value);
    } catch (e) {
      parsed = r.value;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object') {
          const nodeId = item.id || '';
          entries.push({
            identifier:     userId,
            restriction:    roleName,
            targetNodeType: r.field,
            rootNodeType:   item.nodeType || '',
            rootValues:     nodeId,
            hierIdentifier: item.hierarchy || extractHierarchyId(nodeId)
          });
        } else {
          const nodeId = item || '';
          entries.push({
            identifier:     userId,
            restriction:    roleName,
            targetNodeType: r.field,
            rootNodeType:   '',
            rootValues:     nodeId,
            hierIdentifier: extractHierarchyId(nodeId)
          });
        }
      }
    } else {
      const nodeId = r.value || '';
      entries.push({
        identifier:     userId,
        restriction:    roleName,
        targetNodeType: r.field,
        rootNodeType:   '',
        rootValues:     nodeId,
        hierIdentifier: extractHierarchyId(nodeId)
      });
    }
  }

  return entries;
}


/**
 * Recursively fetches only the roles, restrictions, and inheritances belonging
 * to the ancestry chain of the specified role ID, avoiding full-table scans.
 */
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

/**
 * Replicates a single role assignment to all active SAP HANA flat tables.
 *
 * @param {object}   cds            - CAP cds instance
 * @param {object}   HanaClient     - injected HANA client
 * @param {object}   entities       - CAP entity descriptors { Roles, Restrictions, RoleInheritance, BdcSettings }
 * @param {string}   assignmentId   - the RoleAssignment ID
 * @param {string}   userId         - the assigned user ID
 * @param {string}   roleId         - the role ID
 * @param {boolean}  isDelete       - if true, removes rows rather than upserting
 * @param {object}   [preloaded]    - optional pre-loaded { allRoles, allRestrictions, allInheritances } to avoid full-table scans
 */
async function syncAssignmentToHana(cds, HanaClient, entities, assignmentId, userId, roleId, isDelete, preloaded) {
  const db = cds.db;
  const { Roles, Restrictions, RoleInheritance, BdcSettings } = entities;

  console.log(`[HanaReplication] Starting sync for assignment ${assignmentId}, user: ${userId}, role: ${roleId}, isDelete: ${isDelete}`);

  const role = preloaded?.allRoles ? preloaded.allRoles.find(r => r.ID === roleId) : await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
  if (!role) {
    console.log(`[HanaReplication] Role ${roleId} not found in database!`);
    return;
  }

  // Resolve custom table name corresponding to application context
  let customTableName = null;
  let customHierTableName = null;
  if (role.stream_ID) {
    const { Streams } = cds.entities('fanrio.auth');
    const stream = preloaded?.allStreams ? preloaded.allStreams.find(s => s.ID === role.stream_ID) : await db.run(SELECT.one.from(Streams).columns('name').where({ ID: role.stream_ID }));
    if (stream && stream.name) {
      const cleanStreamName = stream.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
      customTableName = `${cleanStreamName}_flat_authorizations`;
      customHierTableName = `${cleanStreamName}_hier_authorizations`;
    }
  }

  let entries = [];
  let hierEntries = [];

  if (!isDelete) {
    let preloadedData = preloaded;
    if (!preloadedData) {
      preloadedData = await fetchRoleAncestryChain(db, roleId, { Roles, Restrictions, RoleInheritance });
    }

    const allRoles        = preloadedData.allRoles;
    const allRestrictions = preloadedData.allRestrictions;
    const allInheritances = preloadedData.allInheritances;

    let resolved = [];
    try {
      resolved = resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
    } catch (e) {
      console.error('[HanaReplication] Failed resolving effective restrictions:', e.message);
      return;
    }

    console.log(`[HanaReplication] Resolved restrictions count: ${resolved.length}`);
    entries = buildFlatAuthorizationsForHana(resolved, role.name, userId);
    hierEntries = buildHierAuthorizationsForHana(resolved, role.name, userId);
    console.log(`[HanaReplication] Built HANA flat entries count: ${entries.length}`, JSON.stringify(entries));
    console.log(`[HanaReplication] Built HANA hier entries count: ${hierEntries.length}`, JSON.stringify(hierEntries));
  }

  const bdcSettings = preloaded?.bdcSettings || await db.run(SELECT.from(BdcSettings).where({ connectionType: 'SAP Hana', isActive: true }));
  console.log(`[HanaReplication] Found active HANA connections: ${bdcSettings.length}`);
  if (bdcSettings.length === 0) return;

  for (const setting of bdcSettings) {
    console.log(`[HanaReplication] Starting sync steps for system [${setting.systemName}]...`);
    
    // 1. Sync to default flat table (if exists)
    try {
      console.log(`[HanaReplication] Syncing to default flat table on [${setting.systemName}]...`);
      await HanaClient.syncAssignment(setting, assignmentId, isDelete, entries);
    } catch (err) {
      const errMsg = err.message.toLowerCase();
      const isTableMissing = errMsg.includes('authorization_flat') && (errMsg.includes('could not find table') || errMsg.includes('invalid table name'));
      if (isTableMissing) {
        console.warn(`[HanaReplication] Default flat table sync skipped (missing global table):`, err.message);
      } else {
        throw err;
      }
    }

    // 2. Sync to custom flat table (if stream configured)
    if (customTableName) {
      console.log(`[HanaReplication] Syncing to custom flat table [${customTableName}] on [${setting.systemName}]...`);
      await HanaClient.syncCustomAssignment(setting, customTableName, assignmentId, isDelete, entries, role.name);
    }

    // 3. Sync to custom hier table (if stream configured)
    if (customHierTableName) {
      console.log(`[HanaReplication] Syncing to custom hier table [${customHierTableName}] on [${setting.systemName}]...`);
      await HanaClient.syncCustomHierAssignment(setting, customHierTableName, assignmentId, isDelete, hierEntries);
    }

    console.log(`[HanaReplication] All sync steps completed for system [${setting.systemName}]`);
  }
}

/**
 * Re-syncs all assignments of a role (and all its derived descendants) to HANA.
 * Pre-fetches all necessary data once to avoid N×3 full-table scans (A-12 fix).
 *
 * @param {object} cds        - CAP cds instance
 * @param {object} HanaClient - injected HANA client
 * @param {object} entities   - CAP entity descriptors
 * @param {string} roleId     - root role whose assignments need to be re-synced
 */
async function syncRoleAssignmentsToHana(cds, HanaClient, entities, roleId) {
  const db = cds.db;
  const { Roles, Restrictions, RoleInheritance, RoleAssignments, BdcSettings } = entities;
  const { Streams } = cds.entities('fanrio.auth');

  try {
    // A-12 and Issue #4 fix: pre-fetch all needed tables once, then pass as preloaded to each child call
    const [allRoles, allRestrictions, allInheritances, allStreams, bdcSettings] = await Promise.all([
      db.run(SELECT.from(Roles)),
      db.run(SELECT.from(Restrictions)),
      db.run(SELECT.from(RoleInheritance)),
      db.run(SELECT.from(Streams).columns('ID', 'name')),
      db.run(SELECT.from(BdcSettings).where({ connectionType: 'SAP Hana', isActive: true }))
    ]);
    const preloaded = { allRoles, allRestrictions, allInheritances, allStreams, bdcSettings };

    // Collect the role itself + all descendant roles (roles that inherit from this one)
    const roleIds = new Set([roleId]);
    const queue   = [roleId];
    while (queue.length > 0) {
      const currId = queue.shift();
      for (const ri of allInheritances.filter(r => r.parent_ID === currId)) {
        if (!roleIds.has(ri.role_ID)) {
          roleIds.add(ri.role_ID);
          queue.push(ri.role_ID);
        }
      }
    }

    const assignments = await db.run(
      SELECT.from(RoleAssignments).where({ role_ID: { in: Array.from(roleIds) } })
    );

    // Process in batches of 5 to limit concurrency while dramatically speeding up sequential execution
    const batchSize = 5;
    for (let i = 0; i < assignments.length; i += batchSize) {
      const batch = assignments.slice(i, i + batchSize);
      await Promise.all(batch.map(assignment =>
        syncAssignmentToHana(cds, HanaClient, entities, assignment.ID, assignment.userId, assignment.role_ID, false, preloaded)
      ));
    }
  } catch (err) {
    console.error(`[HanaReplication] Failed to sync role assignments for role ${roleId}:`, err.message);
  }
}

module.exports = {
  syncAssignmentToHana,
  syncRoleAssignmentsToHana,
  fetchRoleAncestryChain,
  buildFlatAuthorizationsForHana,
  buildHierAuthorizationsForHana
};

