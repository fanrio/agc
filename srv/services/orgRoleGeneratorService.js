'use strict';

/**
 * OrgRoleGeneratorService
 *
 * Creates or updates ORG_BASED roles from OrgNode records.
 * Previously embedded as _generateRoleForNode + two action handlers
 * in authorization-service.js (L136-191, L356-380).
 */

/**
 * Generates (or updates) an ORG_BASED role for a given org node.
 *
 * @param {object} cds      - CAP cds instance
 * @param {object} entities - { Roles, Restrictions, RestrictionFields, OrgNodes, OrgNodeAttributes }
 * @param {object} node     - the OrgNode record
 * @returns {{ roleId: string, roleName: string }}
 */
async function generateRoleForNode(cds, entities, node) {
  const db = cds.db;
  const { Roles, Restrictions, RestrictionFields, OrgNodeAttributes } = entities;

  const roleName = `ROLE_ORG_${node.name.replace(/\s+/g, '_').toUpperCase()}`;

  // Upsert the role
  let role = await db.run(SELECT.one.from(Roles).where({ orgNode_ID: node.ID, type: 'ORG_BASED' }));
  let roleId;
  if (role) {
    roleId = role.ID;
    await db.run(UPDATE(Roles).set({ name: roleName }).where({ ID: roleId }));
  } else {
    roleId = cds.utils.uuid();
    await db.run(INSERT.into(Roles).entries({
      ID:          roleId,
      name:        roleName,
      type:        'ORG_BASED',
      description: `Auto-generated from Org Node: ${node.name}`,
      orgNode_ID:  node.ID,
      stream_ID: 'app-global'
    }));
  }

  // Resolve the restriction field name from the node type
  let restrictionFieldName = 'OrgNode';
  if (node.type_ID) {
    const rf = await db.run(SELECT.one.from(RestrictionFields).columns('name').where({ ID: node.type_ID }));
    if (rf) restrictionFieldName = rf.name;
  }

  // Replace the node's restriction with a fresh SINGLE_VALUE for the node name
  await db.run(DELETE.from(Restrictions).where({ role_ID: roleId }));
  await db.run(INSERT.into(Restrictions).entries({
    ID:          cds.utils.uuid(),
    role_ID:     roleId,
    field:       restrictionFieldName,
    filterType:  'SINGLE_VALUE',
    value:       node.name,
    sourceLabel: node.name
  }));

  // Update the org node's 'Role' attribute for visibility in the UI
  await db.run(DELETE.from(OrgNodeAttributes).where({ node_ID: node.ID, field: 'Role' }));
  await db.run(INSERT.into(OrgNodeAttributes).entries({
    ID:      cds.utils.uuid(),
    node_ID: node.ID,
    field:   'Role',
    value:   roleName
  }));

  return { roleId, roleName };
}

/**
 * Factory: returns the generateOrgRole OData action handler.
 */
function makeGenerateOrgRoleHandler(cds, entities) {
  return async function generateOrgRoleHandler(req) {
    const { orgNodeId } = req.data;
    const { OrgNodes } = entities;
    const node = await cds.db.run(SELECT.one.from(OrgNodes).where({ ID: orgNodeId }));
    if (!node) return req.error(404, `OrgNode ${orgNodeId} not found`);
    return generateRoleForNode(cds, entities, node);
  };
}

/**
 * Factory: returns the generateAllOrgRoles OData action handler.
 */
function makeGenerateAllOrgRolesHandler(cds, entities) {
  return async function generateAllOrgRolesHandler(req) {
    const { OrgNodes } = entities;
    const nodes = await cds.db.run(SELECT.from(OrgNodes));
    let count = 0;
    for (const node of nodes) {
      await generateRoleForNode(cds, entities, node);
      count++;
    }
    return { count };
  };
}

module.exports = { makeGenerateOrgRoleHandler, makeGenerateAllOrgRolesHandler };

