'use strict';

/**
 * OrgRoleGeneratorService
 *
 * Creates or updates ORG_BASED roles from OrgNode records.
 *
 * New logic (access-domain-driven):
 *  - For each AccessDomain whose restrictionFields include the target node's type,
 *    generate an "ALL" role (sub-fields = CP *) and one "specific" role per
 *    descendant node whose type is also in that domain's restrictionFields.
 *  - Role names are derived from the domain's roleTemplateName.
 *  - Roles are upserted keyed by (name + type='ORG_BASED' + accessDomain_ID).
 *  - Default environment: 'P'.
 */

// ---------------------------------------------------------------------------
// Template name builder
// ---------------------------------------------------------------------------

/**
 * Substitutes {FieldName} placeholders in a template string.
 * @param {string} template         - e.g. "ZOTC_{Plant}_{Department}"
 * @param {Object} context          - e.g. { Plant: 'DE01', Department: 'Finance' }
 * @param {string[]} wildcardFields - field names that should resolve to 'ALL'
 * @returns {string}
 */
function buildRoleName(template, context, wildcardFields = []) {
  if (!template) return 'ROLE_ORG_GENERATED';
  return template.replace(/\{([^}]+)\}/g, (_match, fieldName) => {
    if (wildcardFields.includes(fieldName)) return 'ALL';
    const val = context[fieldName];
    if (val != null) return String(val).replace(/\s+/g, '_').toUpperCase();
    return 'ALL';
  });
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Loads all AccessDomains with their restrictionFields expanded (including field names).
 * Returns: [{ ID, name, roleTemplateName, fields: [{ field_ID, fieldName }] }]
 */
async function loadAllDomainsWithFields(db, AccessDomains, AccessDomainFields, RestrictionFields) {
  const [domains, allDomainFields, allRF] = await Promise.all([
    db.run(SELECT.from(AccessDomains)),
    db.run(SELECT.from(AccessDomainFields)),
    db.run(SELECT.from(RestrictionFields)),
  ]);
  const rfMap = Object.fromEntries(allRF.map(rf => [rf.ID, rf.name]));
  return domains.map(d => ({
    ...d,
    fields: allDomainFields
      .filter(f => f.domain_ID === d.ID)
      .map(f => ({ field_ID: f.field_ID, fieldName: rfMap[f.field_ID] || f.field_ID })),
  }));
}

/**
 * Walks up the org tree from `node`, collecting { fieldName → value } for
 * ancestors whose type_ID is in `fieldSet`.
 */
async function buildAncestorContext(db, OrgNodes, node, fieldSet, rfMap) {
  const context = {};
  let current = node;
  while (current.parent_ID) {
    const parent = await db.run(SELECT.one.from(OrgNodes).where({ ID: current.parent_ID }));
    if (!parent) break;
    if (fieldSet.has(parent.type_ID)) {
      const fieldName = rfMap.get(parent.type_ID);
      if (fieldName) context[fieldName] = parent.name;
    }
    current = parent;
  }
  return context;
}

async function upsertOrgRole(db, Roles, Restrictions, RoleInheritance, AuditLogs, { name, description, orgNodeId, domainId, restrictionEntries, parentRoleIds = [] }) {
  let role = await db.run(
    SELECT.one.from(Roles).where({ name, accessDomain_ID: domainId, type: 'ORG_BASED' })
  );

  let roleId;
  let action;
  let details;
  if (role) {
    roleId = role.ID;
    action = 'UPDATE';
    details = JSON.stringify({ update: 'Role regenerated/updated by Org Generator', description, orgNodeId, domainId, restrictionEntries });
    await db.run(UPDATE(Roles).set({ name, description }).where({ ID: roleId }));
  } else {
    roleId = cds.utils.uuid();
    action = 'CREATE';
    details = JSON.stringify({ ID: roleId, name, type: 'ORG_BASED', description, orgNode_ID: orgNodeId, accessDomain_ID: domainId, environment_ID: 'P' });
    await db.run(INSERT.into(Roles).entries({
      ID:              roleId,
      name,
      type:            'ORG_BASED',
      description,
      orgNode_ID:      orgNodeId,
      accessDomain_ID: domainId,
      environment_ID:  'P',
    }));
  }

  await db.run(DELETE.from(Restrictions).where({ role_ID: roleId }));
  if (restrictionEntries.length > 0) {
    await db.run(INSERT.into(Restrictions).entries(
      restrictionEntries.map(r => ({
        ID:          cds.utils.uuid(),
        role_ID:     roleId,
        field:       r.field,
        filterType:  r.filterType,
        value:       r.value,
        sourceLabel: r.sourceLabel || r.value,
      }))
    ));
  }

  // Update RoleInheritance
  await db.run(DELETE.from(RoleInheritance).where({ role_ID: roleId }));
  if (parentRoleIds.length > 0) {
    await db.run(INSERT.into(RoleInheritance).entries(
      parentRoleIds.map(pid => ({
        ID:        cds.utils.uuid(),
        role_ID:   roleId,
        parent_ID: pid
      }))
    ));
  }

  // Write to AuditLogs
  await db.run(INSERT.into(AuditLogs).entries({
    ID:         cds.utils.uuid(),
    entityName: 'Roles',
    action:     action,
    recordId:   roleId,
    targetName: name,
    details:    details
  }));

  return roleId;
}

