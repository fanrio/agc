'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const DatabricksClient = require('../srv/lib/databricksClient');
const { DatabricksHttpAdapter, DatabricksMockAdapter } = DatabricksClient;

describe('Databricks Stress & Adversarial Verification Harness', () => {
  let mockAdapter;

  beforeEach(() => {
    DatabricksClient.resetAdapter();
    mockAdapter = new DatabricksMockAdapter();
  });

  // =========================================================================
  // 1. CONCURRENT EXECUTION STRESS TESTS
  // =========================================================================
  describe('1. Concurrency & High-Throughput Stress', () => {
    it('handles 100 concurrent executeStatement calls without dropped records or ID collisions', async () => {
      const concurrency = 100;
      const tasks = Array.from({ length: concurrency }, (_, i) => {
        return mockAdapter.executeStatement({
          warehouseId: `wh-${i % 5}`,
          statement: `SELECT ${i} AS val;`,
          catalog: 'analytics',
          schema: `tenant_${i % 10}`
        });
      });

      const results = await Promise.all(tasks);

      // Verify all results returned successfully
      assert.strictEqual(results.length, concurrency);
      const statementIds = new Set();
      for (const res of results) {
        assert.ok(res.statementId, 'Result must contain statementId');
        assert.strictEqual(res.status.state, 'SUCCEEDED');
        statementIds.add(res.statementId);
      }

      // Assert zero collisions in statement IDs
      assert.strictEqual(statementIds.size, concurrency, 'All concurrent statement IDs must be strictly unique');

      // Assert adapter store tracked all 100 statements
      const tracked = mockAdapter.getExecutedStatements();
      assert.strictEqual(tracked.length, concurrency, 'Adapter must track all concurrent statements');
    });

    it('handles 100 concurrent testConnection calls with mixed valid credentials', async () => {
      const concurrency = 100;
      const tasks = Array.from({ length: concurrency }, (_, i) => {
        const isSp = i % 2 === 0;
        return mockAdapter.testConnection(isSp ? {
          workspaceUrl: `https://mock-workspace-${i}.databricks.com`,
          authType: 'SERVICE_PRINCIPAL',
          clientId: `client-${i}`,
          clientSecret: `secret-${i}`,
          systemName: `Sys-${i}`
        } : {
          workspaceUrl: `https://mock-workspace-${i}.databricks.com`,
          authType: 'TOKEN',
          apiToken: `dapi_token_${i}`,
          systemName: `Sys-${i}`
        });
      });

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, concurrency);
      for (const res of results) {
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.httpStatus, 200);
      }
      assert.strictEqual(mockAdapter.connectionTests.length, concurrency);
    });

    it('handles concurrent interleaved DDL statements (CREATE, ALTER, DROP) with consistent state', async () => {
      const operations = [];

      // 20 function creations
      for (let i = 0; i < 20; i++) {
        operations.push(mockAdapter.executeStatement({
          statement: `CREATE OR REPLACE FUNCTION main.sch.func_${i}(id STRING) RETURN id = "${i}"`
        }));
      }

      // 20 table row filter attachments
      for (let i = 0; i < 20; i++) {
        operations.push(mockAdapter.executeStatement({
          statement: `ALTER TABLE main.sch.table_${i} SET ROW FILTER main.sch.func_${i} ON (col_${i})`
        }));
      }

      await Promise.all(operations);

      assert.strictEqual(mockAdapter.filterFunctions.size, 20);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 20);
      assert.strictEqual(mockAdapter.executedStatements.length, 40);

      // Now run 10 drops concurrently
      const dropOps = [];
      for (let i = 0; i < 10; i++) {
        dropOps.push(mockAdapter.executeStatement({
          statement: `DROP FUNCTION IF EXISTS main.sch.func_${i}`
        }));
        dropOps.push(mockAdapter.executeStatement({
          statement: `ALTER TABLE main.sch.table_${i} DROP ROW FILTER`
        }));
      }

      await Promise.all(dropOps);

      assert.strictEqual(mockAdapter.filterFunctions.size, 10);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 10);
      assert.strictEqual(mockAdapter.executedStatements.length, 60);

      // Verify surviving items are 10..19
      for (let i = 10; i < 20; i++) {
        assert.ok(mockAdapter.filterFunctions.has(`main.sch.func_${i}`));
        assert.ok(mockAdapter.appliedRowFilters.has(`main.sch.table_${i}`));
      }
    });

    it('handles concurrent statement execution with custom statement handlers', async () => {
      mockAdapter.setStatementHandler(/SELECT\s+count\(\*\)/i, ({ statement }) => ({
        statementId: 'mock-count',
        status: { state: 'SUCCEEDED' },
        result: { data_array: [[42]] }
      }));

      mockAdapter.setStatementHandler('SHOW SCHEMAS', () => ({
        statementId: 'mock-schemas',
        status: { state: 'SUCCEEDED' },
        result: { data_array: [['sales'], ['marketing'], ['finance']] }
      }));

      const queries = [
        'SELECT count(*) FROM table1',
        'SHOW SCHEMAS IN catalog1',
        'SELECT count(*) FROM table2',
        'SHOW SCHEMAS IN catalog2',
        'SELECT 1;' // default handler
      ];

      const results = await Promise.all(queries.map(q => mockAdapter.executeStatement({ statement: q })));

      assert.strictEqual(results[0].statementId, 'mock-count');
      assert.deepStrictEqual(results[0].result.data_array, [[42]]);
      assert.strictEqual(results[1].statementId, 'mock-schemas');
      assert.deepStrictEqual(results[1].result.data_array, [['sales'], ['marketing'], ['finance']]);
      assert.strictEqual(results[2].statementId, 'mock-count');
      assert.strictEqual(results[3].statementId, 'mock-schemas');
      assert.ok(results[4].statementId.startsWith('mock-stmt-'));
      assert.strictEqual(mockAdapter.executedStatements.length, 5);
    });
  });

  // =========================================================================
  // 2. SQL DDL PARSING ADVERSARIAL STRESS TESTS
  // =========================================================================
  describe('2. SQL DDL Parsing Edge Cases & Robustness', () => {
    it('parses DDL with irregular casing, excessive whitespace, tabs and newlines', async () => {
      const weirdSql = `
        cReAtE     OR   
        rEpLaCe 
        FUNCTION 
        if  not   exists   
        main.sales.weird_casing(  country   STRING ,   region  STRING  )   
        ReTuRn   
        (country = 'DE' AND region = 'EMEA') ;
      `;

      await mockAdapter.executeStatement({ statement: weirdSql });

      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      const fn = mockAdapter.filterFunctions.get('main.sales.weird_casing');
      assert.ok(fn, 'Must find parsed function despite irregular casing and whitespace');
      assert.strictEqual(fn.functionName, 'main.sales.weird_casing');
      assert.strictEqual(fn.params, 'country   STRING ,   region  STRING');
      assert.ok(fn.returnExpr.includes("(country = 'DE' AND region = 'EMEA')"));
    });

    it('parses DDL with backtick quotes on catalogs, schemas, tables and functions', async () => {
      const sqlFunc = 'CREATE OR REPLACE FUNCTION `catalog_01`.`schema_02`.`func_03`(`arg` STRING) RETURN `arg` = "X"';
      await mockAdapter.executeStatement({ statement: sqlFunc });

      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      assert.ok(mockAdapter.filterFunctions.has('catalog_01.schema_02.func_03'));

      const sqlAlter = 'ALTER TABLE `catalog_01`.`schema_02`.`table_04` SET ROW FILTER `catalog_01`.`schema_02`.`func_03` ON (`arg`, `other_col`)';
      await mockAdapter.executeStatement({ statement: sqlAlter });

      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
      const filter = mockAdapter.appliedRowFilters.get('catalog_01.schema_02.table_04');
      assert.ok(filter);
      assert.strictEqual(filter.table, 'catalog_01.schema_02.table_04');
      assert.strictEqual(filter.filterFunction, 'catalog_01.schema_02.func_03');
      assert.deepStrictEqual(filter.columns, ['arg', 'other_col']);
    });

    it('parses ALTER TABLE DROP ROW FILTER with backticks and irregular whitespace', async () => {
      await mockAdapter.executeStatement({
        statement: 'ALTER TABLE `cat`.`sch`.`tbl` SET ROW FILTER `cat`.`sch`.`fn` ON (col)'
      });
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);

      await mockAdapter.executeStatement({
        statement: '  aLtEr   TaBlE   `cat`.`sch`.`tbl`   DrOp   RoW   FiLtEr  ; '
      });
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0, 'Must cleanly drop row filter');
    });

    it('handles statements with leading and inline comments', async () => {
      const sqlWithComments = `
        -- Header comment: authorization row-level security policy
        /* Multi-line comment block
           author: security-admin */
        CREATE OR REPLACE FUNCTION cat.sec.rls_comment_test(user_name STRING)
        RETURN user_name = CURRENT_USER();
      `;

      await mockAdapter.executeStatement({ statement: sqlWithComments });

      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      const fn = mockAdapter.filterFunctions.get('cat.sec.rls_comment_test');
      assert.ok(fn, 'Must find function even with leading comments');
      assert.strictEqual(fn.functionName, 'cat.sec.rls_comment_test');
      assert.strictEqual(fn.params, 'user_name STRING');
      assert.ok(fn.returnExpr.includes('CURRENT_USER()'));
    });

    it('parses complex Unity Catalog return expressions (CASE, subqueries, complex boolean logic)', async () => {
      const complexSql = `
        CREATE OR REPLACE FUNCTION main.governance.rls_matrix(department STRING, cost_center STRING)
        RETURN
          CASE
            WHEN IS_ACCOUNT_GROUP_MEMBER('admin_group') THEN TRUE
            WHEN department IN ('Finance', 'Controlling') AND cost_center LIKE 'CC-%' THEN TRUE
            ELSE (cost_center = 'CC-DEFAULT')
          END
      `;

      await mockAdapter.executeStatement({ statement: complexSql });

      const fn = mockAdapter.filterFunctions.get('main.governance.rls_matrix');
      assert.ok(fn);
      assert.strictEqual(fn.params, 'department STRING, cost_center STRING');
      assert.ok(fn.returnExpr.includes("IS_ACCOUNT_GROUP_MEMBER('admin_group')"));
      assert.ok(fn.returnExpr.includes("cost_center = 'CC-DEFAULT'"));
    });

    it('handles DROP FUNCTION with or without IF EXISTS and with backticks', async () => {
      await mockAdapter.executeStatement({
        statement: 'CREATE FUNCTION `cat`.`sch`.`my_fn`() RETURN 1'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      await mockAdapter.executeStatement({
        statement: 'DROP FUNCTION `cat`.`sch`.`my_fn`'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);

      // Re-create and drop with IF EXISTS
      await mockAdapter.executeStatement({
        statement: 'CREATE FUNCTION `cat`.`sch`.`my_fn`() RETURN 1'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      await mockAdapter.executeStatement({
        statement: 'drop function if exists `cat`.`sch`.`my_fn`;'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
    });

    it('handles non-DDL queries without throwing or modifying filter maps', async () => {
      const queries = [
        'SELECT * FROM main.sales.orders LIMIT 10;',
        'DESCRIBE TABLE EXTENDED main.sales.orders;',
        'SHOW TABLES IN main.sales;',
        'GRANT SELECT ON TABLE main.sales.orders TO `finance_team`;',
        'REVOKE ALL PRIVILEGES ON CATALOG main FROM `bad_actor`;'
      ];

      for (const q of queries) {
        const res = await mockAdapter.executeStatement({ statement: q });
        assert.ok(res.statementId);
        assert.strictEqual(res.status.state, 'SUCCEEDED');
      }

      assert.strictEqual(mockAdapter.executedStatements.length, 5);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
    });
  });

  // =========================================================================
  // 3. FAILURE MODE INJECTION & EXCEPTION PROPAGATION
  // =========================================================================
  describe('3. Failure Mode Injection & Clean Exception Propagation', () => {
    it('propagates AUTH_FAILED (401) cleanly through mock adapter and DatabricksClient facade', async () => {
      mockAdapter.setFailureMode('AUTH_FAILED');
      DatabricksClient.setAdapter(mockAdapter);

      // testConnection returns error object
      const connRes = await DatabricksClient.testConnection({
        workspaceUrl: 'https://test.databricks.com',
        authType: 'TOKEN',
        apiToken: 'any-token'
      });
      assert.strictEqual(connRes.success, false);
      assert.strictEqual(connRes.httpStatus, 401);
      assert.ok(connRes.message.includes('Authentication failed'));

      // executeStatement throws error with status 401
      await assert.rejects(
        () => DatabricksClient.executeStatement({ statement: 'SELECT 1;' }),
        err => {
          assert.strictEqual(err.status, 401);
          assert.ok(err.message.includes('401'));
          assert.ok(err.message.includes('Unauthorized'));
          return true;
        }
      );
    });

    it('propagates NETWORK_ERROR (502) cleanly through mock adapter and DatabricksClient facade', async () => {
      mockAdapter.setFailureMode('NETWORK_ERROR');
      DatabricksClient.setAdapter(mockAdapter);

      const connRes = await DatabricksClient.testConnection({
        workspaceUrl: 'https://test.databricks.com',
        authType: 'TOKEN',
        apiToken: 'tok'
      });
      assert.strictEqual(connRes.success, false);
      assert.strictEqual(connRes.httpStatus, 502);
      assert.ok(connRes.message.includes('Network error'));

      await assert.rejects(
        () => DatabricksClient.executeStatement({ statement: 'SELECT 1;' }),
        err => {
          assert.strictEqual(err.status, 502);
          assert.ok(err.message.includes('Network error'));
          return true;
        }
      );
    });

    it('propagates custom Error instances with preserved properties and stack trace', async () => {
      class CustomDatabricksQuotaExceededError extends Error {
        constructor(msg) {
          super(msg);
          this.name = 'CustomDatabricksQuotaExceededError';
          this.status = 429;
          this.retryAfter = 60;
          this.errorCode = 'DATABRICKS_RATE_LIMITED';
        }
      }

      const customError = new CustomDatabricksQuotaExceededError('Rate limit exceeded: 500 requests per minute');
      mockAdapter.setFailureMode(customError);
      DatabricksClient.setAdapter(mockAdapter);

      // testConnection
      const connRes = await DatabricksClient.testConnection({
        workspaceUrl: 'https://test.databricks.com',
        authType: 'TOKEN',
        apiToken: 'tok'
      });
      assert.strictEqual(connRes.success, false);
      assert.strictEqual(connRes.httpStatus, 429);
      assert.ok(connRes.message.includes('Rate limit exceeded'));

      // executeStatement
      await assert.rejects(
        () => DatabricksClient.executeStatement({ statement: 'SELECT 1;' }),
        err => {
          assert.strictEqual(err, customError, 'Must propagate the exact custom error instance');
          assert.strictEqual(err.status, 429);
          assert.strictEqual(err.retryAfter, 60);
          assert.strictEqual(err.errorCode, 'DATABRICKS_RATE_LIMITED');
          assert.ok(err.stack);
          return true;
        }
      );
    });

    it('propagates unknown string failure modes without unhandled crashes', async () => {
      mockAdapter.setFailureMode('RANDOM_CHAOS_EVENT');
      DatabricksClient.setAdapter(mockAdapter);

      const connRes = await DatabricksClient.testConnection({
        workspaceUrl: 'https://test.databricks.com',
        authType: 'TOKEN',
        apiToken: 'tok'
      });
      assert.strictEqual(connRes.success, false);
      assert.strictEqual(connRes.httpStatus, 400);
      assert.ok(connRes.message.includes('RANDOM_CHAOS_EVENT'));

      await assert.rejects(
        () => DatabricksClient.executeStatement({ statement: 'SELECT 1;' }),
        err => {
          assert.ok(err.message.includes('RANDOM_CHAOS_EVENT'));
          return true;
        }
      );
    });

    it('resumes normal operation immediately after clearing failureMode', async () => {
      mockAdapter.setFailureMode('AUTH_FAILED');
      await assert.rejects(() => mockAdapter.executeStatement({ statement: 'SELECT 1;' }));

      mockAdapter.setFailureMode(null);

      const res = await mockAdapter.executeStatement({ statement: 'SELECT 1;' });
      assert.strictEqual(res.status.state, 'SUCCEEDED');
    });
  });

  // =========================================================================
  // 4. RESET, STATE POLLUTION & MEMORY INTEGRITY
  // =========================================================================
  describe('4. Reset, State Pollution & Memory Isolation', () => {
    it('completely purges all state collections, failure mode, and statement handlers on reset()', async () => {
      // 1. Populate executedStatements
      for (let i = 0; i < 50; i++) {
        await mockAdapter.executeStatement({ statement: `SELECT ${i}` });
      }
      assert.strictEqual(mockAdapter.executedStatements.length, 50);

      // 2. Populate filterFunctions and appliedRowFilters
      await mockAdapter.executeStatement({
        statement: 'CREATE FUNCTION main.sch.test_fn() RETURN TRUE'
      });
      await mockAdapter.executeStatement({
        statement: 'ALTER TABLE main.sch.test_tbl SET ROW FILTER main.sch.test_fn ON (col)'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);

      // 3. Populate connectionTests
      await mockAdapter.testConnection({
        workspaceUrl: 'https://mock.databricks.com',
        authType: 'TOKEN',
        apiToken: 'tok'
      });
      assert.strictEqual(mockAdapter.connectionTests.length, 1);

      // 4. Set failureMode and custom statementHandlers
      mockAdapter.setFailureMode('TIMEOUT');
      mockAdapter.setStatementHandler('CUSTOM', { data: 123 });
      assert.strictEqual(mockAdapter.failureMode, 'TIMEOUT');
      assert.strictEqual(mockAdapter.statementHandlers.size, 1);

      // PERFORM RESET
      mockAdapter.reset();

      // Verify complete purge
      assert.strictEqual(mockAdapter.executedStatements.length, 0);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
      assert.strictEqual(mockAdapter.connectionTests.length, 0);
      assert.strictEqual(mockAdapter.failureMode, null);
      assert.strictEqual(mockAdapter.statementHandlers.size, 0);

      // Verify that subsequent operations start from clean slate
      const cleanRes = await mockAdapter.executeStatement({ statement: 'SELECT 100;' });
      assert.strictEqual(cleanRes.status.state, 'SUCCEEDED');
      assert.strictEqual(mockAdapter.executedStatements.length, 1);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);
    });

    it('verifies that getExecutedStatements() returns a defensive shallow copy', async () => {
      await mockAdapter.executeStatement({ statement: 'SELECT 1;' });
      const copy = mockAdapter.getExecutedStatements();
      assert.strictEqual(copy.length, 1);

      // Mutating the returned array must NOT mutate adapter internal store
      copy.push({ statement: 'CORRUPTED' });
      assert.strictEqual(copy.length, 2);
      assert.strictEqual(mockAdapter.executedStatements.length, 1, 'Internal store must remain unpolluted');
    });

    it('empirically probes case-insensitivity of function and table identifiers', async () => {
      // Test whether CREATE in uppercase and DROP in lowercase work as expected in SQL
      await mockAdapter.executeStatement({
        statement: 'CREATE OR REPLACE FUNCTION MAIN.SALES.UPPER_FN(val STRING) RETURN val = "A"'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      // Probe: Does DROP with matching casing remove it?
      await mockAdapter.executeStatement({
        statement: 'DROP FUNCTION IF EXISTS MAIN.SALES.UPPER_FN'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 0, 'Matching case drop succeeds');

      // Probe: What if CREATE is uppercase and DROP is lowercase?
      await mockAdapter.executeStatement({
        statement: 'CREATE OR REPLACE FUNCTION MAIN.SALES.UPPER_FN(val STRING) RETURN val = "A"'
      });
      await mockAdapter.executeStatement({
        statement: 'DROP FUNCTION IF EXISTS main.sales.upper_fn'
      });
      // Note: Map keys in DatabricksMockAdapter preserve original case unless normalized
      // In Databricks Unity Catalog SQL identifiers are case-insensitive.
    });

    it('empirically probes comments preceding DDL statements', async () => {
      // Leading comment followed by DROP FUNCTION
      await mockAdapter.executeStatement({
        statement: 'CREATE FUNCTION main.sch.active_fn() RETURN 1'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      await mockAdapter.executeStatement({
        statement: '-- Drop the function now\nDROP FUNCTION main.sch.active_fn;'
      });
      assert.strictEqual(mockAdapter.filterFunctions.size, 0, 'DROP with leading single-line comment succeeds');
    });

    it('verifies DatabricksClient default mock adapter can be reset without lingering cross-test state', async () => {
      // In test mode, DatabricksClient.getMockAdapter() returns a shared mock instance
      const defaultMock = DatabricksClient.getMockAdapter();
      defaultMock.reset();

      await DatabricksClient.executeStatement({ statement: 'CREATE FUNCTION default_fn() RETURN 1' });
      assert.strictEqual(defaultMock.filterFunctions.size, 1);

      // Reset
      defaultMock.reset();
      assert.strictEqual(defaultMock.filterFunctions.size, 0);
      assert.strictEqual(defaultMock.executedStatements.length, 0);
    });
  });
});
