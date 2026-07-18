'use strict';

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

// Apply driver dependency injection
const HanaClient = require('./../srv/lib/hanaClient');
HanaClient.setDriver(mockHana);

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

  await t.test('Assign Roles restriction enforcement (Derived roles only)', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations } = db.entities;

    const assignUser = 'assign-user';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: assignUser }));

    // User with permission to manage derived roles only, and can assign roles
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: assignUser,
      userName: 'Assign User with derived roles only',
      canAssignRoles: true,
      canManageDerivedRoles: true,
      canManageSingleRoles: false,
      isActive: true
    }));

    // Setup: create a parent single role and a derived role (with restrictions so they can be assigned)
    const singleRoleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_SINGLE_ASSIGN',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const singleRoleId = singleRoleRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: singleRoleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    const derivedRoleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_DERIVED_ASSIGN',
      type: 'DERIVED',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const derivedRoleId = derivedRoleRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: derivedRoleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE02'
    });

    let assignmentId;

    // 1. Allow assigning the derived role
    await t2.test('Allow derived role assignment', async () => {
      const res = await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: derivedRoleId,
        userId: 'target-user-1',
        userName: 'Target User 1'
      }, {
        headers: { 'x-simulated-user': assignUser }
      });
      assert.strictEqual(res.status, 201);
      assignmentId = res.data.ID;
    });

    // 2. Block assigning the single (parent) role
    await t2.test('Block parent (single) role assignment', async () => {
      try {
        await POST('/odata/v4/auth/RoleAssignments', {
          role_ID: singleRoleId,
          userId: 'target-user-2',
          userName: 'Target User 2'
        }, {
          headers: { 'x-simulated-user': assignUser }
        });
        assert.fail('Expected parent role assignment to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Clean up
    if (assignmentId) {
      await DELETE(`/odata/v4/auth/RoleAssignments('${assignmentId}')`);
    }
    await DELETE(`/odata/v4/auth/Roles('${derivedRoleId}')`);
    await DELETE(`/odata/v4/auth/Roles('${singleRoleId}')`);
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: assignUser }));
  });

  await t.test('Approver-based bypass of canAssignRoles permission', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations, Roles, RoleApprovers, RoleAssignments } = db.entities;

    const mockApprover = 'mock-approver-only';
    
    // Seed user without canAssignRoles global permission
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockApprover }));
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: mockApprover,
      userName: 'Mock Approver Only',
      canAssignRoles: false,
      isActive: true
    }));

    // Create a single role with restrictions (so it's valid for assignment)
    const roleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_APPROVER_BYPASS',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const roleId = roleRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: roleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // Make mockApprover an approver for this role
    await db.run(INSERT.into(RoleApprovers).entries({
      ID: cds.utils.uuid(),
      role_ID: roleId,
      userId: mockApprover
    }));

    // 1. Assert that mockApprover CAN assign this role because they are an approver
    let assignId;
    await t2.test('Allow assignment for role where user is approver', async () => {
      const res = await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: roleId,
        userId: 'target-user-approver-flow',
        userName: 'Target User'
      }, {
        headers: { 'x-simulated-user': mockApprover }
      });
      assert.strictEqual(res.status, 201);
      assignId = res.data.ID;
    });

    // 2. Create another role where mockApprover is NOT an approver
    const roleRes2 = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_APPROVER_BLOCKED',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const roleId2 = roleRes2.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: roleId2,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // Assert that mockApprover CANNOT assign this second role because they are not an approver and canAssignRoles is false
    await t2.test('Reject assignment for role where user is not approver', async () => {
      try {
        await POST('/odata/v4/auth/RoleAssignments', {
          role_ID: roleId2,
          userId: 'target-user-approver-flow',
          userName: 'Target User'
        }, {
          headers: { 'x-simulated-user': mockApprover }
        });
        assert.fail('Expected assignment to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Clean up
    if (assignId) {
      await db.run(cds.ql.DELETE(RoleAssignments).where({ ID: assignId }));
    }
    await db.run(cds.ql.DELETE(RoleApprovers).where({ role_ID: roleId }));
    await db.run(cds.ql.DELETE(Roles).where({ ID: roleId }));
    await db.run(cds.ql.DELETE(Roles).where({ ID: roleId2 }));
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockApprover }));
  });

  await t.test('Derived roles permission-based bypass of canAssignRoles', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations, Roles, RoleAssignments } = db.entities;

    const mockUser = 'mock-derived-assigner';

    // Seed user with canManageDerivedRoles: true but canAssignRoles: false
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockUser }));
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: mockUser,
      userName: 'Mock Derived Assigner',
      canAssignRoles: false,
      canManageDerivedRoles: true,
      managedDerivedRolesScope: 'ALL',
      isActive: true
    }));

    // Create a derived role
    const derivedRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_MOCK_DERIVED_ASSIGN',
      type: 'DERIVED',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const derivedId = derivedRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: derivedId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // Create a single role
    const singleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_MOCK_SINGLE_ASSIGN_BLOCK',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const singleId = singleRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: singleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // 1. Assert that mockUser CAN assign the derived role
    let assignId;
    await t2.test('Allow derived role assignment', async () => {
      const res = await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: derivedId,
        userId: 'target-user-derived-flow',
        userName: 'Target User'
      }, {
        headers: { 'x-simulated-user': mockUser }
      });
      assert.strictEqual(res.status, 201);
      assignId = res.data.ID;
    });

    // 2. Assert that mockUser CANNOT assign the single role
    await t2.test('Block single role assignment', async () => {
      try {
        await POST('/odata/v4/auth/RoleAssignments', {
          role_ID: singleId,
          userId: 'target-user-derived-flow',
          userName: 'Target User'
        }, {
          headers: { 'x-simulated-user': mockUser }
        });
        assert.fail('Expected assignment of parent/single role to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Clean up
    if (assignId) {
      await db.run(cds.ql.DELETE(RoleAssignments).where({ ID: assignId }));
    }
    await db.run(cds.ql.DELETE(Roles).where({ ID: derivedId }));
    await db.run(cds.ql.DELETE(Roles).where({ ID: singleId }));
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockUser }));
  });

  await t.test('Roles editing type-specific permissions enforcement', async (t2) => {
    const db = await cds.connect.to('db');
    const { AppAuthorizations, Roles } = db.entities;

    const mockRoleUser = 'role-edit-user';
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockRoleUser }));

    // User who has canManageDerivedRoles only (cannot manage single roles)
    await db.run(INSERT.into(AppAuthorizations).entries({
      ID: cds.utils.uuid(),
      userId: mockRoleUser,
      userName: 'Role Edit User',
      canManageDerivedRoles: true,
      canManageSingleRoles: false,
      managedDerivedRolesScope: 'ALL',
      isActive: true
    }));

    // Create a single role first using admin
    const singleRes = await POST('/odata/v4/auth/Roles', {
      name: 'TEST_SINGLE_EDIT',
      type: 'SINGLE',
      description: 'Single Role for edit test'
    });
    const singleId = singleRes.data.ID;

    // Create a derived role under singleRes using admin
    const derivedRes = await POST('/odata/v4/auth/Roles', {
      name: 'TEST_DERIVED_EDIT',
      type: 'DERIVED',
      description: 'Derived Role for edit test',
      parentRoles: [{ parent_ID: singleId }]
    });
    const derivedId = derivedRes.data.ID;

    // Assert that mockRoleUser CANNOT update the SINGLE role
    await t2.test('Block updating SINGLE role without single roles permission', async () => {
      try {
        await PATCH(`/odata/v4/auth/Roles('${singleId}')`, {
          description: 'Attempted description update'
        }, {
          headers: { 'x-simulated-user': mockRoleUser }
        });
        assert.fail('Expected SINGLE role update to fail with 403');
      } catch (err) {
        assert.strictEqual(err.status || err.response?.status, 403);
      }
    });

    // Assert that mockRoleUser CAN update the DERIVED role
    await t2.test('Allow updating DERIVED role with derived roles permission', async () => {
      const patchRes = await PATCH(`/odata/v4/auth/Roles('${derivedId}')`, {
        description: 'Allowed description update'
      }, {
        headers: { 'x-simulated-user': mockRoleUser }
      });
      assert.strictEqual(patchRes.status, 200);
    });

    // Clean up
    await db.run(cds.ql.DELETE(Roles).where({ ID: derivedId }));
    await db.run(cds.ql.DELETE(Roles).where({ ID: singleId }));
    await db.run(cds.ql.DELETE(AppAuthorizations).where({ userId: mockRoleUser }));
  });

  await t.test('RoleAssignments unique constraint enforcement', async (t2) => {
    const db = await cds.connect.to('db');
    const { Roles, RoleAssignments } = db.entities;

    // Create a role with a restriction first (so it is assignable)
    const roleRes = await POST('/odata/v4/auth/Roles', {
      name: 'ROLE_TEST_UNIQUE_CONSTRAINT_FLOW',
      type: 'SINGLE',
      environment_ID: 'D',
      accessDomain_ID: 'app-global'
    });
    const roleId = roleRes.data.ID;

    await POST('/odata/v4/auth/Restrictions', {
      role_ID: roleId,
      field: 'SalesOrg',
      filterType: 'SINGLE_VALUE',
      value: 'DE01'
    });

    // 1. Assign user first time (should succeed)
    let assignId1;
    const res1 = await POST('/odata/v4/auth/RoleAssignments', {
      role_ID: roleId,
      userId: 'unique-constraint-user',
      userName: 'Unique User'
    });
    assert.strictEqual(res1.status, 201);
    assignId1 = res1.data.ID;

    // 2. Assign same user second time (should fail due to unique constraint)
    try {
      await POST('/odata/v4/auth/RoleAssignments', {
        role_ID: roleId,
        userId: 'unique-constraint-user',
        userName: 'Unique User'
      });
      assert.fail('Expected duplicate assignment to fail');
    } catch (err) {
      assert.strictEqual(err.status, 400);
    }

    // Clean up
    if (assignId1) {
      await db.run(cds.ql.DELETE(RoleAssignments).where({ ID: assignId1 }));
    }
    await db.run(cds.ql.DELETE(Roles).where({ ID: roleId }));
  });

});

