'use strict';

/**
 * Databricks Unity Catalog Policy Sync Test Suite
 *
 * Covers Milestone 2 requirements:
 * 1. All 11 filter types translation with SQL character escaping.
 * 2. Multi-value arrays, JSON strings, and comma-separated parsing.
 * 3. Range and Between handling with boundaries.
 * 4. Pattern and SAP wildcard translation (* -> %, ? -> _).
 * 5. Intra-role boolean conjunction (AND across distinct fields, OR across same field).
 * 6. User identity binding and group membership binding.
 * 7. Multi-role per user (OR) and multi-user composite DNF policy generation.
 * 8. Multi-level role inheritance (depth >= 3) with parent wildcard override.
 * 9. Lifecycle: direct sync, assignment revocation, and clean drop when 0 users remain.
 * 10. Access domain provisioning and role cascade synchronization.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const cds = require('@sap/cds');

// Boot CAP test environment
const { GET, POST, PATCH, DELETE } = cds.test(path.resolve(__dirname, '..'));

const DatabricksClient = require('../srv/lib/databricksClient');
const DatabricksMockAdapter = require('../srv/lib/databricksMockAdapter');
const { resolveEffectiveRestrictions } = require('../srv/lib/resolveEffectiveRestrictions');

const {
  escapeSqlString,
  escapeIdentifier,
  sanitizeDomainName,
  extractId,
  translateRestrictionToSql,
  translateRestrictionToDatabricksSql,
  buildIntraRolePredicate,
  buildUserBindingPredicate,
  buildCompositePolicyExpr,
  buildCompositeReturnExpression,
  resolveTargetNaming,
  resolveDatabricksSettings,
  buildDatabricksRowFilterDdl,
  buildUnityCatalogRowFilterDdl,
  syncRoleToDatabricks,
  syncAssignmentToDatabricks,
  removeAssignmentFromDatabricks,
  syncAccessDomainToDatabricks,
  syncDatabricksPolicyForDomain
} = require('../srv/services/databricksSyncService');

test('Databricks Unity Catalog Policy Sync & SQL Filter Generator', async (t) => {
  const mockAdapter = new DatabricksMockAdapter();
  DatabricksClient.setAdapter(mockAdapter);

  t.beforeEach(() => {
    mockAdapter.reset();
  });

  t.after(() => {
    DatabricksClient.resetAdapter();
  });

  // =========================================================================
  // 1. Core Escaping, Identifier & Value Extraction
  // =========================================================================
  await t.test('1. String Escaping, Identifiers & Value Extraction', () => {
    // 1.1 Single quote escaping (SQL injection protection)
    assert.strictEqual(escapeSqlString("O'Connor"), "O''Connor");
    assert.strictEqual(escapeSqlString("admin' OR '1'='1"), "admin'' OR ''1''=''1");
    assert.strictEqual(escapeSqlString("NORMAL"), "NORMAL");
    assert.strictEqual(escapeSqlString(""), "");
    assert.strictEqual(escapeSqlString(null), "");
    assert.strictEqual(escapeSqlString(undefined), "");
    assert.strictEqual(escapeSqlString(12345), "12345");

    // 1.2 Identifier escaping
    assert.strictEqual(escapeIdentifier("Country"), "Country");
    assert.strictEqual(escapeIdentifier("Company Code"), "`Company Code`");
    assert.strictEqual(escapeIdentifier("Cost-Center"), "`Cost-Center`");
    assert.strictEqual(escapeIdentifier(""), "");
    assert.strictEqual(escapeIdentifier(null), "");

    // 1.3 Domain sanitization
    assert.strictEqual(sanitizeDomainName("Sales-EMEA"), "sales_emea");
    assert.strictEqual(sanitizeDomainName("__FINANCE_AP__"), "finance_ap");
    assert.strictEqual(sanitizeDomainName("Data & Analytics"), "data___analytics");
    assert.strictEqual(sanitizeDomainName(""), "global");
    assert.strictEqual(sanitizeDomainName(null), "global");

    // 1.4 extractId
    assert.strictEqual(extractId("DE"), "DE");
    assert.strictEqual(extractId({ id: 'DE01', text: 'Plant 1' }), "DE01");
    assert.strictEqual(extractId({ key: 'K1' }), "K1");
    assert.strictEqual(extractId({ value: 'V1' }), "V1");
    assert.strictEqual(extractId('{"id":"US01","text":"Plant US"}'), "US01");
    assert.strictEqual(extractId('{"key":"K99"}'), "K99");
    assert.strictEqual(extractId('{"value":"VAL"}'), "VAL");
    assert.strictEqual(extractId(null), "");
    assert.strictEqual(extractId(undefined), "");
  });

  // =========================================================================
  // 2. All 11 Filter Types Translation & Edge Cases
  // =========================================================================
  await t.test('2. All 11 Filter Types SQL Generation', () => {
    // 2.1 SINGLE_VALUE & EQ
    assert.strictEqual(translateRestrictionToSql('Country', 'SINGLE_VALUE', 'DE'), "Country = 'DE'");
    assert.strictEqual(translateRestrictionToSql('Country', 'EQ', 'US'), "Country = 'US'");
    assert.strictEqual(translateRestrictionToSql('Name', 'SINGLE_VALUE', "O'Reilly"), "Name = 'O''Reilly'");
    assert.strictEqual(translateRestrictionToSql('Country', 'SINGLE_VALUE', { id: 'DE', text: 'Germany' }), "Country = 'DE'");
    assert.strictEqual(translateRestrictionToSql('Country', 'SINGLE_VALUE', ''), "TRUE");
    assert.strictEqual(translateRestrictionToSql('Country', 'SINGLE_VALUE', null), "TRUE");

    // Polymorphic signature test (restr object)
    assert.strictEqual(translateRestrictionToSql({ field: 'Country', filterType: 'SINGLE_VALUE', value: 'FR' }), "Country = 'FR'");
    assert.strictEqual(translateRestrictionToSql({ filterType: 'SINGLE_VALUE', value: 'IT' }, 'Country'), "Country = 'IT'");

    // 2.2 MULTI_VALUE & IN
    // Array format
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', ['DE01', 'DE02']), "Plant IN ('DE01', 'DE02')");
    // JSON string format
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', '["DE01","DE02"]'), "Plant IN ('DE01', 'DE02')");
    // Comma-separated format
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', 'DE01, DE02, DE03'), "Plant IN ('DE01', 'DE02', 'DE03')");
    // Single item
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', ['DE01']), "Plant IN ('DE01')");
    // Enriched object array
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', [{ id: 'DE01' }, { id: 'DE02' }]), "Plant IN ('DE01', 'DE02')");
    // Quotes inside values
    assert.strictEqual(translateRestrictionToSql('Owner', 'MULTI_VALUE', ["O'Connor", "O'Reilly"]), "Owner IN ('O''Connor', 'O''Reilly')");
    // Empty array / string -> TRUE
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', []), "TRUE");
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', '[]'), "TRUE");
    assert.strictEqual(translateRestrictionToSql('Plant', 'MULTI_VALUE', ''), "TRUE");

    // 2.3 RANGE & BT
    // JSON object
    assert.strictEqual(translateRestrictionToSql('SalesOrg', 'RANGE', '{"from":"1000","to":"2000"}'), "SalesOrg BETWEEN '1000' AND '2000'");
    assert.strictEqual(translateRestrictionToSql('SalesOrg', 'BT', { from: '1000', to: '2000' }), "SalesOrg BETWEEN '1000' AND '2000'");
    assert.strictEqual(translateRestrictionToSql('CostCenter', 'BT', { low: 'CC01', high: 'CC05' }), "CostCenter BETWEEN 'CC01' AND 'CC05'");
    // Option useBetween: false
    assert.strictEqual(translateRestrictionToSql('SalesOrg', 'RANGE', '{"from":"1000","to":"2000"}', { useBetween: false }), "(SalesOrg >= '1000' AND SalesOrg <= '2000')");
    // Text range format
    assert.strictEqual(translateRestrictionToSql('Amount', 'RANGE', '100 to 500'), "Amount BETWEEN '100' AND '500'");
    // Quotes in bounds
    assert.strictEqual(translateRestrictionToSql('Tag', 'RANGE', { from: "A'1", to: "B'2" }), "Tag BETWEEN 'A''1' AND 'B''2'");
    // Incomplete bounds -> TRUE
    assert.strictEqual(translateRestrictionToSql('SalesOrg', 'RANGE', { from: '' }), "TRUE");

    // 2.4 CP & PATTERN (SAP wildcards * and ?)
    assert.strictEqual(translateRestrictionToSql('Customer', 'CP', 'DE*'), "Customer LIKE 'DE%'");
    assert.strictEqual(translateRestrictionToSql('Customer', 'PATTERN', '*MID*'), "Customer LIKE '%MID%'");
    assert.strictEqual(translateRestrictionToSql('Customer', 'CP', 'D?01'), "Customer LIKE 'D_01'");
    assert.strictEqual(translateRestrictionToSql('Customer', 'PATTERN', "O'Conn*"), "Customer LIKE 'O''Conn%'");
    assert.strictEqual(translateRestrictionToSql('Customer', 'CP', ''), "TRUE");

    // 2.5 NE (<> and !=)
    assert.strictEqual(translateRestrictionToSql('Status', 'NE', 'INACTIVE'), "Status != 'INACTIVE'");
    assert.strictEqual(translateRestrictionToSql('Status', 'NE', "O'Reilly"), "Status != 'O''Reilly'");
    assert.strictEqual(translateRestrictionToSql('Status', 'NE', ''), "TRUE");

    // 2.6 GT (>)
    assert.strictEqual(translateRestrictionToSql('Amount', 'GT', '1000'), "Amount > '1000'");
    assert.strictEqual(translateRestrictionToSql('Amount', '>', 500), "Amount > '500'");
    assert.strictEqual(translateRestrictionToSql('Amount', 'GT', ''), "TRUE");

    // 2.7 GE (>=)
    assert.strictEqual(translateRestrictionToSql('Amount', 'GE', '1000'), "Amount >= '1000'");
    assert.strictEqual(translateRestrictionToSql('Amount', '>=', 500), "Amount >= '500'");
    assert.strictEqual(translateRestrictionToSql('Amount', 'GE', ''), "TRUE");

    // 2.8 LT (<)
    assert.strictEqual(translateRestrictionToSql('Amount', 'LT', '5000'), "Amount < '5000'");
    assert.strictEqual(translateRestrictionToSql('Amount', '<', 500), "Amount < '500'");
    assert.strictEqual(translateRestrictionToSql('Amount', 'LT', ''), "TRUE");

    // 2.9 LE (<=)
    assert.strictEqual(translateRestrictionToSql('Amount', 'LE', '5000'), "Amount <= '5000'");
    assert.strictEqual(translateRestrictionToSql('Amount', '<=', 500), "Amount <= '500'");
    assert.strictEqual(translateRestrictionToSql('Amount', 'LE', ''), "TRUE");

    // 2.10 NULL & N
    assert.strictEqual(translateRestrictionToSql('DeletedFlag', 'NULL', ''), "DeletedFlag IS NULL");
    assert.strictEqual(translateRestrictionToSql('DeletedFlag', 'N', null), "DeletedFlag IS NULL");

    // 2.11 NOT NULL & NN
    assert.strictEqual(translateRestrictionToSql('CreatedDate', 'NOT NULL', ''), "CreatedDate IS NOT NULL");
    assert.strictEqual(translateRestrictionToSql('CreatedDate', 'NN', null), "CreatedDate IS NOT NULL");

    // Wildcard ALL and '*'
    assert.strictEqual(translateRestrictionToSql('Country', 'ALL', '*'), "TRUE");
    assert.strictEqual(translateRestrictionToSql('Country', 'SINGLE_VALUE', '*'), "TRUE");
  });

  // =========================================================================
  // 3. Intra-Role Predicate Conjunction & Disjunction
  // =========================================================================
  await t.test('3. Intra-Role Conjunction (AND across fields, OR across same field)', () => {
    // Single restriction
    const r1 = [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }];
    assert.strictEqual(buildIntraRolePredicate(r1), "Country = 'DE'");

    // Multiple distinct fields combined with AND
    const rDistinct = [
      { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
      { field: 'Plant', filterType: 'MULTI_VALUE', value: '["DE01","DE02"]' },
      { field: 'Division', filterType: 'NE', value: 'OLD' }
    ];
    assert.strictEqual(
      buildIntraRolePredicate(rDistinct),
      "Country = 'DE' AND Plant IN ('DE01', 'DE02') AND Division != 'OLD'"
    );

    // Multiple restrictions on the SAME field combined with OR
    const rSameField = [
      { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
      { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' },
      { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE02' }
    ];
    assert.strictEqual(
      buildIntraRolePredicate(rSameField),
      "Country = 'DE' AND (Plant = 'DE01' OR Plant = 'DE02')"
    );

    // Mixed case field names group together
    const rMixedCase = [
      { field: 'plant', filterType: 'SINGLE_VALUE', value: 'DE01' },
      { field: 'PLANT', filterType: 'SINGLE_VALUE', value: 'DE02' }
    ];
    assert.strictEqual(
      buildIntraRolePredicate(rMixedCase),
      "(plant = 'DE01' OR plant = 'DE02')"
    );

    // Empty or TRUE restrictions omitted
    const rWithTrue = [
      { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
      { field: 'Plant', filterType: 'ALL', value: '*' }
    ];
    assert.strictEqual(buildIntraRolePredicate(rWithTrue), "Country = 'DE'");

    // All TRUE returns 'TRUE'
    const rAllTrue = [
      { field: 'Country', filterType: 'ALL', value: '*' },
      { field: 'Plant', filterType: 'SINGLE_VALUE', value: '' }
    ];
    assert.strictEqual(buildIntraRolePredicate(rAllTrue), "TRUE");
  });

  // =========================================================================
  // 4. Identity Binding Predicates
  // =========================================================================
  await t.test('4. Identity Binding (User & Group)', () => {
    // Normal user with restrictions
    assert.strictEqual(
      buildUserBindingPredicate('alice@fanrio.corp', "Country = 'DE'"),
      "(current_user() = 'alice@fanrio.corp' AND (Country = 'DE'))"
    );

    // User with single quotes in ID
    assert.strictEqual(
      buildUserBindingPredicate("o'connor@fanrio.corp", "Country = 'IE'"),
      "(current_user() = 'o''connor@fanrio.corp' AND (Country = 'IE'))"
    );

    // Group binding via isGroup option or group: prefix
    assert.strictEqual(
      buildUserBindingPredicate('group:finance_team', "Company = '1000'"),
      "(is_account_group_member('finance_team') AND (Company = '1000'))"
    );
    assert.strictEqual(
      buildUserBindingPredicate('auditors', "Region = 'EU'", { isGroup: true }),
      "(is_account_group_member('auditors') AND (Region = 'EU'))"
    );

    // Unrestricted role binding
    assert.strictEqual(
      buildUserBindingPredicate('super_analyst@fanrio.corp', 'TRUE'),
      "(current_user() = 'super_analyst@fanrio.corp')"
    );
  });

  // =========================================================================
  // 5. Multi-Role & Multi-User Composite Policy DNF Generator
  // =========================================================================
  await t.test('5. Multi-Role & Multi-User Composite DNF Policy Generator', () => {
    // 5.1 Single user with single role
    const singleAssignment = [
      {
        user: 'alice@fanrio.corp',
        restrictions: [
          { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
          { field: 'Plant', filterType: 'MULTI_VALUE', value: '["DE01","DE02"]' }
        ]
      }
    ];
    const expr1 = buildCompositePolicyExpr(singleAssignment);
    assert.ok(expr1.includes("is_account_group_member('admin') OR"));
    assert.ok(expr1.includes("current_user() = 'alice@fanrio.corp' AND (Country = 'DE' AND Plant IN ('DE01', 'DE02'))"));

    // 5.2 Single user with MULTIPLE roles (multi-role per user combined with OR)
    const multiRoleUser = [
      {
        user: 'alice@fanrio.corp',
        restrictions: [
          { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
          { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' }
        ]
      },
      {
        user: 'alice@fanrio.corp',
        restrictions: [
          { field: 'Country', filterType: 'SINGLE_VALUE', value: 'FR' }
        ]
      }
    ];
    const expr2 = buildCompositePolicyExpr(multiRoleUser);
    assert.ok(expr2.includes("is_account_group_member('admin') OR"));
    assert.ok(expr2.includes("current_user() = 'alice@fanrio.corp' AND ((Country = 'DE' AND Plant = 'DE01') OR Country = 'FR')"));

    // 5.3 Multiple distinct users (multi-user combined with OR)
    const multiUser = [
      {
        user: 'alice@fanrio.corp',
        restrictions: [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }]
      },
      {
        user: 'bob@fanrio.corp',
        restrictions: [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'FR' }]
      },
      {
        user: 'charlie@fanrio.corp',
        restrictions: [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'US' }]
      }
    ];
    const expr3 = buildCompositePolicyExpr(multiUser);
    assert.ok(expr3.includes("current_user() = 'alice@fanrio.corp' AND (Country = 'DE')"));
    assert.ok(expr3.includes("current_user() = 'bob@fanrio.corp' AND (Country = 'FR')"));
    assert.ok(expr3.includes("current_user() = 'charlie@fanrio.corp' AND (Country = 'US')"));
    assert.ok(expr3.includes("is_account_group_member('admin') OR"));

    // 5.4 Zero users / empty assignments (secure default admin-only)
    assert.strictEqual(buildCompositePolicyExpr([]), "is_account_group_member('admin')");
    assert.strictEqual(buildCompositePolicyExpr(null), "is_account_group_member('admin')");
  });

  // =========================================================================
  // 6. Multi-Level Role Inheritance (Depth >= 3) and Wildcard Override
  // =========================================================================
  await t.test('6. Multi-Level Role Inheritance (Depth >= 3) and Wildcard Override', () => {
    // Hierarchy setup:
    // Level 1: R_BASE (Single): Country = 'DE', Plant = '*', Status = 'ACTIVE'
    // Level 2: R_REGIONAL (Derived from R_BASE): Region = 'EU'
    // Level 3: R_LOCAL (Derived from R_REGIONAL): Plant = 'DE01'
    const allRoles = [
      { ID: 'R_BASE', name: 'Role Base', type: 'SINGLE', targetPlatform: 'DATABRICKS' },
      { ID: 'R_REGIONAL', name: 'Role Regional', type: 'DERIVED', targetPlatform: 'DATABRICKS' },
      { ID: 'R_LOCAL', name: 'Role Local', type: 'DERIVED', targetPlatform: 'DATABRICKS' }
    ];

    const allInheritances = [
      { role_ID: 'R_REGIONAL', parent_ID: 'R_BASE' },
      { role_ID: 'R_LOCAL', parent_ID: 'R_REGIONAL' }
    ];

    const allRestrictions = [
      { ID: 'restr-1', role_ID: 'R_BASE', field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' },
      { ID: 'restr-2', role_ID: 'R_BASE', field: 'Plant', filterType: 'CP', value: '*' },
      { ID: 'restr-3', role_ID: 'R_BASE', field: 'Status', filterType: 'SINGLE_VALUE', value: 'ACTIVE' },
      { ID: 'restr-4', role_ID: 'R_REGIONAL', field: 'Region', filterType: 'SINGLE_VALUE', value: 'EU' },
      { ID: 'restr-5', role_ID: 'R_LOCAL', field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' }
    ];

    // Resolve effective restrictions for R_LOCAL
    const resolvedLocal = resolveEffectiveRestrictions('R_LOCAL', allRoles, allRestrictions, allInheritances);

    // Assert: Plant wildcard '*' from R_BASE was DISCARDED because R_LOCAL defines Plant = 'DE01'
    const plantRestrictions = resolvedLocal.filter(r => r.field.toLowerCase() === 'plant');
    assert.strictEqual(plantRestrictions.length, 1);
    assert.strictEqual(plantRestrictions[0].value, 'DE01');
    assert.strictEqual(plantRestrictions[0].sourceRoleId, 'R_LOCAL');

    // Assert: Inherited non-wildcard restrictions from ancestors are preserved
    const countryRestr = resolvedLocal.find(r => r.field === 'Country');
    assert.ok(countryRestr);
    assert.strictEqual(countryRestr.value, 'DE');

    const statusRestr = resolvedLocal.find(r => r.field === 'Status');
    assert.ok(statusRestr);
    assert.strictEqual(statusRestr.value, 'ACTIVE');

    const regionRestr = resolvedLocal.find(r => r.field === 'Region');
    assert.ok(regionRestr);
    assert.strictEqual(regionRestr.value, 'EU');

    // Translate resolved restrictions into Databricks intra-role SQL
    const intraPred = buildIntraRolePredicate(resolvedLocal);
    assert.ok(intraPred.includes("Country = 'DE'"));
    assert.ok(intraPred.includes("Status = 'ACTIVE'"));
    assert.ok(intraPred.includes("Region = 'EU'"));
    assert.ok(intraPred.includes("Plant = 'DE01'"));
    assert.ok(!intraPred.includes("Plant LIKE '%'"));
  });

  // =========================================================================
  // 7. DDL Generation & Target Naming
  // =========================================================================
  await t.test('7. DDL Generation & Target Naming Resolution', () => {
    const naming = resolveTargetNaming('Finance_AP', { targetCatalog: 'lakehouse_prod', targetSchema: 'auth_security' });
    assert.strictEqual(naming.catalog, 'lakehouse_prod');
    assert.strictEqual(naming.schema, 'auth_security');
    assert.strictEqual(naming.targetTable, 'finance_ap_flat_authorizations');
    assert.strictEqual(naming.filterName, 'fn_filter_finance_ap');
    assert.strictEqual(naming.fullTableName, 'lakehouse_prod.auth_security.finance_ap_flat_authorizations');
    assert.strictEqual(naming.fullFuncName, 'lakehouse_prod.auth_security.fn_filter_finance_ap');

    const ddl = buildDatabricksRowFilterDdl({
      catalog: 'lakehouse_prod',
      schema: 'auth_security',
      domain: 'finance_ap',
      filterName: 'fn_filter_finance_ap',
      targetTable: 'finance_ap_flat_authorizations',
      columns: ['Company', 'CostCenter'],
      assignments: [
        {
          user: 'cfo@fanrio.corp',
          restrictions: [
            { field: 'Company', filterType: 'SINGLE_VALUE', value: '1000' },
            { field: 'CostCenter', filterType: 'RANGE', value: '{"from":"CC01","to":"CC05"}' }
          ]
        }
      ]
    });

    assert.ok(ddl.createFuncSql.startsWith('CREATE OR REPLACE FUNCTION lakehouse_prod.auth_security.fn_filter_finance_ap(Company STRING, CostCenter STRING)'));
    assert.ok(ddl.createFuncSql.includes("is_account_group_member('admin') OR"));
    assert.ok(ddl.createFuncSql.includes("current_user() = 'cfo@fanrio.corp' AND (Company = '1000' AND CostCenter BETWEEN 'CC01' AND 'CC05')"));
    assert.strictEqual(
      ddl.setFilterSql,
      'ALTER TABLE lakehouse_prod.auth_security.finance_ap_flat_authorizations SET ROW FILTER lakehouse_prod.auth_security.fn_filter_finance_ap ON (Company, CostCenter);'
    );
    assert.strictEqual(
      ddl.dropFilterSql,
      'ALTER TABLE lakehouse_prod.auth_security.finance_ap_flat_authorizations DROP ROW FILTER;'
    );
    assert.strictEqual(
      ddl.dropFuncSql,
      'DROP FUNCTION IF EXISTS lakehouse_prod.auth_security.fn_filter_finance_ap;'
    );
  });

  // =========================================================================
  // 8. Lifecycle: Direct Sync, Revocation & Clean Drop (Mock Adapter Recording)
  // =========================================================================
  await t.test('8. Lifecycle: Direct Sync, Revocation & Clean Drop with DatabricksMockAdapter', async () => {
    mockAdapter.reset();

    const ddl = buildDatabricksRowFilterDdl({
      catalog: 'main',
      schema: 'sales_schema',
      domain: 'orders',
      filterName: 'fn_filter_orders',
      targetTable: 'orders_flat_authorizations',
      columns: ['Region', 'Plant'],
      assignments: [
        {
          user: 'alice@fanrio.corp',
          restrictions: [
            { field: 'Region', filterType: 'SINGLE_VALUE', value: 'EMEA' },
            { field: 'Plant', filterType: 'SINGLE_VALUE', value: 'DE01' }
          ]
        }
      ]
    });

    // 1. Create function
    await DatabricksClient.executeStatement({
      warehouseId: 'wh-test-01',
      statement: ddl.createFuncSql,
      catalog: 'main',
      schema: 'sales_schema'
    });

    // 2. Attach row filter
    await DatabricksClient.executeStatement({
      warehouseId: 'wh-test-01',
      statement: ddl.setFilterSql,
      catalog: 'main',
      schema: 'sales_schema'
    });

    assert.strictEqual(mockAdapter.getExecutedStatements().length, 2);
    assert.ok(mockAdapter.filterFunctions.get('main.sales_schema.fn_filter_orders'));
    assert.ok(mockAdapter.appliedRowFilters.get('main.sales_schema.orders_flat_authorizations'));

    // 3. User B added: recreate function with both Alice and Bob
    const ddlUpdated = buildDatabricksRowFilterDdl({
      catalog: 'main',
      schema: 'sales_schema',
      domain: 'orders',
      filterName: 'fn_filter_orders',
      targetTable: 'orders_flat_authorizations',
      columns: ['Region', 'Plant'],
      assignments: [
        {
          user: 'alice@fanrio.corp',
          restrictions: [{ field: 'Region', filterType: 'SINGLE_VALUE', value: 'EMEA' }]
        },
        {
          user: 'bob@fanrio.corp',
          restrictions: [{ field: 'Region', filterType: 'SINGLE_VALUE', value: 'APAC' }]
        }
      ]
    });

    await DatabricksClient.executeStatement({
      warehouseId: 'wh-test-01',
      statement: ddlUpdated.createFuncSql,
      catalog: 'main',
      schema: 'sales_schema'
    });

    const updatedFn = mockAdapter.filterFunctions.get('main.sales_schema.fn_filter_orders');
    assert.ok(updatedFn);
    assert.ok(updatedFn.returnExpr.includes("current_user() = 'alice@fanrio.corp'"));
    assert.ok(updatedFn.returnExpr.includes("current_user() = 'bob@fanrio.corp'"));

    // 4. Revoke all users (0 users remain) -> Drop row filter and drop function
    await DatabricksClient.executeStatement({
      warehouseId: 'wh-test-01',
      statement: ddl.dropFilterSql,
      catalog: 'main',
      schema: 'sales_schema'
    });
    assert.strictEqual(mockAdapter.appliedRowFilters.get('main.sales_schema.orders_flat_authorizations'), undefined);

    await DatabricksClient.executeStatement({
      warehouseId: 'wh-test-01',
      statement: ddl.dropFuncSql,
      catalog: 'main',
      schema: 'sales_schema'
    });
    assert.strictEqual(mockAdapter.filterFunctions.get('main.sales_schema.fn_filter_orders'), undefined);
  });

  // =========================================================================
  // 9. Integration with In-Memory CAP Entities
  // =========================================================================
  await t.test('9. CAP Integration: syncAssignmentToDatabricks & removeAssignmentFromDatabricks', async () => {
    mockAdapter.reset();

    const cds = require('@sap/cds');
    const db = await cds.connect.to('db');
    const { Roles, AccessDomains, RoleAssignments, Restrictions } = db.entities;

    const unique = Date.now().toString().slice(-6) + '_' + Math.random().toString(36).slice(2, 6);
    const domainId = 'TEST_DOM_' + unique;
    const roleId = 'ROLE_TEST_' + unique;
    const restr1Id = 'restr-1-' + unique;
    const restr2Id = 'restr-2-' + unique;

    try {
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: 'TestDom',
        description: 'Test Access Domain',
        roleTemplateName: 'ROLE_TEMPLATE_TEST',
        targetPlatform: 'DATABRICKS'
      }));

      // Create test role targeting DATABRICKS
      await db.run(INSERT.into(Roles).entries({
        ID: roleId,
        name: 'ROLE_TEST_DB_' + unique,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      // Add restrictions for role
      await db.run(INSERT.into(Restrictions).entries({
        ID: restr1Id,
        role_ID: roleId,
        field: 'Country',
        filterType: 'SINGLE_VALUE',
        value: 'DE'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: restr2Id,
        role_ID: roleId,
        field: 'Plant',
        filterType: 'MULTI_VALUE',
        value: '["DE01","DE02"]'
      }));

      // 1. Assign User A
      const assignAId = 'assign-a-' + unique;
      await db.run(INSERT.into(RoleAssignments).entries({
        ID: assignAId,
        userId: 'user_a@fanrio.com',
        userName: 'User A',
        role_ID: roleId
      }));

      // Sync Assignment A to Databricks
      const syncResA = await syncAssignmentToDatabricks(assignAId, 'user_a@fanrio.com', roleId, false, cds, domainId);
    assert.strictEqual(syncResA.success, true);
    assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
    const fnRecord = mockAdapter.filterFunctions.get(`${syncResA.catalog}.${syncResA.schema}.${syncResA.functionName}`);
    assert.ok(fnRecord);
    assert.ok(fnRecord.returnExpr.includes("current_user() = 'user_a@fanrio.com'"));

    // 2. Assign User B
    const assignBId = 'assign-b-' + Date.now();
    await db.run(INSERT.into(RoleAssignments).entries({
      ID: assignBId,
      userId: 'user_b@fanrio.com',
      userName: 'User B',
      role_ID: roleId
    }));

    // Sync Assignment B to Databricks
    const syncResB = await syncAssignmentToDatabricks(assignBId, 'user_b@fanrio.com', roleId, false, cds, domainId);
    assert.strictEqual(syncResB.success, true);
    const fnRecord2 = mockAdapter.filterFunctions.get(`${syncResB.catalog}.${syncResB.schema}.${syncResB.functionName}`);
    assert.ok(fnRecord2.returnExpr.includes("current_user() = 'user_a@fanrio.com'"));
    assert.ok(fnRecord2.returnExpr.includes("current_user() = 'user_b@fanrio.com'"));

    // 3. Remove User A from DB & Databricks
    await db.delete(RoleAssignments).where({ ID: assignAId });
    const removeResA = await removeAssignmentFromDatabricks('user_a@fanrio.com', roleId, cds);
    assert.strictEqual(removeResA.success, true);
    assert.strictEqual(removeResA.dropped, false);
    assert.strictEqual(removeResA.remainingCount, 1);
    const fnRecord3 = mockAdapter.filterFunctions.get(removeResA.function);
    assert.ok(fnRecord3.returnExpr.includes("current_user() = 'user_b@fanrio.com'"));
    assert.ok(!fnRecord3.returnExpr.includes("current_user() = 'user_a@fanrio.com'"));

    // 4. Remove User B from DB & Databricks (0 users remain -> clean drop)
    await db.delete(RoleAssignments).where({ ID: assignBId });
    const removeResB = await removeAssignmentFromDatabricks('user_b@fanrio.com', roleId, cds);
    assert.strictEqual(removeResB.success, true);
    assert.strictEqual(removeResB.dropped, true);
    assert.strictEqual(removeResB.remainingCount, 0);

    // Verify row filter and function were completely dropped from Databricks mock
    assert.strictEqual(mockAdapter.appliedRowFilters.get(removeResB.table), undefined);
    assert.strictEqual(mockAdapter.filterFunctions.get(removeResB.function), undefined);

    // 5. Test AccessDomain provisioning (syncAccessDomainToDatabricks)
    const domainProvision = await syncAccessDomainToDatabricks(domainId, cds);
    assert.strictEqual(domainProvision.success, true);
    assert.ok(mockAdapter.executedStatements.some(s => s.statement.includes('CREATE SCHEMA IF NOT EXISTS')));
    assert.ok(mockAdapter.executedStatements.some(s => s.statement.includes('CREATE TABLE IF NOT EXISTS')));

    } finally {
      // Clean up DB test entries
      try { await db.delete(RoleAssignments).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Restrictions).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Roles).where({ ID: roleId }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

  // =========================================================================
  // 10. Role Cascade Synchronization (syncRoleToDatabricks)
  // =========================================================================
  await t.test('10. Role Cascade Synchronization & Platform Skipping', async () => {
    mockAdapter.reset();

    const cds = require('@sap/cds');
    const db = await cds.connect.to('db');
    const { Roles, RoleInheritance, AccessDomains } = db.entities;

    const unique = Date.now().toString().slice(-6) + '_' + Math.random().toString(36).slice(2, 6);
    const domainId = 'TEST_CASCADE_DOM_' + unique;
    const parentRoleId = 'PARENT_ROLE_' + unique;
    const childRoleId = 'CHILD_ROLE_' + unique;
    const dsRoleId = 'DS_ONLY_ROLE_' + unique;

    try {
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: 'CascadeDom',
        targetPlatform: 'DATABRICKS'
      }));

      // Parent role
      await db.run(INSERT.into(Roles).entries({
        ID: parentRoleId,
        name: 'PARENT_ROLE_' + unique,
        type: 'SINGLE',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      // Derived child role inheriting from parent
      await db.run(INSERT.into(Roles).entries({
        ID: childRoleId,
        name: 'CHILD_ROLE_' + unique,
        type: 'DERIVED',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(RoleInheritance).entries({
        role_ID: childRoleId,
        parent_ID: parentRoleId
      }));

      // DATASPHERE only role
      await db.run(INSERT.into(Roles).entries({
        ID: dsRoleId,
        name: 'DS_ROLE_' + unique,
        type: 'SINGLE',
        accessDomain_ID: domainId,
        targetPlatform: 'DATASPHERE'
      }));

      // 1. Sync parent role -> should collect parent and child derived role
      const cascadeRes = await syncRoleToDatabricks(parentRoleId, cds);
      assert.strictEqual(cascadeRes.success, true);
      assert.ok(cascadeRes.affectedRoleIds.includes(parentRoleId));
      assert.ok(cascadeRes.affectedRoleIds.includes(childRoleId));
      assert.ok(cascadeRes.domainsSynced.includes(domainId));

      // 2. Sync DATASPHERE role -> should skip Databricks sync
      const dsRes = await syncRoleToDatabricks(dsRoleId, cds);
      assert.strictEqual(dsRes.success, true);
      assert.strictEqual(dsRes.skipped, true);
      assert.strictEqual(dsRes.platform, 'DATASPHERE');

      const dsAssignRes = await syncAssignmentToDatabricks('assign-ds', 'user@ds.com', dsRoleId, false, cds);
      assert.strictEqual(dsAssignRes.success, true);
      assert.strictEqual(dsAssignRes.skipped, true);
      assert.strictEqual(dsAssignRes.platform, 'DATASPHERE');

    } finally {
      try { await db.delete(RoleInheritance).where({ role_ID: childRoleId }); } catch {}
      try { await db.delete(Roles).where({ ID: childRoleId }); } catch {}
      try { await db.delete(Roles).where({ ID: parentRoleId }); } catch {}
      try { await db.delete(Roles).where({ ID: dsRoleId }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

  // =========================================================================
  // 11. Domain Policy Sync Orchestrator (syncDatabricksPolicyForDomain)
  // =========================================================================
  await t.test('11. Domain Policy Sync Orchestrator (syncDatabricksPolicyForDomain)', async () => {
    mockAdapter.reset();

    const cds = require('@sap/cds');
    const db = await cds.connect.to('db');
    const { AccessDomains } = db.entities;

    const unique = Date.now().toString().slice(-6) + '_' + Math.random().toString(36).slice(2, 6);
    const domainId = 'TEST_ORCH_DOM_' + unique;
    const domainName = 'OrchDom_' + unique;

    try {
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: domainName,
        targetPlatform: 'DATABRICKS'
      }));

      // Empty domain (no assignments) -> drops row filter
      const res = await syncDatabricksPolicyForDomain({ domainName }, { cds });
      assert.strictEqual(res.success, true);
      assert.ok(res.actions.includes('DROPPED_ROW_FILTER'));
    } finally {
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

});
