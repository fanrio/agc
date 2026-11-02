# Milestone 1: Data Model, Settings & Pluggable Driver — Exploration Report

**Author**: Explorer M1 1  
**Target Audience**: Milestone 1 Worker Agent & Orchestrator  
**Git Branch**: `feature/databricks-direct-sync`  
**Focus Area**: `db/schema.cds`, `srv/cortex_service.cds`, `db/data/fanrio.auth-DatabricksSettings.csv`, `npx cds deploy` Plan & Security Wiring

---

## 1. Executive Summary

This report specifies the exact data model definitions, OData service projections, CSV seed file structure, security handler configurations, and deployment steps required for **Milestone 1** of the Databricks Direct Sync extension in `fanrio-auth`.

### Key Findings
1. **TargetPlatform Type Definition**: Adding `type TargetPlatform : String(20) enum { DATASPHERE; DATABRICKS; BOTH; };` compiles cleanly to `NVARCHAR(20)` in SQLite and SAP HANA.
2. **Backward-Compatible Defaults**:
   - `Roles.targetPlatform` default `'DATASPHERE'` guarantees 100% backward compatibility with all 60 existing backend tests and UI flows.
   - `AccessDomains.targetPlatform` default `'BOTH'` enables domains to span both platforms as envisioned in `PROJECT.md` and `TEST_INFRA.md`.
3. **`DatabricksSettings` Entity**:
   - Inherits `cuid, managed` from `@sap/cds/common`, automatically providing UUID key generation (`ID`), creation audit (`createdAt`, `createdBy`), and update tracking (`modifiedAt`, `modifiedBy`).
   - Foreign key `environment : Association to Environments;` automatically generates relational column `environment_ID NVARCHAR(10)`.
   - `authType` supports `TOKEN` and `SERVICE_PRINCIPAL` with default `'TOKEN'`.
4. **Service Exposure**: Adding `entity DatabricksSettings as projection on db.DatabricksSettings;` in `srv/cortex_service.cds` exposes the entity under `/odata/v4/auth/DatabricksSettings`.
5. **Security Gating**: In `srv/handlers/systemHandlers.js`, `DatabricksSettings` must be guarded with `canManageSettings` on `CREATE`, `READ`, `UPDATE`, and `DELETE`.

---

## 2. Exact CDS Definitions & Code Changes

### 2.1 `db/schema.cds`

#### A. Add `TargetPlatform` Enum Type
- **Location**: In `db/schema.cds`, immediately after line 3 (`using { cuid, managed } from '@sap/cds/common';`).

**Before:**
```cds
namespace fanrio.auth;

using { cuid, managed } from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Organizational Structure
// ---------------------------------------------------------------------------
```

**After:**
```cds
namespace fanrio.auth;

using { cuid, managed } from '@sap/cds/common';

type TargetPlatform : String(20) enum {
  DATASPHERE;
  DATABRICKS;
  BOTH;
};

// ---------------------------------------------------------------------------
// Organizational Structure
// ---------------------------------------------------------------------------
```

---

#### B. Add `targetPlatform` to `AccessDomains`
- **Location**: In `db/schema.cds`, within `entity AccessDomains : managed { ... }` (around line 36–47).

**Before:**
```cds
entity AccessDomains : managed {
  key ID      : String(36);
  name        : String(10) not null;
  description : String(200);
  type        : Association to RestrictionFields;
  parent      : Association to AccessDomains;
  children    : Composition of many AccessDomains on children.parent = $self;
  attributes  : Composition of many AccessDomainAttributes on attributes.node = $self;
  restrictionFields : Composition of many AccessDomainFields on restrictionFields.domain = $self;
  roleTemplateName  : String(255);
}
```

**After:**
```cds
entity AccessDomains : managed {
  key ID      : String(36);
  name        : String(10) not null;
  description : String(200);
  type        : Association to RestrictionFields;
  parent      : Association to AccessDomains;
  children    : Composition of many AccessDomains on children.parent = $self;
  attributes  : Composition of many AccessDomainAttributes on attributes.node = $self;
  restrictionFields : Composition of many AccessDomainFields on restrictionFields.domain = $self;
  roleTemplateName  : String(255);
  targetPlatform    : TargetPlatform default 'BOTH';
}
```

---

#### C. Add `targetPlatform` to `Roles`
- **Location**: In `db/schema.cds`, within `entity Roles : managed { ... }` (around line 63–77).

