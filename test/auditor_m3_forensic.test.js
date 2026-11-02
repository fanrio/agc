'use strict';

const test = require('node:test');
const assert = require('node:assert');

const dispatcher = require('../srv/services/directSyncDispatcher');
const {
  withDomainLock,
  resolveEffectivePlatforms,
  dispatchAssignmentSync,
  dispatchAssignmentRemoval,
  dispatchRoleSync,
  dispatchAccessDomainSync,
  dispatchSync
} = dispatcher;

test('Forensic Auditor M3 Adversarial Stress & Integrity Suite', async (t) => {

  // -------------------------------------------------------------------------
  // 1. Concurrency Mutex: High-Contention & Exception Safety
  // -------------------------------------------------------------------------
  await t.test('1. Mutex Under High Contention & Error Cascades', async (t1) => {

    await t1.test('1.1 50 interleaved operations on same domain preserve strict serial order', async () => {
      const order = [];
      const domain = 'domain_stress_serial';
      const tasks = [];

      for (let i = 0; i < 50; i++) {
        tasks.push(withDomainLock(domain, async () => {
          order.push(`start-${i}`);
          await new Promise(r => setImmediate(r));
          order.push(`end-${i}`);
          return i;
        }));
      }

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 50);
      assert.strictEqual(order.length, 100);

      // Verify that every start-i is immediately followed by end-i before start-j
      for (let i = 0; i < 50; i++) {
        assert.strictEqual(order[i * 2], `start-${i}`);
        assert.strictEqual(order[i * 2 + 1], `end-${i}`);
      }
    });

    await t1.test('1.2 Multiple failures in lock chain do not poison subsequent locks', async () => {
      const domain = 'domain_stress_poison';

      // 5 failing tasks
      for (let i = 0; i < 5; i++) {
        await assert.rejects(
          withDomainLock(domain, async () => {
            throw new Error(`Deliberate Failure ${i}`);
          }),
          /Deliberate Failure/
        );
      }

      // Successful task immediately executes
      const res = await withDomainLock(domain, async () => 'RECOVERED');
      assert.strictEqual(res, 'RECOVERED');
    });

    await t1.test('1.3 Empty / null / undefined domainKey defaults to __global__ and works cleanly', async () => {
      const r1 = await withDomainLock(null, async () => 'NULL_KEY');
      const r2 = await withDomainLock(undefined, async () => 'UNDEF_KEY');
      const r3 = await withDomainLock('', async () => 'EMPTY_KEY');

      assert.strictEqual(r1, 'NULL_KEY');
      assert.strictEqual(r2, 'UNDEF_KEY');
      assert.strictEqual(r3, 'EMPTY_KEY');
    });

  });

  // -------------------------------------------------------------------------
  // 2. Platform Resolution Matrix & Edge Invariance
  // -------------------------------------------------------------------------
  await t.test('2. Platform Resolution Matrix & Edge Invariance', async (t2) => {

    const matrix = [
      { role: 'datasphere', domain: 'both', ds: true, db: false, eff: 'DATASPHERE', conflict: false },
      { role: 'DATABRICKS', domain: 'BOTH', ds: false, db: true, eff: 'DATABRICKS', conflict: false },
      { role: 'both', domain: 'both', ds: true, db: true, eff: 'BOTH', conflict: false },
      { role: 'both', domain: 'datasphere', ds: true, db: false, eff: 'DATASPHERE', conflict: false },
      { role: 'both', domain: 'databricks', ds: false, db: true, eff: 'DATABRICKS', conflict: false },
      { role: 'datasphere', domain: 'databricks', ds: false, db: false, eff: 'NONE', conflict: true },
      { role: 'databricks', domain: 'datasphere', ds: false, db: false, eff: 'NONE', conflict: true },
      { role: 'UNKNOWN_PLATFORM', domain: 'BOTH', ds: false, db: false, eff: 'NONE', conflict: true },
      { role: '', domain: '', ds: true, db: false, eff: 'DATASPHERE', conflict: false } // Fallbacks: role default is DATASPHERE, domain default is BOTH
    ];

    for (const row of matrix) {
      await t2.test(`Matrix check: role=${row.role}, domain=${row.domain}`, () => {
        const res = resolveEffectivePlatforms(row.role, row.domain);
        assert.strictEqual(res.targetsDatasphere, row.ds, `targetsDatasphere mismatch for ${row.role}/${row.domain}`);
        assert.strictEqual(res.targetsDatabricks, row.db, `targetsDatabricks mismatch for ${row.role}/${row.domain}`);
        assert.strictEqual(res.effectivePlatform, row.eff, `effectivePlatform mismatch for ${row.role}/${row.domain}`);
        assert.strictEqual(res.conflict, row.conflict, `conflict flag mismatch for ${row.role}/${row.domain}`);
      });
    }

  });

  // -------------------------------------------------------------------------
  // 3. Dual-Fault Isolation & Asymmetric Errors
  // -------------------------------------------------------------------------
  await t.test('3. Dual-Fault Isolation & Asymmetric Errors', async (t3) => {

    await t3.test('3.1 Datasphere crash does NOT abort Databricks sync', async () => {
      let dbExecuted = false;
      const mockHana = {
        syncAssignmentToHana: async () => {
          throw new Error('HANA connection refused: 30015');
        }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => {
          dbExecuted = true;
          return { success: true };
        }
      };
      const mockDb = {
        run: async () => ({ ID: 'r_both', targetPlatform: 'BOTH' })
      };

      const res = await dispatchAssignmentSync({
        assignmentId: 'a1',
        userId: 'u1',
        roleId: 'r_both'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(res.success, false); // Contains error
      assert.strictEqual(res.datasphere.success, false);
      assert.strictEqual(res.databricks.success, true);
      assert.strictEqual(dbExecuted, true);
      assert.strictEqual(res.errors.length, 1);
      assert.strictEqual(res.errors[0].platform, 'DATASPHERE');
    });

    await t3.test('3.2 Both platforms throw different errors concurrently', async () => {
      const mockHana = {
        syncAssignmentToHana: async () => {
          throw new Error('HANA Out of Memory');
        }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => {
          throw new Error('Databricks 401 Unauthorized');
        }
      };
      const mockDb = {
        run: async () => ({ ID: 'r_both', targetPlatform: 'BOTH' })
      };

      const res = await dispatchAssignmentSync({
        assignmentId: 'a2',
        userId: 'u2',
        roleId: 'r_both'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.datasphere.success, false);
      assert.strictEqual(res.databricks.success, false);
      assert.strictEqual(res.errors.length, 2);
      const platforms = res.errors.map(e => e.platform);
      assert.ok(platforms.includes('DATASPHERE'));
      assert.ok(platforms.includes('DATABRICKS'));
    });

  });

  // -------------------------------------------------------------------------
  // 4. Critical Replication Rule: Cartesian Product & Ancestry Preservation
  // -------------------------------------------------------------------------
  await t.test('4. Critical Replication Rule Preservation', async (t4) => {

    await t4.test('4.1 HANA dispatch receives genuine preloaded ancestry and entity contexts', async () => {
      let passedPreload = null;
      let passedEntities = null;
      let passedIsDelete = null;

      const mockHana = {
        syncAssignmentToHana: async (cds, client, entities, assignId, user, role, isDel, preloaded) => {
          passedPreload = preloaded;
          passedEntities = entities;
          passedIsDelete = isDel;
        }
      };
      const mockDb = {
        run: async () => ({ ID: 'role_cartesian', targetPlatform: 'DATASPHERE' })
      };
      const mockEntities = { Roles: 'Roles_Entity', Restrictions: 'Restrictions_Entity' };
      const samplePreload = { allRoles: [{ ID: 'role_cartesian' }], allRestrictions: [] };

      await dispatchAssignmentSync({
        assignmentId: 'a_cart',
        userId: 'u_cart',
        roleId: 'role_cartesian'
      }, {
        db: mockDb,
        entities: mockEntities,
        hanaReplication: mockHana,
        preloaded: samplePreload
      });

      assert.strictEqual(passedIsDelete, false);
      assert.strictEqual(passedEntities, mockEntities);
      assert.strictEqual(passedPreload, samplePreload);
    });

  });

});
