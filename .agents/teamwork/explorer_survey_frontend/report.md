# Comprehensive Frontend & UI Survey: Multi-Target Platform (Databricks & SAP Datasphere)

**Survey Date:** 2026-11-01  
**Author:** Frontend & UI Survey Explorer  
**Target Directory:** `c:\Users\Fan\Documents\fanrio-auth\app\catalog\`  
**Context:** Multi-Target Platform Selection & Real-Time Direct Synchronization Architecture (Replacing Batch Replication Queue)

---

## Executive Summary

The frontend application (`app/catalog`) is a React 19 + TypeScript + Vite + Material UI (MUI v7) application that compiles via Rolldown into a static distribution bundle.

Our code-level survey examined the complete frontend lifecycle to support:
1. **Multi-Target Platform Selection** (`DATASPHERE`, `DATABRICKS`, `BOTH`) across Roles, Access Domains / Streams, and the Role Creation Wizard.
2. **Decommissioning the Replication Queue UI** (`ReplicationsView`, trigger polling, navigation links, and associated permission checks).
3. **Databricks Connection Administration** (New `DatabricksSettingsView.tsx` tab in `SystemView.tsx` for maintaining workspace URLs, credentials, target catalog/schema, and an API connection test action).
4. **Build, Type-Safety, and Non-Regression** requirements.

---

## 1. App Navigation & Decommissioning `ReplicationsView`

### 1.1 Current Architecture & File Analysis
- **File Path**: `app/catalog/src/App.tsx` (Note: TypeScript `.tsx`, not `.jsx`).
- **Current Navigation State**:
  * The main navigation bar (`NAV` array, lines 52–61) consists of:
    - `home` (Dashboard)
    - `org` (Organization)
    - `roles` (Roles)
    - `assignments` (Role Assignments)
    - `audit` (Audit Logs)
    - `access-profiles` (Access Profiles)
    - `users` (Manage Users)
    - `system` (System Settings)
  * `replications` is **not** currently displayed in the main sidebar drawer list, but remnants remain wired into hash routing, permission filtering, and lazy component loading:
    - Line 46: `const ReplicationsView = lazy(() => import('./components/ReplicationsView'));`
    - Line 69: `const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard', 'replications'];`
    - Line 143: `if (item.id === 'replications') return !!permissions?.canManageReplications;`
    - Line 325: `{activeNav === 'replications' && <ReplicationsView />}`
  * The component file `app/catalog/src/components/ReplicationsView.tsx` (219 lines) presents a table of past asynchronous replication executions with buttons "Start Replication" (`triggerReplication`) and "Refresh Execution Status" (`checkReplicationStatuses`).

### 1.2 Required Modifications for Removal
1. **`app/catalog/src/App.tsx`**:
   - **Line 46**: Remove `const ReplicationsView = lazy(() => import('./components/ReplicationsView'));`.
   - **Line 69**: Remove `'replications'` from `validNavs`:
     ```ts
     const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard'];
     ```
   - **Line 143**: Remove `if (item.id === 'replications') return !!permissions?.canManageReplications;`.
   - **Line 325**: Remove `{activeNav === 'replications' && <ReplicationsView />}`.
2. **`app/catalog/src/components/ReplicationsView.tsx`**:
   - Delete or retire this component file. No other component in `app/catalog` imports or invokes `ReplicationsView`.
3. **Permissions Context & Flag Clean-up**:
   - In `app/catalog/src/context/PermissionsContext.tsx`:
     * Line 12: `canManageReplications: boolean;` in interface `UserPermissions`.
     * Lines 52, 70: `canManageReplications: false`.
     * Recommendation: Retain `canManageReplications?: boolean;` as optional or deprecated in `UserPermissions` during transition to avoid breaking tests/DB entities, but eliminate any UI reliance on it.
   - In `app/catalog/src/components/AppAuthorizationsView.tsx`:
     * Line 53: `canManageReplications: boolean;` in `AppRoleFlags`.
     * Lines 72, 82, 92, 102, 112, 122: Role definitions description and flags.
     * Recommendation: Deprecate `canManageReplications` from the role definitions matrix and permission inspection cards so users are not presented with obsolete replication management capabilities.