**Before:**
```cds
entity Roles : managed {
  key ID          : String(36)  @default : 'uuid()';
  name            : String(200) not null;
  type            : String(20)  not null;  // ORG_BASED | DERIVED
  description     : String(500);
  critical        : Boolean @default : false;
  environment     : Association to Environments;
  orgNode         : Association to OrgNodes;  // for ORG_BASED roles
  accessDomain    : Association to AccessDomains;
  parentRoles     : Composition of many RoleInheritance on parentRoles.role = $self;
  childRoles      : Association to many RoleInheritance on childRoles.parent = $self;
  ownRestrictions : Composition of many Restrictions on ownRestrictions.role = $self;
  assignments     : Composition of many RoleAssignments on assignments.role = $self;
  approvers       : Composition of many RoleApprovers on approvers.role = $self;
}
```

**After:**
```cds
entity Roles : managed {
  key ID          : String(36)  @default : 'uuid()';
  name            : String(200) not null;
  type            : String(20)  not null;  // ORG_BASED | DERIVED
  description     : String(500);
  critical        : Boolean @default : false;
  targetPlatform  : TargetPlatform default 'DATASPHERE';
  environment     : Association to Environments;
  orgNode         : Association to OrgNodes;  // for ORG_BASED roles
  accessDomain    : Association to AccessDomains;
  parentRoles     : Composition of many RoleInheritance on parentRoles.role = $self;
  childRoles      : Association to many RoleInheritance on childRoles.parent = $self;
  ownRestrictions : Composition of many Restrictions on ownRestrictions.role = $self;
  assignments     : Composition of many RoleAssignments on assignments.role = $self;
  approvers       : Composition of many RoleApprovers on approvers.role = $self;
}
```

---

#### D. Create Entity `DatabricksSettings : cuid, managed`
- **Location**: In `db/schema.cds`, place directly after `BdcSettings` (around line 132).

**Code to Insert:**
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

**Detailed Element Specifications**:
| CDS Property | CDS Type | SQL Column Name | Nullable? | Default | Description |
|---|---|---|---|---|---|
| `ID` | `UUID` (via `cuid`) | `ID NVARCHAR(36)` | NO (Primary Key) | auto-UUID | Unique identifier |
| `createdAt` | `Timestamp` (via `managed`) | `createdAt TIMESTAMP_TEXT` | YES | Managed | Auto-audit timestamp |
| `createdBy` | `User` (via `managed`) | `createdBy NVARCHAR(255)` | YES | Managed | Auto-audit user |
| `modifiedAt` | `Timestamp` (via `managed`) | `modifiedAt TIMESTAMP_TEXT` | YES | Managed | Auto-audit timestamp |
| `modifiedBy` | `User` (via `managed`) | `modifiedBy NVARCHAR(255)` | YES | Managed | Auto-audit user |
| `systemName` | `String(100)` | `systemName NVARCHAR(100)` | NO | none | Friendly name (e.g. "Databricks Prod") |
| `environment` | `Association to Environments` | `environment_ID NVARCHAR(10)` | YES | null | Linked Environment (P, Q, D) |
| `workspaceUrl` | `String(255)` | `workspaceUrl NVARCHAR(255)` | YES | null | e.g. `https://adb-123.azuredatabricks.net` |
| `authType` | `String(20) enum { TOKEN; SERVICE_PRINCIPAL; }` | `authType NVARCHAR(20)` | YES | `'TOKEN'` | Authentication mode |
| `apiToken` | `String(500)` | `apiToken NVARCHAR(500)` | YES | null | Databricks Personal Access Token (PAT) |
| `clientId` | `String(100)` | `clientId NVARCHAR(100)` | YES | null | OAuth Service Principal Client ID (M2M) |
| `clientSecret` | `String(500)` | `clientSecret NVARCHAR(500)` | YES | null | OAuth Service Principal Secret |
| `targetCatalog` | `String(100)` | `targetCatalog NVARCHAR(100)` | YES | null | Unity Catalog catalog name |
| `targetSchema` | `String(100)` | `targetSchema NVARCHAR(100)` | YES | null | Unity Catalog schema/database name |
| `sqlWarehouseId` | `String(100)` | `sqlWarehouseId NVARCHAR(100)` | YES | null | Databricks SQL Warehouse HTTP endpoint ID |
| `isActive` | `Boolean` | `isActive BOOLEAN` | YES | `true` | Connection enable/disable flag |

