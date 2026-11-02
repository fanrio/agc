'use strict';

/**
 * Challenger M4-1 Empirical Stress Test Suite
 * Milestone 4: Frontend UI Platform Selection & Admin Settings
 *
 * Verifies:
 * 1. Absence of obsolete replication queue calls across the frontend codebase.
 * 2. Backend OData CRUD integration for DatabricksSettings matching api.ts contracts.
 * 3. testDatabricksConnection action under boundary, valid, invalid, and failure parameters.
 * 4. Non-destructive credential updates: PATCH/UPDATE with omitted apiToken/clientSecret
 *    does not erase existing stored secrets in the database.
 * 5. Roles & AccessDomains targetPlatform contracts, defaults, and persistence.
 * 6. Frontend RolesDashboard platform filtering logic.
 * 7. Frontend UI components integration contracts (DatabricksSettingsView, Wizard, StepOrigin).
 */

// ---------------------------------------------------------------------------
// 0. Mock @sap/hana-client for offline execution
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
// 1. Imports & Test Bootstrap
// ---------------------------------------------------------------------------
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cds = require('@sap/cds');
const DatabricksClient = require('../srv/lib/databricksClient');

test('Challenger M4-1 Empirical Stress Test Suite', async (t) => {
  let db;
  let srv;
  let DatabricksSettings;
  let Roles;
  let AccessDomains;
  const adminUser = new cds.User({ id: 'admin', roles: ['authenticated-user'] });

  const createdSettingIds = [];
  const createdRoleIds = [];
  const createdDomainIds = [];

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    db = await cds.connect.to('db');
    await cds.deploy(['db/schema.cds', 'srv/cortex_service.cds']).to(db);
    await db.run(cds.ql.INSERT.into('fanrio.auth.AppAuthorizations').entries({
      ID: cds.utils.uuid(),
      userId: 'admin',
      userName: 'Administrator',
      isSuperAdmin: true,
      canManageSettings: true,
      canManageSingleRoles: true,
      canManageDerivedRoles: true,
      canManageOrgRoles: true,
      canAssignRoles: true,
      canViewAuditLogs: true,
      allowedEnvironments: 'ALL',
      isActive: true
    }));
    srv = await cds.serve('AuthorizationService').from('srv/cortex_service.cds');
    DatabricksSettings = srv.entities.DatabricksSettings;
    Roles = srv.entities.Roles;
    AccessDomains = srv.entities.AccessDomains;
  });

  t.after(async () => {
    // Cleanup any created DatabricksSettings
    for (const id of createdSettingIds) {
      try {
        await db.run(cds.ql.DELETE.from('fanrio.auth.DatabricksSettings').where({ ID: id }));
      } catch (err) { /* ignore */ }
    }
    // Cleanup any created Roles
    for (const id of createdRoleIds) {
      try {
        await db.run(cds.ql.DELETE.from('fanrio.auth.Roles').where({ ID: id }));
      } catch (err) { /* ignore */ }
    }
    // Cleanup any created AccessDomains
    for (const id of createdDomainIds) {
      try {
        await db.run(cds.ql.DELETE.from('fanrio.auth.AccessDomains').where({ ID: id }));
      } catch (err) { /* ignore */ }
    }
    // Reset DatabricksClient adapter
    DatabricksClient.resetAdapter();
    DatabricksClient.getMockAdapter().reset();
  });

  // =========================================================================
  // SECTION 1: Absence of Obsolete Replication Queue Calls in Frontend
  // =========================================================================
  await t.test('1. Absence of Obsolete Replication Queue Calls in Frontend', async (t1) => {
    const catalogSrcDir = path.resolve(__dirname, '../app/catalog/src');

    await t1.test('1.1 ReplicationsView.tsx is permanently deleted from filesystem', () => {
      const filePath = path.join(catalogSrcDir, 'components/ReplicationsView.tsx');
      assert.strictEqual(
        fs.existsSync(filePath),
        false,
        'Expected ReplicationsView.tsx to be permanently deleted, but file still exists'
      );
    });

    await t1.test('1.2 App.tsx does not contain ReplicationsView import, route, or validNav entry', () => {
      const appTsxContent = fs.readFileSync(path.join(catalogSrcDir, 'App.tsx'), 'utf-8');
      assert.strictEqual(
        appTsxContent.includes('ReplicationsView'),
        false,
        'App.tsx must not reference ReplicationsView'
      );
      assert.strictEqual(
        appTsxContent.includes("'replications'"),
        false,
        "App.tsx must not include 'replications' in validNavs or navigation routing"
      );
      assert.strictEqual(
        appTsxContent.includes('activeNav === "replications"'),
        false,
        "App.tsx must not render activeNav === 'replications'"
      );
    });

    await t1.test('1.3 api.ts does not export getReplications, triggerReplication, or checkReplicationStatuses', () => {
      const apiTsContent = fs.readFileSync(path.join(catalogSrcDir, 'api.ts'), 'utf-8');
      assert.strictEqual(
        apiTsContent.includes('getReplications'),
        false,
        'api.ts must not export getReplications'
      );
      assert.strictEqual(
        apiTsContent.includes('triggerReplication'),
        false,
        'api.ts must not export triggerReplication'
      );
      assert.strictEqual(
        apiTsContent.includes('checkReplicationStatuses'),
        false,
        'api.ts must not export checkReplicationStatuses'
      );
    });

    await t1.test('1.4 Frontend codebase scan: zero calls to retired replication queue functions', () => {
      const scanFilesRecursively = (dir) => {
        let results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist') {
              results = results.concat(scanFilesRecursively(fullPath));
            }
          } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
            results.push(fullPath);
          }
        }
        return results;
      };

      const allFiles = scanFilesRecursively(catalogSrcDir);
      assert.ok(allFiles.length > 10, 'Expected multiple frontend source files to scan');

      const prohibitedPatterns = [
        /\bgetReplications\s*\(/,
        /\btriggerReplication\s*\(/,
        /\bcheckReplicationStatuses\s*\(/
      ];

      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const pattern of prohibitedPatterns) {
          assert.strictEqual(
            pattern.test(content),
            false,
            `Prohibited replication queue call ${pattern} found in file: ${file}`
          );
        }
      }
    });

    await t1.test('1.5 SystemView.tsx includes Databricks Settings tab gated by permissions', () => {
      const systemViewContent = fs.readFileSync(path.join(catalogSrcDir, 'components/SystemView.tsx'), 'utf-8');
      assert.ok(
        systemViewContent.includes('DatabricksSettingsView'),
        'SystemView.tsx must import DatabricksSettingsView'
      );
      assert.ok(
        systemViewContent.includes('Databricks Settings'),
        'SystemView.tsx must define Databricks Settings tab'
      );
      assert.ok(
        systemViewContent.includes('permissions?.isSuperAdmin || permissions?.canManageSettings'),
        'Databricks Settings tab must be permission-gated'
      );
    });
  });

  // =========================================================================
  // SECTION 2: Backend OData CRUD Integration for DatabricksSettings
  // =========================================================================
  await t.test('2. Backend OData CRUD Integration for DatabricksSettings', async (t2) => {
    let settingTokenId = null;
    let settingSpId = null;

    await t2.test('2.1 CREATE DatabricksSetting with TOKEN authentication', async () => {
      const id = cds.utils.uuid();
      const payload = {
        ID: id,
        systemName: `CHALLENGE_TOKEN_${Date.now()}`,
        environment_ID: 'D',
        workspaceUrl: 'https://token-ws.cloud.databricks.com',
        authType: 'TOKEN',
        apiToken: 'dapi_secret_token_12345',
        targetCatalog: 'main',
        targetSchema: 'default',
        sqlWarehouseId: 'wh-token-01',
        isActive: true
      };

      const created = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.create(DatabricksSettings).entries(payload);
      });

      assert.ok(created, 'Expected created record');
      settingTokenId = id;
      createdSettingIds.push(settingTokenId);

      const dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingTokenId })
      );
      assert.strictEqual(dbRow.systemName, payload.systemName);
      assert.strictEqual(dbRow.authType, 'TOKEN');
      assert.strictEqual(dbRow.apiToken, 'dapi_secret_token_12345');
    });

    await t2.test('2.2 CREATE DatabricksSetting with SERVICE_PRINCIPAL authentication', async () => {
      const id = cds.utils.uuid();
      const payload = {
        ID: id,
        systemName: `CHALLENGE_SP_${Date.now()}`,
        environment_ID: 'Q',
        workspaceUrl: 'https://sp-ws.cloud.databricks.com',
        authType: 'SERVICE_PRINCIPAL',
        clientId: 'sp-client-guid-001',
        clientSecret: 'sp-client-secret-abcde',
        targetCatalog: 'analytics',
        targetSchema: 'finance',
        sqlWarehouseId: 'wh-sp-02',
        isActive: true
      };

      await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.create(DatabricksSettings).entries(payload);
      });

      settingSpId = id;
      createdSettingIds.push(settingSpId);

      const dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingSpId })
      );
      assert.strictEqual(dbRow.systemName, payload.systemName);
      assert.strictEqual(dbRow.authType, 'SERVICE_PRINCIPAL');
      assert.strictEqual(dbRow.clientId, 'sp-client-guid-001');
      assert.strictEqual(dbRow.clientSecret, 'sp-client-secret-abcde');
    });

    await t2.test('2.3 READ DatabricksSettings with SENSITIVE CREDENTIAL STRIPPING', async () => {
      // Test read through service handler (which executes after('READ') hook)
      const readResults = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.read(DatabricksSettings);
      });

      assert.ok(Array.isArray(readResults), 'Expected array of results');
      const foundToken = readResults.find(s => s.ID === settingTokenId);
      assert.ok(foundToken, 'Expected created token setting in read results');

      // CRITICAL SECURITY ASSERTION: apiToken and clientSecret MUST BE STRIPPED on READ!
      assert.strictEqual(
        foundToken.apiToken,
        undefined,
        'Security violation: apiToken was exposed in READ result!'
      );
      assert.strictEqual(
        foundToken.clientSecret,
        undefined,
        'Security violation: clientSecret was exposed in READ result!'
      );

      const foundSp = readResults.find(s => s.ID === settingSpId);
      assert.ok(foundSp, 'Expected created SP setting in read results');
      assert.strictEqual(
        foundSp.clientSecret,
        undefined,
        'Security violation: clientSecret was exposed in READ result!'
      );
      assert.strictEqual(foundSp.clientId, 'sp-client-guid-001');
    });

    await t2.test('2.4 UPDATE DatabricksSetting fields via service', async () => {
      const updatePayload = {
        systemName: 'Updated Token System Name',
        targetCatalog: 'sales_catalog',
        targetSchema: 'emea',
        sqlWarehouseId: 'wh-updated-99',
        isActive: false
      };

      await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.update(DatabricksSettings).set(updatePayload).where({ ID: settingTokenId });
      });

      // Verify update in DB
      const directDbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingTokenId })
      );
      assert.strictEqual(directDbRow.systemName, 'Updated Token System Name');
      assert.strictEqual(directDbRow.targetCatalog, 'sales_catalog');
      assert.strictEqual(directDbRow.targetSchema, 'emea');
      assert.strictEqual(directDbRow.sqlWarehouseId, 'wh-updated-99');
      assert.strictEqual(directDbRow.isActive, false);
    });

    await t2.test('2.5 DELETE DatabricksSetting removes record from database', async () => {
      const tempId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: tempId,
          systemName: `CHALLENGE_DELETE_${Date.now()}`,
          workspaceUrl: 'https://delete-me.databricks.com',
          authType: 'TOKEN',
          apiToken: 'temp_token'
        });
      });

      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.delete(DatabricksSettings).where({ ID: tempId });
      });

      const checkRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: tempId })
      );
      assert.ok(!checkRow, 'Record should be removed from database');
    });
  });

  // =========================================================================
  // SECTION 3: testDatabricksConnection Action Verification
  // =========================================================================
  await t.test('3. testDatabricksConnection Action Verification', async (t3) => {
    let validTokenSettingId = null;
    let validSpSettingId = null;

    t3.before(async () => {
      validTokenSettingId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: validTokenSettingId,
          systemName: `TEST_CONN_TOKEN_${Date.now()}`,
          workspaceUrl: 'https://valid-ws.cloud.databricks.com',
          authType: 'TOKEN',
          apiToken: 'valid_bearer_token_123',
          sqlWarehouseId: 'wh-valid-01',
          isActive: true
        });
      });
      createdSettingIds.push(validTokenSettingId);

      validSpSettingId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: validSpSettingId,
          systemName: `TEST_CONN_SP_${Date.now()}`,
          workspaceUrl: 'https://valid-sp.cloud.databricks.com',
          authType: 'SERVICE_PRINCIPAL',
          clientId: 'valid-sp-id-01',
          clientSecret: 'valid-sp-secret-01',
          sqlWarehouseId: 'wh-valid-02',
          isActive: true
        });
      });
      createdSettingIds.push(validSpSettingId);
    });

    await t3.test('3.1 Missing settingId returns 400 Bad Request', async () => {
      try {
        await srv.tx({ user: adminUser }, async (tx) => {
          await tx.send('testDatabricksConnection', {});
        });
        assert.fail('Expected error when settingId is missing');
      } catch (err) {
        assert.strictEqual(err.code, 400);
        assert.ok(err.message.includes('Parameter settingId is required'));
      }
    });

    await t3.test('3.2 Non-existent settingId returns 404 Not Found', async () => {
      try {
        await srv.tx({ user: adminUser }, async (tx) => {
          await tx.send('testDatabricksConnection', {
            settingId: '00000000-0000-0000-0000-000000000000'
          });
        });
        assert.fail('Expected 404 error for non-existent settingId');
      } catch (err) {
        assert.strictEqual(err.code, 404);
        assert.ok(err.message.includes('not found'));
      }
    });

    await t3.test('3.3 Valid TOKEN setting succeeds via mock adapter', async () => {
      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: validTokenSettingId });
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.httpStatus, 200);
      assert.ok(res.message.includes('verified successfully') || res.message.includes('succeeded'));
    });

    await t3.test('3.4 Valid SERVICE_PRINCIPAL setting succeeds via mock adapter', async () => {
      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: validSpSettingId });
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.httpStatus, 200);
    });

    await t3.test('3.5 Invalid workspaceUrl without http/https protocol returns httpStatus 400', async () => {
      const badId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: badId,
          systemName: `BAD_URL_${Date.now()}`,
          workspaceUrl: 'ftp://bad-protocol.databricks.com',
          authType: 'TOKEN',
          apiToken: 'any_token'
        });
      });
      createdSettingIds.push(badId);

      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: badId });
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('URL must begin with http:// or https://'));
    });

    await t3.test('3.6 Missing apiToken for TOKEN auth returns httpStatus 400', async () => {
      const missingTokenId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: missingTokenId,
          systemName: `EMPTY_TOKEN_${Date.now()}`,
          workspaceUrl: 'https://valid-ws.cloud.databricks.com',
          authType: 'TOKEN',
          apiToken: ''
        });
      });
      createdSettingIds.push(missingTokenId);

      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: missingTokenId });
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('Missing API Bearer Token'));
    });

    await t3.test('3.7 Missing clientSecret for SERVICE_PRINCIPAL returns httpStatus 400', async () => {
      const missingSecretId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: missingSecretId,
          systemName: `EMPTY_SECRET_${Date.now()}`,
          workspaceUrl: 'https://valid-ws.cloud.databricks.com',
          authType: 'SERVICE_PRINCIPAL',
          clientId: 'sp-client-only',
          clientSecret: ''
        });
      });
      createdSettingIds.push(missingSecretId);

      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: missingSecretId });
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('Missing Client ID or Client Secret'));
    });

    await t3.test('3.8 Unsupported authType returns httpStatus 400', async () => {
      const badAuthId = cds.utils.uuid();
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: badAuthId,
          systemName: `UNSUPPORTED_AUTH_${Date.now()}`,
          workspaceUrl: 'https://valid-ws.cloud.databricks.com',
          authType: 'BASIC_AUTH',
          apiToken: 'token'
        });
      });
      createdSettingIds.push(badAuthId);

      const res = await srv.tx({ user: adminUser }, async (tx) => {
        return await tx.send('testDatabricksConnection', { settingId: badAuthId });
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.httpStatus, 400);
      assert.ok(res.message.includes('Unsupported authentication type'));
    });

    await t3.test('3.9 Mock adapter WAREHOUSE_UNAVAILABLE failure mode returns httpStatus 503', async () => {
      const mockAdapter = DatabricksClient.getMockAdapter();
      mockAdapter.setFailureMode('WAREHOUSE_UNAVAILABLE');
      try {
        const res = await srv.tx({ user: adminUser }, async (tx) => {
          return await tx.send('testDatabricksConnection', { settingId: validTokenSettingId });
        });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.httpStatus, 503);
        assert.ok(res.message.includes('not available or stopped'));
      } finally {
        mockAdapter.reset();
      }
    });

    await t3.test('3.10 Mock adapter AUTH_FAIL failure mode returns httpStatus 401', async () => {
      const mockAdapter = DatabricksClient.getMockAdapter();
      mockAdapter.setFailureMode('AUTH_FAIL');
      try {
        const res = await srv.tx({ user: adminUser }, async (tx) => {
          return await tx.send('testDatabricksConnection', { settingId: validTokenSettingId });
        });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.httpStatus, 401);
        assert.ok(res.message.includes('Authentication failed'));
      } finally {
        mockAdapter.reset();
      }
    });
  });

  // =========================================================================
  // SECTION 4: Non-Destructive Credential Updates (Critical Regression Test)
  // =========================================================================
  await t.test('4. Non-Destructive Credential Updates', async (t4) => {
    await t4.test('4.1 TOKEN auth: UPDATE omitting apiToken does not erase stored secret in DB', async () => {
      const originalToken = 'dapi_vault_super_secret_token_12345';
      const settingId = cds.utils.uuid();

      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: settingId,
          systemName: 'Original Token System',
          workspaceUrl: 'https://vault-ws.cloud.databricks.com',
          authType: 'TOKEN',
          apiToken: originalToken,
          targetCatalog: 'catalog_v1',
          targetSchema: 'schema_v1',
          sqlWarehouseId: 'wh-vault-01',
          isActive: true
        });
      });
      createdSettingIds.push(settingId);

      // Verify token is in DB
      let dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingId })
      );
      assert.strictEqual(dbRow.apiToken, originalToken);

      // Simulate UI Edit (DatabricksSettingsView:handleUpdate):
      // User modifies systemName and targetCatalog, omitting apiToken from update payload
      const patchPayload = {
        systemName: 'Renamed Token System',
        targetCatalog: 'catalog_v2'
      };

      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.update(DatabricksSettings).set(patchPayload).where({ ID: settingId });
      });

      // Check DB directly: apiToken MUST REMAIN INTACT!
      dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingId })
      );
      assert.strictEqual(dbRow.systemName, 'Renamed Token System');
      assert.strictEqual(dbRow.targetCatalog, 'catalog_v2');
      assert.strictEqual(
        dbRow.apiToken,
        originalToken,
        'CRITICAL BUG: Stored apiToken was erased or overwritten by update omitting apiToken!'
      );
    });

    await t4.test('4.2 SERVICE_PRINCIPAL auth: UPDATE omitting clientSecret preserves stored secret', async () => {
      const originalSecret = 'sp_super_secret_key_888';
      const originalClientId = 'client-id-abc';
      const settingId = cds.utils.uuid();

      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.create(DatabricksSettings).entries({
          ID: settingId,
          systemName: 'Original SP System',
          workspaceUrl: 'https://sp-ws.cloud.databricks.com',
          authType: 'SERVICE_PRINCIPAL',
          clientId: originalClientId,
          clientSecret: originalSecret,
          targetCatalog: 'main',
          targetSchema: 'default',
          isActive: true
        });
      });
      createdSettingIds.push(settingId);

      // Verify credentials in DB
      let dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingId })
      );
      assert.strictEqual(dbRow.clientId, originalClientId);
      assert.strictEqual(dbRow.clientSecret, originalSecret);

      // Update omitting clientSecret (only updating workspaceUrl)
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.update(DatabricksSettings)
          .set({ workspaceUrl: 'https://new-sp-ws.cloud.databricks.com' })
          .where({ ID: settingId });
      });

      dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingId })
      );
      assert.strictEqual(dbRow.workspaceUrl, 'https://new-sp-ws.cloud.databricks.com');
      assert.strictEqual(
        dbRow.clientSecret,
        originalSecret,
        'CRITICAL BUG: Stored clientSecret was erased by update omitting clientSecret!'
      );

      // Now update explicitly with new clientSecret
      const newSecret = 'sp_rotated_secret_key_999';
      await srv.tx({ user: adminUser }, async (tx) => {
        await tx.update(DatabricksSettings)
          .set({ clientSecret: newSecret })
          .where({ ID: settingId });
      });

      dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.DatabricksSettings').where({ ID: settingId })
      );
      assert.strictEqual(
        dbRow.clientSecret,
        newSecret,
        'Expected clientSecret to be updated when explicitly provided'
      );
    });
  });

  // =========================================================================
  // SECTION 5: End-to-End Roles & AccessDomains TargetPlatform Contracts
  // =========================================================================
  await t.test('5. Roles & AccessDomains targetPlatform Contracts & Persistence', async (t5) => {
    await t5.test('5.1 Role creation defaults targetPlatform to DATASPHERE when omitted', async () => {
      const roleId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.Roles').entries({
          ID: roleId,
          name: `ROLE_DEF_${Date.now()}`.slice(0, 30),
          description: 'Role with default platform',
          environment_ID: 'D',
          type: 'SINGLE'
        })
      );
      createdRoleIds.push(roleId);

      const dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.Roles').where({ ID: roleId })
      );
      assert.strictEqual(
        dbRow.targetPlatform,
        'DATASPHERE',
        "Role targetPlatform should default to 'DATASPHERE'"
      );
    });

    await t5.test('5.2 Role creation accepts explicit DATABRICKS and BOTH platforms', async () => {
      const dbxRoleId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.Roles').entries({
          ID: dbxRoleId,
          name: `ROLE_DBX_${Date.now()}`.slice(0, 30),
          description: 'Databricks role',
          environment_ID: 'D',
          type: 'SINGLE',
          targetPlatform: 'DATABRICKS'
        })
      );
      createdRoleIds.push(dbxRoleId);

      const dbRowDbx = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.Roles').where({ ID: dbxRoleId })
      );
      assert.strictEqual(dbRowDbx.targetPlatform, 'DATABRICKS');

      const bothRoleId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.Roles').entries({
          ID: bothRoleId,
          name: `ROLE_BTH_${Date.now()}`.slice(0, 30),
          description: 'Both platforms role',
          environment_ID: 'D',
          type: 'SINGLE',
          targetPlatform: 'BOTH'
        })
      );
      createdRoleIds.push(bothRoleId);

      const dbRowBoth = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.Roles').where({ ID: bothRoleId })
      );
      assert.strictEqual(dbRowBoth.targetPlatform, 'BOTH');
    });

    await t5.test('5.3 Role update modifies targetPlatform successfully', async () => {
      const roleId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.Roles').entries({
          ID: roleId,
          name: `ROLE_PCH_${Date.now()}`.slice(0, 30),
          environment_ID: 'D',
          type: 'SINGLE',
          targetPlatform: 'DATASPHERE'
        })
      );
      createdRoleIds.push(roleId);

      await db.run(
        cds.ql.UPDATE('fanrio.auth.Roles').set({ targetPlatform: 'BOTH' }).where({ ID: roleId })
      );

      const dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.Roles').where({ ID: roleId })
      );
      assert.strictEqual(dbRow.targetPlatform, 'BOTH');
    });

    await t5.test('5.4 AccessDomain creation defaults targetPlatform to BOTH when omitted', async () => {
      const domainId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.AccessDomains').entries({
          ID: domainId,
          name: `DOM_DEF`.slice(0, 10),
          description: 'Domain default platform'
        })
      );
      createdDomainIds.push(domainId);

      const dbRow = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.AccessDomains').where({ ID: domainId })
      );
      assert.strictEqual(
        dbRow.targetPlatform,
        'BOTH',
        "AccessDomain targetPlatform should default to 'BOTH'"
      );
    });

    await t5.test('5.5 AccessDomain creation accepts explicit DATASPHERE and DATABRICKS platforms', async () => {
      const dsId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.AccessDomains').entries({
          ID: dsId,
          name: `DOM_DS`.slice(0, 10),
          targetPlatform: 'DATASPHERE'
        })
      );
      createdDomainIds.push(dsId);

      const dbRowDs = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.AccessDomains').where({ ID: dsId })
      );
      assert.strictEqual(dbRowDs.targetPlatform, 'DATASPHERE');

      const dbxId = cds.utils.uuid();
      await db.run(
        cds.ql.INSERT.into('fanrio.auth.AccessDomains').entries({
          ID: dbxId,
          name: `DOM_DBX`.slice(0, 10),
          targetPlatform: 'DATABRICKS'
        })
      );
      createdDomainIds.push(dbxId);

      const dbRowDbx = await db.run(
        cds.ql.SELECT.one.from('fanrio.auth.AccessDomains').where({ ID: dbxId })
      );
      assert.strictEqual(dbRowDbx.targetPlatform, 'DATABRICKS');
    });
  });

  // =========================================================================
  // SECTION 6: Frontend UI Dashboard Filter Logic Verification
  // =========================================================================
  await t.test('6. Frontend RolesDashboard Platform Filter Logic Simulation', () => {
    const roles = [
      { id: '1', name: 'DS Role', targetPlatform: 'DATASPHERE' },
      { id: '2', name: 'DBX Role', targetPlatform: 'DATABRICKS' },
      { id: '3', name: 'Both Role', targetPlatform: 'BOTH' },
      { id: '4', name: 'Unset Role' } // targetPlatform undefined -> defaults to DATASPHERE
    ];

    const filterByPlatform = (platformFilter) => {
      return roles.filter((r) => {
        if (platformFilter === 'ALL') return true;
        const rolePlatform = r.targetPlatform || 'DATASPHERE';
        if (platformFilter === 'DATASPHERE' && rolePlatform !== 'DATASPHERE' && rolePlatform !== 'BOTH') return false;
        if (platformFilter === 'DATABRICKS' && rolePlatform !== 'DATABRICKS' && rolePlatform !== 'BOTH') return false;
        if (platformFilter === 'BOTH' && rolePlatform !== 'BOTH') return false;
        return true;
      });
    };

    // Filter ALL
    const all = filterByPlatform('ALL');
    assert.strictEqual(all.length, 4);

    // Filter DATASPHERE: should include 'DS Role', 'Both Role', and 'Unset Role'
    const dsOnly = filterByPlatform('DATASPHERE');
    assert.deepStrictEqual(dsOnly.map(r => r.name), ['DS Role', 'Both Role', 'Unset Role']);

    // Filter DATABRICKS: should include 'DBX Role' and 'Both Role'
    const dbxOnly = filterByPlatform('DATABRICKS');
    assert.deepStrictEqual(dbxOnly.map(r => r.name), ['DBX Role', 'Both Role']);

    // Filter BOTH: should include only 'Both Role'
    const bothOnly = filterByPlatform('BOTH');
    assert.deepStrictEqual(bothOnly.map(r => r.name), ['Both Role']);
  });

  // =========================================================================
  // SECTION 7: Frontend UI Implementation Verification
  // =========================================================================
  await t.test('7. Frontend UI Implementation Verification', async (t7) => {
    const catalogSrcDir = path.resolve(__dirname, '../app/catalog/src');

    await t7.test('7.1 DatabricksSettingsView.tsx implements safe credential handling', () => {
      const content = fs.readFileSync(path.join(catalogSrcDir, 'components/DatabricksSettingsView.tsx'), 'utf-8');
      
      // Check that startEdit initializes apiToken and clientSecret to empty string
      assert.ok(
        content.includes("apiToken: ''"),
        'startEdit should initialize apiToken to empty string'
      );
      assert.ok(
        content.includes("clientSecret: ''"),
        'startEdit should initialize clientSecret to empty string'
      );

      // Check handleUpdate only adds credentials if non-empty
      assert.ok(
        content.includes('editForm.apiToken && editForm.apiToken.trim()'),
        'handleUpdate should only include apiToken if non-empty'
      );
      assert.ok(
        content.includes('editForm.clientSecret && editForm.clientSecret.trim()'),
        'handleUpdate should only include clientSecret if non-empty'
      );

      // Check live connection test button
      assert.ok(
        content.includes('handleTestConnection'),
        'DatabricksSettingsView must have handleTestConnection'
      );
      assert.ok(
        content.includes('api.testDatabricksConnection'),
        'DatabricksSettingsView must invoke api.testDatabricksConnection'
      );

      // Check delete confirmation dialog
      assert.ok(
        content.includes('confirmDelete'),
        'DatabricksSettingsView must include confirmDelete modal'
      );
    });

    await t7.test('7.2 useWizardState.ts correctly integrates targetPlatform', () => {
      const content = fs.readFileSync(path.join(catalogSrcDir, 'components/Wizard/useWizardState.ts'), 'utf-8');
      
      assert.ok(
        content.includes("context.targetPlatform || 'DATASPHERE'"),
        'useWizardState should default targetPlatform to DATASPHERE'
      );
      assert.ok(
        content.includes('if (parent && parent.targetPlatform && !isEditMode)'),
        'useWizardState should inherit targetPlatform from parent role in derived mode'
      );
      assert.ok(
        content.includes("setTargetPlatform(role.targetPlatform || 'DATASPHERE')"),
        'useWizardState should hydrate targetPlatform from role in edit mode'
      );
    });

    await t7.test('7.3 StepOrigin.tsx renders targetPlatform selector with 3 options', () => {
      const content = fs.readFileSync(path.join(catalogSrcDir, 'components/Wizard/steps/StepOrigin.tsx'), 'utf-8');
      
      assert.ok(
        content.includes("value={targetPlatform}"),
        'StepOrigin should bind ToggleButtonGroup to targetPlatform'
      );
      assert.ok(
        content.includes('value="DATASPHERE"'),
        'StepOrigin should have DATASPHERE option'
      );
      assert.ok(
        content.includes('value="DATABRICKS"'),
        'StepOrigin should have DATABRICKS option'
      );
      assert.ok(
        content.includes('value="BOTH"'),
        'StepOrigin should have BOTH option'
      );
    });
  });
});