---

## 2. API Layer Survey (`app/catalog/src/api.ts`)

### 2.1 Replications Endpoints to Remove
In `app/catalog/src/api.ts`, lines 226–230:
```ts
// Replications (To be decommissioned)
export const getReplications = () => request('GET', '/Replications?$orderby=replicationDate desc');
export const triggerReplication = () => request('POST', '/triggerReplication', {});
export const checkReplicationStatuses = () => request('POST', '/checkReplicationStatuses', {});
```
- Remove these 3 functions once `ReplicationsView.tsx` is removed.
- Note on task chain endpoints: Lines 215–216 (`runBdcTaskChain`, `fetchBdcTaskChainLog`) are low-level proxy calls used by `BdcApiTesterView.tsx`. They may remain for diagnostic testing if desired, but are no longer part of the role replication path.

### 2.2 New API Methods Needed for Databricks Integration
Add the following OData CRUD and action methods in `app/catalog/src/api.ts`:
```ts
// Databricks Settings
export const getDatabricksSettings = () => request('GET', '/DatabricksSettings?$expand=environment');
export const createDatabricksSetting = (body: any) => request('POST', '/DatabricksSettings', body);
export const updateDatabricksSetting = (id: string, body: any) => request('PATCH', `/DatabricksSettings('${id}')`, body);
export const deleteDatabricksSetting = (id: string) => request('DELETE', `/DatabricksSettings('${id}')`);
export const testDatabricksConnection = (settingId: string) => request('POST', '/testDatabricksConnection', { settingId });
```

### 2.3 CRUD Adjustments for Target Platform
1. **`GetRolesParams` in `api.ts` (lines 80–89)**:
   - Add `platformFilter?: string` to `GetRolesParams`.
   - In `getRoles(params)`:
     ```ts
     if (params.platformFilter && params.platformFilter !== 'ALL') {
       filters.push(`targetPlatform eq '${params.platformFilter}'`);
     }
     ```
2. **`createRole` & `updateRole`**:
   - Ensure payload accepts `targetPlatform: 'DATASPHERE' | 'DATABRICKS' | 'BOTH'`.
3. **`createAccessDomainNode` & `updateAccessDomainNode`**:
   - Ensure payload accepts `targetPlatform: 'DATASPHERE' | 'DATABRICKS' | 'BOTH'`.

---

## 3. Role Creation / Edit Wizard (`app/catalog/src/components/Wizard/`)

The wizard consists of 4 steps managed by `useWizardState.ts`:
1. `StepOrigin.tsx` (Origin, Name, Environment, Access Domain, Critical)
2. `StepRestrictions.tsx` (Restriction rule builder)
3. `StepApprovers.tsx` (Approver configuration)
4. `StepReview.tsx` (Summary review & deploy)

### 3.1 State Management (`useWizardState.ts`)
- **State Addition**:
  ```ts
  const [targetPlatform, setTargetPlatform] = useState<'DATASPHERE' | 'DATABRICKS' | 'BOTH'>('DATASPHERE');
  ```
- **Edit Mode Hydration** (Lines 224–254):
  Inside `api.getRole(context.roleId).then(role => { ... })`:
  ```ts
  setTargetPlatform(role.targetPlatform || 'DATASPHERE');
  ```
- **Access Domain / Parent Inheritance**:
  When a user selects an Access Domain or parent role, if the role's `targetPlatform` is unset or default, sync with the Access Domain's configured `targetPlatform`.
