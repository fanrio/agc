# Contributing & Development Guide

This document explains how to extend the fanrio-auth codebase safely and consistently.

> [!NOTE]
> This guide is intended for both humans and AI coding assistants.
> See [`.agents/AGENTS.md`](.agents/AGENTS.md) for AI-specific rules.

---

## 1. Workflow Overview

```
1. Read ARCHITECTURE.md → Understand the system
2. Read DATA_MODEL.md   → Understand entity structures
3. Read API_REFERENCE.md → Understand the OData surface
4. Make your changes
5. Run tests: npm run test
6. If schema changed: npx cds deploy
7. Commit changes
```

---

## 2. Adding a New Database Entity

### Step-by-step

1. **Define the entity** in `db/schema.cds`:
   ```cds
   entity MyNewEntity : cuid, managed {
     name  : String(100) not null;
     value : String(200);
   }
   ```

2. **Expose it in the OData service** (`srv/authorization-service.cds`):
   ```cds
   entity MyNewEntity as projection on db.MyNewEntity;
   ```

3. **Create a seed CSV file** at `db/data/fanrio.auth-MyNewEntity.csv`:
   ```csv
   ID,name,value
   ```
   (Even an empty file with just the header is required if the entity appears in the schema.)

4. **Deploy the schema**:
   ```bash
   npx cds deploy
   ```

5. **Add frontend API functions** in `app/catalog/src/api.js`:
   ```js
   export const getMyNewEntities  = ()         => request('GET',    '/MyNewEntity');
   export const createMyNewEntity = (body)     => request('POST',   '/MyNewEntity', body);
   export const updateMyNewEntity = (id, body) => request('PATCH',  `/MyNewEntity('${id}')`, body);
   export const deleteMyNewEntity = (id)       => request('DELETE', `/MyNewEntity('${id}')`);
   ```

6. **Run tests** to verify nothing is broken:
   ```bash
   npm run test
   ```

---

## 3. Adding a New OData Action

1. **Declare the action signature** in `srv/authorization-service.cds`:
   ```cds
   action myNewAction(param: String) returns {
     success : Boolean;
     message : String;
   };
   ```

2. **Implement the handler** in `srv/authorization-service.js`:
   ```js
   this.on('myNewAction', async (req) => {
     const { param } = req.data;
     // ... logic here
     return { success: true, message: 'Done' };
   });
   ```
   Or extract complex logic into a service factory in `srv/services/`.

3. **Add a frontend function** in `app/catalog/src/api.js`:
   ```js
   export const myNewAction = (param) => request('POST', '/myNewAction', { param });
   ```

---

## 4. Adding a New CAP Event Handler

Create a file in `srv/handlers/` following the existing pattern:

```js
// srv/handlers/myEntityHandlers.js
'use strict';

function registerMyEntityHandlers(service, entities, deps) {
  const { cds } = deps;
  const { MyEntity } = entities;

  service.before('CREATE', 'MyEntity', (req) => {
    if (!req.data.ID) req.data.ID = cds.utils.uuid();
  });

  service.after('CREATE', 'MyEntity', (entity, req) => {
    // side effects
  });
}

module.exports = { registerMyEntityHandlers };
```

Then register it in `srv/authorization-service.js`:

```js
const { registerMyEntityHandlers } = require('./handlers/myEntityHandlers');
// ...
registerMyEntityHandlers(this, entities, handlerDeps);
```

---

## 5. Adding a New Frontend View

1. **Create the component** at `app/catalog/src/components/MyView.jsx`.

2. **Import it** in the appropriate parent (`App.jsx` or `AdministrationView.jsx`).

3. **Add navigation** (if top-level) in `App.jsx`'s `NAV` array:
   ```jsx
   { id: 'myview', label: 'My View', icon: SomeIcon },
   ```

4. **Gate access** with permissions if needed:
   ```jsx
   if (item.id === 'myview') return !!permissions?.canManageSettings;
   ```

5. **Render the component** in `App.jsx`'s view switcher:
   ```jsx
   {activeNav === 'myview' && <MyView />}
   ```

---

## 6. Working with HierarchicalManager

The `HierarchicalManager` component (`app/catalog/src/components/HierarchicalManager.jsx`) is a reusable tree editor. It is used by both `OrgStructureView` and `StreamsView`.

```jsx
<HierarchicalManager
  title="My Tree"
  subtitle="Manage your hierarchy"
  emptyTitle="No nodes yet"
  emptySubtitle="Add a root node to get started."
  addNodePlaceholder="Node name"

  // API
  fetchNodesFlat={api.getMyNodesFlat}
  createNode={api.createMyNode}
  updateNode={api.updateMyNode}
  deleteNode={api.deleteMyNode}
  createAttribute={api.createMyAttr}
  deleteAttribute={api.deleteMyAttr}

  // Config
  defaultIcon={SomeLucideIcon}
  showTypeSelector={false}
  showDescriptionField={true}
  maxNameLength={50}

  canManage={canManage}
/>
```

