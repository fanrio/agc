# Handoff Report: Frontend API Client, Navigation Shell & Replication Queue Cleanup

**Agent**: Explorer M4-1  
**Milestone**: Milestone 4 (Frontend UI Platform Selection & Admin Settings)  
**Date**: 2026-11-02  
**Target Recipient**: Worker M4 / Parent Orchestrator  

---

## 1. Observation

### 1.1 Project Source File Extensions (Task 4)
- Direct inspection of `app/catalog/src/` confirms that **all frontend source files are TypeScript (`.ts` / `.tsx`)**:
  - Root: `app/catalog/src/api.ts`, `app/catalog/src/App.tsx`, `app/catalog/src/main.tsx`, `app/catalog/src/theme.ts`
  - Components: `app/catalog/src/components/*.tsx` (all 23 view and component files use `.tsx`)
  - Context: `app/catalog/src/context/PermissionsContext.tsx`
  - Tests: `app/catalog/src/components/__tests__/*.test.tsx`
- *Note*: `AGENTS.md` mentions `.js` / `.jsx` in historical references, but the codebase is fully migrated to TypeScript (`.ts` / `.tsx`). All new files (e.g. `DatabricksSettingsView.tsx`) must be `.tsx`.

### 1.2 Obsolete Replication Queue Functions in `api.ts` (Task 1)
In `app/catalog/src/api.ts` (lines 226–230):
```typescript
// Replications
export const getReplications = () => request('GET', '/Replications?$orderby=replicationDate desc');
export const triggerReplication = () => request('POST', '/triggerReplication', {});
export const checkReplicationStatuses = () => request('POST', '/checkReplicationStatuses', {});
```
- Across `app/catalog/src/`, `getReplications`, `triggerReplication`, and `checkReplicationStatuses` are **only** consumed inside `app/catalog/src/components/ReplicationsView.tsx` (lines 43, 60, 78).
- No other frontend views, components, or utilities call these three endpoints.

### 1.3 Backend Databricks Settings Contracts & OData Interface
Inspected backend CDS and implementation files:
- `db/schema.cds` (lines 142–154):
  ```cds
  entity DatabricksSettings : cuid, managed {
    systemName     : String(100) not null;
    environment    : Association to Environments;
    workspaceUrl   : String(255);
    authType       : String(20) enum { TOKEN; SERVICE_PRINCIPAL; } default 'TOKEN';
    apiToken       : String(500);
    clientId       : String(100);
    clientSecret   : String(500);
    targetCatalog  : String(100);
    targetSchema   : String(100);
    sqlWarehouseId : String(100);
    isActive       : Boolean default true;
  }
  ```
- `srv/cortex_service.cds` (line 37 & lines 107–111):
  ```cds
  entity DatabricksSettings     as projection on db.DatabricksSettings;
  ...
  action testDatabricksConnection(settingId: UUID) returns {
    success    : Boolean;
    message    : String;
    httpStatus : Integer;
  };
  ```
- `srv/handlers/systemHandlers.js` (lines 10–32 & 34–43):
  - CRUD on `DatabricksSettings` requires `canManageSettings` permission.
  - On `READ`, sensitive fields `apiToken` and `clientSecret` are stripped for security.
- `srv/cortex_service.js` (lines 212–230):
  - `testDatabricksConnection` action handler validates `settingId`, loads the setting, checks workspaceUrl, tests connection credentials (TOKEN or SERVICE_PRINCIPAL), and returns `{ success: boolean, message: string, httpStatus: number }`.
- Verified in backend tests (`test/backend_tests.test.js:652–700` and `test/auth_enforcement.test.js:849`):
  - Read: `GET /odata/v4/auth/DatabricksSettings?$expand=environment`
  - Read single: `GET /odata/v4/auth/DatabricksSettings(ID=...)`
  - Create: `POST /odata/v4/auth/DatabricksSettings` with JSON body
  - Update: `PATCH /odata/v4/auth/DatabricksSettings(ID=...)` or `PATCH /odata/v4/auth/DatabricksSettings('${id}')`
  - Delete: `DELETE /odata/v4/auth/DatabricksSettings(ID=...)` or `DELETE /odata/v4/auth/DatabricksSettings('${id}')`
  - Test connection: `POST /odata/v4/auth/testDatabricksConnection` with body `{ settingId: '...' }`

### 1.4 `ReplicationsView` References in `App.tsx` (Task 2)
In `app/catalog/src/App.tsx`:
1. Line 46:
   ```typescript
   const ReplicationsView = lazy(() => import('./components/ReplicationsView'));
   ```
