const cds = require('@sap/cds');
const HanaClient = require('../lib/hanaClient');
const { getSessionPermissions, requirePermission } = require('../lib/authGuard');

/**
 * Helper to sanitize the node name for a valid SQL table name
 */
function sanitizeTableName(name) {
  if (!name) return '';
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
  
  return `${clean}_flat_authorizations`;
}

function sanitizeHierTableName(name) {
  if (!name) return '';
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
  
  return `${clean}_hier_authorizations`;
}

/**
 * Register access domain handlers
 */
function registerAccessDomainHandlers(service) {
  const { AccessDomains, AccessDomainAttributes, BdcSettings, AppAuthorizations } = service.entities;

  // Helper to resolve user permissions using the shared authGuard (respects Demo Mode)
  async function checkSettingsPermission(req) {
    const permissions = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(permissions, 'canManageSettings', req);
  }

  // Before CREATE/UPDATE/DELETE check permissions
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'AccessDomains', async (req) => {
    await checkSettingsPermission(req);
  });

  // Validate name length (max 10) and auto-populate UUID
  service.before(['CREATE', 'UPDATE'], 'AccessDomains', async (req) => {
    if (req.event === 'CREATE' && !req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
    const { name, roleTemplateName } = req.data;
    if (name && name.length > 10) {
      return req.error(400, `Name "${name}" is too long: must be at most 10 characters.`);
    }

    if (req.event === 'CREATE' && !roleTemplateName) {
      return req.error(400, 'Role template name is required.');
    }
    if (roleTemplateName !== undefined && !roleTemplateName.trim()) {
      return req.error(400, 'Role template name cannot be empty.');
    }

    if (roleTemplateName) {
      const regex = /\{([^}]+)\}/g;
      let match;
      while ((match = regex.exec(roleTemplateName)) !== null) {
        const fieldName = match[1];
        if (!/^[a-zA-Z0-9_]+$/.test(fieldName)) {
          return req.error(400, `Invalid placeholder field name "${fieldName}" in template. Use only alphanumeric characters and underscores.`);
        }
      }
    }
  });

  // Before DELETE of AccessDomains, validate usage and drop associated custom HANA tables
  service.before('DELETE', 'AccessDomains', async (req) => {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data?.ID;
    if (!id) return;

    // 1. Check if any roles are associated with this Access Domain
    const assignedRoles = await cds.db.run(
      SELECT.from('fanrio.auth.Roles')
        .columns('name')
        .where({ accessDomain_ID: id })
    );

    if (assignedRoles && assignedRoles.length > 0) {
      const roleNames = assignedRoles.slice(0, 5).map(r => `"${r.name}"`).join(', ');
      const extra = assignedRoles.length > 5 ? ` and ${assignedRoles.length - 5} more` : '';
      return req.error(
        400,
        `Cannot delete Access Domain: It is still assigned to ${assignedRoles.length} role(s) (${roleNames}${extra}). Please reassign or delete these roles first.`
      );
    }

    // 2. Check if any dynamic generation rules use this Access Domain
    const assignedRules = await cds.db.run(
      SELECT.from('fanrio.auth.DynamicGenerationRules')
        .columns('code')
        .where({ accessDomain_ID: id })
    );

    if (assignedRules && assignedRules.length > 0) {
      const ruleCodes = assignedRules.slice(0, 5).map(r => `"${r.code}"`).join(', ');
      const extra = assignedRules.length > 5 ? ` and ${assignedRules.length - 5} more` : '';
      return req.error(
        400,
        `Cannot delete Access Domain: It is used in ${assignedRules.length} dynamic generation rule(s) (${ruleCodes}${extra}). Please remove or update these rules first.`
      );
    }

    const accessDomain = await cds.db.run(SELECT.one.from(AccessDomains).columns('name').where({ ID: id }));
    if (!accessDomain || !accessDomain.name) return;

    const flatTable = sanitizeTableName(accessDomain.name);
    const hierTable = sanitizeHierTableName(accessDomain.name);

    const dbBdcSettings = cds.entities('fanrio.auth').BdcSettings;
    const hanaConnections = await cds.db.run(
      SELECT.from(dbBdcSettings).where({ connectionType: 'SAP Hana', isActive: true })
    );

    if (hanaConnections.length === 0) {
      console.log('[AccessDomainHandler] No active HANA connections configured for dropping tables.');
      return;
    }

    console.log(`[AccessDomainHandler] Dropping custom tables "${flatTable}" and "${hierTable}" on ${hanaConnections.length} active HANA connections...`);

    for (const conn of hanaConnections) {
      await HanaClient.dropCustomTable(conn, flatTable);
      await HanaClient.dropCustomTable(conn, hierTable);
    }
  });

  service.before(['CREATE', 'UPDATE', 'DELETE'], 'AccessDomainAttributes', async (req) => {
    await checkSettingsPermission(req);
  });

  service.before(['CREATE', 'DELETE'], 'AccessDomainFields', async (req) => {
    await checkSettingsPermission(req);
  });

  // After CREATE of AccessDomains, create custom HANA table
  service.after('CREATE', 'AccessDomains', async (node, req) => {
    const dbBdcSettings = cds.entities('fanrio.auth').BdcSettings;
    const hanaConnections = await cds.db.run(
      SELECT.from(dbBdcSettings).where({ connectionType: 'SAP Hana', isActive: true })
    );

    console.log(`[AccessDomainHandler] Active HANA connections found: ${hanaConnections.length}`);

    if (hanaConnections.length === 0) {
      console.log('[AccessDomainHandler] No active HANA connections configured. Skipping table creation.');
      return;
    }

    const name = node?.name || req.data?.name;
    if (!name) {
      console.warn('[AccessDomainHandler] Skipping table creation: name is empty or undefined.');
      return;
    }

    const tableName = sanitizeTableName(name);
    const hierTableName = sanitizeHierTableName(name);
    console.log(`[AccessDomainHandler] Creating custom tables "${tableName}" and "${hierTableName}" on ${hanaConnections.length} active HANA connections...`);

    for (const conn of hanaConnections) {
      await HanaClient.createCustomFlatTable(conn, tableName);
      await HanaClient.createCustomHierTable(conn, hierTableName);
    }
  });
}

module.exports = {
  registerAccessDomainHandlers
};
