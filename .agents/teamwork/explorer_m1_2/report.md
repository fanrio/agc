# Architectural Design Report: Databricks Pluggable Client & Mock Adapter

**Milestone**: M1 - Data Model, Settings & Pluggable Driver  
**Component**: `srv/lib/databricksClient.js` & `srv/lib/databricksMockAdapter.js`  
**Author**: Explorer M1-2  
**Target Audience**: Worker (Implementation), Explorer M1-3 (OData Action Wiring), Sentinel (Review)

---

## 1. Executive Summary

To support Databricks Unity Catalog synchronization alongside SAP Datasphere without requiring active cloud infrastructure for test suites and local development, we establish a **pluggable driver architecture**:

1. **`DatabricksMockAdapter` (`srv/lib/databricksMockAdapter.js`)**:
   - In-memory simulation of Databricks SQL Statement Execution API and workspace connectivity.
   - Tracks executed statements (`executedStatements`), parsed filter functions (`filterFunctions`), applied row filters (`appliedRowFilters`), and connection test runs (`connectionTests`).
   - Supports failure simulation modes (`AUTH_FAIL`, `SQL_SYNTAX_ERROR`, `WAREHOUSE_UNAVAILABLE`, `TIMEOUT`, custom errors) and state reset (`reset()`).
2. **`DatabricksClient` & `DatabricksHttpAdapter` (`srv/lib/databricksClient.js`)**:
   - `DatabricksClient` provides a unified static interface (`executeStatement`, `testConnection`, `setAdapter`, `getAdapter`, `resetAdapter`, `getMockAdapter`).
   - **Auto-mocking**: Automatically resolves to `DatabricksMockAdapter` when:
     - `process.env.CDS_ENV === 'test'` or `process.env.NODE_ENV === 'test'` or running under `--test`.
     - `workspaceUrl` matches mock patterns via `urlUtils.isMockUrl` (`mock`, `test`, `localhost`, `sandbox`, etc.).
   - Explicit override via `DatabricksClient.setAdapter(customAdapter)` for fine-grained test isolation.
   - `DatabricksHttpAdapter` implements real cloud execution via Databricks REST API:
     - Authentication: Personal Access Tokens (`TOKEN`) and OAuth M2M Client Credentials (`SERVICE_PRINCIPAL`) with in-memory token caching.
     - Execution: Databricks SQL Statement Execution API (`POST /api/2.0/sql/statements`) with synchronous `wait_timeout` and status polling.

---

## 2. Component Design & Specifications

### 2.1 File Responsibilities & Architecture

```
srv/lib/
├── urlUtils.js                  # Shared mock URL detection (existing)
├── databricksMockAdapter.js     # In-memory mock adapter implementation
└── databricksClient.js          # Unified client facade + DatabricksHttpAdapter
```

### 2.2 Interface Contracts

#### `IDatabricksAdapter`
Both `DatabricksHttpAdapter` and `DatabricksMockAdapter` implement this interface:

- `executeStatement(params)`:
  - `params`: `{ workspaceUrl?, warehouseId|sqlWarehouseId, statement, catalog?, schema?, waitTimeout?, throwOnError? }`
  - Returns: `Promise<{ statementId: string, statement_id: string, status: { state: string, error?: object }, manifest: object, result: object }>`
- `testConnection(settings)`:
  - `settings`: `{ workspaceUrl, authType, apiToken?, clientId?, clientSecret?, sqlWarehouseId? }`
  - Returns: `Promise<{ success: boolean, message: string, httpStatus: number, details?: object }>`

#### `DatabricksMockAdapter` Inspection APIs
- `getExecutedStatements()`: Returns array of `{ warehouseId, statement, catalog, schema, timestamp }`.
- `filterFunctions`: `Map<string, { functionName, params, returnExpr, statement, catalog, schema, timestamp }>`.
- `appliedRowFilters`: `Map<string, { table, filterFunction, columns, statement, catalog, schema, timestamp }>`.
- `connectionTests`: Array of `{ settings, timestamp, result }`.
- `setFailureMode(mode)`: Sets simulated error mode (`'AUTH_FAIL'`, `'SQL_SYNTAX_ERROR'`, `'WAREHOUSE_UNAVAILABLE'`, `'TIMEOUT'`, or `null`).
- `reset()`: Resets all tracking collections and clears failure mode.
- `setStatementHandler(pattern, handler)`: Optional hook to return custom data for specific SQL queries.

