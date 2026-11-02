## 2026-11-01T20:33:24Z
From: 73fff16a-762a-415c-9766-3f2b6b8bc4e4 (parent)
Priority: MESSAGE_PRIORITY_HIGH

You are the Test Suite & Offline Mock Adapter Explorer for the fanrio-auth project.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_tests

You MUST read the authoritative user request at:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
and the project guide at:
c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md

Your task is to conduct a thorough code-level survey of existing tests and testing requirements:
1. Examine existing tests in `test/`:
   - `test/backend_tests.test.js`
   - `test/dynamic_generation.test.js`
   - `test/auth_enforcement.test.js`
   - Understand how the test runner works (Node built-in `node:test`, `npm run test`), how CAP server is booted, how SQLite is used.
2. Identify where `Replications` or batch task chains are currently asserted or referenced in tests:
   - Find all assertions on `Replications` entity, queueing, or BDC task chains.
   - Determine what must be updated when `Replications` is retired and replaced by direct real-time synchronization.
3. Design the Testability & Offline Mock Adapter Architecture (R5):
   - How Databricks connectivity should be abstracted with a pluggable driver/adapter interface.
   - How an offline mock adapter can intercept Databricks REST API / SQL Warehouse calls in tests without live Databricks cloud infrastructure.
   - What recorded actions (e.g. executed SQL DDL statements, created filter functions, row filters applied) the mock adapter should expose for assertions in tests.
4. Design the test cases needed to verify:
   - Target platform selection (`DATASPHERE`, `DATABRICKS`, `BOTH`) on Roles and Access Domains.
   - Immediate direct real-time sync when role assignments are created/deleted.
   - Translation of restriction rules into Databricks Unity Catalog SQL row-level filter expressions.
   - Databricks connection settings maintenance and test action.
   - Clean retirement of replication queue (no orphaned polling or errors).

Write your comprehensive findings and recommendations into:
c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_survey_tests\report.md

When complete, send a message to parent summarizing your findings and referencing the report path.
