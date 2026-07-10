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

function buildHanaEntries(restrictions, roleName, userId) {
  // Group resolved restrictions by field name
  const restrictionsByField = {};
  for (const r of restrictions) {
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
            low  = String(r.value.from !== undefined ? r.value.from : '');
            high = String(r.value.to !== undefined ? r.value.to : '');
          } else {
            try {
              const rangeObj = JSON.parse(r.value);
              low  = String(rangeObj.from !== undefined ? rangeObj.from : '');
              high = String(rangeObj.to !== undefined ? rangeObj.to : '');
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
          vals.push({ field, operator: op, low: String(val), high });
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

  let entries = [];

  console.log(`[HanaReplication] Starting sync for assignment ${assignmentId}, user: ${userId}, role: ${roleId}, isDelete: ${isDelete}`);

  const role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
  if (!role) {
    console.log(`[HanaReplication] Role ${roleId} not found in database!`);
    return;
  }

  // Resolve custom table name corresponding to application context
  let customTableName = null;
  if (role.stream_ID) {
    const { Streams } = cds.entities('fanrio.auth');
    const appCtx = await db.run(SELECT.one.from(Streams).columns('name').where({ ID: role.stream_ID }));
    if (appCtx && appCtx.name) {
      customTableName = `${appCtx.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')}_flat_authorizations`;
    }
  }

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
    entries = buildHanaEntries(resolved, role.name, userId);
    console.log(`[HanaReplication] Built HANA flat entries count: ${entries.length}`, JSON.stringify(entries));
  }

  const bdcSettings = await db.run(SELECT.from(BdcSettings).where({ connectionType: 'SAP Hana', isActive: true }));
  console.log(`[HanaReplication] Found active HANA connections: ${bdcSettings.length}`);
  if (bdcSettings.length === 0) return;

  for (const setting of bdcSettings) {
    try {
      console.log(`[HanaReplication] Syncing to default table on [${setting.systemName}]...`);
      await HanaClient.syncAssignment(setting, assignmentId, isDelete, entries);

      if (customTableName) {
        console.log(`[HanaReplication] Syncing to custom context table [${customTableName}] on [${setting.systemName}]...`);
        await HanaClient.syncCustomAssignment(setting, customTableName, assignmentId, isDelete, entries, role.name);
      }

      console.log(`[HanaReplication] Sync completed successfully for system [${setting.systemName}]!`);
    } catch (err) {
      console.error(`[HanaReplication] Sync failed for system [${setting.systemName}]:`, err.message);
    }
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
  const { Roles, Restrictions, RoleInheritance, RoleAssignments } = entities;

  try {
    // A-12 fix: pre-fetch all needed tables once, then pass as preloaded to each child call
    const [allRoles, allRestrictions, allInheritances] = await Promise.all([
      db.run(SELECT.from(Roles)),
      db.run(SELECT.from(Restrictions)),
      db.run(SELECT.from(RoleInheritance))
    ]);
    const preloaded = { allRoles, allRestrictions, allInheritances };

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

    for (const assignment of assignments) {
      try {
        await syncAssignmentToHana(cds, HanaClient, entities, assignment.ID, assignment.userId, assignment.role_ID, false, preloaded);
      } catch (e) {
        console.error(`[HanaReplication] Failed to re-sync assignment ${assignment.ID}:`, e.message);
      }
    }
  } catch (err) {
    console.error(`[HanaReplication] Failed to sync role assignments for role ${roleId}:`, err.message);
  }
}

module.exports = { syncAssignmentToHana, syncRoleAssignmentsToHana, fetchRoleAncestryChain, buildHanaEntries };

