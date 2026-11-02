'use strict';

/**
 * Empirical Stress Test Suite — Challenger 2 (Milestone 2)
 *
 * Focus Areas:
 * 1. Multi-user concurrent policy updates across the same access domain.
 * 2. Full lifecycle: adding user 1, adding user 2, updating user 1's role, removing user 1, removing user 2.
 * 3. Exact DDL statement verification in DatabricksMockAdapter:
 *    - CREATE OR REPLACE FUNCTION on updates
 *    - ALTER TABLE ... SET ROW FILTER on attachment
 *    - ALTER TABLE ... DROP ROW FILTER followed by DROP FUNCTION IF EXISTS when 0 users remain
 * 4. Table naming, function naming, special characters, and sanitized domains.
 * 5. Error handling, adapter failure modes, and platform skipping.
 */

// ---------------------------------------------------------------------------
// 1. Mock @sap/hana-client
// ---------------------------------------------------------------------------
const mockHana = {
  createConnection: () => ({
    connect: (params, cb) => cb(null),
    setAutoCommit: (auto, cb) => cb(null),
    commit: (cb) => cb(null),
    rollback: (cb) => cb(null),
    prepare: (sql, cb) => cb(null, {
      exec: (params, cb) => cb(null)
    }),
    exec: (sql, paramsOrCb, maybeCb) => {
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
      cb(null, []);
    },
    disconnect: (cb) => cb ? cb() : null
  })
};

require('module')._cache[require.resolve('@sap/hana-client')] = {
  id: require.resolve('@sap/hana-client'),
  filename: require.resolve('@sap/hana-client'),
  loaded: true,
  exports: mockHana
};

const HanaClient = require('../srv/lib/hanaClient');
HanaClient.setDriver(mockHana);

// ---------------------------------------------------------------------------
// 2. Test Imports & Bootstrap
// ---------------------------------------------------------------------------
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const cds = require('@sap/cds');

// Boot CAP test environment
const { GET, POST, PATCH, DELETE } = cds.test(path.resolve(__dirname, '..'));

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
  resolveDatabricksSettings,
  buildDatabricksRowFilterDdl,
  syncRoleToDatabricks,
  syncAssignmentToDatabricks,
  removeAssignmentFromDatabricks,
  syncAccessDomainToDatabricks,
  syncDatabricksPolicyForDomain
} = require('../srv/services/databricksSyncService');

