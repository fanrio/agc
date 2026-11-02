# Handoff Report: Frontend UI Platform Selection & Access Domain Platform Configuration (M4-2)

**Explorer**: Explorer M4-2  
**Target Milestone**: Milestone 4 (Frontend UI Platform Selection & Admin Settings)  
**Date**: 2026-11-02  
**Working Directory**: `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_2`  
**Status**: Ready for Implementation (Worker M4)  

---

## 1. Observation

Direct code observations from investigation across the frontend codebase (`app/catalog/src/`):

### 1.1 Data Model & OData Schema Alignment
- **`db/schema.cds`**:
  * Lines 5–9: `TargetPlatform` enum is defined as:
    ```cds
    type TargetPlatform : String(20) enum {
      DATASPHERE;
      DATABRICKS;
      BOTH;
    };
    ```
  * Line 52: Entity `AccessDomains` contains:
    `targetPlatform : TargetPlatform default 'BOTH';`
  * Line 76: Entity `Roles` contains:
    `targetPlatform : TargetPlatform default 'DATASPHERE';`
- **`srv/cortex_service.cds`**:
  * Line 11: `entity AccessDomains as projection on db.AccessDomains;`
  * Lines 18–21: `entity Roles as projection on db.Roles { *, virtual null as assignmentsCount : Integer };`
  * Both entities project all database fields including `targetPlatform`.

### 1.2 Wizard State Management (`useWizardState.ts`)
- **File**: `app/catalog/src/components/Wizard/useWizardState.ts` (638 lines total).
- **Interface `WizardContext`** (lines 6–13):
  Does not yet define `targetPlatform?: 'DATASPHERE' | 'DATABRICKS' | 'BOTH'`.
- **State Initialization** (lines 20–62):
  No `targetPlatform` state currently exists.
- **Edit Mode Hydration** (lines 224–254):
  `api.getRole(context.roleId).then(role => { ... })` sets `roleType`, `roleName`, `description`, `orgNode`, `selectedParentIds`, `restrictions`, `approvers`, `critical`, `environmentId`, `accessDomainId`, but omits `targetPlatform`.
- **Parent Role Derivation** (lines 115–122):
  Syncs `accessDomain_ID` from the parent role (`if (parent && parent.accessDomain_ID) setAccessDomainId(parent.accessDomain_ID);`), but does not inherit parent's `targetPlatform`.
- **Payload Construction in `handleDeploy`** (lines 451–514):
  * Edit mode (line 453): `deepPayload` omits `targetPlatform`.
  * Org-based role generation (line 476): `deepPayload` omits `targetPlatform`.
  * Single/standard role creation (line 494): `deepPayload` omits `targetPlatform`.
- **Exported State Object** (lines 588–637):
  Does not expose `targetPlatform` or `setTargetPlatform`.

### 1.3 StepOrigin (`StepOrigin.tsx`)
- **File**: `app/catalog/src/components/Wizard/steps/StepOrigin.tsx` (168 lines).
- **Component Props** (lines 7–18):
  Does not receive `targetPlatform` or `setTargetPlatform`.
- **Form Controls Hierarchy** (lines 100–165):
  * Role Name `TextField` (line 101)
  * Description `TextField` (line 111)
  * Environment `EnvironmentSelection` (line 120)
  * Access Domain `SearchableSelect` (line 127)
  * Critical Status `FormControlLabel` / `Checkbox` (line 145)
  * Currently no platform selector is present in the form.

### 1.4 StepReview (`StepReview.tsx`)
- **File**: `app/catalog/src/components/Wizard/steps/StepReview.tsx` (104 lines).
- **Component Props** (lines 6–14):
  Does not receive `targetPlatform`.
- **Role Summary Card** (lines 18–53):
  Displays:
  * Name (line 23)
  * Type & Environment chips (lines 26–39)
  * Approvers list (lines 41–46)
  * Description (lines 48–52)
  * Currently no platform indicator or chip exists.

### 1.5 Roles Dashboard & Role Card
- **`app/catalog/src/components/RoleCard.tsx`** (474 lines):
  * Standard View header (lines 280–286): Renders chips for `role.type` and `role.critical`, but no `targetPlatform` chip.
  * Compact View header (lines 224–227): Renders chips for `role.environment_ID` and `isCritical`, but no `targetPlatform` chip.
  * Context details section (lines 289–306): Renders `Env`, `Org Unit`, `Derived from`, `Modified`, but no `Platform`.