- **Payload Generation** in `handleDeploy` (Lines 453–513):
  Include `targetPlatform` in `deepPayload`:
  ```ts
  const deepPayload = {
    name: roleName,
    type: computedType,
    description,
    critical,
    environment_ID: environmentId,
    accessDomain_ID: accessDomainId,
    targetPlatform, // <-- Included in create and update payloads
    ownRestrictions,
    parentRoles,
    approvers: formattedApprovers,
    ...
  };
  ```
- **Expose State**: Return `targetPlatform` and `setTargetPlatform` from `useWizardState`.

### 3.2 UI Selection in `StepOrigin.tsx`
- **Component**: Add a Target Platform selector control below `EnvironmentSelection` or beside `Access Domain`:
  ```tsx
  <Box sx={{ mt: 1 }}>
    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5, color: 'text.secondary' }}>
      Target Platform
    </Typography>
    <ToggleButtonGroup
      value={targetPlatform}
      exclusive
      onChange={(_e, val) => { if (val) setTargetPlatform(val); }}
      size="small"
      disabled={isReadOnly}
      fullWidth
    >
      <ToggleButton value="DATASPHERE" sx={{ fontWeight: 600, textTransform: 'none', gap: 1 }}>
        <Cloud size={16} /> SAP Datasphere
      </ToggleButton>
      <ToggleButton value="DATABRICKS" sx={{ fontWeight: 600, textTransform: 'none', gap: 1 }}>
        <Flame size={16} /> Databricks
      </ToggleButton>
      <ToggleButton value="BOTH" sx={{ fontWeight: 600, textTransform: 'none', gap: 1 }}>
        <Layers size={16} /> Both Platforms
      </ToggleButton>
    </ToggleButtonGroup>
  </Box>
  ```
- **Props**: Forward `targetPlatform` and `setTargetPlatform` from `Wizard/index.tsx` into `StepOrigin`.

### 3.3 Confirmation & Summary in `StepReview.tsx`
- In the "Role Summary" card (Lines 26–39):
  Add a chip displaying the configured target platform:
  ```tsx
  <Chip
    label={targetPlatform === 'BOTH' ? 'Datasphere + Databricks' : targetPlatform === 'DATABRICKS' ? 'Databricks' : 'SAP Datasphere'}
    size="small"
    color={targetPlatform === 'BOTH' ? 'secondary' : targetPlatform === 'DATABRICKS' ? 'warning' : 'primary'}
    variant="outlined"
    sx={{ fontWeight: 600 }}
  />
  ```

---

## 4. Roles Dashboard, Role Card & Table Views

### 4.1 `RoleCard.tsx`
- **Target Platform Badge**:
  * In Standard View (lines 280–286):
    Render a platform chip alongside `role.type` and `role.critical`:
    ```tsx
    <Chip
      size="small"
      label={role.targetPlatform === 'BOTH' ? 'Datasphere + Databricks' : role.targetPlatform || 'DATASPHERE'}
      color={role.targetPlatform === 'BOTH' ? 'secondary' : role.targetPlatform === 'DATABRICKS' ? 'warning' : 'info'}
      variant="outlined"
      sx={{ fontSize: '0.75rem', fontWeight: 600 }}
    />
    ```
  * In Compact View (line 224): Include the target platform chip in the right-hand chip stack.
  * In Context Details (line 291): Include `<strong>Platform:</strong> {role.targetPlatform || 'DATASPHERE'}`.

### 4.2 `RolesDashboard.tsx`
- **Filter Toolbar**:
  * Add a `platformFilter` state (`'ALL' | 'DATASPHERE' | 'DATABRICKS' | 'BOTH'`).
  * Add a `SearchableSelect` or `ToggleButtonGroup` in the filter card:
    ```ts
    const PLATFORM_OPTIONS = [
      { value: 'ALL', label: 'All Platforms' },
      { value: 'DATASPHERE', label: 'SAP Datasphere' },
      { value: 'DATABRICKS', label: 'Databricks' },
      { value: 'BOTH', label: 'Both Platforms' }
    ];
    ```
  * In `filteredRoles` `useMemo` (lines 118–149):
    ```ts
    if (platformFilter !== 'ALL') {
      const p = r.targetPlatform || 'DATASPHERE';
      if (p !== platformFilter && p !== 'BOTH') return false;
    }
    ```

