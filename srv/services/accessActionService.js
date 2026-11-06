'use strict';

/**
 * AccessActionService
 *
 * OData action handlers for:
 *   - resolveEffectiveRestrictions  — recursively resolves the full inherited restriction chain
 *   - simulateAccess                — evaluates a set of sample data rows against effective restrictions
 *
 * Previously embedded in authorization-service.js (L382-453).
 */

const { resolveEffectiveRestrictions, evaluateRestriction } = require('../lib/resolveEffectiveRestrictions');
const { getSessionPermissions, filterRolesByBackendPermissions } = require('../lib/authGuard');

async function checkRoleAccess(req, db, entities, roleId, allRoles, allInheritances) {
  if (!roleId) return true;
  const { AppAuthorizations } = entities;
  const perms = await getSessionPermissions(req, db, AppAuthorizations);
  if (perms.isSuperAdmin) return true;

  const targetRole = (allRoles || []).find(r => r.ID === roleId);
  if (!targetRole) {
    req.error(404, `Role with ID '${roleId}' not found`);
    return false;
  }

  const visible = filterRolesByBackendPermissions([targetRole], perms, allInheritances);
  if (!visible || visible.length === 0) {
    req.reject(403, `Access Denied: You are not authorized to view or simulate access for role '${targetRole.name}'.`);
    return false;
  }
  return true;
}

/**
 * Factory: returns the resolveEffectiveRestrictions OData action handler.
 *
 * @param {object} cds      - CAP cds instance
 * @param {object} entities - { Roles, Restrictions, RoleInheritance }
 */
function makeResolveEffectiveRestrictionsHandler(cds, entities) {
  return async function resolveEffectiveRestrictionsHandler(req) {
    const { roleId } = req.data;
    const { Roles, Restrictions, RoleInheritance } = entities;
    const db = cds.db;

    const allRoles        = await db.run(SELECT.from(Roles));
    const allInheritances = await db.run(SELECT.from(RoleInheritance));

    const isAllowed = await checkRoleAccess(req, db, entities, roleId, allRoles, allInheritances);
    if (!isAllowed) return;

    const allRestrictions = await db.run(SELECT.from(Restrictions));

    try {
      return resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
    } catch (e) {
      return req.error(400, e.message);
    }
  };
}

/**
 * Factory: returns the simulateAccess OData action handler.
 *
 * @param {object} cds      - CAP cds instance
 * @param {object} entities - { Roles, Restrictions, RoleInheritance }
 */
function makeSimulateAccessHandler(cds, entities) {
  return async function simulateAccessHandler(req) {
    const { roleId, sampleData, restrictions } = req.data;
    const { Roles, Restrictions, RoleInheritance } = entities;
    const db = cds.db;

    let rows;
    try {
      rows = JSON.parse(sampleData);
    } catch {
      return req.error(400, 'sampleData must be a valid JSON array string');
    }

    let effectiveRestrictions = [];

    if (roleId) {
      const allRoles        = await db.run(SELECT.from(Roles));
      const allInheritances = await db.run(SELECT.from(RoleInheritance));

      const isAllowed = await checkRoleAccess(req, db, entities, roleId, allRoles, allInheritances);
      if (!isAllowed) return;

      const allRestrictions = await db.run(SELECT.from(Restrictions));
      try {
        effectiveRestrictions = resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
      } catch (e) {
        return req.error(400, e.message);
      }
    }

    if (restrictions) {
      try {
        const parsedRest = JSON.parse(restrictions);
        if (Array.isArray(parsedRest)) {
          for (const r of parsedRest) {
            effectiveRestrictions.push({ field: r.field, filterType: r.filterType, value: r.value });
          }
        }
      } catch (e) {
        return req.error(400, 'restrictions must be a valid JSON array string');
      }
    }

    return rows.map((row, idx) => {
      for (const restriction of effectiveRestrictions) {
        const result = evaluateRestriction(restriction, row);
        if (!result.passed) return { rowIndex: idx, passed: false, reason: result.reason };
      }
      return { rowIndex: idx, passed: true, reason: 'All restrictions satisfied' };
    });
  };
}

module.exports = { makeResolveEffectiveRestrictionsHandler, makeSimulateAccessHandler };
