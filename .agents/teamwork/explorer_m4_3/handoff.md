# Milestone 4-3 Investigation Report: Databricks Connection Settings & Admin Integration

> **Core Finding**: Databricks settings and connection testing are fully exposed on the backend (`DatabricksSettings` projection and `testDatabricksConnection` OData action in `srv/cortex_service.cds`). To integrate them into the frontend, Worker M4 needs to: (1) export 5 CRUD & test functions in `app/catalog/src/api.ts`, (2) register a new `Databricks Settings` tab in `app/catalog/src/components/SystemView.tsx`, and (3) create `app/catalog/src/components/DatabricksSettingsView.tsx` following the established MUI v7 / Lucide pattern from `BdcSettingsView.tsx`, with a critical credential-preservation strategy on PATCH updates.

---

## 1. Observation

### 1.1 Existing Administration & Tab Structure (`SystemView.tsx`)
- **File**: `app/catalog/src/components/SystemView.tsx` (lines 1–55, 56–65, 87–115)
- All administration settings are hosted under `SystemView.tsx`, which lazy-loads tab components using `React.lazy` and `Suspense`:
  ```tsx
  // SystemView.tsx:6-11
  const RestrictionFieldsView = lazy(() => import('./RestrictionFieldsView'));
  const AccessDomainsView = lazy(() => import('./AccessDomainsView'));
  const BdcSettingsView = lazy(() => import('./BdcSettingsView'));
  const BdcApiTesterView = lazy(() => import('./BdcApiTesterView'));
  const DynamicRulesView = lazy(() => import('./DynamicRulesView'));
  const MasterDataEditorView = lazy(() => import('./MasterDataEditorView'));
  ```
- Every administrative tab is permission-gated via `usePermissions()`:
  ```tsx
  // SystemView.tsx:22
  visible: permissions?.isSuperAdmin || permissions?.canManageSettings
  ```
- Tabs are defined in an `allTabs` array with `{ label, icon, component, visible }`, filtered by `visible`, and rendered in an MUI `<Tabs>` container with scrollable indicators.
- **Current Tab Order**:
  1. `BDC Connections` (icon: `<Cloud size={16} />`)
  2. `Restriction Fields` (icon: `<Settings size={16} />`)
  3. `Access Domains` (icon: `<Network size={16} />`)
  4. `Dynamic Rules` (icon: `<GitFork size={16} />`)
  5. `Master Data Editor` (icon: `<Database size={16} />`)
  6. `BDC API Tester` (icon: `<Terminal size={16} />`)

### 1.2 Established Settings UX Pattern (`BdcSettingsView.tsx`)
- **File**: `app/catalog/src/components/BdcSettingsView.tsx`
- **Data Fetching** (lines 77–94):
  - Fetches settings and environments concurrently on mount via `Promise.all([api.getBdcSettings(), api.getEnvironments()])`.
  - Sets initial loading indicator `<CircularProgress />` if `loading && settings.length === 0`.
- **Form State & Mode Switching** (lines 36–70, 201–202, 301–325):
  - Two distinct state objects: `form` (for new record creation inside a collapsible card `<Collapse in={showAdd}>`) and `editForm` (for updating an existing record inline when `editingId === s.ID`).
- **Validation** (lines 112–130):
  - Dedicated `validate(form)` function returning an error string; displays an alert/snackbar if invalid.
- **Feedback & Notifications** (lines 26–30, 337–346):
  - MUI `<Snackbar>` with `<Alert severity={snackbar.severity} variant="filled">` anchored bottom-right.
- **Deletion Safety** (lines 20, 267–285, 688–710):
  - MUI `<Dialog>` confirmation dialog with `confirmDialog` state `{ open, title, message, onConfirm }` preventing accidental deletion.
- **Grid Layout**:
  - Uses MUI v7 syntax: `<Grid container spacing={2.5}><Grid size={{ xs: 12, sm: 6 }}>` (package.json `@mui/material: ^7.3.11`).

### 1.3 Backend Service Contract & Security Stripping
- **Data Model** (`db/schema.cds`, lines 142–154):
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
- **OData Projections & Actions** (`srv/cortex_service.cds`, lines 37, 107–111):
  ```cds
  entity DatabricksSettings as projection on db.DatabricksSettings;

  action testDatabricksConnection(settingId: UUID) returns {
    success    : Boolean;
    message    : String;
    httpStatus : Integer;
  };
  ```