2. Line 69:
   ```typescript
   const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard', 'replications'];
   ```
3. Line 143:
   ```typescript
   if (item.id === 'replications') return !!permissions?.canManageReplications;
   ```
4. Line 325:
   ```tsx
   {activeNav === 'replications' && <ReplicationsView />}
   ```
- The primary sidebar navigation `NAV` array (lines 52–61) does not contain a menu item for `replications`. Only hash routing (`#replications`) and lazy rendering were present.

### 1.5 Permissions Context & `canManageSettings` Access (Task 3)
In `app/catalog/src/context/PermissionsContext.tsx`:
- `UserPermissions` interface (lines 4–20):
  ```typescript
  export interface UserPermissions {
    isSuperAdmin: boolean;
    canManageAppUsers: boolean;
    canManageOrgRoles: boolean;
    canManageSingleRoles: boolean;
    canManageDerivedRoles: boolean;
    managedDerivedRolesScope: [];
    canAssignRoles: boolean;
    canManageReplications: boolean;
    canViewAuditLogs: boolean;
    canManageSettings: boolean;
    allowedEnvironments: [];
    allowedAccessDomains: [];
    isActive: boolean;
    userId?: string;
    userName?: string;
  }
  ```
- Default state on fetch error/fallback sets `canManageSettings: false` (lines 54, 72).
- Access pattern across components:
  ```typescript
  const { permissions } = usePermissions();
  const canManage = permissions?.isSuperAdmin || permissions?.canManageSettings;
  ```
- Used in `SystemView.tsx` (lines 22, 28, 34, 40, 46, 52) to control tab visibility:
  ```typescript
  visible: permissions?.isSuperAdmin || permissions?.canManageSettings
  ```

---

## 2. Logic Chain

### 2.1 API Client Design & Exact Diff Proposals (`app/catalog/src/api.ts`)

#### Step 1: Remove Obsolete Replication Functions
In `app/catalog/src/api.ts`, delete lines 226–230:
```typescript
// BEFORE:
// Replications
export const getReplications = () => request('GET', '/Replications?$orderby=replicationDate desc');
export const triggerReplication = () => request('POST', '/triggerReplication', {});
export const checkReplicationStatuses = () => request('POST', '/checkReplicationStatuses', {});

// AFTER:
// (Completely removed)
```

#### Step 2: Add Databricks Settings Function Signatures
In `app/catalog/src/api.ts`, directly under BDC Settings (after line 202), add:
```typescript
// Databricks Settings
export interface DatabricksSettingPayload {
  systemName: string;
  environment_ID?: string;
  workspaceUrl: string;
  authType: 'TOKEN' | 'SERVICE_PRINCIPAL';
  apiToken?: string;
  clientId?: string;
  clientSecret?: string;
  targetCatalog?: string;
  targetSchema?: string;
  sqlWarehouseId?: string;
  isActive?: boolean;
}

export interface TestDatabricksConnectionResult {
  success: boolean;
  message: string;
  httpStatus: number;
}

export const getDatabricksSettings = () => 
  request('GET', '/DatabricksSettings?$expand=environment');

export const createDatabricksSetting = (body: DatabricksSettingPayload | Record<string, any>) => 
  request('POST', '/DatabricksSettings', body);

export const updateDatabricksSetting = (id: string, body: Partial<DatabricksSettingPayload> | Record<string, any>) => 
  request('PATCH', `/DatabricksSettings('${id}')`, body);

export const deleteDatabricksSetting = (id: string) => 
  request('DELETE', `/DatabricksSettings('${id}')`);

export const testDatabricksConnection = (settingId: string): Promise<TestDatabricksConnectionResult> => 
  request('POST', '/testDatabricksConnection', { settingId });
```

*Rationale*:
1. Matches the established pattern in `api.ts` used by `getBdcSettings`, `createBdcSetting`, `updateBdcSetting`, `deleteBdcSetting`, and `testBdcConnection`.
2. Uses `/DatabricksSettings('${id}')` which aligns with all other entity update/delete endpoints in `api.ts` (`/BdcSettings('${id}')`, `/Roles('${id}')`, `/OrgNodes('${id}')`).
3. Supports payload expansion `$expand=environment` to display environment tags (e.g., Development `D`, Quality `Q`, Production `P`) in settings tables.

### 2.2 Navigation & Routing Cleanup in `App.tsx`

#### Step 1: Remove Lazy Import
Delete line 46:
```typescript
// REMOVE:
const ReplicationsView = lazy(() => import('./components/ReplicationsView'));
```

