// Mock @sap/hana-client in Node require cache before any other modules load
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
      // Support both exec(sql, cb) and exec(sql, params, cb)
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
      if (sql.includes('VIEWS')) {
        cb(null, [
          { SCHEMA_NAME: 'MOCK_SCHEMA', VIEW_NAME: 'MOCK_VIEW_1' },
          { SCHEMA_NAME: 'MOCK_SCHEMA', VIEW_NAME: 'MOCK_VIEW_2' }
        ]);
      } else {
        cb(null, []);
      }
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

// Apply driver dependency injection
const HanaClient = require('./../srv/lib/hanaClient');
HanaClient.setDriver(mockHana);

// Mock global.fetch to intercept external BDC/Datasphere calls
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  console.log('MOCK FETCH:', url);
  if (typeof url === 'string') {
    // Error simulations based on query keywords
    if (url.includes('fail-token')) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Token Request Simulation Error'
      };
    }
    if (url.includes('fail-request')) {
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Data Request Simulation Error'
      };
    }
    if (url.includes('bad-json')) {
      return {
        ok: true,
        status: 200,
        json: async () => { throw new Error('Bad JSON Syntax'); },
        text: async () => 'Not a JSON response'
      };
    }

    // Happy paths
    if (url.includes('token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'mock-access-token' })
      };
    }
    if (url.includes('/api/v1/datasphere/consumption/catalog/spaces')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'mock-space-1' }, { id: 'mock-space-2' }]
      };
    }
    if (url.includes('/api/v1/datasphere/consumption/catalog/assets')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'mock-asset-1', spaceName: 'mock-space-1' }]
      };
    }
    if (url.includes('/api/v1/datasphere/consumption/relational/') && url.endsWith('$metadata')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <EntityType Name="mock-asset-1">
            <Property Name="id" Type="Edm.String"/>
            <Property Name="name" Type="Edm.String"/>
          </EntityType>
        `
      };
    }
    if (url.includes('/api/v1/datasphere/consumption/relational/')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          value: [{
            id: '1',
            name: 'Val1',
            value: [{ id: '1', name: 'Val1' }]
          }]
        }),
        json: async () => ({
          value: [{
            id: '1',
            name: 'Val1',
            value: [{ id: '1', name: 'Val1' }]
          }]
        })
      };
    }
    if (url.includes('/api/v1/datasphere/tasks/chains/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ logId: 'mock-log-12345', status: 'RUNNING' })
      };
    }
    if (url.includes('/api/v1/datasphere/tasks/logs/')) {
      const isCompleted = url.includes('complete');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: isCompleted ? 'COMPLETED' : 'RUNNING',
          endTime: new Date().toISOString()
        })
      };
    }
    if (url.includes('/api/v1/scim2/Users')) {
      const urlObj = new URL(url);
      const filter = urlObj.searchParams.get('filter') || '';
      
      const mockResources = [
        { userName: 'tim.waecken@cimt-ag.de', emails: [{ value: 'tim.waecken@cimt-ag.de' }], name: { givenName: 'Tim', familyName: 'Wäcken' }, urn_ietf_params_scim_schemas_extension_enterprise_2_0_User: { department: 'Finance' } },
        { userName: 'alice.smith@fanrio.com', emails: [{ value: 'alice.smith@fanrio.com' }], name: { givenName: 'Alice', familyName: 'Smith' } },
        { userName: 'bob.martin@fanrio.com', emails: [{ value: 'bob.martin@fanrio.com' }], name: { givenName: 'Bob', familyName: 'Martin' } },
        { userName: 'charlie.white@fanrio.com', emails: [{ value: 'charlie.white@fanrio.com' }], name: { givenName: 'Charlie', familyName: 'White' } },
        { userName: 'emily.miller@fanrio.com', emails: [{ value: 'emily.miller@fanrio.com' }], name: { givenName: 'Emily', familyName: 'Miller' } },
        { userName: 'david.brown@fanrio.com', emails: [{ value: 'david.brown@fanrio.com' }], name: { givenName: 'David', familyName: 'Brown' } },
        { userName: 'sarah.meissner@fanrio.com', emails: [{ value: 'sarah.meissner@fanrio.com' }], name: { givenName: 'Sarah', familyName: 'Meissner' } },
        { userName: 'eisen.schmidt@fanrio.com', emails: [{ value: 'eisen.schmidt@fanrio.com' }], name: { givenName: 'Eisen', familyName: 'Schmidt' } }
      ];

      let filtered = mockResources;
      if (filter) {
        const match = filter.match(/co "([^"]+)"/);
        if (match && match[1]) {
          const q = match[1].toLowerCase();
          filtered = mockResources.filter(r => 
            r.userName.toLowerCase().includes(q) || 
            (r.emails && r.emails[0] && r.emails[0].value.toLowerCase().includes(q)) ||
            (r.name && r.name.givenName.toLowerCase().includes(q))
          );
        }
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ Resources: filtered }),
        text: async () => JSON.stringify({ Resources: filtered })
      };
    }
  }
  return originalFetch(url, options);
};

const test = require('node:test');
const assert = require('node:assert');
const cds = require('@sap/cds');

const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

test('Comprehensive Backend Integration & Action Test Suite', async (t) => {

  let testRoleId;
  let testRestrictionId;
  const uniqueSuffix = Date.now();

  // Helper to assert response errors (since cds.test client throws on non-2xx codes)
  const assertODataError = async (promise, expectedStatus) => {
    try {
      await promise;
      assert.fail(`Expected OData call to fail with status ${expectedStatus}`);
    } catch (err) {
      const status = err.status || err.response?.status;
      assert.strictEqual(status, expectedStatus, `Expected status ${expectedStatus}, got ${status}`);
    }
  };

  // 1. Role & Restriction CRUD + AuditLog Triggers
  await t.test('Role & Restriction CRUD triggers', async (t2) => {
    
    await t2.test('Create a Role', async () => {
      const res = await POST('/odata/v4/auth/Roles', {
        name: `TEST_INTEGRATION_ROLE_${uniqueSuffix}`,
        type: 'ORG_BASED',
        description: 'Test Role',
        environment_ID: 'D'
      });
      assert.strictEqual(res.status, 201);
      testRoleId = res.data.ID;
    });

    await t2.test('Verify CREATE AuditLog', async () => {
      const res = await GET('/odata/v4/auth/AuditLogs');
      const createLog = res.data.value.find(log => log.recordId === testRoleId && log.action === 'CREATE');
      assert.ok(createLog);
    });

    await t2.test('Add Restriction to Role', async () => {
      const res = await POST('/odata/v4/auth/Restrictions', {
        role_ID: testRoleId,
        field: 'Country',
        filterType: 'SINGLE_VALUE',
        value: 'US'
      });
      assert.strictEqual(res.status, 201);
      testRestrictionId = res.data.ID;
    });

    await t2.test('Update Restriction value', async () => {
      const res = await PATCH(`/odata/v4/auth/Restrictions(ID=${testRestrictionId})`, {
        value: 'CA'
      });
      assert.ok(res.status === 200 || res.status === 204);
    });

    await t2.test('Update Role description', async () => {
      const res = await PATCH(`/odata/v4/auth/Roles(ID='${testRoleId}')`, {
        description: 'Updated description'
      });
      assert.ok(res.status === 200 || res.status === 204);
    });

    await t2.test('Delete Restriction', async () => {
      const res = await DELETE(`/odata/v4/auth/Restrictions(ID=${testRestrictionId})`);
      assert.strictEqual(res.status, 204);
    });

    await t2.test('Delete Role', async () => {
      const res = await DELETE(`/odata/v4/auth/Roles(ID='${testRoleId}')`);
      assert.strictEqual(res.status, 204);
    });
  });

  // 2. generateOrgRole and generateAllOrgRoles
  await t.test('generateOrgRole and generateAllOrgRoles actions', async () => {
    // Find a Plant-type node (node-de01) — the OTC domain covers Plant + Department
    const nodesRes = await GET('/odata/v4/auth/OrgNodes');
    assert.strictEqual(nodesRes.status, 200);
    // The seed has node-de01 (DE01) which has type_ID = Plant, matched by the OTC domain
    const plantNode = nodesRes.data.value.find(n => n.name === 'DE01');
    assert.ok(plantNode, 'Plant node DE01 must exist in test seed');

    // Call generateOrgRole — should produce at least the ALL role (ZOTC_DE01_ALL)
    const genRes = await POST('/odata/v4/auth/generateOrgRole', { orgNodeId: plantNode.ID });
    assert.strictEqual(genRes.status, 200);
    assert.ok(genRes.data.roleId, 'roleId should be set when a matching domain exists');
    assert.ok(genRes.data.roleName, 'roleName should be set when a matching domain exists');
    assert.ok(
      genRes.data.roleName.startsWith('ZOTC_DE01'),
      `Role name should start with ZOTC_DE01, got: ${genRes.data.roleName}`
    );

    // Call generateOrgRole on non-existent OrgNode (should return 404)
    await assertODataError(
      POST('/odata/v4/auth/generateOrgRole', { orgNodeId: '00000000-0000-0000-0000-000000000000' }),
      404
    );

    // Call generateAllOrgRoles — Plant and Department nodes produce roles → count > 0
    const genAllRes = await POST('/odata/v4/auth/generateAllOrgRoles', {});
    assert.strictEqual(genAllRes.status, 200);
    assert.ok(genAllRes.data.count > 0, `generateAllOrgRoles count should be > 0, got ${genAllRes.data.count}`);
  });

  // 3. resolveEffectiveRestrictions
  await t.test('resolveEffectiveRestrictions action', async () => {
    const roleAName = `ROLE_A_TEST_${uniqueSuffix}`;
    const roleBName = `ROLE_B_TEST_${uniqueSuffix}`;

    // Create Role A
    const resA = await POST('/odata/v4/auth/Roles', { name: roleAName, type: 'ORG_BASED', environment_ID: 'D' });
    const idA = resA.data.ID;
    
    // Create Role B
    const resB = await POST('/odata/v4/auth/Roles', { name: roleBName, type: 'ORG_BASED', environment_ID: 'D' });
    const idB = resB.data.ID;

    // Set A parent as B (A inherits B)
    const inhRes = await POST('/odata/v4/auth/RoleInheritance', { role_ID: idA, parent_ID: idB });
    assert.strictEqual(inhRes.status, 201);

    // Add restriction to B
    await POST('/odata/v4/auth/Restrictions', { role_ID: idB, field: 'Plant', filterType: 'SINGLE_VALUE', value: '1000' });

    // Call resolveEffectiveRestrictions for A
    const resolveRes = await POST('/odata/v4/auth/resolveEffectiveRestrictions', { roleId: idA });
    assert.strictEqual(resolveRes.status, 200);
    assert.ok(resolveRes.data.value.length > 0);

    // Setup circular inheritance to trigger 400 circular check
    const circRes = await POST('/odata/v4/auth/RoleInheritance', { role_ID: idB, parent_ID: idA });
    assert.strictEqual(circRes.status, 201);

    // Call resolveEffectiveRestrictions for A (circular check fails)
    await assertODataError(
      POST('/odata/v4/auth/resolveEffectiveRestrictions', { roleId: idA }),
      400
    );

    // Clean up inheritance
    await DELETE(`/odata/v4/auth/RoleInheritance(ID=${inhRes.data.ID})`);
    await DELETE(`/odata/v4/auth/RoleInheritance(ID=${circRes.data.ID})`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idA}')`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idB}')`);
  });

  await t.test('resolveEffectiveRestrictions overrides parent wildcard restriction if child restricts same field', async () => {
    const parentRoleName = `ROLE_P_WILD_${uniqueSuffix}`;
    const childRoleName = `ROLE_C_SPEC_${uniqueSuffix}`;

    // Create Parent Role
    const resP = await POST('/odata/v4/auth/Roles', { name: parentRoleName, type: 'ORG_BASED', environment_ID: 'D' });
    const idP = resP.data.ID;

    // Create Child Role
    const resC = await POST('/odata/v4/auth/Roles', { name: childRoleName, type: 'ORG_BASED', environment_ID: 'D' });
    const idC = resC.data.ID;

    // Inherit Child from Parent
    const inh = await POST('/odata/v4/auth/RoleInheritance', { role_ID: idC, parent_ID: idP });

    // Add wildcard restriction to Parent on Country
    await POST('/odata/v4/auth/Restrictions', { role_ID: idP, field: 'Country', filterType: 'CP', value: '*' });

    // Add specific restriction to Child on Country
    await POST('/odata/v4/auth/Restrictions', { role_ID: idC, field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' });

    // Call resolveEffectiveRestrictions for Child
    const resolveRes = await POST('/odata/v4/auth/resolveEffectiveRestrictions', { roleId: idC });
    assert.strictEqual(resolveRes.status, 200);

    const restrictions = resolveRes.data.value;
    // Should ONLY contain the specific 'DE' restriction, the parent's '*' restriction must be overridden/skipped!
    const countryRestrictions = restrictions.filter(r => r.field === 'Country');
    assert.strictEqual(countryRestrictions.length, 1);
    assert.strictEqual(countryRestrictions[0].value, 'DE');
    assert.strictEqual(countryRestrictions[0].filterType, 'SINGLE_VALUE');

    // Clean up
    await DELETE(`/odata/v4/auth/RoleInheritance(ID=${inh.data.ID})`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idC}')`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idP}')`);
  });

  await t.test('RoleInheritance and Restrictions CREATE/DELETE triggers HANA re-sync', async () => {
    const parentRoleName = `ROLE_P_SYNC_${uniqueSuffix}`;
    const childRoleName = `ROLE_C_SYNC_${uniqueSuffix}`;

    // 1. Create Parent and Child roles
    const resP = await POST('/odata/v4/auth/Roles', { name: parentRoleName, type: 'SINGLE', environment_ID: 'D' });
    const idP = resP.data.ID;

    const resC = await POST('/odata/v4/auth/Roles', { name: childRoleName, type: 'SINGLE', environment_ID: 'D' });
    const idC = resC.data.ID;

    // 2. Add wildcard restriction to Parent Role
    const restP = await POST('/odata/v4/auth/Restrictions', { role_ID: idP, field: 'CostCenter', filterType: 'CP', value: '*' });
    assert.strictEqual(restP.status, 201);

    // 3. Create RoleInheritance link (child now inherits parent restrictions)
    const inh = await POST('/odata/v4/auth/RoleInheritance', { role_ID: idC, parent_ID: idP });
    assert.strictEqual(inh.status, 201);

    // 4. Assign user to Child Role (passes because child inherits CostCenter: CP * restriction)
    const assignRes = await POST('/odata/v4/auth/RoleAssignments', {
      userId: `sync.user_${uniqueSuffix}@test.com`,
      userName: 'Sync Test User',
      role_ID: idC
    });
    assert.strictEqual(assignRes.status, 201);
    const assignId = assignRes.data.ID;

    // 5. Add specific override restriction to Child Role (should trigger assignment sync)
    const restC = await POST('/odata/v4/auth/Restrictions', { role_ID: idC, field: 'CostCenter', filterType: 'EQ', value: 'DE01' });
    assert.strictEqual(restC.status, 201);

    // 6. Delete the override restriction from Child Role (should trigger assignment sync)
    const delRestC = await DELETE(`/odata/v4/auth/Restrictions(ID=${restC.data.ID})`);
    assert.strictEqual(delRestC.status, 204);

    // 7. Delete inheritance link (should trigger assignment sync)
    const delInh = await DELETE(`/odata/v4/auth/RoleInheritance(ID=${inh.data.ID})`);
    assert.strictEqual(delInh.status, 204);

    // Clean up
    await DELETE(`/odata/v4/auth/RoleAssignments(ID=${assignId})`);
    await DELETE(`/odata/v4/auth/Restrictions(ID=${restP.data.ID})`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idC}')`);
    await DELETE(`/odata/v4/auth/Roles(ID='${idP}')`);
  });

  // 4. simulateAccess
  await t.test('simulateAccess function and evaluation logic', async () => {
    // Create a role and add various restriction types
    const roleRes = await POST('/odata/v4/auth/Roles', { name: `SIMULATE_ROLE_TEST_${uniqueSuffix}`, type: 'ORG_BASED', environment_ID: 'D' });
    const rId = roleRes.data.ID;

    // SINGLE_VALUE restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' });

    // MULTI_VALUE restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'Plant', filterType: 'MULTI_VALUE', value: JSON.stringify(['DE01', 'DE02']) });

    // RANGE restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'Amount', filterType: 'RANGE', value: JSON.stringify({ from: 100, to: 500 }) });

    // CP restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'CompanyCode', filterType: 'CP', value: 'CC%' });

    // HIERARCHY restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'Dept', filterType: 'HIERARCHY', value: 'ORG01' });

    // Invalid JSON for sampleData (error check)
    await assertODataError(
      POST('/odata/v4/auth/simulateAccess', { roleId: rId, sampleData: '{bad json}' }),
      400
    );

    // Call simulateAccess with passing and failing rows
    const sampleData = [
      // Row 0: All passing
      { Country: 'DE', Plant: 'DE01', Amount: '250', CompanyCode: 'CC100', Dept: 'ORG01' },
      // Row 1: SINGLE_VALUE failing
      { Country: 'FR', Plant: 'DE01', Amount: '250', CompanyCode: 'CC100', Dept: 'ORG01' },
      // Row 2: MULTI_VALUE failing
      { Country: 'DE', Plant: 'DE03', Amount: '250', CompanyCode: 'CC100', Dept: 'ORG01' },
      // Row 3: RANGE failing
      { Country: 'DE', Plant: 'DE01', Amount: '99', CompanyCode: 'CC100', Dept: 'ORG01' },
      // Row 4: RANGE invalid number failing
      { Country: 'DE', Plant: 'DE01', Amount: 'invalid', CompanyCode: 'CC100', Dept: 'ORG01' },
      // Row 5: CP failing
      { Country: 'DE', Plant: 'DE01', Amount: '250', CompanyCode: 'BB100', Dept: 'ORG01' },
      // Row 6: Missing field failing
      { Plant: 'DE01', Amount: '250', CompanyCode: 'CC100', Dept: 'ORG01' }
    ];

    const simRes = await POST('/odata/v4/auth/simulateAccess', { roleId: rId, sampleData: JSON.stringify(sampleData) });
    assert.strictEqual(simRes.status, 200);
    const results = simRes.data.value;

    assert.strictEqual(results[0].passed, true);
    assert.strictEqual(results[1].passed, false);
    assert.ok(results[1].reason.includes('Country'));
    assert.strictEqual(results[2].passed, false);
    assert.ok(results[2].reason.includes('Plant'));
    assert.strictEqual(results[3].passed, false);
    assert.ok(results[3].reason.includes('Amount'));
    assert.strictEqual(results[4].passed, false);
    assert.strictEqual(results[5].passed, false);
    assert.ok(results[5].reason.includes('CompanyCode'));
    assert.strictEqual(results[6].passed, false);
    assert.ok(results[6].reason.includes('missing in data'));

    // Test unknown filterType to hit default branch
    const badRoleRes = await POST('/odata/v4/auth/Roles', { name: `BAD_ROLE_TEST_${uniqueSuffix}`, type: 'ORG_BASED', environment_ID: 'D' });
    const badRId = badRoleRes.data.ID;
    await POST('/odata/v4/auth/Restrictions', { role_ID: badRId, field: 'Country', filterType: 'UNKNOWN_TYPE', value: 'DE' });
    const simResBadType = await POST('/odata/v4/auth/simulateAccess', { roleId: badRId, sampleData: JSON.stringify([{ Country: 'DE' }]) });
    assert.strictEqual(simResBadType.status, 200);
    assert.strictEqual(simResBadType.data.value[0].passed, false);
    assert.ok(simResBadType.data.value[0].reason.includes('Unknown filter type'));

    // Clean up
    await DELETE(`/odata/v4/auth/Roles(ID='${rId}')`);
    await DELETE(`/odata/v4/auth/Roles(ID='${badRId}')`);
  });

  // 5. Mock BDC API connectors
  await t.test('testBdcConnection OData & Hana branches', async () => {
    // 1. OData connection - BASIC auth
    const basicSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_BASIC_CONN',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'BASIC',
      username: 'user',
      password: 'password'
    });
    const testBasicRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: basicSetting.data.ID });
    assert.strictEqual(testBasicRes.status, 200);
    assert.strictEqual(testBasicRes.data.success, true);

    // 2. OData connection - OAUTH auth
    const oauthSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_OAUTH_CONN',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'OAUTH',
      tokenUrl: 'https://mock-token-url.com',
      clientId: 'id',
      clientSecret: 'secret'
    });
    const testOauthRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: oauthSetting.data.ID });
    assert.strictEqual(testOauthRes.status, 200);
    assert.strictEqual(testOauthRes.data.success, true);

    // 3. OData connection - TOKEN auth
    const tokenSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_TOKEN_CONN',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'TOKEN',
      apiToken: 'token-val'
    });
    const testTokenRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: tokenSetting.data.ID });
    assert.strictEqual(testTokenRes.status, 200);
    assert.strictEqual(testTokenRes.data.success, true);

    // 4. OData connection - Invalid URL
    const badUrlSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_BAD_URL',
      connectionType: 'OData',
      url: 'invalid'
    });
    const testBadUrlRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: badUrlSetting.data.ID });
    assert.strictEqual(testBadUrlRes.status, 200);
    assert.strictEqual(testBadUrlRes.data.success, false);

    // 5. OData connection - Missing Basic Auth Params
    const missingBasicSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_MISSING_BASIC',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'BASIC'
    });
    const testMissingBasicRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: missingBasicSetting.data.ID });
    assert.strictEqual(testMissingBasicRes.status, 200);
    assert.strictEqual(testMissingBasicRes.data.success, false);

    // 6. OData connection - Missing OAuth Params
    const missingOauthSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_MISSING_OAUTH',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'OAUTH'
    });
    const testMissingOauthRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: missingOauthSetting.data.ID });
    assert.strictEqual(testMissingOauthRes.status, 200);
    assert.strictEqual(testMissingOauthRes.data.success, false);

    // 7. OData connection - Missing Token Params
    const missingTokenSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_MISSING_TOKEN',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      authType: 'TOKEN'
    });
    const testMissingTokenRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: missingTokenSetting.data.ID });
    assert.strictEqual(testMissingTokenRes.status, 200);
    assert.strictEqual(testMissingTokenRes.data.success, false);

    // 8. SAP Hana connection - Happy Path (Using mockHana client)
    const hanaSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_HANA_CONN',
      connectionType: 'SAP Hana',
      host: 'mock-host',
      port: 30015,
      username: 'mockuser',
      password: 'mockpassword'
    });
    const testHanaRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: hanaSetting.data.ID });
    assert.strictEqual(testHanaRes.status, 200);
    assert.strictEqual(testHanaRes.data.success, true);

    // 9. SAP Hana connection - Missing params
    const badHanaSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_BAD_HANA_CONN',
      connectionType: 'SAP Hana'
    });
    const testBadHanaRes = await POST('/odata/v4/auth/testBdcConnection', { settingId: badHanaSetting.data.ID });
    assert.strictEqual(testBadHanaRes.status, 200);
    assert.strictEqual(testBadHanaRes.data.success, false);

    // 10. testBdcConnection on non-existent ID
    await assertODataError(
      POST('/odata/v4/auth/testBdcConnection', { settingId: '00000000-0000-0000-0000-000000000000' }),
      404
    );

    // Clean up
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${basicSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${oauthSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${tokenSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${badUrlSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${missingBasicSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${missingOauthSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${missingTokenSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${hanaSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${badHanaSetting.data.ID})`);
  });

  // 6. OData Mock BDC API connectors (fetchBdcSpaces, fetchBdcAssets, fetchBdcRelationalValues, fetchBdcAssetColumns)
  await t.test('fetchBdcSpaces, fetchBdcAssets, fetchBdcRelationalValues, fetchBdcAssetColumns OData actions', async () => {
    // fetchBdcSpaces
    const spacesRes = await POST('/odata/v4/auth/fetchBdcSpaces', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret'
    });
    assert.strictEqual(spacesRes.status, 200);
    assert.ok(spacesRes.data.value.includes('mock-space-1'));

    // fetchBdcSpaces validation error (should throw 400)
    await assertODataError(
      POST('/odata/v4/auth/fetchBdcSpaces', { url: 'https://mock-url.com' }),
      400
    );

    // fetchBdcSpaces mock fallback trigger on error path
    const spacesFallback = await POST('/odata/v4/auth/fetchBdcSpaces', {
      url: 'https://mock-url.com/fail-token',
      tokenUrl: 'https://mock-url.com/fail-token',
      clientId: 'client',
      clientSecret: 'secret'
    });
    assert.strictEqual(spacesFallback.status, 200);
    assert.ok(spacesFallback.data.value.includes('SALES_DEMO_SPACE'));

    // fetchBdcAssets
    const assetsRes = await POST('/odata/v4/auth/fetchBdcAssets', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1'
    });
    assert.strictEqual(assetsRes.status, 200);
    assert.ok(assetsRes.data.value.includes('mock-asset-1'));

    // fetchBdcAssets missing params error (should throw 400)
    await assertODataError(
      POST('/odata/v4/auth/fetchBdcAssets', { url: 'https://mock-url.com' }),
      400
    );

    // fetchBdcRelationalValues
    const relRes = await POST('/odata/v4/auth/fetchBdcRelationalValues', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      asset: 'mock-asset-1',
      idColumns: JSON.stringify(['id']),
      textColumn: 'name'
    });
    assert.strictEqual(relRes.status, 200);
    assert.ok(relRes.data.value.length > 0);

    // fetchBdcRelationalValues with joined Asset Text
    const relJoinRes = await POST('/odata/v4/auth/fetchBdcRelationalValues', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      asset: 'mock-asset-1',
      assetText: 'mock-asset-text-1',
      idColumns: JSON.stringify(['id'])
    });
    assert.strictEqual(relJoinRes.status, 200);
    assert.ok(relJoinRes.data.value.length > 0);

    // fetchBdcRelationalValues missing params error (should throw 400)
    await assertODataError(
      POST('/odata/v4/auth/fetchBdcRelationalValues', {}),
      400
    );

    // fetchBdcAssetColumns
    const colsRes = await POST('/odata/v4/auth/fetchBdcAssetColumns', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      asset: 'mock-asset-1'
    });
    assert.strictEqual(colsRes.status, 200);
    assert.ok(colsRes.data.value.includes('id'));

    // fetchBdcAssetColumns missing params error (should throw 400)
    await assertODataError(
      POST('/odata/v4/auth/fetchBdcAssetColumns', {}),
      400
    );
  });

  // 7. Raw BDC Adapters
  await t.test('fetchRawBdcSpaces, fetchRawBdcAssets, fetchRawBdcRelationalValues, fetchRawBdcAssetColumns, fetchRawHanaViews actions', async () => {
    // fetchRawBdcSpaces
    const rawSpaces = await POST('/odata/v4/auth/fetchRawBdcSpaces', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret'
    });
    assert.strictEqual(rawSpaces.status, 200);
    const spacesData = JSON.parse(rawSpaces.data.value);
    assert.strictEqual(spacesData[0].id, 'mock-space-1');

    // fetchRawBdcSpaces missing params
    await assertODataError(
      POST('/odata/v4/auth/fetchRawBdcSpaces', {}),
      400
    );

    // fetchRawBdcAssets
    const rawAssets = await POST('/odata/v4/auth/fetchRawBdcAssets', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret'
    });
    assert.strictEqual(rawAssets.status, 200);
    const assetsData = JSON.parse(rawAssets.data.value);
    assert.strictEqual(assetsData[0].id, 'mock-asset-1');

    // fetchRawBdcAssets missing params
    await assertODataError(
      POST('/odata/v4/auth/fetchRawBdcAssets', {}),
      400
    );

    // fetchRawBdcRelationalValues
    const rawRel = await POST('/odata/v4/auth/fetchRawBdcRelationalValues', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      asset: 'mock-asset-1'
    });
    assert.strictEqual(rawRel.status, 200);
    const relData = JSON.parse(rawRel.data.value);
    assert.ok(relData.value);

    // fetchRawBdcRelationalValues missing params
    await assertODataError(
      POST('/odata/v4/auth/fetchRawBdcRelationalValues', {}),
      400
    );

    // fetchRawBdcAssetColumns
    const rawCols = await POST('/odata/v4/auth/fetchRawBdcAssetColumns', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      asset: 'mock-asset-1'
    });
    assert.strictEqual(rawCols.status, 200);
    assert.ok(rawCols.data.value.includes('<EntityType'));

    // fetchRawBdcAssetColumns missing params
    await assertODataError(
      POST('/odata/v4/auth/fetchRawBdcAssetColumns', {}),
      400
    );

    // fetchRawHanaViews
    const hanaSetting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'TEST_RAW_HANA',
      connectionType: 'SAP Hana',
      host: 'mock-host',
      port: 30015,
      username: 'mockuser',
      password: 'mockpassword'
    });
    const rawHana = await POST('/odata/v4/auth/fetchRawHanaViews', { settingId: hanaSetting.data.ID });
    assert.strictEqual(rawHana.status, 200);
    const hanaViews = JSON.parse(rawHana.data.value);
    assert.strictEqual(hanaViews[0].VIEW_NAME, 'MOCK_VIEW_1');

    // fetchRawHanaViews non-existent ID
    await assertODataError(
      POST('/odata/v4/auth/fetchRawHanaViews', { settingId: '00000000-0000-0000-0000-000000000000' }),
      404
    );

    // Clean up
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${hanaSetting.data.ID})`);
  });

  // 8. searchScimUsers
  await t.test('searchScimUsers action', async () => {
    // With query
     const res = await POST('/odata/v4/auth/searchScimUsers', { query: 'tim.waecken' });
     assert.strictEqual(res.status, 200);
     assert.strictEqual(res.data.value.length, 1);
     assert.strictEqual(res.data.value[0].username, 'tim.waecken@cimt-ag.de');

    // Without query (returns all)
    const resAll = await POST('/odata/v4/auth/searchScimUsers', { query: '' });
    assert.strictEqual(resAll.status, 200);
    assert.ok(resAll.data.value.length > 5);
  });

  // 9. runBdcTaskChain and fetchBdcTaskChainLog
  await t.test('runBdcTaskChain and fetchBdcTaskChainLog actions', async () => {
    // runBdcTaskChain
    const runRes = await POST('/odata/v4/auth/runBdcTaskChain', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      taskChainId: 'mock-chain-1'
    });
    assert.strictEqual(runRes.status, 200);
    const runData = JSON.parse(runRes.data.value);
    assert.strictEqual(runData.status, 'RUNNING');

    // runBdcTaskChain missing params
    await assertODataError(
      POST('/odata/v4/auth/runBdcTaskChain', {}),
      400
    );

    // fetchBdcTaskChainLog
    const logRes = await POST('/odata/v4/auth/fetchBdcTaskChainLog', {
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      space: 'mock-space-1',
      logId: 'mock-log-1'
    });
    assert.strictEqual(logRes.status, 200);
    const logData = JSON.parse(logRes.data.value);
    assert.strictEqual(logData.status, 'RUNNING');

    // fetchBdcTaskChainLog missing params
    await assertODataError(
      POST('/odata/v4/auth/fetchBdcTaskChainLog', {}),
      400
    );
  });

  // 10. Replications & Replication Status Trigger checks
  await t.test('triggerReplication and checkReplicationStatuses triggers', async () => {
    // Keep track of which connections were active
    const activeSettings = await cds.db.run(SELECT.from('fanrio.auth.BdcSettings').where({ isActive: true }));

    // Deactivate all existing connections to avoid OData connection collision
    await cds.db.run(UPDATE('fanrio.auth.BdcSettings').set({ isActive: false }));
    await cds.db.run(cds.ql.DELETE.from('fanrio.auth.Replications'));

    // Create an active BDC OData setting for environment 'D' with all required parameters
    const setting = await POST('/odata/v4/auth/BdcSettings', {
      systemName: 'REPLICATION_CONN',
      connectionType: 'OData',
      url: 'https://mock-url.com',
      tokenUrl: 'https://mock-url.com/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authType: 'OAUTH',
      space: 'DEV_SPACE',
      taskChainFlat: 'TC_FLAT',
      isActive: true,
      environment_ID: 'D'
    });

    // Create an 'Open' replication entry
    const rep = await POST('/odata/v4/auth/Replications', {
      status: 'Open',
      replicationRoles: 'ROLE_TEST_REPLICATION',
      environment_ID: 'D'
    });

    // Trigger replication (it should pick up the Open replication, transition it to Running, and spawn task chain)
    const trigRes = await POST('/odata/v4/auth/triggerReplication', {});
    assert.strictEqual(trigRes.status, 200);
    assert.strictEqual(trigRes.data.success, true);

    // Verify replication status has transitioned to Running
    const repRunningRes = await GET(`/odata/v4/auth/Replications(ID=${rep.data.ID})`);
    assert.strictEqual(repRunningRes.data.status, 'Running');
    const runId = repRunningRes.data.runId;
    assert.ok(runId);

    // checkReplicationStatuses (should query and update running replications)
    // 1. Let's verify when the log status is 'RUNNING' (our default mock response for log is RUNNING)
    const checkResRunning = await POST('/odata/v4/auth/checkReplicationStatuses', {});
    assert.strictEqual(checkResRunning.status, 200);

    // 2. Let's make the runId contain 'complete' so the mock fetch returns COMPLETED status
    await PATCH(`/odata/v4/auth/Replications(ID=${rep.data.ID})`, {
      runId: `${runId}-complete`
    });

    const checkResComplete = await POST('/odata/v4/auth/checkReplicationStatuses', {});
    assert.strictEqual(checkResComplete.status, 200);

    // Verify it transitioned to Success
    const repSuccessRes = await GET(`/odata/v4/auth/Replications(ID=${rep.data.ID})`);
    assert.strictEqual(repSuccessRes.data.status, 'Success');
    // Clean up
    await DELETE(`/odata/v4/auth/Replications(ID=${rep.data.ID})`);
    await DELETE(`/odata/v4/auth/BdcSettings(ID=${setting.data.ID})`);

    // Restore active status
    if (activeSettings.length > 0) {
      const activeIds = activeSettings.map(s => s.ID);
      await cds.db.run(UPDATE('fanrio.auth.BdcSettings').set({ isActive: true }).where({ ID: { in: activeIds } }));
    }
  });

  await t.test('HANA Flat Replication - Cartesian Product buildFlatAuthorizationsForHana', () => {
    const { buildFlatAuthorizationsForHana } = require('../srv/services/hanaReplicationService');
    
    const restrictions = [
      { field: 'Plant', filterType: 'MULTI_VALUE', value: '["10", "20"]' },
      { field: 'Company Code', filterType: 'SINGLE_VALUE', value: 'CC01' }
    ];
    
    const entries = buildFlatAuthorizationsForHana(restrictions, 'ROLE_TEST', 'user1');
    
    assert.strictEqual(entries.length, 4);
    
    const role1Entries = entries.filter(e => e.roleName === 'ROLE_TEST_1');
    assert.strictEqual(role1Entries.length, 2);
    assert.ok(role1Entries.some(e => e.field === 'Plant' && e.low === '10'));
    assert.ok(role1Entries.some(e => e.field === 'Company Code' && e.low === 'CC01'));
    
    const role2Entries = entries.filter(e => e.roleName === 'ROLE_TEST_2');
    assert.strictEqual(role2Entries.length, 2);
    assert.ok(role2Entries.some(e => e.field === 'Plant' && e.low === '20'));
    assert.ok(role2Entries.some(e => e.field === 'Company Code' && e.low === 'CC01'));
  });

  await t.test('HANA Hier Replication - buildHierAuthorizationsForHana', () => {
    const { buildHierAuthorizationsForHana } = require('../srv/services/hanaReplicationService');
    
    const restrictions = [
      { field: 'Plant', filterType: 'MULTI_VALUE', value: '["10", "20"]' },
      { field: '0HIER_PROFIT_CENTER', filterType: 'HIERARCHY', value: 'PC_ROOT' },
      { field: 'SalesOrg', filterType: 'HIERARCHY', value: '["DACH/0"]' },
      { field: 'Region', filterType: 'HIERARCHY', value: '[{"id":"US/1","nodeType":"RegionType"}]' },
      { field: 'SalesOrg', filterType: 'HIERARCHY', value: '[{"id":"DE03","nodeType":"SALES_ORG","hierarchy":"DACH"}]' }
    ];
    
    const entries = buildHierAuthorizationsForHana(restrictions, 'ROLE_TEST', 'user1');
    
    assert.strictEqual(entries.length, 4);

    // Entry 1 (Fallback case for plain string 'PC_ROOT')
    assert.strictEqual(entries[0].identifier, 'user1');
    assert.strictEqual(entries[0].restriction, 'ROLE_TEST');
    assert.strictEqual(entries[0].targetNodeType, '0HIER_PROFIT_CENTER');
    assert.strictEqual(entries[0].rootValues, 'PC_ROOT');
    assert.strictEqual(entries[0].hierIdentifier, 'PC_ROOT');
    assert.strictEqual(entries[0].rootNodeType, '');

    // Entry 2 (Parsed JSON array directory case '["DACH/0"]')
    assert.strictEqual(entries[1].identifier, 'user1');
    assert.strictEqual(entries[1].restriction, 'ROLE_TEST');
    assert.strictEqual(entries[1].targetNodeType, 'SalesOrg');
    assert.strictEqual(entries[1].rootValues, 'DACH/0');       // full node key
    assert.strictEqual(entries[1].hierIdentifier, 'DACH');     // directory prefix before '/'
    assert.strictEqual(entries[1].rootNodeType, '');

    // Entry 3 (New object format case)
    assert.strictEqual(entries[2].identifier, 'user1');
    assert.strictEqual(entries[2].restriction, 'ROLE_TEST');
    assert.strictEqual(entries[2].targetNodeType, 'Region');
    assert.strictEqual(entries[2].rootValues, 'US/1');          // full node key
    assert.strictEqual(entries[2].hierIdentifier, 'US');        // directory prefix before '/'
    assert.strictEqual(entries[2].rootNodeType, 'RegionType');

    // Entry 4 (Stored hierarchy attribute case with DE03 value)
    assert.strictEqual(entries[3].identifier, 'user1');
    assert.strictEqual(entries[3].restriction, 'ROLE_TEST');
    assert.strictEqual(entries[3].targetNodeType, 'SalesOrg');
    assert.strictEqual(entries[3].rootValues, 'DE03');          // business value only!
    assert.strictEqual(entries[3].hierIdentifier, 'DACH');      // directory prefix from hierarchy attribute
    assert.strictEqual(entries[3].rootNodeType, 'SALES_ORG');
  });

  await t.test('HANA Hier Replication - syncCustomHierAssignment and auto-migration', async () => {
    const HanaClient = require('../srv/lib/hanaClient');

    let prepareCount = 0;
    let alterTableExecuted = false;
    let insertExecuted = false;

    const testMockHana = {
      createConnection: () => ({
        connect: (params, cb) => cb(null),
        commit: (cb) => cb(null),
        rollback: (cb) => cb(null),
        disconnect: (cb) => cb ? cb() : null,
        exec: (sql, cb) => {
          if (sql.includes('RENAME COLUMN') && sql.includes('."ID" TO "IDENTIFIER"')) {
            alterTableExecuted = true;
            return cb(null);
          }
          cb(null, []);
        },
        prepare: (sql, cb) => {
          if (sql.includes('INSERT INTO') && sql.includes('IDENTIFIER')) {
            prepareCount++;
            if (prepareCount === 1) {
              return cb(new Error('invalid column name: IDENTIFIER'));
            }
            return cb(null, {
              exec: (params, execCb) => {
                insertExecuted = true;
                execCb(null);
              }
            });
          }
          cb(null, {
            exec: (params, execCb) => execCb(null)
          });
        }
      })
    };

    const originalDriver = HanaClient.driver;
    HanaClient.setDriver(testMockHana);

    try {
      const setting = { systemName: 'TestHana', username: 'dbUser', password: 'pwd', host: 'localhost', port: 30015 };
      const hierEntries = [{
        identifier: 'user1',
        restriction: 'ROLE_TEST',
        targetNodeType: '0HIER_PROFIT_CENTER',
        rootNodeType: '',
        rootValues: 'PC_ROOT',
        hierIdentifier: '0HIER_PROFIT_CENTER'
      }];

      await HanaClient.syncCustomHierAssignment(setting, 'test_hier_table', 'assignment-abc', false, hierEntries);

      assert.strictEqual(alterTableExecuted, true, 'Should execute RENAME COLUMN statement to rename ID to IDENTIFIER');
      assert.strictEqual(prepareCount, 2, 'Should prepare insert twice (first failed, second retry after alter table)');
      assert.strictEqual(insertExecuted, true, 'Should successfully execute the insert after migration');
    } finally {
      HanaClient.setDriver(originalDriver);
    }
  });

  await t.test('Derived Role Duplicate Restriction Checks', async (t2) => {
    // 1. Create a parent single role
    const parentRoleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_PARENT_DUP',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const parentRoleId = parentRoleRes.data.ID;

    // 2. Add a restriction to the parent role
    await POST('/odata/v4/auth/Restrictions', {
      role_ID: parentRoleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // 3. Create a derived role
    const derivedRoleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_DERIVED_DUP',
      type: 'DERIVED',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const derivedRoleId = derivedRoleRes.data.ID;

    // 4. Associate derived role with parent role via inheritance
    await POST('/odata/v4/auth/RoleInheritance', {
      role_ID: derivedRoleId,
      parent_ID: parentRoleId
    });

    // 5. Try to add the EXACT same restriction to the derived role - should fail
    try {
      await POST('/odata/v4/auth/Restrictions', {
        role_ID: derivedRoleId,
        field: 'SalesOrg',
        filterType: 'SINGLE_VALUE',
        value: 'DE01'
      });
      assert.fail('Should have failed to create a duplicate restriction on derived role');
    } catch (err) {
      assert.strictEqual(err.status, 400, 'Should return 400 Bad Request');
      assert.ok(err.message.includes('Derived role cannot have the same restriction as its parent'), 'Should throw the duplicate restriction error');
    }

    // 6. Test case where we add restriction to the derived role first, and then associate the parent role (which has the duplicate restriction)
    // Create a new derived role
    const derivedRoleRes2 = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_DERIVED_DUP_2',
      type: 'DERIVED',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const derivedRoleId2 = derivedRoleRes2.data.ID;

    // Add own restriction first
    await POST('/odata/v4/auth/Restrictions', {
      role_ID: derivedRoleId2,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // Try to associate with the parent role - should fail because parent has duplicate restriction
    try {
      await POST('/odata/v4/auth/RoleInheritance', {
        role_ID: derivedRoleId2,
        parent_ID: parentRoleId
      });
      assert.fail('Should have failed to create inheritance due to duplicate restriction');
    } catch (err) {
      assert.strictEqual(err.status, 400, 'Should return 400 Bad Request');
      assert.ok(err.message.includes('duplicate restrictions'), 'Should throw the duplicate inheritance error');
    }

    // Cleanup
    await DELETE(`/odata/v4/auth/Roles('${derivedRoleId}')`);
    await DELETE(`/odata/v4/auth/Roles('${derivedRoleId2}')`);
    await DELETE(`/odata/v4/auth/Roles('${parentRoleId}')`);
  });

});

