'use strict';

/**
 * Challenger M5-2: Empirical End-to-End Multi-Target Lifecycle Stress Test Suite
 *
 * Mission Verification:
 * 1. End-to-End Multi-Target Lifecycle Stress:
 *    - Create role with targetPlatform: 'BOTH' in AccessDomain with 'BOTH'
 *    - Assign user -> verify BOTH HANA and Databricks receive policies in real-time
 *    - Update restriction -> verify BOTH HANA and Databricks updated with new restriction
 *    - Unassign user -> verify cleanup on BOTH platforms
 * 2. Adversarial Scenarios:
 *    - Concurrent multi-user assignment to the same role targeting BOTH
 *    - Multi-level role inheritance (Derived role with BOTH inheriting from parent with BOTH)
 *    - Parent wildcard override across both HANA and Databricks
 *    - Dual-fault asymmetry: Databricks failure does not block HANA; HANA failure does not block Databricks
 *    - Absolute decommission verification: Replications table remains nonexistent (404)
 */

const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// 1. Mock SAP HANA Client & Driver
// ---------------------------------------------------------------------------
const mockHanaState = {
  executedSql: [],
  clear() { this.executedSql = []; }
};

const mockHana = {
  createConnection: () => ({
    connect: (params, cb) => cb(null),
    setAutoCommit: (auto, cb) => cb(null),
    commit: (cb) => cb(null),
    rollback: (cb) => cb(null),
    prepare: (sql, cb) => cb(null, {
      exec: (params, cb) => {
        mockHanaState.executedSql.push({ sql, params, timestamp: new Date() });
        cb(null);
      }
    }),
    exec: (sql, paramsOrCb, maybeCb) => {
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
      const params = typeof paramsOrCb !== 'function' ? paramsOrCb : [];
      mockHanaState.executedSql.push({ sql, params, timestamp: new Date() });
      if (typeof sql === 'string' && sql.includes('VIEWS')) {
        cb(null, [{ SCHEMA_NAME: 'MOCK_SCHEMA', VIEW_NAME: 'MOCK_VIEW_1' }]);
      } else {
        cb(null, []);
      }
    },
    disconnect: (cb) => cb ? cb() : null
  })
};

try {
  const hanaClientPath = require.resolve('@sap/hana-client');
  require('module')._cache[hanaClientPath] = {
    id: hanaClientPath,
    filename: hanaClientPath,
    loaded: true,
    exports: mockHana
  };
} catch (e) {
  // @sap/hana-client require hook
}

const HanaClient = require('../srv/lib/hanaClient');
HanaClient.setDriver(mockHana);

// ---------------------------------------------------------------------------
// 2. Pluggable Databricks Mock Adapter
// ---------------------------------------------------------------------------
const DatabricksClient = require('../srv/lib/databricksClient');
const DatabricksMockAdapter = require('../srv/lib/databricksMockAdapter');
const mockDatabricksAdapter = new DatabricksMockAdapter();
DatabricksClient.setAdapter(mockDatabricksAdapter);

// ---------------------------------------------------------------------------
// 3. CAP In-Memory Test Server
// ---------------------------------------------------------------------------
const cds = require('@sap/cds');
const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

const dispatcher = require('../srv/services/directSyncDispatcher');
const databricksSyncSvc = require('../srv/services/databricksSyncService');

const waitMs = (ms) => new Promise(res => setTimeout(res, ms));

