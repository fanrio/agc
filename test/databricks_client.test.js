'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const DatabricksClient = require('../srv/lib/databricksClient');
const { DatabricksHttpAdapter, DatabricksMockAdapter } = DatabricksClient;

describe('Databricks Pluggable Client & Mock Adapter (Unit Tests)', () => {
  let mockAdapter;

  beforeEach(() => {
    DatabricksClient.resetAdapter();
    mockAdapter = new DatabricksMockAdapter();
  });

  describe('DatabricksMockAdapter DDL & Row Filter Parsing', () => {
    it('executes and records SQL statements in executedStatements', async () => {
      const res = await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'SELECT 1;',
        catalog: 'cat1',
        schema: 'sch1'
      });

      assert.ok(res.statementId);
      assert.strictEqual(res.status.state, 'SUCCEEDED');

      const stmts = mockAdapter.getExecutedStatements();
      assert.strictEqual(stmts.length, 1);
      assert.strictEqual(stmts[0].warehouseId, 'wh-test-01');
      assert.strictEqual(stmts[0].statement, 'SELECT 1;');
      assert.strictEqual(stmts[0].catalog, 'cat1');
      assert.strictEqual(stmts[0].schema, 'sch1');
      assert.ok(stmts[0].timestamp);
    });

    it('parses CREATE FUNCTION into filterFunctions map', async () => {
      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'CREATE OR REPLACE FUNCTION main.sales.rls_filter(country STRING) RETURN country = "DE"',
        catalog: 'main',
        schema: 'sales'
      });

      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      const fn = mockAdapter.filterFunctions.get('main.sales.rls_filter');
      assert.ok(fn);
      assert.strictEqual(fn.functionName, 'main.sales.rls_filter');
      assert.strictEqual(fn.params, 'country STRING');
      assert.strictEqual(fn.returnExpr, 'country = "DE"');
      assert.strictEqual(fn.catalog, 'main');
      assert.strictEqual(fn.schema, 'sales');
    });

    it('parses DROP FUNCTION and removes from filterFunctions map', async () => {
      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'CREATE OR REPLACE FUNCTION main.sales.old_filter() RETURN TRUE'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'DROP FUNCTION IF EXISTS main.sales.old_filter'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
    });

    it('parses ALTER TABLE SET ROW FILTER into appliedRowFilters map', async () => {
      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'ALTER TABLE `main`.`sales`.`orders` SET ROW FILTER `main`.`sales`.`rls_filter` ON (country, region)',
        catalog: 'main',
        schema: 'sales'
      });

      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
      const filter = mockAdapter.appliedRowFilters.get('main.sales.orders');
      assert.ok(filter);
      assert.strictEqual(filter.table, 'main.sales.orders');
      assert.strictEqual(filter.filterFunction, 'main.sales.rls_filter');
      assert.deepStrictEqual(filter.columns, ['country', 'region']);
    });

    it('parses ALTER TABLE DROP ROW FILTER and removes from appliedRowFilters map', async () => {
      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'ALTER TABLE main.sales.orders SET ROW FILTER main.sales.rls_filter ON (country)'
      });
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);

      await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'ALTER TABLE main.sales.orders DROP ROW FILTER'
      });
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
    });

    it('supports custom statement handlers via setStatementHandler', async () => {
      mockAdapter.setStatementHandler('SHOW TABLES', () => ({
        statementId: 'custom-show',
        status: { state: 'SUCCEEDED' },
        result: { data_array: [['orders'], ['customers']] }
      }));

      const res = await mockAdapter.executeStatement({
        warehouseId: 'wh-test-01',
        statement: 'SHOW TABLES IN main.sales;'
      });
      assert.strictEqual(res.statementId, 'custom-show');
      assert.strictEqual(res.result.data_array.length, 2);
    });
  });

  describe('DatabricksMockAdapter Connection Testing', () => {
    it('verifies connection with valid TOKEN settings', async () => {
      const res = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'dapi12345',
        systemName: 'Dev DBX'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.httpStatus, 200);
      assert.ok(res.message.includes('Dev DBX'));
      assert.strictEqual(mockAdapter.connectionTests.length, 1);
    });

    it('verifies connection with valid SERVICE_PRINCIPAL settings', async () => {
      const res = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'SERVICE_PRINCIPAL',
        clientId: 'sp-id',
        clientSecret: 'sp-secret'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.httpStatus, 200);
      assert.strictEqual(res.details.authType, 'SERVICE_PRINCIPAL');
    });

    it('fails when workspaceUrl is missing', async () => {
      const res = await mockAdapter.testConnection({
        authType: 'TOKEN',
        apiToken: 'dapi123'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('Workspace URL is required'));
    });

    it('fails when apiToken is missing for TOKEN auth', async () => {
      const res = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('API Token is required'));
    });

    it('fails when clientId or clientSecret is missing for SERVICE_PRINCIPAL auth', async () => {
      const res = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'SERVICE_PRINCIPAL',
        clientId: 'sp-id'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('Client ID and Client Secret are required'));
    });
  });

  describe('Failure Mode Injection & Reset', () => {
    it('simulates AUTH_FAIL mode in testConnection and executeStatement', async () => {
      mockAdapter.setFailureMode('AUTH_FAIL');

      const testRes = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'valid-token'
      });
      assert.strictEqual(testRes.success, false);
      assert.strictEqual(testRes.httpStatus, 401);

      await assert.rejects(
        () => mockAdapter.executeStatement({ statement: 'SELECT 1;' }),
        err => err.status === 401 && err.message.includes('401')
      );
    });

    it('simulates SQL_SYNTAX_ERROR in executeStatement', async () => {
      mockAdapter.setFailureMode('SQL_SYNTAX_ERROR');

      await assert.rejects(
        () => mockAdapter.executeStatement({ statement: 'SELECT INVALID' }),
        err => err.status === 400 && err.message.includes('PARSE_SYNTAX_ERROR')
      );
    });

    it('simulates WAREHOUSE_UNAVAILABLE in testConnection and executeStatement', async () => {
      mockAdapter.setFailureMode('WAREHOUSE_UNAVAILABLE');

      const testRes = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'valid-token'
      });
      assert.strictEqual(testRes.success, false);
      assert.strictEqual(testRes.httpStatus, 503);

      await assert.rejects(
        () => mockAdapter.executeStatement({ warehouseId: 'wh-down', statement: 'SELECT 1;' }),
        err => err.status === 503 && err.message.includes('wh-down')
      );
    });

    it('simulates TIMEOUT and NETWORK_ERROR modes', async () => {
      mockAdapter.setFailureMode('TIMEOUT');
      await assert.rejects(
        () => mockAdapter.executeStatement({ statement: 'SELECT 1;' }),
        err => err.status === 504 && err.message.includes('timed out')
      );

      mockAdapter.setFailureMode('NETWORK_ERROR');
      const testRes = await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'valid-token'
      });
      assert.strictEqual(testRes.httpStatus, 502);
    });

    it('clears all collections and failure mode on reset()', async () => {
      await mockAdapter.executeStatement({
        warehouseId: 'wh-1',
        statement: 'CREATE FUNCTION test() RETURN 1'
      });
      mockAdapter.setFailureMode('AUTH_FAIL');

      assert.strictEqual(mockAdapter.executedStatements.length, 1);
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      assert.strictEqual(mockAdapter.failureMode, 'AUTH_FAIL');

      mockAdapter.reset();

      assert.strictEqual(mockAdapter.executedStatements.length, 0);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
      assert.strictEqual(mockAdapter.connectionTests.length, 0);
      assert.strictEqual(mockAdapter.failureMode, null);
    });
  });

  describe('DatabricksClient Facade & Adapter Resolution', () => {
    it('allows explicit adapter injection via setAdapter and resetAdapter', () => {
      const customSpy = {
        executeStatement: async () => ({ statementId: 'spy-stmt' }),
        testConnection: async () => ({ success: true, message: 'spy-ok' })
      };

      DatabricksClient.setAdapter(customSpy);
      assert.strictEqual(DatabricksClient.getAdapter(), customSpy);

      DatabricksClient.resetAdapter();
      assert.notStrictEqual(DatabricksClient.getAdapter(), customSpy);
    });

    it('automatically resolves to DatabricksMockAdapter in test environment', () => {
      assert.strictEqual(DatabricksClient.isTestEnvironment(), true);
      const adapter = DatabricksClient.getAdapter();
      assert.ok(adapter instanceof DatabricksMockAdapter);
    });

    it('automatically resolves to DatabricksMockAdapter for mock URLs', () => {
      const adapter = DatabricksClient.getAdapter({ workspaceUrl: 'https://mock-workspace.databricks.net' });
      assert.ok(adapter instanceof DatabricksMockAdapter);
    });

    it('delegates executeStatement and testConnection to active adapter', async () => {
      DatabricksClient.setAdapter(mockAdapter);

      const testRes = await DatabricksClient.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'token123'
      });
      assert.strictEqual(testRes.success, true);
      assert.strictEqual(mockAdapter.connectionTests.length, 1);

      const execRes = await DatabricksClient.executeStatement({
        warehouseId: 'wh-client',
        statement: 'SELECT 42;'
      });
      assert.ok(execRes.statementId);
      assert.strictEqual(mockAdapter.executedStatements.length, 1);
    });
  });

  describe('DatabricksHttpAdapter Utilities', () => {
    const httpAdapter = new DatabricksHttpAdapter();

    it('normalizes workspace URL with protocol and no trailing slash', () => {
      assert.strictEqual(httpAdapter.normalizeWorkspaceUrl('adb-123.azuredatabricks.net'), 'https://adb-123.azuredatabricks.net');
      assert.strictEqual(httpAdapter.normalizeWorkspaceUrl('https://my-workspace.databricks.com///'), 'https://my-workspace.databricks.com');
      assert.strictEqual(httpAdapter.normalizeWorkspaceUrl('http://localhost:8080/'), 'http://localhost:8080');
      assert.strictEqual(httpAdapter.normalizeWorkspaceUrl(''), '');
    });

    it('retrieves TOKEN correctly', async () => {
      const token = await httpAdapter.getAuthToken({ authType: 'TOKEN', apiToken: ' dapi_secret_pat ' });
      assert.strictEqual(token, 'dapi_secret_pat');
    });

    it('throws when apiToken is missing for TOKEN auth', async () => {
      await assert.rejects(
        () => httpAdapter.getAuthToken({ authType: 'TOKEN' }),
        err => err.message.includes('apiToken is required')
      );
    });

    it('throws when clientId or clientSecret is missing for SERVICE_PRINCIPAL auth', async () => {
      await assert.rejects(
        () => httpAdapter.getAuthToken({ authType: 'SERVICE_PRINCIPAL', clientId: 'cid' }),
        err => err.message.includes('clientId and clientSecret are required')
      );
    });
  });
});
