'use strict';

/**
 * Empirical Stress & Adversarial Test Suite — Challenger 1 (Milestone 2)
 *
 * Focus Areas:
 * 1. SQL Injection Attacks:
 *    - Single quotes, embedded semicolons, comment syntax (-- , /* *\/), union selects
 *    - Injections in filter values across all 11 filter types
 *    - Injections in column identifiers, access domain names, and user/group identities
 * 2. Extreme Multi-Value Arrays & Boundary Values:
 *    - 150+ items and 1,000 items in arrays, JSON arrays, and comma-separated strings
 *    - Unusual range JSON inputs: inverted bounds, missing bounds, nulls, negative numbers, dates
 *    - Malformed JSON strings in MULTI_VALUE and RANGE
 *    - Whitespace, empty strings, null, undefined, objects
 * 3. DDL String Construction & Malformed SQL Prevention:
 *    - buildDatabricksRowFilterDdl parameter sanitization
 *    - Clean drop SQL lifecycle
 * 4. DNF Boolean Logic & Parenthesis Integrity:
 *    - Parenthesis balancing and operator precedence verification
 */

const test = require('node:test');
const assert = require('node:assert');

const DatabricksClient = require('../srv/lib/databricksClient');
const DatabricksMockAdapter = require('../srv/lib/databricksMockAdapter');

const {
  escapeSqlString,
  escapeIdentifier,
  sanitizeDomainName,
  extractId,
  translateRestrictionToSql,
  buildIntraRolePredicate,
  buildUserBindingPredicate,
  buildCompositePolicyExpr,
  resolveTargetNaming,
  buildDatabricksRowFilterDdl
} = require('../srv/services/databricksSyncService');

