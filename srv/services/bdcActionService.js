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
 * Previously embedded in authorization-service.js (L455-841, L1094-1121, L563-585).
 * F-03 fix: credential console.log removed from testBdcConnection.
 */

const { isMockUrl } = require('../lib/urlUtils');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------



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
      if (!setting.host)                         return { success: false, message: 'Failed: Hostname is required for SAP Hana connection' };
      if (!setting.port)                         return { success: false, message: 'Failed: Port is required for SAP Hana connection' };
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

function makeFetchBdcSpacesHandler(BdcClient) {
  return async function fetchBdcSpacesHandler(req) {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    try {
      return BdcClient.fetchSpaces(url, tokenUrl, clientId, clientSecret);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchBdcAssetsHandler(BdcClient) {
  return async function fetchBdcAssetsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    try {
      const { assetsList } = await BdcClient.fetchAssets(url, tokenUrl, clientId, clientSecret, space);
      return assetsList;
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchBdcRelationalValuesHandler(BdcClient) {
  return async function fetchBdcRelationalValuesHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset, assetText, idColumns, textColumn } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    try {
      const { rawData, assetRecords, assetTextRecords } = await BdcClient.fetchRelationalValues(req.data);
      
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
        resolvedKeyCols = await BdcClient.fetchAssetKeyColumns(url, accessToken, space, asset);
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

function makeFetchBdcAssetColumnsHandler(BdcClient) {
  return async function fetchBdcAssetColumnsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    try {
      return BdcClient.fetchAssetColumns(url, tokenUrl, clientId, clientSecret, space, asset);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcSpacesHandler(BdcClient) {
  return async function fetchRawBdcSpacesHandler(req) {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    try {
      const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/spaces`;
      const res      = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Spaces request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcAssetsHandler(BdcClient) {
  return async function fetchRawBdcAssetsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    try {
      const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/assets`;
      const res      = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Assets request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcRelationalValuesHandler(BdcClient) {
  return async function fetchRawBdcRelationalValuesHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    try {
      const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      const s        = space.trim(); const a = asset.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/${a}`;
      const res      = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Relational Values request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return JSON.stringify(await res.json(), null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcAssetColumnsHandler(BdcClient) {
  return async function fetchRawBdcAssetColumnsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    try {
      const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      const s        = space.trim(); const a = asset.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;
      const res      = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' } });
      if (!res.ok) throw new Error(`Asset Columns Metadata request failed: ${res.status} [Endpoint: ${endpoint}]`);
      return res.text();
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  };
}

function makeFetchBdcAssociationsHandler(BdcClient) {
  return async function fetchBdcAssociationsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || space === undefined || asset === undefined) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }
    const s = space ? space.trim() : '';
    const a = asset ? asset.trim() : '';

    if (isMockUrl(url)) {
      return JSON.stringify([
        { name: 'to_TextTable',           targetType: 'MY_SPACE.COMPANY_TEXT' },
        { name: 'to_HierarchyDirectory',  targetType: 'MY_SPACE.MY_HIERARCHY_DIRECTORY' }
      ], null, 2);
    }

    try {
      const token              = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      const analyticalEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/analytical/${s}/${a}/$metadata`;
      const relationalEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;

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

      const xml          = await res.text();
      const associations = [];
      const navPropRegex = /<NavigationProperty\b[^>]*>/g;
      const nameRegex    = /\bName="([^"]+)"/;
      const typeRegex    = /\bType="([^"]+)"/;
      let   match;
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
      const sql  = 'SELECT SCHEMA_NAME, VIEW_NAME FROM SYS.VIEWS WHERE SCHEMA_NAME NOT IN (?, ?, ?, ?, ?) ORDER BY SCHEMA_NAME, VIEW_NAME';
      const rows = await HanaClient.execute(setting, sql, ['SYS', '_SYS_BI', '_SYS_BIC', '_SYS_STATISTICS', '_SYS_XS']);
      return JSON.stringify(rows, null, 2);
    } catch (err) {
      return req.error(500, err.message);
    }
  };
}

function makeRunBdcTaskChainHandler(BdcClient) {
  return async function runBdcTaskChainHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, taskChainId } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !taskChainId) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or taskChainId');
    }
    try {
      const data = await BdcClient.runTaskChain(url, tokenUrl, clientId, clientSecret, space, taskChainId);
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API runBdcTaskChain Error: ${e.message}`);
    }
  };
}

function makeFetchBdcTaskChainLogHandler(BdcClient) {
  return async function fetchBdcTaskChainLogHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, logId } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !logId) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or logId');
    }
    try {
      const data = await BdcClient.fetchTaskChainLog(url, tokenUrl, clientId, clientSecret, space, logId);
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API fetchBdcTaskChainLog Error: ${e.message}`);
    }
  };
}

function makeSearchScimUsersHandler(cds) {
  return async function searchScimUsersHandler(req) {
    const { query } = req.data;
    
    // Check if real SCIM API service is configured in cds.requires
    const hasScim = cds && cds.env && cds.env.requires && cds.env.requires['scim-api'];
    
    if (hasScim) {
      try {
        const scim = await cds.connect.to('scim-api');
        const q = query ? query.trim() : '';
        const filter = q 
          ? `userName co "${q}" or emails.value co "${q}" or name.givenName co "${q}" or name.familyName co "${q}"`
          : '';
        
        const params = filter ? { filter } : {};
        const response = await scim.get('/Users', params);
        
        const resources = response.Resources || [];
        return resources.map(u => ({
          username: u.emails && u.emails[0] ? u.emails[0].value : u.userName,
          displayName: u.name && u.name.givenName ? u.name.givenName : (u.displayName || u.userName),
          email: u.emails && u.emails[0] ? u.emails[0].value : '',
          department: u.urn_ietf_params_scim_schemas_extension_enterprise_2_0_User?.department || 'N/A'
        }));
      } catch (err) {
        console.error('[SearchScimUsers] SCIM integration query failed:', err.message);
        // Fallback to local stub in case of error (with warning)
      }
    }

    // Default mock users fallback for local development/testing (A-02)
    const users = [
      { username: 'john.doe@fanrio.com',      displayName: 'John',       email: 'john.doe@fanrio.com',      department: 'Finance' },
      { username: 'alice.smith@fanrio.com',    displayName: 'Alice',     email: 'alice.smith@fanrio.com',    department: 'Human Resources' },
      { username: 'bob.martin@fanrio.com',      displayName: 'Bob',      email: 'bob.martin@fanrio.com',     department: 'IT Operations' },
      { username: 'charlie.white@fanrio.com',   displayName: 'Charlie',   email: 'charlie.white@fanrio.com',  department: 'Sales' },
      { username: 'emily.miller@fanrio.com',    displayName: 'Emily',    email: 'emily.miller@fanrio.com',   department: 'Global Operations' },
      { username: 'david.brown@fanrio.com',     displayName: 'David',     email: 'david.brown@fanrio.com',    department: 'Finance' },
      { username: 'sarah.johnson@fanrio.com',   displayName: 'Sarah',   email: 'sarah.johnson@fanrio.com',  department: 'IT Development' },
      { username: 'maria.garcia@fanrio.com',    displayName: 'Maria',    email: 'maria.garcia@fanrio.com',   department: 'Sales' },
      { username: 'robert.wilson@fanrio.com',   displayName: 'Robert',   email: 'robert.wilson@fanrio.com',  department: 'Security' },
      { username: 'linda.harris@fanrio.com',    displayName: 'Linda',    email: 'linda.harris@fanrio.com',   department: 'Human Resources' },
      { username: 'admin@fanrio.com',          displayName: 'System',    email: 'admin@fanrio.com',          department: 'IT Operations' }
    ];
    if (!query || !query.trim()) return users;
    const q = query.toLowerCase().trim();
    return users.filter(u =>
      u.username.toLowerCase().includes(q)    ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)       ||
      u.department.toLowerCase().includes(q)
    );
  };
}

function makeFetchBdcAssetKeyColumnsHandler(BdcClient) {
  return async function fetchBdcAssetKeyColumnsHandler(req) {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    try {
      const accessToken = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
      return BdcClient.fetchAssetKeyColumns(url, accessToken, space, asset);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  };
}

function makeFetchRawBdcUsersHandler(BdcClient) {
  return async function fetchRawBdcUsersHandler(req) {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    try {
      const data = await BdcClient.fetchRawBdcUsers(url, tokenUrl, clientId, clientSecret);
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