test('Challenger 2 Empirical Stress Tests: Databricks Policy Sync Lifecycle & Concurrency', async (t) => {
  const mockAdapter = new DatabricksMockAdapter();
  DatabricksClient.setAdapter(mockAdapter);

  const db = await cds.connect.to('db');
  const { Roles, AccessDomains, RoleAssignments, Restrictions, RoleInheritance, DatabricksSettings } = db.entities;

  t.beforeEach(() => {
    mockAdapter.reset();
  });

  t.after(() => {
    DatabricksClient.resetAdapter();
  });

  // =========================================================================
  // SUITE 1: Multi-User Concurrent Policy Updates Across Same Access Domain
  // =========================================================================
  await t.test('1. Multi-User Concurrent Policy Updates across the Same Domain', async (st) => {
    const unique = `conc_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const domainId = `DOM_${unique}`;
    const domainName = `ConcurrentDomain_${unique}`;
    const roleId = `ROLE_${unique}`;

    try {
      // 1. Setup domain and role targeting DATABRICKS
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: domainName,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Roles).entries({
        ID: roleId,
        name: `ROLE_CONC_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_${unique}`,
        role_ID: roleId,
        field: 'Region',
        filterType: 'SINGLE_VALUE',
        value: 'EMEA'
      }));

      // 1.1 Test 10 concurrent assignment syncs on the same domain
      const USER_COUNT = 10;
      const userIds = Array.from({ length: USER_COUNT }, (_, i) => `user_${i}_${unique}@fanrio.corp`);
      const assignmentIds = [];

      for (let i = 0; i < USER_COUNT; i++) {
        const aId = `assign_${i}_${unique}`;
        assignmentIds.push(aId);
        await db.run(INSERT.into(RoleAssignments).entries({
          ID: aId,
          userId: userIds[i],
          userName: `User ${i}`,
          role_ID: roleId
        }));
      }

      // Execute all 10 sync calls concurrently using Promise.all
      const syncPromises = userIds.map((uId, i) =>
        syncAssignmentToDatabricks(assignmentIds[i], uId, roleId, false, cds, domainId)
      );
      const results = await Promise.all(syncPromises);

      // Verify all concurrent operations succeeded without rejecting
      for (const res of results) {
        assert.strictEqual(res.success, true, 'Concurrent sync must succeed');
      }

      // Verify DatabricksMockAdapter captured all statements safely
      const naming = resolveTargetNaming(domainName, { targetCatalog: 'main', targetSchema: 'default' });
      const fn = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(fn, `Function ${naming.fullFuncName} must exist in mock adapter`);

      // Verify that the final filter function return expression contains ALL 10 users
      for (const uId of userIds) {
        assert.ok(
          fn.returnExpr.includes(`current_user() = '${uId}'`),
          `Policy expression must include user ${uId}`
        );
      }

      // Verify table row filter is attached
      const rowFilter = mockAdapter.appliedRowFilters.get(naming.fullTableName);
      assert.ok(rowFilter, `Table ${naming.fullTableName} must have active row filter`);
      assert.strictEqual(rowFilter.filterFunction, naming.fullFuncName);

      // 1.2 Test concurrent mixed updates and removals:
      // Remove 3 users concurrently while syncing 2 remaining users
      const usersToRemove = userIds.slice(0, 3);
      for (let i = 0; i < 3; i++) {
        await db.delete(RoleAssignments).where({ ID: assignmentIds[i] });
      }

      const mixedPromises = [
        removeAssignmentFromDatabricks(usersToRemove[0], roleId, cds),
        removeAssignmentFromDatabricks(usersToRemove[1], roleId, cds),
        removeAssignmentFromDatabricks(usersToRemove[2], roleId, cds),
        syncAssignmentToDatabricks(assignmentIds[3], userIds[3], roleId, false, cds, domainId)
      ];

      const mixedResults = await Promise.all(mixedPromises);
      for (const mr of mixedResults) {
        assert.strictEqual(mr.success, true, 'Mixed concurrent operations must succeed');
      }

      // Re-query current policy state
      const finalFn = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(finalFn, 'Function must still be present after partial removals');

      // The removed users must not be in the final expression
      for (const uId of usersToRemove) {
        assert.ok(
          !finalFn.returnExpr.includes(`current_user() = '${uId}'`),
          `Removed user ${uId} must not be present in policy expression`
        );
      }

      // Remaining users must still be present
      assert.ok(
        finalFn.returnExpr.includes(`current_user() = '${userIds[3]}'`),
        `Retained user ${userIds[3]} must remain in policy expression`
      );

    } finally {
      try { await db.delete(RoleAssignments).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Restrictions).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Roles).where({ ID: roleId }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

  // =========================================================================
  // SUITE 2: Full Lifecycle Sequence (Add U1 -> Add U2 -> Update U1 -> Remove U1 -> Remove U2)
  // =========================================================================
  await t.test('2. Full Lifecycle Sequence with State Transitions & Complete Revocation', async (st) => {
    mockAdapter.reset();

    const unique = `lc_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const domainId = `DOM_LC_${unique}`;
    const domainName = `LifecycleDom_${unique}`;
    const role1Id = `ROLE_1_${unique}`;
    const role1UpdatedId = `ROLE_1_V2_${unique}`;
    const role2Id = `ROLE_2_${unique}`;
    const u1 = `user1_${unique}@fanrio.corp`;
    const u2 = `user2_${unique}@fanrio.corp`;

    try {
      // 0. Initial State: Access Domain created, 0 users
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: domainName,
        targetPlatform: 'DATABRICKS'
      }));

      const naming = resolveTargetNaming(domainName, { targetCatalog: 'main', targetSchema: 'default' });
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);

      // Setup Role 1: Country = 'DE', Plant IN ('DE01', 'DE02')
      await db.run(INSERT.into(Roles).entries({
        ID: role1Id,
        name: `ROLE_1_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_1a_${unique}`,
        role_ID: role1Id,
        field: 'Country',
        filterType: 'SINGLE_VALUE',
        value: 'DE'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_1b_${unique}`,
        role_ID: role1Id,
        field: 'Plant',
        filterType: 'MULTI_VALUE',
        value: '["DE01","DE02"]'
      }));

      // Setup Role 2: Region = 'APAC'
      await db.run(INSERT.into(Roles).entries({
        ID: role2Id,
        name: `ROLE_2_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_2_${unique}`,
        role_ID: role2Id,
        field: 'Region',
        filterType: 'SINGLE_VALUE',
        value: 'APAC'
      }));

      // -----------------------------------------------------------------------
      // Step 2.1: Add User 1
      // -----------------------------------------------------------------------
      const assign1Id = `assign_u1_${unique}`;
      await db.run(INSERT.into(RoleAssignments).entries({
        ID: assign1Id,
        userId: u1,
        userName: 'User 1',
        role_ID: role1Id
      }));

      const sync1Res = await syncAssignmentToDatabricks(assign1Id, u1, role1Id, false, cds, domainId);
      assert.strictEqual(sync1Res.success, true);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      const fn1 = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(fn1);
      assert.ok(fn1.returnExpr.includes(`current_user() = '${u1}'`));
      assert.ok(fn1.returnExpr.includes("Country = 'DE'"));
      assert.ok(fn1.returnExpr.includes("Plant IN ('DE01', 'DE02')"));
      assert.ok(!fn1.returnExpr.includes(`current_user() = '${u2}'`));

      const filter1 = mockAdapter.appliedRowFilters.get(naming.fullTableName);
      assert.ok(filter1);
      assert.strictEqual(filter1.filterFunction, naming.fullFuncName);

      // -----------------------------------------------------------------------
      // Step 2.2: Add User 2
      // -----------------------------------------------------------------------
      const assign2Id = `assign_u2_${unique}`;
      await db.run(INSERT.into(RoleAssignments).entries({
        ID: assign2Id,
        userId: u2,
        userName: 'User 2',
        role_ID: role2Id
      }));

      const sync2Res = await syncAssignmentToDatabricks(assign2Id, u2, role2Id, false, cds, domainId);
      assert.strictEqual(sync2Res.success, true);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
      assert.strictEqual(mockAdapter.filterFunctions.size, 1);

      const fn2 = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(fn2);
      assert.ok(fn2.returnExpr.includes(`current_user() = '${u1}'`));
      assert.ok(fn2.returnExpr.includes(`current_user() = '${u2}'`));
      assert.ok(fn2.returnExpr.includes("Region = 'APAC'"));

      // -----------------------------------------------------------------------
      // Step 2.3: Update User 1's Role
      // Change User 1's assignment to ROLE_1_V2 (Country = 'FR', CompanyCode = '1000')
      // -----------------------------------------------------------------------
      await db.run(INSERT.into(Roles).entries({
        ID: role1UpdatedId,
        name: `ROLE_1_V2_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_1v2_a_${unique}`,
        role_ID: role1UpdatedId,
        field: 'Country',
        filterType: 'SINGLE_VALUE',
        value: 'FR'
      }));
      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_1v2_b_${unique}`,
        role_ID: role1UpdatedId,
        field: 'CompanyCode',
        filterType: 'SINGLE_VALUE',
        value: '1000'
      }));

      // Update User 1's assignment in DB
      await db.update(RoleAssignments).set({ role_ID: role1UpdatedId }).where({ ID: assign1Id });

      // Re-sync User 1
      const syncUpdateRes = await syncAssignmentToDatabricks(assign1Id, u1, role1UpdatedId, false, cds, domainId);
      assert.strictEqual(syncUpdateRes.success, true);

      const fnUpdate = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(fnUpdate);
      // User 1 must now have FR and 1000, not old DE/Plant
      assert.ok(fnUpdate.returnExpr.includes("Country = 'FR'"), 'Must include new Country FR');
      assert.ok(fnUpdate.returnExpr.includes("CompanyCode = '1000'"), 'Must include new CompanyCode 1000');
      assert.ok(!fnUpdate.returnExpr.includes("Country = 'DE'"), 'Must not include old Country DE');
      assert.ok(!fnUpdate.returnExpr.includes("Plant IN ('DE01', 'DE02')"), 'Must not include old Plant IN');
      // User 2 must still remain untouched
      assert.ok(fnUpdate.returnExpr.includes(`current_user() = '${u2}'`), 'User 2 must remain');
      assert.ok(fnUpdate.returnExpr.includes("Region = 'APAC'"), 'User 2 Region must remain');

      // -----------------------------------------------------------------------
      // Step 2.4: Remove User 1 (1 user remains)
      // -----------------------------------------------------------------------
      await db.delete(RoleAssignments).where({ ID: assign1Id });

      const remove1Res = await removeAssignmentFromDatabricks(u1, role1UpdatedId, cds);
      assert.strictEqual(remove1Res.success, true);
      assert.strictEqual(remove1Res.dropped, false, 'Should not drop when users remain');
      assert.strictEqual(remove1Res.remainingCount, 1, 'Exactly 1 user must remain');

      const fnAfterRemove1 = mockAdapter.filterFunctions.get(naming.fullFuncName);
      assert.ok(fnAfterRemove1, 'Filter function must still exist');
      assert.ok(!fnAfterRemove1.returnExpr.includes(`current_user() = '${u1}'`), 'User 1 must be removed');
      assert.ok(fnAfterRemove1.returnExpr.includes(`current_user() = '${u2}'`), 'User 2 must be present');
      // Row filter must remain attached
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 1);
      assert.ok(mockAdapter.appliedRowFilters.has(naming.fullTableName));

      // -----------------------------------------------------------------------
      // Step 2.5: Remove User 2 (0 users remain -> complete clean drop)
      // -----------------------------------------------------------------------
      await db.delete(RoleAssignments).where({ ID: assign2Id });

      const remove2Res = await removeAssignmentFromDatabricks(u2, role2Id, cds);
      assert.strictEqual(remove2Res.success, true);
      assert.strictEqual(remove2Res.dropped, true, 'Must drop when 0 users remain');
      assert.strictEqual(remove2Res.remainingCount, 0);

      // Verify that appliedRowFilters and filterFunctions were deleted in mock adapter
      assert.strictEqual(mockAdapter.appliedRowFilters.get(naming.fullTableName), undefined);
      assert.strictEqual(mockAdapter.filterFunctions.get(naming.fullFuncName), undefined);
      assert.strictEqual(mockAdapter.appliedRowFilters.size, 0);
      assert.strictEqual(mockAdapter.filterFunctions.size, 0);

    } finally {
      try { await db.delete(RoleAssignments).where({ role_ID: { in: [role1Id, role1UpdatedId, role2Id] } }); } catch {}
      try { await db.delete(Restrictions).where({ role_ID: { in: [role1Id, role1UpdatedId, role2Id] } }); } catch {}
      try { await db.delete(Roles).where({ ID: { in: [role1Id, role1UpdatedId, role2Id] } }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

  // =========================================================================
  // SUITE 3: DatabricksMockAdapter DDL Statements Exact Verification
  // =========================================================================
  await t.test('3. Exact DDL Statement Verification in DatabricksMockAdapter', async (st) => {
    mockAdapter.reset();

    const unique = `ddl_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const domainId = `DOM_DDL_${unique}`;
    const domainName = `DDLDomain_${unique}`;
    const roleId = `ROLE_DDL_${unique}`;
    const userId = `admin_tester_${unique}@fanrio.corp`;

    try {
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: domainName,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Roles).entries({
        ID: roleId,
        name: `ROLE_DDL_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_ddl_${unique}`,
        role_ID: roleId,
        field: 'Plant',
        filterType: 'SINGLE_VALUE',
        value: 'DE10'
      }));

      const assignId = `assign_ddl_${unique}`;
      await db.run(INSERT.into(RoleAssignments).entries({
        ID: assignId,
        userId: userId,
        userName: 'Admin Tester',
        role_ID: roleId
      }));

      // 3.1 Verify statements on syncAssignmentToDatabricks
      mockAdapter.executedStatements = [];
      await syncAssignmentToDatabricks(assignId, userId, roleId, false, cds, domainId);

      const stmts = mockAdapter.getExecutedStatements();
      assert.strictEqual(stmts.length, 2, 'Exactly 2 DDL statements expected on creation');

      // Statement 1: CREATE OR REPLACE FUNCTION
      const stmt1 = stmts[0].statement;
      assert.ok(stmt1.startsWith('CREATE OR REPLACE FUNCTION'), 'First statement must be CREATE OR REPLACE FUNCTION');
      assert.ok(stmt1.includes(`main.default.fn_filter_${sanitizeDomainName(domainName)}`), 'Must target full function name');
      assert.ok(stmt1.includes('Plant STRING'), 'Parameter signature must have Plant STRING');
      assert.ok(stmt1.includes('RETURN'), 'Must contain RETURN clause');
      assert.ok(stmt1.includes("is_account_group_member('admin')"), 'Must include admin group bypass');
      assert.ok(stmt1.includes(`current_user() = '${userId}'`), 'Must bind user identity');
      assert.ok(stmt1.includes("Plant = 'DE10'"), 'Must contain Plant predicate');

      // Statement 2: ALTER TABLE ... SET ROW FILTER
      const stmt2 = stmts[1].statement;
      assert.ok(stmt2.startsWith('ALTER TABLE'), 'Second statement must be ALTER TABLE');
      assert.ok(stmt2.includes(`main.default.${sanitizeDomainName(domainName)}_flat_authorizations`), 'Must target full table name');
      assert.ok(stmt2.includes(`SET ROW FILTER main.default.fn_filter_${sanitizeDomainName(domainName)}`), 'Must SET ROW FILTER');
      assert.ok(stmt2.endsWith('ON (Plant);'), 'Must specify ON (Plant);');

      // 3.2 Verify statements on partial removal (adding a second user, then removing first)
      const user2Id = `user2_${unique}@fanrio.corp`;
      const assign2Id = `assign_ddl_2_${unique}`;
      await db.run(INSERT.into(RoleAssignments).entries({
        ID: assign2Id,
        userId: user2Id,
        userName: 'User 2',
        role_ID: roleId
      }));

      await syncAssignmentToDatabricks(assign2Id, user2Id, roleId, false, cds, domainId);

      // Reset statement tracker to inspect removeAssignmentFromDatabricks when users remain
      mockAdapter.executedStatements = [];
      await db.delete(RoleAssignments).where({ ID: assignId });
      const remove1Res = await removeAssignmentFromDatabricks(userId, roleId, cds);
      assert.strictEqual(remove1Res.dropped, false);

      const removeStmts = mockAdapter.getExecutedStatements();
      assert.strictEqual(removeStmts.length, 1, 'Only 1 statement (CREATE OR REPLACE FUNCTION) should execute on update when users remain');
      assert.ok(removeStmts[0].statement.startsWith('CREATE OR REPLACE FUNCTION'));
      assert.ok(!removeStmts.some(s => s.statement.includes('ALTER TABLE')), 'Should NOT re-run ALTER TABLE when users remain');

      // 3.3 Verify statements on final removal (0 users remain)
      mockAdapter.executedStatements = [];
      await db.delete(RoleAssignments).where({ ID: assign2Id });
      const remove2Res = await removeAssignmentFromDatabricks(user2Id, roleId, cds);
      assert.strictEqual(remove2Res.dropped, true);

      const finalStmts = mockAdapter.getExecutedStatements();
      assert.strictEqual(finalStmts.length, 2, 'Exactly 2 statements expected when 0 users remain');

      // Verification of EXACT ORDER:
      // First: ALTER TABLE <tableSpec> DROP ROW FILTER;
      // Second: DROP FUNCTION IF EXISTS <funcSpec>;
      const dropTableStmt = finalStmts[0].statement;
      const dropFuncStmt = finalStmts[1].statement;

      const expectedTable = `main.default.${sanitizeDomainName(domainName)}_flat_authorizations`;
      const expectedFunc = `main.default.fn_filter_${sanitizeDomainName(domainName)}`;

      assert.strictEqual(dropTableStmt, `ALTER TABLE ${expectedTable} DROP ROW FILTER;`, 'First statement must DROP ROW FILTER');
      assert.strictEqual(dropFuncStmt, `DROP FUNCTION IF EXISTS ${expectedFunc};`, 'Second statement must DROP FUNCTION IF EXISTS');

    } finally {
      try { await db.delete(RoleAssignments).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Restrictions).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Roles).where({ ID: roleId }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

  // =========================================================================
  // SUITE 4: Table Naming and Function Naming Edge Cases & Special Characters
  // =========================================================================
  await t.test('4. Table Naming, Function Naming, Special Characters & Sanitization', () => {
    // 4.1 Domain sanitization edge cases
    assert.strictEqual(sanitizeDomainName('Sales-EMEA'), 'sales_emea');
    assert.strictEqual(sanitizeDomainName('Sales.Operations.2026'), 'sales_operations_2026');
    assert.strictEqual(sanitizeDomainName('Finance / Controlling (FICO)'), 'finance___controlling__fico');
    assert.strictEqual(sanitizeDomainName('Data & AI Platform #1'), 'data___ai_platform__1');
    assert.strictEqual(sanitizeDomainName('__Leading__Trailing__'), 'leading__trailing');
    assert.strictEqual(sanitizeDomainName(''), 'global');
    assert.strictEqual(sanitizeDomainName('   '), 'global');
    assert.strictEqual(sanitizeDomainName(null), 'global');
    assert.strictEqual(sanitizeDomainName(undefined), 'global');
    assert.strictEqual(sanitizeDomainName('$%^&*()!@#'), 'global');
    assert.strictEqual(sanitizeDomainName('GlObAl_AuTh'), 'global_auth');
    assert.strictEqual(sanitizeDomainName('München_Logistics'), 'm_nchen_logistics');

    // 4.2 SQL Injection attempt in domain name
    const injectionDomain = "sec'; DROP TABLE auth; --";
    const sanitizedInjection = sanitizeDomainName(injectionDomain);
    assert.strictEqual(sanitizedInjection, 'sec___drop_table_auth');
    assert.ok(!sanitizedInjection.includes("'"));
    assert.ok(!sanitizedInjection.includes(";"));
    assert.ok(!sanitizedInjection.includes("-"));

    // 4.3 Target naming resolution with custom catalog & schema
    const customSetting = { targetCatalog: 'corp_prod_catalog', targetSchema: 'auth_security_v1' };
    const namingCustom = resolveTargetNaming('HR & Payroll', customSetting);
    assert.strictEqual(namingCustom.catalog, 'corp_prod_catalog');
    assert.strictEqual(namingCustom.schema, 'auth_security_v1');
    assert.strictEqual(namingCustom.domainSanitized, 'hr___payroll');
    assert.strictEqual(namingCustom.targetTable, 'hr___payroll_flat_authorizations');
    assert.strictEqual(namingCustom.filterName, 'fn_filter_hr___payroll');
    assert.strictEqual(namingCustom.fullTableName, 'corp_prod_catalog.auth_security_v1.hr___payroll_flat_authorizations');
    assert.strictEqual(namingCustom.fullFuncName, 'corp_prod_catalog.auth_security_v1.fn_filter_hr___payroll');

    // 4.4 DDL Builder with custom parameters and special column handling
    const ddl = buildDatabricksRowFilterDdl({
      catalog: 'analytics_cat',
      schema: 'sec_schema',
      domain: 'Logistics',
      filterName: 'fn_filter_logistics',
      targetTable: 'logistics_flat_authorizations',
      columns: ['Plant_Code', 'Country', 'Invalid Col With Spaces!', 'Cost-Center', '123NumericCol', ''],
      assignments: [
        {
          userId: 'test_user@fanrio.corp',
          restrictions: [{ field: 'Plant_Code', filterType: 'SINGLE_VALUE', value: 'P100' }]
        }
      ]
    });

    // Valid alphanumeric columns must be preserved, invalid ones stripped
    assert.ok(ddl.columns.includes('Plant_Code'));
    assert.ok(ddl.columns.includes('Country'));
    assert.ok(ddl.columns.includes('123NumericCol'));
    assert.ok(!ddl.columns.includes('Invalid Col With Spaces!'));
    assert.ok(!ddl.columns.includes('Cost-Center'));

    // Check function signature
    assert.ok(ddl.createFuncSql.includes('Plant_Code STRING'));
    assert.ok(ddl.createFuncSql.includes('Country STRING'));
    assert.ok(ddl.createFuncSql.includes('123NumericCol STRING'));

    // Check ALTER TABLE ON columns
    assert.ok(ddl.setFilterSql.includes('ON (Plant_Code, Country, 123NumericCol);'));

    // 4.5 Empty columns fallback to ['id']
    const emptyColDdl = buildDatabricksRowFilterDdl({
      catalog: 'main',
      schema: 'default',
      filterName: 'fn_filter_empty',
      targetTable: 'empty_flat_authorizations',
      columns: [],
      assignments: []
    });
    assert.deepStrictEqual(emptyColDdl.columns, ['id']);
    assert.ok(emptyColDdl.createFuncSql.includes('fn_filter_empty(id STRING)'));
    assert.ok(emptyColDdl.setFilterSql.includes('ON (id);'));
  });

  // =========================================================================
  // SUITE 5: Failure Modes, Error Recovery & Edge Scenarios
  // =========================================================================
  await t.test('5. Adapter Failure Modes, Error Recovery & Platform Skipping', async (st) => {
    mockAdapter.reset();

    const unique = `err_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const domainId = `DOM_ERR_${unique}`;
    const roleId = `ROLE_ERR_${unique}`;

    try {
      await db.run(INSERT.into(AccessDomains).entries({
        ID: domainId,
        name: `ErrDomain_${unique}`,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Roles).entries({
        ID: roleId,
        name: `ROLE_ERR_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATABRICKS'
      }));

      await db.run(INSERT.into(Restrictions).entries({
        ID: `restr_err_${unique}`,
        role_ID: roleId,
        field: 'Plant',
        filterType: 'SINGLE_VALUE',
        value: 'DE99'
      }));

      // 5.1 Test AUTH_FAIL failure mode
      mockAdapter.setFailureMode('AUTH_FAIL');
      await assert.rejects(
        async () => {
          await syncAssignmentToDatabricks('assign_fail', 'fail_user@fanrio.com', roleId, false, cds, domainId);
        },
        (err) => {
          assert.strictEqual(err.status, 401);
          assert.ok(err.message.includes('Unauthorized'));
          return true;
        }
      );

      // 5.2 Test WAREHOUSE_UNAVAILABLE failure mode
      mockAdapter.setFailureMode('WAREHOUSE_UNAVAILABLE');
      await assert.rejects(
        async () => {
          await syncAssignmentToDatabricks('assign_fail2', 'fail_user2@fanrio.com', roleId, false, cds, domainId);
        },
        (err) => {
          assert.strictEqual(err.status, 503);
          assert.ok(err.message.includes('unavailable'));
          return true;
        }
      );

      // 5.3 Test TIMEOUT failure mode
      mockAdapter.setFailureMode('TIMEOUT');
      await assert.rejects(
        async () => {
          await syncAssignmentToDatabricks('assign_fail3', 'fail_user3@fanrio.com', roleId, false, cds, domainId);
        },
        (err) => {
          assert.strictEqual(err.status, 504);
          assert.ok(err.message.includes('timed out'));
          return true;
        }
      );

      // Clear failure mode
      mockAdapter.setFailureMode(null);

      // 5.4 Test removal error tolerance (DROP statements warn but do not crash)
      // When removing a non-existent table/filter, the service catches notices gracefully
      mockAdapter.setStatementHandler(/DROP/i, () => {
        throw new Error('Table or filter does not exist');
      });

      // removeAssignmentFromDatabricks when 0 users remain catches DROP errors gracefully
      const safeDropRes = await removeAssignmentFromDatabricks('unknown_user', roleId, cds);
      assert.strictEqual(safeDropRes.success, true);
      assert.strictEqual(safeDropRes.dropped, true);

      // 5.5 Platform skipping: DATASPHERE role
      const dsRoleId = `ROLE_DS_${unique}`;
      await db.run(INSERT.into(Roles).entries({
        ID: dsRoleId,
        name: `ROLE_DS_${unique}`,
        type: 'SINGLE',
        environment_ID: 'D',
        accessDomain_ID: domainId,
        targetPlatform: 'DATASPHERE'
      }));

      const skipSyncRes = await syncAssignmentToDatabricks('assign_ds', 'ds_user@fanrio.corp', dsRoleId, false, cds, domainId);
      assert.strictEqual(skipSyncRes.success, true);
      assert.strictEqual(skipSyncRes.skipped, true);
      assert.strictEqual(skipSyncRes.platform, 'DATASPHERE');

      const skipRemoveRes = await removeAssignmentFromDatabricks('ds_user@fanrio.corp', dsRoleId, cds);
      assert.strictEqual(skipRemoveRes.success, true);
      assert.strictEqual(skipRemoveRes.skipped, true);
      assert.strictEqual(skipRemoveRes.platform, 'DATASPHERE');

    } finally {
      mockAdapter.reset();
      try { await db.delete(Restrictions).where({ role_ID: roleId }); } catch {}
      try { await db.delete(Roles).where({ ID: roleId }); } catch {}
      try { await db.delete(AccessDomains).where({ ID: domainId }); } catch {}
    }
  });

});
