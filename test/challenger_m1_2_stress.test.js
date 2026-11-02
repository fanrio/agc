'use strict';

/**
 * Empirical Stress Test Suite — Challenger 2 (Milestone 1)
 *
 * Focus Areas:
 * 1. Edge cases on workspace URLs: missing protocol, trailing slashes, IP addresses, whitespace, ports.
 * 2. Non-existent settingId (expect 404).
 * 3. Missing parameters (expect 400).
 * 4. Verify CAP server does not crash or throw unhandled promise rejections on simulated remote connection dropouts.
 */

// ---------------------------------------------------------------------------
// 0. Process-level unhandled rejection tracker
// ---------------------------------------------------------------------------
const unhandledRejections = [];
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION DETECTED:', reason);
  unhandledRejections.push(reason);
});

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
// 2. Imports & Test Bootstrap
// ---------------------------------------------------------------------------
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const cds = require('@sap/cds');
const DatabricksClient = require('../srv/lib/databricksClient');
const { DatabricksHttpAdapter, DatabricksMockAdapter } = DatabricksClient;

const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

test('Challenger 2 Empirical Stress Tests: testDatabricksConnection & Settings Management', async (t) => {
  const createdSettingIds = [];

  const assertODataError = async (promise, expectedStatus, expectedMessageSubstring = null) => {
    try {
      await promise;
      assert.fail(`Expected OData call to fail with status ${expectedStatus}`);
    } catch (err) {
      const status = err.status || err.response?.status;
      assert.strictEqual(status, expectedStatus, `Expected status ${expectedStatus}, got ${status}`);
      if (expectedMessageSubstring) {
        const msg = err.message || JSON.stringify(err.response?.data || {});
        assert.ok(
          msg.includes(expectedMessageSubstring),
          `Expected message to include '${expectedMessageSubstring}', but got '${msg}'`
        );
      }
    }
  };

  const createTestSetting = async (overrides = {}) => {
    const payload = {
      systemName: `CHALLENGE_STRESS_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'TOKEN',
      apiToken: 'dapi_mock_token_challenge',
      targetCatalog: 'main',
      targetSchema: 'default',
      sqlWarehouseId: 'wh-challenge-01',
      isActive: true,
      ...overrides
    };
    const res = await POST('/odata/v4/auth/DatabricksSettings', payload);
    assert.strictEqual(res.status, 201, `Failed creating DatabricksSetting: ${JSON.stringify(res.data)}`);
    createdSettingIds.push(res.data.ID);
    return res.data;
  };

  t.after(async () => {
    // Cleanup any created DatabricksSettings
    for (const id of createdSettingIds) {
      try {
        await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${id})`);
      } catch (err) {
        // ignore cleanup errors
      }
    }
    // Reset DatabricksClient adapter
    DatabricksClient.resetAdapter();
    DatabricksClient.getMockAdapter().reset();
  });

  // =========================================================================
  // SECTION 1: Workspace URL Edge Cases
  // =========================================================================
  await t.test('1. Workspace URL Edge Cases', async (t1) => {
    await t1.test('1.1 DatabricksHttpAdapter.normalizeWorkspaceUrl unit edge cases', () => {
      const adapter = new DatabricksHttpAdapter();

      // Missing protocol -> prepends https://
      assert.strictEqual(adapter.normalizeWorkspaceUrl('adb-12345.azuredatabricks.net'), 'https://adb-12345.azuredatabricks.net');
      assert.strictEqual(adapter.normalizeWorkspaceUrl('community.cloud.databricks.com'), 'https://community.cloud.databricks.com');

      // Trailing slashes -> stripped
      assert.strictEqual(adapter.normalizeWorkspaceUrl('https://my-workspace.com/'), 'https://my-workspace.com');
      assert.strictEqual(adapter.normalizeWorkspaceUrl('https://my-workspace.com///'), 'https://my-workspace.com');
      assert.strictEqual(adapter.normalizeWorkspaceUrl('http://my-workspace.com:8080/path///'), 'http://my-workspace.com:8080/path');

      // Whitespace -> trimmed
      assert.strictEqual(adapter.normalizeWorkspaceUrl('   https://workspace.com/   '), 'https://workspace.com');
      assert.strictEqual(adapter.normalizeWorkspaceUrl('  adb-xyz.net/  '), 'https://adb-xyz.net');

      // IP addresses & ports
      assert.strictEqual(adapter.normalizeWorkspaceUrl('127.0.0.1:8080'), 'https://127.0.0.1:8080');
      assert.strictEqual(adapter.normalizeWorkspaceUrl('http://192.168.1.100:8443/'), 'http://192.168.1.100:8443');

      // Null, undefined, empty
      assert.strictEqual(adapter.normalizeWorkspaceUrl(''), '');
      assert.strictEqual(adapter.normalizeWorkspaceUrl(null), '');
      assert.strictEqual(adapter.normalizeWorkspaceUrl(undefined), '');
    });

    await t1.test('1.2 Action validation: Missing protocol is rejected with httpStatus 400', async () => {
      // In cortex_service.js, workspaceUrl is required to begin with http:// or https://
      const setting = await createTestSetting({
        workspaceUrl: 'adb-9876543210.11.azuredatabricks.net'
      });

      const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: setting.ID });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.httpStatus, 400);
      assert.ok(res.data.message.includes('URL must begin with http:// or https://'));
    });

    await t1.test('1.3 Action validation: Trailing slashes are accepted and tested successfully', async () => {
      const setting = await createTestSetting({
        workspaceUrl: 'https://mock-workspace.cloud.databricks.com///'
      });

      const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: setting.ID });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.httpStatus, 200);
      assert.ok(res.data.message.includes('verified successfully'));
    });

    await t1.test('1.4 Action validation: IP address workspace URLs with and without port', async () => {
      // IPv4 with port
      const ipSetting1 = await createTestSetting({
        workspaceUrl: 'https://10.0.0.1:8443'
      });
      const res1 = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: ipSetting1.ID });
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.success, true);
      assert.strictEqual(res1.data.httpStatus, 200);

      // IPv4 HTTP with port
      const ipSetting2 = await createTestSetting({
        workspaceUrl: 'http://192.168.1.254:8080/'
      });
      const res2 = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: ipSetting2.ID });
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.success, true);
      assert.strictEqual(res2.data.httpStatus, 200);
    });

    await t1.test('1.5 Action validation: Whitespace handling', async () => {
      // Leading and trailing whitespace around valid URL
      const trimmedSetting = await createTestSetting({
        workspaceUrl: '   https://mock-workspace.cloud.databricks.com/   '
      });
      const resTrimmed = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: trimmedSetting.ID });
      assert.strictEqual(resTrimmed.status, 200);
      assert.strictEqual(resTrimmed.data.success, true);
      assert.strictEqual(resTrimmed.data.httpStatus, 200);

      // Whitespace-only workspaceUrl
      const whitespaceOnlySetting = await createTestSetting({
        workspaceUrl: '     '
      });
      const resWsOnly = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: whitespaceOnlySetting.ID });
      assert.strictEqual(resWsOnly.status, 200);
      assert.strictEqual(resWsOnly.data.success, false);
      assert.strictEqual(resWsOnly.data.httpStatus, 400);
      assert.ok(resWsOnly.data.message.includes('Invalid or missing workspace URL'));
    });

    await t1.test('1.6 Action validation: Non-HTTP protocols (ftp://, javascript:, file://)', async () => {
      for (const badProtocolUrl of ['ftp://databricks.example.com', 'file:///etc/passwd', 'javascript:void(0)']) {
        const badSetting = await createTestSetting({ workspaceUrl: badProtocolUrl });
        const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: badSetting.ID });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, false);
        assert.strictEqual(res.data.httpStatus, 400);
        assert.ok(res.data.message.includes('URL must begin with http:// or https://'));
      }
    });

    await t1.test('1.7 Action validation: Bare protocol strings without host (http://, https://)', async () => {
      for (const bareUrl of ['http://', 'https://']) {
        const bareSetting = await createTestSetting({ workspaceUrl: bareUrl });
        const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: bareSetting.ID });
        assert.strictEqual(res.status, 200);
        // Should not crash the server regardless of mock adapter or HTTP validation
        assert.ok([200, 400, 500, 502].includes(res.data.httpStatus));
      }
    });
  });

  // =========================================================================
  // SECTION 2: Non-existent settingId (Expect 404)
  // =========================================================================
  await t.test('2. Non-existent settingId (Expect 404)', async (t2) => {
    await t2.test('2.1 Non-existent all-zero UUID', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {
          settingId: '00000000-0000-0000-0000-000000000000'
        }),
        404,
        'not found'
      );
    });

    await t2.test('2.2 Non-existent random valid UUID', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {
          settingId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
        }),
        404,
        'not found'
      );
    });

    await t2.test('2.3 Non-UUID string format for settingId is rejected as malformed UUID by OData (400)', async () => {
      // CAP enforces UUID format validation on action parameters declared as UUID
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {
          settingId: 'completely-invalid-non-uuid-identifier'
        }),
        400
      );
    });

    await t2.test('2.4 Numeric string for settingId queries DB and returns 404 Not Found', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {
          settingId: '999999999'
        }),
        404,
        'not found'
      );
    });
  });

  // =========================================================================
  // SECTION 3: Missing parameters (Expect 400)
  // =========================================================================
  await t.test('3. Missing parameters (Expect 400)', async (t3) => {
    await t3.test('3.1 Empty JSON payload {}', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {}),
        400,
        'Parameter settingId is required'
      );
    });

    await t3.test('3.2 Explicit null settingId', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', { settingId: null }),
        400,
        'Parameter settingId is required'
      );
    });

    await t3.test('3.3 Empty string settingId', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', { settingId: '' }),
        400,
        'Parameter settingId is required'
      );
    });

    await t3.test('3.4 Unrelated parameters without settingId (strict OData validation 400)', async () => {
      await assertODataError(
        POST('/odata/v4/auth/testDatabricksConnection', {
          otherParam: 'value'
        }),
        400
      );
    });
  });

  // =========================================================================
  // SECTION 4: Remote connection dropouts, unhandled rejections, server crash prevention
  // =========================================================================
  await t.test('4. Remote connection dropouts & server stability', async (t4) => {
    const validSetting = await createTestSetting({
      systemName: 'TEST_STABILITY_SETTING',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'TOKEN',
      apiToken: 'dapi_valid_token'
    });

    const mockAdapter = DatabricksClient.getMockAdapter();

    await t4.test('4.1 Simulated remote network dropouts via mock adapter failure modes', async () => {
      const modesToTest = [
        { mode: 'NETWORK_ERROR', expectedStatus: 502 },
        { mode: 'AUTH_FAILED', expectedStatus: 401 },
        { mode: 'WAREHOUSE_UNAVAILABLE', expectedStatus: 503 },
        { mode: new Error('ECONNRESET: Connection reset by peer'), expectedStatus: 500 },
        { mode: new Error('ETIMEDOUT: Connection timed out'), expectedStatus: 500 },
        { mode: new Error('socket hang up'), expectedStatus: 500 },
        { mode: new Error('FetchError: request to https://... failed, reason: connect ECONNREFUSED'), expectedStatus: 500 }
      ];

      for (const { mode, expectedStatus } of modesToTest) {
        mockAdapter.setFailureMode(mode);
        const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: validSetting.ID });
        assert.strictEqual(res.status, 200, 'CAP OData action must respond with HTTP 200 envelope');
        assert.strictEqual(res.data.success, false, 'Result must indicate failure');
        assert.strictEqual(res.data.httpStatus, expectedStatus, `Expected httpStatus ${expectedStatus} for mode ${typeof mode === 'string' ? mode : mode.message}`);
        assert.ok(res.data.message, 'Failure message must be present');
      }

      mockAdapter.setFailureMode(null);
    });

    await t4.test('4.2 Live HTTP server dropouts with DatabricksHttpAdapter (Real Socket Abort & Dropout)', async () => {
      // Create an ephemeral HTTP server to simulate real low-level socket dropouts
      let serverBehavior = 'close_immediately';
      const liveServer = http.createServer((req, res) => {
        if (serverBehavior === 'close_immediately') {
          // Hard TCP abort / reset
          req.socket.destroy();
        } else if (serverBehavior === 'destroy_after_headers') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          req.socket.destroy();
        } else if (serverBehavior === 'status_502') {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Bad Gateway' }));
        } else if (serverBehavior === 'status_503') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Service Unavailable' }));
        }
      });

      await new Promise(resolve => liveServer.listen(0, '127.0.0.1', resolve));
      const port = liveServer.address().port;
      const ephemeralUrl = `http://127.0.0.1:${port}`;

      const httpAdapter = new DatabricksHttpAdapter();

      try {
        // Test 1: Immediate socket destruction (ECONNRESET / fetch failed)
        serverBehavior = 'close_immediately';
        const result1 = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-token'
        });
        assert.strictEqual(result1.success, false);
        assert.strictEqual(result1.httpStatus, 500);
        assert.ok(result1.message.includes('Connection test error'));

        // Test 2: Destroy after writing headers
        serverBehavior = 'destroy_after_headers';
        const result2 = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-token'
        });
        assert.strictEqual(result2.success, false);
        assert.strictEqual(result2.httpStatus, 500);

        // Test 3: HTTP 502
        serverBehavior = 'status_502';
        const result3 = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-token'
        });
        assert.strictEqual(result3.success, false);
        assert.strictEqual(result3.httpStatus, 502);

        // Test 4: HTTP 503
        serverBehavior = 'status_503';
        const result4 = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-token'
        });
        assert.strictEqual(result4.success, false);
        assert.strictEqual(result4.httpStatus, 503);

        // Test 5: Wire DatabricksClient to HTTP adapter against the dropping server through OData action
        DatabricksClient.setAdapter(httpAdapter);
        serverBehavior = 'close_immediately';

        const liveDropSetting = await createTestSetting({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-live-token'
        });

        const odataRes = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: liveDropSetting.ID });
        assert.strictEqual(odataRes.status, 200);
        assert.strictEqual(odataRes.data.success, false);
        assert.strictEqual(odataRes.data.httpStatus, 500);
        assert.ok(odataRes.data.message.includes('Connection test error'));

        // Test 6: Service Principal OAuth token network dropout
        serverBehavior = 'close_immediately';
        const spResult = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'SERVICE_PRINCIPAL',
          clientId: 'sp-client-test',
          clientSecret: 'sp-secret-test'
        });
        assert.strictEqual(spResult.success, false);
        assert.strictEqual(spResult.httpStatus, 500);
        assert.ok(spResult.message.includes('Connection test error'));

        // Test 7: SQL Warehouse execution failure status
        serverBehavior = 'status_502';
        const whResult = await httpAdapter.testConnection({
          workspaceUrl: ephemeralUrl,
          authType: 'TOKEN',
          apiToken: 'test-token',
          sqlWarehouseId: 'wh-test-fail'
        });
        assert.strictEqual(whResult.success, false);
        assert.strictEqual(whResult.httpStatus, 502);
      } finally {
        DatabricksClient.resetAdapter();
        await new Promise(resolve => liveServer.close(resolve));
      }
    });

    await t4.test('4.3 Zero unhandled promise rejections occurred throughout tests', () => {
      assert.strictEqual(
        unhandledRejections.length,
        0,
        `Detected ${unhandledRejections.length} unhandled promise rejections: ${unhandledRejections.map(r => r?.stack || r).join('\n')}`
      );
    });

    await t4.test('4.4 Authentication validation: Unsupported authType and whitespace tokens', async () => {
      // Unsupported authType
      const badAuthSetting = await createTestSetting({
        authType: 'SAML_SSO',
        apiToken: 'some-token'
      });
      const resBadAuth = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: badAuthSetting.ID });
      assert.strictEqual(resBadAuth.status, 200);
      assert.strictEqual(resBadAuth.data.success, false);
      assert.strictEqual(resBadAuth.data.httpStatus, 400);
      assert.ok(resBadAuth.data.message.includes('Unsupported authentication type'));

      // Whitespace-only apiToken for TOKEN auth
      const wsTokenSetting = await createTestSetting({
        authType: 'TOKEN',
        apiToken: '     '
      });
      const resWsToken = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: wsTokenSetting.ID });
      assert.strictEqual(resWsToken.status, 200);
      assert.strictEqual(resWsToken.data.success, false);
      assert.strictEqual(resWsToken.data.httpStatus, 400);
      assert.ok(resWsToken.data.message.includes('Missing API Bearer Token'));

      // Whitespace clientId / clientSecret for SERVICE_PRINCIPAL auth
      const wsSpSetting = await createTestSetting({
        authType: 'SERVICE_PRINCIPAL',
        clientId: '   ',
        clientSecret: 'secret'
      });
      const resWsSp = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: wsSpSetting.ID });
      assert.strictEqual(resWsSp.status, 200);
      assert.strictEqual(resWsSp.data.success, false);
      assert.strictEqual(resWsSp.data.httpStatus, 400);
      assert.ok(resWsSp.data.message.includes('Missing Client ID or Client Secret'));
    });

    await t4.test('4.5 Credential protection: apiToken and clientSecret never exposed on READ', async () => {
      const secureSetting = await createTestSetting({
        systemName: 'TEST_CREDENTIAL_PROTECTION',
        authType: 'TOKEN',
        apiToken: 'super-sensitive-secret-token-xyz'
      });

      // Direct read via OData
      const readRes = await GET(`/odata/v4/auth/DatabricksSettings(ID=${secureSetting.ID})`);
      assert.strictEqual(readRes.status, 200);
      assert.strictEqual(readRes.data.apiToken, undefined, 'apiToken MUST be redacted on READ');
      assert.strictEqual(readRes.data.clientSecret, undefined, 'clientSecret MUST be redacted on READ');

      // Array read via OData
      const listRes = await GET('/odata/v4/auth/DatabricksSettings');
      assert.strictEqual(listRes.status, 200);
      const foundInList = listRes.data.value.find(s => s.ID === secureSetting.ID);
      assert.ok(foundInList);
      assert.strictEqual(foundInList.apiToken, undefined);
      assert.strictEqual(foundInList.clientSecret, undefined);
    });

    await t4.test('4.6 CAP server remains healthy, responsive, and uncorrupted after all stress tests', async () => {
      mockAdapter.reset();

      // Test happy path again to confirm server runtime is completely intact
      const res = await POST('/odata/v4/auth/testDatabricksConnection', { settingId: validSetting.ID });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.httpStatus, 200);

      // Verify DB queries still work properly
      const getSetting = await GET(`/odata/v4/auth/DatabricksSettings(ID=${validSetting.ID})`);
      assert.strictEqual(getSetting.status, 200);
      assert.strictEqual(getSetting.data.systemName, 'TEST_STABILITY_SETTING');
    });
  });
});
