const cds = require('@sap/cds');
const HanaClient = require('../lib/hanaClient');

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

  // Helper to resolve user permissions
  async function checkSettingsPermission(req) {
    const userEmail = req.user.id;
    if (!userEmail) return req.reject(401, 'Unauthorized');

    const auth = await cds.db.run(SELECT.one.from(AppAuthorizations).where({ userId: userEmail, isActive: true }));
    const isSuperAdmin = auth?.isSuperAdmin || false;
    const canManageSettings = auth?.canManageSettings || false;

    if (!isSuperAdmin && !canManageSettings) {
      return req.reject(403, 'Forbidden: You do not have permission to manage settings.');
    }
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
    const { name } = req.data;
    if (name && name.length > 10) {
      return req.error(400, `Name "${name}" is too long: must be at most 10 characters.`);
    }
  });

  // Before DELETE of AccessDomains, fetch the name to drop associated custom HANA tables
  service.before('DELETE', 'AccessDomains', async (req) => {
    const id = req.data.ID;
    if (!id) return;
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
