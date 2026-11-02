'use strict';

/**
 * DatabricksClient & DatabricksHttpAdapter
 *
 * Pluggable driver for Databricks Unity Catalog and SQL Statement Execution API.
 * Provides real HTTP execution with Bearer PAT and OAuth M2M Service Principal tokens,
 * automatic fallback to DatabricksMockAdapter during testing and mock URLs,
 * and explicit adapter swapping via DatabricksClient.setAdapter(customAdapter).
 */

const { isMockUrl } = require('./urlUtils');
const DatabricksMockAdapter = require('./databricksMockAdapter');

// In-memory token cache for Databricks OAuth Service Principal tokens
const tokenCache = new Map();

/**
 * Standard HTTP Adapter calling Databricks REST and SQL Statement Execution APIs.
 */
class DatabricksHttpAdapter {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 60000;
    this.maxPollAttempts = options.maxPollAttempts || 30;
    this.pollIntervalMs = options.pollIntervalMs || 1000;
  }

  /**
   * Normalizes a workspace URL, ensuring https:// protocol and stripping trailing slashes.
   * @param {string} url
   * @returns {string}
   */
  normalizeWorkspaceUrl(url) {
    if (!url) return '';
    let clean = url.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }
    return clean.replace(/\/+$/, '');
  }

  /**
   * Retrieves an active authentication token.
   * Supports TOKEN (PAT) and SERVICE_PRINCIPAL (OAuth M2M) auth types.
   * @param {object} settings
   * @returns {Promise<string>}
   */
  async getAuthToken(settings = {}) {
    const authType = (settings.authType || 'TOKEN').toUpperCase();

    if (authType === 'TOKEN') {
      if (!settings.apiToken) {
        throw new Error('Databricks authentication failed: apiToken is required for TOKEN authType');
      }
      return settings.apiToken.trim();
    }

    if (authType === 'SERVICE_PRINCIPAL') {
      const { workspaceUrl, clientId, clientSecret } = settings;
      if (!clientId || !clientSecret) {
        throw new Error('Databricks authentication failed: clientId and clientSecret are required for SERVICE_PRINCIPAL authType');
      }

      const baseUrl = this.normalizeWorkspaceUrl(workspaceUrl);
      const cacheKey = `${baseUrl}::${clientId}`;
      const cached = tokenCache.get(cacheKey);
      const now = Date.now();

      if (cached && cached.expiresAt > now + 60000) {
        return cached.token;
      }

      const tokenEndpoint = `${baseUrl}/oidc/v1/token`;
      let accessToken = null;
      let expiresIn = 3600;

      // Method 1: Basic Authentication header with client_credentials
      try {
        const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'grant_type=client_credentials&scope=all-apis'
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
            accessToken = tokenData.access_token;
            expiresIn = tokenData.expires_in || expiresIn;
          }
        }
      } catch (err) {
        // Fall back to body parameters
      }

      // Method 2: Fall back to POST body parameters
      if (!accessToken) {
        const bodyParams = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'all-apis'
        });
        const tokenRes = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: bodyParams.toString()
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text().catch(() => '');
          throw new Error(`Databricks OAuth token request failed (${tokenRes.status}): ${errText || tokenRes.statusText}`);
        }

        const tokenData = await tokenRes.json();
        accessToken = tokenData.access_token;
        expiresIn = tokenData.expires_in || expiresIn;
      }

      if (!accessToken) {
        throw new Error('No access_token returned by Databricks OAuth endpoint');
      }

      tokenCache.set(cacheKey, {
        token: accessToken,
        expiresAt: now + (expiresIn * 1000)
      });

      return accessToken;
    }

    throw new Error(`Unsupported Databricks authType: '${authType}'`);
  }

  /**
   * Tests connection to Databricks workspace and optional SQL warehouse.
   * @param {object} settings
   * @returns {Promise<{ success: boolean, message: string, httpStatus: number, details?: object }>}
   */
  async testConnection(settings = {}) {
    const { workspaceUrl, sqlWarehouseId } = settings;

    if (!workspaceUrl) {
      return { success: false, message: 'Workspace URL is required', httpStatus: 400 };
    }

    try {
      const baseUrl = this.normalizeWorkspaceUrl(workspaceUrl);
      const token = await this.getAuthToken(settings);

      // If SQL warehouse ID is configured, test execution of 'SELECT 1'
      if (sqlWarehouseId) {
        const statementUrl = `${baseUrl}/api/2.0/sql/statements`;
        const res = await fetch(statementUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            warehouse_id: sqlWarehouseId,
            statement: 'SELECT 1',
            wait_timeout: '10s'
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.message || res.statusText || `HTTP ${res.status}`;
          return {
            success: false,
            message: `Databricks SQL Warehouse connection failed: ${errMsg}`,
            httpStatus: res.status
          };
        }

        const data = await res.json();
        const state = data.status?.state;
        if (state === 'FAILED') {
          return {
            success: false,
            message: `Databricks SQL Warehouse statement failed: ${data.status?.error?.message || 'Unknown error'}`,
            httpStatus: 400
          };
        }

        return {
          success: true,
          message: `Databricks workspace and SQL Warehouse connection verified successfully${settings.systemName ? ': ' + settings.systemName : ''}`,
          httpStatus: 200,
          details: {
            workspaceUrl: baseUrl,
            warehouseId: sqlWarehouseId,
            statementId: data.statement_id
          }
        };
      }

      // If no SQL warehouse ID is configured, test workspace API credentials
      const testEndpoint = `${baseUrl}/api/2.1/unity-catalog/catalogs`;
      const res = await fetch(testEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        // Fall back to testing SQL warehouses list
        const fallbackEndpoint = `${baseUrl}/api/2.0/sql/warehouses`;
        const fbRes = await fetch(fallbackEndpoint, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!fbRes.ok) {
          const errData = await fbRes.json().catch(() => ({}));
          return {
            success: false,
            message: `Databricks workspace connection failed: ${errData.message || fbRes.statusText}`,
            httpStatus: fbRes.status
          };
        }
      }

      return {
        success: true,
        message: `Databricks workspace connection verified successfully${settings.systemName ? ': ' + settings.systemName : ''}`,
        httpStatus: 200,
        details: { workspaceUrl: baseUrl }
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection test error: ${err.message}`,
        httpStatus: err.status || 500
      };
    }
  }

  /**
   * Executes a SQL statement via Databricks SQL Statement Execution API (POST /api/2.0/sql/statements).
   * Polls if wait_timeout expires before completion.
   * @param {object} params
   * @param {string} params.workspaceUrl
   * @param {string} [params.warehouseId]
   * @param {string} [params.sqlWarehouseId]
   * @param {string} params.statement
   * @param {string} [params.catalog]
   * @param {string} [params.schema]
   * @param {string} [params.waitTimeout='30s']
   * @param {boolean} [params.throwOnError=true]
   * @returns {Promise<{ statementId: string, statement_id: string, status: object, manifest: object, result: object }>}
   */
  async executeStatement(params = {}) {
    const {
      workspaceUrl,
      warehouseId,
      sqlWarehouseId,
      statement,
      catalog,
      schema,
      waitTimeout = '30s',
      throwOnError = true
    } = params;

    const targetWarehouseId = warehouseId || sqlWarehouseId;

    if (!workspaceUrl) {
      throw new Error('Databricks executeStatement failed: workspaceUrl is required');
    }
    if (!targetWarehouseId) {
      throw new Error('Databricks executeStatement failed: warehouseId is required');
    }
    if (!statement) {
      throw new Error('Databricks executeStatement failed: statement is required');
    }

    const baseUrl = this.normalizeWorkspaceUrl(workspaceUrl);
    const token = await this.getAuthToken(params);
    const endpoint = `${baseUrl}/api/2.0/sql/statements`;

    const requestBody = {
      warehouse_id: targetWarehouseId,
      statement,
      wait_timeout: waitTimeout,
      on_wait_timeout: 'CONTINUE'
    };

    if (catalog) requestBody.catalog = catalog;
    if (schema) requestBody.schema = schema;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.message || response.statusText || `HTTP ${response.status}`;
      const err = new Error(`Databricks SQL Execution HTTP ${response.status}: ${msg}`);
      err.status = response.status;
      err.details = errData;
      throw err;
    }

    let data = await response.json();
    let state = data.status?.state;

    // Polling if statement is still PENDING or RUNNING
    let pollCount = 0;
    while ((state === 'PENDING' || state === 'RUNNING') && pollCount < this.maxPollAttempts) {
      pollCount++;
      await new Promise(r => setTimeout(r, this.pollIntervalMs));

      const pollUrl = `${baseUrl}/api/2.0/sql/statements/${data.statement_id}`;
      const pollRes = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!pollRes.ok) {
        const errData = await pollRes.json().catch(() => ({}));
        throw new Error(`Databricks SQL Poll Error (${pollRes.status}): ${errData.message || pollRes.statusText}`);
      }

      data = await pollRes.json();
      state = data.status?.state;
    }

    if (state === 'FAILED' && throwOnError) {
      const errCode = data.status?.error?.error_code || 'ERROR';
      const errMsg = data.status?.error?.message || 'Statement execution failed';
      const err = new Error(`Databricks SQL Statement Execution Failed [${errCode}]: ${errMsg}`);
      err.status = 400;
      err.details = data.status?.error;
      throw err;
    }

    if ((state === 'PENDING' || state === 'RUNNING') && throwOnError) {
      const err = new Error(`Databricks SQL Statement execution timed out after ${pollCount} polling attempts (statement_id: ${data.statement_id})`);
      err.status = 504;
      throw err;
    }

    return {
      statementId: data.statement_id,
      statement_id: data.statement_id,
      status: data.status,
      manifest: data.manifest,
      result: data.result
    };
  }
}

/**
 * DatabricksClient facade.
 * Manages pluggable adapters, auto-mock resolution, and high-level execution.
 */
class DatabricksClient {
  static _adapter = null;
  static _defaultMockAdapter = null;
  static _defaultHttpAdapter = null;

  /**
   * Set custom adapter (e.g. test mock or spy).
   * Overrides all automatic adapter resolution while set.
   * @param {object} customAdapter
   */
  static setAdapter(customAdapter) {
    DatabricksClient._adapter = customAdapter;
  }

  /**
   * Resets active adapter back to automatic resolution.
   */
  static resetAdapter() {
    DatabricksClient._adapter = null;
  }

  /**
   * Returns the shared default mock adapter instance.
   * @returns {DatabricksMockAdapter}
   */
  static getMockAdapter() {
    if (!DatabricksClient._defaultMockAdapter) {
      DatabricksClient._defaultMockAdapter = new DatabricksMockAdapter();
    }
    return DatabricksClient._defaultMockAdapter;
  }

  /**
   * Returns true if running inside test runner or test profile.
   * @returns {boolean}
   */
  static isTestEnvironment() {
    return (
      process.env.CDS_ENV === 'test' ||
      process.env.NODE_ENV === 'test' ||
      (typeof process.execArgv !== 'undefined' && process.execArgv.includes('--test')) ||
      (process.argv && process.argv.some(arg => typeof arg === 'string' && arg.includes('test')))
    );
  }

  /**
   * Resolves the active adapter based on precedence:
   * 1. Explicit adapter set via setAdapter()
   * 2. Test environment (CDS_ENV === 'test' or NODE_ENV === 'test' or --test)
   * 3. Mock workspace URL (isMockUrl(workspaceUrl))
   * 4. Real HTTP adapter
   * @param {object} [options={}]
   * @returns {object}
   */
  static getAdapter(options = {}) {
    // 1. Explicit adapter override
    if (DatabricksClient._adapter) {
      return DatabricksClient._adapter;
    }

    // 2. Test environment
    if (DatabricksClient.isTestEnvironment()) {
      return DatabricksClient.getMockAdapter();
    }

    // 3. Mock workspace URL
    const url = options.workspaceUrl || (options.settings && options.settings.workspaceUrl);
    if (url && isMockUrl(url)) {
      return DatabricksClient.getMockAdapter();
    }

    // 4. Default to HTTP adapter
    if (!DatabricksClient._defaultHttpAdapter) {
      DatabricksClient._defaultHttpAdapter = new DatabricksHttpAdapter();
    }
    return DatabricksClient._defaultHttpAdapter;
  }

  /**
   * Executes a statement using the active adapter.
   * @param {object} statementConfig
   * @param {object} [settingsConfig={}]
   * @returns {Promise<object>}
   */
  static async executeStatement(statementConfig, settingsConfig = {}) {
    const mergedConfig = { ...settingsConfig, ...statementConfig };
    const adapter = DatabricksClient.getAdapter(mergedConfig);
    return adapter.executeStatement(mergedConfig);
  }

  /**
   * Tests connection to Databricks using the active adapter.
   * @param {object} settings
   * @returns {Promise<{ success: boolean, message: string, httpStatus: number, details?: object }>}
   */
  static async testConnection(settings) {
    const adapter = DatabricksClient.getAdapter(settings);
    return adapter.testConnection(settings);
  }
}

// Support both default object and destructuring require patterns
DatabricksClient.DatabricksClient = DatabricksClient;
DatabricksClient.DatabricksHttpAdapter = DatabricksHttpAdapter;
DatabricksClient.DatabricksMockAdapter = DatabricksMockAdapter;

module.exports = DatabricksClient;
