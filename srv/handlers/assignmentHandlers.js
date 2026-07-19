'use strict';

/**
 * Assignment Handlers
 *
 * Registers all CAP event hooks for the RoleAssignments entity:
 *   - Restriction validation before CREATE (no empty-restriction roles)
 *   - HANA sync + replication queue on CREATE
 *   - HANA sync + replication queue on DELETE
 *   - Audit log on CREATE / UPDATE / DELETE
 *
 * Previously in authorization-service.js (L316-351, L1273-1385).
 *
 * @param {object} service  - CAP service instance (this)
 * @param {object} entities - { Roles, Restrictions, RoleInheritance, RoleAssignments, AuditLogs }
 * @param {{ cds, queueReplication, syncAssignmentToHana, resolveEffectiveRestrictions }} deps
 */
const { getUserId, getSessionPermissions, requirePermission, requireEnvironment } = require('../lib/authGuard');
const { fetchRoleAncestryChain } = require('../services/hanaReplicationService');

function registerAssignmentHandlers(service, entities, deps) {
  const { cds, queueReplication, syncAssignmentToHana, resolveEffectiveRestrictions } = deps;
  const { Roles, Restrictions, RoleInheritance, RoleAssignments, AuditLogs, RoleApprovers, AppAuthorizations } = entities;

  // -------------------------------------------------------------------------
  // RoleAssignments CRUD protection
  // -------------------------------------------------------------------------
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'RoleAssignments', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    const userId = getUserId(req);

    let roleId = req.data.role_ID;
    let assignmentId = req.data.ID;
    if (!assignmentId && req.params?.length > 0) {
      const p = req.params[0];
      assignmentId = typeof p === 'object' ? p.ID : p;
    }

    if (!roleId && assignmentId) {
      const existing = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: assignmentId }));
      roleId = existing?.role_ID;
    }

    // Check if the current user is an approver for this role
    let isApprover = false;
    if (roleId && userId) {
      const allApprovers = await cds.db.run(SELECT.from(RoleApprovers).where({ role_ID: roleId }));
      if (allApprovers.some(a => String(a.userId).toLowerCase() === userId.toLowerCase())) {
        isApprover = true;
      }
    }

    let role = null;
    if (roleId) {
      role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
    }

    if (!isApprover && !perms.isSuperAdmin) {
      const isDerivedRole = role && role.type === 'DERIVED';
      const allowedByGlobalAssign = perms.canAssignRoles;
      const allowedByDerivedManage = perms.canManageDerivedRoles && isDerivedRole;

      if (!allowedByGlobalAssign && !allowedByDerivedManage) {
        requirePermission(perms, 'canAssignRoles', req);
      }

      if (role?.environment_ID) {
        requireEnvironment(perms, role.environment_ID, req);
      }

      // If user has authorization to manage derived roles ONLY, they can only assign derived roles, not parent roles
      if (!perms.canManageSingleRoles) {
        if (req.event === 'CREATE' || req.event === 'UPDATE') {
          if (role && role.type !== 'DERIVED') {
            req.reject(403, 'Access Denied: You are only authorized to assign derived roles, not parent roles.');
          }
        }
      }
    } else if (role) {
      if (role.environment_ID) {
        requireEnvironment(perms, role.environment_ID, req);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Validate: role must have at least one restriction before assignment
  // -------------------------------------------------------------------------
  service.before('CREATE', 'RoleAssignments', async (req) => {
    const { role_ID, userId } = req.data;
    if (role_ID && userId) {
      const existing = await cds.db.run(SELECT.one.from(RoleAssignments).where({ role_ID, userId }));
      if (existing) {
        return req.error(400, `The user "${userId}" is already assigned to this role.`);
      }
    }
    if (role_ID) {
      try {
        const { allRoles, allRestrictions, allInheritances } = await fetchRoleAncestryChain(cds.db, role_ID, { Roles, Restrictions, RoleInheritance });
        const resolved = resolveEffectiveRestrictions(role_ID, allRoles, allRestrictions, allInheritances);
        if (resolved.length === 0) return req.error(400, 'Cannot assign a role that has no restrictions.');
      } catch (e) {
        return req.error(400, e.message);
      }
    }
  });


  // -------------------------------------------------------------------------
  // HANA sync + replication queue — after CREATE (first handler registered)
  // -------------------------------------------------------------------------
  service.after('CREATE', 'RoleAssignments', async (assignment, req) => {
    // Read role_ID from req.data — the `assignment` result object may not carry association
    // FK fields (role_ID) depending on CAP version / OData projection behaviour.
    const roleId = req.data?.role_ID || assignment.role_ID;
    const assignmentId = assignment.ID || req.data?.ID;
    const userId = assignment.userId || req.data?.userId;

    // Run HANA sync and queue replication in background to prevent blocking HTTP thread
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncAssignmentToHana(assignmentId, userId, roleId, false);
        const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
        if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);
      } catch (err) {
        console.error('[AssignmentHandlers] Background sync/replication failed for RoleAssignments CREATE:', err.message);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Audit log — after CREATE (second handler registered)
  // -------------------------------------------------------------------------
  service.after('CREATE', 'RoleAssignments', async (assignment) => {
    try {
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'RoleAssignments',
        action:     'CREATE',
        recordId:   assignment.ID,
        targetName: assignment.userName || assignment.userId,
        details:    JSON.stringify(assignment)
      }));
    } catch (err) {
      console.error('[AssignmentHandlers] Audit Log failed for RoleAssignments CREATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Capture before-state — UPDATE
  // -------------------------------------------------------------------------
  service.before('UPDATE', 'RoleAssignments', async (req) => {
    try {
      const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateAssignment = beforeState;
        }
      }
    } catch (err) {
      console.error('[AssignmentHandlers] Before-state capture for RoleAssignments UPDATE failed:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Diff + audit + replication queue — after UPDATE
  // -------------------------------------------------------------------------
  service.after('UPDATE', 'RoleAssignments', async (res, req) => {
    try {
      const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
      if (!id) return;

      const afterState  = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
      const beforeState = req.context?.beforeStateAssignment;

      const diff = {};
      if (beforeState && afterState) {
        for (const key of Object.keys(afterState)) {
          if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
            diff[key] = { old: beforeState[key], new: afterState[key] };
          }
        }
      }

      if (Object.keys(diff).length > 0) {
        await cds.db.run(INSERT.into(AuditLogs).entries({
          ID:         cds.utils.uuid(),
          entityName: 'RoleAssignments',
          action:     'UPDATE',
          recordId:   id,
          targetName: afterState?.userName || afterState?.userId || beforeState?.userName || beforeState?.userId || 'Unknown User',
          details:    JSON.stringify(diff)
        }));
      }

      if (afterState) {
        const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: afterState.role_ID }));
        if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);
      }
      if (beforeState && beforeState.role_ID !== afterState?.role_ID) {
        const oldRole = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
        if (oldRole) await queueReplication(oldRole.name, oldRole.environment_ID, req?.user?.id);
      }
    } catch (err) {
      console.error('[AssignmentHandlers] Audit Log failed for RoleAssignments UPDATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // HANA sync + audit log — before DELETE
  // -------------------------------------------------------------------------
  service.before('DELETE', 'RoleAssignments', async (req) => {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    if (!id) return;

    let targetUserId = null;
    let targetRoleId = null;

    try {
      const assignment = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
      if (assignment) {
        targetUserId = assignment.userId;
        targetRoleId = assignment.role_ID;

        const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
        if (role) {
          await queueReplication(`${role.name} (ASSIGNMENT DELETED)`, role.environment_ID, req?.user?.id);
        }

        await cds.db.run(INSERT.into(AuditLogs).entries({
          ID:         cds.utils.uuid(),
          entityName: 'RoleAssignments',
          action:     'DELETE',
          recordId:   id,
          targetName: assignment.userName || assignment.userId,
          details:    JSON.stringify(assignment)
        }));
      }
    } catch (err) {
      console.error('[AssignmentHandlers] Deletion audit logs failed:', err.message);
    }

    // Pass targetUserId and targetRoleId to clean access-domain-specific custom tables in background
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncAssignmentToHana(id, targetUserId, targetRoleId, true);
      } catch (err) {
        console.error('[AssignmentHandlers] Background HANA sync failed for RoleAssignments DELETE:', err.message);
      }
    });
  });
}

module.exports = { registerAssignmentHandlers };
