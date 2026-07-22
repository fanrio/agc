const { getSessionPermissions } = require('../lib/authGuard');

async function getDashboardKpis(req, cds) {
  const db = cds.db;
  const {
    Roles,
    Restrictions,
    RoleInheritance,
    RoleApprovers,
    RoleAssignments,
    OrgNodes,
    AccessDomains,
    RestrictionFields,
    BdcSettings,
    AppAuthorizations
  } = cds.entities('fanrio.auth');

  // 1. Fetch permissions
  const permissions = await getSessionPermissions(req, db, AppAuthorizations);

  // 2. Fetch all required tables in parallel
  const [
    allRoles,
    allRestrictions,
    allInheritances,
    allApprovers,
    allAssignments,
    allNodes,
    allAccessDomains,
    allFields,
    allBdcSettings
  ] = await Promise.all([
    db.run(SELECT.from(Roles)),
    db.run(SELECT.from(Restrictions)),
    db.run(SELECT.from(RoleInheritance)),
    db.run(SELECT.from(RoleApprovers)),
    db.run(SELECT.from(RoleAssignments)),
    db.run(SELECT.from(OrgNodes)),
    db.run(SELECT.from(AccessDomains)),
    db.run(SELECT.from(RestrictionFields)),
    db.run(SELECT.from(BdcSettings))
  ]);

  // Stitch node type association in memory
  allNodes.forEach(node => {
    node.type = allFields.find(f => f.ID === node.type_ID);
  });

  // 3. Stitch roles in memory
  const stitchedRoles = allRoles.map(role => {
    return {
      ...role,
      ownRestrictions: allRestrictions.filter(r => r.role_ID === role.ID),
      assignments: allAssignments.filter(a => a.role_ID === role.ID),
      approvers: allApprovers.filter(a => a.role_ID === role.ID),
      parentRoles: allInheritances.filter(ri => ri.role_ID === role.ID).map(ri => {
        const parent = allRoles.find(r => r.ID === ri.parent_ID);
        return {
          ...ri,
          parent
        };
      })
    };
  });

  // 4. Apply backend filtering matching frontend filterRolesByPermissions
  const filteredRoles = filterRolesByPermissions(stitchedRoles, permissions, allInheritances);

  // 5. Calculate unique users
  const uniqueUsers = new Set(allAssignments.map(a => a.userId));

  // 6. Calculate unique users with critical roles
  const usersWithCritical = new Set(
    allAssignments
      .filter(a => {
        const role = filteredRoles.find(r => r.ID === a.role_ID);
        return role && role.critical;
      })
      .map(a => a.userId)
  );

  // 7. Group org nodes by type
  const nodeTypeCounts = {};
  allNodes.forEach(node => {
    const type = node.type?.name || 'UNKNOWN';
    nodeTypeCounts[type] = (nodeTypeCounts[type] || 0) + 1;
  });

  // 8. Count roles with missing attributes (among filtered roles)
  let rolesWithoutRestriction = 0;
  let rolesWithoutApprover = 0;
  let rolesWithoutAssignment = 0;
  let criticalRoles = 0;

  filteredRoles.forEach(role => {
    if (!role.ownRestrictions || role.ownRestrictions.length === 0) {
      rolesWithoutRestriction++;
    }
    if (!role.approvers || role.approvers.length === 0) {
      rolesWithoutApprover++;
    }
    if (!role.assignments || role.assignments.length === 0) {
      rolesWithoutAssignment++;
    }
    if (role.critical) {
      criticalRoles++;
    }
  });

  return {
    roleCount: filteredRoles.length,
    rolesWithoutRestriction,
    rolesWithoutApprover,
    rolesWithoutAssignment,
    criticalRoles,
    usersWithCritical: usersWithCritical.size,
    nodeCount: allNodes.length,
    nodeTypeCounts,
    assignmentCount: allAssignments.length,
    userCount: uniqueUsers.size,
    accessDomainCount: allAccessDomains.length,
    fieldCount: allFields.length,
    bdcCount: allBdcSettings.length
  };
}

function isRoleInScope(roleId, roleName, scope) {
  if (!scope || scope === 'ALL' || scope === '*') return true;
  try {
    const parsed = JSON.parse(scope);
    if (Array.isArray(parsed)) {
      const lowerId = (roleId || '').toLowerCase();
      const lowerName = (roleName || '').toLowerCase();
      return parsed.some(term => {
        const lowerTerm = String(term).toLowerCase();
        return lowerId === lowerTerm || lowerName === lowerTerm;
      });
    }
  } catch (e) {
    const terms = scope.split(',').map(s => s.trim().toLowerCase());
    return terms.includes((roleId || '').toLowerCase()) || terms.includes((roleName || '').toLowerCase());
  }
  return false;
}

function filterRolesByPermissions(roles, permissions, roleInheritances) {
  if (!roles) return [];
  if (!permissions) return roles;
  if (permissions.isSuperAdmin) return roles;

  // Filter by allowedEnvironments
  const parseEnvs = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim().toUpperCase());
    }
    return [];
  };
  const allowedEnvs = parseEnvs(permissions.allowedEnvironments);

  // Filter by allowedAccessDomains
  const parseAccessDomains = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim());
    }
    return [];
  };
  const allowedAccessDomains = parseAccessDomains(permissions.allowedAccessDomains);

  return roles.filter(role => {
    const isApprover = Array.isArray(role.approvers) && role.approvers.some(a => String(a.userId).toLowerCase() === permissions.userId?.toLowerCase());
    if (isApprover) return true;

    // Environment and Access Domain scope restrictions
    if (allowedEnvs !== 'ALL') {
      const roleEnv = (role.environment_ID || '').toUpperCase();
      if (!allowedEnvs.includes(roleEnv)) return false;
    }
    if (allowedAccessDomains !== 'ALL') {
      const roleAccessDomain = role.accessDomain_ID;
      if (!allowedAccessDomains.includes(roleAccessDomain)) return false;
    }

    // DRAGE roles are only visible to superadmins
    if (role.type === 'DRAGE') return false;

    // Check specific role type permissions
    if (role.type === 'SINGLE') {
      if (permissions.canManageSingleRoles) return true;
      if (permissions.canManageDerivedRoles && isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope)) {
        return true;
      }
      return false;
    }

    if (role.type === 'ORG_BASED') {
      if (permissions.canManageOrgRoles) return true;
      if (permissions.canManageDerivedRoles && isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope)) {
        return true;
      }
      return false;
    }

    if (role.type === 'DERIVED') {
      if (!permissions.canManageDerivedRoles) return false;
      const scope = permissions.managedDerivedRolesScope;
      
      const parentInheritances = roleInheritances.filter(ri => ri.role_ID === role.ID);
      const hasParentInScope = parentInheritances.some(ri => {
        const parentId = ri.parent_ID;
        const parentRole = roles.find(r => r.ID === parentId);
        return isRoleInScope(parentId, parentRole?.name, scope);
      });
      return hasParentInScope;
    }

    return false;
  });
}

module.exports = {
  getDashboardKpis
};
