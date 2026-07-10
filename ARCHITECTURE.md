# fanrio-auth — Architecture Overview

> **Target audience**: Developers and AI coding assistants onboarding to this project.
> Read this before modifying any code. See [`AGENTS.md`](.agents/AGENTS.md) for rules specific to AI agents.

---

## 1. What This Is

**fanrio-auth** is an SAP BDC (Business Data Cloud) Authorization Wizard. It manages role-based access control for SAP DataSphere / BDC environments. It consists of:

- A **CAP (Cloud Application Programming) Node.js backend** that exposes an OData v4 service.
- A **React + Vite + Material UI frontend** (the catalog app).
- Integration with **SAP HANA** (flat-table replication) and **SAP BDC** (task chain execution, data lookups).

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Backend framework | SAP CAP (`@sap/cds` v9) |
| Backend runtime | Node.js |
| OData protocol | OData v4 |
| Dev database | SQLite (`sqlite.db`) |
| Prod database | SAP HANA Cloud |
| Frontend framework | React 18 + Vite 8 |
| Frontend UI library | Material UI (MUI) |
| Frontend state | React hooks + context |
| Testing | Node.js `--test` runner |
| Dev orchestration | `concurrently` (CAP + Vite) |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (React App @ http://localhost:5173)             │
│                                                          │
│  app/catalog/src/                                        │
│  ├── App.jsx             (navigation shell)              │
│  ├── api.js              (all OData fetch calls)         │
│  ├── context/            (permissions context)           │
│  └── components/         (views + wizard)                │
└────────────────────────────┬─────────────────────────────┘
                             │ OData v4 HTTP
                             │ /odata/v4/auth/...
┌────────────────────────────▼─────────────────────────────┐
│  CAP Backend (@ http://localhost:4004)                   │
│                                                          │
│  srv/authorization-service.cds   (entity projections +  │
│                                   action signatures)     │
│  srv/authorization-service.js    (thin wiring layer)     │
│                                                          │
│  srv/handlers/           (CAP event hooks per entity)    │
│  srv/services/           (domain business logic)         │
│  srv/lib/                (pure utility modules)          │
└────────┬──────────────────────────────┬──────────────────┘
         │ CDS ORM                      │ hdb / hana-client
┌────────▼──────────┐      ┌────────────▼─────────────────┐
│  SQLite (dev)     │      │  SAP HANA Cloud (prod)        │
│  sqlite.db        │      │  - AUTHORIZATION_FLAT table   │
│                   │      │  - [stream]_flat_authorizations│
└───────────────────┘      └──────────────────────────────┘
                                         │
                           ┌─────────────▼─────────────────┐
                           │  SAP BDC / DataSphere          │
                           │  - OData API (spaces/assets)   │
                           │  - Task chains (replication)   │
                           └───────────────────────────────┘
```

---

## 4. Backend Layer Breakdown

### `srv/authorization-service.cds`
Defines the OData service contract:
- Entity projections (what DB entities are exposed through OData)
- OData action and function signatures
- Path: `/odata/v4/auth`

### `srv/authorization-service.js`
**Thin wiring layer only.** Imports all handlers and services and registers them with the CAP service instance. Contains no business logic itself.

### `srv/handlers/`
CAP event hook registrations (`before`, `after`, `on`). One file per entity domain:

| File | Entity | Key behaviors |
|---|---|---|
| `roleHandlers.js` | `Roles` | UUID generation, name uniqueness, audit logs, HANA re-sync on update |
| `assignmentHandlers.js` | `RoleAssignments` | HANA sync on create/delete |
| `restrictionHandlers.js` | `Restrictions` | Validation, HANA re-sync on change |
| `streamHandler.js` | `Streams`, `StreamAttributes` | Permission guard, creates HANA flat table on Stream CREATE |

### `srv/services/`
Pure business logic services:

| File | Responsibility |
|---|---|
| `hanaReplicationService.js` | Converts restrictions to flat HANA rows using Cartesian product expansion. Core sync logic. |
| `replicationQueueService.js` | Queues background replications, triggers BDC task chains |
| `orgRoleGeneratorService.js` | Walks org node ancestry, auto-generates roles and restrictions |
| `dynamicSyncService.js` | DRAGE engine — rule-based dynamic role & assignment generation from master data |
| `accessActionService.js` | Resolves effective restrictions recursively, simulates access evaluation |
| `bdcActionService.js` | All SAP BDC OData proxy calls (spaces, assets, relational values, task chains) |

### `srv/lib/`
Utility modules with no CAP dependencies (independently testable):

| File | Responsibility |
|---|---|
| `hanaClient.js` | Raw HANA connection management, `createCustomFlatTable`, `syncAssignment`, `syncCustomAssignment` |
| `bdcClient.js` | HTTP client for BDC OData API |
| `authGuard.js` | `getSessionPermissions`, `requirePermission`, `requireEnvironment` |
| `resolveEffectiveRestrictions.js` | Recursive restriction inheritance resolution |
| `urlUtils.js` | URL construction helpers |
| `utils.js` | General-purpose utilities |

---

## 5. Database Layer

### Entity Namespace
All entities live under the `fanrio.auth` namespace (defined in `db/schema.cds`).

### Key Entity Relationships

```
Streams ──────────────────────────────────────┐
  │                                            │
  └─ StreamAttributes                     Roles.stream
                                               │
Roles ────────────────────────────────────────┘
  ├── ownRestrictions → Restrictions
  ├── assignments → RoleAssignments
  ├── approvers → RoleApprovers
  ├── parentRoles → RoleInheritance → Roles (parent)
  └── orgNode → OrgNodes

OrgNodes
  ├── children → OrgNodes (self-referential)
  └── attributes → OrgNodeAttributes

BdcSettings
  └── connected to RestrictionFields (for value lookup)

DynamicGenerationRules
  ├── mappings → DynamicRuleFieldMappings
  └── templateRole → Roles

GeneratedResourceMap
  ├── generatedRole → Roles
  ├── generatedRestriction → Restrictions
  └── generatedAssignment → RoleAssignments
```

### Restriction Value Encoding

The `Restrictions.value` field is a string that encodes differently per `filterType`:

| filterType | value format | example |
|---|---|---|
| `SINGLE_VALUE` | Plain string | `"Germany"` |
| `MULTI_VALUE` | JSON array | `["DE01","DE02"]` |
| `RANGE` | JSON object | `{"from":1000,"to":50000}` |
| `BT` | JSON object | `{"from":"DE01","to":"DE02"}` |
| `HIERARCHY` | OrgNode ID (UUID) | `"a1b2c3..."` |
| `PATTERN` | Plain string with wildcards | `"CC1%"` |

### Seed Data Files
Located in `db/data/`. Naming convention: `fanrio.auth-<EntityName>.csv`.

| File | Entity |
|---|---|
| `fanrio.auth-Roles.csv` | Roles |
| `fanrio.auth-Streams.csv` | Streams |
| `fanrio.auth-StreamAttributes.csv` | StreamAttributes |
| `fanrio.auth-OrgNodes.csv` | OrgNodes |
| `fanrio.auth-OrgNodeAttributes.csv` | OrgNodeAttributes |
| `fanrio.auth-RestrictionFields.csv` | RestrictionFields |
| `fanrio.auth-Restrictions.csv` | Restrictions |
| `fanrio.auth-Environments.csv` | Environments |
| `fanrio.auth-BdcSettings.csv` | BdcSettings |
| `fanrio.auth-Replications.csv` | Replications |

---

## 6. Frontend Layer

### Navigation Structure (`App.jsx`)
The app has a fixed left sidebar with these top-level navigation entries:

| Nav ID | View Component | Guarded by |
|---|---|---|
| `home` | `HomeView` | Public (any authenticated user) |
| `org` | `OrgStructureView` | Public |
| `roles` | `RolesDashboard` | Public |
| `assignments` | `RoleAssignmentsView` | Public |
| `replications` | `ReplicationsView` | `canManageReplications` |
| `audit` | `AuditLogsView` | `canViewAuditLogs` |
| `admin` | `AdministrationView` | `canManageSettings` or `canManageAppUsers` |

The `Wizard` component is activated programmatically via `openWizard(ctx)` (not in the sidebar).

### Administration Tabs (`AdministrationView.jsx`)

| Tab label | Component | Purpose |
|---|---|---|
| Restriction Fields | `RestrictionFieldsView` | Define restriction field types and BDC connections |
| Streams | `StreamsView` | Manage stream hierarchy |
| BDC Connections | `BdcSettingsView` | Manage SAP BDC/HANA connections |
| BDC API Tester | `BdcApiTesterView` | Test BDC API connectivity |
| App Authorizations | `AppAuthorizationsView` | Manage per-user app permissions |
| Dynamic Rules | `DynamicRulesView` | Manage DRAGE rules |
| Master Data Editor | `MasterDataEditorView` | Edit environments and customers |

### API Module (`app/catalog/src/api.js`)
**Single source of truth for all OData calls.** All frontend components import from here. Never call `fetch()` directly in a component — add a function to `api.js` first.

---

## 7. HANA Replication Architecture

When a `RoleAssignment` is created or deleted, the system:

1. Resolves all **effective restrictions** for the role (including inherited ones via `resolveEffectiveRestrictions`)
2. Groups restriction values by field name
3. Computes the **Cartesian product** across all fields (e.g. Plant × CompanyCode = N×M rows)
4. Writes flattened rows to:
   - The **default AUTHORIZATION_FLAT** table (always)
   - The **stream-specific table** `[stream_name]_flat_authorizations` (if role has a stream)

Custom HANA flat tables are created automatically when a new `Stream` is created (see `streamHandler.js` → `HanaClient.createCustomFlatTable`).

---

## 8. DRAGE — Dynamic Role & Assignment Generation Engine

The DRAGE engine (`dynamicSyncService.js`) enables rule-driven authorization:

1. A `DynamicGenerationRule` specifies a source entity (e.g. `Customers`) and a responsible user field
2. When a master data record changes (create/update/delete of `Customers`), `syncDynamicRule` is invoked
3. For each unique responsible user, it creates or updates a `DERIVED` role with restrictions mapped from the record's key fields
4. It also creates or removes `RoleAssignments` to keep permissions in sync with data ownership

---

## 9. Permissions System

### Backend (`AppAuthorizations` entity)

| Flag | Controls |
|---|---|
| `isSuperAdmin` | Bypasses all permission checks |
| `canManageAppUsers` | Can edit `AppAuthorizations` |
| `canManageOrgRoles` | Can create/edit org-based roles |
| `canManageSingleRoles` | Can create/edit standalone roles |
| `canManageDerivedRoles` | Can create/edit derived roles (scoped by `managedDerivedRolesScope`) |
| `canAssignRoles` | Can create `RoleAssignments` |
| `canManageReplications` | Can trigger/view replications |
| `canViewAuditLogs` | Can view audit logs |
| `canManageSettings` | Can edit streams, restriction fields, BDC settings |
| `allowedEnvironments` | Comma-separated env IDs or `ALL` |

### Frontend (`PermissionsContext.jsx`)
Loaded once on startup via `getCurrentUserPermissions()` action. All views read from `usePermissions()` hook.

---

## 10. Dev Commands Reference

```bash
# Start full dev stack (CAP + Vite)
npm run dev

# Start only CAP backend
npm run dev:cap

# Start only Vite frontend
npm run dev:ui

# Deploy schema changes to SQLite
npx cds deploy

# Run all backend tests
npm run test

# Build production bundle
npm run build
```

### Ports in Development
- CAP backend: `http://localhost:4004`
- Vite frontend: `http://localhost:5173`
- OData service root: `http://localhost:4004/odata/v4/auth`