// ---------------------------------------------------------------------------
// Core recursive generation: one domain x one subtree node
// ---------------------------------------------------------------------------

/**
 * Recursively generates roles for `node` and its relevant descendants within `domain`.
 *
 * At each level:
 *  1. Adds this node's field to the running context.
 *  2. Generates an ALL role: resolved fields = exact value, remaining = CP *.
 *  3. Recurses into children whose type is in the domain's field set (if recursive = true).
 */
async function generateForNodeInDomain(
  db, Roles, Restrictions, RoleInheritance, AuditLogs, OrgNodes,
  node, domain, fieldSet, rfMap, ancestorCtx, results, recursive = true
) {
  const myFieldName = rfMap.get(node.type_ID);
  if (!myFieldName) return;

  // Build running context for this level
  const context = { ...ancestorCtx, [myFieldName]: node.name };

  // Determine which domain fields are still unresolved (will be CP * in the ALL role)
  const assignedFields = new Set(Object.keys(context));
  const wildcardFields = domain.fields
    .filter(f => !assignedFields.has(f.fieldName))
    .map(f => f.fieldName);

  // Look up if parent node (or any higher ancestor) has a role for this access domain
  let parentRoleId = null;
  let currentParentId = node.parent_ID;
  while (currentParentId) {
    const parentRole = await db.run(
      SELECT.one.from(Roles).where({
        orgNode_ID:      currentParentId,
        accessDomain_ID: domain.ID,
        type:            'ORG_BASED'
      })
    );
    if (parentRole) {
      parentRoleId = parentRole.ID;
      break;
    }
    const pNode = await db.run(SELECT.one.from(OrgNodes).where({ ID: currentParentId }));
    currentParentId = pNode ? pNode.parent_ID : null;
  }

  // Build restriction entries:
  // If parentRoleId is present, we only add this node's own field restriction.
  // Otherwise, we build restrictions for all fields (root node case).
  let restrictionEntries = [];
  if (parentRoleId) {
    restrictionEntries = [{ field: myFieldName, filterType: 'SINGLE_VALUE', value: node.name }];
  } else {
    restrictionEntries = domain.fields.map(f => {
      const val = context[f.fieldName];
      if (val != null) return { field: f.fieldName, filterType: 'SINGLE_VALUE', value: val };
      return { field: f.fieldName, filterType: 'CP', value: '*' };
    });
  }

  const roleName = buildRoleName(domain.roleTemplateName, context, wildcardFields);
  const roleId = await upsertOrgRole(db, Roles, Restrictions, RoleInheritance, AuditLogs, {
    name:               roleName,
    description:        `Auto-generated from Org Node: ${node.name} | Domain: ${domain.name}`,
    orgNodeId:          node.ID,
    domainId:           domain.ID,
    restrictionEntries: restrictionEntries,
    parentRoleIds:      parentRoleId ? [parentRoleId] : [],
  });
  results.push({ roleId, roleName });

  // Recurse into children whose type is in the domain's field set (only if recursive flag is true)
  if (recursive) {
    const children = await db.run(SELECT.from(OrgNodes).where({ parent_ID: node.ID }));
    for (const child of children) {
      if (!fieldSet.has(child.type_ID)) continue;
      await generateForNodeInDomain(
        db, Roles, Restrictions, RoleInheritance, AuditLogs, OrgNodes,
        child, domain, fieldSet, rfMap, context, results, recursive
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public: generate for a single node across all applicable domains
// ---------------------------------------------------------------------------

/**
 * Entry point. Generates ORG_BASED roles for the given org node across
 * all applicable AccessDomains.
 *
 * @param {object} cds
 * @param {object} entities
 * @param {object} node  - OrgNode record
 * @param {boolean} recursive - Whether to recurse down to child org nodes
 * @returns {{ roles: [{roleId, roleName}], count: number }}
 */
async function generateRoleForNode(cds, entities, node, recursive = true) {
  const db = cds.db;
  const {
    OrgNodes, OrgNodeAttributes, Roles, Restrictions,
    RestrictionFields, AccessDomains, AccessDomainFields, RoleInheritance, AuditLogs
  } = entities;

  // Ensure node has type_ID
  if (!node.type_ID) {
    const fresh = await db.run(SELECT.one.from(OrgNodes).where({ ID: node.ID }));
    if (!fresh || !fresh.type_ID) return { roles: [], count: 0 };
    node = fresh;
  }

  // Build restriction field ID -> name map
  const allRF = await db.run(SELECT.from(RestrictionFields));
  const rfMap = new Map(allRF.map(rf => [rf.ID, rf.name]));

  // Load all domains with their field lists
  const domains = await loadAllDomainsWithFields(db, AccessDomains, AccessDomainFields, RestrictionFields);

  // Only process domains that include this node's type
  const applicableDomains = domains.filter(d =>
    d.fields.some(f => f.field_ID === node.type_ID)
  );
  if (applicableDomains.length === 0) return { roles: [], count: 0 };

  const results = [];

  for (const domain of applicableDomains) {
    const fieldSet = new Set(domain.fields.map(f => f.field_ID));
    const ancestorCtx = await buildAncestorContext(db, OrgNodes, node, fieldSet, rfMap);
    await generateForNodeInDomain(
      db, Roles, Restrictions, RoleInheritance, AuditLogs, OrgNodes,
      node, domain, fieldSet, rfMap, ancestorCtx, results, recursive
    );
  }

  // Update OrgNodeAttributes to show role count in UI
  await db.run(DELETE.from(OrgNodeAttributes).where({ node_ID: node.ID, field: 'Roles' }));
  if (results.length > 0) {
    await db.run(INSERT.into(OrgNodeAttributes).entries({
      ID:      cds.utils.uuid(),
      node_ID: node.ID,
      field:   'Roles',
      value:   `${results.length} role(s) generated`,
    }));
  }

  return { roles: results, count: results.length };
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

/**
 * Factory: returns the generateOrgRole OData action handler.
 */
function makeGenerateOrgRoleHandler(cds, entities) {
  return async function generateOrgRoleHandler(req) {
    const { orgNodeId } = req.data;
    const { OrgNodes } = entities;
    const node = await cds.db.run(SELECT.one.from(OrgNodes).where({ ID: orgNodeId }));
    if (!node) return req.error(404, `OrgNode ${orgNodeId} not found`);
    const result = await generateRoleForNode(cds, entities, node, true);
    // Backward-compatible: return the first created role
    const first = result.roles[0] || { roleId: null, roleName: null };
    return { roleId: first.roleId, roleName: first.roleName };
  };
}

/**
 * Factory: returns the generateAllOrgRoles OData action handler.
 * Processes all OrgNodes sequentially to prevent race conditions.
 * Sets recursive = false because every node is visited individually by the loop.
 */
function makeGenerateAllOrgRolesHandler(cds, entities) {
  return async function generateAllOrgRolesHandler(_req) {
    const { OrgNodes } = entities;
    const nodes = await cds.db.run(SELECT.from(OrgNodes));

    // Sort nodes by hierarchical depth so parent roles are generated first
    const nodesMap = new Map(nodes.map(n => [n.ID, n]));
    const getNodeDepth = (node) => {
      let depth = 0;
      let curr = node;
      while (curr && curr.parent_ID) {
        depth++;
        curr = nodesMap.get(curr.parent_ID);
      }
      return depth;
    };
    nodes.sort((a, b) => getNodeDepth(a) - getNodeDepth(b));

    let totalRoles = 0;
    // Process sequentially to completely eliminate DB transaction race conditions
    for (const node of nodes) {
      const result = await generateRoleForNode(cds, entities, node, false);
      totalRoles += result.count;
    }

    return { count: totalRoles };
  };
}

module.exports = { makeGenerateOrgRoleHandler, makeGenerateAllOrgRolesHandler };
