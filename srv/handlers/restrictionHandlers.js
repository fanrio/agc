'use strict';

/**
 * Restriction Handlers
 *
 * Registers all CAP event hooks for the Restrictions entity:
 *   - Audit log on CREATE / UPDATE / DELETE (recorded against the parent Role)
 *   - Replication queue on CREATE / UPDATE / DELETE
 *   - HANA re-sync of all role assignments on CREATE / UPDATE / DELETE
 *
 * Previously in authorization-service.js (L1387-1507).
 *
 * @param {object} service  - CAP service instance (this)
 * @param {object} entities - { Roles, Restrictions, AuditLogs }
 * @param {{ cds, queueReplication, syncRoleAssignmentsToHana }} deps
 */
function registerRestrictionHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
  const { Roles, Restrictions, AuditLogs } = entities;

  // -------------------------------------------------------------------------
  // Audit log + queue + HANA sync — after CREATE
  // -------------------------------------------------------------------------
  service.after('CREATE', 'Restrictions', async (restriction, req) => {
    try {
      if (!restriction.role_ID) return;
      const role     = await cds.db.run(SELECT.one.from(Roles).where({ ID: restriction.role_ID }));
      const roleName = role ? role.name : 'Unknown Role';
      const details  = {
        'Restriction Added': {
          old: '',
          new: `Field: ${restriction.field}, Type: ${restriction.filterType}, Value: ${restriction.value}`
        }
      };
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'Roles',
        action:     'UPDATE',
        recordId:   restriction.role_ID,
        targetName: roleName,
        details:    JSON.stringify(details)
      }));
      await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
      await syncRoleAssignmentsToHana(restriction.role_ID);
    } catch (err) {
      console.error('[RestrictionHandlers] Audit Log failed for Restrictions CREATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Capture before-state — before UPDATE
  // -------------------------------------------------------------------------
  service.before('UPDATE', 'Restrictions', async (req) => {
    try {
      const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRestriction = beforeState;
        }
      }
    } catch (err) {
      console.error('[RestrictionHandlers] Before-state capture for Restrictions UPDATE failed:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Diff + audit + queue + HANA sync — after UPDATE
  // -------------------------------------------------------------------------
  service.after('UPDATE', 'Restrictions', async (res, req) => {
    try {
      const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
      if (!id) return;

      const afterState  = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
      const beforeState = req.context?.beforeStateRestriction;

      const hasChanges = beforeState && afterState && (
        beforeState.filterType !== afterState.filterType ||
        beforeState.value      !== afterState.value      ||
        beforeState.field      !== afterState.field
      );

      if (hasChanges && beforeState.role_ID) {
        const role     = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
        const roleName = role ? role.name : 'Unknown Role';
        const details  = {
          [`Restriction Changed (${beforeState.field})`]: {
            old: `Type: ${beforeState.filterType}, Value: ${beforeState.value}`,
            new: `Type: ${afterState.filterType}, Value: ${afterState.value}`
          }
        };
        await cds.db.run(INSERT.into(AuditLogs).entries({
          ID:         cds.utils.uuid(),
          entityName: 'Roles',
          action:     'UPDATE',
          recordId:   beforeState.role_ID,
          targetName: roleName,
          details:    JSON.stringify(details)
        }));
        await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
        await syncRoleAssignmentsToHana(beforeState.role_ID);
      }
    } catch (err) {
      console.error('[RestrictionHandlers] Audit Log failed for Restrictions UPDATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Audit log + queue + HANA sync — before DELETE
  // -------------------------------------------------------------------------
  service.before('DELETE', 'Restrictions', async (req) => {
    try {
      const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
      if (!id) return;

      const beforeState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
      if (!beforeState?.role_ID) return;

      const role     = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
      const roleName = role ? role.name : 'Unknown Role';
      const details  = {
        'Restriction Deleted': {
          old: `Field: ${beforeState.field}, Type: ${beforeState.filterType}, Value: ${beforeState.value}`,
          new: ''
        }
      };
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'Roles',
        action:     'UPDATE',
        recordId:   beforeState.role_ID,
        targetName: roleName,
        details:    JSON.stringify(details)
      }));
      await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
      await syncRoleAssignmentsToHana(beforeState.role_ID);
    } catch (err) {
      console.error('[RestrictionHandlers] Audit Log failed for Restrictions DELETE:', err.message);
    }
  });
}

module.exports = { registerRestrictionHandlers };
