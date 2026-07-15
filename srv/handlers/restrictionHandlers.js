'use strict';

const { getSessionPermissions, requirePermission, requireEnvironment } = require('../lib/authGuard');

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
  const { Roles, Restrictions, AuditLogs, AppAuthorizations } = entities;

  // -------------------------------------------------------------------------
  // Restrictions CRUD protection
  // -------------------------------------------------------------------------
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'Restrictions', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    let roleId = req.data.role_ID;
    let restrictionId = req.data.ID;
    if (!restrictionId && req.params?.length > 0) {
      const p = req.params[0];
      restrictionId = typeof p === 'object' ? p.ID : p;
    }

    if (!roleId && restrictionId) {
      const existing = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: restrictionId }));
      roleId = existing?.role_ID;
    }

    if (roleId) {
      const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
      if (role) {
        if (role.environment_ID) requireEnvironment(perms, role.environment_ID, req);
        if (role.type === 'ORG_BASED') requirePermission(perms, 'canManageOrgRoles', req);
        else if (role.type === 'DERIVED') requirePermission(perms, 'canManageDerivedRoles', req);
        else if (role.type === 'DRAGE') requirePermission(perms, 'isSuperAdmin', req);
        else requirePermission(perms, 'canManageSingleRoles', req);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Prevent duplicate restrictions on derived roles (matching parent role restrictions)
  // -------------------------------------------------------------------------
  service.before(['CREATE', 'UPDATE'], 'Restrictions', async (req) => {
    let roleId = req.data.role_ID;
    let field = req.data.field;
    let filterType = req.data.filterType;
    let value = req.data.value;

    const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
    if (id && (!roleId || !field || !filterType || !value)) {
      const current = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
      if (current) {
        roleId = roleId || current.role_ID;
        field = field || current.field;
        filterType = filterType || current.filterType;
        value = value || current.value;
      }
    }

    if (!roleId || !field || !filterType || !value) return;

    // Check if role is DERIVED
    const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
    if (!role || role.type !== 'DERIVED') return;

    // Get parent role IDs
    const inheritances = await cds.db.run(
      SELECT.from('fanrio.auth.RoleInheritance').where({ role_ID: roleId })
    );
    if (!inheritances || inheritances.length === 0) return;

    const parentIds = inheritances.map(i => i.parent_ID);

    // Check if any parent role has the exact same restriction
    const duplicate = await cds.db.run(
      SELECT.one.from(Restrictions)
        .where({ role_ID: { in: parentIds } })
        .and({ field })
        .and({ filterType })
        .and({ value })
    );

    if (duplicate) {
      req.error(400, `Derived role cannot have the same restriction as its parent role (Field: ${field}, Value: ${value}).`);
    }
  });

  // -------------------------------------------------------------------------
  // Audit log + queue + HANA sync — after CREATE
  // -------------------------------------------------------------------------
  service.after('CREATE', 'Restrictions', async (restriction, req) => {
    if (!restriction.role_ID) return;

    try {
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
    } catch (err) {
      console.error('[RestrictionHandlers] Audit Log/queue failed for Restrictions CREATE:', err.message);
    }

    // Run HANA re-sync synchronously (lets errors propagate to frontend)
    await syncRoleAssignmentsToHana(restriction.role_ID);
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
      try {
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
      } catch (err) {
        console.error('[RestrictionHandlers] Audit Log/queue failed for Restrictions UPDATE:', err.message);
      }

      // Run HANA re-sync in background to prevent blocking HTTP thread
      cds.spawn({ user: req?.user }, async () => {
        try {
          await syncRoleAssignmentsToHana(beforeState.role_ID);
        } catch (err) {
          console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions UPDATE:', err.message);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit log + queue + HANA sync — before DELETE
  // -------------------------------------------------------------------------
  service.before('DELETE', 'Restrictions', async (req) => {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    if (!id) return;

    const beforeState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
    if (!beforeState?.role_ID) return;

    try {
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
    } catch (err) {
      console.error('[RestrictionHandlers] Audit Log/queue failed for Restrictions DELETE:', err.message);
    }

    // Run HANA re-sync in background to prevent blocking HTTP thread
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncRoleAssignmentsToHana(beforeState.role_ID);
      } catch (err) {
        console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions DELETE:', err.message);
      }
    });
  });
}

module.exports = { registerRestrictionHandlers };
