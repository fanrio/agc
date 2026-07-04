const { isMockUrl } = require('./urlUtils');

class BdcClient {
  /**
   * Helper to retrieve access token
   */
  static async getAccessToken(tokenUrl, clientId, clientSecret) {
    if (isMockUrl(tokenUrl)) {
      return 'mock-access-token-12345';
    }
    const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenRes.ok) {
      throw new Error(`Token request failed with status ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error('No access_token returned in OAuth response');
    }
    return accessToken;
  }

  /**
   * Helper to fetch spaces
   */
  static async fetchSpaces(url, tokenUrl, clientId, clientSecret) {
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const spacesEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/spaces`;
      const spacesRes = await fetch(spacesEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!spacesRes.ok) {
        throw new Error(`Spaces request failed with status ${spacesRes.status}`);
      }

      const data = await spacesRes.json();
      let spacesList = [];
      if (Array.isArray(data)) {
        spacesList = data.map(s => s.id || s.name || s);
      } else if (data && Array.isArray(data.results)) {
        spacesList = data.results.map(s => s.id || s.name || s);
      } else if (data && Array.isArray(data.value)) {
        spacesList = data.value.map(s => s.id || s.name || s);
      }
      return spacesList;
    } catch (e) {
      if (isMockUrl(url)) {
        console.warn(`fetchSpaces failed: ${e.message}. Returning mock fallback spaces for testing.`);
        return ['SALES_DEMO_SPACE', 'FINANCE_QA_SPACE', 'PRODUCTION_CORE_SPACE', 'HR_GLOBAL_SPACE'];
      }
      throw e;
    }
  }