#### `DatabricksClient` Facade
- `static setAdapter(adapter)`: Injects custom adapter (test spy/mock).
- `static resetAdapter()`: Clears custom adapter.
- `static getAdapter(options)`: Resolves active adapter (Explicit > Test Env > Mock URL > Real HTTP).
- `static getMockAdapter()`: Returns singleton default mock adapter instance.
- `static executeStatement(statementConfig, settingsConfig?)`: Executes SQL statement via active adapter.
- `static testConnection(settings)`: Tests connection via active adapter.

---

## 3. Concrete Implementation Code for Worker

### 3.1 `srv/lib/databricksMockAdapter.js`

```javascript
'use strict';

/**
 * DatabricksMockAdapter
 *
 * In-memory mock adapter for Databricks Unity Catalog and SQL Statement Execution.
 * Used for offline unit and integration tests without live cloud infrastructure.
 */

class DatabricksMockAdapter {
  constructor() {
    /** @type {Array<{ warehouseId: string, statement: string, catalog: ?string, schema: ?string, timestamp: string }>} */
    this.executedStatements = [];

    /** @type {Map<string, { functionName: string, params: string, returnExpr: string, statement: string, catalog: ?string, schema: ?string, timestamp: string }>} */
    this.filterFunctions = new Map();

    /** @type {Map<string, { table: string, filterFunction: string, columns: string[], statement: string, catalog: ?string, schema: ?string, timestamp: string }>} */
    this.appliedRowFilters = new Map();

    /** @type {Array<{ settings: object, timestamp: string, result: object }>} */
    this.connectionTests = [];

    /** @type {string|Error|null} */
    this.failureMode = null;

    /** @type {Map<string|RegExp, any>} */
    this.statementHandlers = new Map();
  }

  /**
   * Resets all in-memory tracking structures and clears failure mode.
   */
  reset() {
    this.executedStatements = [];
    this.filterFunctions.clear();
    this.appliedRowFilters.clear();
    this.connectionTests = [];
    this.failureMode = null;
    this.statementHandlers.clear();
  }

  /**
   * Sets the failure mode for testing error handling.
   * @param {string|Error|null} mode - 'AUTH_FAIL' | 'SQL_SYNTAX_ERROR' | 'WAREHOUSE_UNAVAILABLE' | 'TIMEOUT' | custom Error | null
   */
  setFailureMode(mode) {
    this.failureMode = mode;
  }

  /**
   * Returns a copy of all executed statement records.
   * @returns {Array<{ warehouseId: string, statement: string, catalog: ?string, schema: ?string, timestamp: string }>}
   */
  getExecutedStatements() {
    return [...this.executedStatements];
  }

  /**
   * Optional helper to register a custom result for specific SQL queries.
   * @param {string|RegExp} pattern
   * @param {object|Function} resultOrHandler
   */
  setStatementHandler(pattern, resultOrHandler) {
    this.statementHandlers.set(pattern, resultOrHandler);
  }

  /**
   * Cleans quotes or backticks from identifiers (e.g. `catalog`.`schema` -> catalog.schema)
   * @private
   */
  _cleanIdentifier(name) {
    if (!name) return '';
    return name.replace(/[`"]/g, '').trim();
  }

  /**
   * Inspects and parses SQL statements to update filterFunctions and appliedRowFilters state.
   * @private
   */
  _parseAndTrackStatement(statement, catalog, schema, timestamp) {
    const trimmed = (statement || '').trim();

    // 1. CREATE [OR REPLACE] FUNCTION [IF NOT EXISTS] <name>(<params>) RETURN <expr>
    const createFuncRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w\.\-]+)\s*\(([^)]*)\)\s*(?:RETURN\s+([\s\S]+))?/i;
    const createFuncMatch = trimmed.match(createFuncRegex);
    if (createFuncMatch) {
      const functionName = this._cleanIdentifier(createFuncMatch[1]);
      const params = (createFuncMatch[2] || '').trim();
      const returnExpr = (createFuncMatch[3] || '').trim();
      this.filterFunctions.set(functionName, {
        functionName,
        params,
        returnExpr,
        statement: trimmed,
        catalog: catalog || null,
        schema: schema || null,
        timestamp
      });
      return;
    }

    // 2. DROP FUNCTION [IF EXISTS] <name>
    const dropFuncRegex = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([`"\w\.\-]+)/i;
    const dropFuncMatch = trimmed.match(dropFuncRegex);
    if (dropFuncMatch) {
      const functionName = this._cleanIdentifier(dropFuncMatch[1]);
      this.filterFunctions.delete(functionName);
      return;
    }

    // 3. ALTER TABLE <name> SET ROW FILTER <func> ON (<columns>)
    const alterSetRegex = /ALTER\s+TABLE\s+([`"\w\.\-]+)\s+SET\s+ROW\s+FILTER\s+([`"\w\.\-]+)(?:\s+ON\s*\(([^)]*)\))?/i;
    const alterSetMatch = trimmed.match(alterSetRegex);
    if (alterSetMatch) {
      const table = this._cleanIdentifier(alterSetMatch[1]);
      const filterFunction = this._cleanIdentifier(alterSetMatch[2]);
      const columns = alterSetMatch[3]
        ? alterSetMatch[3].split(',').map(c => this._cleanIdentifier(c))
        : [];
      this.appliedRowFilters.set(table, {
        table,
        filterFunction,
        columns,
        statement: trimmed,
        catalog: catalog || null,
        schema: schema || null,
        timestamp
      });
      return;
    }

    // 4. ALTER TABLE <name> DROP ROW FILTER
    const alterDropRegex = /ALTER\s+TABLE\s+([`"\w\.\-]+)\s+DROP\s+ROW\s+FILTER/i;
    const alterDropMatch = trimmed.match(alterDropRegex);
    if (alterDropMatch) {
      const table = this._cleanIdentifier(alterDropMatch[1]);
      this.appliedRowFilters.delete(table);
      return;
    }
  }

  /**
   * Tests connection with mock credentials validation.
   * @param {object} settings
   * @returns {Promise<{ success: boolean, message: string, httpStatus: number, details?: object }>}
   */
  async testConnection(settings = {}) {
    const timestamp = new Date().toISOString();

    if (this.failureMode) {
      let result;
      if (this.failureMode === 'AUTH_FAIL') {
        result = {
          success: false,
          message: 'Authentication failed: Invalid Databricks access token or service principal credentials',
          httpStatus: 401
        };
      } else if (this.failureMode === 'WAREHOUSE_UNAVAILABLE') {
        result = {
          success: false,
          message: 'Databricks SQL Warehouse not available or stopped',
          httpStatus: 503
        };
      } else if (this.failureMode instanceof Error) {
        result = {
          success: false,
          message: this.failureMode.message,
          httpStatus: this.failureMode.status || 500
        };
      } else {
        result = {
          success: false,
          message: `Mock connection failure: ${this.failureMode}`,
          httpStatus: 400
        };
      }
      this.connectionTests.push({ settings, timestamp, result });
      return result;
    }

    const { workspaceUrl, authType, apiToken, clientId, clientSecret, sqlWarehouseId } = settings;

    if (!workspaceUrl) {
      const result = { success: false, message: 'Workspace URL is required', httpStatus: 400 };
      this.connectionTests.push({ settings, timestamp, result });
      return result;
    }

    if (authType === 'SERVICE_PRINCIPAL') {
      if (!clientId || !clientSecret) {
        const result = {
          success: false,
          message: 'Client ID and Client Secret are required for SERVICE_PRINCIPAL authentication',
          httpStatus: 400
        };
        this.connectionTests.push({ settings, timestamp, result });
        return result;
      }
    } else {
      // Default to TOKEN
      if (!apiToken) {
        const result = {
          success: false,
          message: 'API Token is required for TOKEN authentication',
          httpStatus: 400
        };
        this.connectionTests.push({ settings, timestamp, result });
        return result;
      }
    }

    const result = {
      success: true,
      message: 'Databricks connection verified successfully (Mock Mode)',
      httpStatus: 200,
      details: {
        workspaceUrl,
        authType: authType || 'TOKEN',
        sqlWarehouseId: sqlWarehouseId || 'mock-sql-warehouse',
        mocked: true,
        timestamp
      }
    };

    this.connectionTests.push({ settings, timestamp, result });
    return result;
  }

  /**
   * Executes a statement in mock mode, recording statement execution and metadata.
   * @param {object} params
   * @param {string} params.warehouseId
   * @param {string} params.statement
   * @param {string} [params.catalog]
   * @param {string} [params.schema]
   * @returns {Promise<{ statementId: string, statement_id: string, status: object, manifest: object, result: object }>}
   */
  async executeStatement({ warehouseId, statement, catalog, schema }) {
    const timestamp = new Date().toISOString();

    if (this.failureMode) {
      if (this.failureMode instanceof Error) {
        throw this.failureMode;
      }
      if (this.failureMode === 'AUTH_FAIL') {
        const err = new Error('Databricks API Error (401): Unauthorized access token or service principal');
        err.status = 401;
        throw err;
      }
      if (this.failureMode === 'SQL_SYNTAX_ERROR') {
        const err = new Error(`Databricks SQL Statement Execution Failed [PARSE_SYNTAX_ERROR]: Syntax error in '${statement}'`);
        err.status = 400;
        throw err;
      }
      if (this.failureMode === 'WAREHOUSE_UNAVAILABLE') {
        const err = new Error(`Databricks SQL Warehouse '${warehouseId}' is unavailable or stopped`);
        err.status = 503;
        throw err;
      }
      if (this.failureMode === 'TIMEOUT') {
        const err = new Error('Databricks statement execution timed out');
        err.status = 504;
        throw err;
      }
      throw new Error(`Databricks Mock Execution Failure: ${this.failureMode}`);
    }

    const record = {
      warehouseId: warehouseId || 'default-warehouse',
      statement: (statement || '').trim(),
      catalog: catalog || null,
      schema: schema || null,
      timestamp
    };
    this.executedStatements.push(record);

    // Parse and track Unity Catalog row filters and functions
    this._parseAndTrackStatement(statement, catalog, schema, timestamp);

    // Check custom statement handlers
    for (const [pattern, handler] of this.statementHandlers.entries()) {
      let matched = false;
      if (pattern instanceof RegExp && pattern.test(statement)) matched = true;
      if (typeof pattern === 'string' && statement.includes(pattern)) matched = true;
      if (matched) {
        if (typeof handler === 'function') {
          return handler({ warehouseId, statement, catalog, schema, record });
        }
        return handler;
      }
    }

    const statementId = `mock-stmt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return {
      statementId,
      statement_id: statementId,
      status: {
        state: 'SUCCEEDED'
      },
      manifest: {
        format: 'JSON_ARRAY',
        schema: {
          column_count: 1,
          columns: [{ name: 'result', type_text: 'STRING' }]
        },
        total_row_count: 0
      },
      result: {
        chunk_index: 0,
        row_offset: 0,
        row_count: 0,
        data_array: []
      }
    };
  }
}

