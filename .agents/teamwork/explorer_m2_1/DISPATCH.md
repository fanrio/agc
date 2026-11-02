## 2026-11-01T21:15:02Z

You are Explorer 1 for Milestone 2 (Databricks Unity Catalog Policy Sync) of fanrio-auth.
Your working directory is: c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_1

You MUST read:
- c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\ORIGINAL_REQUEST.md
- c:\Users\Fan\Documents\fanrio-auth\PROJECT.md
- c:\Users\Fan\Documents\fanrio-auth\.agents\AGENTS.md
- c:\Users\Fan\Documents\fanrio-auth\TEST_INFRA.md

Git branch: feature/databricks-direct-sync

Your focus:
1. Design the SQL boolean predicate generator for Unity Catalog row filters in `srv/services/databricksSyncService.js`:
   - Enumerate all 11 filter types supported in fanrio-auth:
     * `SINGLE_VALUE` -> `col = 'val'`
     * `MULTI_VALUE` -> `col IN ('val1', 'val2')` (handle string arrays and comma-separated)
     * `RANGE` & `BT` -> `(col >= 'from' AND col <= 'to')` (handle JSON {"from", "to"})
     * `CP` (Contains Pattern) -> `col LIKE 'pat%'` (translate '*' to '%' and '?' to '_')
     * `PATTERN` -> `col LIKE 'pat%'`
     * `NE` -> `col <> 'val'`
     * `GT` -> `col > 'val'`
     * `GE` -> `col >= 'val'`
     * `LT` -> `col < 'val'`
     * `LE` -> `col <= 'val'`
     * `NULL` -> `col IS NULL`
     * `NOT NULL` -> `col IS NOT NULL`
   - Handle SQL escaping: safely escape single quotes in values (`val.replace(/'/g, "''")`).
   - Intra-role conjunction: restrictions on multiple fields for the same role are combined with `AND`.
   - User identity binding: wrap predicate with `(current_user() = 'alice' AND (...))` or `(is_account_group_member('role_group') AND (...))`.
   - Composite multi-user policy: when multiple users or roles are assigned to the same table, predicates are joined with `OR`:
     `RETURN (current_user() = 'alice' AND (col1 = 'US')) OR (current_user() = 'bob' AND (col1 = 'EU'))`
2. Provide exact implementation functions, regexes, and test cases for Worker.
Write your report to `c:\Users\Fan\Documents\fanrio-auth\.agents\teamwork\explorer_m2_1\report.md`.
Send a completion message to parent when done.
