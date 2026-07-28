'use strict';

/**
 * RoleManagementService
 *
 * Domain service providing business logic for Roles management:
 *   - Fine-grained Delta Sync for child collections
 *   - Duplicate inherited restriction validation
 *   - Cascading deletion of derived roles and assignments
 *   - Role state diff computation for audit logging
 */

/**
 * Fine-grained Delta Sync for child collections on UPDATE.
 * Compares incoming collection vs existing DB records by ID:
 *   - DELETE missing items
 *   - UPDATE changed items
 *   - INSERT new items
 */
async function syncCollectionDelta(cds, db, entity, fkField, fkValue, incomingItems, fieldMapper) {
  if (!incomingItems) return;

  const existingInDb = await db.run(SELECT.from(entity).where({ [fkField]: fkValue }));
  const existingMap = new Map(existingInDb.map(item => [item.ID, item]));

  const incomingNormalized = incomingItems.map(item => fieldMapper(item, fkValue)).filter(Boolean);
  const incomingMap = new Map(incomingNormalized.filter(i => i.ID).map(i => [i.ID, i]));

  // 1. DELETE missing items
  const toDeleteIds = existingInDb.filter(item => !incomingMap.has(item.ID)).map(item => item.ID);
  if (toDeleteIds.length > 0) {
    await db.run(DELETE.from(entity).where({ ID: { in: toDeleteIds } }));
  }

  // 2. UPDATE changed items & INSERT new items
  const toInsert = [];
  for (const item of incomingNormalized) {
    if (item.ID && existingMap.has(item.ID)) {
      const existing = existingMap.get(item.ID);
      const updates = {};
      for (const key of Object.keys(item)) {
        if (key === 'ID' || key === fkField) continue;
        if (existing[key] !== item[key]) {
          updates[key] = item[key];
        }
      }
      if (Object.keys(updates).length > 0) {
        await db.run(UPDATE(entity).set(updates).where({ ID: item.ID }));
      }
    } else {
      toInsert.push({
        ...item,
        ID: item.ID || cds.utils.uuid(),
        [fkField]: fkValue
      });
    }
  }

  if (toInsert.length > 0) {
    await db.run(INSERT.into(entity).entries(toInsert));
  }
}

/**
 * Check if inheriting from parent_ID would cause duplicate restriction criteria.
 */
async function checkDuplicateInheritedRestrictions(db, entities, role_ID, parent_ID) {
  const { Restrictions } = entities;
  const childRestrictions = await db.run(SELECT.from(Restrictions).where({ role_ID }));
  if (!childRestrictions || childRestrictions.length === 0) return null;

  const parentRestrictions = await db.run(SELECT.from(Restrictions).where({ role_ID: parent_ID }));
  if (!parentRestrictions || parentRestrictions.length === 0) return null;

  for (const childRes of childRestrictions) {
    const duplicate = parentRestrictions.find(parentRes =>
      parentRes.field === childRes.field &&
      parentRes.filterType === childRes.filterType &&
      parentRes.value === childRes.value
    );
    if (duplicate) {
      return `Derived role cannot inherit from parent role because they have duplicate restrictions (Field: ${childRes.field}, Value: ${childRes.value}).`;
    }
  }
  return null;
}

/**
 * Computes primitive & collection diffs for audit logging.
 */
function computeRoleDiff(beforeState, afterState) {
  const diff = {};
  if (!beforeState || !afterState) return diff;

  for (const key of Object.keys(afterState)) {
    if (['modifiedAt', 'modifiedBy', 'ownRestrictions', 'parentRoles', 'approvers', 'assignments'].includes(key)) continue;
    if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
      diff[key] = { old: beforeState[key], new: afterState[key] };
    }
  }

  for (const col of ['ownRestrictions', 'parentRoles', 'approvers', 'assignments']) {
    const oldList = beforeState[col] || [];
    const newList = afterState[col] || [];
    if (JSON.stringify(oldList) !== JSON.stringify(newList)) {
      diff[col] = { old: oldList, new: newList };
    }
  }

  return diff;
}

/**
 * Process recursive cascading role deletion and associated assignment removals.
 */
async function processCascadingRoleDelete(db, service, entities, roleId) {
  const { Roles, RoleAssignments, RoleInheritance } = entities;
  const allInheritances = await db.run(SELECT.from(RoleInheritance));
  const descendantRoleIds = [];
  const queue = [roleId];
  const visited = new Set([roleId]);

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const child of allInheritances.filter(ri => ri.parent_ID === curr)) {
      if (!visited.has(child.role_ID)) {
        visited.add(child.role_ID);
        descendantRoleIds.push(child.role_ID);
        queue.push(child.role_ID);
      }
    }
  }

  const allRoleIds = [roleId, ...descendantRoleIds];
  const assignments = await db.run(SELECT.from(RoleAssignments).where({ role_ID: { in: allRoleIds } }));

  for (const assignment of assignments) {
    await service.run(DELETE.from(RoleAssignments).where({ ID: assignment.ID }));
  }

  await db.run(DELETE.from(RoleInheritance).where({
    or: [{ role_ID: { in: allRoleIds } }, { parent_ID: { in: allRoleIds } }]
  }));

  for (const descId of descendantRoleIds) {
    await service.run(DELETE.from(Roles).where({ ID: descId }));
  }
}

module.exports = {
  syncCollectionDelta,
  checkDuplicateInheritedRestrictions,
  computeRoleDiff,
  processCascadingRoleDelete
};
