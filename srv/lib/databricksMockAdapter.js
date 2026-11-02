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
   * @param {string|Error|null} mode - 'AUTH_FAIL' | 'AUTH_FAILED' | 'SQL_SYNTAX_ERROR' | 'WAREHOUSE_UNAVAILABLE' | 'TIMEOUT' | 'NETWORK_ERROR' | custom Error | null
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
      if (this.failureMode === 'AUTH_FAIL' || this.failureMode === 'AUTH_FAILED') {
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
      } else if (this.failureMode === 'NETWORK_ERROR') {
        result = {
          success: false,
          message: 'Network error connecting to Databricks workspace',
          httpStatus: 502
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
      message: `Databricks connection verified successfully (Mock Mode${settings.systemName ? ': ' + settings.systemName : ''})`,
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
   * @param {string} [params.warehouseId]
   * @param {string} [params.sqlWarehouseId]
   * @param {string} params.statement
   * @param {string} [params.catalog]
   * @param {string} [params.schema]
   * @returns {Promise<{ statementId: string, statement_id: string, status: object, manifest: object, result: object }>}
   */
  async executeStatement({ warehouseId, sqlWarehouseId, statement, catalog, schema }) {
    const timestamp = new Date().toISOString();
    const effectiveWarehouseId = warehouseId || sqlWarehouseId || 'default-warehouse';

    if (this.failureMode) {
      if (this.failureMode instanceof Error) {
        throw this.failureMode;
      }
      if (this.failureMode === 'AUTH_FAIL' || this.failureMode === 'AUTH_FAILED') {
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
        const err = new Error(`Databricks SQL Warehouse '${effectiveWarehouseId}' is unavailable or stopped`);
        err.status = 503;
        throw err;
      }
      if (this.failureMode === 'TIMEOUT') {
        const err = new Error('Databricks statement execution timed out');
        err.status = 504;
        throw err;
      }
      if (this.failureMode === 'NETWORK_ERROR') {
        const err = new Error('Network error executing Databricks statement');
        err.status = 502;
        throw err;
      }
      throw new Error(`Databricks Mock Execution Failure: ${this.failureMode}`);
    }

    const record = {
      warehouseId: effectiveWarehouseId,
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
          return handler({ warehouseId: effectiveWarehouseId, statement, catalog, schema, record });
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
