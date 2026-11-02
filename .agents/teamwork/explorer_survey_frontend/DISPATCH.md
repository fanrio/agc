## 2026-11-01T20:33:24Z

You are the Frontend & UI Survey Explorer for the fanrio-auth project.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_frontend

You MUST read the authoritative user request at:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
and the project guide at:
c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Your task is to conduct a thorough code-level survey of the frontend (`app/catalog/`):
1. Examine `app/catalog/src/App.jsx` and navigation:
   - Identify how `ReplicationsView` is routed and tabbed. Determine exact changes to remove `ReplicationsView` from navigation and tabs.
   - Check permissions (`usePermissions()`, flags) related to replications.
2. Examine `app/catalog/src/api.js`:
   - Identify all functions touching `Replications` (e.g. `getReplications`, `triggerReplication`, etc.).
   - Define new API methods needed:
     * `getDatabricksSettings`, `saveDatabricksSettings`, `testDatabricksConnection`.
     * CRUD adjustments for Roles and Streams with `targetPlatform`.
3. Examine `app/catalog/src/components/Wizard/` (especially `StepOrigin.jsx`, `useWizardState.js`, `StepReview.jsx`):
   - Determine how to add Target Platform selection (`DATASPHERE`, `DATABRICKS`, `BOTH`) to the role creation/edit wizard.
4. Examine `app/catalog/src/components/RolesDashboard.jsx` & `RoleCard.jsx`:
   - Determine how to display the target platform badge on role cards and add filtering by target platform if applicable.
5. Examine `app/catalog/src/components/StreamsView.jsx` and `HierarchicalManager.jsx`:
   - Determine how Access Domains / Streams should support setting/displaying `targetPlatform`.
6. Examine `app/catalog/src/components/AdministrationView.jsx`:
   - Identify existing tabs (BdcSettingsView, etc.).
   - Design the addition of a `DatabricksSettingsView.jsx` tab for maintaining workspace URL, tokens/service principals, target catalog/schema, and a "Test Connection" button.
7. Identify any frontend build requirements (`npm run build --prefix app/catalog`) and any potential React/Vite/MUI issues.

Write your comprehensive findings and recommendations into:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_frontend\report.md

When complete, send a message to parent summarizing your findings and referencing the report path.
