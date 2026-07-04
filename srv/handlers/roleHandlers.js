'use strict';

/**
 * Role Handlers
 *
 * Registers all CAP event hooks for the Roles entity:
 *   - UUID auto-generation on CREATE
 *   - Name uniqueness enforcement on CREATE / UPDATE
 *   - Audit log on CREATE / UPDATE / DELETE
 *   - Cascading deletion of derived roles and their assignments on DELETE
 *   - HANA re-sync of all assignments on UPDATE (via syncRoleAssignmentsToHana)
 *   - Replication queue on CREATE / UPDATE / DELETE
 *
 * Previously scattered across authorization-service.js (L68-100, L103-134, L1126-1268).
 *
 * @param {object} service                  - CAP service instance (this)
 * @param {object} entities                 - { Roles, Restrictions, RoleAssignments, RoleInheritance, AuditLogs, Replications }
 * @param {{ cds, queueReplication, syncRoleAssignmentsToHana }} deps
 */
function registerRoleHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
  const { Roles, RoleAssignments, RoleInheritance, AuditLogs } = entities;

  // -------------------------------------------------------------------------
  // UUID auto-generation
  // -------------------------------------------------------------------------
  service.before('CREATE', 'Roles', (req) => {
    if (!req.data.ID) req.data.ID = cds.utils.uuid();
  });

  // -------------------------------------------------------------------------
  // Name uniqueness — CREATE
  // -------------------------------------------------------------------------
  service.before('CREATE', 'Roles', async (req) => {
    const { name } = req.data;
    if (name) {
      const existing = await cds.db.run(SELECT.one.from(Roles).where({ name }));
      if (existing) return req.error(400, `A role with name "${name}" already exists.`);
    }
  });

  // -------------------------------------------------------------------------
  // Name uniqueness — UPDATE
  // -------------------------------------------------------------------------
  service.before('UPDATE', 'Roles', async (req) => {
    const { name } = req.data;
    if (name) {
      let id = req.data.ID;
      if (!id && req.params?.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const current = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (current && current.name === name) return; // name unchanged
        const existing = await cds.db.run(SELECT.one.from(Roles).where({ name }).and({ ID: { '!=': id } }));
        if (existing) return req.error(400, `A role with name "${name}" already exists.`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Audit log — CREATE
  // -------------------------------------------------------------------------
  service.after('CREATE', 'Roles', async (role, req) => {
    try {
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'Roles',
        action:     'CREATE',
        recordId:   role.ID,
        targetName: role.name,
        details:    JSON.stringify(role)
      }));
      await queueReplication(role.name, role.environment_ID, req?.user?.id);
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles CREATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Capture before-state for diff — UPDATE
  // -------------------------------------------------------------------------
  service.before('UPDATE', 'Roles', async (req) => {
    try {
      let id = req.data.ID;
      if (!id && req.params?.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRole = beforeState;
        }
      }
    } catch (err) {
      console.error('[RoleHandlers] Before-state capture for Roles UPDATE failed:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Diff + audit log + HANA re-sync — UPDATE
  // -------------------------------------------------------------------------
  service.after('UPDATE', 'Roles', async (res, req) => {
    try {
      let id = req.data.ID;
      if (!id && req.params?.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (!id) return;

      const afterState  = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
      const beforeState = req.context?.beforeStateRole;

      const diff = {};
      if (beforeState && afterState) {
        for (const key of Object.keys(afterState)) {
          if (['modifiedAt', 'modifiedBy'].includes(key)) continue;
          if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
            diff[key] = { old: beforeState[key], new: afterState[key] };
          }
        }
      }

      if (Object.keys(diff).length > 0) {
        await cds.db.run(INSERT.into(AuditLogs).entries({
          ID:         cds.utils.uuid(),
          entityName: 'Roles',
          action:     'UPDATE',
          recordId:   id,
          targetName: afterState?.name || beforeState?.name || 'Unknown Role',
          details:    JSON.stringify(diff)
        }));
        await queueReplication(
          afterState?.name || beforeState?.name || 'Unknown Role',
          afterState?.environment_ID || beforeState?.environment_ID || 'D',
          req?.user?.id
        );
      }
      await syncRoleAssignmentsToHana(id);
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles UPDATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Cascading delete + audit log — DELETE
  // -------------------------------------------------------------------------
  service.before('DELETE', 'Roles', async (req) => {
    try {
      const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
      if (!id) return;

      const beforeState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
      if (!beforeState) return;

      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'Roles',
        action:     'DELETE',
        recordId:   id,
        targetName: beforeState.name,
        details:    JSON.stringify(beforeState)
      }));
      await queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);

      req.context = req.context || {};
      if (!req.context.inCascadingDelete) {
        req.context.inCascadingDelete = true;

        // Collect all descendant role IDs
        const allInheritances   = await cds.db.run(SELECT.from(RoleInheritance));
        const descendantRoleIds = [];
        const queue             = [id];
        const visited           = new Set([id]);
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

        const allRoleIds  = [id, ...descendantRoleIds];
        const assignments = await cds.db.run(SELECT.from(RoleAssignments).where({ role_ID: { in: allRoleIds } }));

        // Delete assignments (triggers hooks for HANA sync + audit)
        // NOTE: A loop is used here instead of a bulk DELETE.in to ensure that individual
        // 'before DELETE' / 'after DELETE' hooks are fired for every single role assignment.
        // This guarantees that we write audit logs and update SAP HANA flat tables for each deletion.
        for (const assignment of assignments) {
          await service.run(DELETE.from(RoleAssignments).where({ ID: assignment.ID }));
        }

        // Delete inheritance links
        await cds.db.run(DELETE.from(RoleInheritance).where({
          or: [{ role_ID: { in: allRoleIds } }, { parent_ID: { in: allRoleIds } }]
        }));

        // Delete descendant roles recursively (triggers hooks)
        for (const descId of descendantRoleIds) {
          await service.run(DELETE.from(Roles).where({ ID: descId }));
        }
      }
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles DELETE:', err.message);
    }
  });
}

module.exports = { registerRoleHandlers };
