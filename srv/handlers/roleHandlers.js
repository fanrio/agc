'use strict';

const { getSessionPermissions, requirePermission, requireEnvironment, requireAccessDomain } = require('../lib/authGuard');

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
/**
 * Fine-grained Delta Sync for child collections on UPDATE.
 * Compares incoming collection vs existing DB records by ID:
 *   - DELETE missing items
 *   - UPDATE changed items
 *   - INSERT new items
 */
async function syncCollectionDelta(db, entity, fkField, fkValue, incomingItems, fieldMapper) {
  if (!incomingItems) return;

  const existingInDb = await db.run(SELECT.from(entity).where({ [fkField]: fkValue }));
  const existingMap = new Map(existingInDb.map(item => [item.ID, item]));
  
  // Normalize incoming items using fieldMapper
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

function registerRoleHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
  const { Roles, RoleAssignments, RoleInheritance, Restrictions, AuditLogs, AppAuthorizations } = entities;

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

    // Get all own restrictions of the child role
    const childRestrictions = await cds.db.run(
      SELECT.from(Restrictions).where({ role_ID })
    );
    if (!childRestrictions || childRestrictions.length === 0) return;

    // Get all restrictions of the parent role
    const parentRestrictions = await cds.db.run(
      SELECT.from(Restrictions).where({ role_ID: parent_ID })
    );
    if (!parentRestrictions || parentRestrictions.length === 0) return;

    // Compare child own restrictions with parent restrictions
    for (const childRes of childRestrictions) {
      const duplicate = parentRestrictions.find(parentRes =>
        parentRes.field === childRes.field &&
        parentRes.filterType === childRes.filterType &&
        parentRes.value === childRes.value
      );
      if (duplicate) {
        req.error(400, `Derived role cannot inherit from parent role because they have duplicate restrictions (Field: ${childRes.field}, Value: ${childRes.value}).`);
        break;
      }
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
        ID:         cds.utils.uuid(),
        entityName: 'Roles',
        action:     'CREATE',
        recordId:   recordId,
        targetName: targetName,
        details:    JSON.stringify(role || req.data)
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
        const beforeState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRole = beforeState;
        }

        // Process nested child collections in deep UPDATE requests using Delta Sync
        if (req.data.ownRestrictions !== undefined) {
          await syncCollectionDelta(
            cds.db, Restrictions, 'role_ID', id, req.data.ownRestrictions,
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
            cds.db, RoleInheritance, 'role_ID', id, req.data.parentRoles,
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
            cds.db, RoleApprovers, 'role_ID', id, req.data.approvers,
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
            cds.db, RoleAssignments, 'role_ID', id, req.data.assignments,
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
