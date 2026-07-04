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
function registerAssignmentHandlers(service, entities, deps) {
  const { cds, queueReplication, syncAssignmentToHana, resolveEffectiveRestrictions } = deps;
  const { Roles, Restrictions, RoleInheritance, RoleAssignments, AuditLogs } = entities;

  // -------------------------------------------------------------------------
  // Validate: role must have at least one restriction before assignment
  // -------------------------------------------------------------------------
  service.before('CREATE', 'RoleAssignments', async (req) => {
    const { role_ID } = req.data;
    if (role_ID) {
      // F-12 fix: fetch only data relevant to the specific role rather than full table scans
      const allRoles        = await cds.db.run(SELECT.from(Roles));
      const allRestrictions = await cds.db.run(SELECT.from(Restrictions).where({ role_ID: role_ID }));
      const allInheritances = await cds.db.run(SELECT.from(RoleInheritance).where({ role_ID: role_ID }));
      try {
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
    try {
      await syncAssignmentToHana(assignment.ID, assignment.userId, assignment.role_ID, false);
    } catch (e) {
      console.error('[AssignmentHandlers] Failed to replicate assignment creation to HANA:', e.message);
    }
    try {
      const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
      if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);
    } catch (err) {
      console.error('[AssignmentHandlers] Failed to queue replication for assignment creation:', err.message);
    }
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
    try {
      const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
      if (!id) return;

      const assignment = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
      if (assignment) {
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
      await syncAssignmentToHana(id, null, null, true);
    } catch (e) {
      console.error('[AssignmentHandlers] Failed to replicate assignment deletion:', e.message);
    }
  });
}

module.exports = { registerAssignmentHandlers };
