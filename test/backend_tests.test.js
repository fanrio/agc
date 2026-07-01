// Mock @sap/hana-client in Node require cache before any other modules load
const mockHana = {
  createConnection: () => ({
    connect: (params, cb) => cb(null),
    exec: (sql, cb) => {
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

// Mock global.fetch to intercept external BDC/Datasphere calls
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
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
    // Retrieve an OrgNode ID from DB data
    const nodesRes = await GET('/odata/v4/auth/OrgNodes');
    assert.strictEqual(nodesRes.status, 200);
    const firstNode = nodesRes.data.value[0];
    assert.ok(firstNode, 'At least one OrgNode should exist in test seed');

    // Call generateOrgRole
    const genRes = await POST('/odata/v4/auth/generateOrgRole', { orgNodeId: firstNode.ID });
    assert.strictEqual(genRes.status, 200);
    assert.ok(genRes.data.roleId);
    assert.ok(genRes.data.roleName);

    // Call generateOrgRole on non-existent OrgNode (should return 404)
    await assertODataError(
      POST('/odata/v4/auth/generateOrgRole', { orgNodeId: '00000000-0000-0000-0000-000000000000' }),
      404
    );

    // Call generateAllOrgRoles
    const genAllRes = await POST('/odata/v4/auth/generateAllOrgRoles', {});
    assert.strictEqual(genAllRes.status, 200);
    assert.ok(genAllRes.data.count > 0);
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

    // PATTERN restriction
    await POST('/odata/v4/auth/Restrictions', { role_ID: rId, field: 'CompanyCode', filterType: 'PATTERN', value: 'CC%' });

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
      // Row 5: PATTERN failing
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

  // 8. searchLdapUsers
  await t.test('searchLdapUsers action', async () => {
    // With query
    const res = await POST('/odata/v4/auth/searchLdapUsers', { query: 'jdoe' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.value.length, 1);
    assert.strictEqual(res.data.value[0].username, 'jdoe');

    // Without query (returns all)
    const resAll = await POST('/odata/v4/auth/searchLdapUsers', { query: '' });
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
    // Deactivate all existing connections to avoid OData connection collision
    await cds.db.run(UPDATE('fanrio.auth.BdcSettings').set({ isActive: false }));

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
    if (trigRes.status !== 200 || !trigRes.data.success) {
      console.log("=== DEBUG triggerReplication FAIL ===");
      console.log("status:", trigRes.status);
      console.log("data:", JSON.stringify(trigRes.data, null, 2));
    }
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
  });

});
