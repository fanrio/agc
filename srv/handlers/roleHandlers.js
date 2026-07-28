'use strict';

const { getSessionPermissions, requirePermission, requireEnvironment, requireAccessDomain, filterRolesByBackendPermissions } = require('../lib/authGuard');
const {
  syncCollectionDelta,
  checkDuplicateInheritedRestrictions,
  computeRoleDiff,
  processCascadingRoleDelete
} = require('../services/RoleManagementService');

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
 * Delegates business logic (delta sync, duplicate checks, cascading deletes, diff calculations)
 * to RoleManagementService.js.
 *
 * @param {object} service                  - CAP service instance (this)
 * @param {object} entities                 - { Roles, Restrictions, RoleAssignments, RoleInheritance, AuditLogs, Replications }
 * @param {{ cds, queueReplication, syncRoleAssignmentsToHana }} deps
 */
function registerRoleHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
  const { Roles, RoleAssignments, RoleInheritance, Restrictions, AuditLogs, AppAuthorizations } = entities;

  // -------------------------------------------------------------------------
  // Roles READ filtering
  // -------------------------------------------------------------------------
  service.on('READ', 'Roles', async (req, next) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    const result = await next();
    if (perms.isSuperAdmin) return result;

    const inheritances = await cds.db.run(SELECT.from(RoleInheritance));

    if (Array.isArray(result)) {
      return filterRolesByBackendPermissions(result, perms, inheritances);
    } else if (result && typeof result === 'object') {
      const filtered = filterRolesByBackendPermissions([result], perms, inheritances);
      return filtered.length > 0 ? result : null;
    }

    return result;
  });

  // -------------------------------------------------------------------------
  // Roles Action protection
  // -------------------------------------------------------------------------
  service.before(['generateOrgRole', 'generateAllOrgRoles'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageOrgRoles', req);
  });

  // -------------------------------------------------------------------------
  // Roles CRUD protection
  // -------------------------------------------------------------------------
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'Roles', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);

    let roleType = req.data.type;
    let envId = req.data.environment_ID;
    let roleId = req.data.ID;
    if (!roleId && req.params?.length > 0) {
      const p = req.params[0];
      roleId = typeof p === 'object' ? p.ID : p;
    }

    if (req.event === 'UPDATE' || req.event === 'DELETE') {
      if (roleId) {
        const existing = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
        if (existing) {
          if (!roleType) roleType = existing.type;
          if (!envId) envId = existing.environment_ID;
        }
      }
    }

    if (roleType === 'DERIVED') {
      let parentIds = [];
      if (req.data.parentRoles && Array.isArray(req.data.parentRoles)) {
        req.data.parentRoles.forEach(pr => {
          if (pr.parent_ID) parentIds.push(pr.parent_ID);
        });
      }
      if (parentIds.length === 0 && roleId) {
        const inherits = await cds.db.run(SELECT.from(RoleInheritance).where({ role_ID: roleId }));
        parentIds = inherits.map(i => i.parent_ID);
      }

      if (parentIds.length > 0) {
        const parents = await cds.db.run(SELECT.from(Roles).where({ ID: { in: parentIds } }));
        if (parents.length > 0) {
          const firstParentDomain = parents[0].accessDomain_ID;
          const differentDomain = parents.some(p => p.accessDomain_ID !== firstParentDomain);
          if (differentDomain) {
            return req.reject(400, 'Derived role cannot inherit from parent roles belonging to different access domains.');
          }
          // Set/override the access domain of the derived role to match the parent
          req.data.accessDomain_ID = firstParentDomain;
        }
      }
    }

    if (envId) {
      requireEnvironment(perms, envId, req);
    }

    // Access Domain-based role management scoping
    let accessDomainId = req.data.accessDomain_ID;
    if (!accessDomainId && (req.event === 'UPDATE' || req.event === 'DELETE') && roleId) {
      const existingForStream = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
      if (existingForStream) accessDomainId = existingForStream.accessDomain_ID;
    }
    if (accessDomainId) {
      requireAccessDomain(perms, accessDomainId, req);
    }

    if (roleType === 'ORG_BASED') {
      requirePermission(perms, 'canManageOrgRoles', req);
    } else if (roleType === 'DERIVED') {
      requirePermission(perms, 'canManageDerivedRoles', req);

      // Enforce derived role parent scope checks
      if (!perms.isSuperAdmin && perms.managedDerivedRolesScope !== 'ALL') {
        let allowedParentIds = [];
        try {
          const scopeList = JSON.parse(perms.managedDerivedRolesScope);
          if (Array.isArray(scopeList)) {
            allowedParentIds = scopeList.map(s => s.roleId);
          }
        } catch (e) {
          allowedParentIds = perms.managedDerivedRolesScope.split(',').map(s => s.trim());
        }

        let parentIds = [];
        if (req.data.parentRoles && Array.isArray(req.data.parentRoles)) {
          req.data.parentRoles.forEach(pr => {
            if (pr.parent_ID) parentIds.push(pr.parent_ID);
          });
        }
        if (parentIds.length === 0 && roleId) {
          const inherits = await cds.db.run(SELECT.from(RoleInheritance).where({ role_ID: roleId }));
          parentIds = inherits.map(i => i.parent_ID);
        }

        if (parentIds.length > 0) {
          const inScope = parentIds.every(pid => allowedParentIds.includes(pid));
          if (!inScope) {
            req.reject(403, 'Access Denied: One or more parent roles are outside your permitted scope.');
          }
        }
      }
    } else if (roleType === 'DRAGE') {
      requirePermission(perms, 'isSuperAdmin', req);
    } else {
      requirePermission(perms, 'canManageSingleRoles', req);
    }
  });

  // -------------------------------------------------------------------------
  // Prevent duplicate restrictions when creating/updating RoleInheritance
  // -------------------------------------------------------------------------
  service.before(['CREATE', 'UPDATE'], 'RoleInheritance', async (req) => {
    let { role_ID, parent_ID } = req.data;

    const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
    if (id && (!role_ID || !parent_ID)) {
      const current = await cds.db.run(SELECT.one.from(RoleInheritance).where({ ID: id }));
      if (current) {
        role_ID = role_ID || current.role_ID;
        parent_ID = parent_ID || current.parent_ID;
      }
    }

    if (!role_ID || !parent_ID) return;

    const dupMsg = await checkDuplicateInheritedRestrictions(cds.db, entities, role_ID, parent_ID);
    if (dupMsg) {
      req.error(400, dupMsg);
    }
  });

  // -------------------------------------------------------------------------
  // UUID auto-generation & deep CREATE payload formatting
  // -------------------------------------------------------------------------
  service.before('CREATE', 'Roles', (req) => {
    if (!req.data.ID) req.data.ID = cds.utils.uuid();
    if (!req.data.accessDomain_ID) req.data.accessDomain_ID = 'app-global';

    if (Array.isArray(req.data.ownRestrictions)) {
      req.data.ownRestrictions.forEach(r => {
        if (!r.ID) r.ID = cds.utils.uuid();
        if (!r.sourceLabel) r.sourceLabel = 'Own';
      });
    }
    if (Array.isArray(req.data.approvers)) {
      req.data.approvers.forEach(a => {
        if (!a.ID) a.ID = cds.utils.uuid();
        if (!a.userName && a.userId) a.userName = a.userId;
      });
    }
    if (Array.isArray(req.data.assignments)) {
      req.data.assignments.forEach(a => {
        if (!a.ID) a.ID = cds.utils.uuid();
        if (!a.userName && a.userId) a.userName = a.userId;
      });
    }
    if (Array.isArray(req.data.parentRoles)) {
      req.data.parentRoles.forEach(p => {
        if (!p.ID) p.ID = cds.utils.uuid();
        if (!p.parent_ID && p.parent?.ID) p.parent_ID = p.parent.ID;
      });
    }
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
      const recordId = role?.ID || req.data?.ID;
      const targetName = role?.name || req.data?.name;
      const environment_ID = role?.environment_ID || req.data?.environment_ID;
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID: cds.utils.uuid(),
        entityName: 'Roles',
        action: 'CREATE',
        recordId: recordId,
        targetName: targetName,
        details: JSON.stringify(role || req.data)
      }));
      await queueReplication(targetName, environment_ID, req?.user?.id);
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles CREATE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Capture before-state & process deep child updates — UPDATE
  // -------------------------------------------------------------------------
  service.before('UPDATE', 'Roles', async (req) => {
    try {
      let id = req.data.ID;
      if (!id && req.params?.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const beforeState = await cds.db.run(
          SELECT.one.from(Roles).where({ ID: id })
            .columns(r => {
              r('*');
              r.ownRestrictions(res => res('*'));
              r.parentRoles(pr => pr('*'));
              r.approvers(ap => ap('*'));
              r.assignments(as => as('*'));
            })
        );
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRole = beforeState;
        }

        // Process nested child collections in deep UPDATE requests using Delta Sync
        if (req.data.ownRestrictions !== undefined) {
          await syncCollectionDelta(
            cds, cds.db, Restrictions, 'role_ID', id, req.data.ownRestrictions,
            (r, roleId) => ({
              ...(r.ID ? { ID: r.ID } : {}),
              role_ID: roleId,
              field: r.field,
              filterType: r.filterType,
              value: r.value,
              sourceLabel: r.sourceLabel || 'Own'
            })
          );
          delete req.data.ownRestrictions;
        }

        if (req.data.parentRoles !== undefined) {
          await syncCollectionDelta(
            cds, cds.db, RoleInheritance, 'role_ID', id, req.data.parentRoles,
            (p, roleId) => ({
              ...(p.ID ? { ID: p.ID } : {}),
              role_ID: roleId,
              parent_ID: p.parent_ID || p.parent?.ID
            })
          );
          delete req.data.parentRoles;
        }

        if (req.data.approvers !== undefined) {
          await syncCollectionDelta(
            cds, cds.db, RoleApprovers, 'role_ID', id, req.data.approvers,
            (a, roleId) => ({
              ...(a.ID ? { ID: a.ID } : {}),
              role_ID: roleId,
              userId: a.userId,
              userName: a.userName || a.userId
            })
          );
          delete req.data.approvers;
        }

        if (req.data.assignments !== undefined) {
          await syncCollectionDelta(
            cds, cds.db, RoleAssignments, 'role_ID', id, req.data.assignments,
            (a, roleId) => ({
              ...(a.ID ? { ID: a.ID } : {}),
              role_ID: roleId,
              userId: a.userId,
              userName: a.userName || a.userId
            })
          );
          delete req.data.assignments;
        }
      }
    } catch (err) {
      console.error('[RoleHandlers] Before-state capture / child collection delta sync for Roles UPDATE failed:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Diff + audit log + HANA re-sync — UPDATE
  // -------------------------------------------------------------------------
  service.after('UPDATE', 'Roles', async (res, req) => {
    let id = req.data.ID;
    if (!id && req.params?.length > 0) {
      const p = req.params[0];
      id = typeof p === 'object' ? p.ID : p;
    }
    if (!id) return;

    try {
      const afterState = await cds.db.run(
        SELECT.one.from(Roles).where({ ID: id })
          .columns(r => {
            r('*');
            r.ownRestrictions(res => res('*'));
            r.parentRoles(pr => pr('*'));
            r.approvers(ap => ap('*'));
            r.assignments(as => as('*'));
          })
      );
      const beforeState = req.context?.beforeStateRole;

      const diff = computeRoleDiff(beforeState, afterState);
      const auditDetails = Object.keys(diff).length > 0 ? diff : { update: 'Role updated' };

      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID: cds.utils.uuid(),
        entityName: 'Roles',
        action: 'UPDATE',
        recordId: id,
        targetName: afterState?.name || beforeState?.name || 'Unknown Role',
        details: JSON.stringify(auditDetails)
      }));

      await queueReplication(
        afterState?.name || beforeState?.name || 'Unknown Role',
        afterState?.environment_ID || beforeState?.environment_ID || 'D',
        req?.user?.id
      );
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles UPDATE:', err.message);
    }

    // Run HANA re-sync in background to prevent blocking HTTP request thread
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncRoleAssignmentsToHana(id);
      } catch (err) {
        console.error('[RoleHandlers] Background HANA sync failed for Roles UPDATE:', err.message);
      }
    });
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
        ID: cds.utils.uuid(),
        entityName: 'Roles',
        action: 'DELETE',
        recordId: id,
        targetName: beforeState.name,
        details: JSON.stringify(beforeState)
      }));
      await queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);

      req.context = req.context || {};
      if (!req.context.inCascadingDelete) {
        req.context.inCascadingDelete = true;
        await processCascadingRoleDelete(cds.db, service, entities, id);
      }
    } catch (err) {
      console.error('[RoleHandlers] Audit Log failed for Roles DELETE:', err.message);
    }
  });

  // -------------------------------------------------------------------------
  // RoleInheritance event handlers to trigger HANA replication sync
  // -------------------------------------------------------------------------
  service.after('CREATE', 'RoleInheritance', async (inheritance, req) => {
    const roleId = inheritance.role_ID || req.data?.role_ID;
    if (roleId) {
      cds.spawn({ user: req?.user }, async () => {
        try {
          await syncRoleAssignmentsToHana(roleId);
        } catch (err) {
          console.error('[RoleHandlers] Background HANA sync failed for RoleInheritance CREATE:', err.message);
        }
      });
    }
  });

  service.before('DELETE', 'RoleInheritance', async (req) => {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    if (id) {
      try {
        const beforeState = await cds.db.run(SELECT.one.from(RoleInheritance).where({ ID: id }));
        if (beforeState?.role_ID) {
          req.context = req.context || {};
          req.context.roleIdToSync = beforeState.role_ID;
        }
      } catch (err) {
        console.error('[RoleHandlers] Before-state capture for RoleInheritance DELETE failed:', err.message);
      }
    }
  });

  service.after('DELETE', 'RoleInheritance', async (res, req) => {
    const roleId = req.context?.roleIdToSync;
    if (roleId) {
      cds.spawn({ user: req?.user }, async () => {
        try {
          await syncRoleAssignmentsToHana(roleId);
        } catch (err) {
          console.error('[RoleHandlers] Background HANA sync failed for RoleInheritance DELETE:', err.message);
        }
      });
    }
  });
}

module.exports = { registerRoleHandlers };

