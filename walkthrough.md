# Walkthrough — Codebase Architecture & Modularity Improvements

We have successfully audited the codebase and applied extensive cleanups, modularity refactoring, and dead code removal across both the React frontend and the CAP backend layers.

---

## 1. Modularity & Refactoring Applied

### Monolithic Component Decomposition (`Wizard.jsx`)
Split the 1135-line `Wizard.jsx` monolith into a clean, modular component directory under [`app/catalog/src/components/Wizard/`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/Wizard/):
1. **`index.jsx`**: Main stepper shell, rendering only navigation controls, stepper headers, overlays, and calling step sub-components.
2. **`useWizardState.js`**: Centralized custom React hook managing all 22 state variables, 8 `useEffect` lifecycles, debouncing, and API integrations. Keep presentational elements decoupled.
3. **`ImpactDialog.jsx`**: A stateless, isolated dialog component presenting the affected users and derived roles for role updates.
4. **`steps/StepOrigin.jsx`**: Step 0: origin cards, org node select, parent roles multi-select, and basic metadata.
5. **`steps/StepRestrictions.jsx`**: Step 1: Restriction builder interface.
6. **`steps/StepApprovers.jsx`**: Step 2: LDAP search auto-complete and approvers selector.
7. **`steps/StepReview.jsx`**: Step 3: Simulation runner, summary cards, direct assignment fields, and final deploy action.

### Backend Architectural Layer Alignment
* **Moved `dynamicSync.js`**: Relocated `srv/lib/dynamicSync.js` to [`srv/services/dynamicSyncService.js`](file:///c:/Users/Fan/Documents/fanrio-auth/srv/services/dynamicSyncService.js) to resolve the Layering Violation (`lib/` importing from `services/`). Adjusted requires accordingly.
* **Loosened `authGuard.js` dependency coupling**: Removed compile-time static `require('@sap/cds')` from module scope in [`srv/lib/authGuard.js`](file:///c:/Users/Fan/Documents/fanrio-auth/srv/lib/authGuard.js). It now resolves `cds` dynamically on request invocation using `global.cds`, improving testability.

---

## 2. Dead Code & Technical Debt Cleanups

* **D-01 (Dead function)**: Deleted the unused metadata XML parsing helper `_getAssetKeyColumns` in [`srv/services/bdcActionService.js`](file:///c:/Users/Fan/Documents/fanrio-auth/srv/services/bdcActionService.js).
* **D-02 (Orphan JSONs)**: Deleted unused debug artifact files `srv/last_fetched_assets.json` and `srv/last_fetched_relational_values.json`.
* **D-03 (Duplicate parsing)**: Extracted duplicate copies of `safeJsonParse` into a single, shared utility helper [`srv/lib/utils.js`](file:///c:/Users/Fan/Documents/fanrio-auth/srv/lib/utils.js).
* **D-04 / D-05 (Over-exports)**: Removed internally-scoped functions `buildHanaEntries` and `generateRoleForNode` from public `module.exports` list of their respective service files.
* **D-07 (Redundant wrappers)**: Removed `_getOAuthToken` trivial wrapper inside `bdcActionService.js` and instead called `BdcClient.getAccessToken` directly.
* **N-01 (Magic Status Strings)**: Extracted magic string statuses (`'Open'`, `'Running'`, etc.) inside [`srv/services/replicationQueueService.js`](file:///c:/Users/Fan/Documents/fanrio-auth/srv/services/replicationQueueService.js) into a centralized `REPLICATION_STATUS` constant object.

---

## 3. Naming Conventions & Tests

* **N-03 (Test Case Normalization)**: Renamed test files under `app/catalog/src/components/__tests__/` from snake_case to PascalCase component matching name style:
  - `bdc_api_tester.test.jsx` ➔ [`BdcApiTesterView.test.jsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/__tests__/BdcApiTesterView.test.jsx)
  - `audit_logs.test.jsx` ➔ [`AuditLogsView.test.jsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/__tests__/AuditLogsView.test.jsx)
  - `wizard_dialogs.test.jsx` ➔ [`WizardDialogs.test.jsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/__tests__/WizardDialogs.test.jsx)
  - `restriction_helpers.test.jsx` ➔ [`RestrictionHelpers.test.jsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/__tests__/RestrictionHelpers.test.jsx)
* **Test Mocking Fix**: Addressed missing PermissionsProvider context in wizard test suites by introducing a mock `usePermissions` hook in `WizardDialogs.test.jsx`.

---

## 4. Verification Results

All backend integration tests and Vitest component test suites pass successfully.

### Backend Tests (32/32 Passed)
```bash
▶ Comprehensive Backend Integration & Action Test Suite
...
✔ Comprehensive Backend Integration & Action Test Suite (1567.3851ms)
ℹ tests 18
ℹ pass 18
▶ DRAGE (Dynamic Role & Assignment Generation Engine) Integration Tests
...
✔ DRAGE (Dynamic Role & Assignment Generation Engine) Integration Tests (879.7177ms)
ℹ tests 5
ℹ pass 5
▶ Backend Authorization Enforcement Suite
...
✔ Backend Authorization Enforcement Suite (842.9077ms)
ℹ tests 9
ℹ pass 9
```

### Frontend Tests (21/21 Passed)
```bash
 RUN  v4.1.9 C:/Users/Fan/Documents/fanrio-auth/app/catalog

 ✓ src/components/__tests__/RestrictionHelpers.test.jsx (5 tests)
 ✓ src/components/__tests__/BdcApiTesterView.test.jsx (3 tests)
 ✓ src/components/__tests__/AuditLogsView.test.jsx (8 tests)
 ✓ src/components/__tests__/WizardDialogs.test.jsx (5 tests)

 Test Files  4 passed (4)
      Tests  21 passed (21)
```
