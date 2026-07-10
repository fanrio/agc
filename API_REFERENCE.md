# API Reference

This document lists every OData endpoint and custom action exposed by the `AuthorizationService`.

> **Base URL (development)**: `http://localhost:4004/odata/v4/auth/`

---

## Standard OData Entities

All entities support the standard OData CRUD operations unless noted otherwise.

| Entity | OData URL | Notes |
|---|---|---|
| OrgNodes | `/OrgNodes` | Self-referential tree. Use `$expand=children,attributes,type`. |
| OrgNodeAttributes | `/OrgNodeAttributes` | Key-value attributes on org nodes. |
| RestrictionFields | `/RestrictionFields` | Use `$expand=bdcConnection`. |
| Streams | `/Streams` | Self-referential tree. `name` max 10 chars. Use `$expand=attributes,type`. |
| StreamAttributes | `/StreamAttributes` | Key-value attributes on streams. |
| Roles | `/Roles` | Use `$expand=ownRestrictions,assignments,orgNode,parentRoles($expand=parent),approvers,environment`. |
| Restrictions | `/Restrictions` | Encode `value` per `filterType`. |
| RoleAssignments | `/RoleAssignments` | Creating triggers HANA sync. Use `$expand=role`. |
| RoleInheritance | `/RoleInheritance` | |
| RoleApprovers | `/RoleApprovers` | |
| Environments | `/Environments` | Read-only. Seeds: D, Q, P. |
| AuditLogs | `/AuditLogs` | Append-only. |
| AppAuthorizations | `/AppAuthorizations` | |
| Replications | `/Replications` | |
| Customers | `/Customers` | DRAGE source entity. |
| DynamicGenerationRules | `/DynamicGenerationRules` | Use `$expand=mappings,templateRole,bdcConnection`. |
| DynamicRuleFieldMappings | `/DynamicRuleFieldMappings` | |
| GeneratedResourceMap | `/GeneratedResourceMap` | |
| BdcSettings | `/BdcSettings` | Use `$expand=environment`. |

---

## OData Actions

### Role Management

#### `generateOrgRole`
Auto-generates a role from an OrgNode.

```
POST /odata/v4/auth/generateOrgRole
Body: { "orgNodeId": "<UUID>" }
Returns: { "roleId": "<UUID>", "roleName": "<string>" }
```

#### `generateAllOrgRoles`
Batch generates roles for all org nodes.

```
POST /odata/v4/auth/generateAllOrgRoles
Body: {}
Returns: { "count": <integer> }
```

---

### Access Resolution

#### `resolveEffectiveRestrictions`
Recursively resolves inherited restrictions for a role.

```
POST /odata/v4/auth/resolveEffectiveRestrictions
Body: { "roleId": "<UUID>" }
Returns: [
  {
    "restrictionId": "<UUID>",
    "field": "<string>",
    "filterType": "<string>",
    "value": "<string>",
    "sourceRoleId": "<UUID>",
    "sourceRoleName": "<string>",
    "isOwn": <boolean>
  }
]
```

#### `simulateAccess`
Evaluates whether sample data rows pass a role's restrictions.

```
POST /odata/v4/auth/simulateAccess
Body: {
  "roleId": "<UUID>",
  "sampleData": "<JSON string of rows>",
  "restrictions": "<JSON string of restrictions>"
}
Returns: [
  { "rowIndex": <int>, "passed": <boolean>, "reason": "<string>" }
]
```

---

### Dynamic Rules

#### `syncDynamicRule`
Manually triggers synchronization for a DRAGE rule.

```
POST /odata/v4/auth/syncDynamicRule
Body: { "ruleId": "<UUID>" }
Returns: { "success": <boolean>, "message": "<string>" }
```

---

### BDC Integration

#### `testBdcConnection`
Tests whether a BDC connection is reachable.

```
POST /odata/v4/auth/testBdcConnection
Body: { "settingId": "<UUID>" }
Returns: { "success": <boolean>, "message": "<string>" }
```

#### `fetchBdcSpaces`
Lists available BDC spaces.

```
POST /odata/v4/auth/fetchBdcSpaces
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "..." }
Returns: [ "<space_name>", ... ]
```

#### `fetchBdcAssets`
Lists assets in a BDC space.

```
POST /odata/v4/auth/fetchBdcAssets
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...", "space": "..." }
Returns: [ "<asset_id>", ... ]
```

#### `fetchBdcRelationalValues`
Fetches ID/text pairs for an asset (used for restriction value lookup).

```
POST /odata/v4/auth/fetchBdcRelationalValues
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...",
        "space": "...", "asset": "...", "assetText": "...",
        "idColumns": "...", "textColumn": "..." }
Returns: [ { "id": "<string>", "text": "<string>" } ]
```

#### `fetchBdcAssetColumns`
Lists column names for a BDC asset.

```
POST /odata/v4/auth/fetchBdcAssetColumns
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...",
        "space": "...", "asset": "..." }
Returns: [ "<column_name>", ... ]
```

#### `fetchBdcAssetKeyColumns`
Lists key column names for a BDC asset.

```
POST /odata/v4/auth/fetchBdcAssetKeyColumns
Body: (same as fetchBdcAssetColumns)
Returns: [ "<column_name>", ... ]
```

#### `fetchBdcAssociations`
Fetches associations for a BDC asset.