### 4.3 `RoleTableView.tsx`
- In `RoleTableView.tsx` (lines 150–180), add a "Target Platform" column or display the platform chip inside the "Type" cell to keep the grid clear and uncluttered.

---

## 5. Access Domains / Streams (`AccessDomainsView.tsx` & `HierarchicalManager.tsx`)

### 5.1 Access Domains vs. Streams Terminology
In the codebase, "Streams" is surfaced in the UI as **Access Domains** (`AccessDomainsView.tsx`), referencing entity `AccessDomains` in `db/schema.cds`.

### 5.2 `HierarchicalManager.tsx` Extension
`HierarchicalManager.tsx` is the shared tree component for both `OrgStructureView.tsx` and `AccessDomainsView.tsx`.
- **Target Platform Configuration**:
  Add `showTargetPlatformSelector?: boolean;` prop to `HierarchicalManager`:
  * Default: `false` (in `OrgStructureView.tsx`).
  * Set to `true` in `AccessDomainsView.tsx`.
- **Node Creation (`handleAddRoot` & `handleAddChild`)**:
  When `showTargetPlatformSelector` is true:
  * Provide a platform selection control (`DATASPHERE`, `DATABRICKS`, `BOTH`, default: `BOTH`).
  * Include `targetPlatform: selectedPlatform` in the `createNode` payload.
- **Node Editing (`handleRename`)**:
  * Allow updating `targetPlatform` alongside name, description, and roleTemplateName.
- **Node Display Row**:
  * Display a small Chip with the platform name (`DATASPHERE`, `DATABRICKS`, `BOTH`) next to the Access Domain name.

---

## 6. Administration Area (`SystemView.tsx` & `DatabricksSettingsView.tsx`)

### 6.1 `SystemView.tsx` Structure
In `app/catalog/src/components/SystemView.tsx` (the administration panel), existing tabs are:
1. `BDC Connections` (`BdcSettingsView`)
2. `Restriction Fields` (`RestrictionFieldsView`)
3. `Access Domains` (`AccessDomainsView`)
4. `Dynamic Rules` (`DynamicRulesView`)
5. `Master Data Editor` (`MasterDataEditorView`)
6. `BDC API Tester` (`BdcApiTesterView`)

### 6.2 New Component: `DatabricksSettingsView.tsx`
Create `app/catalog/src/components/DatabricksSettingsView.tsx` following the exact design, UX, and error handling of `BdcSettingsView.tsx`:
- **Managed Parameters**:
  * `systemName`: string (e.g. "Databricks Corporate Workspace")
  * `environment_ID`: 'D' | 'Q' | 'P' (via `EnvironmentSelection`)
  * `workspaceUrl`: string (e.g. `https://adb-123456789.azuredatabricks.net`)
  * `authType`: 'TOKEN' | 'SERVICE_PRINCIPAL'
  * If `TOKEN`: `token` (Personal Access Token, masked password input)
  * If `SERVICE_PRINCIPAL`: `clientId` and `clientSecret` (masked password input)
  * `catalog`: string (Unity Catalog name, e.g. `analytics_catalog`)
  * `schema`: string (Target schema name, e.g. `security_schema`)
  * `warehouseId`: string (SQL Warehouse ID for DDL execution, optional)
  * `isActive`: boolean (Checkbox)
- **Actions & Controls**:
  * **Test Connection**: Button calling `api.testDatabricksConnection(setting.ID)`:
    - Provides immediate visual feedback (loading spinner, success/error toast snackbar with API response details).
  * **Add / Edit Connection Form**: Collapsible card with validation for required fields and URL format.
  * **Connection List**: Cards displaying system name, environment badge, workspace URL, catalog/schema target, active status chip, test connection button, edit and delete icons with confirmation dialogs.
