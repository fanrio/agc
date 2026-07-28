const { getSessionPermissions, isRoleInScope } = require('../lib/authGuard');
const { filterRolesByBackendPermissions } = require('../lib/authGuard');

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

  // 2. Fetch required tables and SQL aggregate queries in parallel
  const [
    allRoles,
    allRestrictions,
    allInheritances,
    allApprovers,
    allAssignments,
    allFields,
    nodeCountRes,
    domainCountRes,
    fieldCountRes,
    bdcCountRes,
    groupedNodesRes
  ] = await Promise.all([
    db.run(SELECT.from(Roles).columns(e => {
      e('*')
      e.parentRoles(p => p.parent_ID) //expand composition, but only select 'parent_ID'
      e.approvers(a => a.userId)
    })),
    db.run(SELECT.from(Restrictions)),
    db.run(SELECT.from(RoleInheritance)),
    db.run(SELECT.from(RoleApprovers)),
    db.run(SELECT.from(RoleAssignments)),
    db.run(SELECT.from(RestrictionFields)),
    db.run(SELECT.one.from(OrgNodes).columns('count(*) as count')),
    db.run(SELECT.one.from(AccessDomains).columns('count(*) as count')),
    db.run(SELECT.one.from(RestrictionFields).columns('count(*) as count')),
    db.run(SELECT.one.from(BdcSettings).columns('count(*) as count')),
    db.run(SELECT.from(OrgNodes).columns('type_ID', 'count(*) as count').groupBy('type_ID'))
  ]);


  // Map SQL aggregate count results
  const fieldsMap = new Map(allFields.map(f => [f.ID, f.name]));
  const nodeTypeCounts = {};
  (groupedNodesRes || []).filter(row => row.type_ID !== null)
    .forEach(row => {
      const typeName = fieldsMap.get(row.type_ID);
      nodeTypeCounts[typeName] = (nodeTypeCounts[typeName] || 0) + Number(row.count || 0);
    });

  // Pre-index child collections by role_ID in O(N) single pass
  const ownRestrictionsCountMap = new Map();
  allRestrictions.forEach(r => {
    ownRestrictionsCountMap.set(r.role_ID, (ownRestrictionsCountMap.get(r.role_ID) || 0) + 1);
  });

  const approversCountMap = new Map();
  const userApproverRoleIds = new Set();
  const currentUserIdLower = String(permissions.userId || '').toLowerCase();
  allApprovers.forEach(a => {
    approversCountMap.set(a.role_ID, (approversCountMap.get(a.role_ID) || 0) + 1);
    if (a.userId && String(a.userId).toLowerCase() === currentUserIdLower) {
      userApproverRoleIds.add(a.role_ID);
    }
  });

  const assignmentsByRoleMap = new Map();
  allAssignments.forEach(a => {
    if (!assignmentsByRoleMap.has(a.role_ID)) assignmentsByRoleMap.set(a.role_ID, []);
    assignmentsByRoleMap.get(a.role_ID).push(a);
  });

  const inheritancesByRoleMap = new Map();
  allInheritances.forEach(ri => {
    if (!inheritancesByRoleMap.has(ri.role_ID)) inheritancesByRoleMap.set(ri.role_ID, []);
    inheritancesByRoleMap.get(ri.role_ID).push(ri);
  });

  const rolesMap = new Map(allRoles.map(r => [r.ID, r]));
  // 3. Filter roles by permissions in O(N) linear time
  const filteredRoles = filterRolesByBackendPermissions(
    allRoles,
    permissions,
    inheritancesByRoleMap,
    rolesMap,
    userApproverRoleIds
  );



  // 4. Calculate assignments and users for in-scope roles in single pass
  const uniqueUsers = new Set();
  const usersWithCritical = new Set();
  let totalFilteredAssignments = 0;
  let rolesWithoutRestriction = 0;
  let rolesWithoutApprover = 0;
  let rolesWithoutAssignment = 0;
  let criticalRoles = 0;

  filteredRoles.forEach(role => {
    const hasRestrictions = (ownRestrictionsCountMap.get(role.ID) || 0) > 0;
    const hasApprovers = (approversCountMap.get(role.ID) || 0) > 0;
    const roleAssignments = assignmentsByRoleMap.get(role.ID) || [];
    const hasAssignments = roleAssignments.length > 0;

    if (!hasRestrictions) rolesWithoutRestriction++;
    if (!hasApprovers) rolesWithoutApprover++;
    if (!hasAssignments) rolesWithoutAssignment++;

    if (role.critical) {
      criticalRoles++;
    }

    totalFilteredAssignments += roleAssignments.length;
    roleAssignments.forEach(a => {
      uniqueUsers.add(a.userId);
      if (role.critical) {
        usersWithCritical.add(a.userId);
      }
    });
  });

  // Calculate health score
  const total = filteredRoles.length;
  const penalty = rolesWithoutRestriction * 40 + rolesWithoutApprover * 40 + rolesWithoutAssignment * 20;
  const healthScore = total ? Math.max(0, Math.round(100 - (penalty / total))) : 100;
  console.log(nodeCountRes);
  return {
    roleCount: filteredRoles.length,
    rolesWithoutRestriction,
    rolesWithoutApprover,
    rolesWithoutAssignment,
    criticalRoles,
    usersWithCritical: usersWithCritical.size,
    healthScore,
    nodeCount: Number(nodeCountRes?.count || 0),
    nodeTypeCounts,
    assignmentCount: totalFilteredAssignments,
    userCount: uniqueUsers.size,
    accessDomainCount: Number(domainCountRes?.count || 0),
    fieldCount: Number(fieldCountRes?.count || 0),
    bdcCount: Number(bdcCountRes?.count || 0)
  };
}

function filterRolesByPermissions(roles, permissions, inheritancesByRoleMap, rolesMap, userApproverRoleIds) {
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
    if (userApproverRoleIds.has(role.ID)) return true;

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

      const parentInheritances = inheritancesByRoleMap.get(role.ID) || [];
      const hasParentInScope = parentInheritances.some(ri => {
        const parentId = ri.parent_ID;
        const parentRole = rolesMap.get(parentId);
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