```
POST /odata/v4/auth/fetchBdcAssociations
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...",
        "space": "...", "asset": "..." }
Returns: LargeString (raw JSON)
```

#### `fetchRawBdcSpaces` / `fetchRawBdcAssets` / `fetchRawBdcRelationalValues` / `fetchRawBdcAssetColumns`
Same as the non-raw counterparts but return the raw JSON string instead of a parsed array.

#### `fetchRawHanaViews`
Fetches available HANA views via a saved connection.

```
POST /odata/v4/auth/fetchRawHanaViews
Body: { "settingId": "<UUID>" }
Returns: LargeString (raw JSON)
```

#### `runBdcTaskChain`
Triggers a BDC task chain execution.

```
POST /odata/v4/auth/runBdcTaskChain
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...",
        "space": "...", "taskChainId": "..." }
Returns: LargeString (run ID / response)
```

#### `fetchBdcTaskChainLog`
Fetches execution log for a BDC task chain run.

```
POST /odata/v4/auth/fetchBdcTaskChainLog
Body: { "url": "...", "tokenUrl": "...", "clientId": "...", "clientSecret": "...",
        "space": "...", "logId": "..." }
Returns: LargeString (log JSON)
```

---

### Replication

#### `triggerReplication`
Queues a full replication to HANA and triggers BDC task chains.

```
POST /odata/v4/auth/triggerReplication
Body: {}
Returns: { "success": <boolean>, "message": "<string>" }
```

#### `checkReplicationStatuses`
Polls and updates statuses of all running replications.

```
POST /odata/v4/auth/checkReplicationStatuses
Body: {}
Returns: { "success": <boolean>, "message": "<string>" }
```

---

### User Identity

#### `getCurrentUserPermissions` (function)
Returns the permission record for the currently authenticated user.

```
GET /odata/v4/auth/getCurrentUserPermissions()
Returns: AppAuthorizations record (or null)
```

---

### LDAP

#### `searchLdapUsers`
Searches LDAP for users matching a query string.

```
POST /odata/v4/auth/searchLdapUsers
Body: { "query": "<search string>" }
Returns: [
  { "username": "...", "displayName": "...", "email": "...", "department": "..." }
]
```

---

## Frontend API Module (`app/catalog/src/api.js`)

All frontend API calls are centralized in this module. Component files should **never call `fetch()` directly** — always add a function here first.

### Org Structure
```js
getRoles()                                → GET /Roles?$expand=...
getAllOrgNodesFlat()                       → GET /OrgNodes?$expand=attributes,type
createOrgNode(body)                        → POST /OrgNodes
updateOrgNode(id, body)                    → PATCH /OrgNodes('<id>')
deleteOrgNode(id)                          → DELETE /OrgNodes('<id>')
createOrgAttr(body)                        → POST /OrgNodeAttributes
deleteOrgAttr(id)                          → DELETE /OrgNodeAttributes(<id>)
```

### Roles
```js
getRoles()                                → GET /Roles?$expand=...
createRole(body)                           → POST /Roles
updateRole(id, body)                       → PATCH /Roles('<id>')
deleteRole(id)                             → DELETE /Roles('<id>')
```

### Restrictions
```js
getRestrictions()                          → GET /Restrictions
createRestriction(body)                    → POST /Restrictions
updateRestriction(id, body)                → PATCH /Restrictions(<id>)
deleteRestriction(id)                      → DELETE /Restrictions(<id>)
getRestrictionFields()                     → GET /RestrictionFields?$expand=bdcConnection
createRestrictionField(body)               → POST /RestrictionFields
updateRestrictionField(id, body)           → PATCH /RestrictionFields('<id>')
deleteRestrictionField(id)                 → DELETE /RestrictionFields('<id>')
```

### Streams
```js
getStreamsFlat()                           → GET /Streams?$expand=attributes,type
createStreamNode(body)                     → POST /Streams
updateStreamNode(id, body)                 → PATCH /Streams('<id>')
deleteStreamNode(id)                       → DELETE /Streams('<id>')
createStreamAttr(body)                     → POST /StreamAttributes
deleteStreamAttr(id)                       → DELETE /StreamAttributes(<id>)
```

### Assignments
```js
getAssignments()                           → GET /RoleAssignments?$expand=role
createAssignment(body)                     → POST /RoleAssignments
deleteAssignment(id)                       → DELETE /RoleAssignments(<id>)
```

### BDC Settings
```js
getBdcSettings()                           → GET /BdcSettings?$expand=environment
createBdcSetting(body)                     → POST /BdcSettings
updateBdcSetting(id, body)                 → PATCH /BdcSettings('<id>')
deleteBdcSetting(id)                       → DELETE /BdcSettings('<id>')
```

### Actions
```js
generateOrgRole(orgNodeId)                 → POST /generateOrgRole
generateAllOrgRoles()                      → POST /generateAllOrgRoles
resolveEffective(roleId)                   → POST /resolveEffectiveRestrictions
simulateAccess(roleId, sampleData, restr)  → POST /simulateAccess
syncDynamicRule(ruleId)                    → POST /syncDynamicRule
testBdcConnection(settingId)               → POST /testBdcConnection
triggerReplication()                       → POST /triggerReplication
checkReplicationStatuses()                 → POST /checkReplicationStatuses
getCurrentUserPermissions()                → GET /getCurrentUserPermissions()
searchLdapUsers(query)                     → POST /searchLdapUsers
```