test('Challenger 1 Empirical Stress Test Suite: SQL Filter Generation', async (t) => {

  // Helper to verify parentheses balance
  function assertBalancedParentheses(sql, contextMsg) {
    let balance = 0;
    let inString = false;
    let inBacktick = false;

    for (let i = 0; i < sql.length; i++) {
      const c = sql[i];
      if (c === "'" && !inBacktick) {
        if (inString && sql[i + 1] === "'") {
          i++; // skip escaped quote
        } else {
          inString = !inString;
        }
      } else if (c === '`' && !inString) {
        if (inBacktick && sql[i + 1] === '`') {
          i++; // skip escaped backtick
        } else {
          inBacktick = !inBacktick;
        }
      } else if (!inString && !inBacktick) {
        if (c === '(') balance++;
        else if (c === ')') balance--;
        assert.ok(balance >= 0, `Unbalanced closing parenthesis in [${contextMsg}]: ${sql.substring(0, i + 1)}`);
      }
    }
    assert.strictEqual(inString, false, `Unterminated single quote literal in [${contextMsg}]: ${sql}`);
    assert.strictEqual(inBacktick, false, `Unterminated backtick identifier in [${contextMsg}]: ${sql}`);
    assert.strictEqual(balance, 0, `Unbalanced parentheses (net ${balance}) in [${contextMsg}]: ${sql}`);
  }

  // =========================================================================
  // 1. SQL Injection Attacks & Escaping Verification
  // =========================================================================
  await t.test('1. SQL Injection Attacks & Escaping Verification', async (t1) => {

    await t1.test('1.1 Single quotes, semicolons, comments, and UNION attacks in SINGLE_VALUE', () => {
      const attacks = [
        "admin' OR '1'='1",
        "'; DROP TABLE users; --",
        "'; DROP TABLE users; /*",
        "' UNION SELECT * FROM sensitive_data --",
        "val'; INSERT INTO admin VALUES ('hacker'); --",
        "test'/*comment*/OR'1'='1",
        "test\\'; DROP TABLE secrets; --",
        "\\x00' OR 1=1 --"
      ];

      for (const atk of attacks) {
        const sql = translateRestrictionToSql('RoleField', 'SINGLE_VALUE', atk);
        // Ensure SQL is wrapped in single quotes and all internal single quotes are escaped as ''
        assert.ok(sql.startsWith("RoleField = '"), `Must start with RoleField = ': ${sql}`);
        assert.ok(sql.endsWith("'"), `Must end with ': ${sql}`);
        // Verifying no unescaped single quotes broke out of the literal
        assertBalancedParentheses(sql, `SINGLE_VALUE injection: ${atk}`);

        // Extract literal content between outer quotes
        const inner = sql.slice("RoleField = '".length, -1);
        // Splitting on doubled quotes should leave NO single quotes
        const unescapedSingleQuotes = inner.replace(/''/g, '').includes("'");
        assert.strictEqual(unescapedSingleQuotes, false, `Found unescaped single quote in: ${sql}`);
      }
    });

    await t1.test('1.2 Injections in MULTI_VALUE / IN with array, JSON, and CSV inputs', () => {
      const maliciousItems = [
        "val1', 'val2",
        "') OR 1=1 --",
        "admin') UNION SELECT id, secret FROM credentials --",
        "'; DROP TABLE flat_auth; --"
      ];

      // Array input
      const sqlArr = translateRestrictionToSql('Dept', 'MULTI_VALUE', maliciousItems);
      assert.ok(sqlArr.startsWith("Dept IN ("), `Must use IN: ${sqlArr}`);
      assertBalancedParentheses(sqlArr, 'MULTI_VALUE array injection');

      // JSON string array input
      const jsonStr = JSON.stringify(maliciousItems);
      const sqlJson = translateRestrictionToSql('Dept', 'MULTI_VALUE', jsonStr);
      assert.ok(sqlJson.startsWith("Dept IN ("), `Must use IN for JSON: ${sqlJson}`);
      assertBalancedParentheses(sqlJson, 'MULTI_VALUE JSON injection');

      // Comma-separated string input
      const csvStr = "admin', '1'='1, normal_val, '; DROP TABLE t; --";
      const sqlCsv = translateRestrictionToSql('Dept', 'MULTI_VALUE', csvStr);
      assertBalancedParentheses(sqlCsv, 'MULTI_VALUE CSV injection');
    });

    await t1.test('1.3 Injections in RANGE / BT with malicious bounds', () => {
      const maliciousRanges = [
        { from: "100' OR '1'='1", to: "200'; DROP TABLE users; --" },
        { low: "001' UNION SELECT 1 --", high: "999'/*comment*/" }
      ];

      for (const r of maliciousRanges) {
        const sql = translateRestrictionToSql('Amount', 'RANGE', r);
        assertBalancedParentheses(sql, 'RANGE object injection');
        assert.ok(sql.includes("BETWEEN"), `Expected BETWEEN: ${sql}`);

        // With useBetween: false
        const sqlNoBetween = translateRestrictionToSql('Amount', 'RANGE', r, { useBetween: false });
        assertBalancedParentheses(sqlNoBetween, 'RANGE useBetween:false injection');
      }

      // Injections via raw text range
      const textRange = "100'; DROP TABLE a; -- to 500' UNION SELECT b; --";
      const sqlText = translateRestrictionToSql('Amount', 'RANGE', textRange);
      assertBalancedParentheses(sqlText, 'RANGE text injection');
    });

    await t1.test('1.4 Injections in PATTERN / CP', () => {
      const patterns = [
        "admin'*' OR '1'='1",
        "test%'; DROP TABLE users; --*",
        "prefix?'; DROP TABLE x; --"
      ];

      for (const pat of patterns) {
        const sql = translateRestrictionToSql('Code', 'PATTERN', pat);
        assert.ok(sql.startsWith("Code LIKE '"), `Expected LIKE: ${sql}`);
        assertBalancedParentheses(sql, `PATTERN injection: ${pat}`);
      }
    });

    await t1.test('1.5 Injections in NE, GT, GE, LT, LE operators', () => {
      const ops = ['NE', 'GT', 'GE', 'LT', 'LE'];
      const attack = "100' OR '1'='1'; DROP TABLE t; --";

      for (const op of ops) {
        const sql = translateRestrictionToSql('Score', op, attack);
        assertBalancedParentheses(sql, `${op} injection`);
        const inner = sql.slice(sql.indexOf("'") + 1, -1);
        assert.strictEqual(inner.replace(/''/g, '').includes("'"), false);
      }
    });

    await t1.test('1.6 Identifier injections (column names, domain names, user IDs)', () => {
      // Column name with backticks and semicolons
      const evilCol = "col`; DROP TABLE secret; --";
      const escapedCol = escapeIdentifier(evilCol);
      assert.strictEqual(escapedCol, "`col``; DROP TABLE secret; --`");

      // Column name with spaces
      const spaceCol = "Company Code";
      assert.strictEqual(escapeIdentifier(spaceCol), "`Company Code`");

      // Domain name sanitization
      const evilDomain = "Sales; DROP TABLE users; --";
      const cleanDomain = sanitizeDomainName(evilDomain);
      assert.strictEqual(/^[a-z0-9_]+$/.test(cleanDomain), true);
      assert.strictEqual(cleanDomain.includes(';'), false);
      assert.strictEqual(cleanDomain.includes(' '), false);

      // User ID injection in user binding
      const evilUser = "attacker'; DROP TABLE users; --";
      const userSql = buildUserBindingPredicate(evilUser, "Country = 'DE'");
      assertBalancedParentheses(userSql, 'User ID injection');
      assert.ok(userSql.includes("current_user() = 'attacker''; DROP TABLE users; --'"));

      // Group ID injection in user binding
      const evilGroup = "group:finance'; DROP TABLE tbl; --";
      const groupSql = buildUserBindingPredicate(evilGroup, "Country = 'DE'");
      assertBalancedParentheses(groupSql, 'Group ID injection');
      assert.ok(groupSql.includes("is_account_group_member('finance''; DROP TABLE tbl; --')"));
    });
  });

  // =========================================================================
  // 2. Extreme Multi-Value Arrays & Boundary Conditions
  // =========================================================================
  await t.test('2. Extreme Multi-Value Arrays & Boundary Conditions', async (t2) => {

    await t2.test('2.1 Extreme 150+ and 1,000 items in MULTI_VALUE', () => {
      // 150 items array
      const items150 = Array.from({ length: 150 }, (_, i) => `PLANT_${i}`);
      const sql150 = translateRestrictionToSql('Plant', 'MULTI_VALUE', items150);
      assert.ok(sql150.startsWith("Plant IN ("));
      assertBalancedParentheses(sql150, '150 items array');
      assert.strictEqual((sql150.match(/PLANT_/g) || []).length, 150);

      // 1000 items array
      const items1000 = Array.from({ length: 1000 }, (_, i) => `VAL_${i}`);
      const sql1000 = translateRestrictionToSql('Plant', 'MULTI_VALUE', items1000);
      assert.ok(sql1000.startsWith("Plant IN ("));
      assertBalancedParentheses(sql1000, '1000 items array');
      assert.strictEqual((sql1000.match(/VAL_/g) || []).length, 1000);

      // 150 items CSV
      const csv150 = items150.join(', ');
      const sqlCsv150 = translateRestrictionToSql('Plant', 'MULTI_VALUE', csv150);
      assertBalancedParentheses(sqlCsv150, '150 items CSV');
      assert.strictEqual((sqlCsv150.match(/PLANT_/g) || []).length, 150);

      // 150 items JSON string
      const json150 = JSON.stringify(items150);
      const sqlJson150 = translateRestrictionToSql('Plant', 'MULTI_VALUE', json150);
      assertBalancedParentheses(sqlJson150, '150 items JSON');
      assert.strictEqual((sqlJson150.match(/PLANT_/g) || []).length, 150);
    });

    await t2.test('2.2 Unusual RANGE / BT inputs (inverted, negative, dates, numbers)', () => {
      // Inverted bounds (from > to)
      const inverted = translateRestrictionToSql('Rank', 'RANGE', { from: '999', to: '100' });
      assert.strictEqual(inverted, "Rank BETWEEN '999' AND '100'");
      assertBalancedParentheses(inverted, 'Inverted range');

      // Negative numbers
      const negRange = translateRestrictionToSql('Temp', 'RANGE', { from: -50, to: 50 });
      assert.strictEqual(negRange, "Temp BETWEEN '-50' AND '50'");

      // ISO dates
      const dateRange = translateRestrictionToSql('CreatedDate', 'RANGE', { from: '2024-01-01', to: '2024-12-31' });
      assert.strictEqual(dateRange, "CreatedDate BETWEEN '2024-01-01' AND '2024-12-31'");

      // Text range with 'to'
      const textTo = translateRestrictionToSql('Year', 'RANGE', '2020 to 2025');
      assert.strictEqual(textTo, "Year BETWEEN '2020' AND '2025'");

      // Missing or empty bounds -> returns TRUE (unrestricted)
      assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', { from: '100', to: '' }), 'TRUE');
      assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', { from: '', to: '500' }), 'TRUE');
      assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', { from: '100', to: null }), 'TRUE');
      assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', { from: undefined, to: '500' }), 'TRUE');
      assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', {}), 'TRUE');
    });

    await t2.test('2.3 Malformed JSON and unexpected data structures', () => {
      // Malformed JSON in MULTI_VALUE
      const malformedJsonArray = '["DE01", "DE02", ';
      const sqlMalformed = translateRestrictionToSql('Plant', 'MULTI_VALUE', malformedJsonArray);
      assertBalancedParentheses(sqlMalformed, 'Malformed JSON array in MULTI_VALUE');

      // Malformed JSON in RANGE
      const malformedJsonRange = '{"from": "100", "to": ';
      const sqlRangeMalformed = translateRestrictionToSql('Amount', 'RANGE', malformedJsonRange);
      assertBalancedParentheses(sqlRangeMalformed, 'Malformed JSON in RANGE');

      // Non-array JSON in MULTI_VALUE
      const jsonObject = '{"single": "value"}';
      const sqlObjInMulti = translateRestrictionToSql('Plant', 'MULTI_VALUE', jsonObject);
      assertBalancedParentheses(sqlObjInMulti, 'JSON object in MULTI_VALUE');

      // Array with null, empty, whitespace entries in MULTI_VALUE
      const messyArray = ['DE01', null, '', '   ', undefined, 'DE02', '  DE03  '];
      const sqlMessy = translateRestrictionToSql('Plant', 'MULTI_VALUE', messyArray);
      assert.strictEqual(sqlMessy, "Plant IN ('DE01', 'DE02', 'DE03')");

      // Array with ONLY empty/null entries
      const emptyArray = [null, '', '   ', undefined];
      assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', emptyArray), 'TRUE');
    });

    await t2.test('2.4 Whitespace, null, undefined, and empty string handling across all types', () => {
      const types = ['SINGLE_VALUE', 'MULTI_VALUE', 'RANGE', 'PATTERN', 'NE', 'GT', 'GE', 'LT', 'LE'];

      for (const type of types) {
        assert.strictEqual(translateRestrictionToSql('Field', type, null), 'TRUE');
        assert.strictEqual(translateRestrictionToSql('Field', type, undefined), 'TRUE');
        assert.strictEqual(translateRestrictionToSql('Field', type, ''), 'TRUE');
        assert.strictEqual(translateRestrictionToSql('Field', type, '   '), 'TRUE');
        assert.strictEqual(translateRestrictionToSql('Field', type, '\t\n  '), 'TRUE');
      }

      // NULL and NOT NULL do not require values
      assert.strictEqual(translateRestrictionToSql('Field', 'NULL', null), 'Field IS NULL');
      assert.strictEqual(translateRestrictionToSql('Field', 'NOT NULL', null), 'Field IS NOT NULL');
      assert.strictEqual(translateRestrictionToSql('Field', 'N', ''), 'Field IS NULL');
      assert.strictEqual(translateRestrictionToSql('Field', 'NN', ''), 'Field IS NOT NULL');
    });
  });

  // =========================================================================
  // 3. DDL String Construction & Malformed SQL Prevention
  // =========================================================================
  await t.test('3. DDL String Construction & Malformed SQL Prevention', async (t3) => {

    await t3.test('3.1 buildDatabricksRowFilterDdl parameter filtering & syntax', () => {
      const ddl = buildDatabricksRowFilterDdl({
        catalog: 'prod_catalog',
        schema: 'analytics',
        domain: 'finance',
        filterName: 'fn_filter_finance',
        targetTable: 'finance_flat_authorizations',
        columns: ['plant', 'company_code', 'evil_col; DROP TABLE t; --', 'bad`col'],
        columnTypes: { plant: 'STRING', company_code: 'STRING' },
        assignments: [
          {
            userId: 'alice',
            roles: [{ restrictions: [{ field: 'plant', filterType: 'SINGLE_VALUE', value: 'DE01' }] }]
          }
        ]
      });

      // Verify malicious column names were filtered out by regex /^[a-zA-Z0-9_]+$/
      assert.deepStrictEqual(ddl.columns, ['plant', 'company_code']);
      assert.ok(!ddl.createFuncSql.includes('evil_col'));
      assert.ok(!ddl.createFuncSql.includes('DROP TABLE'));

      // Check DDL statements syntax and balance
      assert.ok(ddl.createFuncSql.startsWith('CREATE OR REPLACE FUNCTION prod_catalog.analytics.fn_filter_finance(plant STRING, company_code STRING)'));
      assert.ok(ddl.createFuncSql.endsWith(';'));
      assertBalancedParentheses(ddl.createFuncSql, 'CREATE OR REPLACE FUNCTION DDL');

      assert.ok(ddl.setFilterSql.startsWith('ALTER TABLE prod_catalog.analytics.finance_flat_authorizations SET ROW FILTER'));
      assert.ok(ddl.setFilterSql.endsWith(';'));
      assertBalancedParentheses(ddl.setFilterSql, 'ALTER TABLE SET ROW FILTER DDL');

      assert.strictEqual(ddl.dropFilterSql, 'ALTER TABLE prod_catalog.analytics.finance_flat_authorizations DROP ROW FILTER;');
      assert.strictEqual(ddl.dropFuncSql, 'DROP FUNCTION IF EXISTS prod_catalog.analytics.fn_filter_finance;');
    });

    await t3.test('3.2 Fallback when 0 valid columns provided', () => {
      const ddl = buildDatabricksRowFilterDdl({
        catalog: 'main',
        schema: 'default',
        filterName: 'fn_filter_empty',
        targetTable: 'empty_flat_authorizations',
        columns: ['invalid-col!', 'bad col'],
        assignments: []
      });

      // Must fall back to safe default column ['id']
      assert.deepStrictEqual(ddl.columns, ['id']);
      assert.ok(ddl.createFuncSql.includes('(id STRING)'));
      assert.ok(ddl.setFilterSql.includes('ON (id);'));
      assertBalancedParentheses(ddl.createFuncSql, 'Fallback column DDL');
    });

    await t3.test('3.3 Full DDL lifecycle with DatabricksMockAdapter execution', async () => {
      const mockAdapter = new DatabricksMockAdapter();
      DatabricksClient.setAdapter(mockAdapter);

      try {
        const ddl = buildDatabricksRowFilterDdl({
          catalog: 'test_cat',
          schema: 'test_sch',
          filterName: 'fn_test_filter',
          targetTable: 'test_table',
          columns: ['country', 'amount'],
          assignments: [
            {
              userId: 'bob',
              restrictions: [
                { field: 'country', filterType: 'SINGLE_VALUE', value: 'US' },
                { field: 'amount', filterType: 'GT', value: '1000' }
              ]
            }
          ]
        });

        // Execute CREATE FUNCTION
        const resCreate = await DatabricksClient.executeStatement({
          warehouseId: 'wh-test',
          statement: ddl.createFuncSql
        });
        assert.strictEqual(resCreate.status.state, 'SUCCEEDED');
        assert.strictEqual(mockAdapter.filterFunctions.size, 1);

        // Execute SET ROW FILTER
        const resSet = await DatabricksClient.executeStatement({
          warehouseId: 'wh-test',
          statement: ddl.setFilterSql
        });
        assert.strictEqual(resSet.status.state, 'SUCCEEDED');
        assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);

        // Execute DROP ROW FILTER
        const resDropFilter = await DatabricksClient.executeStatement({
          warehouseId: 'wh-test',
          statement: ddl.dropFilterSql
        });
        assert.strictEqual(resDropFilter.status.state, 'SUCCEEDED');
        assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);

        // Execute DROP FUNCTION
        const resDropFunc = await DatabricksClient.executeStatement({
          warehouseId: 'wh-test',
          statement: ddl.dropFuncSql
        });
        assert.strictEqual(resDropFunc.status.state, 'SUCCEEDED');
        assert.strictEqual(mockAdapter.filterFunctions.size, 0);
      } finally {
        DatabricksClient.resetAdapter();
      }
    });
  });

  // =========================================================================
  // 4. DNF Boolean Logic, Conjunctions & Parenthesis Integrity
  // =========================================================================
  await t.test('4. DNF Boolean Logic & Parenthesis Integrity', async (t4) => {

    await t4.test('4.1 Complex intra-role conjunctions and same-field disjunctions', () => {
      const restrictions = [
        { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' },
        { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE02' },
        { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
        { field: 'CostCenter', filterType: 'RANGE', value: { from: '1000', to: '2000' } },
        { field: 'Customer', filterType: 'PATTERN', value: 'CUST*' }
      ];

      const intra = buildIntraRolePredicate(restrictions);
      assertBalancedParentheses(intra, 'Complex intra-role predicate');
      assert.ok(intra.includes("(Plant = 'DE01' OR Plant = 'DE02')"));
      assert.ok(intra.includes("Country = 'DE'"));
      assert.ok(intra.includes("CostCenter BETWEEN '1000' AND '2000'"));
      assert.ok(intra.includes("Customer LIKE 'CUST%'"));
    });

    await t4.test('4.2 Multi-role per user and multi-user composite DNF expressions', () => {
      const assignments = [
        {
          userId: 'alice',
          roles: [
            {
              restrictions: [
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' },
                { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }
              ]
            },
            {
              restrictions: [
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'US01' },
                { field: 'Country', filterType: 'SINGLE_VALUE', value: 'US' }
              ]
            }
          ]
        },
        {
          userId: 'bob',
          roles: [
            {
              restrictions: [
                { field: 'Dept', filterType: 'SINGLE_VALUE', value: 'Finance' }
              ]
            }
          ]
        },
        {
          userId: 'group:auditors',
          roles: [
            {
              restrictions: [
                { field: 'AuditYear', filterType: 'GE', value: '2023' }
              ]
            }
          ]
        },
        {
          userId: 'charlie', // unrestricted
          roles: [
            { restrictions: [{ field: 'Country', filterType: 'ALL', value: '*' }] }
          ]
        }
      ];

      const composite = buildCompositePolicyExpr(assignments);
      assertBalancedParentheses(composite, 'Multi-user composite expression');

      // Admin bypass prepended
      assert.ok(composite.startsWith("is_account_group_member('admin') OR"));

      // Charlie unrestricted
      assert.ok(composite.includes("(current_user() = 'charlie')"));

      // Group auditors
      assert.ok(composite.includes("is_account_group_member('auditors') AND (AuditYear >= '2023')"));

      // Alice multi-role (joined with OR)
      assert.ok(composite.includes("current_user() = 'alice'"));
      assert.ok(composite.includes("Plant = 'DE01' AND Country = 'DE'"));
      assert.ok(composite.includes("Plant = 'US01' AND Country = 'US'"));
    });

    await t4.test('4.3 Empty assignments returns admin-only bypass', () => {
      const emptyResult = buildCompositePolicyExpr([]);
      assert.strictEqual(emptyResult, "is_account_group_member('admin')");

      const nullResult = buildCompositePolicyExpr(null);
      assert.strictEqual(nullResult, "is_account_group_member('admin')");
    });

    await t4.test('4.4 Complex nested DNF: 3+ roles with multi-field AND/OR per user', () => {
      const assignments = [
        {
          userId: "o'neil@company.com",
          roles: [
            {
              restrictions: [
                { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' }
              ]
            },
            {
              restrictions: [
                { field: 'Country', filterType: 'SINGLE_VALUE', value: 'US' },
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'US01' }
              ]
            },
            {
              restrictions: [
                { field: 'Country', filterType: 'SINGLE_VALUE', value: 'FR' },
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'FR01' },
                { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'FR02' }
              ]
            }
          ]
        }
      ];

      const sql = buildCompositePolicyExpr(assignments);
      assertBalancedParentheses(sql, '3-role multi-field nested DNF');
      assert.ok(sql.includes("current_user() = 'o''neil@company.com'"));
      assert.ok(sql.includes("(Plant = 'FR01' OR Plant = 'FR02')"));
      assert.ok(sql.includes("Country = 'FR'"));
    });
  });

  // =========================================================================
  // 5. Column Identifier Edge Cases & Boundary Resiliency
  // =========================================================================
  await t.test('5. Column Identifier Edge Cases & Boundary Resiliency', async (t5) => {

    await t5.test('5.1 Unicode, numbers, and special chars in column names', () => {
      // Alphanumeric with underscores
      assert.strictEqual(escapeIdentifier('Cost_Center_01'), 'Cost_Center_01');
      assert.strictEqual(escapeIdentifier('_hiddenCol'), '_hiddenCol');

      // Names requiring backticks
      assert.strictEqual(escapeIdentifier('Order Date'), '`Order Date`');
      assert.strictEqual(escapeIdentifier('123NumericCol'), '`123NumericCol`');
      assert.strictEqual(escapeIdentifier('Field-Name'), '`Field-Name`');
      assert.strictEqual(escapeIdentifier('Table.Column'), '`Table.Column`');
      assert.strictEqual(escapeIdentifier('Col with "quotes"'), '`Col with "quotes"`');
      assert.strictEqual(escapeIdentifier('Col`with`ticks'), '`Col``with``ticks`');

      // Empty / whitespace / null / undefined identifiers
      assert.strictEqual(escapeIdentifier(''), '');
      assert.strictEqual(escapeIdentifier('   '), '``'); // Whitespace trims to empty string, wrapped in backticks
      assert.strictEqual(escapeIdentifier(null), '');
      assert.strictEqual(escapeIdentifier(undefined), '');
    });

    await t5.test('5.2 Field names in translateRestrictionToSql', () => {
      // Column with backtick inside
      const sqlTick = translateRestrictionToSql('User`Field', 'SINGLE_VALUE', 'Val1');
      assert.strictEqual(sqlTick, "`User``Field` = 'Val1'");
      assertBalancedParentheses(sqlTick, 'Column with backtick');

      // Column with spaces
      const sqlSpace = translateRestrictionToSql('Business Partner', 'SINGLE_VALUE', 'BP001');
      assert.strictEqual(sqlSpace, "`Business Partner` = 'BP001'");
      assertBalancedParentheses(sqlSpace, 'Column with spaces');
    });

    await t5.test('5.3 Extreme characters and length in values', () => {
      // 5,000-character string value
      const longVal = 'X'.repeat(5000);
      const sqlLong = translateRestrictionToSql('DataField', 'SINGLE_VALUE', longVal);
      assert.strictEqual(sqlLong, `DataField = '${longVal}'`);

      // String with 1,000 single quotes (must double to 2,000 quotes)
      const quotesVal = "'".repeat(1000);
      const sqlQuotes = translateRestrictionToSql('QuoteField', 'SINGLE_VALUE', quotesVal);
      assert.strictEqual(sqlQuotes, `QuoteField = '${"''".repeat(1000)}'`);
      assertBalancedParentheses(sqlQuotes, '1,000 single quotes');

      // String with newlines and carriage returns
      const multilineVal = "Line1\nLine2\r\nLine3";
      const sqlMultiline = translateRestrictionToSql('TextField', 'SINGLE_VALUE', multilineVal);
      assert.strictEqual(sqlMultiline, "TextField = 'Line1\nLine2\r\nLine3'");
      assertBalancedParentheses(sqlMultiline, 'Multiline value');
    });
  });
});
