# Review & Handoff Report — Reviewer M3-1 (Interface Conformance & Handlers Review)

**Milestone**: Milestone 3 — Direct Multi-Target Sync Dispatcher & Queue Retirement  
**Agent**: Reviewer M3-1 (reviewer, critic)  
**Verdict**: **APPROVE**  

---

## 1. Observation

### 1.1 Interface Conformance & Core Implementation
- **`srv/services/directSyncDispatcher.js`**:
  - Implements the central direct multi-target sync dispatcher routing authorization sync directly to SAP Datasphere (HANA) and Databricks Unity Catalog without asynchronous queueing.
  - Line 58–90: `resolveEffectivePlatforms(rolePlatformOrRole, domainPlatformOrDomain)` properly intersects role and access domain target platform configurations (`DATASPHERE`, `DATABRICKS`, `BOTH`). It also exports alias `resolveEffectivePlatform` on line 520.
  - Line 34–49: `withDomainLock(domainKey, fn)` implements a sequential Promise-chain mutex per domain key with automatic garbage collection of idle keys on completion (`domainLocks.delete(key)`), ensuring serial execution of Databricks DDL per domain while running disparate domains concurrently.
  - Line 152–280: `dispatchAssignmentSync` uses `Promise.allSettled` to isolate Datasphere and Databricks executions, preventing a failure or timeout on one platform from aborting the other.
  - Line 292–375: `dispatchAssignmentRemoval` manages assignment deletion across target platforms, with a default fallback to `'BOTH'` if the target role has already been deleted from the database (line 313), preventing orphaned grants.
  - Line 384–447: `dispatchRoleSync` re-synchronizes role assignments across configured platforms upon role or restriction modifications.
  - Line 456–484: `dispatchAccessDomainSync` provisions domain target tables in Databricks when platform includes `DATABRICKS`.
  - Line 494–515: `dispatchSync(params, deps)` exposes the universal contract matching `PROJECT.md` line 102 and Test `T1.7` (`test/e2e_direct_sync.test.js:607-657`), handling polymorphic parameter signatures (`action`, `roleId`, `userId`, `restrictions`, `targetPlatform`).

### 1.2 Elimination of Active `queueReplication` Calls
- **Grep Verification**: An exhaustive ripgrep search for `queueReplication` across `srv/` confirmed:
  - `srv/handlers/assignmentHandlers.js`: 0 calls (lines 180-191, 250-271, 313-324 rewired to `dispatcher.dispatchAssignmentSync` and `dispatcher.dispatchAssignmentRemoval`).
  - `srv/handlers/roleHandlers.js`: 0 calls (lines 295-305, 442-451, 491-500, 522-531 rewired to `dispatcher.dispatchRoleSync`).
  - `srv/handlers/restrictionHandlers.js`: 0 calls (lines 132-141, 202-211, 248-257 rewired to `dispatcher.dispatchRoleSync`).
  - `srv/services/dynamicSyncService.js`: 0 calls (all previous `queueReplication` calls on lines 272, 381, 481, 512 removed; rewired to `directSyncDispatcher` on lines 259, 364, 465).
  - `srv/cortex_service.cds`: Line 30 and lines 158–168 annotate `entity Replications`, `action triggerReplication`, and `action checkReplicationStatuses` with `@deprecated: 'Replaced by real-time direct sync'`.
  - `srv/cortex_service.js`: Lines 300–313 retain deprecated action stubs emitting structured warnings (`[DEPRECATED] checkReplicationStatuses called: batch replication queue is retired`) to maintain backward compatibility prior to M5.

### 1.3 Preservation of the Critical Replication Rule
- `srv/services/hanaReplicationService.js` and `srv/lib/resolveEffectiveRestrictions.js` were completely untouched (`git diff` showed zero modifications).
- `directSyncDispatcher.js` invokes `hanaReplicationSvc.syncAssignmentToHana` (line 202) and `syncRoleAssignmentsToHana` (line 416), guaranteeing that the recursive parent ancestry walk, descendant wildcard overriding, and Cartesian product generation remain strictly intact.

### 1.4 Non-Blocking `cds.spawn` Pattern (<2000ms Latency)
- All CRUD hooks in `assignmentHandlers.js`, `roleHandlers.js`, and `restrictionHandlers.js` trigger multi-target sync inside `cds.spawn({ user: req?.user }, async () => { ... })`.
- Each background routine contains explicit `try / catch` blocks with error logging, ensuring background network errors do not propagate uncaught or crash the process.
- HTTP handlers return immediately to the caller, guaranteeing HTTP response latencies stay well below 2000ms.

### 1.5 Test & Build Verification Commands
- `node --test test/direct_sync_dispatcher.test.js`:
  ```
  ✔ Direct Multi-Target Sync Dispatcher Suite (148.898ms)
  ℹ tests 32
  ℹ suites 0
  ℹ pass 32
  ℹ fail 0
  ```
- `node --test test/databricks_sync.test.js`:
  ```
  ✔ Databricks Unity Catalog Policy Sync & SQL Filter Generator (719.1005ms)
  ℹ tests 12
  ℹ suites 0
  ℹ pass 12
  ℹ fail 0
  ```
- `node --test test/databricks_client.test.js test/databricks_stress.test.js test/challenger_m2_1_stress.test.js test/challenger_m2_2_stress.test.js`:
  ```
  ℹ tests 77
  ℹ suites 11
  ℹ pass 77
  ℹ fail 0
  ```