---

### 2.2 `srv/cortex_service.cds`

#### A. Expose `DatabricksSettings` Projection
- **Location**: In `srv/cortex_service.cds`, inside `service AuthorizationService`, alongside `BdcSettings` (around lines 35–36).

**Before:**
```cds
  entity DynamicGenerationRules as projection on db.DynamicGenerationRules;
  entity DynamicRuleFieldMappings as projection on db.DynamicRuleFieldMappings;
  entity GeneratedResourceMap   as projection on db.GeneratedResourceMap;
  entity BdcSettings            as projection on db.BdcSettings;


  action searchScimUsers(query: String)                                         returns array of {
```

**After:**
```cds
  entity DynamicGenerationRules as projection on db.DynamicGenerationRules;
  entity DynamicRuleFieldMappings as projection on db.DynamicRuleFieldMappings;
  entity GeneratedResourceMap   as projection on db.GeneratedResourceMap;
  entity BdcSettings            as projection on db.BdcSettings;
  entity DatabricksSettings     as projection on db.DatabricksSettings;


  action searchScimUsers(query: String)                                         returns array of {
```

#### B. Expose `testDatabricksConnection` Action (Milestone 1, Feature 4)
- **Location**: In `srv/cortex_service.cds`, under section `// BDC Connection & Data Actions` (around line 104).

**Before:**
```cds
  action testBdcConnection(settingId: UUID)                                     returns {
    success : Boolean;
    message : String;
  };

  // fetchBdcSpaces: dual signature — connectionId (saved connection) OR direct credentials (during creation)
```

**After:**
```cds
  action testBdcConnection(settingId: UUID)                                     returns {
    success : Boolean;
    message : String;
  };

  action testDatabricksConnection(settingId: UUID)                              returns {
    success    : Boolean;
    message    : String;
    httpStatus : Integer;
  };

  // fetchBdcSpaces: dual signature — connectionId (saved connection) OR direct credentials (during creation)
```

---

### 2.3 `db/data/fanrio.auth-DatabricksSettings.csv`

Create a new seed file at:
`c:\Users\Fan\Documents\fanrio-auth\db\data\fanrio.auth-DatabricksSettings.csv`

**Header Content**:
```csv
ID,systemName,environment_ID,workspaceUrl,authType,apiToken,clientId,clientSecret,targetCatalog,targetSchema,sqlWarehouseId,isActive
```
*(Followed by a trailing empty newline)*

> **Note on Managed Columns**: As verified during investigation with `fanrio.auth-Restrictions.csv`, omitting `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` from the CSV header is fully supported by `@sap/cds`. If explicit seed rows are added for offline mock testing (e.g. `mock-databricks-dev`), the above header allows clean seeding without synthetic timestamps.

---

### 2.4 Security & Authorization Handler: `srv/handlers/systemHandlers.js`

To maintain architectural integrity and adhere to the security model:
1. `DatabricksSettings` must be protected against unauthorized CRUD.
2. Direct `READ` on `DatabricksSettings` must require `canManageSettings`.
3. `testDatabricksConnection` action execution must require `canManageSettings`.

**Changes in `srv/handlers/systemHandlers.js`:**

Around line 11:
```javascript
  // Settings & Master Data CRUD protection
  service.before(
    ['CREATE', 'UPDATE', 'DELETE'],
    [
      'BdcSettings',
      'DatabricksSettings', // <--- ADD HERE
      'RestrictionFields',
      'DynamicGenerationRules',
      'DynamicRuleFieldMappings',
      'GeneratedResourceMap',
      'Customers',
      'Environments'
    ],
    async (req) => {
      const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
      requirePermission(perms, 'canManageSettings', req);
    }
  );

  // Direct READ on BdcSettings & DatabricksSettings requires settings management permission
  service.before('READ', ['BdcSettings', 'DatabricksSettings'], async (req) => { // <--- ADD HERE
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });
```

