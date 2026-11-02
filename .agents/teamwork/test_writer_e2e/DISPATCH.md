## 2026-11-01T20:44:55Z
You are the E2E Testing Track Test Writer for the fanrio-auth project.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\test_writer_e2e

You MUST read:
- The authoritative user request: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- The project specification: c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- The project rules: c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Git branch: feature/databricks-direct-sync

Your mission is to establish the E2E Testing Track:
1. Create `TEST_INFRA.md` at `c:\Users\Fan\Documents\fanrio-auth\TEST_INFRA.md` using the standard template:
   - Test philosophy: Opaque-box, requirement-driven, derived from ORIGINAL_REQUEST.md.
   - Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing.
   - Feature Inventory mapping for all 14 features from PROJECT.md across Tiers 1-4.
   - Test runner command: `$env:CDS_ENV="test"; node --test --test-concurrency=1 test/e2e_direct_sync.test.js`
2. Create the comprehensive opaque-box test suite at `c:\Users\Fan\Documents\fanrio-auth\test\e2e_direct_sync.test.js`:
   - Must use Node native test runner (`node:test`, `node:assert`).
   - Mock Databricks via pluggable driver/adapter pattern (`DatabricksClient.setAdapter(...)`) or mock driver so all tests run offline without external cloud credentials.
   - Test cases across Tiers 1-4:
     * Tier 1: Feature coverage (platform selection on roles/domains, DatabricksSettings CRUD, testDatabricksConnection action, direct sync on assignment create/delete, Unity Catalog SQL filter generation, retirement of queue actions).
     * Tier 2: Boundary & Corner Cases (empty restriction values, wildcards, multiple values, case sensitivity, invalid platform strings, invalid/missing credentials in test connection, role inheritance depth).
     * Tier 3: Cross-Feature Combinations (roles targeting BOTH platforms, derived roles inheriting restrictions with different targetPlatforms, multiple users assigned to the same Databricks role).
     * Tier 4: Real-World Application Scenarios (end-to-end user assignment lifecycle: role creation -> restriction definition -> user assignment -> immediate policy generation in Databricks mock and HANA mock -> assignment revocation -> immediate policy removal).
3. Once the test suite and infra are written, create `TEST_READY.md` at `c:\Users\Fan\Documents\fanrio-auth\TEST_READY.md` with:
   - Test runner invocation instructions
   - Tiered coverage summary table
   - Feature checklist
4. Write your handoff report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\test_writer_e2e\handoff.md`.
5. Send a message to parent summarizing the deliverable files and coverage.
