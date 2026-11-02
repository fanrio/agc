# Milestone 3 Explorer Report: Direct Multi-Target Sync Dispatcher Design

- **Agent**: Explorer M3-1 (Direct Multi-Target Sync Dispatcher)
- **Role**: Investigation, Synthesis, Architectural Design
- **Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_1`
- **Target Module**: `srv/services/directSyncDispatcher.js`
- **Date**: 2026-11-02

---

## 1. Observation

Direct code and schema inspections conducted across the workspace:

### 1.1 Data Model & Platform Definitions
- In `db/schema.cds`:
  - **Lines 5–9**: `type TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; };`
  - **Line 52**: `entity AccessDomains` defines `targetPlatform : TargetPlatform default 'BOTH';`
  - **Line 76**: `entity Roles` defines `targetPlatform : TargetPlatform default 'DATASPHERE';`
  - **Lines 142–154**: `entity DatabricksSettings` defines workspace connection metadata (`workspaceUrl`, `authType`, `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive`).
  - **Lines 122–140**: `entity BdcSettings` defines HANA / BDC connection metadata (`connectionType`, `systemName`, `isActive`).

### 1.2 Existing HANA Replication Implementation
- In `srv/services/hanaReplicationService.js`:
  - **Lines 24–43**: `cartesianProduct(obj)` generates Cartesian product combinations across restriction fields.
  - **Lines 58–159**: `buildFlatAuthorizationsForHana(restrictions, roleName, userId)` groups restrictions by field, computes the Cartesian product combinations, and produces rows for `HanaClient.syncAssignment` and `HanaClient.syncCustomAssignment`.
  - **Lines 234–259**: `fetchRoleAncestryChain(db, roleId, entities)` recursively traverses parent hierarchies via `RoleInheritance` to load ancestors.
  - **Lines 273–361**: `syncAssignmentToHana(cds, HanaClient, entities, assignmentId, userId, roleId, isDelete, preloaded)` resolves effective restrictions using `resolveEffectiveRestrictions`, converts to flat rows, and updates active HANA flat tables (`authorization_flat`, `[stream/domain]_flat_authorizations`).
  - **Lines 372–439**: `syncRoleAssignmentsToHana(cds, HanaClient, entities, roleId)` finds all derived descendant roles, pre-loads inheritance and restriction data once, and batch-syncs assignments in chunks of 5.

### 1.3 Existing Databricks Sync Implementation
- In `srv/services/databricksSyncService.js`:
  - **Lines 665–713**: `syncRoleToDatabricks(roleId, cds)` checks `if (role.targetPlatform === 'DATASPHERE') return { success: true, skipped: true, platform: 'DATASPHERE' };`, resolves descendant roles and affected access domains, and triggers domain policy updates.
  - **Lines 726–820**: `syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds, forcedDomainId)` handles create/update, checks `if (role && role.targetPlatform === 'DATASPHERE') return { success: true, skipped: true, platform: 'DATASPHERE' };`, loads domain assignments, resolves effective restrictions, constructs SQL DDL via `buildDatabricksRowFilterDdl`, and executes statements through `DatabricksClient.executeStatement`.
  - **Lines 831–921**: `removeAssignmentFromDatabricks(userId, roleId, cds)` revokes user assignment from Databricks Unity Catalog; if 0 users remain for the domain, executes `ALTER TABLE ... DROP ROW FILTER` and `DROP FUNCTION IF EXISTS`.
  - **Lines 929–999**: `syncAccessDomainToDatabricks(accessDomainId, cds)` creates schema and target flat table `<catalog>.<schema>.<domain>_flat_authorizations`.

### 1.4 Event Handlers and Current Asynchronous Execution
- In `srv/handlers/assignmentHandlers.js`:
  - **Lines 178–186**:
    ```javascript
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncAssignmentToHana(assignmentId, userId, roleId, false);
        const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
        if (role) await queueReplication(role.name, role.environment_ID, actorUser);
      } catch (err) {
        console.error('[AssignmentHandlers] Background sync/replication failed for RoleAssignments CREATE:', err.message);
      }
    });
    ```
  - **Lines 297–303**:
    ```javascript
    cds.spawn({ user: req?.user }, async () => {
      try {
        await syncAssignmentToHana(id, targetUserId, targetRoleId, true);
      } catch (err) {
        console.error('[AssignmentHandlers] Background HANA sync failed for RoleAssignments DELETE:', err.message);
      }
    });
    ```
- In `srv/handlers/roleHandlers.js`:
  - **Lines 429–435**: `cds.spawn` calls `await syncRoleAssignmentsToHana(id)` and queues replication on role UPDATE.
  - **Lines 475–481 & 503–509**: `cds.spawn` calls `await syncRoleAssignmentsToHana(roleId)` on `RoleInheritance` CREATE and DELETE.
- In `srv/handlers/restrictionHandlers.js`:
  - **Lines 130, 191–197, 234–240**: `syncRoleAssignmentsToHana(roleId)` called on restriction CREATE, UPDATE, and DELETE.

### 1.5 Contract & Test Expectations
- In `test/e2e_direct_sync.test.js`:
  - **Lines 612–666 (Test T1.7)**: Defines contract for `dispatchSync({ targetPlatform, roleId, userId, restrictions })`:
    * When `targetPlatform` is `DATASPHERE`: routes to HANA, Databricks receives 0 statements.
    * When `targetPlatform` is `DATABRICKS`: routes to Databricks (executing row filter DDL), HANA receives 0 statements.
    * When `targetPlatform` is `BOTH`: routes to both HANA and Databricks.
  - **Lines 668–701 (Test T1.8)**: RoleAssignments CREATE/DELETE must trigger direct sync asynchronously without blocking HTTP response latency (< 2000ms).
  - **Lines 703–725 (Test T1.9)**: Queue engine actions (`triggerReplication`, `checkReplicationStatuses`) retired.

---

## 2. Logic Chain

1. **Decoupling from Queue Engine**:
   - Currently, event handlers call `syncAssignmentToHana` / `syncRoleAssignmentsToHana` and subsequently call `queueReplication`.
   - Per Requirement R1 and R3, direct synchronization must occur in real-time without writing to the `Replications` queue or waiting for external task chains.
   - Therefore, `srv/services/directSyncDispatcher.js` must completely eliminate `queueReplication` and act as the single authoritative routing gateway for all assignment, role, and domain synchronization events.

2. **Platform Resolution Precedence & Fallbacks**:
   - Every `Roles` record has `targetPlatform` (`DATASPHERE` default).
   - Every `AccessDomains` record has `targetPlatform` (`BOTH` default).
   - When resolving the target platforms for a role:
     * If a role is standalone (no access domain), its `targetPlatform` is evaluated directly.
     * When a role belongs to an access domain, the domain specifies the available infrastructure target(s).
     * The effective targets are determined by the intersection of platforms supported by the role and the domain:
       - `isDatasphereEnabled = ['DATASPHERE', 'BOTH'].includes(role.targetPlatform) && ['DATASPHERE', 'BOTH'].includes(domain.targetPlatform)`
       - `isDatabricksEnabled = ['DATABRICKS', 'BOTH'].includes(role.targetPlatform) && ['DATABRICKS', 'BOTH'].includes(domain.targetPlatform)`
     * If `role.targetPlatform` is missing or invalid, it defaults safely to `'DATASPHERE'` per schema specification.
     * If `domain.targetPlatform` is missing or invalid, it defaults safely to `'BOTH'`.

3. **Preservation of Critical Replication Rule for HANA**:
   - Critical constraint in `AGENTS.md`: "When syncing assignments to HANA... 1. Determine Effective role authorization (recursively walking parent chains, and overriding parent wildcard restrictions if a descendant role redefines the same field). 2. Create HANA records based on the result of step 1 (Cartesian Product of all restriction values). 3. Save the Cartesian product result rows into the HANA flat tables (delete old rows first, then insert new ones)."
   - The dispatcher must not alter, re-implement, or bypass `syncAssignmentToHana` or `syncRoleAssignmentsToHana`.
   - Instead, the dispatcher delegates directly to `hanaReplicationService.syncAssignmentToHana` and `hanaReplicationService.syncRoleAssignmentsToHana`, ensuring 100% adherence to the mandatory Cartesian product flattening and ancestry inheritance rules.

4. **Integration with Databricks Unity Catalog Policy Service**:
   - For Databricks targets, `databricksSyncService.js` was implemented and verified in Milestone 2.
   - The dispatcher routes to:
     * `databricksSyncService.syncAssignmentToDatabricks(assignmentId, userId, roleId, isDelete, cds)`
     * `databricksSyncService.removeAssignmentFromDatabricks(userId, roleId, cds)`
     * `databricksSyncService.syncRoleToDatabricks(roleId, cds)`
     * `databricksSyncService.syncAccessDomainToDatabricks(domainId, cds)`
   - This ensures all 11 filter types, SQL character escaping, DNF boolean predicate generation, and table-level row filter attachment execute seamlessly.

5. **Concurrency & Target Fault Tolerance**:
   - Running in `cds.spawn` requires error boundaries: an uncaught exception in a background promise can crash Node.js.
   - When syncing to `BOTH` platforms:
     * Platform syncs must run in parallel using `Promise.allSettled`.
     * An outage or timeout on Databricks must NOT fail or block HANA synchronization, and vice-versa.
   - In Databricks Unity Catalog, concurrent DDL executions (`CREATE OR REPLACE FUNCTION`, `ALTER TABLE SET ROW FILTER`) on the same domain/table can trigger SQL warehouse compilation locks.
   - Therefore, the dispatcher should provide a domain-level serialization mechanism (promise mutex) for Databricks operations, ensuring rapid sequential application of policies per domain without inter-domain contention.

---

## 3. Caveats

1. **Pre-deletion Role Lookup**:
   - In `before DELETE RoleAssignments`, the assignment and role are still in the database.
   - However, in cascading role deletion (`DELETE Roles`), child assignments may be cleaned up after or during role deletion.
   - The dispatcher must accept either `(assignmentId, userId, roleId)` or explicit `{ targetPlatform }` in options. If the role has already been removed from the DB, the dispatcher defaults cleanup to `BOTH` platforms (or active connections) to ensure no orphaned flat table rows or row filter predicates remain.
2. **Demo Mode / Inactive Connections**:
   - If no active HANA connections are configured (`BdcSettings`), `hanaReplicationService` logs a notice and skips gracefully.
   - If no active Databricks settings are configured (`DatabricksSettings`), `databricksSyncService` logs a notice and skips with `{ skipped: true, reason: 'NO_ACTIVE_SETTINGS' }`.
   - The dispatcher treats these skipped states as non-fatal successes.
3. **Test Mode Mock Adapters**:
   - During automated tests, `mockHana` and `DatabricksMockAdapter` are active. The dispatcher must not assume live network sockets and must cleanly return execution summaries that tests can assert against.

---

## 4. Conclusion & Architectural Specification

### 4.1 Module Responsibility: `srv/services/directSyncDispatcher.js`
`directSyncDispatcher.js` is the central orchestration service for Milestone 3. It replaces the asynchronous replication queue and routes real-time authorization changes to HANA flat tables and/or Databricks Unity Catalog.

```
                      ┌───────────────────────────────────────────────┐
                      │          Event Handlers (in cds.spawn)        │
                      │  - RoleAssignments: CREATE, UPDATE, DELETE   │
                      │  - Roles: UPDATE, DELETE                      │
                      │  - Restrictions: CREATE, UPDATE, DELETE       │
                      │  - AccessDomains: CREATE, DELETE              │
                      │  - DRAGE Dynamic Reconciliation Sync          │
                      └───────────────────────┬───────────────────────┘
                                              │
                                              ▼
                      ┌───────────────────────────────────────────────┐
                      │     directSyncDispatcher (Core Router)        │
                      │  - Resolves effective targetPlatform          │
                      │  - Concurrently dispatches via allSettled     │
                      │  - Domain-level DDL serialization queue       │
                      │  - Structured logging & error boundaries      │
                      └───────┬───────────────────────────────┬───────┘
                              │                               │
        Effective target:     │                               │ Effective target:
       DATASPHERE or BOTH     ▼                               ▼ DATABRICKS or BOTH
        ┌───────────────────────────────┐   ┌───────────────────────────────────┐
        │   hanaReplicationService.js   │   │     databricksSyncService.js      │
        │ - Cartesian Product Rule      │   │ - Unity Catalog SQL UDF Filter    │
        │ - Effective Restrictions Walk │   │ - ALTER TABLE SET/DROP ROW FILTER │
        │ - HANA Flat Table Sync        │   │ - Domain Provisioning             │
        └───────────────────────────────┘   └───────────────────────────────────┘
