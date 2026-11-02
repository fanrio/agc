# Test Infrastructure & Methodology Specification (TEST_INFRA.md)
**Project**: `fanrio-auth` (Databricks & Multi-Target Direct Real-Time Sync)  
**Track**: E2E Testing Track  
**Authoritative Sources**: `ORIGINAL_REQUEST.md` (R1–R5), `PROJECT.md` (Features 1–14)  
**Execution Environment**: Node.js v24 (Native Test Runner), SAP CAP, SQLite in-memory (`CDS_ENV=test`)

---

## 1. Test Philosophy

The E2E test strategy follows an **opaque-box, requirement-driven verification model** derived directly from the authoritative user specifications in `ORIGINAL_REQUEST.md` and `PROJECT.md`:

1. **Opaque-Box Contract Verification**: Tests evaluate system behavior exclusively through exposed interface boundaries:
   - OData v4 endpoints (`/odata/v4/auth/Roles`, `RoleAssignments`, `DatabricksSettings`, actions/functions).
   - Pluggable Mock Driver/Adapter state (`DatabricksMockAdapter`, `HanaClient.mockDriver`).
   - Generated SQL DDL and boolean filter expressions in Databricks Unity Catalog format.
   - Observable side effects (AuditLogs, HANA flat tables, Databricks statement executions).
   No private implementation methods or ephemeral internal states are relied upon.
2. **Deterministic Offline Execution (R5)**: Zero external cloud dependencies. Databricks Unity Catalog and SAP HANA are simulated through in-memory pluggable mock adapters (`DatabricksClient.setAdapter(...)` and `HanaClient.setDriver(...)`). All network calls to cloud endpoints (`azuredatabricks.net`, `databricks.corp`, `datasphere`) are intercepted and resolved locally.
3. **Decoupled Real-Time Sync Validation (R1, R3)**: Direct real-time synchronization is verified immediately upon CRUD events without polling or queue inspection. The complete retirement of the batch replication queue (`Replications` entity, `triggerReplication`, `checkReplicationStatuses`) is verified by asserting that no queue records are created and retired actions return 404/Unknown action.

---

## 2. Testing Methodology

The test suite applies four complementary testing methodologies to ensure rigorous coverage:

### 2.1 Category-Partition Testing
Input domains and parameter sets are partitioned into equivalence classes:
- **Target Platform**: `DATASPHERE`, `DATABRICKS`, `BOTH`.
- **Role Types**: `SINGLE`, `DERIVED`, `ORG_BASED`.
- **Restriction Filter Types**: `SINGLE_VALUE`, `MULTI_VALUE`, `RANGE`, `BT`, `PATTERN`/`CP`, `NE`, `GT`, `GE`, `LT`, `LE`, `NULL`, `NOT NULL`.
- **Databricks Auth Types**: `TOKEN`, `SERVICE_PRINCIPAL` / `OAUTH_M2M`.
- **Operations**: `CREATE`, `UPDATE`, `DELETE`, `CASCADE_DELETE`.

### 2.2 Boundary Value Analysis (BVA)
Boundary conditions and extreme values are tested at the parameter limits:
- Empty restriction values and missing filter expressions.
- Wildcard expressions at prefix (`*val`), suffix (`val*`), and infix (`v*l`).
- Single-item arrays vs. multi-item lists in `MULTI_VALUE`.
- Range and Between limits (`from == to`, negative values, inverted bounds).
- Deep inheritance hierarchies (chain depth $\ge 3$) with conflicting or overriding restrictions.
- Invalid or missing connection credentials in `testDatabricksConnection`.

### 2.3 Pairwise Combinatorial Testing
Interaction faults between orthogonal dimensions are tested:
- Target platform on Role $\times$ Target platform on Access Domain $\times$ Role Type.
- Derived role targeting `DATABRICKS` inheriting from parent targeting `DATASPHERE` or `BOTH`.
- Multiple users assigned to the same role targeting `DATABRICKS`, verifying composite `OR` expressions across users.
- Role modifications triggering simultaneous HANA Cartesian flattening and Databricks SQL DDL updates.

