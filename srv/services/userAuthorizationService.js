'use strict';

const { resolveEffectiveRestrictions } = require('../lib/resolveEffectiveRestrictions');

/**
 * getUserEffectiveAuthorizations
 * Computes all assigned roles and resolved effective restrictions for a given user,
 * grouped cleanly by Access Domain (accessDomain_ID).
 *
 * @param {string} userId - Target user ID / email
 * @param {object} cds    - CAP cds instance
 * @param {object} entities - { RoleAssignments, Roles, Restrictions, RoleInheritance, AccessDomains }
 * @returns {object} Structured user authorization summary object
 */
async function getUserEffectiveAuthorizations(userId, cds, entities) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = cds.db;
  const { RoleAssignments, Roles, Restrictions, RoleInheritance } = entities;

  // 1. Fetch user role assignments
  const assignments = await db.run(
    SELECT.from(RoleAssignments).where({ userId: userId })
  );

  if (!assignments || assignments.length === 0) {
    return {
      userId,
      userName: userId,
      totalRolesCount: 0,
      domains: []
    };
  }

  const userName = assignments[0]?.userName || userId;
  const roleIds = Array.from(new Set(assignments.map(a => a.role_ID).filter(Boolean)));

  if (roleIds.length === 0) {
    return {
      userId,
      userName,
      totalRolesCount: 0,
      domains: []
    };
  }

  // 2. Fetch all roles, restrictions, inheritances for graph traversal
  const allRoles = await db.run(SELECT.from(Roles));
  const allRestrictions = await db.run(SELECT.from(Restrictions));
  const allInheritances = await db.run(SELECT.from(RoleInheritance));

  const rolesMap = new Map(allRoles.map(r => [r.ID, r]));

  // User's directly assigned role objects
  const assignedRoles = roleIds
    .map(id => rolesMap.get(id))
    .filter(Boolean);

  // Group assigned roles by accessDomain_ID
  const domainGroups = new Map();

  for (const role of assignedRoles) {
    const domainId = role.accessDomain_ID || 'DEFAULT';
    if (!domainGroups.has(domainId)) {
      domainGroups.set(domainId, []);
    }
    domainGroups.get(domainId).push(role);
  }

  const domainsResult = [];

  for (const [domainId, rolesInDomain] of domainGroups.entries()) {
    const domainRestrictions = [];
    const processedFields = new Set();

    // Compute effective restrictions for each assigned role in this domain
    for (const role of rolesInDomain) {
      try {
        const effective = resolveEffectiveRestrictions(role.ID, allRoles, allRestrictions, allInheritances);
        for (const re of effective) {
          domainRestrictions.push(re);
        }
      } catch (err) {
        console.error(`[UserAuthorizationService] Error resolving restrictions for role ${role.name}:`, err.message);
      }
    }

    domainsResult.push({
      domainId,
      domainName: domainId === 'DEFAULT' ? 'Global / Default Domain' : domainId,
      assignedRoles: rolesInDomain.map(r => ({
        ID: r.ID,
        name: r.name,
        type: r.type,
        description: r.description,
        environment_ID: r.environment_ID,
        accessDomain_ID: r.accessDomain_ID,
        critical: r.critical
      })),
      effectiveRestrictions: domainRestrictions
    });
  }

  return {
    userId,
    userName,
    totalRolesCount: assignedRoles.length,
    domains: domainsResult
  };
}

module.exports = { getUserEffectiveAuthorizations };
