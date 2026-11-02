# Milestone 1 — Explorer 3 Report: OData Action `testDatabricksConnection` & Service Wiring

## Executive Summary
This report provides the complete architectural design, exact code specifications, and comprehensive test suite designs for the new OData action `testDatabricksConnection` in `fanrio-auth` (Milestone 1).

The action enables administrators to validate Databricks workspace connectivity, authentication credentials (Personal Access Token or Service Principal), and SQL warehouse reachability directly from the application. It enforces strict RBAC via `canManageSettings`, executes input validation before network dispatch, leverages the pluggable `DatabricksClient` adapter, and guarantees rock-solid error handling returning structured `{ success, message, httpStatus }` payloads without crashing or throwing unhandled errors in the SAP CAP runtime.

---

## 1. Action Contract Specification (`srv/cortex_service.cds`)

### 1.1 Signature and Return Type
In `srv/cortex_service.cds`, inside the `AuthorizationService` definition under a new section `Databricks Connection Actions`:

```cds
  // -------------------------------------------------------------------------
  // Databricks Connection Actions
  // -------------------------------------------------------------------------

  action testDatabricksConnection(settingId: UUID) returns {
    success    : Boolean;
    message    : String;
    httpStatus : Integer;
  };
```

### 1.2 Entity Projection Dependency
In `srv/cortex_service.cds`, the `DatabricksSettings` entity must be projected (aligned with Explorer M1-1):

```cds
  entity DatabricksSettings     as projection on db.DatabricksSettings;
```

---

## 2. Permission & Security Architecture

### 2.1 Role-Based Access Control Rule
- Testing connection settings exposes connectivity diagnostics and configuration verification.
- Enforced permission flag: `canManageSettings`.
- SuperAdmin (`isSuperAdmin: true`) bypasses permission checks automatically per `authGuard.js`.
- Anonymous users and users without `canManageSettings` are rejected with HTTP 403.

### 2.2 Integration with `srv/handlers/systemHandlers.js`
In `srv/handlers/systemHandlers.js`, register `testDatabricksConnection` in the `service.before` hook guarding administrative actions:

```javascript
  // Action protections (Settings & Administration)
  service.before([
    'testBdcConnection',
    'testDatabricksConnection', // <-- Register testDatabricksConnection
    'fetchBdcSpaces', 'fetchBdcAssets',
    'fetchBdcAssetColumns', 'fetchBdcAssetKeyColumns', 'fetchRawBdcSpaces',
    'fetchRawBdcAssets', 'fetchRawBdcRelationalValues', 'fetchRawBdcAssetColumns',
    'fetchRawBdcUsers', 'fetchBdcAssociations', 'runBdcTaskChain', 'fetchBdcTaskChainLog',
    'fetchRawHanaViews'
  ], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });
```

In addition, protect `DatabricksSettings` CRUD and direct READ operations in `srv/handlers/systemHandlers.js`:

```javascript
  // Settings & Master Data CRUD protection
  service.before(
    ['CREATE', 'UPDATE', 'DELETE'],
    [
      'BdcSettings',
      'DatabricksSettings', // <-- Protect DatabricksSettings CRUD
      'RestrictionFields',
      'DynamicGenerationRules',
      'DynamicRuleFieldMappings',
      'GeneratedResourceMap',
      'Customers',
      'Environments'
    ],
    async (req) => {
      const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
      requirePermission(perms, 'canManageSettings', req);
    }
  );

  // Direct READ on settings requires settings management permission
  service.before('READ', ['BdcSettings', 'DatabricksSettings'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });

  // Strip sensitive credentials on READ (protect apiToken and clientSecret)
  service.after('READ', 'DatabricksSettings', (data) => {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const row of rows) {
      if (row) {
        delete row.apiToken;
        delete row.clientSecret;
      }
    }
  });
```

---

## 3. Service Implementation Design (`srv/cortex_service.js`)

### 3.1 Wiring & Handler Implementation
In `srv/cortex_service.js`:

#### A. Import `DatabricksClient`
Near line 20:
```javascript
const DatabricksClient = require('./lib/databricksClient');
```

#### B. Destructure `DatabricksSettings` Entity
In the service initialization block:
```javascript
  const {
    OrgNodes, OrgNodeAttributes, Roles, Restrictions,
    RoleAssignments, RoleInheritance, RestrictionFields,
    BdcSettings, DatabricksSettings, AuditLogs, Replications, DynamicGenerationRules,
    AppAuthorizations, RoleApprovers, AccessDomains, AccessDomainFields,
  } = entities;
```

#### C. Action Handler Implementation
Add the action handler:

```javascript
  // ---------------------------------------------------------------------------
  // Databricks connection actions
  // ---------------------------------------------------------------------------

  this.on('testDatabricksConnection', async (req) => {
    const { settingId } = req.data;
    if (!settingId) {
      return req.error(400, 'Parameter settingId is required');
    }

    const { DatabricksSettings } = entities;
    const setting = await cds.db.run(SELECT.one.from(DatabricksSettings).where({ ID: settingId }));
    if (!setting) {
      return req.error(404, `Databricks Setting with ID '${settingId}' not found`);
    }

    // Validation 1: Workspace URL
    if (!setting.workspaceUrl || typeof setting.workspaceUrl !== 'string' || !setting.workspaceUrl.trim().startsWith('http')) {
      return {
        success: false,
        message: `Failed: Invalid or missing workspace URL '${setting.workspaceUrl || ''}'. URL must begin with http:// or https://`,
        httpStatus: 400
      };
    }

    // Validation 2: Authentication credentials based on authType
    const authType = (setting.authType || 'TOKEN').toUpperCase();
    if (authType === 'TOKEN') {
      if (!setting.apiToken || !setting.apiToken.trim()) {
        return {
          success: false,
          message: 'Failed: Missing API Bearer Token for TOKEN authentication',
          httpStatus: 400
        };
      }
    } else if (authType === 'SERVICE_PRINCIPAL') {
      if (!setting.clientId || !setting.clientId.trim() || !setting.clientSecret || !setting.clientSecret.trim()) {
        return {
          success: false,
          message: 'Failed: Missing Client ID or Client Secret for SERVICE_PRINCIPAL authentication',
          httpStatus: 400
        };
      }
    } else {
      return {
        success: false,
        message: `Failed: Unsupported authentication type '${setting.authType}'`,
        httpStatus: 400
      };
    }

    // Execution: call DatabricksClient.testConnection
    try {
      const result = await DatabricksClient.testConnection(setting);
      return {
        success: Boolean(result?.success),
        message: result?.message || (result?.success ? 'Connection test succeeded' : 'Connection test failed'),
        httpStatus: Number(result?.httpStatus || (result?.success ? 200 : 502))
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to connect to Databricks Workspace [${setting.systemName || ''}]: ${err.message}`,
        httpStatus: Number(err.httpStatus || err.status || 502)
      };
    }
  });
```

---

## 4. Error Handling Matrix

The action must never trigger unhandled rejections or uncaught exceptions that could destabilize the CAP server.

| Scenario | Handled By | HTTP Response Code | Action Payload |
|---|---|---|---|
| User has no `canManageSettings` | `systemHandlers.js` (`requirePermission`) | `403 Forbidden` | Standard OData 403 error response |
| `settingId` is null/empty | Action parameter check | `400 Bad Request` | Standard OData 400 error response (`req.error(400)`) |
| `settingId` not found in DB | Action DB check | `404 Not Found` | Standard OData 404 error response (`req.error(404)`) |
| `workspaceUrl` missing or invalid format | Action validation | `200 OK` | `{ success: false, message: 'Failed: Invalid or missing workspace URL...', httpStatus: 400 }` |
| `authType: TOKEN` with missing `apiToken` | Action validation | `200 OK` | `{ success: false, message: 'Failed: Missing API Bearer Token...', httpStatus: 400 }` |
| `authType: SERVICE_PRINCIPAL` missing ID/secret | Action validation | `200 OK` | `{ success: false, message: 'Failed: Missing Client ID or Client Secret...', httpStatus: 400 }` |
| Unsupported `authType` | Action validation | `200 OK` | `{ success: false, message: "Failed: Unsupported authentication type '...'", httpStatus: 400 }` |
| Databricks API returned 401 Unauthorized | `DatabricksClient.testConnection` | `200 OK` | `{ success: false, message: 'Authentication failed: Invalid credentials', httpStatus: 401 }` |
| Databricks API returned 403 Forbidden | `DatabricksClient.testConnection` | `200 OK` | `{ success: false, message: 'Permission denied: Insufficient privileges', httpStatus: 403 }` |
| Databricks API returned 404 Not Found | `DatabricksClient.testConnection` | `200 OK` | `{ success: false, message: 'Endpoint or warehouse not found', httpStatus: 404 }` |
| Network timeout / DNS failure / ECONNREFUSED | Caught in `try / catch` | `200 OK` | `{ success: false, message: 'Failed to connect...: connect ECONNREFUSED...', httpStatus: 502 }` |
| Successful connection | `DatabricksClient.testConnection` | `200 OK` | `{ success: true, message: 'Successfully connected...', httpStatus: 200 }` |

---

## 5. Comprehensive Test Plan & Code Designs

### 5.1 Integration Tests for `test/backend_tests.test.js`

Add the following subtest block to `test/backend_tests.test.js` (e.g. after the `testBdcConnection` block around line 640):

```javascript
  // -------------------------------------------------------------------------
  // Databricks Connection Action Tests
  // -------------------------------------------------------------------------
  await t.test('testDatabricksConnection action & validation branches', async () => {
    const DatabricksClient = require('../srv/lib/databricksClient');
    const mockAdapter = DatabricksClient.getAdapter ? DatabricksClient.getAdapter() : null;

    // 1. Valid Databricks connection - TOKEN auth (Happy Path)
    const tokenSetting = await POST('/odata/v4/auth/DatabricksSettings', {
      systemName: 'TEST_DBX_TOKEN_CONN',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'TOKEN',
      apiToken: 'dapi_mock_token_12345',
      targetCatalog: 'main',
      targetSchema: 'default',
      sqlWarehouseId: 'warehouse-abc-123'
    });
    assert.strictEqual(tokenSetting.status, 201);

    const testTokenRes = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: tokenSetting.data.ID
    });
    assert.strictEqual(testTokenRes.status, 200);
    assert.strictEqual(testTokenRes.data.success, true);
    assert.strictEqual(testTokenRes.data.httpStatus, 200);
    assert.ok(testTokenRes.data.message.includes('TEST_DBX_TOKEN_CONN') || testTokenRes.data.message.includes('connected'));

    // 2. Valid Databricks connection - SERVICE_PRINCIPAL auth (Happy Path)
    const spSetting = await POST('/odata/v4/auth/DatabricksSettings', {
      systemName: 'TEST_DBX_SP_CONN',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'SERVICE_PRINCIPAL',
      clientId: 'sp-client-id-001',
      clientSecret: 'sp-client-secret-xyz'
    });
    assert.strictEqual(spSetting.status, 201);

    const testSpRes = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: spSetting.data.ID
    });
    assert.strictEqual(testSpRes.status, 200);
    assert.strictEqual(testSpRes.data.success, true);
    assert.strictEqual(testSpRes.data.httpStatus, 200);

    // 3. Validation failure: Missing or invalid workspace URL
    const badUrlSetting = await POST('/odata/v4/auth/DatabricksSettings', {
      systemName: 'TEST_DBX_BAD_URL',
      workspaceUrl: 'ftp://invalid-url.com',
      authType: 'TOKEN',
      apiToken: 'dapi123'
    });
    const testBadUrlRes = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: badUrlSetting.data.ID
    });
    assert.strictEqual(testBadUrlRes.status, 200);
    assert.strictEqual(testBadUrlRes.data.success, false);
    assert.strictEqual(testBadUrlRes.data.httpStatus, 400);
    assert.ok(testBadUrlRes.data.message.includes('workspace URL'));

    // 4. Validation failure: Missing apiToken for TOKEN auth
    const missingTokenSetting = await POST('/odata/v4/auth/DatabricksSettings', {
      systemName: 'TEST_DBX_MISSING_TOKEN',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'TOKEN'
    });
    const testMissingTokenRes = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: missingTokenSetting.data.ID
    });
    assert.strictEqual(testMissingTokenRes.status, 200);
    assert.strictEqual(testMissingTokenRes.data.success, false);
    assert.strictEqual(testMissingTokenRes.data.httpStatus, 400);
    assert.ok(testMissingTokenRes.data.message.includes('Missing API Bearer Token'));

    // 5. Validation failure: Missing clientId or clientSecret for SERVICE_PRINCIPAL auth
    const missingSpSetting = await POST('/odata/v4/auth/DatabricksSettings', {
      systemName: 'TEST_DBX_MISSING_SP',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'SERVICE_PRINCIPAL',
      clientId: 'only-client-id'
    });
    const testMissingSpRes = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: missingSpSetting.data.ID
    });
    assert.strictEqual(testMissingSpRes.status, 200);
    assert.strictEqual(testMissingSpRes.data.success, false);
    assert.strictEqual(testMissingSpRes.data.httpStatus, 400);
    assert.ok(testMissingSpRes.data.message.includes('Missing Client ID or Client Secret'));

    // 6. Non-existent settingId returns 404
    await assertODataError(
      POST('/odata/v4/auth/testDatabricksConnection', {
        settingId: '00000000-0000-0000-0000-000000000000'
      }),
      404
    );

    // 7. Missing settingId parameter returns 400
    await assertODataError(
      POST('/odata/v4/auth/testDatabricksConnection', {}),
      400
    );

    // 8. Simulated remote failure mode: 401 Unauthorized
    if (mockAdapter && typeof mockAdapter.setFailureMode === 'function') {
      mockAdapter.setFailureMode('AUTH_FAILED');
      const testAuthFailRes = await POST('/odata/v4/auth/testDatabricksConnection', {
        settingId: tokenSetting.data.ID
      });
      assert.strictEqual(testAuthFailRes.status, 200);
      assert.strictEqual(testAuthFailRes.data.success, false);
      assert.strictEqual(testAuthFailRes.data.httpStatus, 401);

      // 9. Simulated remote failure mode: Network Error / Timeout (502)
      mockAdapter.setFailureMode('NETWORK_ERROR');
      const testNetFailRes = await POST('/odata/v4/auth/testDatabricksConnection', {
        settingId: tokenSetting.data.ID
      });
      assert.strictEqual(testNetFailRes.status, 200);
      assert.strictEqual(testNetFailRes.data.success, false);
      assert.strictEqual(testNetFailRes.data.httpStatus, 502);

      // Reset mock failure mode
      mockAdapter.setFailureMode(null);
    }

    // Clean up created test settings
    await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${tokenSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${spSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${badUrlSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${missingTokenSetting.data.ID})`);
    await DELETE(`/odata/v4/auth/DatabricksSettings(ID=${missingSpSetting.data.ID})`);
  });
