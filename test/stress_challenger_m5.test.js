'use strict';

/**
 * Challenger M5-1 Adversarial Stress & Verification Test Suite
 *
 * Mission Objectives:
 * 1. Empirical verification of lock map cleanup:
 *    - 100+ sequential and interleaved tasks through withDomainLock in directSyncDispatcher.js.
 *    - Verify domainLocks Map size drops back to 0 when idle (zero memory leak).
 *    - Stress concurrency, mixed domains, exception throwing, and rapid burst invocations.
 * 2. Empirical verification of 404 endpoints:
 *    - Verify all retired queue endpoints (/odata/v4/auth/Replications, triggerReplication, checkReplicationStatuses)
 *      return HTTP 404 across multiple roles and simulated users (admin, approver, analyst, unauthorized, anonymous).
 * 3. Error propagation stress:
 *    - Verify that when Databricks returns { success: false, error: '...' } without throwing,
 *      the dispatcher records the error and reports results.success === false across assignment sync,
 *      assignment removal, and role sync.
 */

// Mock @sap/hana-client in require cache before loading CAP
const mockHana = {
  createConnection: () => ({
    connect: (params, cb) => cb(null),
    setAutoCommit: (auto, cb) => cb(null),
    commit: (cb) => cb(null),
    rollback: (cb) => cb(null),
    prepare: (sql, cb) => cb(null, { exec: (params, cb) => cb(null) }),
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

// Intercept Module._compile to capture domainLocks Map instance from directSyncDispatcher without modifying file on disk
const Module = require('module');
const originalCompile = Module.prototype._compile;
Module.prototype._compile = function(content, filename) {
  if (filename.includes('directSyncDispatcher.js')) {
    content += '\nif (typeof domainLocks !== "undefined") { module.exports._domainLocks = domainLocks; }\n';
  }
  return originalCompile.call(this, content, filename);
};

const dispatcher = require('../srv/services/directSyncDispatcher');
Module.prototype._compile = originalCompile; // restore compile immediately

const {
  withDomainLock,
  _domainLocks,
  dispatchAssignmentSync,
  dispatchAssignmentRemoval,
  dispatchRoleSync,
  dispatchSync
} = dispatcher;

const test = require('node:test');
const assert = require('node:assert');
const cds = require('@sap/cds');

const { GET, POST, DELETE } = cds.test(__dirname + '/..');

test('Challenger M5-1 Adversarial Stress & Verification Suite', async (t) => {

  // =========================================================================
  // MISSION ITEM 1: Empirical Verification of Lock Map Cleanup & Zero Leak
  // =========================================================================
  await t.test('1. Domain Lock Mutex Memory Leak & Map Cleanup Verification', async (t1) => {

    await t1.test('1.0 Verify _domainLocks Map is accessible for empirical inspection', () => {
      assert.ok(_domainLocks instanceof Map, '_domainLocks must be an instance of Map');
      assert.strictEqual(_domainLocks.size, 0, 'Initial _domainLocks Map must be empty (size 0)');
    });

    await t1.test('1.1 120 Sequential tasks on single domain: lock cleans up to 0 at completion', async () => {
      const domain = 'stress-seq-domain';
      const order = [];

      for (let i = 0; i < 120; i++) {
        await withDomainLock(domain, async () => {
          order.push(i);
          // Check that domain is present in lock map during execution
          assert.ok(_domainLocks.has(domain), `Domain ${domain} must be present in _domainLocks during execution`);
          return i;
        });
      }

      assert.strictEqual(order.length, 120, 'All 120 sequential tasks must complete');
      // Give microtask tick for finally clause cleanup
      await new Promise(r => setImmediate(r));
      assert.strictEqual(_domainLocks.size, 0, `_domainLocks size must be 0 after sequential run, got ${_domainLocks.size}`);
    });

    await t1.test('1.2 150 Interleaved concurrent tasks across 15 distinct domains', async () => {
      const numTasks = 150;
      const numDomains = 15;
      const tasks = [];
      const executionLog = [];
      let peakMapSize = 0;

      for (let i = 0; i < numTasks; i++) {
        const domain = `interleaved-dom-${i % numDomains}`;
        tasks.push(withDomainLock(domain, async () => {
          const currentSize = _domainLocks.size;
          if (currentSize > peakMapSize) {
            peakMapSize = currentSize;
          }
          executionLog.push({ domain, start: i });
          await new Promise(r => setTimeout(r, 2)); // micro delay to induce concurrency
          executionLog.push({ domain, end: i });
          return i;
        }));
      }

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 150, 'All 150 interleaved tasks must complete successfully');
      assert.ok(peakMapSize >= 2, `Peak Map size (${peakMapSize}) must be >= 2 during concurrent execution`);

      // Allow microtask tick for all finally clauses to settle
      await new Promise(r => setTimeout(r, 20));
      assert.strictEqual(_domainLocks.size, 0, `_domainLocks Map size must drop strictly to 0 when idle, got ${_domainLocks.size}`);
    });

    await t1.test('1.3 100 Error-throwing tasks interleaved with successful tasks across 10 domains', async () => {
      const numTasks = 100;
      const numDomains = 10;
      const tasks = [];

      for (let i = 0; i < numTasks; i++) {
        const domain = `stress-err-dom-${i % numDomains}`;
        const shouldFail = (i % 2 === 0);

        tasks.push(
          withDomainLock(domain, async () => {
            await new Promise(r => setImmediate(r));
            if (shouldFail) {
              throw new Error(`Deliberate stress error ${i}`);
            }
            return `success-${i}`;
          }).catch(err => {
            return { caughtError: err.message };
          })
        );
      }

      const outcomes = await Promise.all(tasks);
      assert.strictEqual(outcomes.length, 100);

      const failedCount = outcomes.filter(o => o.caughtError && o.caughtError.includes('Deliberate stress error')).length;
      const successCount = outcomes.filter(o => typeof o === 'string' && o.startsWith('success-')).length;

      assert.strictEqual(failedCount, 50, 'Exactly 50 tasks must fail and be caught');
      assert.strictEqual(successCount, 50, 'Exactly 50 tasks must succeed');

      // Allow microtasks to clear
      await new Promise(r => setImmediate(r));
      assert.strictEqual(_domainLocks.size, 0, `_domainLocks Map size must drop to 0 even after 50 thrown errors, got ${_domainLocks.size}`);
    });

    await t1.test('1.4 High-frequency burst test: 5 bursts of 50 tasks', async () => {
      for (let burst = 0; burst < 5; burst++) {
        const burstTasks = [];
        for (let i = 0; i < 50; i++) {
          const domain = `burst-dom-${i % 5}`;
          burstTasks.push(withDomainLock(domain, async () => {
            return `b${burst}-t${i}`;
          }));
        }
        await Promise.all(burstTasks);
        await new Promise(r => setImmediate(r));
        assert.strictEqual(_domainLocks.size, 0, `Map size must be 0 after burst ${burst}`);
      }
    });

    await t1.test('1.5 Null, undefined, empty domain key defaults to __global__ and cleans up', async () => {
      await withDomainLock(null, async () => {
        assert.ok(_domainLocks.has('__global__'), '__global__ lock must be active during null domain task');
        return 'null_done';
      });
      await new Promise(r => setImmediate(r));
      assert.strictEqual(_domainLocks.size, 0, 'Map size must be 0 after null key');

      await withDomainLock(undefined, async () => {
        assert.ok(_domainLocks.has('__global__'), '__global__ lock must be active during undefined domain task');
        return 'undef_done';
      });
      await new Promise(r => setImmediate(r));
      assert.strictEqual(_domainLocks.size, 0, 'Map size must be 0 after undefined key');

      await withDomainLock('', async () => {
        assert.ok(_domainLocks.has('__global__'), '__global__ lock must be active during empty string domain task');
        return 'empty_done';
      });
      await new Promise(r => setImmediate(r));
      assert.strictEqual(_domainLocks.size, 0, 'Map size must be 0 after empty string key');
    });

  });

  // =========================================================================
  // MISSION ITEM 2: Empirical Verification of 404 for Retired Queue Endpoints
  // =========================================================================
  await t.test('2. Retired Queue Endpoints 404 Verification Across Roles & Users', async (t2) => {
    const retiredEndpoints = [
      { method: 'POST', path: '/odata/v4/auth/triggerReplication', body: {} },
      { method: 'POST', path: '/odata/v4/auth/checkReplicationStatuses', body: {} },
      { method: 'GET',  path: '/odata/v4/auth/Replications', body: null },
      { method: 'POST', path: '/odata/v4/auth/Replications', body: { environment_ID: 'D' } }
    ];

    const testUsers = [
      { label: 'Admin (SuperAdmin)', user: 'admin' },
      { label: 'Approver', user: 'approver_user' },
      { label: 'Analyst (Restricted)', user: 'analyst_user' },
      { label: 'Unauthorized User (No Perms)', user: 'unauthorized_user' },
      { label: 'Anonymous / Unauthenticated', user: null }
    ];

    for (const { label, user } of testUsers) {
      for (const { method, path, body } of retiredEndpoints) {
        await t2.test(`${method} ${path} returns 404 for ${label}`, async () => {
          const headers = user ? { 'x-simulated-user': user } : {};
          try {
            if (method === 'GET') {
              await GET(path, { headers });
            } else if (method === 'POST') {
              await POST(path, body, { headers });
            }
            assert.fail(`Expected ${method} ${path} to fail with HTTP 404 for ${label}, but request succeeded`);
          } catch (err) {
            const status = err.status || err.response?.status;
            assert.strictEqual(
              status,
              404,
              `Endpoint ${method} ${path} for user '${label}' must return HTTP 404 Not Found, but returned status ${status}`
            );
          }
        });
      }
    }
  });

  // =========================================================================
  // MISSION ITEM 3: Error Propagation Stress (Non-Throwing Failures)
  // =========================================================================
  await t.test('3. Error Propagation Stress: Non-Throwing Databricks Errors', async (t3) => {

    await t3.test('3.1 dispatchAssignmentSync reports failure and records error when Databricks returns { success: false, error }', async () => {
      const mockDatabricksSync = {
        syncAssignmentToDatabricks: async () => {
          // Returns failure object without throwing
          return { success: false, error: 'Simulated Databricks DDL Warehouse Syntax Error' };
        }
      };

      const mockRole = { ID: 'role_test_err_1', name: 'Role Test Error 1', targetPlatform: 'DATABRICKS', accessDomain_ID: 'dom_err_1' };
      const mockDomain = { ID: 'dom_err_1', name: 'Domain Error 1', targetPlatform: 'DATABRICKS' };

      const results = await dispatchAssignmentSync({
        assignmentId: 'assign_err_1',
        userId: 'user_err_1@example.com',
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'DATABRICKS'
      }, {
        databricksSync: mockDatabricksSync,
        db: { run: async () => mockRole }
      });

      assert.strictEqual(results.success, false, 'results.success must be false when Databricks returns non-throwing error');
      assert.strictEqual(results.databricks?.success, false, 'results.databricks.success must be false');
      assert.strictEqual(results.databricks?.error, 'Simulated Databricks DDL Warehouse Syntax Error');
      assert.strictEqual(results.errors.length, 1, 'results.errors must contain exactly 1 error entry');
      assert.strictEqual(results.errors[0].platform, 'DATABRICKS');
      assert.strictEqual(results.errors[0].message, 'Simulated Databricks DDL Warehouse Syntax Error');
    });

    await t3.test('3.2 dispatchAssignmentRemoval reports failure when Databricks returns { success: false, error }', async () => {
      const mockDatabricksSync = {
        removeAssignmentFromDatabricks: async () => {
          return { success: false, error: 'Simulated Unity Catalog Policy Drop Failure: Table Locked' };
        }
      };

      const mockRole = { ID: 'role_test_err_2', name: 'Role Test Error 2', targetPlatform: 'DATABRICKS', accessDomain_ID: 'dom_err_2' };
      const mockDomain = { ID: 'dom_err_2', name: 'Domain Error 2', targetPlatform: 'DATABRICKS' };

      const results = await dispatchAssignmentRemoval({
        assignmentId: 'assign_err_2',
        userId: 'user_err_2@example.com',
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'DATABRICKS'
      }, {
        databricksSync: mockDatabricksSync,
        db: { run: async () => mockRole }
      });

      assert.strictEqual(results.success, false, 'results.success must be false when removal fails');
      assert.strictEqual(results.databricks?.success, false, 'results.databricks.success must be false');
      assert.strictEqual(results.errors.length, 1, 'results.errors must contain 1 error');
      assert.strictEqual(results.errors[0].platform, 'DATABRICKS');
      assert.strictEqual(results.errors[0].message, 'Simulated Unity Catalog Policy Drop Failure: Table Locked');
    });

    await t3.test('3.3 dispatchRoleSync reports failure when Databricks returns { success: false, error }', async () => {
      const mockDatabricksSync = {
        syncRoleToDatabricks: async () => {
          return { success: false, error: 'Simulated Role Cascading DDL Compilation Failure' };
        }
      };

      const mockRole = { ID: 'role_test_err_3', name: 'Role Test Error 3', targetPlatform: 'DATABRICKS', accessDomain_ID: 'dom_err_3' };
      const mockDomain = { ID: 'dom_err_3', name: 'Domain Error 3', targetPlatform: 'DATABRICKS' };

      const results = await dispatchRoleSync({
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'DATABRICKS'
      }, {
        databricksSync: mockDatabricksSync,
        db: { run: async () => mockRole }
      });

      assert.strictEqual(results.success, false, 'results.success must be false when role sync fails');
      assert.strictEqual(results.databricks?.success, false, 'results.databricks.success must be false');
      assert.strictEqual(results.errors.length, 1, 'results.errors must contain 1 error');
      assert.strictEqual(results.errors[0].platform, 'DATABRICKS');
      assert.strictEqual(results.errors[0].message, 'Simulated Role Cascading DDL Compilation Failure');
    });

    await t3.test('3.4 Fallback to dbResult.reason when error property is missing', async () => {
      const mockDatabricksSync = {
        syncAssignmentToDatabricks: async () => {
          return { success: false, reason: 'SQL_WAREHOUSE_STOPPED' };
        }
      };

      const mockRole = { ID: 'role_test_err_4', name: 'Role 4', targetPlatform: 'DATABRICKS', accessDomain_ID: 'dom_4' };
      const mockDomain = { ID: 'dom_4', name: 'Domain 4', targetPlatform: 'DATABRICKS' };

      const results = await dispatchAssignmentSync({
        assignmentId: 'assign_4',
        userId: 'user_4@example.com',
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'DATABRICKS'
      }, {
        databricksSync: mockDatabricksSync,
        db: { run: async () => mockRole }
      });

      assert.strictEqual(results.success, false);
      assert.strictEqual(results.errors.length, 1);
      assert.strictEqual(results.errors[0].message, 'SQL_WAREHOUSE_STOPPED');
    });

    await t3.test('3.5 Skipped operations (skipped: true) are treated as success without errors', async () => {
      const mockDatabricksSync = {
        syncAssignmentToDatabricks: async () => {
          return { success: true, skipped: true, reason: 'NO_ASSIGNMENTS_OR_RESTRICTIONS' };
        }
      };

      const mockRole = { ID: 'role_test_skip', name: 'Role Skip', targetPlatform: 'DATABRICKS', accessDomain_ID: 'dom_skip' };
      const mockDomain = { ID: 'dom_skip', name: 'Domain Skip', targetPlatform: 'DATABRICKS' };

      const results = await dispatchAssignmentSync({
        assignmentId: 'assign_skip',
        userId: 'user_skip@example.com',
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'DATABRICKS'
      }, {
        databricksSync: mockDatabricksSync,
        db: { run: async () => mockRole }
      });

      assert.strictEqual(results.success, true, 'Skipped operation must result in results.success === true');
      assert.strictEqual(results.errors.length, 0, 'No errors must be recorded for skipped operation');
      assert.strictEqual(results.databricks?.skipped, true);
    });

    await t3.test('3.6 Dual-target fault isolation: Datasphere succeeds while Databricks non-throwing failure marks overall success=false', async () => {
      const mockHanaReplication = {
        syncAssignmentToHana: async () => {
          return { success: true, rowsInserted: 4 };
        }
      };
      const mockDatabricksSync = {
        syncAssignmentToDatabricks: async () => {
          return { success: false, error: 'Databricks OAuth Token Expired' };
        }
      };

      const mockRole = { ID: 'role_test_both', name: 'Role Both', targetPlatform: 'BOTH', accessDomain_ID: 'dom_both' };
      const mockDomain = { ID: 'dom_both', name: 'Domain Both', targetPlatform: 'BOTH' };

      const results = await dispatchAssignmentSync({
        assignmentId: 'assign_both',
        userId: 'user_both@example.com',
        roleId: mockRole.ID,
        role: mockRole,
        domain: mockDomain,
        targetPlatform: 'BOTH'
      }, {
        hanaReplication: mockHanaReplication,
        databricksSync: mockDatabricksSync,
        HanaClient: mockHana,
        db: { run: async () => mockRole }
      });

      // Datasphere succeeded
      assert.strictEqual(results.datasphere?.success, true, 'Datasphere must succeed independently');
      // Databricks failed
      assert.strictEqual(results.databricks?.success, false, 'Databricks must report success === false');
      assert.strictEqual(results.databricks?.error, 'Databricks OAuth Token Expired');
      // Overall operation must fail because of Databricks error
      assert.strictEqual(results.success, false, 'Overall operation must be marked success: false');
      assert.strictEqual(results.errors.length, 1);
      assert.strictEqual(results.errors[0].platform, 'DATABRICKS');
    });

  });

});
