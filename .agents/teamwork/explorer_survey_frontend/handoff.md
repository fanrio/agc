# Handoff Report — Frontend & UI Survey for Databricks & Multi-Target Direct Sync

## 1. Observation

1. **File Locations & Languages**:
   - Application source code lives in `app/catalog/src/` using TypeScript (`.ts` and `.tsx`).
   - `App.tsx` exists at `app/catalog/src/App.tsx` (not `.jsx`).
   - `api.ts` exists at `app/catalog/src/api.ts` (not `.js`).
   - The administration view is `app/catalog/src/components/SystemView.tsx` (not `AdministrationView.jsx`).
   - The streams view is `app/catalog/src/components/AccessDomainsView.tsx` (not `StreamsView.jsx`).

2. **ReplicationsView References in `App.tsx`**:
   - `app/catalog/src/App.tsx:46`: `const ReplicationsView = lazy(() => import('./components/ReplicationsView'));`
   - `app/catalog/src/App.tsx:69`: `const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard', 'replications'];`
   - `app/catalog/src/App.tsx:143`: `if (item.id === 'replications') return !!permissions?.canManageReplications;`
   - `app/catalog/src/App.tsx:325`: `{activeNav === 'replications' && <ReplicationsView />}`
   - The navigation array `NAV` (lines 52–61) does not contain a replications item; it was only accessible via direct hash `#replications`.

3. **Replications in `api.ts`**:
   - `app/catalog/src/api.ts:227`: `export const getReplications = () => request('GET', '/Replications?$orderby=replicationDate desc');`
   - `app/catalog/src/api.ts:228`: `export const triggerReplication = () => request('POST', '/triggerReplication', {});`
   - `app/catalog/src/api.ts:229`: `export const checkReplicationStatuses = () => request('POST', '/checkReplicationStatuses', {});`

4. **Wizard State & Form Components**:
   - `app/catalog/src/components/Wizard/useWizardState.ts`:
     * Line 22: `const [roleType, setRoleType] = useState(...)`
     * Lines 47–55: Role level configuration states (`critical`, `environmentId`, `accessDomainId`, `assignUserId`).
     * Lines 453–513: Payload construction in `handleDeploy` sends `name`, `type`, `description`, `critical`, `environment_ID`, `accessDomain_ID`, `ownRestrictions`, `parentRoles`, `approvers`.
   - `app/catalog/src/components/Wizard/steps/StepOrigin.tsx:120-144`: Contains `EnvironmentSelection` and `SearchableSelect` for `Access Domain`.
   - `app/catalog/src/components/Wizard/steps/StepReview.tsx:28-38`: Displays role type and environment chips.

5. **Roles Dashboard & Cards**:
   - `app/catalog/src/components/RolesDashboard.tsx:43-45`: Filter states `healthFilter`, `envFilter`, `typeFilter`.
   - `app/catalog/src/components/RolesDashboard.tsx:123-149`: `filteredRoles` `useMemo` applies type, environment, health, and search queries.
   - `app/catalog/src/components/RoleCard.tsx:282`: Standard card renders `<Chip size="small" label={role.type} ... />`.
   - `app/catalog/src/components/RoleCard.tsx:225`: Compact card renders environment and critical chips.

6. **System Administration Tabs (`SystemView.tsx`)**:
   - `app/catalog/src/components/SystemView.tsx:17-54`: Defines `allTabs`:
     1. BDC Connections (`<BdcSettingsView />`)
     2. Restriction Fields (`<RestrictionFieldsView />`)
     3. Access Domains (`<AccessDomainsView />`)
     4. Dynamic Rules (`<DynamicRulesView />`)
     5. Master Data Editor (`<MasterDataEditorView />`)
     6. BDC API Tester (`<BdcApiTesterView />`)
   - `BdcSettingsView.tsx` (714 lines) manages BDC credentials and has a working `handleTestConnection` calling `api.testBdcConnection(id)`.

7. **Build Baseline**:
   - `npm run build --prefix app/catalog` exited with code 0 in 2.24s transforming 2,850 modules and generating `dist/catalog.zip`.

---

## 2. Logic Chain