```

### 5.2 Permission Enforcement Tests for `test/auth_enforcement.test.js`

Add the following subtest to `test/auth_enforcement.test.js`:

```javascript
  await t.test('testDatabricksConnection requires canManageSettings permission', async () => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations, DatabricksSettings } = db.entities;

    // Create a dummy DatabricksSetting record
    const dummySettingId = cds.utils.uuid();
    await db.run(INSERT.into(DatabricksSettings).entries({
      ID: dummySettingId,
      systemName: 'AUTH_TEST_DBX',
      workspaceUrl: 'https://mock-workspace.cloud.databricks.com',
      authType: 'TOKEN',
      apiToken: 'test-token',
      isActive: true
    }));

    // 1. Anonymous access is blocked with 403
    try {
      await POST('/odata/v4/auth/testDatabricksConnection', {
        settingId: dummySettingId
      }, {
        headers: { 'x-simulated-user': 'anonymous' }
      });
      assert.fail('Expected testDatabricksConnection to fail with 403 for anonymous');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 403);
    }

    // 2. User without canManageSettings is blocked with 403
    const restrictedUser = 'dbx-no-settings-user';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: restrictedUser }));
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: restrictedUser,
      userName: 'Restricted User',
      isSuperAdmin: false,
      canManageSettings: false,
      canManageSingleRoles: true,
      allowedEnvironments: 'ALL',
      isActive: true
    }));

    try {
      await POST('/odata/v4/auth/testDatabricksConnection', {
        settingId: dummySettingId
      }, {
        headers: { 'x-simulated-user': restrictedUser }
      });
      assert.fail('Expected testDatabricksConnection to fail with 403 for user lacking canManageSettings');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 403);
    }

    // 3. User with canManageSettings succeeds
    const adminUser = 'dbx-settings-admin';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: adminUser }));
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: adminUser,
      userName: 'Settings Admin User',
      isSuperAdmin: false,
      canManageSettings: true,
      allowedEnvironments: 'ALL',
      isActive: true
    }));

    const res = await POST('/odata/v4/auth/testDatabricksConnection', {
      settingId: dummySettingId
    }, {
      headers: { 'x-simulated-user': adminUser }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    // Clean up
    await db.run(cds.ql.DELETE(DatabricksSettings).where({ ID: dummySettingId }));
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: restrictedUser }));
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: adminUser }));
  });