- **Permission & Credential Stripping Hook** (`srv/handlers/systemHandlers.js`, lines 28–43):
  - Direct `READ` on `DatabricksSettings` requires `canManageSettings` (or `isSuperAdmin`).
  - Sensitive credentials are intentionally deleted on READ:
    ```javascript
    service.after('READ', 'DatabricksSettings', (data) => {
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      for (const row of rows) {
        if (row) {
          delete row.apiToken;
          delete row.clientSecret;
        }
      }
    });
    ```
- **Action Implementation** (`srv/cortex_service.js`, lines 212–273):
  - Validates `workspaceUrl` starts with `http`.
  - Validates `apiToken` present if `authType === 'TOKEN'`, or `clientId` + `clientSecret` present if `authType === 'SERVICE_PRINCIPAL'`.
  - Executes `DatabricksClient.testConnection(setting)` and returns `{ success, message, httpStatus }`.
- **Existing Test Verification** (`test/backend_tests.test.js`, lines 647–720):
  - `✔ DatabricksSettings CRUD & testDatabricksConnection action (293ms)` passes cleanly.
  - Verifies that `apiToken` and `clientSecret` are stripped on `GET`.

### 1.4 Current Frontend API Client (`app/catalog/src/api.ts`)
- `api.ts` lines 184–188 currently export BDC Settings functions, but **no Databricks functions exist yet**.
- Functions must use `request(method, path, body)` from line 44.

---

## 2. Logic Chain: Component Architecture & Blueprint for Worker M4

### Step 1: Extend `app/catalog/src/api.ts`
Worker M4 must add the following API exports into `app/catalog/src/api.ts`:

```typescript
// Databricks Settings
export const getDatabricksSettings = () => request('GET', '/DatabricksSettings?$expand=environment');
export const createDatabricksSetting = (body: any) => request('POST', '/DatabricksSettings', body);
export const updateDatabricksSetting = (id: string, body: any) => request('PATCH', `/DatabricksSettings('${id}')`, body);
export const deleteDatabricksSetting = (id: string) => request('DELETE', `/DatabricksSettings('${id}')`);
export const testDatabricksConnection = (settingId: string) => request('POST', '/testDatabricksConnection', { settingId });
```

### Step 2: Integrate Tab into `app/catalog/src/components/SystemView.tsx`
Worker M4 must:
1. Lazy-import the new component:
   ```tsx
   const DatabricksSettingsView = lazy(() => import('./DatabricksSettingsView'));
   ```
2. Import the `Server` icon from `lucide-react`:
   ```tsx
   import { Settings, Network, Cloud, Terminal, GitFork, Database, Server } from 'lucide-react';
   ```
3. Insert the new tab definition in `allTabs` immediately following `BDC Connections`:
   ```tsx
   {
     label: 'Databricks Settings',
     icon: <Server size={16} />,
     component: <DatabricksSettingsView />,
     visible: permissions?.isSuperAdmin || permissions?.canManageSettings
   },
   ```

### Step 3: Implement `app/catalog/src/components/DatabricksSettingsView.tsx`

#### State Architecture
```typescript
interface DatabricksSetting {
  ID: string;
  systemName: string;
  environment_ID: string;
  workspaceUrl: string;
  authType: 'TOKEN' | 'SERVICE_PRINCIPAL';
  apiToken?: string;
  clientId?: string;
  clientSecret?: string;
  targetCatalog: string;
  targetSchema: string;
  sqlWarehouseId: string;
  isActive: boolean;
  environment?: { ID: string; name: string };
}
```

