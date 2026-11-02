# Handoff Report — Explorer M3-3: Replication Queue Engine Retirement & Service Cleanup

**Target Milestone**: Milestone 3 (Queue Engine Retirement & Service Cleanup)  
**Author**: Explorer M3-3  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_3`  
**Status**: Investigation Complete — Ready for Implementation  

---

## 1. Observation

### 1.1 Action Definitions in Service Projection
In `srv/cortex_service.cds`:
- **Lines 30**:
  ```cds
  entity Replications           as projection on db.Replications;
  ```
- **Lines 154–165**:
  ```cds
  // -------------------------------------------------------------------------
  // Replication Actions
  // -------------------------------------------------------------------------

  action triggerReplication()                                                   returns {
    success : Boolean;
    message : String;
  };

  action checkReplicationStatuses()                                             returns {
    success : Boolean;
    message : String;
  };
  ```

### 1.2 Action Handlers and Dependencies in CAP Service Layer
In `srv/cortex_service.js`:
- **Line 27**:
  ```javascript
  const { queueReplication, checkAndUpdateRunningReplications, makeTriggerReplicationHandler } = require('./services/replicationQueueService');
  ```
- **Line 62**:
  `Replications` entity extracted from `entities`.
- **Lines 155–158**:
  ```javascript
  /** Bound queueReplication */
  const boundQueueReplication = (roleName, environmentId, user) =>
    queueReplication(cds, Replications, roleName, environmentId, user);
  ```
- **Line 179**:
  `queueReplication: boundQueueReplication` passed inside `handlerDeps` to `registerRoleHandlers`, `registerAssignmentHandlers`, and `registerRestrictionHandlers`.
- **Lines 298–306**:
  ```javascript
  this.on('checkReplicationStatuses', async (req) => {
    try {
      return await checkAndUpdateRunningReplications(cds, entities, BdcClient);
    } catch (e) {
      return req.error(500, `Failed to check replication statuses: ${e.message}`);
    }
  });

  this.on('triggerReplication', makeTriggerReplicationHandler(cds, entities, BdcClient));
  ```

### 1.3 Service Guard in System Handlers
In `srv/handlers/systemHandlers.js`:
- **Lines 133–142**:
  ```javascript
  // Replications CRUD protection
  service.before(['CREATE', 'UPDATE', 'DELETE'], 'Replications', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageReplications', req);
  });

  // Replications Action protection
  service.before(['triggerReplication', 'checkReplicationStatuses'], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageReplications', req);
  });
  ```

### 1.4 Codebase Scan for `queueReplication` and `replicationQueueService.js`
Search via `grep_search` across all project files revealed references in:
1. `srv/cortex_service.js`: Lines 27, 155, 157, 179.
2. `srv/handlers/assignmentHandlers.js`:
   - Line 16, 22: Received via `deps.queueReplication`.
   - Line 182 (`after CREATE`): `if (role) await queueReplication(role.name, role.environment_ID, actorUser);`
   - Line 247 (`after UPDATE`): `if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);`
   - Line 251 (`after UPDATE`): `if (oldRole) await queueReplication(oldRole.name, oldRole.environment_ID, req?.user?.id);`
   - Line 276 (`before DELETE`): `await queueReplication(`${role.name} (ASSIGNMENT DELETED)`, role.environment_ID, req?.user?.id);`
3. `srv/handlers/roleHandlers.js`:
   - Line 27, 30: Received via `deps.queueReplication`.
   - Line 292 (`after CREATE`): `await queueReplication(targetName, environment_ID, req?.user?.id);`
   - Line 419 (`after UPDATE`): `await queueReplication(afterState?.name || beforeState?.name || 'Unknown Role', afterState?.environment_ID || beforeState?.environment_ID || 'D', req?.user?.id);`
   - Line 457 (`before DELETE`): `await queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);`
4. `srv/handlers/restrictionHandlers.js`:
   - Line 17, 20: Received via `deps.queueReplication`.
   - Line 124 (`after CREATE`): `await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);`
   - Line 185 (`after UPDATE`): `await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);`
   - Line 228 (`before DELETE`): `await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);`
5. `srv/services/dynamicSyncService.js`:
   - Line 4: Direct import `const { queueReplication } = require('./replicationQueueService');`
   - Line 270 (`_syncUserConsolidatedRole`): `await queueReplication(cds, Replications, roleName, envId, 'SYSTEM_DYN');`
   - Line 369 (`_syncTemplateAssignment`): `await queueReplication(cds, Replications, templateRole.name, templateRole.environment_ID || envId, 'SYSTEM_DYN');`
   - Line 463 (`_removeGeneratedAccess`): `await queueReplication(cds, Replications, role.name, role.environment_ID || envId, 'SYSTEM_DYN');`
   - Line 488 (`_removeGeneratedAccess`): `await queueReplication(cds, Replications, `${role.name} (DELETED)`, role.environment_ID || envId, 'SYSTEM_DYN');`
6. `srv/services/replicationQueueService.js`:
   - Line 32: `async function queueReplication(cds, Replications, roleName, environmentId, user)`
   - Line 62: `async function checkAndUpdateRunningReplications(cds, entities, BdcClient)`
   - Line 155: `function makeTriggerReplicationHandler(cds, entities, BdcClient)`

### 1.5 Existing Test Suite Dependencies on Queue Engine
1. `test/backend_tests.test.js` (Lines 1069–1136):
   - Creates an active `BdcSettings` entry with `connectionType: 'OData'` and environment `'D'`.
   - Inserts row into `fanrio.auth.Replications` with `status: 'Open'`.
   - Calls `POST('/odata/v4/auth/triggerReplication', {})`.
   - Asserts response HTTP 200 and `trigRes.data.success === true`.
   - Queries `GET /odata/v4/auth/Replications(ID=...)` and asserts `status === 'Running'`.
   - Calls `POST('/odata/v4/auth/checkReplicationStatuses', {})` and asserts HTTP 200.
   - Updates `Replications.runId` with `'-complete'` and re-calls `checkReplicationStatuses`.
   - Asserts row transitioned to `'Success'`.
2. `test/auth_enforcement.test.js` (Lines 144–189):
   - Creates user with `canManageReplications: false`.
   - Asserts `POST('/odata/v4/auth/triggerReplication')` rejects with HTTP 403.
   - Sets `canManageReplications: true`.
   - Asserts `POST('/odata/v4/auth/triggerReplication')` returns HTTP 200.
3. `test/e2e_direct_sync.test.js` (Lines 703–724, Test T1.9):
   - Asserts calling obsolete queue actions handles `[404, 400, 403, 500, 501]`.
   - Asserts no open replications are created for newly assigned roles.

---

## 2. Logic Chain

### 2.1 The Two-Phase Deprecation Requirement
- **Observation**: `PROJECT.md` schedules Queue Engine Retirement in Milestone 3 (Feature 9), Frontend UI Retirement in Milestone 4 (Feature 10), and Test Suite Migration & Queue Assertion Removal in Milestone 5 (Feature 13).
- **Observation**: `test/backend_tests.test.js` (L1070–1136) and `test/auth_enforcement.test.js` (L144–189) explicitly expect `triggerReplication` and `checkReplicationStatuses` to return 200 OK and manipulate rows in `Replications`.
- **Deduction 1**: If `triggerReplication` and `checkReplicationStatuses` actions are deleted immediately from `cortex_service.cds` in Milestone 3, any call to them will return OData 404. Consequently, `backend_tests.test.js` and `auth_enforcement.test.js` will immediately fail, violating the continuous integration requirement prior to Milestone 5.
- **Deduction 2**: Hard deletion must therefore occur in **Milestone 5**, while Milestone 3 executes the **decoupling and deprecation phase**.
- **Deduction 3**: In Milestone 3, all CRUD event handlers (`assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js`) must completely sever ties with `queueReplication`. Instead, they invoke the real-time `directSyncDispatcher` (designed by Explorer M3-1 and M3-2). This guarantees zero queue entries are ever generated by normal runtime operations.
- **Deduction 4**: In `cortex_service.cds`, actions `triggerReplication` and `checkReplicationStatuses`, as well as projection `Replications`, are annotated with `@deprecated`. In `cortex_service.js`, the handlers are retained with deprecation warnings for backward compatibility with pre-M5 tests and legacy callers.

### 2.2 Database Entity Integrity vs. OData Exposure
- **Observation**: `PROJECT.md` and `AGENTS.md` mandate: "Annotate `Replications` entity with `@deprecated: 'Replaced by real-time direct sync'` while keeping DB entity intact for migration safety."
- **Observation**: `db/schema.cds` defines `entity Replications : cuid`.
- **Deduction**: Keeping the table definition in `db/schema.cds` prevents SQLite/HANA migration drop-table regressions, maintains historical audit records, and ensures seed data (`db/data/fanrio.auth-Replications.csv`) does not trigger CAP deploy errors. Annotating the projection in `srv/cortex_service.cds` satisfies OData deprecation contracts.

### 2.3 Decommissioning Scope for `replicationQueueService.js`
- **Observation**: Search across the codebase confirmed that `replicationQueueService.js` exports three items: `queueReplication`, `checkAndUpdateRunningReplications`, and `makeTriggerReplicationHandler`.
- **Observation**: `queueReplication` is only imported by `cortex_service.js` and `dynamicSyncService.js`.
- **Observation**: Neither `checkAndUpdateRunningReplications` nor `makeTriggerReplicationHandler` is used by any other domain service (such as HANA replication, Databricks sync, or BDC action services).
- **Deduction**: There are no hidden or shared utility functions in `replicationQueueService.js`. It can be fully archived in Milestone 5 without leaving orphaned dependencies.

---

## 3. Caveats

1. **Test Runner Concurrency on Windows**: As observed during test execution, running multiple suites simultaneously in Node test runner under Windows may trigger dynamic port reservation collisions (`AggregateError [EACCES]`). This is unrelated to queue retirement logic and resolved by running tests sequentially (`-w 1`) or targeting specific files.
2. **Permission Flag `canManageReplications`**: This flag in `AppAuthorizations` is referenced in frontend views (`ReplicationsView.tsx`, `AppAuthorizationsView.tsx`, `PermissionsContext.tsx`). Per `PROJECT.md` Feature 10, removing or sunsetting `canManageReplications` from UI and permission contexts is the designated scope of Milestone 4. Milestone 3 leaves the flag definition intact in `db/schema.cds` to avoid breaking the frontend before Milestone 4.
3. **No Code Modification Rule**: Per the explorer role specification, this report provides exact before-and-after implementation designs without modifying source files.

---

## 4. Conclusion & Actionable Implementation Plan

### 4.1 Changes for Milestone 3 (Backend Decoupling & Deprecation)

#### Component A: `srv/cortex_service.cds`
Annotate the `Replications` projection and obsolete actions with `@deprecated`:

```cds
// Line 30:
  @deprecated: 'Replaced by real-time direct sync'
  entity Replications           as projection on db.Replications;