---

## 7. Adding a New Restriction Field Type

If you need a new `filterType` for `Restrictions`:

1. **Document it** in `DATA_MODEL.md` under the Restrictions section.
2. **Handle parsing** in `srv/services/hanaReplicationService.js` inside `buildHanaEntries()`.
3. **Handle display** in `app/catalog/src/components/RestrictionBuilder.jsx`:
   - Add UI rendering in the `RestrictionDisplay` component
   - Add validation in the `canSaveRow` / submission logic
4. **Handle range formats** — both `RANGE` and `BT` are parsed identically as `{from, to}` JSON objects.

---

## 8. Modifying the HANA Replication

The replication pipeline is:

```
RoleAssignment CREATE/DELETE
  → assignmentHandlers.js
  → syncAssignmentToHana() in hanaReplicationService.js
  → resolveEffectiveRestrictions()
  → buildHanaEntries()  ← applies cartesianProduct()
  → HanaClient.syncAssignment()    (default flat table)
  → HanaClient.syncCustomAssignment()  (stream-specific table)
```

> [!CAUTION]
> The Cartesian product expansion is intentional and critical for correctness.
> If a role has Plant [10, 20] AND CompanyCode [CC1], it must produce TWO rows:
> - `{Plant: 10, CompanyCode: CC1}`
> - `{Plant: 20, CompanyCode: CC1}`
>
> Never flatten this to a single row.

---

## 9. Modifying Stream Table Creation

When a new `Stream` is created, `streamHandler.js` fires `HanaClient.createCustomFlatTable(conn, tableName)`.

- The table name is: `<sanitized_stream_name>_flat_authorizations`
- Sanitization: lowercase, non-alphanumeric chars → `_`, leading/trailing `_` removed
- Stream names are limited to **10 characters** to keep table names manageable

If you need to change the table schema (columns), modify `HanaClient.createCustomFlatTable()` in `srv/lib/hanaClient.js`.

> [!WARNING]
> Changing `createCustomFlatTable` only affects **newly created** tables.
> Existing tables in HANA will not be automatically migrated.

---

## 10. Testing

### Test Files

| File | Covers |
|---|---|
| `test/backend_tests.test.js` | Main integration suite: CRUD, actions, HANA replication, BDC actions |
| `test/dynamic_generation.test.js` | DRAGE engine: rule setup, auto-generation, cleanup |
| `test/auth_enforcement.test.js` | Permission gates, environment restrictions |

### Running Tests

```bash
npm run test
```

All tests use `@cap-js/cds-test` with the CAP in-memory SQLite engine. They start a real CAP server against a test SQLite DB.

### Writing Tests

Follow the pattern in `backend_tests.test.js`:
```js
const cds = require('@sap/cds');
const { test, describe, before, after, it } = require('node:test');
const assert = require('node:assert/strict');

let srv, adminRequest;

before(async () => {
  srv = await cds.test(...);
  adminRequest = srv.request.bind(srv);
});
```

---

## 11. Code Style Conventions

### Backend (Node.js / CDS)
- `'use strict'` at the top of every JS file
- Handler factories: `registerXxxHandlers(service, entities, deps)`
- Service factories: `makeXxxHandler(cds, entities)`
- Async/await everywhere — no raw promises
- Log with `console.log('[ServiceName] message')` — prefix with module name
- Background tasks: `cds.spawn({ user: req?.user }, async () => { ... })`

### Frontend (React)
- Functional components only (no class components)
- All API calls through `api.js` — no direct `fetch()` in components
- `usePermissions()` hook for permission checks
- MUI components for all UI — no custom HTML form elements
- Lucide React for icons

### Naming
| Pattern | Example |
|---|---|
| CDS entities | `PascalCase` |
| CSV seed files | `fanrio.auth-<EntityName>.csv` |
| Handler files | `<entityName>Handlers.js` or `<entityName>Handler.js` |
| Service files | `<domain>Service.js` |
| Lib files | `<name>Client.js` or `<name>Utils.js` |
| Frontend views | `<Name>View.jsx` |
| Frontend API functions | `verbNoun` (e.g. `createRole`, `getStreamsFlat`) |

---

## 12. Deployment Notes

### Development
- Database: SQLite (`sqlite.db` in project root)
- Auth: CAP mocked users (user `admin` is super admin by default)
- HANA: Not connected unless a real `BdcSettings` record with `connectionType: 'SAP Hana'` and `isActive: true` exists

### Production / Build
```bash
npm run build    # Builds frontend (Vite) + backend (cds build → gen/)
```

Generated artifacts:
- Frontend: `app/catalog/dist/`
- Backend: `gen/srv/`

> [!CAUTION]
> Never commit files in `gen/` to source control — they are auto-generated on build.
> Never commit `sqlite.db`, `sqlite.db-shm`, or `sqlite.db-wal` to source control.