- **Integration into `SystemView.tsx`**:
  * Lazy import:
    ```ts
    const DatabricksSettingsView = lazy(() => import('./DatabricksSettingsView'));
    ```
  * Tab entry placed immediately after `BDC Connections`:
    ```tsx
    {
      label: 'Databricks Settings',
      icon: <Database size={16} />,
      component: <DatabricksSettingsView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    }
    ```

---

## 7. Build, Quality, & Verification Findings

### 7.1 Production Bundle Build Verification
- Command: `npm run build --prefix app/catalog`
- Result: **Passed with zero errors** (Duration: ~2.24s).
- Modules transformed: 2,850 modules.
- Output chunks: Rolldown bundles `dist/index.html`, `dist/assets/*.js`, and generates `dist/catalog.zip` via `AdmZip` for BTP HTML5 deployment.
- **Requirement**: Any added code must continue to produce 0 TypeScript compilation errors and 0 Vite bundle warnings.

### 7.2 Language & Typing Standards
- All files in `app/catalog/src/` use **TypeScript** (`.ts` and `.tsx`).
- React version: `19.2.6`
- Material UI version: `@mui/material: 7.3.11`
- Icons: `lucide-react: 1.17.0`
- Date pickers: `@mui/x-date-pickers: 7.27.0`
- No new external npm dependencies are required; existing MUI components, Lucide icons, and React 19 hooks fully support all required UI elements.

---

## 8. Implementation Checklist & File Touch-Points

| Component / File | Purpose of Change | Priority |
|---|---|---|
| `app/catalog/src/App.tsx` | Remove `ReplicationsView` import, hash route, permission filter, and JSX render block | High |
| `app/catalog/src/components/ReplicationsView.tsx` | Delete/retire obsolete batch replication view | High |
| `app/catalog/src/api.ts` | Remove `getReplications`, `triggerReplication`, `checkReplicationStatuses`. Add `getDatabricksSettings`, `createDatabricksSetting`, `updateDatabricksSetting`, `deleteDatabricksSetting`, `testDatabricksConnection`. Add `platformFilter` to `getRoles`. | High |
| `app/catalog/src/components/Wizard/useWizardState.ts` | Add `targetPlatform` state, load from role on edit, include in `createRole`/`updateRole` payloads | High |
| `app/catalog/src/components/Wizard/steps/StepOrigin.tsx` | Add Platform Selection control (`DATASPHERE`, `DATABRICKS`, `BOTH`) | High |
| `app/catalog/src/components/Wizard/steps/StepReview.tsx` | Add Target Platform badge in Role Summary card | Medium |
| `app/catalog/src/components/RolesDashboard.tsx` | Add `platformFilter` state, dropdown filter, and filter logic | Medium |
| `app/catalog/src/components/RoleCard.tsx` | Add Target Platform badge/chip in standard and compact cards | Medium |
| `app/catalog/src/components/RoleTableView.tsx` | Display Target Platform badge in table view | Low |
| `app/catalog/src/components/AccessDomainsView.tsx` & `HierarchicalManager.tsx` | Add `targetPlatform` support (`DATASPHERE`, `DATABRICKS`, `BOTH`) to Access Domains | Medium |
| `app/catalog/src/components/DatabricksSettingsView.tsx` | New component for Databricks workspace credentials, catalog/schema, and Test Connection | High |
| `app/catalog/src/components/SystemView.tsx` | Add "Databricks Settings" tab wired to `DatabricksSettingsView` | High |
| `app/catalog/src/context/PermissionsContext.tsx` | Deprecate `canManageReplications` without breaking consumers | Low |
| `app/catalog/src/components/AppAuthorizationsView.tsx` | Remove `canManageReplications` from UI permission matrices | Low |

---
*Report completed and verified against `ORIGINAL_REQUEST.md` and `AGENTS.md`.*
