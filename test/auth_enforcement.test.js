'use strict';

/**
 * auth_enforcement.test.js - Integration tests for the new authorization system
 */

const test = require('node:test');
const assert = require('node:assert');
const cds = require('@sap/cds');

const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

test('Backend Authorization Enforcement Suite', async (t) => {

  await t.test('Unauthenticated / Anonymous Access is Restricted', async () => {
    // 1. Reading AppAuthorizations directly should fail with 403 for anonymous/unauthorized
    try {
      await GET('/odata/v4/auth/AppAuthorizations', {
        headers: { 'x-simulated-user': 'anonymous' }
      });
      assert.fail('Expected AppAuthorizations read to fail with 403');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 403);
    }

    // 2. Modifying BdcSettings directly should fail with 403 for anonymous/unauthorized
    try {
      await PATCH('/odata/v4/auth/BdcSettings(\'default-bdc\')', {
        space: 'NEW_SPACE'
      }, {
        headers: { 'x-simulated-user': 'anonymous' }
      });
      assert.fail('Expected BdcSettings update to fail with 403');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 403);
    }

    // 3. Creating a Role directly should fail with 403 for anonymous/unauthorized
    try {
      await POST('/odata/v4/auth/Roles', {
        name: 'ANONYMOUS_TEST_ROLE',
        type: 'SINGLE',
        environment_ID: 'D'
      }, {
        headers: { 'x-simulated-user': 'anonymous' }
      });
      assert.fail('Expected Roles creation to fail with 403');
    } catch (err) {
      assert.strictEqual(err.status || err.response?.status, 403);
    }
  });

  await t.test('Authenticated / Admin Access is Permitted', async () => {
    // 1. getCurrentUserPermissions should succeed and return admin permissions
    const res = await GET('/odata/v4/auth/getCurrentUserPermissions()', {
      headers: { 'x-simulated-user': 'admin' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.isSuperAdmin, true);
    assert.strictEqual(res.data.canManageOrgRoles, true);

    // 2. Reading AppAuthorizations should succeed for admin
    const listRes = await GET('/odata/v4/auth/AppAuthorizations', {
      headers: { 'x-simulated-user': 'admin' }
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data.value));
  });

  await t.test('Environment restriction enforcement', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations } = db.entities;

    // Seed a user scoped only to environment 'D'
    const testUser = 'env-d-user';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: testUser }));
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: testUser,
      userName: 'Env D User',
      canManageSingleRoles: true,
      allowedEnvironments: JSON.stringify(['D']),
      isActive: true
    }));

    await t2.test('Allow operations in environment D', async () => {
      const res = await POST('/odata/v4/auth/Roles', {
        name: `ENV_D_PERMITTED_ROLE_${Date.now()}`,
        type: 'SINGLE',
        environment_ID: 'D'
      }, {
        headers: { 'x-simulated-user': testUser }
      });
      assert.strictEqual(res.status, 201);
      if (res.data?.ID) {
        await db.run(cds.ql.DELETE('fanrio.auth.Roles').where({ ID: res.data.ID }));
      }
    });

    await t2.test('Block operations in environment P', async () => {
      try {
        await POST('/odata/v4/auth/Roles', {
          name: `ENV_P_BLOCKED_ROLE_${Date.now()}`,
          type: 'SINGLE',
          environment_ID: 'P'
        }, {
          headers: { 'x-simulated-user': testUser }
        });
        assert.fail('Expected role creation in environment P to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Clean up
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: testUser }));
  });

  await t.test('Replications authorization enforcement', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations } = db.entities;

    const replUser = 'repl-user';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: replUser }));

    // User without canManageReplications
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: replUser,
      userName: 'Repl User without permission',
      canManageReplications: false,
      isActive: true
    }));

    await t2.test('Block triggerReplication for user without permission', async () => {
      try {
        await POST('/odata/v4/auth/triggerReplication', {}, {
          headers: { 'x-simulated-user': replUser }
        });
        assert.fail('Expected triggerReplication to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Grant canManageReplications
    await db.run(UPDATE(AppAuthorizations).set({ canManageReplications: true }).where({ userId: replUser }));

    await t2.test('Allow triggerReplication for user with permission', async () => {
      // Clear pending replications to avoid connecting to unconfigured BDC settings
      await db.run(cds.ql.DELETE('fanrio.auth.Replications'));

      const res = await POST('/odata/v4/auth/triggerReplication', {}, {
        headers: { 'x-simulated-user': replUser }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    });

    // Clean up
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: replUser }));
  });
});
