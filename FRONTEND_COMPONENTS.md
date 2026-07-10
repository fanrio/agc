# Frontend Component Reference

This document describes every React component in `app/catalog/src/`, including its props, responsibilities, and how to extend it.

---

## Navigation & Shell

### `App.jsx`

**Role**: Root application shell — renders the sidebar nav, top bar, and the active view.

**Key state**:
- `activeNav` — current nav item (string ID)
- `wizardContext` — controls whether the Wizard is shown and with what initial context
- `rolesFilter` — optional filter passed to `RolesDashboard`

**Nav IDs** (in sidebar order):

| ID | Label | Component |
|---|---|---|
| `home` | Home Dashboard | `HomeView` |
| `org` | Organization | `OrgStructureView` |
| `roles` | Roles | `RolesDashboard` |
| `assignments` | Role Assignments | `RoleAssignmentsView` |
| `replications` | Replications | `ReplicationsView` |
| `audit` | Audit Logs | `AuditLogsView` |
| `admin` | Administration | `AdministrationView` |
| `wizard` | (programmatic only) | `Wizard` |

**Functions**:
- `openWizard(ctx)` — activates the Wizard with a given context object
- `navigateToRoles(filter)` — navigates to roles dashboard with optional filter

---

## Context

### `PermissionsContext.jsx`

**Role**: Fetches and exposes the current user's `AppAuthorizations` record globally.

**Usage**:
```jsx
import { usePermissions } from '../context/PermissionsContext';

function MyComponent() {
  const { permissions, loading } = usePermissions();
  if (loading) return <Spinner />;
  if (!permissions?.canManageSettings) return <Forbidden />;
}
```

**`permissions` object shape** (mirrors `AppAuthorizations` entity):
```js
{
  isSuperAdmin, canManageAppUsers, canManageOrgRoles,
  canManageSingleRoles, canManageDerivedRoles, managedDerivedRolesScope,
  canAssignRoles, canManageReplications, canViewAuditLogs,
  canManageSettings, allowedEnvironments, isActive
}
```

---

## Top-Level Views

### `HomeView.jsx`

**Role**: Dashboard with statistics about roles, users, assignments, and system configuration.

**Data loaded on mount**: Roles, OrgNodes, Assignments, Streams, RestrictionFields, BdcSettings.

**Statistics computed**:
- Total roles, org nodes, assignments, unique users
- Counts by node type
- Users with critical roles
- Stream count, field count, BDC connection count
- Recent roles list

---

### `RolesDashboard.jsx`

**Role**: Displays all roles in a filterable, searchable card grid.

**Props**:
- `filter` — optional initial filter object `{ type, orgNodeId, parentId }`
- `openWizard(ctx)` — callback to open the wizard for a role

**Features**: Search by name, filter by type/environment/stream/critical, sort options.

---

### `RoleCard.jsx`

**Role**: Displays a single role with its key attributes and action buttons.

**Props**:
- `role` — role data object (with expanded associations)
- `openWizard(ctx)` — callback
- `onDeleted()` — callback after role deletion

---

### `RoleAssignmentsView.jsx`

**Role**: Manages user-to-role assignments. Supports search by user or role name.

**Behavior**: Creating an assignment triggers HANA flat-table replication (handled server-side).

---

### `AuditLogsView.jsx`

**Role**: Read-only, filterable view of the `AuditLogs` entity.

---

### `ReplicationsView.jsx`

**Role**: Shows replication job history and allows triggering new replications.

**Guarded by**: `canManageReplications`

---

### `OrgStructureView.jsx`

**Role**: Thin wrapper around `HierarchicalManager` for managing OrgNodes.

```jsx
<HierarchicalManager
  title="Organisation Structure"
  fetchNodesFlat={api.getAllOrgNodesFlat}
  createNode={api.createOrgNode}
  updateNode={api.updateOrgNode}
  deleteNode={api.deleteOrgNode}
  createAttribute={api.createOrgAttr}
  deleteAttribute={api.deleteOrgAttr}
  showTypeSelector={true}
  // ...
/>
```

---

### `StreamsView.jsx`

**Role**: Thin wrapper around `HierarchicalManager` for managing Streams.

```jsx
<HierarchicalManager
  title="Streams"
  fetchNodesFlat={api.getStreamsFlat}
  createNode={api.createStreamNode}
  // ...
  maxNameLength={10}   ← important: stream names max 10 chars
/>
```

---

## Administration Views (tabs inside `AdministrationView.jsx`)

### `RestrictionFieldsView.jsx`

**Role**: CRUD for `RestrictionFields`. Each field can be linked to a BDC connection for value lookup.

**Guarded by**: `canManageSettings`

---

### `BdcSettingsView.jsx`

**Role**: CRUD for `BdcSettings`. Supports OData (BDC) and SAP HANA connection types.

**Features**: Test connection button (calls `testBdcConnection` action).

**Guarded by**: `canManageSettings`

---

### `BdcApiTesterView.jsx`

**Role**: Interactive tester for BDC API actions (spaces, assets, values, columns, task chains).

**Guarded by**: `canManageSettings`

---

### `AppAuthorizationsView.jsx`

**Role**: Manages per-user application permission flags.

**Guarded by**: `canManageAppUsers`

---

### `DynamicRulesView.jsx`

