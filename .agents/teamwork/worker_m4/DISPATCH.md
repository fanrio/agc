## 2026-11-02T16:50:48Z
You are Worker M4 for Milestone 4 (Frontend UI Platform Selection & Admin Settings).
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m4

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Authoritative Documents & Explorer Blueprints:
- ORIGINAL_REQUEST: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT: c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- AGENTS: c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md
- Explorer M4-1 Handoff (API Client & App Shell): c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_1\handoff.md
- Explorer M4-2 Handoff (Role Wizard & Dashboard): c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_2\handoff.md
- Explorer M4-3 Handoff (Databricks Settings & System View): c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_3\handoff.md

Your Exclusive Write Ownership:
- `app/catalog/src/api.ts`
- `app/catalog/src/App.tsx`
- `app/catalog/src/components/ReplicationsView.tsx` (remove/delete dead file)
- `app/catalog/src/components/DatabricksSettingsView.tsx` (create new)
- `app/catalog/src/components/SystemView.tsx`
- `app/catalog/src/components/Wizard/useWizardState.ts`
- `app/catalog/src/components/Wizard/steps/StepOrigin.tsx`
- `app/catalog/src/components/Wizard/steps/StepReview.tsx`
- `app/catalog/src/components/RoleCard.tsx`
- `app/catalog/src/components/RolesDashboard.tsx`
- `app/catalog/src/components/AccessDomainsView.tsx`
- `app/catalog/src/components/HierarchicalManager.tsx`

Tasks to Implement:

1. `app/catalog/src/api.ts`:
   - Remove obsolete replication functions (`getReplications`, `triggerReplication`, `checkReplicationStatuses`).
   - Add typed Databricks settings CRUD and connection test functions:
     * `getDatabricksSettings()` -> `GET /DatabricksSettings?$expand=environment`
     * `createDatabricksSetting(body)` -> `POST /DatabricksSettings`
     * `updateDatabricksSetting(id, body)` -> `PATCH /DatabricksSettings('${id}')`
     * `deleteDatabricksSetting(id)` -> `DELETE /DatabricksSettings('${id}')`
     * `testDatabricksConnection(settingId)` -> `POST /testDatabricksConnection` with `{ settingId }`

2. `app/catalog/src/App.tsx`:
   - Remove `ReplicationsView` lazy import (line 46).
   - Remove `'replications'` from `validNavs` (line 69).
   - Remove line 143 (`if (item.id === 'replications') ...`).
   - Remove line 325 (`{activeNav === 'replications' && <ReplicationsView />}`).
   - Delete `app/catalog/src/components/ReplicationsView.tsx`.

3. `app/catalog/src/components/DatabricksSettingsView.tsx` & `SystemView.tsx`:
   - Create `DatabricksSettingsView.tsx` following the blueprint in Explorer M4-3 report:
     * Full CRUD with MUI v7 Grid (`<Grid size={{ xs: 12, sm: ... }}>`).
     * Form fields: `systemName`, `environment_ID`, `workspaceUrl`, `authType` (`TOKEN` | `SERVICE_PRINCIPAL`), `apiToken`, `clientId`, `clientSecret`, `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive`.
     * Non-destructive PATCH: on edit, omit empty `apiToken` and `clientSecret` from the update payload so stored credentials are NOT wiped.
     * Interactive "Test Connection" button calling `testDatabricksConnection(id)` with loading spinner and alert banner.
     * Delete confirmation dialog.
   - In `SystemView.tsx`:
     * Lazy-import `DatabricksSettingsView`.
     * Add `Databricks Settings` tab in `allTabs` immediately following `BDC Connections`, gated by `permissions?.isSuperAdmin || permissions?.canManageSettings`.

4. Role Wizard (`useWizardState.ts`, `StepOrigin.tsx`, `StepReview.tsx`):
   - In `useWizardState.ts`:
     * Add `targetPlatform` to state (`'DATASPHERE' | 'DATABRICKS' | 'BOTH'`, default `'DATASPHERE'`).
     * Hydrate `targetPlatform` in edit mode.
     * Inherit parent's `targetPlatform` when deriving in create mode.
     * Include `targetPlatform` in `deepPayload` across all 3 branches in `handleDeploy` (Edit mode, Org-based mode, Create mode).
     * Export `targetPlatform` and `setTargetPlatform`.
   - In `StepOrigin.tsx`:
     * Add `targetPlatform` selector (e.g. `ToggleButtonGroup` with `Cloud`, `Flame`, `Layers` icons and descriptions for Datasphere, Databricks, Both).
   - In `StepReview.tsx`:
     * Display `targetPlatform` chip in the Role Summary card.

5. Roles Catalog (`RoleCard.tsx`, `RolesDashboard.tsx`):
   - In `RoleCard.tsx`:
     * Render colored chip for `targetPlatform` (e.g. `info` for Datasphere, `warning` for Databricks, `secondary` for Both) on standard and compact views.
   - In `RolesDashboard.tsx`:
     * Add platform filter dropdown in filter toolbar (`All Platforms`, `SAP Datasphere`, `Databricks`, `Both Platforms`).
     * Filter `filteredRoles` accordingly (matching roles supporting the selected platform).

6. Access Domains (`AccessDomainsView.tsx`, `HierarchicalManager.tsx`):
   - In `HierarchicalManager.tsx`:
     * Add prop `showTargetPlatformSelector?: boolean` (default false).
     * When true, allow selecting `targetPlatform` on root node creation, child node creation, and node editing (default `'BOTH'`).
     * Display platform chip on node rows when present.
   - In `AccessDomainsView.tsx`:
     * Pass `showTargetPlatformSelector={true}`.

Verification Commands:
- `npm run build --prefix app/catalog` -> MUST compile with 0 errors and produce a clean production bundle.
- `node --test test/direct_sync_dispatcher.test.js test/databricks_sync.test.js` -> ensure backend tests still pass.

Output:
Write your completion handoff report to:
`c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\worker_m4\handoff.md`
following the 5-component protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
Then notify parent orchestrator via `send_message`.