- **`app/catalog/src/components/RolesDashboard.tsx`** (403 lines):
  * Filter Toolbar (lines 225–297): Has `searchQuery` (TextField), `envFilter` (EnvironmentSelection), `typeFilter` (SearchableSelect), `healthFilter` (Chip), and `Reset Filters` (Button).
  * In-memory filtering in `filteredRoles` (lines 118–149): Filters by `typeFilter`, `envFilter`, `healthFilter`, and `searchQuery`. Does not filter by platform.
- **`app/catalog/src/components/RoleTableView.tsx`** (427 lines):
  * Table columns (lines 150–181): Role Name, Type, Environment, Parent / Org Unit, Direct Users, Actions. Platform is not indicated.

### 1.6 Access Domains View & Hierarchical Manager
- **`app/catalog/src/components/AccessDomainsView.tsx`** (44 lines):
  Wraps `HierarchicalManager` configuring:
  `showTypeSelector={false}`, `showDescriptionField={true}`, `maxNameLength={10}`, `showRestrictionFields={true}`, `showRoleTemplateName={true}`.
- **`app/catalog/src/components/HierarchicalManager.tsx`** (1037 lines):
  * Shared between `OrgStructureView.tsx` (for OrgNodes) and `AccessDomainsView.tsx` (for AccessDomains).
  * Root node creation `handleAddRoot` (lines 836–865): Payload constructed with `name`, `type_ID`, `description`, `roleTemplateName`.
  * Child node creation `handleAddChild` (lines 189–221): Payload constructed with `name`, `parent_ID`, `type_ID`, `description`, `roleTemplateName`.
  * Node editing `handleRename` (lines 243–265): Updates `name`, `description`, `roleTemplateName`.
  * Node rendering `NodeRow` (lines 411–430): Displays name, description, type, template chips, and attribute/field chips, but has no platform badge.

---

## 2. Logic Chain & Component Design Specifications

From the observations above, the following concrete design specifications are formulated for Worker M4:

### 2.1 Task 1: `useWizardState.ts` Specifications

1. **Interface Update**:
   Update `WizardContext` in `app/catalog/src/components/Wizard/useWizardState.ts`:
   ```ts
   export interface WizardContext {
     orgNodeId?: string;
     parentRoleId?: string;
     roleId?: string;
     allowFreeNavigation?: boolean;
     accessDomainId?: string;
     targetPlatform?: 'DATASPHERE' | 'DATABRICKS' | 'BOTH';
     [key: string]: any;
   }
   ```

2. **State Declaration**:
   Add at line 55:
   ```ts
   const [targetPlatform, setTargetPlatform] = useState<'DATASPHERE' | 'DATABRICKS' | 'BOTH'>(
     context.targetPlatform || 'DATASPHERE'
   );
   ```

3. **Edit Mode Hydration** (inside `useEffect` on `context.roleId`, line 224):
   Add:
   ```ts
   setTargetPlatform(role.targetPlatform || 'DATASPHERE');
   ```

4. **Derivation Inheritance** (inside `useEffect` on `selectedParentIds`, line 115):
   When deriving a role from a parent, inherit the parent role's targetPlatform if in create mode:
   ```ts
   useEffect(() => {
     if (selectedParentIds.length > 0 && allRoles.length > 0) {
       const parent = allRoles.find(r => r.ID === selectedParentIds[0]);
       if (parent) {
         if (parent.accessDomain_ID) {
           setAccessDomainId(parent.accessDomain_ID);
         }
         if (parent.targetPlatform && !isEditMode) {
           setTargetPlatform(parent.targetPlatform);
         }
       }
     }
   }, [selectedParentIds, allRoles, isEditMode]);
   ```

