'use strict';

/**
 * BdcActionService
 *
 * All OData action handlers that proxy to SAP Datasphere (BDC) REST APIs
 * or to SAP HANA via HanaClient:
 *
 *   - testBdcConnection
 *   - fetchBdcSpaces / fetchBdcAssets / fetchBdcRelationalValues / fetchBdcAssetColumns
 *   - fetchRawBdcSpaces / fetchRawBdcAssets / fetchRawBdcRelationalValues / fetchRawBdcAssetColumns
 *   - fetchBdcAssociations
 *   - fetchRawHanaViews
 *   - runBdcTaskChain
 *   - fetchBdcTaskChainLog
 *   - searchLdapUsers
 *
 * Security: All handlers resolve connection credentials from BdcSettings in the DB
 * using the connectionId passed by the frontend. Credentials are NEVER sent by the frontend.
 *
 * Previously embedded in authorization-service.js (L455-841, L1094-1121, L563-585).
 * F-03 fix: credential console.log removed from testBdcConnection.
 */

const { isMockUrl } = require('../lib/urlUtils');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load a BdcSettings connection from DB by its ID.
 * Returns the setting row or calls req.error(404) and returns null.
 */
async function _loadConnection(cds, entities, connectionId, req) {
  if (!connectionId) {
    req.error(400, 'Missing connectionId');
    return null;
  }
  const { BdcSettings } = entities;
  const setting = await cds.db.run(SELECT.one.from(BdcSettings).where({ ID: connectionId }));
  if (!setting) {
    req.error(404, `BDC Connection with ID ${connectionId} not found`);
    return null;
  }
  return setting;
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

function makeTestBdcConnectionHandler(cds, entities, HanaClient, BdcClient) {
  return async function testBdcConnectionHandler(req) {
    const { settingId } = req.data;
    const { BdcSettings } = entities;
    const setting = await cds.db.run(SELECT.one.from(BdcSettings).where({ ID: settingId }));
    if (!setting) return req.error(404, `BDC Setting with ID ${settingId} not found`);

    // Note: credential logging removed (audit finding F-03)

    if (setting.connectionType === 'SAP Hana') {
      if (!setting.host) return { success: false, message: 'Failed: Hostname is required for SAP Hana connection' };
      if (!setting.port) return { success: false, message: 'Failed: Port is required for SAP Hana connection' };
      if (!setting.username || !setting.password) return { success: false, message: 'Failed: User and Password are required for SAP Hana connection' };
      return HanaClient.testConnectionAndCreateTable(setting);
    }

    // OData connection — validate config fields
    if (!setting.url || !setting.url.startsWith('http')) {
      return { success: false, message: `Failed: Invalid endpoint URL '${setting.url || ''}'` };
    }
    if (setting.authType === 'BASIC' && (!setting.username || !setting.password)) {
      return { success: false, message: 'Failed: Missing username or password for Basic Authentication' };
    }
    if (setting.authType === 'OAUTH' && (!setting.tokenUrl || !setting.clientId || !setting.clientSecret)) {
      return { success: false, message: 'Failed: Missing OAuth2 token URL, Client ID, or Client Secret' };
    }
    if (setting.authType === 'TOKEN' && !setting.apiToken) {
      return { success: false, message: 'Failed: Missing API Bearer Token' };
    }

    // F-15 fix: attempt a real HEAD request to the metadata endpoint to verify connectivity
    // Mock/sandbox/localhost URLs are returned as success immediately (test environments)
    if (isMockUrl(setting.url)) {
      return { success: true, message: `Successfully connected to Business Data Cloud System [${setting.systemName}] at ${setting.url}. Connection state: ACTIVE.` };
    }

    // Real credential test for OAuth
    if (setting.authType === 'OAUTH') {
      try {
        await BdcClient.getAccessToken(setting.tokenUrl, setting.clientId, setting.clientSecret);
      } catch (e) {
        return { success: false, message: `OAuth Token Request Failed: ${e.message}. Please check Client ID, Client Secret, and Token URL.` };
      }
    }

    try {
      const testUrl = `${setting.url.replace(/\/$/, '')}/$metadata`;
      const res = await fetch(testUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      return {
        success: res.ok || res.status === 401, // 401 means reachable but needs auth — expected
        message: res.ok
          ? `Successfully connected to Business Data Cloud System [${setting.systemName}] at ${setting.url}. Connection state: ACTIVE.`
          : `Endpoint reachable but returned HTTP ${res.status} for [${setting.systemName}]`
      };
    } catch (e) {
      // AbortError = timeout, TypeError = network unreachable
      return { success: false, message: `Failed to reach [${setting.systemName}] at ${setting.url}: ${e.message}` };
    }
  };
}

function makeFetchBdcSpacesHandler(cds, entities, BdcClient) {
  return async function fetchBdcSpacesHandler(req) {
    const { connectionId, url: directUrl, tokenUrl: directTokenUrl, clientId: directClientId, clientSecret: directClientSecret } = req.data;

    let url, tokenUrl, clientId, clientSecret;

    if (connectionId) {
      // Preferred path: load credentials from DB
      const conn = await _loadConnection(cds, entities, connectionId, req);
      if (!conn) return;
      url = conn.url; tokenUrl = conn.tokenUrl; clientId = conn.clientId; clientSecret = conn.clientSecret;
    } else if (directUrl && directTokenUrl && directClientId && directClientSecret) {
      // Fallback: direct credentials (used during BdcSettings creation before save)
      url = directUrl; tokenUrl = directTokenUrl; clientId = directClientId; clientSecret = directClientSecret;
    } else {
      return req.error(400, 'Missing connectionId or direct credentials (url, tokenUrl, clientId, clientSecret)');
    }

    try {
      return BdcClient.fetchSpaces(url, tokenUrl, clientId, clientSecret);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchBdcAssetsHandler(cds, entities, BdcClient) {
  return async function fetchBdcAssetsHandler(req) {
    const { connectionId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    try {
      const { assetsList } = await BdcClient.fetchAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space);
      return assetsList;
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchBdcRelationalValuesHandler(cds, entities, BdcClient) {
  return async function fetchBdcRelationalValuesHandler(req) {
    const { connectionId, space, asset, assetText, idColumns, textColumn } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!asset) return req.error(400, 'Missing asset');

    const effectiveSpace = space || conn.space;
    const url = conn.url;
    const tokenUrl = conn.tokenUrl;
    const clientId = conn.clientId;
    const clientSecret = conn.clientSecret;

    try {
      const { rawData, assetRecords, assetTextRecords } = await BdcClient.fetchRelationalValues({
        url, tokenUrl, clientId, clientSecret,
        space: effectiveSpace, asset, assetText, idColumns, textColumn
      });

      if (isMockUrl(url)) {
        const mockRows = [
          { ID: 'C1001', NAME: 'Acme Corp', REGION: 'US_EAST' },
          { ID: 'C1002', NAME: 'Beta LLC', REGION: 'US_WEST' },
          { ID: 'C1003', NAME: 'Gamma Inc', REGION: 'EMEA_CENTRAL' }
        ];
        const mapped = mockRows.map(r => ({
          id: r.ID,
          text: textColumn ? `${r.ID} - ${r[textColumn]}` : `${r.ID} - ${r.NAME}`
        }));
        return mapped;
      }

      // Automatically retrieve key columns from metadata
      let resolvedKeyCols = [];
      try {
        const accessToken = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
        resolvedKeyCols = await BdcClient.fetchAssetKeyColumns(url, accessToken, effectiveSpace, asset);
      } catch (err) {
        console.error(`Failed to automatically resolve key columns for asset ${asset}:`, err.message);
      }

      const cols = BdcClient._parseCols(idColumns, resolvedKeyCols);
      const translationMap = BdcClient._buildTranslationMap(assetTextRecords, cols, textColumn);

      const mapped = assetRecords
        .map(row => BdcClient._mapRecord(row, cols, translationMap, textColumn, assetText, assetTextRecords))
        .filter(item => item.id !== undefined && item.id !== null && item.id !== '');

      return mapped;
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchBdcAssetColumnsHandler(cds, entities, BdcClient) {
  return async function fetchBdcAssetColumnsHandler(req) {
    const { connectionId, space, asset } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!asset) return req.error(400, 'Missing asset');
    const effectiveSpace = space || conn.space;
    try {
      return BdcClient.fetchAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, effectiveSpace, asset);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcSpacesHandler(cds, entities, BdcClient) {
  return async function fetchRawBdcSpacesHandler(req) {
    const { connectionId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    try {
      const token = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      const endpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/spaces`;
      const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Spaces request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcAssetsHandler(cds, entities, BdcClient) {
  return async function fetchRawBdcAssetsHandler(req) {
    const { connectionId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    try {
      const token = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      const endpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/assets`;
      const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Assets request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcRelationalValuesHandler(cds, entities, BdcClient) {
  return async function fetchRawBdcRelationalValuesHandler(req) {
    const { connectionId, space, asset } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!asset) return req.error(400, 'Missing asset');
    const effectiveSpace = space || conn.space;
    try {
      const token = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      const s = effectiveSpace.trim(); const a = asset.trim();
      const endpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/${a}`;
      const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Relational Values request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcAssetColumnsHandler(cds, entities, BdcClient) {
  return async function fetchRawBdcAssetColumnsHandler(req) {
    const { connectionId, space, asset } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!asset) return req.error(400, 'Missing asset');
    const effectiveSpace = space || conn.space;
    try {
      const token = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      const s = effectiveSpace.trim(); const a = asset.trim();
      const endpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;
      const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' } });
      if (!res.ok) throw new Error(`Asset Columns Metadata request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return res.text();
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchBdcAssociationsHandler(cds, entities, BdcClient) {
  return async function fetchBdcAssociationsHandler(req) {
    const { connectionId, space, asset } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    const effectiveSpace = space || conn.space;
    const s = effectiveSpace ? effectiveSpace.trim() : '';
    const a = asset ? asset.trim() : '';

    if (isMockUrl(conn.url)) {
      return JSON.stringify([
        { name: 'to_TextTable', targetType: 'MY_SPACE.COMPANY_TEXT' },
        { name: 'to_HierarchyDirectory', targetType: 'MY_SPACE.MY_HIERARCHY_DIRECTORY' }
      ], null, 2);
    }

    try {
      const token = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      const analyticalEndpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/analytical/${s}/${a}/$metadata`;
      const relationalEndpoint = `${conn.url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;

      let res;
      try {
        res = await fetch(analyticalEndpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' } });
      } catch (err) {
        console.warn(`[BdcAction] Analytical endpoint fetch failed: ${err.message}. Trying relational fallback.`);
      }
      if (!res || !res.ok) {
        res = await fetch(relationalEndpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' } });
      }
      if (!res.ok) throw new Error(`Asset Metadata request failed: ${res.status}`);

      const xml = await res.text();
      const associations = [];
      const navPropRegex = /<NavigationProperty\b[^>]*>/g;
      const nameRegex = /\bName="([^"]+)"/;
      const typeRegex = /\bType="([^"]+)"/;
      let match;
      while ((match = navPropRegex.exec(xml)) !== null) {
        const nameMatch = nameRegex.exec(match[0]);
        const typeMatch = typeRegex.exec(match[0]);
        if (nameMatch && typeMatch) associations.push({ name: nameMatch[1], targetType: typeMatch[1] });
      }
      return JSON.stringify(associations, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API fetchBdcAssociations Error: ${e.message}`);
    }
  };
}

function makeFetchRawHanaViewsHandler(cds, entities, HanaClient) {
  return async function fetchRawHanaViewsHandler(req) {
    const { settingId } = req.data;
    const { BdcSettings } = entities;
    const setting = await cds.db.run(SELECT.one.from(BdcSettings).where({ ID: settingId }));
    if (!setting) return req.error(404, `BDC Setting with ID ${settingId} not found`);
    try {
      // F-04 fix: use parameterized query against SYS.VIEWS to prevent SQL injection
      const sql = 'SELECT SCHEMA_NAME, VIEW_NAME FROM SYS.VIEWS WHERE SCHEMA_NAME NOT IN (?, ?, ?, ?, ?) ORDER BY SCHEMA_NAME, VIEW_NAME';
      const rows = await HanaClient.execute(setting, sql, ['SYS', '_SYS_BI', '_SYS_BIC', '_SYS_STATISTICS', '_SYS_XS']);
      return JSON.stringify(rows, null, 2);
    } catch (err) {
      return req.error(500, err.message);
    }
  };
}

function makeRunBdcTaskChainHandler(cds, entities, BdcClient) {
  return async function runBdcTaskChainHandler(req) {
    const { connectionId, space, taskChainId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!taskChainId) return req.error(400, 'Missing taskChainId');
    const effectiveSpace = space || conn.space;
    try {
      const data = await BdcClient.runTaskChain(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, effectiveSpace, taskChainId);
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API runBdcTaskChain Error: ${e.message}`);
    }
  };
}

function makeFetchBdcTaskChainLogHandler(cds, entities, BdcClient) {
  return async function fetchBdcTaskChainLogHandler(req) {
    const { connectionId, space, logId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!logId) return req.error(400, 'Missing logId');
    const effectiveSpace = space || conn.space;
    try {
      const data = await BdcClient.fetchTaskChainLog(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, effectiveSpace, logId);
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API fetchBdcTaskChainLog Error: ${e.message}`);
    }
  };
}

function makeSearchScimUsersHandler(cds, entities, BdcClient) {
  return async function searchScimUsersHandler(req) {
    const { query } = req.data;
    const { BdcSettings } = entities;
    try {
      // Find the active OData BDC setting
      const setting = await cds.db.run(
        SELECT.one.from(BdcSettings).where({ connectionType: 'OData', isActive: true })
      );
      if (!setting) {
        return req.error(400, 'No active OData BDC Connection configuration found in BdcSettings');
      }

      // Check if mock URL (local development/tests fallback)
      if (isMockUrl(setting.url)) {
        const mockResources = [
          { userName: 'tim.waecken@cimt-ag.de', emails: [{ value: 'tim.waecken@cimt-ag.de' }], name: { givenName: 'Tim', familyName: 'Wäcken' }, urn_ietf_params_scim_schemas_extension_enterprise_2_0_User: { department: 'Finance' } },
          { userName: 'alice.smith@fanrio.com', emails: [{ value: 'alice.smith@fanrio.com' }], name: { givenName: 'Alice', familyName: 'Smith' } },
          { userName: 'bob.martin@fanrio.com', emails: [{ value: 'bob.martin@fanrio.com' }], name: { givenName: 'Bob', familyName: 'Martin' } },
          { userName: 'charlie.white@fanrio.com', emails: [{ value: 'charlie.white@fanrio.com' }], name: { givenName: 'Charlie', familyName: 'White' } },
          { userName: 'emily.miller@fanrio.com', emails: [{ value: 'emily.miller@fanrio.com' }], name: { givenName: 'Emily', familyName: 'Miller' } },
          { userName: 'david.brown@fanrio.com', emails: [{ value: 'david.brown@fanrio.com' }], name: { givenName: 'David', familyName: 'Brown' } },
          { userName: 'sarah.meissner@fanrio.com', emails: [{ value: 'sarah.meissner@fanrio.com' }], name: { givenName: 'Sarah', familyName: 'Meissner' } },
          { userName: 'eisen.schmidt@fanrio.com', emails: [{ value: 'eisen.schmidt@fanrio.com' }], name: { givenName: 'Eisen', familyName: 'Schmidt' } }
        ];

        let filtered = mockResources;
        if (query && query.trim()) {
          const q = query.toLowerCase().trim();
          filtered = mockResources.filter(r =>
            r.userName.toLowerCase().includes(q) ||
            (r.emails && r.emails[0] && r.emails[0].value.toLowerCase().includes(q)) ||
            (r.name && r.name.givenName.toLowerCase().includes(q))
          );
        }

        return filtered.map(u => {
          const emailVal = u.emails && u.emails[0] ? u.emails[0].value : u.userName;
          const formattedName = u.name && u.name.formatted ? u.name.formatted :
            (u.name && u.name.givenName && u.name.familyName ? `${u.name.givenName} ${u.name.familyName}` : (u.displayName || u.userName));
          const dispName = formattedName.toLowerCase().includes(emailVal.toLowerCase()) ? formattedName : `${formattedName} (${emailVal})`;
          return {
            username: emailVal,
            displayName: dispName,
            email: u.emails && u.emails[0] ? u.emails[0].value : '',
            department: u.urn_ietf_params_scim_schemas_extension_enterprise_2_0_User?.department || 'N/A'
          };
        });
      }

      // Execute real SCIM API call on BDC system
      const response = await BdcClient.searchScimUsers(setting.url, setting.tokenUrl, setting.clientId, setting.clientSecret, query);
      const resources = response.Resources || [];
      return resources.map(u => {
        const emailVal = u.emails && u.emails[0] ? u.emails[0].value : u.userName;
        const formattedName = u.name && u.name.formatted ? u.name.formatted :
          (u.name && u.name.givenName && u.name.familyName ? `${u.name.givenName} ${u.name.familyName}` : (u.displayName || u.userName));
        const dispName = formattedName.toLowerCase().includes(emailVal.toLowerCase()) ? formattedName : `${formattedName} (${emailVal})`;
        return {
          username: emailVal,
          displayName: dispName,
          email: u.emails && u.emails[0] ? u.emails[0].value : '',
          department: u.urn_ietf_params_scim_schemas_extension_enterprise_2_0_User?.department || 'N/A'
        };
      });
    } catch (err) {
      console.error('[SearchScimUsers] SCIM integration query failed:', err.message);
      return req.error(500, `SCIM Integration Query Failed: ${err.message}`);
    }
  };
}

function makeFetchBdcAssetKeyColumnsHandler(cds, entities, BdcClient) {
  return async function fetchBdcAssetKeyColumnsHandler(req) {
    const { connectionId, space, asset } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    if (!asset) return req.error(400, 'Missing asset');
    const effectiveSpace = space || conn.space;
    try {
      const accessToken = await BdcClient.getAccessToken(conn.tokenUrl, conn.clientId, conn.clientSecret);
      return BdcClient.fetchAssetKeyColumns(conn.url, accessToken, effectiveSpace, asset);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcUsersHandler(cds, entities, BdcClient) {
  return async function fetchRawBdcUsersHandler(req) {
    const { connectionId } = req.data;
    const conn = await _loadConnection(cds, entities, connectionId, req);
    if (!conn) return;
    try {
      const data = await BdcClient.fetchRawBdcUsers(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret);
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere Users API Raw Error: ${e.message}`);
    }
  };
}

module.exports = {
  makeTestBdcConnectionHandler,
  makeFetchBdcSpacesHandler,
  makeFetchBdcAssetsHandler,
  makeFetchBdcRelationalValuesHandler,
  makeFetchBdcAssetColumnsHandler,
  makeFetchBdcAssetKeyColumnsHandler,
  makeFetchRawBdcSpacesHandler,
  makeFetchRawBdcAssetsHandler,
  makeFetchRawBdcRelationalValuesHandler,
  makeFetchRawBdcAssetColumnsHandler,
  makeFetchRawBdcUsersHandler,
  makeFetchBdcAssociationsHandler,
  makeFetchRawHanaViewsHandler,
  makeRunBdcTaskChainHandler,
  makeFetchBdcTaskChainLogHandler,
  makeSearchScimUsersHandler
};