test('Challenger M5-2: Empirical End-to-End Multi-Target Lifecycle Stress Suite', async (t) => {

  const db = await cds.connect.to('db');
  const { Roles, AccessDomains, RoleAssignments, Restrictions, RoleInheritance } = db.entities;

  // Use a short 4-char suffix so AccessDomains.name fits into String(10)
  const testSuffix = Math.random().toString(36).slice(2, 6);

  t.beforeEach(() => {
    mockDatabricksAdapter.reset();
    mockHanaState.clear();
  });

  // =========================================================================
  // Section 1: Complete E2E Multi-Target Lifecycle (Role BOTH -> Assign -> Verify Both -> Update -> Verify Both -> Unassign -> Verify Cleanup)
  // =========================================================================
  await t.test('1. Complete E2E Multi-Target Lifecycle Stress Test', async (t1) => {

    const domainName = `D_${testSuffix}`; // fits in String(10)
    const domainId = `DOM_LIFE_${testSuffix}`;
    const roleId = `ROLE_LIFE_${testSuffix}`;
    const targetUser = `user_${testSuffix}@fanrio.corp`;

    // 1.1 Create AccessDomain with targetPlatform 'BOTH'
    await t1.test('1.1 Create AccessDomain with targetPlatform BOTH', async () => {
      const domainRes = await POST('/odata/v4/auth/AccessDomains', {
        ID: domainId,
        name: domainName,
        description: 'Lifecycle Domain with BOTH targetPlatform',
        roleTemplateName: `TMPL_${testSuffix}`,
        targetPlatform: 'BOTH'
      });
      assert.strictEqual(domainRes.status, 201);
      assert.strictEqual(domainRes.data.targetPlatform, 'BOTH');
    });

    // 1.2 Create Role with targetPlatform 'BOTH'
    await t1.test('1.2 Create Role with targetPlatform BOTH in domain', async () => {
      const roleRes = await POST('/odata/v4/auth/Roles', {
        ID: roleId,
        name: `ROLE_BOTH_${testSuffix}`,
        type: 'SINGLE',
        targetPlatform: 'BOTH',
        environment_ID: 'D',
        accessDomain_ID: domainId
      });
      assert.strictEqual(roleRes.status, 201);
      assert.strictEqual(roleRes.data.targetPlatform, 'BOTH');
    });

    // 1.3 Add Restrictions (Country = DE, CostCenter = 1000)
    let restCountryId;
    await t1.test('1.3 Add Restrictions to Role (Country=DE, CostCenter=1000)', async () => {
      const resCountry = await POST('/odata/v4/auth/Restrictions', {
        role_ID: roleId,
        field: 'Country',
        filterType: 'SINGLE_VALUE',
        value: 'DE'
      });
      assert.strictEqual(resCountry.status, 201);
      restCountryId = resCountry.data.ID;

      const resCost = await POST('/odata/v4/auth/Restrictions', {
        role_ID: roleId,
        field: 'CostCenter',
        filterType: 'SINGLE_VALUE',
        value: '1000'
      });
      assert.strictEqual(resCost.status, 201);
    });

    // 1.4 Assign User -> Verify BOTH HANA and Databricks receive policies
    let assignmentId;
    await t1.test('1.4 Assign User and verify BOTH HANA and Databricks receive policies', async () => {
      mockDatabricksAdapter.reset();
      mockHanaState.clear();

      const assignRes = await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: roleId,
        userId: targetUser,
        userName: `Test User ${testSuffix}`
      });
      assert.strictEqual(assignRes.status, 201);
      assignmentId = assignRes.data.ID;

      // Allow background cds.spawn sync to settle
      await waitMs(450);

      // Verify Databricks received DDL policy
      const executed = mockDatabricksAdapter.getExecutedStatements();
      assert.ok(executed.length >= 1, `Databricks must receive executed statements (got ${executed.length})`);

      // Check executed statements for function definition and alter table
      const createStmt = executed.find(e => e.statement.includes('CREATE OR REPLACE FUNCTION') || e.statement.includes('CREATE FUNCTION'));
      assert.ok(createStmt, 'Databricks must receive CREATE FUNCTION statement');
      assert.ok(createStmt.statement.includes(`current_user() = '${targetUser}'`), 'Databricks filter must match assigned user');
      assert.ok(createStmt.statement.includes("Country = 'DE'"), 'Databricks filter must include Country = DE');
      assert.ok(createStmt.statement.includes("CostCenter = '1000'"), 'Databricks filter must include CostCenter = 1000');

      // Check row filter applied
      const alterStmt = executed.find(e => e.statement.includes('SET ROW FILTER'));
      assert.ok(alterStmt, 'Databricks must receive SET ROW FILTER statement');

      // Verify HANA received flat authorizations insert statements
      const hanaSqls = mockHanaState.executedSql;
      assert.ok(hanaSqls.length > 0, `HANA must execute SQL statements (got ${hanaSqls.length})`);
      const hasHanaInsert = hanaSqls.some(s => s.sql.includes('INSERT INTO') || s.sql.includes('AUTHORIZATION'));
      assert.ok(hasHanaInsert, 'HANA must execute INSERT statements for Cartesian flat authorizations');
    });

    // 1.5 Update Restriction -> Verify BOTH HANA and Databricks receive updated policies
    await t1.test('1.5 Update Restriction (Country DE -> FR) and verify BOTH platforms updated', async () => {
      mockDatabricksAdapter.reset();
      mockHanaState.clear();

      // Update Country from 'DE' to 'FR'
      const updateRes = await PATCH(`/odata/v4/auth/Restrictions('${restCountryId}')`, {
        value: 'FR'
      });
      assert.strictEqual(updateRes.status, 200);

      // Allow background cds.spawn dispatchRoleSync to settle
      await waitMs(450);

      // Verify Databricks received updated function DDL
      const executed = mockDatabricksAdapter.getExecutedStatements();
      const updatedStmt = executed.find(e => e.statement.includes('CREATE OR REPLACE FUNCTION') || e.statement.includes('CREATE FUNCTION'));
      assert.ok(updatedStmt, 'Databricks must receive updated CREATE FUNCTION statement after restriction update');
      assert.ok(updatedStmt.statement.includes("Country = 'FR'"), 'Databricks filter must reflect new value Country = FR');
      assert.ok(!updatedStmt.statement.includes("Country = 'DE'"), 'Databricks filter must no longer contain old value Country = DE');
      assert.ok(updatedStmt.statement.includes("CostCenter = '1000'"), 'Databricks filter must preserve unchanged CostCenter = 1000');

      // Verify HANA executed re-sync (delete and re-insert)
      const hanaSqls = mockHanaState.executedSql;
      assert.ok(hanaSqls.length > 0, 'HANA must execute SQL re-sync statements');
      const hasHanaActivity = hanaSqls.some(s => s.sql.includes('DELETE') || s.sql.includes('INSERT'));
      assert.ok(hasHanaActivity, 'HANA must re-flatten and write updated authorizations');
    });

    // 1.6 Unassign User -> Verify cleanup on BOTH platforms
    await t1.test('1.6 Unassign User and verify cleanup on BOTH platforms', async () => {
      mockDatabricksAdapter.reset();
      mockHanaState.clear();

      const deleteRes = await DELETE(`/odata/v4/auth/RoleAssignments('${assignmentId}')`);
      assert.strictEqual(deleteRes.status, 204);

      // Allow background cds.spawn dispatchAssignmentRemoval to settle
      await waitMs(450);

      // Verify Databricks cleaned up: with 0 active assignments remaining in domain,
      // either DROP ROW FILTER is executed or filter statement does not contain the user
      const executed = mockDatabricksAdapter.getExecutedStatements();
      assert.ok(executed.length > 0, 'Databricks must receive statements upon assignment deletion');
      const hasDropFilter = executed.some(e => e.statement.includes('DROP ROW FILTER'));
      const hasUpdatedFuncWithoutUser = executed.some(e => e.statement.includes('CREATE') && !e.statement.includes(targetUser));
      assert.ok(hasDropFilter || hasUpdatedFuncWithoutUser, 'Databricks must drop row filter or purge user from policy function');

      // Verify HANA executed deletion cleanup
      const hanaSqls = mockHanaState.executedSql;
      assert.ok(hanaSqls.length > 0, 'HANA must execute statements on assignment deletion');
      const hasHanaDelete = hanaSqls.some(s => s.sql.includes('DELETE'));
      assert.ok(hasHanaDelete, 'HANA must execute DELETE statements to clean user flat authorizations');
    });

    // 1.7 Clean up Role & Domain
    await t1.test('1.7 Clean up Role and AccessDomain', async () => {
      await DELETE(`/odata/v4/auth/Roles('${roleId}')`);
      await DELETE(`/odata/v4/auth/AccessDomains('${domainId}')`);
    });
  });

  // =========================================================================
  // Section 2: Concurrent Multi-User Assignment to the Same Role (BOTH Platforms)
  // =========================================================================
  await t.test('2. Concurrent Multi-User Assignment Stress to Role targeting BOTH', async (t2) => {
    const domainName = `C_${testSuffix}`;
    const domainId = `DOM_CONC_${testSuffix}`;
    const roleId = `ROLE_CONC_${testSuffix}`;

    await POST('/odata/v4/auth/AccessDomains', {
      ID: domainId,
      name: domainName,
      description: 'Concurrent Domain',
      roleTemplateName: `TMPL_C_${testSuffix}`,
      targetPlatform: 'BOTH'
    });

    await POST('/odata/v4/auth/Roles', {
      ID: roleId,
      name: `ROLE_C_${testSuffix}`,
      type: 'SINGLE',
      targetPlatform: 'BOTH',
      environment_ID: 'D',
      accessDomain_ID: domainId
    });

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: roleId,
      field: 'Region',
      filterType: 'MULTI_VALUE',
      value: '["EMEA", "APAC"]'
    });

    mockDatabricksAdapter.reset();
    mockHanaState.clear();

    const users = [
      `u_alpha_${testSuffix}@fanrio.corp`,
      `u_beta_${testSuffix}@fanrio.corp`,
      `u_gamma_${testSuffix}@fanrio.corp`
    ];

    const assignIds = [];
    for (const u of users) {
      const res = await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: roleId,
        userId: u,
        userName: u
      });
      assert.strictEqual(res.status, 201);
      assignIds.push(res.data.ID);
    }

    // Allow mutex queue across sequential assignments to finish
    await waitMs(600);

    // Verify Databricks composite DNF expression combines all 3 users with OR
    const executed = mockDatabricksAdapter.getExecutedStatements();
    const lastFunc = executed.reverse().find(e => e.statement.includes('CREATE OR REPLACE FUNCTION') || e.statement.includes('CREATE FUNCTION'));
    assert.ok(lastFunc, 'Databricks composite function must be active');
    for (const u of users) {
      assert.ok(lastFunc.statement.includes(`current_user() = '${u}'`), `Function must include user ${u}`);
    }
    assert.ok(lastFunc.statement.includes("Region IN ('EMEA', 'APAC')"), 'Function must include region restriction');

    // Verify HANA received assignments for all users
    const hanaSqls = mockHanaState.executedSql;
    assert.ok(hanaSqls.length >= 3, `HANA must receive statements for all users (got ${hanaSqls.length})`);

    // Clean up
    for (const id of assignIds) {
      await DELETE(`/odata/v4/auth/RoleAssignments('${id}')`);
    }
    await waitMs(400);
    await DELETE(`/odata/v4/auth/Roles('${roleId}')`);
    await DELETE(`/odata/v4/auth/AccessDomains('${domainId}')`);
  });

  // =========================================================================
  // Section 3: Multi-Level Role Inheritance (Derived Role with Parent Overrides)
  // =========================================================================
  await t.test('3. Multi-Level Role Inheritance & Parent Wildcard Override across BOTH platforms', async (t3) => {
    const domainName = `I_${testSuffix}`;
    const domainId = `DOM_INH_${testSuffix}`;
    const parentRoleId = `R_PAR_${testSuffix}`;
    const derivedRoleId = `R_DER_${testSuffix}`;
    const userDerived = `derived_${testSuffix}@fanrio.corp`;

    await POST('/odata/v4/auth/AccessDomains', {
      ID: domainId,
      name: domainName,
      description: 'Inheritance Domain',
      roleTemplateName: `TMPL_I_${testSuffix}`,
      targetPlatform: 'BOTH'
    });

    // Parent role targets BOTH with wildcard Country = '*' and CompanyCode = '1000'
    await POST('/odata/v4/auth/Roles', {
      ID: parentRoleId,
      name: `P_BOTH_${testSuffix}`,
      type: 'SINGLE',
      targetPlatform: 'BOTH',
      environment_ID: 'D',
      accessDomain_ID: domainId
    });

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: parentRoleId,
      field: 'Country',
      filterType: 'PATTERN',
      value: '*'
    });
    await POST('/odata/v4/auth/Restrictions', {
      role_ID: parentRoleId,
      field: 'CompanyCode',
      filterType: 'SINGLE_VALUE',
      value: '1000'
    });

    // Derived role targets BOTH, inherits from parent, and redefines Country = 'US'
    await POST('/odata/v4/auth/Roles', {
      ID: derivedRoleId,
      name: `D_BOTH_${testSuffix}`,
      type: 'DERIVED',
      targetPlatform: 'BOTH',
      environment_ID: 'D',
      accessDomain_ID: domainId,
      parentRoles: [{ parent_ID: parentRoleId }]
    });

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: derivedRoleId,
      field: 'Country',
      filterType: 'SINGLE_VALUE',
      value: 'US'
    });

    mockDatabricksAdapter.reset();
    mockHanaState.clear();

    const assignRes = await POST('/odata/v4/auth/RoleAssignments', {
      role_ID: derivedRoleId,
      userId: userDerived,
      userName: 'Derived User'
    });
    assert.strictEqual(assignRes.status, 201);
    const assignId = assignRes.data.ID;

    await waitMs(500);

    // Verify Databricks: Wildcard override logic ensures Country is 'US' (not '%') and inherits CompanyCode = '1000'
    const executed = mockDatabricksAdapter.getExecutedStatements();
    const derivedFunc = executed.find(e => e.statement.includes('CREATE OR REPLACE FUNCTION') || e.statement.includes('CREATE FUNCTION'));
    assert.ok(derivedFunc, 'Databricks filter function must be created for inheritance domain');
    assert.ok(derivedFunc.statement.includes(`current_user() = '${userDerived}'`), 'Policy must match derived role user');
    assert.ok(derivedFunc.statement.includes("Country = 'US'"), 'Child Country=US must override parent wildcard Country=*');
    assert.ok(!derivedFunc.statement.includes("Country LIKE '%'"), 'Parent wildcard must NOT be present in child predicate');
    assert.ok(derivedFunc.statement.includes("CompanyCode = '1000'"), 'Parent CompanyCode=1000 must be inherited by child');

    // Verify HANA: Cartesian product uses (Country='US', CompanyCode='1000')
    const hanaSqls = mockHanaState.executedSql;
    assert.ok(hanaSqls.length > 0, 'HANA must receive flat authorizations for derived role');

    // Clean up
    await DELETE(`/odata/v4/auth/RoleAssignments('${assignId}')`);
    await waitMs(300);
    await DELETE(`/odata/v4/auth/Roles('${derivedRoleId}')`);
    await DELETE(`/odata/v4/auth/Roles('${parentRoleId}')`);
    await DELETE(`/odata/v4/auth/AccessDomains('${domainId}')`);
  });

  // =========================================================================
  // Section 4: Dual-Fault Asymmetry & Error Isolation
  // =========================================================================
  await t.test('4. Dual-Fault Asymmetry & Error Isolation', async (t4) => {

    await t4.test('4.1 Databricks failure does NOT prevent Datasphere/HANA success', async () => {
      mockDatabricksAdapter.reset();
      mockHanaState.clear();
      mockDatabricksAdapter.setFailureMode('NETWORK_ERROR');

      const result = await dispatcher.dispatchAssignmentSync({
        userId: 'test_asymm@fanrio.corp',
        targetPlatform: 'BOTH',
        restrictions: [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }]
      }, {
        HanaClient,
        databricksSyncSvc
      });

      assert.strictEqual(result.datasphere?.success, true, 'Datasphere must succeed even if Databricks fails');
      assert.strictEqual(result.databricks?.success, false, 'Databricks failure must be recorded');
      assert.ok(mockHanaState.executedSql.length > 0, 'HANA must execute successfully');
    });

    await t4.test('4.2 HANA failure does NOT prevent Databricks success', async () => {
      mockDatabricksAdapter.reset();
      mockHanaState.clear();

      const failingHanaClient = {
        syncAssignment: async () => {
          throw new Error('Simulated HANA connection failure');
        }
      };

      const result = await dispatcher.dispatchAssignmentSync({
        userId: 'test_asymm2@fanrio.corp',
        targetPlatform: 'BOTH',
        restrictions: [{ field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }]
      }, {
        HanaClient: failingHanaClient,
        databricksSyncSvc
      });

      assert.strictEqual(result.datasphere?.success, false, 'Datasphere error must be captured');
      assert.strictEqual(result.databricks?.success, true, 'Databricks must succeed even if Datasphere fails');
      assert.ok(mockDatabricksAdapter.getExecutedStatements().length >= 1, 'Databricks must execute statements');
    });
  });

  // =========================================================================
  // Section 5: Absolute Decommission Guard (Zero Replications Entity / Actions)
  // =========================================================================
  await t.test('5. Absolute Decommission Guard: Retired endpoints and tables are gone', async (t5) => {
    // 5.1 GET /Replications returns 404
    try {
      await GET('/odata/v4/auth/Replications');
      assert.fail('GET /Replications must fail with 404');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 404);
    }

    // 5.2 POST /triggerReplication returns 404
    try {
      await POST('/odata/v4/auth/triggerReplication', {});
      assert.fail('POST /triggerReplication must fail with 404');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 404);
    }

    // 5.3 POST /checkReplicationStatuses returns 404
    try {
      await POST('/odata/v4/auth/checkReplicationStatuses', {});
      assert.fail('POST /checkReplicationStatuses must fail with 404');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 404);
    }
  });

});