5. **Payload Serialization in `handleDeploy`**:
   Add `targetPlatform` to all three branches of `deepPayload`:
   - **Edit Mode** (line 453):
     ```ts
     const deepPayload = {
       description,
       critical,
       environment_ID: environmentId,
       accessDomain_ID: accessDomainId,
       targetPlatform, // <-- Added
       type: computedType,
       ownRestrictions,
       parentRoles,
       approvers: formattedApprovers
     };
     await api.updateRole(roleId, deepPayload);
     ```
   - **Org-Based Mode** (line 476):
     ```ts
     const deepPayload = {
       name: roleName || result.roleName,
       description,
       critical,
       environment_ID: environmentId,
       accessDomain_ID: accessDomainId,
       targetPlatform, // <-- Added
       ownRestrictions,
       parentRoles,
       approvers: formattedApprovers,
       ...
     };
     await api.updateRole(roleId, deepPayload);
     ```
   - **Create Mode** (line 494):
     ```ts
     const deepPayload = {
       name: roleName,
       type: computedType,
       description,
       critical,
       environment_ID: environmentId,
       accessDomain_ID: accessDomainId,
       targetPlatform, // <-- Added
       ownRestrictions,
       parentRoles,
       approvers: formattedApprovers,
       ...
     };
     const created = await api.createRole(deepPayload);
     ```

6. **State Return**:
   Export `targetPlatform` and `setTargetPlatform` in the returned state object:
   ```ts
   return {
     ...
     targetPlatform, setTargetPlatform,
     ...
   };
   ```
   *(Note: `Wizard/index.tsx` already spreads `{...state}` to all step components, so both `StepOrigin` and `StepReview` receive them automatically without modifying `Wizard/index.tsx`)*.

---

### 2.2 Task 2: `StepOrigin.tsx` UI Design Specifications

1. **Props**:
   Destructure `targetPlatform = 'DATASPHERE', setTargetPlatform` from props in `StepOrigin`.