```

```cds
// Lines 154–165:
  // -------------------------------------------------------------------------
  // Replication Actions (Deprecated — replaced by real-time direct sync)
  // -------------------------------------------------------------------------

  @deprecated: 'Replaced by real-time direct sync. Obsolete action to be removed in Milestone 5.'
  action triggerReplication()                                                   returns {
    success : Boolean;
    message : String;
  };

  @deprecated: 'Replaced by real-time direct sync. Obsolete action to be removed in Milestone 5.'
  action checkReplicationStatuses()                                             returns {
    success : Boolean;
    message : String;
  };
```

#### Component B: `srv/cortex_service.js`
1. Update `handlerDeps`: Remove `queueReplication: boundQueueReplication` from `handlerDeps`. Event handlers will now receive only `directSyncDispatcher` (via Explorer M3-1/M3-2).
2. Retain deprecation wrappers on `triggerReplication` and `checkReplicationStatuses` with logging so pre-M5 tests (`test/backend_tests.test.js`) and any legacy UI triggers continue to respond successfully:

```javascript
  // ---------------------------------------------------------------------------
  // Replication actions (Deprecated in M3 — scheduled for removal in M5)
  // ---------------------------------------------------------------------------

  this.on('checkReplicationStatuses', async (req) => {
    console.warn('[DEPRECATED] checkReplicationStatuses called: batch replication queue is retired.');
    try {
      return await checkAndUpdateRunningReplications(cds, entities, BdcClient);
    } catch (e) {
      return req.error(500, `Failed to check replication statuses: ${e.message}`);
    }
  });

  this.on('triggerReplication', async (req) => {
    console.warn('[DEPRECATED] triggerReplication called: batch replication queue is retired.');
    const handler = makeTriggerReplicationHandler(cds, entities, BdcClient);
    return await handler(req);
  });