```

---

### 4.2 Platform Resolution Specification

```javascript
/**
 * Resolves the effective target platforms by intersecting role and domain settings.
 *
 * @param {string} [rolePlatform='DATASPHERE'] - Role targetPlatform
 * @param {string} [domainPlatform='BOTH']     - AccessDomain targetPlatform
 * @returns {{ targetsDatasphere: boolean, targetsDatabricks: boolean, effectivePlatforms: string[] }}
 */
function resolveEffectivePlatforms(rolePlatform, domainPlatform) {
  const normRole = (rolePlatform || 'DATASPHERE').toUpperCase();
  const normDomain = (domainPlatform || 'BOTH').toUpperCase();

  const roleTargetsDs = normRole === 'DATASPHERE' || normRole === 'BOTH';
  const roleTargetsDb = normRole === 'DATABRICKS' || normRole === 'BOTH';

  const domainSupportsDs = normDomain === 'DATASPHERE' || normDomain === 'BOTH';
  const domainSupportsDb = normDomain === 'DATABRICKS' || normDomain === 'BOTH';

  const targetsDatasphere = roleTargetsDs && domainSupportsDs;
  const targetsDatabricks = roleTargetsDb && domainSupportsDb;

  const effectivePlatforms = [];
  if (targetsDatasphere) effectivePlatforms.push('DATASPHERE');
  if (targetsDatabricks) effectivePlatforms.push('DATABRICKS');

  return {
    targetsDatasphere,
    targetsDatabricks,
    effectivePlatforms,
    conflict: (!targetsDatasphere && !targetsDatabricks)
  };
}
```

---

### 4.3 Concrete Method Signatures & Return Contracts

#### 1. `dispatchAssignmentSync`
Synchronizes a newly assigned or updated role assignment to active targets.
```typescript
dispatchAssignmentSync(
  params: {
    assignmentId?: string;
    userId: string;
    roleId: string;
    actorUser?: string;
    environmentId?: string;
  },
  deps?: DispatcherDeps
): Promise<DispatchResult>
```
* **Behaviors**:
  1. Loads role and associated `accessDomain`.
  2. Resolves effective platforms.
  3. Executes `syncAssignmentToHana(cds, HanaClient, entities, assignmentId, userId, roleId, false)` if Datasphere targeted.
  4. Executes `syncAssignmentToDatabricks(assignmentId, userId, roleId, false, cds)` if Databricks targeted.
  5. Returns structured `DispatchResult`.

#### 2. `dispatchAssignmentRemoval`
Revokes an assignment from active targets.
```typescript
dispatchAssignmentRemoval(
  params: {
    assignmentId?: string;
    userId: string;
    roleId: string;
    actorUser?: string;
    environmentId?: string;
    targetPlatform?: 'DATASPHERE' | 'DATABRICKS' | 'BOTH';
  },
  deps?: DispatcherDeps
): Promise<DispatchResult>
```
* **Behaviors**:
  1. Inspects role (or falls back to `params.targetPlatform` / `BOTH` if role already deleted).
  2. Executes `syncAssignmentToHana(cds, HanaClient, entities, assignmentId, userId, roleId, true)` if Datasphere targeted.
  3. Executes `removeAssignmentFromDatabricks(userId, roleId, cds)` if Databricks targeted.
  4. Returns structured `DispatchResult`.

#### 3. `dispatchRoleSync`
Re-synchronizes all assignments for a role and its derived descendants (triggered on role update, restriction update/create/delete, inheritance change, or dynamic rule reconciliation).
```typescript
dispatchRoleSync(
  paramsOrRoleId: string | {
    roleId: string;
    actorUser?: string;
    environmentId?: string;
  },
  deps?: DispatcherDeps
): Promise<DispatchResult>
```
* **Behaviors**:
  1. Loads role and resolves target platforms.
  2. If Datasphere targeted: calls `syncRoleAssignmentsToHana(cds, HanaClient, entities, roleId)` (recursively updates all descendant assignments preserving Cartesian product).
  3. If Databricks targeted: calls `syncRoleToDatabricks(roleId, cds)` (recursively identifies affected domains and updates Unity Catalog row filters).
  4. Returns structured `DispatchResult`.

#### 4. `dispatchAccessDomainSync`
Provisions or synchronizes underlying tables and schemas for an Access Domain.
```typescript
dispatchAccessDomainSync(
  paramsOrDomainId: string | {
    domainId: string;
    environmentId?: string;
  },
  deps?: DispatcherDeps
): Promise<DispatchResult>
```
* **Behaviors**:
  1. If Databricks enabled on domain: calls `syncAccessDomainToDatabricks(domainId, cds)`.
  2. For Datasphere: verifies/creates custom HANA flat and hierarchy tables.

#### 5. Universal `dispatchSync`
Unified entry point matching `PROJECT.md` line 101.
```typescript
dispatchSync(
  params: {
    action: 'ASSIGN_CREATE' | 'ASSIGN_DELETE' | 'ROLE_UPDATE' | 'DOMAIN_SYNC';
    roleId?: string;
    userId?: string;
    assignmentId?: string;
    domainId?: string;
    isDelete?: boolean;
    actorUser?: string;
    environmentId?: string;
    targetPlatform?: 'DATASPHERE' | 'DATABRICKS' | 'BOTH';
  },
  deps?: DispatcherDeps
): Promise<DispatchResult>
```

#### Return Type: `DispatchResult`
```typescript
interface DispatchResult {
  success: boolean;
  action: string;
  roleId?: string;
  userId?: string;
  targetPlatform?: string;
  effectivePlatforms: string[];
  datasphere?: {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
  databricks?: {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    details?: any;
    error?: string;
  };
  errors: Array<{ platform: string; message: string }>;
  durationMs: number;
}
```

---

### 4.4 Concurrency & Mutex Serialization Strategy

To prevent compilation and DDL conflicts in Databricks when multiple assignments or roles are modified concurrently within the same access domain:
```javascript
// In-memory Promise chain per domain key
const domainMutexes = new Map();

async function withDomainLock(domainKey, task) {
  const key = domainKey || '__global__';
  const previous = domainMutexes.get(key) || Promise.resolve();
  
  let resolveCurrent;
  const current = new Promise(resolve => { resolveCurrent = resolve; });
  domainMutexes.set(key, previous.then(() => current, () => current));

  try {
    await previous;
    return await task();
  } finally {
    resolveCurrent();
    if (domainMutexes.get(key) === current) {
      domainMutexes.delete(key);
    }
  }
}
```
* Operations on **different** domains run fully in parallel.
* Operations on the **same** domain execute sequentially, preventing Databricks SQL Warehouse compilation collisions.

---

### 4.5 Implementation Template for Worker

Below is the production-ready code design for `srv/services/directSyncDispatcher.js`:

```javascript
'use strict';

/**
 * DirectSyncDispatcher
 *
 * Central dispatcher routing real-time authorization changes to SAP Datasphere (HANA flat tables)
 * and Databricks (Unity Catalog Row Filters & Access Grants).
 * Completely replaces the asynchronous batch replication queue engine.
 *
 * Critical Rules:
 *  - Preserves Cartesian product and ancestry inheritance for HANA replication.
 *  - Dispatches to Databricks Unity Catalog DDL / UDF row filters.
 *  - Uses Promise.allSettled for dual-platform fault tolerance.
 *  - Serializes Databricks DDL operations per Access Domain.
 */

const defaultCds = require('@sap/cds');
const defaultHanaClient = require('../lib/hanaClient');
const hanaReplication = require('./hanaReplicationService');
const databricksSync = require('./databricksSyncService');

// Domain-level DDL lock map
const domainLocks = new Map();

async function withDomainLock(domainKey, fn) {
  const key = domainKey || 'global';
  const prev = domainLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(res => { release = res; });
  domainLocks.set(key, prev.then(() => next, () => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (domainLocks.get(key) === next) {
      domainLocks.delete(key);
    }
  }
}

/**
 * Resolves effective target platforms.
 */
function resolveEffectivePlatforms(rolePlatform, domainPlatform) {
  const normRole = (rolePlatform || 'DATASPHERE').toUpperCase();
  const normDomain = (domainPlatform || 'BOTH').toUpperCase();

  const roleTargetsDs = normRole === 'DATASPHERE' || normRole === 'BOTH';
  const roleTargetsDb = normRole === 'DATABRICKS' || normRole === 'BOTH';

  const domainSupportsDs = normDomain === 'DATASPHERE' || normDomain === 'BOTH';
  const domainSupportsDb = normDomain === 'DATABRICKS' || normDomain === 'BOTH';

  const targetsDatasphere = roleTargetsDs && domainSupportsDs;
  const targetsDatabricks = roleTargetsDb && domainSupportsDb;

  const effectivePlatforms = [];
  if (targetsDatasphere) effectivePlatforms.push('DATASPHERE');
  if (targetsDatabricks) effectivePlatforms.push('DATABRICKS');

  return { targetsDatasphere, targetsDatabricks, effectivePlatforms };
}

/**
 * Resolves dependencies and db context.
 */
function resolveDeps(deps = {}) {
  const cdsConn = deps.cds || defaultCds;
  const db = deps.db || cdsConn.db;
  const entities = (cdsConn.entities && cdsConn.entities('fanrio.auth')) || db?.entities || {};
  const HanaClient = deps.HanaClient || defaultHanaClient;
  return { cdsConn, db, entities, HanaClient };
}

/**
 * Helper to fetch role and optional access domain metadata.
 */
async function loadRoleAndDomain(db, entities, roleId) {
  if (!roleId || !db || !entities.Roles) return { role: null, domain: null };
  const role = await db.run(SELECT.one.from(entities.Roles).where({ ID: roleId }));
  let domain = null;
  if (role?.accessDomain_ID && entities.AccessDomains) {
    domain = await db.run(SELECT.one.from(entities.AccessDomains).where({ ID: role.accessDomain_ID }));
  }
  return { role, domain };
}

/**
 * Dispatches sync for an assignment creation or update.
 */
async function dispatchAssignmentSync(params, deps = {}) {
  const start = Date.now();
  const { assignmentId, userId, roleId } = params || {};
  const { cdsConn, db, entities, HanaClient } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId);
  const rolePlatform = role?.targetPlatform || params?.targetPlatform || 'DATASPHERE';
  const domainPlatform = domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  console.log(`[DirectSyncDispatcher] AssignmentSync for user=${userId}, role=${roleId}, platforms=[${effectivePlatforms.join(',')}]`);

  const results = {
    success: true,
    action: 'ASSIGN_CREATE',
    roleId,
    userId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  // 1. SAP Datasphere (HANA)
  if (targetsDatasphere) {
    tasks.push((async () => {
      try {
        await hanaReplication.syncAssignmentToHana(cdsConn, HanaClient, entities, assignmentId, userId, roleId, false);
        results.datasphere = { success: true };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Datasphere sync error:`, err.message);
        results.datasphere = { success: false, error: err.message };
        results.errors.push({ platform: 'DATASPHERE', message: err.message });
      }
    })());
  }

  // 2. Databricks Unity Catalog
  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          return await databricksSync.syncAssignmentToDatabricks(assignmentId, userId, roleId, false, cdsConn);
        });
        results.databricks = { success: true, ...dbResult };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Databricks sync error:`, err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches removal of an assignment.
 */
async function dispatchAssignmentRemoval(params, deps = {}) {
  const start = Date.now();
  const { assignmentId, userId, roleId } = params || {};
  const { cdsConn, db, entities, HanaClient } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId);
  const rolePlatform = role?.targetPlatform || params?.targetPlatform || 'BOTH';
  const domainPlatform = domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  console.log(`[DirectSyncDispatcher] AssignmentRemoval for user=${userId}, role=${roleId}, platforms=[${effectivePlatforms.join(',')}]`);

  const results = {
    success: true,
    action: 'ASSIGN_DELETE',
    roleId,
    userId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  if (targetsDatasphere) {
    tasks.push((async () => {
      try {
        await hanaReplication.syncAssignmentToHana(cdsConn, HanaClient, entities, assignmentId, userId, roleId, true);
        results.datasphere = { success: true };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Datasphere removal error:`, err.message);
        results.datasphere = { success: false, error: err.message };
        results.errors.push({ platform: 'DATASPHERE', message: err.message });
      }
    })());
  }

  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          return await databricksSync.removeAssignmentFromDatabricks(userId, roleId, cdsConn);
        });
        results.databricks = { success: true, ...dbResult };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Databricks removal error:`, err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches re-sync of a role and all its derived descendants.
 */
async function dispatchRoleSync(paramsOrRoleId, deps = {}) {
  const start = Date.now();
  const roleId = typeof paramsOrRoleId === 'string' ? paramsOrRoleId : paramsOrRoleId?.roleId;
  const { cdsConn, db, entities, HanaClient } = resolveDeps(deps);

  const { role, domain } = await loadRoleAndDomain(db, entities, roleId);
  const rolePlatform = role?.targetPlatform || (typeof paramsOrRoleId === 'object' && paramsOrRoleId?.targetPlatform) || 'DATASPHERE';
  const domainPlatform = domain?.targetPlatform || 'BOTH';

  const { targetsDatasphere, targetsDatabricks, effectivePlatforms } =
    resolveEffectivePlatforms(rolePlatform, domainPlatform);

  console.log(`[DirectSyncDispatcher] RoleSync for role=${roleId}, platforms=[${effectivePlatforms.join(',')}]`);

  const results = {
    success: true,
    action: 'ROLE_UPDATE',
    roleId,
    targetPlatform: rolePlatform,
    effectivePlatforms,
    errors: [],
    durationMs: 0
  };

  const tasks = [];

  if (targetsDatasphere) {
    tasks.push((async () => {
      try {
        await hanaReplication.syncRoleAssignmentsToHana(cdsConn, HanaClient, entities, roleId);
        results.datasphere = { success: true };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Datasphere role sync error:`, err.message);
        results.datasphere = { success: false, error: err.message };
        results.errors.push({ platform: 'DATASPHERE', message: err.message });
      }
    })());
  }

  if (targetsDatabricks) {
    tasks.push((async () => {
      try {
        const domainKey = domain?.name || role?.accessDomain_ID || 'global';
        const dbResult = await withDomainLock(domainKey, async () => {
          return await databricksSync.syncRoleToDatabricks(roleId, cdsConn);
        });
        results.databricks = { success: true, ...dbResult };
      } catch (err) {
        console.error(`[DirectSyncDispatcher] Databricks role sync error:`, err.message);
        results.databricks = { success: false, error: err.message };
        results.errors.push({ platform: 'DATABRICKS', message: err.message });
      }
    })());
  }

  await Promise.allSettled(tasks);
  results.success = results.errors.length === 0;
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Dispatches sync for an Access Domain.
 */
async function dispatchAccessDomainSync(paramsOrDomainId, deps = {}) {
  const domainId = typeof paramsOrDomainId === 'string' ? paramsOrDomainId : paramsOrDomainId?.domainId;
  const { cdsConn, db, entities } = resolveDeps(deps);

  let domain = null;
  if (entities.AccessDomains) {
    domain = await db.run(SELECT.one.from(entities.AccessDomains).where({ ID: domainId }));
  }

  const domainPlatform = domain?.targetPlatform || 'BOTH';
  const targetsDatabricks = domainPlatform === 'DATABRICKS' || domainPlatform === 'BOTH';

  if (targetsDatabricks) {
    return await databricksSync.syncAccessDomainToDatabricks(domainId, cdsConn);
  }
  return { success: true, skipped: true, platform: 'DATASPHERE' };
}

/**
 * Universal dispatcher.
 */
async function dispatchSync(params, deps = {}) {
  const { action, isDelete } = params || {};
  if (action === 'ASSIGN_DELETE' || isDelete) {
    return await dispatchAssignmentRemoval(params, deps);
  }
  if (action === 'ASSIGN_CREATE') {
    return await dispatchAssignmentSync(params, deps);
  }
  if (action === 'ROLE_UPDATE') {
    return await dispatchRoleSync(params, deps);
  }
  if (action === 'DOMAIN_SYNC') {
    return await dispatchAccessDomainSync(params, deps);
  }
  // Default to role sync if roleId provided
  if (params?.roleId && !params?.userId) {
    return await dispatchRoleSync(params, deps);
  }
  return await dispatchAssignmentSync(params, deps);
}

module.exports = {
  resolveEffectivePlatforms,
  dispatchAssignmentSync,
  dispatchAssignmentRemoval,
  dispatchRoleSync,
  dispatchAccessDomainSync,
  dispatchSync
};
```

---

## 5. Verification Method

### 5.1 Static Verification
1. Verify `directSyncDispatcher.js` preserves the Critical Replication Rule:
   - Check that `syncAssignmentToHana` and `syncRoleAssignmentsToHana` are called without modifying resolution or flattening logic.
2. Verify method signatures support:
   - Positional and object arguments.
   - Dual routing on `targetPlatform = 'BOTH'`.
   - Single routing on `DATASPHERE` or `DATABRICKS`.
3. Verify concurrency control:
   - Ensure `withDomainLock` handles domain-level sequencing without blocking other domains.

### 5.2 Dynamic Verification
Run test suites using the project test runner:
```powershell
# 1. Databricks sync unit & integration test suite
npm run test -- test/databricks_sync.test.js

# 2. End-to-end direct sync test suite (Test T1.7 & T1.8)
npm run test -- test/e2e_direct_sync.test.js

# 3. Full project backend test suite
npm run test

# 4. Frontend production bundle compile check
npm run build --prefix app/catalog
```

### 5.3 Invalidation Conditions
The design is invalidated if:
1. HANA replication bypasses `buildFlatAuthorizationsForHana` or the Cartesian product table.
2. Databricks row filter compilation throws overlapping DDL collisions under concurrent assignment creation.
3. A failure in Databricks causes an uncaught rejection in `cds.spawn` or aborts Datasphere sync when `targetPlatform` is `BOTH`.