```

---

## 6. Execution Instructions for Worker

1. Ensure Explorer M1-1's CDS schema changes (`db/schema.cds`) and `npx cds deploy` have run.
2. Ensure Explorer M1-2's `srv/lib/databricksClient.js` and `srv/lib/databricksMockAdapter.js` are in place.
3. Edit `srv/cortex_service.cds`:
   - Add action `testDatabricksConnection(settingId: UUID) returns { success: Boolean; message: String; httpStatus: Integer; };`.
   - Ensure projection `entity DatabricksSettings as projection on db.DatabricksSettings;` is present.
4. Edit `srv/handlers/systemHandlers.js`:
   - Add `'testDatabricksConnection'` to `service.before([...], ...)` for action permissions.
   - Add `'DatabricksSettings'` to `service.before(['CREATE', 'UPDATE', 'DELETE'], ...)` and `service.before('READ', ...)`.
   - Add credential stripping for `DatabricksSettings` in `service.after('READ', ...)`.
5. Edit `srv/cortex_service.js`:
   - Require `DatabricksClient`.
   - Destructure `DatabricksSettings` from `entities`.
   - Implement `this.on('testDatabricksConnection', async (req) => { ... })`.
6. Add the test suites in `test/backend_tests.test.js` and `test/auth_enforcement.test.js`.
7. Run `npm test` with `BypassSandbox: true` to verify 100% test pass.
