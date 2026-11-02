'use strict';

const test = require('node:test');
const assert = require('node:assert');

const dispatcher = require('../srv/services/directSyncDispatcher');
const {
  withDomainLock,
  resolveEffectivePlatforms,
  resolveEffectivePlatform,
  dispatchAssignmentSync,
  dispatchAssignmentRemoval,
  dispatchRoleSync,
  dispatchAccessDomainSync,
  dispatchSync
} = dispatcher;

test('Direct Multi-Target Sync Dispatcher Suite', async (t) => {

  // =========================================================================
  // 1. Platform Resolution & Hierarchy Intersect
  // =========================================================================
  await t.test('1. Platform Resolution & Hierarchy Intersect', async (t1) => {

    await t1.test('1.1 Role DATASPHERE + Domain BOTH -> DATASPHERE only', () => {
      const res = resolveEffectivePlatforms('DATASPHERE', 'BOTH');
      assert.strictEqual(res.targetsDatasphere, true);
      assert.strictEqual(res.targetsDatabricks, false);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATASPHERE']);
      assert.strictEqual(res.effectivePlatform, 'DATASPHERE');
      assert.strictEqual(res.conflict, false);
    });

    await t1.test('1.2 Role DATABRICKS + Domain BOTH -> DATABRICKS only', () => {
      const res = resolveEffectivePlatforms('DATABRICKS', 'BOTH');
      assert.strictEqual(res.targetsDatasphere, false);
      assert.strictEqual(res.targetsDatabricks, true);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATABRICKS']);
      assert.strictEqual(res.effectivePlatform, 'DATABRICKS');
      assert.strictEqual(res.conflict, false);
    });

    await t1.test('1.3 Role BOTH + Domain BOTH -> BOTH', () => {
      const res = resolveEffectivePlatforms('BOTH', 'BOTH');
      assert.strictEqual(res.targetsDatasphere, true);
      assert.strictEqual(res.targetsDatabricks, true);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATASPHERE', 'DATABRICKS']);
      assert.strictEqual(res.effectivePlatform, 'BOTH');
      assert.strictEqual(res.conflict, false);
    });

    await t1.test('1.4 Role BOTH + Domain DATASPHERE -> DATASPHERE only', () => {
      const res = resolveEffectivePlatforms('BOTH', 'DATASPHERE');
      assert.strictEqual(res.targetsDatasphere, true);
      assert.strictEqual(res.targetsDatabricks, false);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATASPHERE']);
    });

    await t1.test('1.5 Role BOTH + Domain DATABRICKS -> DATABRICKS only', () => {
      const res = resolveEffectivePlatforms('BOTH', 'DATABRICKS');
      assert.strictEqual(res.targetsDatasphere, false);
      assert.strictEqual(res.targetsDatabricks, true);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATABRICKS']);
    });

    await t1.test('1.6 Conflict: Role DATASPHERE + Domain DATABRICKS -> conflict: true', () => {
      const res = resolveEffectivePlatforms('DATASPHERE', 'DATABRICKS');
      assert.strictEqual(res.targetsDatasphere, false);
      assert.strictEqual(res.targetsDatabricks, false);
      assert.deepStrictEqual(res.effectivePlatforms, []);
      assert.strictEqual(res.conflict, true);
    });

    await t1.test('1.7 Default fallbacks (null role -> DATASPHERE, null domain -> BOTH)', () => {
      const res = resolveEffectivePlatforms(null, null);
      assert.strictEqual(res.targetsDatasphere, true);
      assert.strictEqual(res.targetsDatabricks, false);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATASPHERE']);
    });

    await t1.test('1.8 Entity Object inputs and resolveEffectivePlatform alias', () => {
      const roleObj = { targetPlatform: 'BOTH' };
      const domainObj = { targetPlatform: 'DATABRICKS' };
      const res = resolveEffectivePlatform(roleObj, domainObj);
      assert.strictEqual(res.targetsDatasphere, false);
      assert.strictEqual(res.targetsDatabricks, true);
      assert.deepStrictEqual(res.effectivePlatforms, ['DATABRICKS']);
    });

  });

  // =========================================================================
  // 2. Concurrency Control & Mutex Serialization
  // =========================================================================
  await t.test('2. Concurrency Control & Mutex Serialization', async (t2) => {

    await t2.test('2.1 Operations on the SAME domain execute sequentially in order', async () => {
      const log = [];
      const domain = 'domain_finance';

      const task1 = withDomainLock(domain, async () => {
        log.push('task1-start');
        await new Promise(r => setTimeout(r, 40));
        log.push('task1-end');
        return 'res1';
      });

      const task2 = withDomainLock(domain, async () => {
        log.push('task2-start');
        await new Promise(r => setTimeout(r, 10));
        log.push('task2-end');
        return 'res2';
      });

      const [r1, r2] = await Promise.all([task1, task2]);
      assert.strictEqual(r1, 'res1');
      assert.strictEqual(r2, 'res2');
      assert.deepStrictEqual(log, ['task1-start', 'task1-end', 'task2-start', 'task2-end']);
    });

    await t2.test('2.2 Operations on DIFFERENT domains run concurrently', async () => {
      const log = [];

      const task1 = withDomainLock('domain_A', async () => {
        log.push('A-start');
        await new Promise(r => setTimeout(r, 30));
        log.push('A-end');
      });

      const task2 = withDomainLock('domain_B', async () => {
        log.push('B-start');
        await new Promise(r => setTimeout(r, 10));
        log.push('B-end');
      });

      await Promise.all([task1, task2]);
      // Domain B should finish before Domain A finishes
      assert.strictEqual(log[0], 'A-start');
      assert.strictEqual(log[1], 'B-start');
      assert.strictEqual(log[2], 'B-end');
      assert.strictEqual(log[3], 'A-end');
    });

    await t2.test('2.3 Errors inside locked tasks release the lock properly', async () => {
      const domain = 'domain_error_recovery';

      try {
        await withDomainLock(domain, async () => {
          throw new Error('Task Failed Intentional');
        });
      } catch (err) {
        assert.strictEqual(err.message, 'Task Failed Intentional');
      }

      // Next task must be able to acquire lock without hanging
      let subsequentExecuted = false;
      await withDomainLock(domain, async () => {
        subsequentExecuted = true;
      });
      assert.strictEqual(subsequentExecuted, true);
    });

  });

  // =========================================================================
  // 3. Multi-Target Routing: Assignment Sync
  // =========================================================================
  await t.test('3. Multi-Target Routing: Assignment Sync', async (t3) => {

    await t3.test('3.1 Route to DATASPHERE only invokes HANA sync and skips Databricks', async () => {
      let hanaCalled = false;
      let dbCalled = false;

      const mockDb = {
        run: async () => ({ ID: 'role_ds', targetPlatform: 'DATASPHERE' })
      };
      const mockHana = {
        syncAssignmentToHana: async () => { hanaCalled = true; }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => { dbCalled = true; }
      };

      const result = await dispatchAssignmentSync({
        assignmentId: 'assign_1',
        userId: 'alice',
        roleId: 'role_ds'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.effectivePlatforms.includes('DATASPHERE'), true);
      assert.strictEqual(result.effectivePlatforms.includes('DATABRICKS'), false);
      assert.strictEqual(hanaCalled, true);
      assert.strictEqual(dbCalled, false);
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(result.databricks, undefined);
    });

    await t3.test('3.2 Route to DATABRICKS only invokes Databricks sync and skips HANA', async () => {
      let hanaCalled = false;
      let dbCalled = false;

      const mockDb = {
        run: async () => ({ ID: 'role_db', targetPlatform: 'DATABRICKS' })
      };
      const mockHana = {
        syncAssignmentToHana: async () => { hanaCalled = true; }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => {
          dbCalled = true;
          return { success: true };
        }
      };

      const result = await dispatchAssignmentSync({
        assignmentId: 'assign_2',
        userId: 'bob',
        roleId: 'role_db'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.effectivePlatforms.includes('DATABRICKS'), true);
      assert.strictEqual(result.effectivePlatforms.includes('DATASPHERE'), false);
      assert.strictEqual(hanaCalled, false);
      assert.strictEqual(dbCalled, true);
      assert.strictEqual(result.datasphere, undefined);
      assert.strictEqual(result.databricks?.success, true);
    });

    await t3.test('3.3 Route to BOTH dispatches to HANA and Databricks in parallel', async () => {
      let hanaCalled = false;
      let dbCalled = false;

      const mockDb = {
        run: async () => ({ ID: 'role_both', targetPlatform: 'BOTH' })
      };
      const mockHana = {
        syncAssignmentToHana: async () => { hanaCalled = true; }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => {
          dbCalled = true;
          return { success: true };
        }
      };

      const result = await dispatchAssignmentSync({
        assignmentId: 'assign_3',
        userId: 'charlie',
        roleId: 'role_both'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(hanaCalled, true);
      assert.strictEqual(dbCalled, true);
      assert.deepStrictEqual(result.effectivePlatforms, ['DATASPHERE', 'DATABRICKS']);
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(result.databricks?.success, true);
    });

  });

  // =========================================================================
  // 4. Multi-Target Routing: Assignment Removal & Cleanup
  // =========================================================================
  await t.test('4. Multi-Target Routing: Assignment Removal', async (t4) => {

    await t4.test('4.1 Dispatches removal with isDelete=true to target platforms', async () => {
      let hanaDelCalled = false;
      let dbDelCalled = false;

      const mockDb = {
        run: async () => ({ ID: 'role_both', targetPlatform: 'BOTH' })
      };
      const mockHana = {
        syncAssignmentToHana: async (cds, hana, ent, assignId, user, role, isDel) => {
          if (isDel) hanaDelCalled = true;
        }
      };
      const mockDatabricks = {
        removeAssignmentFromDatabricks: async () => {
          dbDelCalled = true;
          return { success: true };
        }
      };

      const result = await dispatchAssignmentRemoval({
        assignmentId: 'assign_del',
        userId: 'david',
        roleId: 'role_both'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, 'ASSIGN_DELETE');
      assert.strictEqual(hanaDelCalled, true);
      assert.strictEqual(dbDelCalled, true);
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(result.databricks?.success, true);
    });

    await t4.test('4.2 Missing role defaults to BOTH cleanup to prevent orphaned entries', async () => {
      let hanaDelCalled = false;
      let dbDelCalled = false;

      const mockDb = {
        run: async () => null // Role already deleted
      };
      const mockHana = {
        syncAssignmentToHana: async () => { hanaDelCalled = true; }
      };
      const mockDatabricks = {
        removeAssignmentFromDatabricks: async () => {
          dbDelCalled = true;
          return { success: true };
        }
      };

      const result = await dispatchAssignmentRemoval({
        assignmentId: 'assign_orphan',
        userId: 'orphan_user',
        roleId: 'role_deleted'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.targetPlatform, 'BOTH');
      assert.deepStrictEqual(result.effectivePlatforms, ['DATASPHERE', 'DATABRICKS']);
      assert.strictEqual(hanaDelCalled, true);
      assert.strictEqual(dbDelCalled, true);
    });

  });

  // =========================================================================
  // 5. Role Re-Sync & Cascades
  // =========================================================================
  await t.test('5. Role Re-Sync & Cascades', async (t5) => {

    await t5.test('5.1 dispatchRoleSync triggers multi-target sync for role', async () => {
      let hanaSyncRole = false;
      let dbSyncRole = false;

      const mockDb = {
        run: async () => ({ ID: 'role_update', targetPlatform: 'BOTH' })
      };
      const mockHana = {
        syncRoleAssignmentsToHana: async () => { hanaSyncRole = true; }
      };
      const mockDatabricks = {
        syncRoleToDatabricks: async () => {
          dbSyncRole = true;
          return { success: true };
        }
      };

      const result = await dispatchRoleSync('role_update', {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, 'ROLE_UPDATE');
      assert.strictEqual(hanaSyncRole, true);
      assert.strictEqual(dbSyncRole, true);
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(result.databricks?.success, true);
    });

  });

  // =========================================================================
  // 6. Access Domain Sync
  // =========================================================================
  await t.test('6. Access Domain Sync', async (t6) => {

    await t6.test('6.1 Domain sync provisions Databricks table when platform contains DATABRICKS', async () => {
      const mockDb = {
        run: async () => ({ ID: 'dom_1', name: 'sales', targetPlatform: 'DATABRICKS' })
      };
      const mockDatabricks = {
        syncAccessDomainToDatabricks: async () => ({
          success: true,
          targetTable: 'sales_flat_authorizations'
        })
      };

      const result = await dispatchAccessDomainSync('dom_1', {
        db: mockDb,
        entities: { AccessDomains: 'AccessDomains' },
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.targetTable, 'sales_flat_authorizations');
    });

    await t6.test('6.2 Domain sync skips Databricks when domain is DATASPHERE only', async () => {
      let dbCalled = false;
      const mockDb = {
        run: async () => ({ ID: 'dom_2', name: 'finance', targetPlatform: 'DATASPHERE' })
      };
      const mockDatabricks = {
        syncAccessDomainToDatabricks: async () => { dbCalled = true; }
      };

      const result = await dispatchAccessDomainSync('dom_2', {
        db: mockDb,
        entities: { AccessDomains: 'AccessDomains' },
        databricksSync: mockDatabricks
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.platform, 'DATASPHERE');
      assert.strictEqual(dbCalled, false);
    });

  });

  // =========================================================================
  // 7. Universal dispatchSync Contract (E2E Test T1.7 Compatibility)
  // =========================================================================
  await t.test('7. Universal dispatchSync Contract', async (t7) => {

    const mockRestrictions = [
      { field: 'Country', filterType: 'SINGLE_VALUE', value: 'DE' }
    ];

    await t7.test('7.1 Standalone restriction sync to DATASPHERE only', async () => {
      const executed = [];
      const mockHanaClient = {
        syncAssignment: async (setting, roleId, isDel, restrs) => {
          executed.push({ platform: 'HANA', roleId, isDel, restrs });
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'DATASPHERE',
        roleId: 'role_contract_ds',
        userId: 'user1',
        restrictions: mockRestrictions
      }, {
        HanaClient: mockHanaClient
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(executed.length, 1);
      assert.strictEqual(executed[0].platform, 'HANA');
      assert.strictEqual(executed[0].roleId, 'role_contract_ds');
    });

    await t7.test('7.2 Standalone restriction sync to DATABRICKS only', async () => {
      const executed = [];
      const mockDatabricksClient = {
        executeStatement: async ({ statement }) => {
          executed.push({ platform: 'DATABRICKS', statement });
          return { status: 'SUCCEEDED' };
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'DATABRICKS',
        roleId: 'role_contract_db',
        userId: 'user2',
        restrictions: mockRestrictions
      }, {
        DatabricksClient: mockDatabricksClient
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(executed.length, 2); // createFuncSql and setFilterSql
      assert.ok(executed[0].statement.includes('CREATE OR REPLACE FUNCTION'));
      assert.ok(executed[1].statement.includes('SET ROW FILTER'));
    });

    await t7.test('7.3 Standalone restriction sync to BOTH', async () => {
      const executed = [];
      const mockHanaClient = {
        syncAssignment: async (setting, roleId, isDel, restrs) => {
          executed.push({ platform: 'HANA', roleId });
        }
      };
      const mockDatabricksClient = {
        executeStatement: async ({ statement }) => {
          executed.push({ platform: 'DATABRICKS', statement });
          return { status: 'SUCCEEDED' };
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'BOTH',
        roleId: 'role_contract_both',
        userId: 'user3',
        restrictions: mockRestrictions
      }, {
        HanaClient: mockHanaClient,
        DatabricksClient: mockDatabricksClient
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(executed.filter(e => e.platform === 'HANA').length, 1);
      assert.strictEqual(executed.filter(e => e.platform === 'DATABRICKS').length, 2);
    });

  });

  // =========================================================================
  // 8. Fault Tolerance & Error Isolation
  // =========================================================================
  await t.test('8. Fault Tolerance & Error Isolation', async (t8) => {

    await t8.test('8.1 Databricks failure does NOT prevent Datasphere success', async () => {
      const executed = [];
      const mockHanaClient = {
        syncAssignment: async () => { executed.push('HANA_SUCCESS'); }
      };
      const mockDatabricksClient = {
        executeStatement: async () => { throw new Error('Databricks SQL Warehouse 503 Unavailable'); }
      };

      const result = await dispatchSync({
        targetPlatform: 'BOTH',
        roleId: 'role_ft_1',
        userId: 'user_ft',
        restrictions: [{ field: 'Plant', filterType: 'SINGLE_VALUE', value: '1000' }]
      }, {
        HanaClient: mockHanaClient,
        DatabricksClient: mockDatabricksClient
      });

      // Datasphere succeeded, Databricks reported error in errors array
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(result.databricks?.success, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].platform, 'DATABRICKS');
      assert.ok(result.errors[0].message.includes('503 Unavailable'));
      assert.deepStrictEqual(executed, ['HANA_SUCCESS']);
    });

  });

});