State variables in component:
1. `settings`: `DatabricksSetting[]` — loaded settings.
2. `environments`: `any[]` — available environments from `api.getEnvironments()`.
3. `loading`: `boolean` — initial load and background sync spinner.
4. `showAdd`: `boolean` — toggles the top collapsible create card.
5. `editingId`: `string | null` — ID of setting currently being edited inline.
6. `testingId`: `string | null` — ID of setting currently undergoing a live connection test.
7. `testStatusMap`: `Record<string, { success: boolean; message: string; httpStatus?: number }>` — stores test results per card to display inline status alerts.
8. `form`: create form state with defaults:
   ```javascript
   {
     systemName: '',
     environment_ID: 'D',
     workspaceUrl: '',
     authType: 'TOKEN',
     apiToken: '',
     clientId: '',
     clientSecret: '',
     targetCatalog: 'main',
     targetSchema: 'default',
     sqlWarehouseId: '',
     isActive: true
   }
   ```
9. `editForm`: edit form state (same shape).
10. `snackbar`: `{ open: boolean; message: string; severity: 'success' | 'info' | 'warning' | 'error' }`.
11. `confirmDialog`: `{ open: boolean; title: string; message: string; onConfirm: (() => void) | null }`.

#### Form Validation
```javascript
function validate(f, isEdit = false) {
  if (!f.systemName || !f.systemName.trim()) return 'System Connection Name is required.';
  if (!f.workspaceUrl || !f.workspaceUrl.trim()) return 'Databricks Workspace URL is required.';
  if (!f.workspaceUrl.startsWith('http://') && !f.workspaceUrl.startsWith('https://')) {
    return 'Databricks Workspace URL must start with http:// or https://';
  }
  const auth = (f.authType || 'TOKEN').toUpperCase();
  if (auth === 'TOKEN') {
    // In edit mode, apiToken is optional (user leaves it blank to keep existing stored token)
    if (!isEdit && (!f.apiToken || !f.apiToken.trim())) {
      return 'API Bearer Token is required for TOKEN authentication.';
    }
  } else if (auth === 'SERVICE_PRINCIPAL') {
    if (!f.clientId || !f.clientId.trim()) {
      return 'Client ID is required for SERVICE_PRINCIPAL authentication.';
    }
    // In edit mode, clientSecret is optional (user leaves it blank to keep existing stored secret)
    if (!isEdit && (!f.clientSecret || !f.clientSecret.trim())) {
      return 'Client Secret is required for SERVICE_PRINCIPAL authentication.';
    }
  }
  return '';
}
```

#### Critical PATCH Logic (Preserving Masked Credentials)
Because `srv/handlers/systemHandlers.js` deletes `apiToken` and `clientSecret` on `READ`, the `editForm` will have empty strings for credentials when entering edit mode.
**Worker M4 MUST omit blank credentials from the PATCH payload:**
```javascript
async function handleUpdate(id) {
  const err = validate(editForm, true);
  if (err) {
    setSnackbar({ open: true, message: err, severity: 'error' });
    return;
  }
  setLoading(true);
  try {
    const payload = {
      systemName: editForm.systemName.trim(),
      environment_ID: editForm.environment_ID,
      workspaceUrl: editForm.workspaceUrl.trim(),
      authType: editForm.authType,
      targetCatalog: editForm.targetCatalog ? editForm.targetCatalog.trim() : 'main',
      targetSchema: editForm.targetSchema ? editForm.targetSchema.trim() : 'default',
      sqlWarehouseId: editForm.sqlWarehouseId ? editForm.sqlWarehouseId.trim() : '',
      isActive: editForm.isActive
    };

    // Only include credential fields if the user actually entered new values!
    if (editForm.authType === 'TOKEN') {
      if (editForm.apiToken && editForm.apiToken.trim()) {
        payload.apiToken = editForm.apiToken.trim();
      }
    } else if (editForm.authType === 'SERVICE_PRINCIPAL') {
      if (editForm.clientId && editForm.clientId.trim()) {
        payload.clientId = editForm.clientId.trim();
      }
      if (editForm.clientSecret && editForm.clientSecret.trim()) {
        payload.clientSecret = editForm.clientSecret.trim();
      }
    }

    await api.updateDatabricksSetting(id, payload);
    setEditingId(null);
    await load();
    setSnackbar({ open: true, message: 'Databricks setting updated successfully.', severity: 'success' });
  } catch (e) {
    setSnackbar({ open: true, message: e.message || 'Update failed', severity: 'error' });
  } finally {
    setLoading(false);
  }
}
```

