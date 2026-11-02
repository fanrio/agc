## 2026-11-02T16:39:56Z
You are Explorer M4-3 for Milestone 4 (Frontend UI Platform Selection & Admin Settings).
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_3

Read the following authoritative documents before starting:
- ORIGINAL_REQUEST: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT: c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- AGENTS: c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Your Scope:
Investigate Databricks connection settings view and administration integration:
- `app/catalog/src/components/DatabricksSettingsView.jsx` (or `.tsx` — new component to be created)
- `app/catalog/src/components/AdministrationView.jsx` (or `SystemView.jsx`)
- `app/catalog/src/components/BdcSettingsView.jsx` (as reference for administration settings pattern)
- `app/catalog/src/components/BdcApiTesterView.jsx` (as reference for API testing pattern)

Tasks:
1. Examine `AdministrationView` (or `SystemView`):
   - Inspect how existing admin tabs (e.g. BDC Settings, Restriction Fields, Environments, Dynamic Rules) are rendered, tabbed, and permission-gated (`canManageSettings`).
   - Identify where the new "Databricks Settings" tab should be added.
2. Inspect `BdcSettingsView.jsx` to understand the established design pattern for settings views:
   - Data fetching on load (`useEffect`), state management for form fields, edit/save mode, notification snackbars/alerts, loading states.
3. Design `DatabricksSettingsView`:
   - Form fields: `systemName`, `environment_ID` (dropdown of available Environments), `workspaceUrl`, `authType` (`TOKEN` | `SERVICE_PRINCIPAL`), `apiToken` (password/masked input), `clientId`, `clientSecret` (masked input), `targetCatalog`, `targetSchema`, `sqlWarehouseId`, `isActive` (Switch).
   - Interactive "Test Connection" button calling `testDatabricksConnection(settingId)`:
     * Disables while testing (loading spinner).
     * Displays result banner/alert (success green with message, or error red with message and HTTP status).
   - CRUD support: create new setting, edit existing, delete setting.
4. Verify backend OData projection compatibility with `srv/cortex_service.cds` (`DatabricksSettings` entity and `testDatabricksConnection` action).

Output:
Write a comprehensive investigation report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m4_3\handoff.md` with:
- Observation (existing patterns, files, and line numbers)
- Logic Chain (complete component architecture, state variables, and handlers for Worker M4)
- Caveats
- Conclusion & Recommendation for Worker M4
Send a completion message back to parent orchestrator via `send_message`. Do NOT implement any code changes yourself.
