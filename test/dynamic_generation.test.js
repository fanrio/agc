const test = require('node:test');
const assert = require('node:assert');
const cds = require('@sap/cds');

const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

test('DRAGE (Dynamic Role & Assignment Generation Engine) Integration Tests', async (t) => {
  const db = cds.db;
  let ruleId;
  let customerId = 'C1001';

  await t.test('1. Setup dynamic generation rule', async () => {
    // Clean database tables first
    await db.run(cds.ql.DELETE.from('fanrio.auth.GeneratedResourceMap'));
    await db.run(cds.ql.DELETE.from('fanrio.auth.DynamicGenerationRules'));
    await db.run(cds.ql.DELETE.from('fanrio.auth.Customers'));
    await db.run(cds.ql.DELETE.from('fanrio.auth.RoleAssignments'));
    await db.run(cds.ql.DELETE.from('fanrio.auth.Restrictions'));
    await db.run(cds.ql.DELETE.from('fanrio.auth.Roles').where("name like 'ROLE_DYN_%'"));

    // Insert active rule
    const res = await POST('/odata/v4/auth/DynamicGenerationRules', {
      code: 'CUST_RESP',
      description: 'Auto-assign customers by owner',
      isActive: true,
      sourceType: 'LOCAL_DB',
      sourceEntity: 'fanrio.auth.Customers',
      sourceKeyField: 'ID',
      sourceResponsibleField: 'responsibleUser',
      generationMode: 'USER_CONSOLIDATED_ROLE',
      targetRestrictionField: 'CustomerNumber',
      filterType: 'MULTI_VALUE'
    });
    
    assert.ok(res.data.ID, 'Rule ID should be generated');
    ruleId = res.data.ID;
  });

  await t.test('2. Add Customer and verify dynamic role generation', async () => {
    // Insert customer record - this should trigger the automated dynamicSync
    await POST('/odata/v4/auth/Customers', {
      ID: customerId,
      name: 'Test Customer 1',
      responsibleUser: 'alice@company.com',
      status: 'ACTIVE'
    });

    // Verify generated Role exists
    const roleName = 'ROLE_DYN_CUST_RESP_ALICE_COMPANY_COM';
    const role = await db.run(SELECT.one.from('fanrio.auth.Roles').where({ name: roleName }));
    assert.ok(role, 'Dynamic role for Alice should be created');

    // Verify generated Restriction exists
    const restriction = await db.run(SELECT.one.from('fanrio.auth.Restrictions').where({ role_ID: role.ID }));
    assert.ok(restriction, 'Dynamic restriction should be created');
    assert.strictEqual(restriction.field, 'CustomerNumber');
    assert.deepStrictEqual(JSON.parse(restriction.value), [customerId], 'Restriction value should contain the customer ID');

    // Verify generated RoleAssignment exists
    const assignment = await db.run(SELECT.one.from('fanrio.auth.RoleAssignments').where({ role_ID: role.ID, userId: 'alice@company.com' }));
    assert.ok(assignment, 'Dynamic role assignment for Alice should exist');

    // Verify GeneratedResourceMap ledger entry exists
    const map = await db.run(SELECT.one.from('fanrio.auth.GeneratedResourceMap').where({ rule_ID: ruleId, masterRecordKey: customerId }));
    assert.ok(map, 'Ledger mapping entry should be created');
    assert.strictEqual(map.userId, 'alice@company.com');
  });

  await t.test('3. Reassign Customer to Bob and verify owner change sync and Alice cleanup', async () => {
    // Reassign customer to bob@company.com
    await PATCH(`/odata/v4/auth/Customers('${customerId}')`, {
      responsibleUser: 'bob@company.com'
    });

    // Alice's dynamic role should be cleaned up (no other keys map to it)
    const oldRole = await db.run(SELECT.one.from('fanrio.auth.Roles').where({ name: 'ROLE_DYN_CUST_RESP_ALICE_COMPANY_COM' }));
    assert.strictEqual(oldRole, undefined, "Alice's consolidated dynamic role should be removed");

    // Bob's dynamic role should be created
    const newRole = await db.run(SELECT.one.from('fanrio.auth.Roles').where({ name: 'ROLE_DYN_CUST_RESP_BOB_COMPANY_COM' }));
    assert.ok(newRole, 'Dynamic role for Bob should be created');

    // Bob's restriction should contain C1001
    const restriction = await db.run(SELECT.one.from('fanrio.auth.Restrictions').where({ role_ID: newRole.ID }));
    assert.ok(restriction, 'Dynamic restriction for Bob should exist');
    assert.deepStrictEqual(JSON.parse(restriction.value), [customerId]);

    // Bob's assignment should exist
    const assignment = await db.run(SELECT.one.from('fanrio.auth.RoleAssignments').where({ role_ID: newRole.ID, userId: 'bob@company.com' }));
    assert.ok(assignment, 'Dynamic assignment for Bob should exist');

    // Ledger mapping should point to Bob
    const map = await db.run(SELECT.one.from('fanrio.auth.GeneratedResourceMap').where({ rule_ID: ruleId, masterRecordKey: customerId }));
    assert.ok(map, 'Ledger mapping should exist');
    assert.strictEqual(map.userId, 'bob@company.com');
  });

  await t.test('4. Delete Customer and verify cleanup', async () => {
    // Delete customer
    await DELETE(`/odata/v4/auth/Customers('${customerId}')`);

    // Bob's dynamic role, restriction, assignment, and ledger mapping should be removed
    const role = await db.run(SELECT.one.from('fanrio.auth.Roles').where({ name: 'ROLE_DYN_CUST_RESP_BOB_COMPANY_COM' }));
    assert.strictEqual(role, undefined, 'Bob dynamic role should be cleaned up');

    const map = await db.run(SELECT.one.from('fanrio.auth.GeneratedResourceMap').where({ rule_ID: ruleId, masterRecordKey: customerId }));
    assert.strictEqual(map, undefined, 'Ledger mapping should be deleted');
  });

  // Redeploy database to restore seed data for the developer workspace
  const { execSync } = require('child_process');
  try {
    execSync('npx cds deploy', { stdio: 'ignore' });
  } catch (e) {
    console.error('Failed to redeploy database after tests:', e.message);
  }
});