```

#### Component C: Complete Removal of `queueReplication` Calls from Handlers & Services
The worker executing Milestone 3 must remove every call to `queueReplication`:

| File | Lines | Current Code | Replacement in M3 |
|---|---|---|---|
| `srv/handlers/assignmentHandlers.js` | 181–182 | `if (role) await queueReplication(role.name, role.environment_ID, actorUser);` | **Remove**. Direct sync dispatched via `directSyncDispatcher.dispatchAssignmentSync(...)`. |
| `srv/handlers/assignmentHandlers.js` | 246–252 | `queueReplication(...)` on `after UPDATE` | **Remove**. Direct sync dispatched if role or target changed. |
| `srv/handlers/assignmentHandlers.js` | 275–277 | `queueReplication(`${role.name} (ASSIGNMENT DELETED)`, ...)` | **Remove**. Direct sync removal via `directSyncDispatcher.dispatchAssignmentRemoval(...)`. |
| `srv/handlers/roleHandlers.js` | 292 | `await queueReplication(targetName, environment_ID, req?.user?.id);` | **Remove**. Direct sync dispatched via `directSyncDispatcher.dispatchRoleSync(...)`. |
| `srv/handlers/roleHandlers.js` | 419–423 | `await queueReplication(afterState?.name ..., req?.user?.id);` | **Remove**. Direct sync dispatched via `directSyncDispatcher.dispatchRoleSync(...)`. |
| `srv/handlers/roleHandlers.js` | 457 | `await queueReplication(`${beforeState.name} (DELETED)`, ...);` | **Remove**. Direct sync handles role deletion. |
| `srv/handlers/restrictionHandlers.js` | 124, 185, 228 | `await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);` | **Remove**. Direct sync dispatched for affected role via `directSyncDispatcher.dispatchRoleSync(...)`. |
| `srv/services/dynamicSyncService.js` | 4, 270, 369, 463, 488 | `await queueReplication(cds, Replications, ...);` | **Remove import and all 4 calls**. Dispatch direct sync for generated roles/assignments. |

#### Component D: `srv/services/replicationQueueService.js`
Add file-level deprecation notice in Milestone 3:
```javascript
/**
 * @deprecated
 * ReplicationQueueService is DEPRECATED as of Milestone 3.
 * Asynchronous queueing and BDC task-chain polling are superseded by direct real-time API sync
 * in srv/services/directSyncDispatcher.js.
 * Retained temporarily for backward compatibility with pre-M5 test suites.
 * Scheduled for complete deletion in Milestone 5.
 */