module.exports = DatabricksMockAdapter;
```

---

### 3.2 `srv/lib/databricksClient.js`

```javascript
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
  async getAuthToken(settings) {
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
          message: 'Databricks workspace and SQL Warehouse connection verified successfully',
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
        message: 'Databricks workspace connection verified successfully',
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
      (process.argv && process.argv.some(arg => arg.includes('test')))
    );
  }

  /**
   * Resolves the active adapter based on precedence:
   * 1. Explicit adapter set via setAdapter()
   * 2. Test environment (CDS_ENV === 'test' or NODE_ENV === 'test')
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

module.exports = {
  DatabricksClient,
  DatabricksHttpAdapter,
  DatabricksMockAdapter
};
```

---

## 4. Usage Patterns & Integration Examples

### 4.1 In Service Actions (`testDatabricksConnection` for Explorer 3 & Worker)
```javascript
const { DatabricksClient } = require('./lib/databricksClient');

// Action handler in srv/cortex_service.js:
this.on('testDatabricksConnection', async (req) => {
  const { settingId } = req.data;
  const setting = await SELECT.one.from(DatabricksSettings).where({ ID: settingId });
  if (!setting) {
    return req.reject(404, `DatabricksSettings with ID '${settingId}' not found.`);
  }

  // DatabricksClient automatically selects mock or real HTTP based on environment or URL:
  const result = await DatabricksClient.testConnection(setting);
  return result;
});
```

### 4.2 In Databricks Policy Synchronization (`databricksSyncService.js` for Milestone 2)
```javascript
const { DatabricksClient } = require('../lib/databricksClient');

// When syncing row filter to Databricks:
await DatabricksClient.executeStatement({
  statement: `CREATE OR REPLACE FUNCTION ${funcName}(${columns}) RETURN ${filterSql};`,
  warehouseId: setting.sqlWarehouseId,
  catalog: setting.targetCatalog,
  schema: setting.targetSchema
}, setting);

await DatabricksClient.executeStatement({
  statement: `ALTER TABLE ${tableName} SET ROW FILTER ${funcName} ON (${columnList});`,
  warehouseId: setting.sqlWarehouseId,
  catalog: setting.targetCatalog,
  schema: setting.targetSchema
}, setting);
```

### 4.3 In Offline Test Suites (`test/databricks_client.test.js` or `test/backend_tests.test.js`)
```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DatabricksClient, DatabricksMockAdapter } = require('../srv/lib/databricksClient');

describe('Databricks Client & Mock Adapter', () => {
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = new DatabricksMockAdapter();
    DatabricksClient.setAdapter(mockAdapter);
  });

  it('records executed statements and parses row filter functions', async () => {
    await DatabricksClient.executeStatement({
      warehouseId: 'test-wh',
      statement: 'CREATE OR REPLACE FUNCTION dev.sales.fn_auth(user STRING) RETURN user = CURRENT_USER()',
      catalog: 'dev',
      schema: 'sales'
    });

    assert.strictEqual(mockAdapter.executedStatements.length, 1);
    assert.ok(mockAdapter.filterFunctions.has('dev.sales.fn_auth'));
  });

  it('records applied row filters on tables', async () => {
    await DatabricksClient.executeStatement({
      warehouseId: 'test-wh',
      statement: 'ALTER TABLE dev.sales.orders SET ROW FILTER dev.sales.fn_auth ON (created_by)',
      catalog: 'dev',
      schema: 'sales'
    });

    const filterInfo = mockAdapter.appliedRowFilters.get('dev.sales.orders');
    assert.ok(filterInfo);
    assert.strictEqual(filterInfo.filterFunction, 'dev.sales.fn_auth');
    assert.deepStrictEqual(filterInfo.columns, ['created_by']);
  });

  it('handles simulated failure modes in testConnection', async () => {
    mockAdapter.setFailureMode('AUTH_FAIL');
    const result = await DatabricksClient.testConnection({
      workspaceUrl: 'https://mock.databricks.com',
      authType: 'TOKEN',
      apiToken: 'invalid'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.httpStatus, 401);
  });
});
```

---

## 5. Verification Checklist for Sentinel and Worker

- [ ] `srv/lib/databricksMockAdapter.js` created and exports `DatabricksMockAdapter`.
- [ ] `srv/lib/databricksClient.js` created and exports `{ DatabricksClient, DatabricksHttpAdapter, DatabricksMockAdapter }`.
- [ ] `DatabricksClient.setAdapter()` and `resetAdapter()` allow full test-time dependency injection.
- [ ] Automated mock resolution checks `CDS_ENV === 'test'`, `NODE_ENV === 'test'`, `--test` arg, and `isMockUrl()`.
- [ ] `DatabricksMockAdapter` records `executedStatements`, `filterFunctions`, `appliedRowFilters`, `connectionTests`.
- [ ] `DatabricksMockAdapter.setFailureMode()` simulates 401/503/errors without unhandled crashes.
- [ ] `DatabricksHttpAdapter` formats `POST /api/2.0/sql/statements` with Bearer auth and handles OAuth M2M `/oidc/v1/token`.
- [ ] No regression on existing tests.