**Role**: Manages DRAGE rules (`DynamicGenerationRules` + field mappings). Supports manual sync trigger.

**Guarded by**: `canManageSettings`

---

### `MasterDataEditorView.jsx`

**Role**: Simple CRUD for `Environments` and `Customers` entities.

**Guarded by**: `canManageSettings`

---

## Reusable Components

### `HierarchicalManager.jsx`

**Role**: Generic tree editor component for self-referential hierarchies. Used by both `OrgStructureView` and `StreamsView`.

**Props**:

| Prop | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Section title |
| `subtitle` | string | Yes | Description subtitle |
| `emptyTitle` | string | Yes | Displayed when no nodes |
| `emptySubtitle` | string | Yes | Empty state hint |
| `addNodePlaceholder` | string | Yes | Input placeholder |
| `fetchNodesFlat` | function | Yes | `() => Promise<node[]>` — returns flat list |
| `createNode` | function | Yes | `(body) => Promise<node>` |
| `updateNode` | function | Yes | `(id, body) => Promise<node>` |
| `deleteNode` | function | Yes | `(id) => Promise<void>` |
| `createAttribute` | function | Yes | `(body) => Promise<attr>` |
| `deleteAttribute` | function | Yes | `(id) => Promise<void>` |
| `defaultIcon` | LucideIcon | Yes | Icon for nodes without a type |
| `showTypeSelector` | boolean | No | Show type field (for OrgNodes) |
| `showDescriptionField` | boolean | No | Show description field |
| `maxNameLength` | number | No | Max chars for node name |
| `canManage` | boolean | No | Disables editing if false |

**Node data format** returned by `fetchNodesFlat`:
```js
[
  {
    ID: "uuid",
    name: "Root Node",
    parent: null,  // or { ID: "parent-uuid" }
    children: [],  // populated from flat list by component
    attributes: [{ ID, field, value }],
    type: { ID, name } | null
  }
]
```

---

### `RestrictionBuilder.jsx`

**Role**: The restriction condition editor. Handles all filter types.

**Filter types supported**:
- `SINGLE_VALUE` — text input
- `MULTI_VALUE` — tag/chip multi-select with optional BDC lookup
- `RANGE` / `BT` — two text inputs (from / to)
- `HIERARCHY` — org node selector
- `PATTERN` — text input with wildcard hint

**Display rendering** (read mode): `<from> and <to>` for `RANGE`/`BT`, comma-joined for `MULTI_VALUE`.

**Validation**: Both `from` and `to` must be non-empty for `RANGE`/`BT` before saving.

---

## Wizard

The Wizard is a multi-step dialog for creating or editing a Role.

### `Wizard/index.jsx`

**Role**: Wizard shell — renders the step tabs and active step, manages navigation.

**Opening**: `openWizard(ctx)` from `App.jsx`. Context properties:
- `roleId` — pre-loads existing role for edit mode
- `orgNodeId` — pre-selects an org node for ORG_BASED roles
- `parentRoleId` — pre-selects a parent role for DERIVED roles

---

### `Wizard/useWizardState.js`

**Role**: All wizard state management and API calls. Returns a flat object of state values and callbacks.

**Key exported state**:

| Name | Type | Description |
|---|---|---|
| `step` | number | Current wizard step (0-3) |
| `roleType` | string | `SINGLE` \| `DERIVED` \| `ORG_BASED` |
| `roleName` | string | Role name input |
| `description` | string | Description input |
| `critical` | boolean | Critical flag |
| `environmentId` | string | Selected environment ID |
| `streamId` | string | Selected stream ID |
| `streams` | array | Available streams for dropdown |
| `restrictions` | array | Current restriction list |
| `selectedParentIds` | string[] | Selected parent role IDs |
| `isEditMode` | boolean | True when editing existing role |
| `loading` | boolean | True during API calls |
| `done` | boolean | True after successful save |
| `showImpactDialog` | boolean | Controls impact warning dialog |

**Key functions**:
- `handleSaveClick()` — validates and saves role + restrictions + inheritance
- `handleDeploy()` — triggers replication after save

---

### `Wizard/steps/StepOrigin.jsx`

**Step 1**: Role identity.

**Fields**: Role type, role name, description, environment, stream, critical flag, parent roles (for DERIVED), org node (for ORG_BASED).

---

### `Wizard/steps/StepRestrictions.jsx`

**Step 2**: Restriction conditions.

**Uses**: `RestrictionBuilder` component.

---

### `Wizard/steps/StepApprovers.jsx`

**Step 3**: Set approver users. LDAP search integration.

---

### `Wizard/steps/StepReview.jsx`

**Step 4**: Summary review before saving.

---

### `Wizard/ImpactDialog.jsx`

**Role**: Confirmation dialog shown when editing a role that has derived roles or existing assignments.

**Condition for showing**: Role has at least one derived role OR at least one active assignment. If neither exists, the dialog is skipped.

---

## API Module (`app/catalog/src/api.js`)

Single source of truth for all OData calls. See [API_REFERENCE.md](API_REFERENCE.md) for the full function listing.

**Base URL**: Automatically resolved — calls go to `/odata/v4/auth/...` through the Vite proxy config.

**Never** call `fetch()` directly in a component. Always add a function to `api.js` first.