```

---

### 4.2 Migration Bridge to Milestone 4 and Milestone 5

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ MILESTONE 3 (Current)                                                            │
│ - Sever all runtime event handlers from `queueReplication`.                      │
│ - Wire `directSyncDispatcher.js` for real-time HANA & Databricks sync.          │
│ - Annotate `Replications` and replication actions with `@deprecated`.           │
│ - Result: No new queue entries created. 100% existing tests continue to pass.   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ MILESTONE 4 (Frontend UI Cleanup)                                                │
│ - Remove `ReplicationsView.tsx` from `App.tsx` routes and navigation tabs.       │
│ - Remove `triggerReplication` and `checkReplicationStatuses` from `api.ts`.      │
│ - Hide or deprecate `canManageReplications` permissions in UI forms.             │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ MILESTONE 5 (Final Hard Deletion & Test Suite Modernization)                     │
│ - Replace `test/backend_tests.test.js` (L1069–1136) with real-time sync tests.   │
│ - Replace `test/auth_enforcement.test.js` (L144–189) with modern admin tests.    │
│ - Permanently delete `triggerReplication` and `checkReplicationStatuses` actions │
│   from `srv/cortex_service.cds` and `srv/cortex_service.js`.                     │
│ - Delete `srv/services/replicationQueueService.js`.                              │
│ - Remove replication action guard in `srv/handlers/systemHandlers.js` (L139).    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Verification Method

### 5.1 Static Verification
1. **Verification of Decoupling**: Run `grep_search` across `srv/handlers/` and `srv/services/dynamicSyncService.js` to ensure zero references to `queueReplication` remain in active event handlers:
   ```powershell
   # Expected result: No matches in srv/handlers/ or srv/services/dynamicSyncService.js
   ```
2. **Verification of CDS Annotations**: Inspect `srv/cortex_service.cds` to confirm `@deprecated` is attached to `entity Replications`, `action triggerReplication`, and `action checkReplicationStatuses`.

### 5.2 Functional Runtime Verification
1. **Queue Stagnation Test**: Create or update a Role and RoleAssignment in dev or test mode. Query `SELECT count(*) from fanrio_auth_Replications where status = 'Open'`.
   - **Pass condition**: Count remains 0 (no new rows added to queue).
2. **Pre-M5 Backward Compatibility**:
   - Run `npx cds test -w 1 test/backend_tests.test.js`:
     - Test section 10 passes successfully.
   - Run `npx cds test -w 1 test/auth_enforcement.test.js`:
     - Test passes successfully.
3. **E2E Direct Sync Validation**:
   - Run `npx cds test -w 1 test/e2e_direct_sync.test.js`:
     - Test `T1.9: Retirement of Replication Queue Engine & Actions Contract` passes cleanly.

### 5.3 Invalidation Conditions
- If any event hook (`assignmentHandlers`, `roleHandlers`, `restrictionHandlers`, `dynamicSyncService`) still calls `queueReplication`, the queue engine has NOT been retired and will continue generating orphaned records.
- If `triggerReplication` or `checkReplicationStatuses` actions are deleted in Milestone 3 before Milestone 5 test migration, `backend_tests.test.js` and `auth_enforcement.test.js` will break with 404 errors.