2. **Component Implementation (Recommended: `ToggleButtonGroup`)**:
   Add right between `Access Domain` and `Critical Status`:
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
       sx={{ height: 38 }}
     >
       <ToggleButton
         value="DATASPHERE"
         sx={{
           fontWeight: 600,
           textTransform: 'none',
           gap: 1,
           '&.Mui-selected': { bgcolor: 'info.lighter', color: 'info.main', borderColor: 'info.main' }
         }}
       >
         <Cloud size={16} /> SAP Datasphere
       </ToggleButton>
       <ToggleButton
         value="DATABRICKS"
         sx={{
           fontWeight: 600,
           textTransform: 'none',
           gap: 1,
           '&.Mui-selected': { bgcolor: 'warning.lighter', color: 'warning.main', borderColor: 'warning.main' }
         }}
       >
         <Flame size={16} /> Databricks
       </ToggleButton>
       <ToggleButton
         value="BOTH"
         sx={{
           fontWeight: 600,
           textTransform: 'none',
           gap: 1,
           '&.Mui-selected': { bgcolor: 'secondary.lighter', color: 'secondary.main', borderColor: 'secondary.main' }
         }}
       >
         <Layers size={16} /> Both Platforms
       </ToggleButton>
     </ToggleButtonGroup>
     <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
       {targetPlatform === 'DATASPHERE' && 'Generates flat HANA authorization tables for SAP Datasphere.'}
       {targetPlatform === 'DATABRICKS' && 'Generates Unity Catalog row-level filters and access grants for Databricks.'}
       {targetPlatform === 'BOTH' && 'Synchronizes policies simultaneously to both SAP Datasphere and Databricks.'}
     </Typography>
   </Box>
   ```
   *Alternative Option*:
   If a standard dropdown is preferred, use a `SearchableSelect` or MUI `FormControl` with `Select`:
   ```tsx
   <FormControl fullWidth size="small" disabled={isReadOnly} sx={{ mt: 1 }}>
     <InputLabel id="target-platform-label">Target Platform</InputLabel>
     <Select
       labelId="target-platform-label"
       value={targetPlatform}
       label="Target Platform"
       onChange={(e) => setTargetPlatform(e.target.value as any)}
     >
       <MenuItem value="DATASPHERE">SAP Datasphere</MenuItem>
       <MenuItem value="DATABRICKS">Databricks</MenuItem>
       <MenuItem value="BOTH">Both Platforms (Datasphere + Databricks)</MenuItem>
     </Select>
   </FormControl>
   ```
   *Recommendation*: `ToggleButtonGroup` provides superior UX with immediate single-click selection and distinct icons (`Cloud`, `Flame`, `Layers` from `lucide-react`).

---

### 2.3 Task 3: `StepReview.tsx` Display Specifications

1. **Props**:
   Destructure `targetPlatform = 'DATASPHERE'` from props in `StepReview`.

2. **UI Display in "Role Summary" Card**:
   In lines 20–39 of `StepReview.tsx`, render the target platform chip in the summary grid:
   ```tsx
   <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 2 }}>
     <Box>
       <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Name</Typography>
       <Typography variant="body1" sx={{ fontWeight: 700, color: 'primary.light' }}>{roleName || '—'}</Typography>
     </Box>
     <Box>
       <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Type & Environment</Typography>
       <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
         <Chip
           label={roleType === 'ORG_BASED' ? 'Org Role' : (selectedParentIds.length > 0 ? 'Derived' : 'Single')}
           size="small"
           color={roleType === 'ORG_BASED' ? 'primary' : 'secondary'}
         />
         <Chip
           label={environments.find(e => e.ID === environmentId)?.name || environmentId}
           size="small"
           color={ENV_COLOR[environmentId] || 'default'}
         />
         <Chip
           label={
             targetPlatform === 'BOTH' ? 'Both Platforms' :
             targetPlatform === 'DATABRICKS' ? 'Databricks' : 'SAP Datasphere'
           }
           size="small"
           color={
             targetPlatform === 'BOTH' ? 'secondary' :
             targetPlatform === 'DATABRICKS' ? 'warning' : 'info'
           }
           variant="outlined"
           sx={{ fontWeight: 600 }}
         />
       </Box>
     </Box>
   </Box>
   ```

---

### 2.4 Task 4: `RolesDashboard.tsx` & `RoleCard.tsx` Specifications

1. **`RoleCard.tsx` Platform Chip**:
   - Palette standard:
     * `DATASPHERE` → `color="info"` (Blue)
     * `DATABRICKS` → `color="warning"` (Orange / Amber)
     * `BOTH` → `color="secondary"` (Purple)
   - Standard View (lines 280–286):
     Add platform Chip beside role type:
     ```tsx
     <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
       <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>{role.name}</Typography>
       <Chip size="small" label={role.type} color={isOrgRole ? 'primary' : isDerived ? 'secondary' : 'default'} />
       <Chip
         size="small"
         label={
           role.targetPlatform === 'BOTH' ? 'Datasphere + Databricks' :
           role.targetPlatform === 'DATABRICKS' ? 'Databricks' : 'Datasphere'
         }
         color={
           role.targetPlatform === 'BOTH' ? 'secondary' :
           role.targetPlatform === 'DATABRICKS' ? 'warning' : 'info'
         }
         variant="outlined"
         sx={{ fontSize: '0.75rem', fontWeight: 600 }}
       />
       {role.critical && <Chip size="small" label="Critical (Manual)" color="error" />}
     </Box>
     ```
   - Compact View (lines 224–227):
     ```tsx
     <Chip
       size="small"
       label={role.targetPlatform === 'BOTH' ? 'Both' : role.targetPlatform === 'DATABRICKS' ? 'Databricks' : 'Datasphere'}
       color={role.targetPlatform === 'BOTH' ? 'secondary' : role.targetPlatform === 'DATABRICKS' ? 'warning' : 'info'}
       variant="outlined"
       sx={{ fontSize: '0.7rem' }}
     />
     ```
   - Context Details (lines 289–306):
     Add metadata row:
     ```tsx
     <Typography variant="caption" color="text.secondary">
       <strong>Platform:</strong> {role.targetPlatform === 'BOTH' ? 'Both' : (role.targetPlatform || 'DATASPHERE')}
     </Typography>
     ```

2. **`RolesDashboard.tsx` Platform Filter**:
   - Platform options constant:
     ```ts
     const PLATFORM_FILTER_OPTIONS = [
       { value: 'ALL', label: 'All Platforms' },
       { value: 'DATASPHERE', label: 'SAP Datasphere' },
       { value: 'DATABRICKS', label: 'Databricks' },
       { value: 'BOTH', label: 'Both Platforms' }
     ];
     ```
   - State:
     ```ts
     const [platformFilter, setPlatformFilter] = useState('ALL');
     ```
   - Filter Toolbar (lines 225–297):
     Add `SearchableSelect`:
     ```tsx
     <SearchableSelect
       options={PLATFORM_FILTER_OPTIONS}
       value={platformFilter}
       onChange={(val) => {
         setPlatformFilter(val);
         setPage(0);
       }}
       label="Platform"
       sx={{ minWidth: 160 }}
     />
     ```
   - In `filteredRoles` `useMemo` (lines 118–149):
     ```ts
     const hasPlatform = platformFilter !== 'ALL';
     // inside filter callback:
     if (hasPlatform) {
       const rolePlatform = r.targetPlatform || 'DATASPHERE';
       if (platformFilter === 'DATASPHERE' && rolePlatform !== 'DATASPHERE' && rolePlatform !== 'BOTH') return false;
       if (platformFilter === 'DATABRICKS' && rolePlatform !== 'DATABRICKS' && rolePlatform !== 'BOTH') return false;
       if (platformFilter === 'BOTH' && rolePlatform !== 'BOTH') return false;
     }
     ```
   - Filter reset & active indicator:
     Include `platformFilter !== 'ALL'` in `isFilterActive` (line 182) and `setPlatformFilter('ALL')` in reset handler (line 284).

3. **`RoleTableView.tsx` (Table View)**:
   In `RoleTableView.tsx`, include the same platform Chip in the `Type` table cell or as a new column, ensuring consistency across all three view modes (Tree, Grid, Table).

---

### 2.5 Task 5: `AccessDomainsView.tsx` & `HierarchicalManager.tsx` Specifications

1. **`HierarchicalManager.tsx` Interface Extension**:
   Add new prop:
   ```ts
   showTargetPlatformSelector?: boolean; // default false
   ```
   Forward `showTargetPlatformSelector` to child `NodeRow` instances.

2. **Platform Options**:
   ```ts
   const ACCESS_DOMAIN_PLATFORM_OPTIONS = [
     { value: 'BOTH', label: 'Both Platforms' },
     { value: 'DATASPHERE', label: 'SAP Datasphere' },
     { value: 'DATABRICKS', label: 'Databricks' },
   ];
   ```

3. **Root Node Creation (`handleAddRoot`, lines 836–865)**:
   - State: `const [newRootPlatform, setNewRootPlatform] = useState<'DATASPHERE' | 'DATABRICKS' | 'BOTH'>('BOTH');`
   - UI: If `showTargetPlatformSelector` is true, render a `SearchableSelect` for `newRootPlatform` in the "Add Node" card (lines 938–989).
   - In `handleAddRoot`:
     ```ts
     if (showTargetPlatformSelector) {
       payload.targetPlatform = newRootPlatform || 'BOTH';
     }
     ```
   - Reset on success: `setNewRootPlatform('BOTH');`

4. **Child Node Creation (`handleAddChild`, lines 189–221)**:
   - State in `NodeRow`: `const [newChildPlatform, setNewChildPlatform] = useState<'DATASPHERE' | 'DATABRICKS' | 'BOTH'>('BOTH');`
   - UI: If `showTargetPlatformSelector` is true, render a `SearchableSelect` for `newChildPlatform` in the inline `showAddChild` card (lines 564–616).
   - In `handleAddChild`:
     ```ts
     if (showTargetPlatformSelector) {
       payload.targetPlatform = newChildPlatform || 'BOTH';
     }
     ```
   - Reset on success: `setNewChildPlatform('BOTH');`

5. **Node Rename / Editing (`handleRename`, lines 243–265)**:
   - State in `NodeRow`: `const [editPlatform, setEditPlatform] = useState(node.targetPlatform || 'BOTH');`
   - Sync when edit opens: `setEditPlatform(node.targetPlatform || 'BOTH');`
   - UI: If `showTargetPlatformSelector` is true, render platform selector in the inline editing row (lines 375–410).
   - In `handleRename`:
     ```ts
     if (showTargetPlatformSelector) {
       payload.targetPlatform = editPlatform || 'BOTH';
     }
     ```

6. **Node Display in `NodeRow`** (lines 411–430):
   If `showTargetPlatformSelector` is true or `node.targetPlatform` is present, display a platform Chip:
   ```tsx
   <Chip
     label={
       node.targetPlatform === 'DATASPHERE' ? 'Datasphere' :
       node.targetPlatform === 'DATABRICKS' ? 'Databricks' : 'Both Platforms'
     }
     size="small"
     color={
       node.targetPlatform === 'DATASPHERE' ? 'info' :
       node.targetPlatform === 'DATABRICKS' ? 'warning' : 'secondary'
     }
     variant="outlined"
     sx={{ height: 20, fontSize: '10px', fontWeight: 600, ml: 1 }}
   />
   ```

7. **`AccessDomainsView.tsx` Wiring**:
   Update `AccessDomainsView.tsx` (line 11) to pass:
   ```tsx
   showTargetPlatformSelector={true}
   ```
   *(Note: `OrgStructureView.tsx` leaves this prop undefined/false, so OrgNodes are completely unaffected)*.

---

## 3. Caveats

1. **Backend Default vs. Frontend Default**:
   - `Roles.targetPlatform` defaults to `'DATASPHERE'` in backend CDS schema.
   - `AccessDomains.targetPlatform` defaults to `'BOTH'` in backend CDS schema.
   - The wizard and access domain forms should align with these exact defaults:
     * Wizard new role state: default `'DATASPHERE'`
     * Access Domain new node state: default `'BOTH'`
2. **Filter Matching Semantics**:
   When filtering by "SAP Datasphere", roles configured for `'BOTH'` should be included because they apply to Datasphere. Similarly, filtering by "Databricks" includes `'BOTH'`. Filtering by "Both Platforms" specifically matches roles where `targetPlatform === 'BOTH'`.
3. **Vitest `WizardDialogs.test.tsx` Mock Expectations**:
   Existing Vitest tests mock `api.updateRole` and assert exact argument payloads. When adding `targetPlatform` to `deepPayload` in `useWizardState.ts`, test assertions checking `updateRole` or `createRole` will need `targetPlatform: 'DATASPHERE'` or `expect.objectContaining(...)` to match the enriched payload (to be addressed by Milestone 5 test migration).
4. **No Code Modification by Explorer**:
   As an Explorer agent, zero code edits were made to the source codebase. All findings and component specifications are documented here for Worker M4.

---

## 4. Conclusion & Recommendations for Worker M4

The investigation reveals a clear and modular path for implementing multi-target platform selection:

1. **State Wiring (`useWizardState.ts`)**:
   Introduce `targetPlatform` with default `'DATASPHERE'`, hydrate on edit mode, inherit from parent role when deriving, include in all three `deepPayload` objects in `handleDeploy`, and export from hook.
2. **Wizard Step 1 (`StepOrigin.tsx`)**:
   Add a clean `ToggleButtonGroup` with `Cloud`, `Flame`, `Layers` icons and descriptions for Datasphere, Databricks, and Both Platforms.
3. **Wizard Step 4 (`StepReview.tsx`)**:
   Add a color-coded Chip in the Role Summary card to give clear pre-deployment visibility of target platform.
4. **Roles Catalog (`RoleCard.tsx` & `RolesDashboard.tsx`)**:
   Add colored Chip on `RoleCard` (`info` for Datasphere, `warning` for Databricks, `secondary` for Both) and add `SearchableSelect` platform filter to `RolesDashboard`.
5. **Access Domains (`AccessDomainsView.tsx` & `HierarchicalManager.tsx`)**:
   Add `showTargetPlatformSelector={true}` prop to `HierarchicalManager` so root creation, child creation, and editing can set `targetPlatform` (defaulting to `'BOTH'`) without impacting `OrgStructureView`.

---

## 5. Verification Method

To verify the implementation once applied by Worker M4:

1. **Production Frontend Build**:
   ```bash
   npm run build --prefix app/catalog
   ```
   Must succeed with exit code 0 and zero TypeScript/Vite bundling errors.
2. **Interactive UI Verification**:
   - Start full dev stack: `npm run dev`
   - Open browser at `http://localhost:5173/`
   - Navigate to "Roles & Governance Catalog":
     * Verify platform badges appear on role cards.
     * Select "Databricks" in platform filter and verify only Databricks and Both roles appear.
     * Select "SAP Datasphere" and verify only Datasphere and Both roles appear.
   - Click "Create Role" (Wizard):
     * Verify "Target Platform" selector in Step 1 (Origin & Parent).
     * Toggle between Datasphere, Databricks, and Both.
     * Proceed to Step 4 (Review & Deploy) and verify platform chip in Role Summary card.
   - Navigate to "Access Domains":
     * Click "Add Node" and verify platform selector defaults to "Both Platforms".
     * Verify created/existing domains show platform badge.
3. **Invalidation Conditions**:
   - If `npm run build --prefix app/catalog` fails with type or JSX errors.
   - If `targetPlatform` is omitted from `POST /Roles` or `PATCH /Roles` payloads.
   - If `OrgStructureView` inadvertently displays the platform selector.