Around line 94:
```javascript
  service.before([
    'testBdcConnection', 'testDatabricksConnection', // <--- ADD HERE
    'fetchBdcSpaces', 'fetchBdcAssets',
    'fetchBdcAssetColumns', 'fetchBdcAssetKeyColumns', 'fetchRawBdcSpaces',
    'fetchRawBdcAssets', 'fetchRawBdcRelationalValues', 'fetchRawBdcAssetColumns',
    'fetchRawBdcUsers', 'fetchBdcAssociations', 'runBdcTaskChain', 'fetchBdcTaskChainLog',
    'fetchRawHanaViews'
  ], async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageSettings', req);
  });
```

---

## 3. Execution Plan for `npx cds deploy`

Follow this exact sequence to deploy without schema corruption or runtime discrepancies:

### Step 1: Pre-Deploy Syntax Verification
Before touching `sqlite.db`, verify that the CDS compiler generates clean SQL without errors:
```powershell
npx cds compile db/schema.cds --to sql
```
Ensure `fanrio_auth_DatabricksSettings` and the modified `Roles` / `AccessDomains` tables appear in the output.

### Step 2: Dry-Run Deployment Check
Inspect the planned DDL statements and verify all views compile properly:
```powershell
npx cds deploy --dry
```
Verify output contains:
- `CREATE TABLE fanrio_auth_DatabricksSettings (...)`
- `CREATE VIEW AuthorizationService_DatabricksSettings AS SELECT ...`

### Step 3: Execute Database Deployment
Run the official deployment command:
```powershell
npx cds deploy
```
Expected output:
```
> executing create table fanrio_auth_DatabricksSettings...
> executing create view AuthorizationService_DatabricksSettings...
/> successfully deployed to sqlite.db
```

### Step 4: Post-Deploy Verification of SQLite Schema
Run an inline Node check to confirm the SQLite database schema and foreign keys match:
```powershell
node -e "
const sqlite3 = require('@cap-js/sqlite/node_modules/sqlite3') || require('sqlite3');
const db = new sqlite3.Database('sqlite.db');
db.all('PRAGMA table_info(fanrio_auth_DatabricksSettings)', (err, rows) => {
  if (err) console.error(err);
  else console.log('DatabricksSettings Columns:', rows.map(r => r.name));
});
db.all('PRAGMA table_info(fanrio_auth_Roles)', (err, rows) => {
  if (err) console.error(err);
  else console.log('Roles targetPlatform column:', rows.find(r => r.name === 'targetPlatform'));
});
db.close();
"
```

---

## 4. Verification Steps for Worker

| Step # | Verification Item | Command / Code | Expected Result |
|---|---|---|---|
| **V1** | CDS Compilation | `npx cds compile db/schema.cds` | Exit code 0, no warnings |
| **V2** | CDS Deploy | `npx cds deploy` | Deploys cleanly to `sqlite.db` |
| **V3** | Existing Test Suite (Non-regression) | `npm run test` | All 60 test cases pass across 3 test suites |
| **V4** | Roles Default Platform Verification | Query `/odata/v4/auth/Roles` via test | Newly created role has `targetPlatform: 'DATASPHERE'` |
| **V5** | AccessDomains Default Platform Verification | Query `/odata/v4/auth/AccessDomains` via test | Newly created domain has `targetPlatform: 'BOTH'` |
| **V6** | DatabricksSettings CRUD via OData | POST to `/odata/v4/auth/DatabricksSettings` | Returns 201 with generated `ID`, `createdAt`, `isActive: true` |
| **V7** | DatabricksSettings Security Gate | GET `/odata/v4/auth/DatabricksSettings` as anonymous | Returns 403 Forbidden |

---

## 5. Summary Checklist for Worker

- [ ] Add `type TargetPlatform` to `db/schema.cds`.
- [ ] Add `targetPlatform` to `AccessDomains` in `db/schema.cds`.
- [ ] Add `targetPlatform` to `Roles` in `db/schema.cds`.
- [ ] Add `entity DatabricksSettings : cuid, managed` to `db/schema.cds`.
- [ ] Add `entity DatabricksSettings as projection on db.DatabricksSettings;` to `srv/cortex_service.cds`.
- [ ] Add `action testDatabricksConnection` to `srv/cortex_service.cds`.
- [ ] Create `db/data/fanrio.auth-DatabricksSettings.csv` with headers.
- [ ] Update `srv/handlers/systemHandlers.js` to protect `DatabricksSettings` and `testDatabricksConnection`.
- [ ] Run `npx cds deploy`.
- [ ] Run `npm run test` to verify zero regression.
