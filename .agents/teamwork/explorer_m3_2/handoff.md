# Milestone 3 Explorer Report: Handlers & DRAGE Engine Direct Sync Wiring

- **Agent**: Explorer M3-2 (Handlers & DRAGE Engine Wiring)
- **Role**: Read-only Investigation, Synthesis, Architectural Design
- **Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m3_2`
- **Target Modules**:
  - `srv/handlers/assignmentHandlers.js`
  - `srv/handlers/roleHandlers.js`
  - `srv/handlers/restrictionHandlers.js`
  - `srv/services/dynamicSyncService.js`
  - `srv/cortex_service.js` (wiring layer)
- **Date**: 2026-11-02
- **Milestone**: Milestone 3 (Direct Real-Time Multi-Target Sync & Queue Retirement)

---

## Executive Summary
This report specifies the complete refactoring of event hooks and the DRAGE reconciliation engine to replace all legacy replication queue (`queueReplication`) and single-target HANA replication (`syncAssignmentToHana` / `syncRoleAssignmentsToHana`) calls with real-time multi-target dispatching via `srv/services/directSyncDispatcher.js`. All HTTP event hooks execute direct sync inside non-blocking `cds.spawn({ user: req?.user })` contexts, ensuring HTTP response times well under 2000ms while guaranteeing dual-platform synchronization to SAP Datasphere and Databricks Unity Catalog.

---

## 1. Observation

Direct code and schema inspections conducted across the workspace:

### 1.1 `srv/handlers/assignmentHandlers.js`
- **Lines 16–23**: Dependency injection signature:
  ```javascript
  function registerAssignmentHandlers(service, entities, deps) {
    const { cds, queueReplication, syncAssignmentToHana, resolveEffectiveRestrictions } = deps;
    const { Roles, Restrictions, RoleInheritance, RoleAssignments, AuditLogs, RoleApprovers, AppAuthorizations } = entities;
  ```
- **Lines 177–187 (`after CREATE RoleAssignments`)**:
  ```javascript
  // Run HANA sync and queue replication in background to prevent blocking HTTP thread
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
- **Lines 245–252 (`after UPDATE RoleAssignments`)**:
  ```javascript
  if (afterState) {
    const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: afterState.role_ID }));
    if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);
  }
  if (beforeState && beforeState.role_ID !== afterState?.role_ID) {
    const oldRole = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
    if (oldRole) await queueReplication(oldRole.name, oldRole.environment_ID, req?.user?.id);
  }
  ```
  *Observation*: On UPDATE, replication was merely queued; direct HANA or Databricks synchronization was entirely omitted.
- **Lines 261–304 (`before DELETE RoleAssignments`)**:
  ```javascript
  const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
  if (role) {
    await queueReplication(`${role.name} (ASSIGNMENT DELETED)`, role.environment_ID, req?.user?.id);
  }
  ...
  // Pass targetUserId and targetRoleId to clean access-domain-specific custom tables in background
  cds.spawn({ user: req?.user }, async () => {
    try {
      await syncAssignmentToHana(id, targetUserId, targetRoleId, true);
    } catch (err) {
      console.error('[AssignmentHandlers] Background HANA sync failed for RoleAssignments DELETE:', err.message);
    }
  });
  ```

### 1.2 `srv/handlers/roleHandlers.js`
- **Lines 27–31**: Dependency injection signature:
  ```javascript
  function registerRoleHandlers(service, entities, deps) {
    const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
    const { Roles, RoleAssignments, RoleInheritance, Restrictions, AuditLogs, AppAuthorizations } = entities;
  ```
- **Lines 292 (`after CREATE Roles`)**:
  ```javascript
  await queueReplication(targetName, environment_ID, req?.user?.id);
  ```
- **Lines 419–435 (`after UPDATE Roles`)**:
  ```javascript
  await queueReplication(
    afterState?.name || beforeState?.name || 'Unknown Role',
    afterState?.environment_ID || beforeState?.environment_ID || 'D',
    req?.user?.id
  );
  ...
  // Run HANA re-sync in background to prevent blocking HTTP request thread
  cds.spawn({ user: req?.user }, async () => {
    try {
      await syncRoleAssignmentsToHana(id);
    } catch (err) {
      console.error('[RoleHandlers] Background HANA sync failed for Roles UPDATE:', err.message);
    }
  });
  ```
- **Line 457 (`before DELETE Roles`)**:
  ```javascript
  await queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);
  ```
- **Lines 472–511 (`RoleInheritance` CREATE and DELETE)**:
  ```javascript
  service.after('CREATE', 'RoleInheritance', async (inheritance, req) => {
    const roleId = inheritance.role_ID || req.data?.role_ID;
    if (roleId) {
      cds.spawn({ user: req?.user }, async () => {
        try {
          await syncRoleAssignmentsToHana(roleId);
        } catch (err) {
          console.error('[RoleHandlers] Background HANA sync failed for RoleInheritance CREATE:', err.message);
        }
      });
    }
  });

  service.before('DELETE', 'RoleInheritance', async (req) => {
    ...
    req.context.roleIdToSync = beforeState.role_ID;
  });

  service.after('DELETE', 'RoleInheritance', async (res, req) => {
    const roleId = req.context?.roleIdToSync;
    if (roleId) {
      cds.spawn({ user: req?.user }, async () => {
        try {
          await syncRoleAssignmentsToHana(roleId);
        } catch (err) {
          console.error('[RoleHandlers] Background HANA sync failed for RoleInheritance DELETE:', err.message);
        }
      });
    }
  });
  ```
  *Observation*: Role inheritance changes triggered HANA sync, but Databricks policy recalculation was missing.

### 1.3 `srv/handlers/restrictionHandlers.js`
- **Lines 17–21**: Dependency injection signature:
  ```javascript
  function registerRestrictionHandlers(service, entities, deps) {
    const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;
    const { Roles, Restrictions, AuditLogs, AppAuthorizations } = entities;
  ```
- **Lines 124, 130 (`after CREATE Restrictions`)**:
  ```javascript
  await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
  ...
  // Run HANA re-sync synchronously (lets errors propagate to frontend)
  await syncRoleAssignmentsToHana(roleId);
  ```
  *Observation*: On CREATE, `syncRoleAssignmentsToHana` was executed **synchronously** in the HTTP thread, creating latency and blocking the request.
- **Lines 185, 191–197 (`after UPDATE Restrictions`)**:
  ```javascript
  await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
  ...
  cds.spawn({ user: req?.user }, async () => {
    try {
      await syncRoleAssignmentsToHana(beforeState.role_ID);
    } catch (err) {
      console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions UPDATE:', err.message);
    }
  });
  ```
- **Lines 228, 234–240 (`before DELETE Restrictions`)**:
  ```javascript
  await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
  ...
  cds.spawn({ user: req?.user }, async () => {
    try {
      await syncRoleAssignmentsToHana(beforeState.role_ID);
    } catch (err) {
      console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions DELETE:', err.message);
    }
  });
  ```

### 1.4 `srv/services/dynamicSyncService.js` (DRAGE)
- **Lines 3–4**:
  ```javascript
  const { syncAssignmentToHana } = require('./hanaReplicationService');
  const { queueReplication } = require('./replicationQueueService');
  ```
- **Lines 258–271 (`_syncConsolidatedUserRole`)**:
  ```javascript
  await syncAssignmentToHana(
    cds,
    HanaClient,
    { Roles, Restrictions, RoleInheritance, BdcSettings },
    assignmentId,
    userId,
    roleId,
    false,
    preloaded
  );
  await queueReplication(cds, Replications, roleName, envId, 'SYSTEM_DYN');
  ```
- **Lines 355–371 (`_syncTemplateAssignment`)**:
  ```javascript
  await syncAssignmentToHana(
    cds,
    HanaClient,
    { Roles, Restrictions, RoleInheritance, BdcSettings },
    assignmentId,
    userId,
    rule.templateRole_ID,
    false,
    preloaded
  );
  const templateRole = preloaded.allRoles.find(r => r.ID === rule.templateRole_ID);
  if (templateRole) {
    await queueReplication(cds, Replications, templateRole.name, templateRole.environment_ID || envId, 'SYSTEM_DYN');
  }
  ```
- **Lines 448–465 & 487–490 (`_removeGeneratedAccess`)**:
  ```javascript
  await syncAssignmentToHana(
    cds,
    HanaClient,
    { Roles, Restrictions, RoleInheritance, BdcSettings },
    mapping.generatedAssignment_ID,
    mapping.userId,
    assignment.role_ID,
    true,
    preloaded
  );
  ...
  await queueReplication(cds, Replications, role.name, role.environment_ID || envId, 'SYSTEM_DYN');
  ...
  await queueReplication(cds, Replications, `${role.name} (DELETED)`, role.environment_ID || envId, 'SYSTEM_DYN');
  ```
  *Observation*: DRAGE operates directly via `db.run(INSERT/DELETE)` which bypasses CAP application service event hooks (`service.before/after`). Therefore, DRAGE must explicitly dispatch multi-target synchronization for all generated and revoked assignments.

### 1.5 Explorer M3-1 Dispatcher Contract (`directSyncDispatcher.js`)
As established in `explorer_m3_1/handoff.md`:
1. `dispatchAssignmentSync({ assignmentId, userId, roleId, actorUser, environmentId }, deps)`:
   - Resolves effective platforms by intersecting role and domain `targetPlatform`.
   - Executes `syncAssignmentToHana` (Datasphere) and `syncAssignmentToDatabricks` (Databricks) in parallel via `Promise.allSettled`.
2. `dispatchAssignmentRemoval({ assignmentId, userId, roleId, actorUser, environmentId, targetPlatform }, deps)`:
   - Executes `syncAssignmentToHana(..., isDelete=true)` (Datasphere) and `removeAssignmentFromDatabricks` (Databricks) in parallel.
3. `dispatchRoleSync(paramsOrRoleId, deps)`:
   - Recursively synchronizes all assignments of a role and its derived descendants to Datasphere (`syncRoleAssignmentsToHana`) and Databricks (`syncRoleToDatabricks`).
4. `dispatchSync(params, deps)`: Universal dispatching router.

---

## 2. Logic Chain

1. **Decoupling from Batch Replication Queue**:
   - Observations 1.1–1.4 show 12 explicit calls to `queueReplication` across `assignmentHandlers.js`, `roleHandlers.js`, `restrictionHandlers.js`, and `dynamicSyncService.js`.
   - Per Requirement R1 and R3, direct synchronization must be executed in real-time without writing to the `Replications` queue entity or waiting for external BDC task chains.
   - Therefore, all 12 `queueReplication` invocations must be permanently removed.

2. **Multi-Target Routing via `directSyncDispatcher`**:
   - In existing code, handlers only call `syncAssignmentToHana` or `syncRoleAssignmentsToHana`. Databricks Unity Catalog is never triggered upon assignment, role, or restriction CRUD.
   - By delegating to `directSyncDispatcher`, changes are routed to Datasphere, Databricks, or both based on `targetPlatform`, fulfilling Requirement R1 and R2.
   - The Critical Replication Rule for SAP HANA (Cartesian product flattening and ancestry walk in `hanaReplicationService.js`) is 100% preserved because `directSyncDispatcher` routes Datasphere requests directly to `hanaReplicationService`.

3. **Safe Non-Blocking Background Contexts (`cds.spawn`)**:
   - Making external synchronous REST or DDL calls across Databricks and HANA inside CAP HTTP request handlers blocks the event loop and risks exceeding HTTP client timeouts.
   - Test T1.8 (`test/e2e_direct_sync.test.js:695`) explicitly asserts that `RoleAssignments` CREATE must complete with `elapsed < 2000ms`.
   - In `restrictionHandlers.js` (Observation 1.3), `syncRoleAssignmentsToHana` was previously run synchronously. Moving it to `cds.spawn` eliminates this blocking bottleneck.
   - In all handlers, `cds.spawn({ user: req?.user }, async () => { ... })` must wrap every dispatch call. Primitive parameters (`roleId`, `assignmentId`, `userId`, `actorUser`) must be extracted synchronously before spawning to prevent race conditions or context recycling.
   - Every spawned task must have an enclosing `try / catch` block to prevent unhandled promise rejections from terminating the Node process.

4. **Capturing Deletion State**:
   - For `RoleAssignments` DELETE and `RoleInheritance` DELETE, once the record is deleted from SQLite, its `userId` and `role_ID` are no longer queryable.
   - Therefore, `before DELETE` hooks must capture the record from the database and preserve it (either in local variables or on `req.context`).
   - The background dispatch must receive these pre-captured identifiers to cleanly clean up HANA flat tables and Databricks row filter functions.

5. **DRAGE Engine Independence**:
   - DRAGE uses low-level `db.run(INSERT/DELETE)` statements for bulk performance, intentionally bypassing CAP service hooks.
   - Consequently, `dynamicSyncService.js` must directly import `directSyncDispatcher` and invoke `dispatchAssignmentSync` and `dispatchAssignmentRemoval` for all generated and revoked assignments.

---

## 3. Caveats

1. **Preloaded Cache in DRAGE Engine**:
   - `dynamicSyncService.js` constructs an in-memory `preloaded` object (`{ allRoles, allRestrictions, allInheritances }`) to avoid N×3 full-table scans.
   - `directSyncDispatcher.dispatchAssignmentSync` and `dispatchAssignmentRemoval` should accept `deps.preloaded` or pass through options to `syncAssignmentToHana` so this performance optimization remains effective.
2. **Cascading Role Deletion**:
   - In `roleHandlers.js`, `processCascadingRoleDelete` calls `service.run(DELETE.from(RoleAssignments))`. This triggers the `RoleAssignments` `DELETE` event handlers, which will spawn `dispatchAssignmentRemoval` for every cascadingly deleted assignment.
   - If a role is deleted without assignments, Databricks and HANA require no assignment row removals; any access domain row filter updates will be triggered if remaining assignments in the domain change.
3. **Demo Mode / Inactive Connections**:
   - In dev/test environments without live Databricks credentials or HANA connections, `DatabricksMockAdapter` and `mockHana` are used. Dispatches will resolve with `{ skipped: true }` or mock executions without errors.
4. **OData Action Deprecations in Cortex Service**:
   - The queue actions (`triggerReplication`, `checkReplicationStatuses`) are being decommissioned by Explorer M3-3 in `srv/cortex_service.cds` and `srv/cortex_service.js`. Handlers must have zero dependencies on these actions.

---

## 4. Conclusion & Concrete Implementation Specifications

### 4.1 `srv/handlers/assignmentHandlers.js`

#### Dependency Injection
Replace `queueReplication` and `syncAssignmentToHana` with `directSyncDispatcher`:
```javascript
// Before:
function registerAssignmentHandlers(service, entities, deps) {
  const { cds, queueReplication, syncAssignmentToHana, resolveEffectiveRestrictions } = deps;

// After:
const defaultDispatcher = require('../services/directSyncDispatcher');

function registerAssignmentHandlers(service, entities, deps = {}) {
  const { cds, resolveEffectiveRestrictions } = deps;
  const dispatcher = deps.directSyncDispatcher || defaultDispatcher;
  const { Roles, Restrictions, RoleInheritance, RoleAssignments, AuditLogs, RoleApprovers, AppAuthorizations } = entities;
```

#### `after CREATE RoleAssignments`
```javascript
// Before:
cds.spawn({ user: req?.user }, async () => {
  try {
    await syncAssignmentToHana(assignmentId, userId, roleId, false);
    const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: roleId }));
    if (role) await queueReplication(role.name, role.environment_ID, actorUser);
  } catch (err) {
    console.error('[AssignmentHandlers] Background sync/replication failed for RoleAssignments CREATE:', err.message);
  }
});

// After:
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchAssignmentSync({
      assignmentId,
      userId,
      roleId,
      actorUser
    });
  } catch (err) {
    console.error('[AssignmentHandlers] Background direct sync failed for RoleAssignments CREATE:', err.message);
  }
});
```

#### `after UPDATE RoleAssignments`
Remove all `queueReplication` calls. If role assignment changed, dispatch removal for old role and sync for new role:
```javascript
// Before:
if (afterState) {
  const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: afterState.role_ID }));
  if (role) await queueReplication(role.name, role.environment_ID, req?.user?.id);
}
if (beforeState && beforeState.role_ID !== afterState?.role_ID) {
  const oldRole = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
  if (oldRole) await queueReplication(oldRole.name, oldRole.environment_ID, req?.user?.id);
}

// After:
cds.spawn({ user: req?.user }, async () => {
  try {
    if (beforeState && beforeState.role_ID && beforeState.role_ID !== afterState?.role_ID) {
      await dispatcher.dispatchAssignmentRemoval({
        assignmentId: id,
        userId: beforeState.userId,
        roleId: beforeState.role_ID,
        actorUser: getUserId(req)
      });
    }
    if (afterState) {
      await dispatcher.dispatchAssignmentSync({
        assignmentId: id,
        userId: afterState.userId,
        roleId: afterState.role_ID,
        actorUser: getUserId(req)
      });
    }
  } catch (err) {
    console.error('[AssignmentHandlers] Background direct sync failed for RoleAssignments UPDATE:', err.message);
  }
});
```

#### `before DELETE RoleAssignments`
Capture deletion parameters, write audit log, remove `queueReplication`, and dispatch removal inside `cds.spawn`:
```javascript
// Before:
const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
if (role) {
  await queueReplication(`${role.name} (ASSIGNMENT DELETED)`, role.environment_ID, req?.user?.id);
}
...
cds.spawn({ user: req?.user }, async () => {
  try {
    await syncAssignmentToHana(id, targetUserId, targetRoleId, true);
  } catch (err) {
    console.error('[AssignmentHandlers] Background HANA sync failed for RoleAssignments DELETE:', err.message);
  }
});

// After:
// (Audit log remains intact without queueReplication)
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchAssignmentRemoval({
      assignmentId: id,
      userId: targetUserId,
      roleId: targetRoleId,
      actorUser: getUserId(req)
    });
  } catch (err) {
    console.error('[AssignmentHandlers] Background direct sync failed for RoleAssignments DELETE:', err.message);
  }
});
```

---

### 4.2 `srv/handlers/roleHandlers.js`

#### Dependency Injection
```javascript
// Before:
function registerRoleHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;

// After:
const defaultDispatcher = require('../services/directSyncDispatcher');

function registerRoleHandlers(service, entities, deps = {}) {
  const { cds } = deps;
  const dispatcher = deps.directSyncDispatcher || defaultDispatcher;
  const { Roles, RoleAssignments, RoleInheritance, Restrictions, AuditLogs, AppAuthorizations } = entities;
```

#### `after CREATE Roles`
Remove `queueReplication`. If deep-created with assignments, dispatch role sync in background:
```javascript
// Before:
await queueReplication(targetName, environment_ID, req?.user?.id);

// After:
if (Array.isArray(req.data?.assignments) && req.data.assignments.length > 0) {
  const recordId = role?.ID || req.data?.ID;
  cds.spawn({ user: req?.user }, async () => {
    try {
      await dispatcher.dispatchRoleSync({
        roleId: recordId,
        actorUser: req?.user?.id
      });
    } catch (err) {
      console.error('[RoleHandlers] Background direct sync failed for Roles CREATE with assignments:', err.message);
    }
  });
}
```

#### `after UPDATE Roles`
Remove `queueReplication` and replace `syncRoleAssignmentsToHana` with `dispatchRoleSync`:
```javascript
// Before:
await queueReplication(
  afterState?.name || beforeState?.name || 'Unknown Role',
  afterState?.environment_ID || beforeState?.environment_ID || 'D',
  req?.user?.id
);
...
cds.spawn({ user: req?.user }, async () => {
  try {
    await syncRoleAssignmentsToHana(id);
  } catch (err) {
    console.error('[RoleHandlers] Background HANA sync failed for Roles UPDATE:', err.message);
  }
});

// After:
// (Audit log remains intact)
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchRoleSync({
      roleId: id,
      actorUser: getUserId(req) || req?.user?.id
    });
  } catch (err) {
    console.error('[RoleHandlers] Background direct sync failed for Roles UPDATE:', err.message);
  }
});
```

#### `before DELETE Roles`
Remove `queueReplication`:
```javascript
// Before:
await queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);

// After:
// (Line deleted; cascading deletion handles assignment removals via RoleAssignments DELETE hooks)
```

#### `RoleInheritance` Handlers
Update both `CREATE` and `DELETE` hooks to trigger multi-target `dispatchRoleSync`:
```javascript
// CREATE Hook:
service.after('CREATE', 'RoleInheritance', async (inheritance, req) => {
  const roleId = inheritance.role_ID || req.data?.role_ID;
  if (roleId) {
    cds.spawn({ user: req?.user }, async () => {
      try {
        await dispatcher.dispatchRoleSync({
          roleId,
          actorUser: getUserId(req) || req?.user?.id
        });
      } catch (err) {
        console.error('[RoleHandlers] Background direct sync failed for RoleInheritance CREATE:', err.message);
      }
    });
  }
});

// DELETE Hooks:
service.before('DELETE', 'RoleInheritance', async (req) => {
  const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
  if (id) {
    try {
      const beforeState = await cds.db.run(SELECT.one.from(RoleInheritance).where({ ID: id }));
      if (beforeState?.role_ID) {
        req.context = req.context || {};
        req.context.roleIdToSync = beforeState.role_ID;
      }
    } catch (err) {
      console.error('[RoleHandlers] Before-state capture for RoleInheritance DELETE failed:', err.message);
    }
  }
});

service.after('DELETE', 'RoleInheritance', async (res, req) => {
  const roleId = req.context?.roleIdToSync;
  if (roleId) {
    cds.spawn({ user: req?.user }, async () => {
      try {
        await dispatcher.dispatchRoleSync({
          roleId,
          actorUser: getUserId(req) || req?.user?.id
        });
      } catch (err) {
        console.error('[RoleHandlers] Background direct sync failed for RoleInheritance DELETE:', err.message);
      }
    });
  }
});
```

---

### 4.3 `srv/handlers/restrictionHandlers.js`

#### Dependency Injection
```javascript
// Before:
function registerRestrictionHandlers(service, entities, deps) {
  const { cds, queueReplication, syncRoleAssignmentsToHana } = deps;

// After:
const defaultDispatcher = require('../services/directSyncDispatcher');

function registerRestrictionHandlers(service, entities, deps = {}) {
  const { cds } = deps;
  const dispatcher = deps.directSyncDispatcher || defaultDispatcher;
  const { Roles, Restrictions, AuditLogs, AppAuthorizations } = entities;
```

#### `after CREATE Restrictions`
Remove `queueReplication` and make `dispatchRoleSync` non-blocking in `cds.spawn`:
```javascript
// Before:
await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
...
// Run HANA re-sync synchronously (lets errors propagate to frontend)
await syncRoleAssignmentsToHana(roleId);

// After:
// (Audit log remains intact)
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchRoleSync({
      roleId,
      actorUser: getUserId(req) || req?.user?.id
    });
  } catch (err) {
    console.error('[RestrictionHandlers] Background direct sync failed for Restrictions CREATE:', err.message);
  }
});
```

#### `after UPDATE Restrictions`
Remove `queueReplication` and replace `syncRoleAssignmentsToHana`:
```javascript
// Before:
await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
...
cds.spawn({ user: req?.user }, async () => {
  try {
    await syncRoleAssignmentsToHana(beforeState.role_ID);
  } catch (err) {
    console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions UPDATE:', err.message);
  }
});

// After:
// (Audit log remains intact)
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchRoleSync({
      roleId: beforeState.role_ID,
      actorUser: getUserId(req) || req?.user?.id
    });
  } catch (err) {
    console.error('[RestrictionHandlers] Background direct sync failed for Restrictions UPDATE:', err.message);
  }
});
```

#### `before DELETE Restrictions`
Remove `queueReplication` and replace `syncRoleAssignmentsToHana`:
```javascript
// Before:
await queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
...
cds.spawn({ user: req?.user }, async () => {
  try {
    await syncRoleAssignmentsToHana(beforeState.role_ID);
  } catch (err) {
    console.error('[RestrictionHandlers] Background HANA sync failed for Restrictions DELETE:', err.message);
  }
});

// After:
// (Audit log remains intact)
cds.spawn({ user: req?.user }, async () => {
  try {
    await dispatcher.dispatchRoleSync({
      roleId: beforeState.role_ID,
      actorUser: getUserId(req) || req?.user?.id
    });
  } catch (err) {
    console.error('[RestrictionHandlers] Background direct sync failed for Restrictions DELETE:', err.message);
  }
});
```

---

### 4.4 `srv/services/dynamicSyncService.js` (DRAGE Engine)

#### Imports
```javascript
// Before:
const { syncAssignmentToHana } = require('./hanaReplicationService');
const { queueReplication } = require('./replicationQueueService');

// After:
const directSyncDispatcher = require('./directSyncDispatcher');
```

#### `_syncConsolidatedUserRole`
```javascript
// Before:
await syncAssignmentToHana(
  cds,
  HanaClient,
  { Roles, Restrictions, RoleInheritance, BdcSettings },
  assignmentId,
  userId,
  roleId,
  false,
  preloaded
);
await queueReplication(cds, Replications, roleName, envId, 'SYSTEM_DYN');

// After:
await directSyncDispatcher.dispatchAssignmentSync({
  assignmentId,
  userId,
  roleId,
  actorUser: 'SYSTEM_DYN',
  environmentId: envId
}, { cds, HanaClient, entities: { Roles, Restrictions, RoleInheritance, BdcSettings }, preloaded });
```

#### `_syncTemplateAssignment`
```javascript
// Before:
await syncAssignmentToHana(
  cds,
  HanaClient,
  { Roles, Restrictions, RoleInheritance, BdcSettings },
  assignmentId,
  userId,
  rule.templateRole_ID,
  false,
  preloaded
);
const templateRole = preloaded.allRoles.find(r => r.ID === rule.templateRole_ID);
if (templateRole) {
  await queueReplication(cds, Replications, templateRole.name, templateRole.environment_ID || envId, 'SYSTEM_DYN');
}

// After:
await directSyncDispatcher.dispatchAssignmentSync({
  assignmentId,
  userId,
  roleId: rule.templateRole_ID,
  actorUser: 'SYSTEM_DYN',
  environmentId: envId
}, { cds, HanaClient, entities: { Roles, Restrictions, RoleInheritance, BdcSettings }, preloaded });
```

#### `_removeGeneratedAccess`
```javascript
// Before:
await syncAssignmentToHana(
  cds,
  HanaClient,
  { Roles, Restrictions, RoleInheritance, BdcSettings },
  mapping.generatedAssignment_ID,
  mapping.userId,
  assignment.role_ID,
  true,
  preloaded
);
const role = preloaded.allRoles.find(r => r.ID === assignment.role_ID)
  || await db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
if (role) {
  await queueReplication(cds, Replications, role.name, role.environment_ID || envId, 'SYSTEM_DYN');
}
...
if (role) {
  await queueReplication(cds, Replications, `${role.name} (DELETED)`, role.environment_ID || envId, 'SYSTEM_DYN');
}

// After:
await directSyncDispatcher.dispatchAssignmentRemoval({
  assignmentId: mapping.generatedAssignment_ID,
  userId: mapping.userId,
  roleId: assignment.role_ID,
  actorUser: 'SYSTEM_DYN',
  environmentId: envId
}, { cds, HanaClient, entities: { Roles, Restrictions, RoleInheritance, BdcSettings }, preloaded });
// (queueReplication calls deleted)
```

---

### 4.5 `srv/cortex_service.js` (Wiring Layer)

```javascript
// Before:
const { syncAssignmentToHana, syncRoleAssignmentsToHana } = require('./services/hanaReplicationService');
const { queueReplication, checkAndUpdateRunningReplications, makeTriggerReplicationHandler } = require('./services/replicationQueueService');
...
const handlerDeps = {
  cds,
  queueReplication: boundQueueReplication,
  syncAssignmentToHana: boundSyncAssignment,
  syncRoleAssignmentsToHana: boundSyncRoleAssignments,
  resolveEffectiveRestrictions
};

// After:
const directSyncDispatcher = require('./services/directSyncDispatcher');
...
const handlerDeps = {
  cds,
  directSyncDispatcher,
  resolveEffectiveRestrictions
};
```

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Direct Multi-Target Sync Unit & E2E Tests**:
   ```bash
   node --test test/e2e_direct_sync.test.js
   ```
   *Success Condition*:
   - Test T1.7 passes: Multi-target routing dispatches to DATASPHERE, DATABRICKS, and BOTH.
   - Test T1.8 passes: RoleAssignments CREATE/DELETE triggers direct sync without blocking (elapsed < 2000ms).
   - Test T1.9 passes: Retirement of replication queue engine actions contract.

2. **Databricks Unit & Policy Sync Tests**:
   ```bash
   node --test test/databricks_client.test.js
   node --test test/databricks_sync.test.js
   ```
   *Success Condition*: All 36 tests pass with 0 failures.

3. **DRAGE Engine Tests**:
   ```bash
   node --test test/dynamic_generation.test.js
   ```
   *Success Condition*: Customer lifecycle triggers dynamic role creation, updates, and cleanup without errors.

4. **Queue Decommissioning Code Audit**:
   ```bash
   # In PowerShell, verify 0 occurrences of queueReplication in handlers & dynamicSyncService:
   rg "queueReplication" srv/handlers/ srv/services/dynamicSyncService.js
   ```
   *Success Condition*: Empty search result (0 occurrences).

### 5.2 Invalidation Conditions
- Any occurrence of `queueReplication` remaining in `srv/handlers/` or `srv/services/dynamicSyncService.js`.
- Any modification to `srv/services/hanaReplicationService.js` that alters Cartesian product generation (`cartesianProduct`, `buildFlatAuthorizationsForHana`) or ancestry walk (`fetchRoleAncestryChain`).
- Synchronous blocking network calls in `assignmentHandlers.js`, `roleHandlers.js`, or `restrictionHandlers.js` causing HTTP request latency to exceed 2000ms.
- Unhandled promise rejections inside `cds.spawn` callbacks causing process termination.