#### Interactive "Test Connection" Handler
```javascript
async function handleTestConnection(id) {
  setTestingId(id);
  setSnackbar({ open: true, message: 'Testing Databricks connection...', severity: 'info' });
  try {
    const res = await api.testDatabricksConnection(id);
    setTestStatusMap(prev => ({
      ...prev,
      [id]: {
        success: Boolean(res.success),
        message: res.message || (res.success ? 'Connection succeeded' : 'Connection failed'),
        httpStatus: res.httpStatus
      }
    }));
    if (res.success) {
      setSnackbar({
        open: true,
        message: `Databricks connection verified: ${res.message} (HTTP ${res.httpStatus || 200})`,
        severity: 'success'
      });
    } else {
      setSnackbar({
        open: true,
        message: `Databricks connection test failed: ${res.message} [HTTP ${res.httpStatus || 400}]`,
        severity: 'error'
      });
    }
  } catch (e) {
    setTestStatusMap(prev => ({
      ...prev,
      [id]: {
        success: false,
        message: e.message || 'Test failed with unexpected error',
        httpStatus: 502
      }
    }));
    setSnackbar({
      open: true,
      message: `Connection test error: ${e.message}`,
      severity: 'error'
    });
  } finally {
    setTestingId(null);
  }
}
```

#### UI Layout Details
1. **Header**:
   - Title: "Databricks Workspace Settings"
   - Subtitle: "Configure Databricks Unity Catalog workspaces, authentication credentials, and SQL Warehouse connections for real-time policy synchronization."
   - Action Button: `<Button variant="contained" onClick={() => setShowAdd(s => !s)} startIcon={<Plus size={15} />}>Add Databricks Workspace</Button>`
2. **Create Card (`Collapse in={showAdd}`)**:
   - Header: "New Databricks System Connection"
   - Grid fields (using MUI v7 `<Grid size={{ xs: 12, sm: ... }}>`):
     * System Name (text)
     * Environment (`<EnvironmentSelection>`)
     * Auth Type (`<SearchableSelect options={[{ value: 'TOKEN', label: 'Personal Access Token' }, { value: 'SERVICE_PRINCIPAL', label: 'Service Principal' }]}>`)
     * Workspace URL (text, fullWidth)
     * Conditional Auth Inputs:
       - TOKEN: API Bearer Token (`type="password"`)
       - SERVICE_PRINCIPAL: Client ID (text) + Client Secret (`type="password"`)
     * Target Catalog (text, default `'main'`)
     * Target Schema (text, default `'default'`)
     * SQL Warehouse ID (text)
     * Active Toggle (`<FormControlLabel control={<Switch checked={form.isActive} ... />}>`)
   - Footer: Cancel and Save Connection buttons.
3. **Connection Cards List**:
   - Empty state: `<Server size={40} />` icon with helpful message when `settings.length === 0`.
   - Card Header:
     * Icon: `<Server size={20} color={s.isActive ? "#2563eb" : "text.secondary"} />`
     * Title: System Name
     * Chips:
       - Auth Type Chip (`TOKEN` vs `SERVICE_PRINCIPAL`)
       - Environment Chip (colored by `ENV_COLOR[s.environment_ID]`)
       - State indicator (`● Active` green `#10b981` or `○ Inactive` gray)
     * Card Actions (right-aligned):
       - "Test Connection" button:
         ```tsx
         <Button
           variant="outlined"
           color="primary"
           size="small"
           onClick={() => handleTestConnection(s.ID)}
           disabled={testingId === s.ID || loading}
           startIcon={testingId === s.ID ? <CircularProgress size={13} /> : <Wifi size={13} />}
         >
           {testingId === s.ID ? 'Testing...' : 'Test Connection'}
         </Button>
         ```
       - Edit IconButton (`<Edit3 size={15} />`)
       - Delete IconButton (`<Trash2 size={15} />`, color="error")
   - Inline Test Status Alert (if tested in current session):
     ```tsx
     {testStatusMap[s.ID] && (
       <Alert
         severity={testStatusMap[s.ID].success ? 'success' : 'error'}
         onClose={() => setTestStatusMap(prev => { const n = { ...prev }; delete n[s.ID]; return n; })}
         sx={{ mt: 1.5, py: 0.5, fontSize: '0.8125rem' }}
       >
         {testStatusMap[s.ID].message} {testStatusMap[s.ID].httpStatus ? `[HTTP ${testStatusMap[s.ID].httpStatus}]` : ''}
       </Alert>
     )}
     ```
   - Card Details Grid:
     * Workspace URL (with external link style)
     * Auth Credentials preview (e.g. `Client ID: 0000...` or `API Token: ••••••••`)
     * Unity Catalog & Schema (`targetCatalog.targetSchema`)
     * SQL Warehouse ID