  /**
   * Helper to fetch assets
   */
  static async fetchAssets(url, tokenUrl, clientId, clientSecret, space) {
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const assetsEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/assets`;
      const assetsRes = await fetch(assetsEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!assetsRes.ok) {
        throw new Error(`Assets request failed with status ${assetsRes.status}`);
      }

      const rawData = await assetsRes.json();
      let rawAssets = [];
      if (Array.isArray(rawData)) {
        rawAssets = rawData;
      } else if (rawData && Array.isArray(rawData.results)) {
        rawAssets = rawData.results;
      } else if (rawData && Array.isArray(rawData.value)) {
        rawAssets = rawData.value;
      }

      if (space) {
        rawAssets = rawAssets.filter(a => a.spaceName === space);
      }

      const assetsList = rawAssets.map(a => a.id || a.name || a);
      

      return { rawData, assetsList };
    } catch (e) {
      if (isMockUrl(url)) {
        const mockAssets = [
          { id: 'CUSTOMERS_VW', name: 'CUSTOMERS_VW', spaceName: 'SALES_DEMO_SPACE' },
          { id: 'ORDERS_FACT', name: 'ORDERS_FACT', spaceName: 'SALES_DEMO_SPACE' },
          { id: 'REVENUE_ANALYSIS_VW', name: 'REVENUE_ANALYSIS_VW', spaceName: 'FINANCE_QA_SPACE' }
        ];
        let filtered = mockAssets;
        if (space) {
          filtered = mockAssets.filter(a => a.spaceName === space);
        }
        return {
          rawData: filtered,
          assetsList: filtered.map(a => a.id)
        };
      }
      throw e;
    }
  }

  /**
   * Helper to fetch OData entity metadata (key columns)
   */
  static async fetchAssetKeyColumns(url, accessToken, space, asset) {
    if (isMockUrl(url)) {
      return ['id'];
    }
    const cleanSpace = space.trim();
    const cleanAsset = asset.trim();
    const metadataUrl = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/$metadata`;
    
    const metaRes = await fetch(metadataUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/xml, text/xml, application/json'
      }
    });

    if (!metaRes.ok) {
      throw new Error(`Metadata request failed with status ${metaRes.status}`);
    }

    const xmlText = await metaRes.text();
    const keys = [];
    const entityTypeRegex = /<EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g;
    let match;
    while ((match = entityTypeRegex.exec(xmlText)) !== null) {
      const entityContent = match[2];
      const keyBlockRegex = /<Key>([\s\S]*?)<\/Key>/;
      const keyBlockMatch = keyBlockRegex.exec(entityContent);
      if (keyBlockMatch) {
        const propertyRefRegex = /<PropertyRef\s+Name="([^"]+)"/g;
        let refMatch;
        while ((refMatch = propertyRefRegex.exec(keyBlockMatch[1])) !== null) {
          keys.push(refMatch[1]);
        }
      }
    }
    return keys;
  }

  /**
   * Helper to fetch all asset properties/columns
   */
  static async fetchAssetColumns(url, tokenUrl, clientId, clientSecret, space, asset) {
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const cleanSpace = space.trim();
      const cleanAsset = asset.trim();
      const metadataUrl = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/$metadata`;
      
      const metaRes = await fetch(metadataUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/xml, application/json'
        }
      });

      if (!metaRes.ok) {
        throw new Error(`Metadata request failed with status ${metaRes.status}`);
      }

      const xmlText = await metaRes.text();
      const properties = [];
      const cleanAssetLower = cleanAsset.toLowerCase();
      let foundBlockContent = null;

      const entityTypeScanner = /<(?:\w+:)?EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?EntityType>/gi;
      let match;
      while ((match = entityTypeScanner.exec(xmlText)) !== null) {
        const entityName = match[1].toLowerCase();
        if (entityName === cleanAssetLower || entityName === `${cleanAssetLower}type` || entityName.includes(cleanAssetLower)) {
          foundBlockContent = match[2];
          break;
        }
      }

      const contentToSearch = foundBlockContent || xmlText;
      const propRegex = /<(?:\w+:)?Property\s+Name="([^"]+)"/g;
      let propMatch;
      while ((propMatch = propRegex.exec(contentToSearch)) !== null) {
        if (!properties.includes(propMatch[1])) {
          properties.push(propMatch[1]);
        }
      }

      return properties;
    } catch (e) {
      if (isMockUrl(url)) {
        return ['ID', 'NAME', 'REGION', 'NodeID', 'ParentID', 'Hierarchy', 'SalesOrg', 'RegionID', 'description'];
      }
      throw e;
    }
  }

  /**
   * Helper to fetch relational values
   */
  static _parseCols(idColumns, resolvedKeyCols) {
    let cols = resolvedKeyCols || [];
    if (!cols || cols.length === 0 || cols[0] === 'id') {
      if (idColumns) {
        try {
          const parsed = JSON.parse(idColumns);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cols = parsed;
          } else if (parsed) {
            cols = [parsed];
          }
        } catch {
          cols = [idColumns];
        }
      }
    }
    return (Array.isArray(cols) && cols.length > 0 && cols[0]) ? cols : ['id'];
  }

  static async _fetchAssetRecords(url, accessToken, space, asset) {
    const cleanSpace = space.trim();
    const cleanAsset = asset.trim();
    const assetEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/${cleanAsset}`;
    
    const assetRes = await fetch(assetEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!assetRes.ok) {
      throw new Error(`Asset ID relational request failed: ${assetRes.status} ${assetRes.statusText}`);
    }

    const assetResponseText = await assetRes.text();
    const rawData = JSON.parse(assetResponseText);
    const assetRows = rawData.value?.[0]?.value || rawData.results || rawData.value || rawData || [];
    return { rawData, assetRecords: Array.isArray(assetRows) ? assetRows : [] };
  }

  static async _fetchAssetTextRecords(url, accessToken, space, assetText) {
    if (!assetText || !assetText.trim()) return [];
    const cleanSpace = space.trim();
    const cleanAssetText = assetText.trim();
    const assetTextEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAssetText}/${cleanAssetText}`;
    
    const textRes = await fetch(assetTextEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    if (textRes.ok) {
      const textResponseText = await textRes.text();
      const textRaw = JSON.parse(textResponseText);
      const textRows = textRaw.value?.[0]?.value || textRaw.results || textRaw.value || textRaw || [];
      return Array.isArray(textRows) ? textRows : [];
    }
    return [];
  }

  static _buildTranslationMap(assetTextRecords, cols, textColumn) {
    const translationMap = new Map();
    if (assetTextRecords.length > 0) {
      for (const row of assetTextRecords) {
        const key = cols.map(c => row[c] !== undefined && row[c] !== null ? String(row[c]) : '').filter(Boolean).join('-');
        if (key) {
          const descCol = Object.keys(row).find(k => k.toLowerCase() === 'description') || textColumn || 'description';
          const textVal = row[descCol] !== undefined && row[descCol] !== null ? String(row[descCol]) : '';
          translationMap.set(key, textVal);
        }
      }
    }
    return translationMap;
  }

  static _mapRecord(row, cols, translationMap, textColumn, assetText, assetTextRecords) {
    const nodeIdCol = Object.keys(row).find(k => k.toLowerCase() === 'nodeid');
    const salesOrgCol = Object.keys(row).find(k => k.toLowerCase() === 'salesorg');
    const regionIdCol = Object.keys(row).find(k => k.toLowerCase() === 'regionid');
    
    let idVal;
    let textVal;

    if (nodeIdCol) {
      idVal = row[nodeIdCol] !== undefined && row[nodeIdCol] !== null ? String(row[nodeIdCol]) : '';
      const salesOrgVal = salesOrgCol && row[salesOrgCol] !== undefined && row[salesOrgCol] !== null ? String(row[salesOrgCol]).trim() : '';
      const regionIdVal = regionIdCol && row[regionIdCol] !== undefined && row[regionIdCol] !== null ? String(row[regionIdCol]).trim() : '';
      
      if (salesOrgVal) {
        textVal = `${idVal} - ${salesOrgVal}`;
      } else if (regionIdVal) {
        textVal = `${idVal} - ${regionIdVal}`;
      } else {
        textVal = idVal;
      }
    } else {
      idVal = cols.map(c => row[c] !== undefined && row[c] !== null ? String(row[c]) : '').filter(Boolean).join('-');
      textVal = idVal;
      if (assetText && assetText.trim() && assetTextRecords.length > 0) {
        textVal = translationMap.get(idVal) || idVal;
      } else {
        const descCol = Object.keys(row).find(k => k.toLowerCase() === 'description') || textColumn;
        if (descCol && row[descCol] !== undefined && row[descCol] !== null) {
          textVal = String(row[descCol]);
        } else {
          textVal = idVal;
        }
      }
    }

    const hierarchyCol = Object.keys(row).find(k => k.toLowerCase() === 'hierarchy');
    const hierarchyVal = hierarchyCol && row[hierarchyCol] !== undefined && row[hierarchyCol] !== null ? String(row[hierarchyCol]) : undefined;

    const parentIdCol = Object.keys(row).find(k => k.toLowerCase() === 'parentid');
    const parentIdVal = parentIdCol && row[parentIdCol] !== undefined && row[parentIdCol] !== null ? String(row[parentIdCol]) : null;

    const returnObj = {
      id: idVal,
      text: nodeIdCol ? textVal : (idVal === textVal ? idVal : `${idVal} - ${textVal}`)
    };
    if (nodeIdCol) {
      returnObj.parent_ID = (parentIdVal !== null && parentIdVal !== 'null' && parentIdVal !== '') ? parentIdVal : null;
    }
    if (hierarchyVal !== undefined) {
      returnObj.hierarchy = hierarchyVal;
    }
    return returnObj;
  }

  static async fetchRelationalValues(options) {
    const { url, tokenUrl, clientId, clientSecret, space, asset, assetText } = options;
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const { rawData, assetRecords } = await this._fetchAssetRecords(url, accessToken, space, asset);
      const assetTextRecords = await this._fetchAssetTextRecords(url, accessToken, space, assetText);
      return { rawData, assetRecords, assetTextRecords };
    } catch (e) {
      if (isMockUrl(url)) {
        const mockRows = [
          { ID: 'C1001', NAME: 'Acme Corp', REGION: 'US_EAST' },
          { ID: 'C1002', NAME: 'Beta LLC', REGION: 'US_WEST' },
          { ID: 'C1003', NAME: 'Gamma Inc', REGION: 'EMEA_CENTRAL' }
        ];
        return { rawData: mockRows, assetRecords: mockRows, assetTextRecords: [] };
      }
      throw e;
    }
  }

  /**
   * Helper to run BDC Task Chain
   */
  static async runTaskChain(url, tokenUrl, clientId, clientSecret, space, taskChainId) {
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const tc = taskChainId.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/chains/${s}/run/${tc}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Task chain run request failed: ${res.status} ${res.statusText}. Response: ${errBody} [Endpoint: ${endpoint}]`);
      }

      return await res.json();
    } catch (e) {
      if (isMockUrl(url)) {
        return {
          logId: `mock-log-${Date.now()}`,
          status: 'RUNNING',
          spaceId: space,
          taskChainId: taskChainId,
          startedAt: new Date().toISOString()
        };
      }
      throw e;
    }
  }

  /**
   * Helper to fetch Task Chain Log
   */
  static async fetchTaskChainLog(url, tokenUrl, clientId, clientSecret, space, logId) {
    try {
      const accessToken = await this.getAccessToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const l = logId.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/logs/${s}/${l}`;

      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.sap.datasphere.task.log.details+json, application/json'
        }
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Task chain log request failed: ${res.status} ${res.statusText}. Response: ${errBody} [Endpoint: ${endpoint}]`);
      }

      return await res.json();
    } catch (e) {
      if (isMockUrl(url)) {
        const now = new Date();
        const start = new Date(now.getTime() - 5000);
        return {
          logId: logId,
          status: 'COMPLETED',
          spaceId: space,
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          startedAt: start.toISOString(),
          finishedAt: now.toISOString()
        };
      }
      throw e;
    }
  }
}

module.exports = BdcClient;