#### Step 2: Update Valid Navigation Routes
In line 69, remove `'replications'` from `validNavs`:
```typescript
// BEFORE (line 69):
const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard', 'replications'];

// AFTER:
const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard'];
```

*Trace & Safety*:
If any user has a stale bookmark or clicks a link with `#replications`, `getNavFromHash()` executes:
```typescript
return validNavs.includes(hash) ? hash : 'home';
```
Because `'replications'` is no longer in `validNavs`, it gracefully falls back to `'home'`. No broken render, no runtime error.

#### Step 3: Remove Dead Nav Filter Rule
Delete line 143:
```typescript
// REMOVE (line 143):
if (item.id === 'replications') return !!permissions?.canManageReplications;
```

#### Step 4: Remove View Render Branch
Delete line 325:
```tsx
// REMOVE (line 325):
{activeNav === 'replications' && <ReplicationsView />}
```

### 2.3 Component Disposal: `ReplicationsView.tsx`
- Once lines 46 & 325 are removed from `App.tsx`, `app/catalog/src/components/ReplicationsView.tsx` is completely unreferenced.
- Worker M4 should delete `ReplicationsView.tsx` (or deprecate it with an empty component / redirect). Deleting it removes the 5.05 kB dead chunk from the Vite build bundle (`dist/assets/ReplicationsView-*.js`).

### 2.4 Permissions Context (`PermissionsContext.tsx`)
- `canManageSettings` is already defined in `UserPermissions` and available via `usePermissions()`.
- For `canManageReplications`:
  - Retain `canManageReplications?: boolean;` as optional in `UserPermissions` (or keep default `canManageReplications: false`), so test mocks in `app/catalog/src/components/__tests__/WizardDialogs.test.tsx` and `RolesDashboardPerformance.test.tsx` do not fail TypeScript strict checking.

---

## 3. Caveats

1. **Write-Only / Masked Sensitive Fields**:
   - As observed in `srv/handlers/systemHandlers.js:34-43`, the backend deletes `apiToken` and `clientSecret` when returning `DatabricksSettings` via `GET`.
   - In the frontend form for editing an existing Databricks setting, the UI must treat `apiToken` and `clientSecret` as write-only/masked: leave blank or display placeholder `••••••••` unless the user explicitly enters a new token or secret. If the user leaves the token/secret field blank during update, do NOT send `apiToken: ''` or `clientSecret: ''` in the PATCH payload to avoid clearing the stored credential.
2. **Key Format Compatibility in OData**:
   - Both `/DatabricksSettings('${id}')` and `/DatabricksSettings(ID=${id})` are supported by CAP OData v4. Using `/DatabricksSettings('${id}')` maintains 100% syntactic uniformity with `api.ts`'s existing `updateBdcSetting` and `updateRole`.
3. **TypeScript Build Verification**:
   - Vite and TypeScript check types during `npm run build --prefix app/catalog`. If `ReplicationsView.tsx` is deleted, ensure no test or index file imports it.

---

## 4. Conclusion & Recommendations for Worker M4

### Summary of Recommendations:
1. **`app/catalog/src/api.ts`**:
   - Remove lines 226–230 (`getReplications`, `triggerReplication`, `checkReplicationStatuses`).
   - Add `getDatabricksSettings`, `createDatabricksSetting`, `updateDatabricksSetting`, `deleteDatabricksSetting`, and `testDatabricksConnection` with typed payloads.
2. **`app/catalog/src/App.tsx`**:
   - Remove line 46 (`ReplicationsView` import).
   - Remove `'replications'` from `validNavs` in line 69.
   - Remove line 143 (`item.id === 'replications'`).
   - Remove line 325 (`activeNav === 'replications'`).
3. **`app/catalog/src/components/ReplicationsView.tsx`**:
   - Delete this file as it is fully retired.
4. **`app/catalog/src/components/SystemView.tsx` & `DatabricksSettingsView.tsx`**:
   - Create `DatabricksSettingsView.tsx` in `app/catalog/src/components/`.
   - Add a tab in `SystemView.tsx` gated by `permissions?.isSuperAdmin || permissions?.canManageSettings`.

---

## 5. Verification Method

To verify the changes once implemented:
1. **Frontend Production Build**:
   ```bash
   npm run build --prefix app/catalog
   ```
   Must succeed with exit code 0. Confirm that `dist/assets/ReplicationsView-*.js` is no longer generated in the bundle.
2. **Route Safety Verification**:
   Load application in browser, navigate to `#replications`, and confirm that the URL router redirects or defaults to `#home` without error.
3. **Backend Integration Tests**:
   ```bash
   npm run test
   ```
   Must pass with all 44+ tests green.