---

## 3. Caveats

1. **Stripped Credentials on Read**:
   - CAP deletes `apiToken` and `clientSecret` from GET responses in `srv/handlers/systemHandlers.js:35-42`.
   - The UI must NOT display cleartext passwords.
   - When updating other fields (like `systemName` or `targetCatalog`), the update payload must omit `apiToken` and `clientSecret` if empty, or else CAP will overwrite the secret in SQLite/HANA with empty strings.
2. **Environment Scoping**:
   - `EnvironmentSelection` automatically checks `usePermissions().permissions.allowedEnvironments`. When creating a Databricks setting, non-superadmins are restricted to environments in their allowed scope.
3. **MUI v7 Grid Syntax**:
   - The project uses `@mui/material: ^7.3.11`. Do not use `<Grid item xs={12}>`; use `<Grid size={{ xs: 12, sm: 6 }}>`.
4. **Mock Execution during Offline Dev/Tests**:
   - In offline test mode (`DATABRICKS_OFFLINE_MOCK=true` or missing credentials), `DatabricksMockAdapter` intercepts all calls and returns mock success or configured mock responses without reaching Databricks cloud.
5. **No Source Code Changes**:
   - As an explorer, no production source code has been altered. All blueprints are delivered in this specification for Worker M4.

---

## 4. Conclusion & Recommendation for Worker M4

The backend infrastructure for `DatabricksSettings` and `testDatabricksConnection` is fully implemented, tested, and secure.

### Action Plan for Worker M4:
1. **In `app/catalog/src/api.ts`**:
   - Export `getDatabricksSettings()`, `createDatabricksSetting(body)`, `updateDatabricksSetting(id, body)`, `deleteDatabricksSetting(id)`, and `testDatabricksConnection(settingId)`.
2. **Create `app/catalog/src/components/DatabricksSettingsView.tsx`**:
   - Implement according to the blueprint above with complete CRUD, credential masking on PATCH, and interactive "Test Connection" button with dual alert/toast feedback.
3. **In `app/catalog/src/components/SystemView.tsx`**:
   - Add lazy import of `DatabricksSettingsView`.
   - Add `{ label: 'Databricks Settings', icon: <Server size={16} />, component: <DatabricksSettingsView />, visible: permissions?.isSuperAdmin || permissions?.canManageSettings }` to `allTabs` right after `BDC Connections`.
4. **Run Verification**:
   - Run `npm run build --prefix app/catalog` to ensure Vite bundle builds cleanly with 0 TypeScript/syntax errors.

---

## 5. Verification Method

To verify Worker M4's implementation independently:

1. **Frontend Production Build**:
   ```bash
   npm run build --prefix app/catalog
   ```
   *Expected output*: `✓ built in ~1.2s` with `dist/assets/DatabricksSettingsView-[hash].js` emitted and zero errors.

2. **Backend Contract Verification**:
   ```bash
   node --test test/backend_tests.test.js
   ```
   *Verify*: `✔ DatabricksSettings CRUD & testDatabricksConnection action` passes.

3. **Security Enforcement Verification**:
   ```bash
   node --test test/auth_enforcement.test.js
   ```
   *Verify*: `✔ testDatabricksConnection and DatabricksSettings require canManageSettings permission` passes.

4. **UI Visual Check**:
   - Open `#system` in browser.
   - Verify tab 2 is "Databricks Settings".
   - Click "Add Databricks Workspace", enter details, and save.
   - Click "Test Connection" on the card and verify that the loading spinner appears followed by green success banner (or red error banner with HTTP status if invalid).
   - Click "Edit", verify that leaving password fields blank does not wipe existing credentials.
   - Click "Delete", verify confirm dialog prompts before deletion.
