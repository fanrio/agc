'use strict';

/**
 * Empirical Challenger M3-1 Stress & Adversarial Test Suite
 *
 * Focus:
 * 1. Platform resolution permutations & edge cases (all permutations of role & domain targetPlatforms, case-insensitivity, falsy, objects, invalid).
 * 2. Concurrency stress: 60+ concurrent withDomainLock / dispatchSync calls across mixed domains (FIFO order, mutex guarantee, parallel execution across domains, zero deadlocks).
 * 3. Fault tolerance & error isolation: simulated HANA failures, simulated Databricks failures, simultaneous double failures across CREATE, DELETE, and ROLE_UPDATE.
 * 4. Preservation of Critical Replication Rule for SAP Datasphere and strict isolation for Databricks.
 */

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

test('Challenger M3-1: Empirical Stress, Concurrency & Fault-Tolerance Suite', async (t) => {

  // =========================================================================
  // 1. Platform Resolution Exhaustive Permutations & Boundary Matrix
  // =========================================================================
  await t.test('1. Platform Resolution Exhaustive Permutations & Boundary Matrix', async (t1) => {

    const matrix = [
      // role, domain, expectedTargetsDs, expectedTargetsDb, expectedEffective, expectedConflict
      ['DATASPHERE', 'DATASPHERE', true, false, 'DATASPHERE', false],
      ['DATASPHERE', 'DATABRICKS', false, false, 'NONE', true],
      ['DATASPHERE', 'BOTH', true, false, 'DATASPHERE', false],
      ['DATABRICKS', 'DATASPHERE', false, false, 'NONE', true],
      ['DATABRICKS', 'DATABRICKS', false, true, 'DATABRICKS', false],
      ['DATABRICKS', 'BOTH', false, true, 'DATABRICKS', false],
      ['BOTH', 'DATASPHERE', true, false, 'DATASPHERE', false],
      ['BOTH', 'DATABRICKS', false, true, 'DATABRICKS', false],
      ['BOTH', 'BOTH', true, true, 'BOTH', false]
    ];

    for (const [r, d, expDs, expDb, expEff, expConflict] of matrix) {
      await t1.test(`Permutation: Role(${r}) x Domain(${d}) -> ${expEff}`, () => {
        const res = resolveEffectivePlatforms(r, d);
        assert.strictEqual(res.targetsDatasphere, expDs, `targetsDatasphere mismatch for ${r} x ${d}`);
        assert.strictEqual(res.targetsDatabricks, expDb, `targetsDatabricks mismatch for ${r} x ${d}`);
        assert.strictEqual(res.effectivePlatform, expEff, `effectivePlatform mismatch for ${r} x ${d}`);
        assert.strictEqual(res.conflict, expConflict, `conflict mismatch for ${r} x ${d}`);

        // Verify resolveEffectivePlatform alias gives identical result
        const aliasRes = resolveEffectivePlatform(r, d);
        assert.deepStrictEqual(aliasRes, res, 'Alias function resolveEffectivePlatform returned inconsistent result');
      });
    }

    await t1.test('1.10 Null, undefined, empty string fallbacks', () => {
      // null, null -> role defaults to DATASPHERE, domain defaults to BOTH -> DATASPHERE
      const r1 = resolveEffectivePlatforms(null, null);
      assert.strictEqual(r1.effectivePlatform, 'DATASPHERE');
      assert.strictEqual(r1.conflict, false);

      // undefined, undefined -> DATASPHERE
      const r2 = resolveEffectivePlatforms(undefined, undefined);
      assert.strictEqual(r2.effectivePlatform, 'DATASPHERE');
      assert.strictEqual(r2.conflict, false);

      // empty string '' -> falsy, triggers default DATASPHERE and BOTH -> DATASPHERE
      const r3 = resolveEffectivePlatforms('', '');
      assert.strictEqual(r3.effectivePlatform, 'DATASPHERE');

      // role null, domain DATABRICKS -> role is DATASPHERE, domain is DATABRICKS -> conflict!
      const r4 = resolveEffectivePlatforms(null, 'DATABRICKS');
      assert.strictEqual(r4.effectivePlatform, 'NONE');
      assert.strictEqual(r4.conflict, true);

      // role DATABRICKS, domain null -> role is DATABRICKS, domain is BOTH -> DATABRICKS
      const r5 = resolveEffectivePlatforms('DATABRICKS', null);
      assert.strictEqual(r5.effectivePlatform, 'DATABRICKS');
      assert.strictEqual(r5.conflict, false);
    });

    await t1.test('1.11 Case-insensitivity & mixed-casing variations', () => {
      assert.strictEqual(resolveEffectivePlatforms('datasphere', 'both').effectivePlatform, 'DATASPHERE');
      assert.strictEqual(resolveEffectivePlatforms('databricks', 'BOTH').effectivePlatform, 'DATABRICKS');
      assert.strictEqual(resolveEffectivePlatforms('bOtH', 'Both').effectivePlatform, 'BOTH');
      assert.strictEqual(resolveEffectivePlatforms('DataSphere', 'DataBricks').conflict, true);
    });

    await t1.test('1.12 Entity object inputs and partial structures', () => {
      const roleObj = { ID: 'role_1', targetPlatform: 'BOTH', name: 'Global Finance' };
      const domainObj = { ID: 'dom_1', targetPlatform: 'DATABRICKS', name: 'Finance Domain' };

      const res1 = resolveEffectivePlatforms(roleObj, domainObj);
      assert.strictEqual(res1.targetsDatasphere, false);
      assert.strictEqual(res1.targetsDatabricks, true);
      assert.strictEqual(res1.effectivePlatform, 'DATABRICKS');

      // Object without targetPlatform property defaults properly
      const res2 = resolveEffectivePlatforms({ name: 'Role Without Platform' }, { name: 'Domain Without Platform' });
      assert.strictEqual(res2.effectivePlatform, 'DATASPHERE');
      assert.strictEqual(res2.conflict, false);

      // Object with targetPlatform null defaults properly
      const res3 = resolveEffectivePlatforms({ targetPlatform: null }, { targetPlatform: null });
      assert.strictEqual(res3.effectivePlatform, 'DATASPHERE');
    });

    await t1.test('1.13 Invalid/Unrecognized targetPlatform strings', () => {
      const res1 = resolveEffectivePlatforms('SNOWFLAKE', 'BOTH');
      assert.strictEqual(res1.conflict, true);
      assert.strictEqual(res1.effectivePlatform, 'NONE');
      assert.deepStrictEqual(res1.effectivePlatforms, []);

      const res2 = resolveEffectivePlatforms('BOTH', 'ORACLE_DB');
      assert.strictEqual(res2.conflict, true);
      assert.strictEqual(res2.effectivePlatform, 'NONE');

      const res3 = resolveEffectivePlatforms(12345, false);
      assert.strictEqual(res3.conflict, true);
    });

  });

  // =========================================================================
  // 2. Concurrency Stress: 60+ Calls, Mutex Invariant & Cross-Domain Isolation
  // =========================================================================
  await t.test('2. Concurrency Stress: Mutex Invariant & Cross-Domain Isolation', async (t2) => {

    await t2.test('2.1 60 Concurrent tasks on SINGLE domain guarantee maxConcurrency=1 and FIFO order', async () => {
      const DOMAIN = 'stress_domain_finance_single';
      const NUM_TASKS = 60;
      let activeConcurrency = 0;
      let maxObservedConcurrency = 0;
      const executionOrder = [];

      const promises = Array.from({ length: NUM_TASKS }, (_, i) => {
        return withDomainLock(DOMAIN, async () => {
          activeConcurrency++;
          if (activeConcurrency > maxObservedConcurrency) {
            maxObservedConcurrency = activeConcurrency;
          }

          // Small async sleep to give opportunity for concurrency overlap if mutex fails
          await new Promise(r => setTimeout(r, 2));

          executionOrder.push(i);
          activeConcurrency--;
          return `result_${i}`;
        });
      });

      const results = await Promise.all(promises);

      // Mutex assertion: Concurrency was strictly serialized
      assert.strictEqual(maxObservedConcurrency, 1, `Expected maxConcurrency to be 1, but observed ${maxObservedConcurrency}`);
      assert.strictEqual(activeConcurrency, 0, 'activeConcurrency must be 0 after all tasks complete');

      // Order assertion: Strictly FIFO
      assert.strictEqual(executionOrder.length, NUM_TASKS);
      for (let i = 0; i < NUM_TASKS; i++) {
        assert.strictEqual(executionOrder[i], i, `Task execution was out of order at index ${i}`);
        assert.strictEqual(results[i], `result_${i}`);
      }
    });

    await t2.test('2.2 100 Concurrent tasks across 10 mixed domains: serialized per domain, parallel across domains', async () => {
      const NUM_DOMAINS = 10;
      const TASKS_PER_DOMAIN = 10;
      const TOTAL_TASKS = NUM_DOMAINS * TASKS_PER_DOMAIN;

      const domainConcurrency = new Map();
      const domainMaxConcurrency = new Map();
      const domainOrders = new Map();
      let globalActiveConcurrency = 0;
      let maxGlobalConcurrency = 0;

      for (let d = 0; d < NUM_DOMAINS; d++) {
        domainConcurrency.set(`domain_${d}`, 0);
        domainMaxConcurrency.set(`domain_${d}`, 0);
        domainOrders.set(`domain_${d}`, []);
      }

      const allTasks = [];

      for (let d = 0; d < NUM_DOMAINS; d++) {
        const domainKey = `domain_${d}`;
        for (let tIdx = 0; tIdx < TASKS_PER_DOMAIN; tIdx++) {
          allTasks.push(
            withDomainLock(domainKey, async () => {
              // Track domain-level concurrency
              const curDomain = domainConcurrency.get(domainKey) + 1;
              domainConcurrency.set(domainKey, curDomain);
              if (curDomain > domainMaxConcurrency.get(domainKey)) {
                domainMaxConcurrency.set(domainKey, curDomain);
              }

              // Track global concurrency
              globalActiveConcurrency++;
              if (globalActiveConcurrency > maxGlobalConcurrency) {
                maxGlobalConcurrency = globalActiveConcurrency;
              }

              await new Promise(r => setTimeout(r, 3));

              domainOrders.get(domainKey).push(tIdx);

              domainConcurrency.set(domainKey, domainConcurrency.get(domainKey) - 1);
              globalActiveConcurrency--;
              return { domain: domainKey, task: tIdx };
            })
          );
        }
      }

      const completed = await Promise.all(allTasks);
      assert.strictEqual(completed.length, TOTAL_TASKS);

      // Verify each individual domain was strictly serialized
      for (let d = 0; d < NUM_DOMAINS; d++) {
        const domainKey = `domain_${d}`;
        const maxSeen = domainMaxConcurrency.get(domainKey);
        assert.strictEqual(maxSeen, 1, `Domain ${domainKey} had maxConcurrency ${maxSeen} > 1`);

        const order = domainOrders.get(domainKey);
        assert.strictEqual(order.length, TASKS_PER_DOMAIN);
        for (let tIdx = 0; tIdx < TASKS_PER_DOMAIN; tIdx++) {
          assert.strictEqual(order[tIdx], tIdx, `Domain ${domainKey} executed task out of order: ${order[tIdx]} vs ${tIdx}`);
        }
      }

      // Verify parallel execution across distinct domains
      assert.ok(maxGlobalConcurrency > 1, `Global concurrency (${maxGlobalConcurrency}) should be > 1 across 10 distinct domains`);
    });

    await t2.test('2.3 Poison pill & exception resilience under high concurrency (60 tasks)', async () => {
      const DOMAIN = 'stress_domain_poison_pill';
      const NUM_TASKS = 60;
      const tasks = [];

      for (let i = 0; i < NUM_TASKS; i++) {
        const shouldFail = (i % 4 === 0); // 15 tasks will fail
        tasks.push(
          withDomainLock(DOMAIN, async () => {
            await new Promise(r => setTimeout(r, 1));
            if (shouldFail) {
              throw new Error(`PoisonPill_${i}`);
            }
            return `success_${i}`;
          })
        );
      }

      const settled = await Promise.allSettled(tasks);

      for (let i = 0; i < NUM_TASKS; i++) {
        if (i % 4 === 0) {
          assert.strictEqual(settled[i].status, 'rejected');
          assert.strictEqual(settled[i].reason.message, `PoisonPill_${i}`);
        } else {
          assert.strictEqual(settled[i].status, 'fulfilled');
          assert.strictEqual(settled[i].value, `success_${i}`);
        }
      }

      // Subsequent task must still acquire lock immediately without being stuck
      let subsequentRan = false;
      await withDomainLock(DOMAIN, async () => {
        subsequentRan = true;
      });
      assert.strictEqual(subsequentRan, true, 'Subsequent task after multiple failures must acquire lock cleanly');
    });

  });

  // =========================================================================
  // 3. High-Throughput dispatchSync Concurrency (60 concurrent calls)
  // =========================================================================
  await t.test('3. High-Throughput dispatchSync Concurrency', async (t3) => {

    await t3.test('3.1 60 concurrent dispatchSync calls across mixed platforms with async mock clients', async () => {
      const NUM_CALLS = 60;
      let hanaExecutionCount = 0;
      let databricksExecutionCount = 0;

      const mockHanaClient = {
        syncAssignment: async () => {
          await new Promise(r => setTimeout(r, 2));
          hanaExecutionCount++;
        }
      };

      const mockDatabricksClient = {
        executeStatement: async () => {
          await new Promise(r => setTimeout(r, 2));
          databricksExecutionCount++;
          return { status: 'SUCCEEDED' };
        }
      };

      const platforms = ['DATASPHERE', 'DATABRICKS', 'BOTH'];
      const calls = [];

      for (let i = 0; i < NUM_CALLS; i++) {
        const targetPlatform = platforms[i % platforms.length]; // 20 DATASPHERE, 20 DATABRICKS, 20 BOTH
        calls.push(
          dispatchSync({
            targetPlatform,
            roleId: `role_stress_${i}`,
            userId: `user_stress_${i}`,
            restrictions: [
              { field: 'CostCenter', filterType: 'SINGLE_VALUE', value: `CC_${i}` }
            ]
          }, {
            HanaClient: mockHanaClient,
            DatabricksClient: mockDatabricksClient
          })
        );
      }

      const results = await Promise.all(calls);

      assert.strictEqual(results.length, NUM_CALLS);
      for (const res of results) {
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.errors.length, 0);
      }

      // 20 DATASPHERE + 20 BOTH = 40 HANA calls
      assert.strictEqual(hanaExecutionCount, 40, `Expected 40 HANA syncs, got ${hanaExecutionCount}`);

      // 20 DATABRICKS + 20 BOTH = 40 Databricks calls * 2 statements each (func + filter) = 80 executions
      assert.strictEqual(databricksExecutionCount, 80, `Expected 80 Databricks statement executions, got ${databricksExecutionCount}`);
    });

  });

  // =========================================================================
  // 4. Fault Tolerance, Platform Isolation & Double Failure Handling
  // =========================================================================
  await t.test('4. Fault Tolerance, Platform Isolation & Double Failure Handling', async (t4) => {

    await t4.test('4.1 Simulated HANA failure does NOT prevent Databricks execution', async () => {
      let databricksExecuted = false;

      const mockHanaClient = {
        syncAssignment: async () => {
          throw new Error('HANA_CONN_TIMEOUT_500: Database connection pool timed out');
        }
      };
      const mockDatabricksClient = {
        executeStatement: async () => {
          databricksExecuted = true;
          return { status: 'SUCCEEDED' };
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'BOTH',
        roleId: 'role_hana_fail',
        userId: 'user_hana_fail',
        restrictions: [{ field: 'Plant', filterType: 'SINGLE_VALUE', value: '1000' }]
      }, {
        HanaClient: mockHanaClient,
        DatabricksClient: mockDatabricksClient
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.datasphere?.success, false);
      assert.ok(result.datasphere?.error.includes('HANA_CONN_TIMEOUT_500'));
      assert.strictEqual(result.databricks?.success, true);
      assert.strictEqual(databricksExecuted, true, 'Databricks MUST execute even when HANA fails');
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].platform, 'DATASPHERE');
    });

    await t4.test('4.2 Simulated Databricks failure does NOT prevent HANA execution', async () => {
      let hanaExecuted = false;

      const mockHanaClient = {
        syncAssignment: async () => {
          hanaExecuted = true;
        }
      };
      const mockDatabricksClient = {
        executeStatement: async () => {
          throw new Error('DATABRICKS_AUTH_403: Token expired or invalid service principal');
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'BOTH',
        roleId: 'role_db_fail',
        userId: 'user_db_fail',
        restrictions: [{ field: 'CompanyCode', filterType: 'SINGLE_VALUE', value: 'US01' }]
      }, {
        HanaClient: mockHanaClient,
        DatabricksClient: mockDatabricksClient
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.datasphere?.success, true);
      assert.strictEqual(hanaExecuted, true, 'HANA MUST execute even when Databricks fails');
      assert.strictEqual(result.databricks?.success, false);
      assert.ok(result.databricks?.error.includes('DATABRICKS_AUTH_403'));
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].platform, 'DATABRICKS');
    });

    await t4.test('4.3 Simultaneous Double Failure handles both gracefully without unhandled rejection', async () => {
      const mockHanaClient = {
        syncAssignment: async () => {
          throw new Error('CRITICAL_HANA_DEADLOCK');
        }
      };
      const mockDatabricksClient = {
        executeStatement: async () => {
          throw new Error('CRITICAL_DATABRICKS_OUTAGE_503');
        }
      };

      const result = await dispatchSync({
        targetPlatform: 'BOTH',
        roleId: 'role_double_fail',
        userId: 'user_double_fail',
        restrictions: [{ field: 'Region', filterType: 'SINGLE_VALUE', value: 'EMEA' }]
      }, {
        HanaClient: mockHanaClient,
        DatabricksClient: mockDatabricksClient
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.datasphere?.success, false);
      assert.strictEqual(result.databricks?.success, false);
      assert.strictEqual(result.errors.length, 2);

      const platformsWithError = result.errors.map(e => e.platform);
      assert.ok(platformsWithError.includes('DATASPHERE'));
      assert.ok(platformsWithError.includes('DATABRICKS'));
    });

    await t4.test('4.4 Failure handling in dispatchAssignmentRemoval (DELETE)', async () => {
      let dbDelExecuted = false;

      const mockDb = { run: async () => ({ ID: 'role_del_both', targetPlatform: 'BOTH' }) };
      const mockHana = {
        syncAssignmentToHana: async () => {
          throw new Error('HANA_DELETE_ERROR');
        }
      };
      const mockDatabricks = {
        removeAssignmentFromDatabricks: async () => {
          dbDelExecuted = true;
          return { success: true };
        }
      };

      const res = await dispatchAssignmentRemoval({
        assignmentId: 'assign_del_test',
        userId: 'user_del_test',
        roleId: 'role_del_both'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.datasphere?.success, false);
      assert.strictEqual(res.databricks?.success, true);
      assert.strictEqual(dbDelExecuted, true);
      assert.strictEqual(res.errors[0].platform, 'DATASPHERE');
    });

    await t4.test('4.5 Failure handling in dispatchRoleSync (ROLE_UPDATE)', async () => {
      let hanaSyncExecuted = false;

      const mockDb = { run: async () => ({ ID: 'role_upd_both', targetPlatform: 'BOTH' }) };
      const mockHana = {
        syncRoleAssignmentsToHana: async () => {
          hanaSyncExecuted = true;
        }
      };
      const mockDatabricks = {
        syncRoleToDatabricks: async () => {
          throw new Error('DATABRICKS_ROLE_SYNC_FAILED');
        }
      };

      const res = await dispatchRoleSync('role_upd_both', {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.datasphere?.success, true);
      assert.strictEqual(hanaSyncExecuted, true);
      assert.strictEqual(res.databricks?.success, false);
      assert.strictEqual(res.errors[0].platform, 'DATABRICKS');
    });

  });

  // =========================================================================
  // 5. Critical Replication Rule Preservation & Boundary Checks
  // =========================================================================
  await t.test('5. Critical Replication Rule Preservation & Boundary Checks', async (t5) => {

    await t5.test('5.1 HANA sync strictly receives full parameters for ancestry & Cartesian flattening', async () => {
      let capturedArgs = null;

      const mockDb = { run: async () => ({ ID: 'role_rule_test', targetPlatform: 'DATASPHERE' }) };
      const mockHana = {
        syncAssignmentToHana: async (cdsConn, hanaClient, entities, assignId, user, roleId, isDelete, preloaded) => {
          capturedArgs = { assignId, user, roleId, isDelete, preloaded };
        }
      };

      const mockPreloaded = { allRoles: [], allRestrictions: [] };

      await dispatchAssignmentSync({
        assignmentId: 'assign_rule_1',
        userId: 'alice_rule',
        roleId: 'role_rule_test'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        preloaded: mockPreloaded
      });

      assert.ok(capturedArgs !== null, 'syncAssignmentToHana was not invoked');
      assert.strictEqual(capturedArgs.assignId, 'assign_rule_1');
      assert.strictEqual(capturedArgs.user, 'alice_rule');
      assert.strictEqual(capturedArgs.roleId, 'role_rule_test');
      assert.strictEqual(capturedArgs.isDelete, false);
      assert.strictEqual(capturedArgs.preloaded, mockPreloaded);
    });

    await t5.test('5.2 DATABRICKS-only role NEVER triggers HANA replication', async () => {
      let hanaInvoked = false;

      const mockDb = { run: async () => ({ ID: 'role_db_only', targetPlatform: 'DATABRICKS' }) };
      const mockHana = {
        syncAssignmentToHana: async () => { hanaInvoked = true; }
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => ({ success: true })
      };

      const res = await dispatchAssignmentSync({
        assignmentId: 'assign_db_1',
        userId: 'bob_db',
        roleId: 'role_db_only'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(hanaInvoked, false, 'HANA replication must NEVER be called for DATABRICKS-only role');
      assert.strictEqual(res.datasphere, undefined);
      assert.strictEqual(res.databricks?.success, true);
    });

    await t5.test('5.3 DATASPHERE-only role NEVER triggers Databricks policy sync', async () => {
      let databricksInvoked = false;

      const mockDb = { run: async () => ({ ID: 'role_ds_only', targetPlatform: 'DATASPHERE' }) };
      const mockHana = {
        syncAssignmentToHana: async () => {}
      };
      const mockDatabricks = {
        syncAssignmentToDatabricks: async () => { databricksInvoked = true; }
      };

      const res = await dispatchAssignmentSync({
        assignmentId: 'assign_ds_1',
        userId: 'carol_ds',
        roleId: 'role_ds_only'
      }, {
        db: mockDb,
        entities: { Roles: 'Roles', AccessDomains: 'AccessDomains' },
        hanaReplication: mockHana,
        databricksSync: mockDatabricks
      });

      assert.strictEqual(databricksInvoked, false, 'Databricks sync must NEVER be called for DATASPHERE-only role');
      assert.strictEqual(res.databricks, undefined);
      assert.strictEqual(res.datasphere?.success, true);
    });

  });

});