### 2.4 Real-World Workload Testing (Application Scenarios)
Simulates end-to-end multi-step administrator and end-user operational workflows:
- Complete Role Lifecycle: Create Role $\to$ Define Restrictions $\to$ Assign User $\to$ Verify immediate policy push $\to$ Revoke Assignment $\to$ Verify immediate policy revocation $\to$ Delete Role.
- Security and Permission Enforcement: Verifying `canManageSettings` controls `DatabricksSettings` and `testDatabricksConnection`, while `isSuperAdmin` bypasses checks.

---

## 3. Feature Inventory Mapping (Features 1–14 across Tiers 1–4)

All 14 features defined in `PROJECT.md` are mapped across four test tiers:

| Feature # | Feature Description | Milestone | Primary Tier | Specific Test Cases in `test/e2e_direct_sync.test.js` |
|---|---|---|---|---|
| **F1** | TargetPlatform Enum & Data Model | M1 | Tier 1, Tier 2 | T1.1 (Role platform CRUD), T1.2 (AccessDomain platform CRUD), T2.5 (Invalid platform rejection) |
| **F2** | DatabricksSettings Data Model | M1 | Tier 1, Tier 2 | T1.3 (DatabricksSettings CRUD), T2.6 (Missing/invalid settings) |
| **F3** | Pluggable DatabricksClient & Mock Adapter | M1 | Tier 1, Tier 3 | T1.4 (Mock adapter registration & execution capture), T3.3 (Adapter reset & multi-statement verification) |
| **F4** | Test Databricks Connection Action | M1 | Tier 1, Tier 2 | T1.5 (testDatabricksConnection success), T2.6 (testDatabricksConnection failure handling) |
| **F5** | Databricks Unity Catalog Policy Sync Service | M2 | Tier 1, Tier 2 | T1.6 (SQL UDF Row Filter & DDL generation across filter types), T2.1–T2.4 (Filter edge cases) |
| **F6** | Effective Restriction Resolution for Databricks | M2 | Tier 2, Tier 3 | T2.7 (Hierarchy resolution & wildcard override for Databricks policies), T3.2 (Multi-level inheritance) |
| **F7** | Direct Multi-Target Sync Dispatcher | M3 | Tier 1, Tier 3 | T1.7 (Direct sync dispatching for DATASPHERE, DATABRICKS, BOTH), T3.1 (Simultaneous multi-target sync) |
| **F8** | Event Handler Direct Real-Time Wiring | M3 | Tier 1, Tier 4 | T1.8 (Assignment CREATE/DELETE triggers immediate direct sync), T4.1 (End-to-end lifecycle) |
| **F9** | Retirement of Replication Queue Engine | M3 | Tier 1, Tier 3 | T1.9 (Zero Replications records created, retired actions rejected), T3.1 (Direct sync without queue) |
| **F10** | Frontend Replication Queue UI Retirement | M4 | Tier 1 | T1.9 (API retirement contract verification) |
| **F11** | Frontend Target Platform Selection | M4 | Tier 1, Tier 3 | T1.1, T1.2, T3.1 (OData contract verification for frontend wizard/dashboard) |
| **F12** | Frontend Databricks Settings Administration | M4 | Tier 1 | T1.3, T1.5 (OData contract verification for Admin DatabricksSettingsView) |
| **F13** | Test Suite Migration & Queue Assertion Removal | M5 | Tier 1, Tier 3 | T1.9 (Queue decommission verification), T3.1 (Direct assertions) |
| **F14** | Automated Multi-Target & Databricks Sync Tests | M5 | Tier 1–4 | Complete `test/e2e_direct_sync.test.js` execution suite |

---

## 4. Tiered Test Architecture

The test suite in `test/e2e_direct_sync.test.js` is structured into four sequential tiers:

### Tier 1: Functional Feature Coverage
- **T1.1**: Roles entity supports `targetPlatform` (`DATASPHERE`, `DATABRICKS`, `BOTH`) with default `'DATASPHERE'`.
- **T1.2**: AccessDomains entity supports `targetPlatform` with default `'BOTH'`.
- **T1.3**: DatabricksSettings entity supports full CRUD and credential storage.
- **T1.4**: Pluggable `DatabricksMockAdapter` captures executed SQL statements, filter functions, and row filters.
- **T1.5**: OData action `testDatabricksConnection` validates workspace connectivity and handles error modes.
- **T1.6**: Databricks SQL filter generator translates restriction filter types (`SINGLE_VALUE`, `MULTI_VALUE`, `RANGE`, `BT`, `PATTERN`, `NE`, `GT`, `LT`, `NULL`) into valid Unity Catalog boolean predicates.
- **T1.7**: Direct sync dispatcher routes assignments to HANA for `DATASPHERE`, Databricks for `DATABRICKS`, and both for `BOTH`.
- **T1.8**: RoleAssignments CREATE and DELETE trigger real-time synchronization without blocking HTTP responses.
- **T1.9**: Verification that asynchronous queue actions (`triggerReplication`, `checkReplicationStatuses`) and queue entries are retired.

### Tier 2: Boundary & Corner Cases
- **T2.1**: Handling of empty restriction values, blank strings, and empty arrays.
- **T2.2**: Wildcard translation integrity (`*` $\to$ `%`, `?` $\to$ `_`, escaping raw SQL characters `'` and `%`).
- **T2.3**: Multi-value cardinality limits (1, 2, 50 distinct values in `IN (...)` clause).
- **T2.4**: Case sensitivity and whitespace handling in restriction values.
- **T2.5**: Schema validation rejecting invalid `targetPlatform` values.
- **T2.6**: Connection testing with missing credentials, invalid URLs, and network timeout simulation.
- **T2.7**: Role inheritance depth ($\ge 3$ levels) correctly resolving effective restrictions for Databricks.

### Tier 3: Cross-Feature Combinations
- **T3.1**: Roles targeting `BOTH` platforms dispatch to both HANA and Databricks mock adapters simultaneously.
- **T3.2**: Derived role targeting `DATABRICKS` inheriting from parent roles with differing target platforms.
- **T3.3**: Multiple distinct users assigned to the same Databricks-targeted role, verifying composite `OR` expressions and `current_user()` matching.
- **T3.4**: Concurrent assignment updates across multiple roles and environments without state collisions.

### Tier 4: Real-World Application Scenarios
- **T4.1**: Full Lifecycle Workflow:
  1. Admin creates Access Domain with targetPlatform `BOTH`.
  2. Admin configures DatabricksSettings and verifies via `testDatabricksConnection`.
  3. Admin creates single role with restrictions targeting `DATABRICKS`.
  4. Admin assigns user `alice@fanrio.com` $\to$ immediate policy creation in Databricks mock.
  5. Admin assigns user `bob@fanrio.com` $\to$ immediate policy update in Databricks mock.
  6. Admin revokes `alice@fanrio.com` assignment $\to$ immediate policy removal in Databricks mock.
  7. Admin deletes role $\to$ immediate cleanup of Unity Catalog filter functions.
- **T4.2**: Security and Permissions Enforcement:
  - Unauthorized user without `canManageSettings` cannot read or modify `DatabricksSettings`.
  - Non-approver / non-admin cannot assign Databricks roles without `canAssignRoles`.

---

## 5. Test Runner Invocations

### Primary E2E Test Runner Command
```powershell
$env:CDS_ENV="test"; node --test --test-concurrency=1 test/e2e_direct_sync.test.js
```

### Full Backend Suite Invocation (All Suites Sequential)
```powershell
$env:CDS_ENV="test"; node --test --test-concurrency=1 test/e2e_direct_sync.test.js test/backend_tests.test.js test/auth_enforcement.test.js test/dynamic_generation.test.js
```

### Frontend Production Build Verification
```powershell
npm run build --prefix app/catalog
```
