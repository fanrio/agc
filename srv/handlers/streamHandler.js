const cds = require('@sap/cds');
const HanaClient = require('../lib/hanaClient');

/**
 * Helper to sanitize the node name for a valid SQL table name
 */
function sanitizeTableName(name) {
  const clean = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
  
  const baseName = clean || 'stream';
  return `${baseName}_flat_authorizations`;
}

/**
 * Register stream handlers
 */
function registerStreamHandlers(service) {
  const { Streams, StreamAttributes, BdcSettings, AppAuthorizations } = service.entities;

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
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'Streams', async (req) => {
    await checkSettingsPermission(req);
  });

  // Validate name length (max 10) and auto-populate UUID
  service.before(['CREATE', 'UPDATE'], 'Streams', async (req) => {
    if (req.event === 'CREATE' && !req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
    const { name } = req.data;
    if (name && name.length > 10) {
      return req.error(400, `Name "${name}" is too long: must be at most 10 characters.`);
    }
  });

  service.before(['CREATE', 'UPDATE', 'DELETE'], 'StreamAttributes', async (req) => {
    await checkSettingsPermission(req);
  });

  // After CREATE of Streams, create custom HANA table
  service.after('CREATE', 'Streams', (node, req) => {
    cds.spawn({ user: req?.user }, async () => {
      try {
        const dbBdcSettings = cds.entities('fanrio.auth').BdcSettings;
        const hanaConnections = await cds.db.run(
          SELECT.from(dbBdcSettings).where({ connectionType: 'SAP Hana', isActive: true })
        );

        console.log(`[StreamHandler] Active HANA connections found: ${hanaConnections.length}`);

        if (hanaConnections.length === 0) {
          console.log('[StreamHandler] No active HANA connections configured. Skipping table creation.');
          return;
        }

        const tableName = sanitizeTableName(node.name);
        console.log(`[StreamHandler] Creating custom table "${tableName}" on ${hanaConnections.length} active HANA connections...`);

        for (const conn of hanaConnections) {
          try {
            await HanaClient.createCustomFlatTable(conn, tableName);
          } catch (err) {
            console.error(`[StreamHandler] Failed to create table "${tableName}" on connection ${conn.systemName}:`, err.message);
          }
        }
      } catch (err) {
        console.error('[StreamHandler] Error in background HANA table creation:', err.message);
      }
    });
  });
}

module.exports = {
  registerStreamHandlers
};