1. **Replications Decommissioning**:
   - Observation 2 shows `ReplicationsView` is only invoked in `App.tsx` via `#replications` hash and lazy load.
   - Observation 3 shows `api.ts` defines 3 replication endpoints (`getReplications`, `triggerReplication`, `checkReplicationStatuses`).
   - Removing lines 46, 69, 143, and 325 from `App.tsx`, deleting `ReplicationsView.tsx`, and removing the 3 methods from `api.ts` cleanly eliminates all frontend replication queue UI code with zero impact on other views.

2. **Target Platform Selection**:
   - Observation 4 shows `useWizardState.ts` manages all role properties and serializes them into `createRole` / `updateRole` payloads.
   - Adding a `targetPlatform` state (`'DATASPHERE' | 'DATABRICKS' | 'BOTH'`, default `'DATASPHERE'`) in `useWizardState.ts`, exposing it to `StepOrigin.tsx` (via a `ToggleButtonGroup` or select control), displaying it in `StepReview.tsx`, and passing it into `deepPayload` fulfills requirement R1 for roles.
   - Observation 1 shows Access Domains represents Streams; extending `HierarchicalManager.tsx` with a `showTargetPlatformSelector` prop enables configuring `targetPlatform` for Access Domains.

3. **Dashboard & Card Representation**:
   - Observation 5 shows `RolesDashboard.tsx` and `RoleCard.tsx` already support multi-dimensional filtering and status badges (env, type, critical).
   - Adding `platformFilter` to `RolesDashboard.tsx` and a platform chip to `RoleCard.tsx` and `RoleTableView.tsx` provides immediate visual governance and searchability without breaking existing layouts.

4. **Databricks Administration**:
   - Observation 6 shows `SystemView.tsx` is structured as a modular tab container, and `BdcSettingsView.tsx` establishes the exact architectural pattern for external connection settings (systemName, environment, URL, authType, token/credentials, test connection action).
   - Creating `DatabricksSettingsView.tsx` with fields for workspace URL, credentials (PAT token / Service Principal clientId + secret), target catalog, schema, warehouse ID, and a "Test Connection" button calling `api.testDatabricksConnection`, then adding it as tab 2 in `SystemView.tsx`, cleanly satisfies requirement R4.

5. **Build Integrity**:
   - Observation 7 proves that the frontend build cleanly passes. Adhering to TypeScript types, existing MUI v7 components, and Lucide icons ensures zero build or bundling regressions.

---

## 3. Caveats

- **Backend Prerequisite**: The frontend changes depend on the backend CDS model exposing `targetPlatform` on `Roles` and `AccessDomains`, as well as the new `DatabricksSettings` entity and `testDatabricksConnection` action.
- **Permissions Flag Deprecation**: `canManageReplications` exists in the database table `AppAuthorizations`. It should be deprecated gracefully in `PermissionsContext.tsx` and `AppAuthorizationsView.tsx` so existing user permission records remain valid without errors.

---

## 4. Conclusion

The frontend codebase is well-structured and ready for multi-target platform support and replication queue retirement. All required changes have been mapped out to specific files and line numbers in `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_frontend\report.md`. Implementation can proceed cleanly in targeted slices across:
1. `App.tsx` and `api.ts` (retire `ReplicationsView`, add Databricks API endpoints).
2. `Wizard/` (`useWizardState.ts`, `StepOrigin.tsx`, `StepReview.tsx` - platform selection).
3. `RolesDashboard.tsx` & `RoleCard.tsx` (platform filter and badges).
4. `AccessDomainsView.tsx` & `HierarchicalManager.tsx` (access domain platform support).
5. `DatabricksSettingsView.tsx` & `SystemView.tsx` (Databricks workspace settings tab).

---

## 5. Verification Method

1. **Production Build Verification**:
   ```powershell
   npm run build --prefix app/catalog
   ```
   *Expected Result*: Exits with code 0, 0 compilation errors.
2. **Navigation Verification**:
   - Inspect `app/catalog/src/App.tsx` and confirm no import or rendering of `ReplicationsView`.
   - Access `http://localhost:5173/#replications` and verify it falls back to `#home`.
3. **Settings Verification**:
   - In `SystemView.tsx`, verify the "Databricks Settings" tab is visible and renders connection management controls.
4. **Wizard Verification**:
   - Open Role Wizard and verify `Target Platform` selection (`DATASPHERE`, `DATABRICKS`, `BOTH`) is selectable in Step 1 and displayed in Step 4.
