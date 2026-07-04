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
function buildHanaEntries(restrictions, roleName, userId) {
  const entries = [];

  for (const r of restrictions) {
    let op  = 'EQ';
    let low = r.value;
    let high = '';

    if (r.filterType === 'SINGLE_VALUE') {
      op = 'EQ';
    } else if (r.filterType === 'RANGE') {
      op = 'BT';
      try {
        const rangeObj = JSON.parse(r.value);
        low  = String(rangeObj.from || '');
        high = String(rangeObj.to   || '');
      } catch (e) {
        console.warn(`[HanaReplication] Malformed RANGE value for restriction ${r.restrictionId}: ${e.message}`);
      }
    } else if (r.filterType === 'PATTERN') {
      op = 'CP';
    }

    if (r.filterType === 'MULTI_VALUE') {
      let values = [r.value];
      try {
        const parsed = JSON.parse(r.value);
        values = Array.isArray(parsed) ? parsed : [r.value];
      } catch (e) {
        console.warn(`[HanaReplication] Malformed MULTI_VALUE for restriction ${r.restrictionId}: ${e.message}`);
      }
      for (const val of values) {
        entries.push({ userId, roleName, field: r.field, operator: op, low: String(val), high });
      }
    } else {
      entries.push({ userId, roleName, field: r.field, operator: op, low, high });
    }
  }

  return entries;
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

  if (!isDelete) {
    const role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
    if (!role) return;

    // A-12 fix: use pre-loaded data when provided to avoid 3× full-table scans per assignment
    const allRoles        = preloaded?.allRoles        ?? await db.run(SELECT.from(Roles));
    const allRestrictions = preloaded?.allRestrictions ?? await db.run(SELECT.from(Restrictions));
    const allInheritances = preloaded?.allInheritances ?? await db.run(SELECT.from(RoleInheritance));

    let resolved = [];
    try {
      resolved = resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
    } catch (e) {
      console.error('[HanaReplication] Failed resolving effective restrictions:', e.message);
      return;
    }

    entries = buildHanaEntries(resolved, role.name, userId);
  }

  const bdcSettings = await db.run(SELECT.from(BdcSettings).where({ connectionType: 'SAP Hana', isActive: true }));
  if (bdcSettings.length === 0) return;

  for (const setting of bdcSettings) {
    try {
      await HanaClient.syncAssignment(setting, assignmentId, isDelete, entries);
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

module.exports = { buildHanaEntries, syncAssignmentToHana, syncRoleAssignmentsToHana };