- Total offline test suites verified: **121 / 121 tests pass with 0 failures**.
- `npm run build --prefix app/catalog`:
  ```
  ✓ built in 1.37s
  dist/index.html (1.45 kB)
  dist/assets/...
  exit code 0
  ```

### 1.6 Integrity Check
- Checked source files for hardcoded test responses, facades, shortcuts, and bypasses: NONE found.
- All implementations contain authentic business logic, database queries, DDL generation, mutex locking, and error handling.

---

## 2. Logic Chain

1. **Contract Conformance**:
   - `PROJECT.md` line 101 specifies `dispatchSync({ action, roleId, userId, actorUser, environmentId, isDelete })` routing to HANA for `DATASPHERE`, Databricks for `DATABRICKS`, and both for `BOTH`.
   - `directSyncDispatcher.js` matches this specification, providing both high-level domain functions (`dispatchAssignmentSync`, `dispatchAssignmentRemoval`, `dispatchRoleSync`) and universal dispatcher `dispatchSync`.
   - Test suite `test/direct_sync_dispatcher.test.js` exercises all 32 branches of this contract and passes in 148ms.
2. **Queue Retirement Completeness**:
   - The requirement R3 dictates retiring asynchronous batch queue operations.
   - All active event hooks (`RoleAssignments`, `Roles`, `Restrictions`) and batch generation (`dynamicSyncService.js`) have swapped `queueReplication` for immediate invocation of `directSyncDispatcher`.
   - Deprecated endpoints in `cortex_service.cds` and `cortex_service.js` provide safe deprecation warnings without breaking existing clients or test runners prior to Milestone 5.
3. **Replication Fidelity & Non-Regression**:
   - Datasphere replication depends on the Critical Replication Rule (Cartesian product flattening).
   - Because `directSyncDispatcher` calls `hanaReplicationService.syncAssignmentToHana` with preloaded or fetched role ancestry chains, the existing resolution algorithm is preserved without deviation.
4. **Latency Protection**:
   - Because target platforms (especially remote cloud REST APIs or SQL warehouses) can take seconds to respond, synchronous calls in HTTP handlers would violate the <2000ms latency ceiling.
   - Enclosing all dispatcher calls in `cds.spawn` offloads network I/O from the main request-response cycle, fulfilling non-blocking requirements.

---

## 3. Adversarial Challenges & Edge Case Mining

### Challenge 1: In-Memory Mutex Starvation / Key Leaks
- **Scenario**: Repeated DDL requests execute on the same domain or across thousands of distinct domain keys. Could `domainLocks` leak memory or deadlock if an execution rejects?
- **Analysis**: In `withDomainLock`, the `finally` block always resolves `release()`, unblocking any subsequent queued promise. If the queued task is the last one (`domainLocks.get(key) === next`), `domainLocks.delete(key)` purges the key from the map.
- **Verdict**: Verified leak-free and deadlock-free in Test 2.1, 2.2, and 2.3.

### Challenge 2: Role vs Domain Platform Conflicts
- **Scenario**: A role configured with `targetPlatform: 'DATASPHERE'` is placed into an Access Domain configured with `targetPlatform: 'DATABRICKS'`.
- **Analysis**: `resolveEffectivePlatforms` detects this mismatch, resolving `targetsDatasphere = false`, `targetsDatabricks = false`, and `conflict = true`. `dispatchAssignmentSync` safely skips execution without crashing.
- **Suggestion (Minor / Optional)**: In future hardening, emit a structured audit log warning when `conflict === true` so administrators are alerted that an assignment was omitted from both platforms due to configuration mismatch.

### Challenge 3: Pre-Delete vs Post-Delete Assignment Removal
- **Scenario**: What happens if an assignment is deleted, but the background thread runs after the database row is gone?
- **Analysis**: In `assignmentHandlers.js`, `RoleAssignments` hook is registered on `service.before('DELETE')`, reading `targetUserId` and `targetRoleId` *before* the record is removed from the database and passing them explicitly into `dispatchAssignmentRemoval`. Furthermore, `dispatchAssignmentRemoval` has a defensive fallback: if the role cannot be loaded from the DB, it defaults `targetPlatform` to `'BOTH'`, guaranteeing that neither platform is left with orphaned security grants.

---

## 4. Conclusion

The work product delivered by Worker M3 is complete, conforms strictly to `PROJECT.md` and Test `T1.7` interface contracts, fully retires active `queueReplication` usage across all handlers and services, strictly preserves the Critical Replication Rule, and maintains low HTTP response latency via non-blocking `cds.spawn`.

**Final Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce this verification:

1. **Direct Sync Dispatcher Tests**:
   ```powershell
   node --test test/direct_sync_dispatcher.test.js
   ```
   *Expected*: 32 tests pass, 0 fail.
2. **Databricks Policy Sync Tests**:
   ```powershell
   node --test test/databricks_sync.test.js
   ```
   *Expected*: 12 tests pass, 0 fail.
3. **Pluggable Client & Adversarial Stress Tests**:
   ```powershell
   node --test test/databricks_client.test.js test/databricks_stress.test.js test/challenger_m2_1_stress.test.js test/challenger_m2_2_stress.test.js
   ```
   *Expected*: 77 tests pass, 0 fail.
4. **Frontend Production Build**:
   ```powershell
   npm run build --prefix app/catalog
   ```
   *Expected*: Build succeeds in <2s with 0 errors.
5. **No Active `queueReplication` Calls Verification**:
   ```powershell
   git grep -n "queueReplication(" srv/handlers/ srv/services/dynamicSyncService.js
   ```
   *Expected*: 0 matches.
