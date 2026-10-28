# Spec: Fixed Application Roles (`AppAuthorizationsView`)

## Objective
Replace the two-tab (`System Management` / `Role Management`) 8-checkbox permission matrix in [`AppAuthorizationsView.tsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/AppAuthorizationsView.tsx) with a unified, role-based experience built around **6 fixed Application Roles**, where **a user can be assigned one or more Application Roles simultaneously**.

### Why
When onboarding or managing application administrators in **Manage Users**, toggling 8+ low-level boolean flags (`canManageSingleRoles`, `canManageDerivedRoles`, `canManageSettings`, etc.) across two separate tabs is error-prone and high cognitive overhead. Administrators think in terms of job responsibilities (personas), and in many organizations a single person wears multiple hats (e.g., `SYSTEM_ADMIN` + `DERIVED_ROLE_MANAGER`, or `USER_ASSIGNMENT_ADMIN` + `AUDITOR`).

### Target User
Application and security administrators with `isSuperAdmin` or `canManageAppUsers` privileges who onboard and manage users in **Manage Users** ([`AppAuthorizationsView.tsx`](file:///c:/Users/Fan/Documents/fanrio-auth/app/catalog/src/components/AppAuthorizationsView.tsx)).

### The 6 Fixed Application Roles & Multi-Role Union Mapping
Each role represents an orthogonal capability cluster. When a user is assigned **multiple Application Roles**, their effective `AppAuthorizations` flags are computed as the **boolean OR (union)** of all selected roles' flags:

| Role ID | Display Name | Description | Primary `AppAuthorizations` Flags Enabled | Scoping Controls Activated |
|---|---|---|---|---|
| `SUPER_ADMIN` | **Super Administrator** | Full unrestricted access to all system settings, roles, assignments, replications, and users (supersedes all other roles when selected) | `isSuperAdmin: true`, `canManageAppUsers: true`, `canManageSettings: true`, `canManageOrgRoles: true`, `canManageSingleRoles: true`, `canManageDerivedRoles: true`, `canAssignRoles: true`, `canManageReplications: true`, `canViewAuditLogs: true` | None (`ALL` Environments, `ALL` Access Domains, `ALL` Scope) |
| `SYSTEM_ADMIN` | **System Administrator** | Manages BDC/HANA connections, Restriction Fields, Access Domains, Dynamic Rules, Replications, and App Users | `canManageAppUsers: true`, `canManageSettings: true`, `canManageReplications: true` | Allowed Environments |
| `AUTHORIZATION_ARCHITECT` | **Authorization Architect** | Central role designer — manages Org Structure, Single Roles, Derived Roles, and Replications | `canManageOrgRoles: true`, `canManageSingleRoles: true`, `canManageDerivedRoles: true`, `canManageReplications: true` | Allowed Environments, Allowed Access Domains |
| `DERIVED_ROLE_MANAGER` | **Derived Role Manager (Key User)** | Regional/department lead — derives child roles from permitted parent roles and assigns those derived roles to users | `canManageDerivedRoles: true` | Allowed Environments, Allowed Access Domains, Derived Role Scope (`ScopeSelector` — unless `AUTHORIZATION_ARCHITECT` or `SUPER_ADMIN` is also assigned) |
| `USER_ASSIGNMENT_ADMIN` | **User Assignment Admin** | Helpdesk / IAM provisioning — assigns and revokes existing roles for users and inspects effective access profiles | `canAssignRoles: true` | Allowed Environments, Allowed Access Domains |
| `AUDITOR` | **Auditor** | Read-only compliance reviewer — views Audit Logs, Dashboard KPIs, and User Access Profiles | `canViewAuditLogs: true` | Allowed Environments, Allowed Access Domains |

---

## Tech Stack
- **Frontend:** React 19 + TypeScript + Vite 8 + Material UI (`@mui/material` v7) + `lucide-react` icons
- **Backend:** SAP CAP (`@sap/cds` v10) OData v4 service (`/odata/v4/auth/AppAuthorizations`)
- **Database:** SQLite (`sqlite.db` in dev/test) / SAP HANA (prod) — existing `fanrio.auth.AppAuthorizations` schema preserved without breaking changes

---

## Commands
```bash
# Build frontend production bundle
npm run build --prefix app/catalog

# Run full backend integration & authorization test suite
npm run test

# Start full development stack (CAP + Vite)
npm run dev
```

---

## Project Structure
```text
app/catalog/src/
├── components/
│   ├── AppAuthorizationsView.tsx  # Primary view for managing App Users via Fixed Application Roles
│   ├── AppToast.tsx               # Unified toast notification component
│   ├── EnvironmentSelection.tsx   # Multi-select environment chip/dropdown control
│   └── UserSelection.tsx          # SCIM user search autocomplete
├── context/
│   └── PermissionsContext.tsx     # Consumes getCurrentUserPermissions() OData function
└── api.ts                         # OData v4 client calls (getAppAuthorizations, createAppAuthorization, updateAppAuthorization, deleteAppAuthorization)

srv/
├── handlers/
│   └── appAuthorizationsHandlers.js # Backend CRUD protection & AuditLog hooks for AppAuthorizations
└── lib/
    └── authGuard.js                 # Backend permission enforcement (getSessionPermissions, requirePermission)

test/
└── auth_enforcement.test.js         # Backend authorization & role-flag enforcement tests
```

---

## Code Style
Use strongly typed TypeScript definitions for the fixed role catalog, with deterministic bidirectional multi-role mapping (`rolesToFlags(roleIds: AppRoleId[])` and `inferAppRolesFromFlags(auth): AppRoleId[]`) so existing database rows without a dedicated `appRoles` column resolve cleanly to their matching array of roles:

```tsx
export type AppRoleId =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'AUTHORIZATION_ARCHITECT'
  | 'DERIVED_ROLE_MANAGER'
  | 'USER_ASSIGNMENT_ADMIN'
  | 'AUDITOR';

export interface AppRoleFlags {
  isSuperAdmin: boolean;
  canManageAppUsers: boolean;
  canManageSettings: boolean;
  canManageOrgRoles: boolean;
  canManageSingleRoles: boolean;
  canManageDerivedRoles: boolean;
  canAssignRoles: boolean;
  canManageReplications: boolean;
  canViewAuditLogs: boolean;
}

export interface AppRoleDefinition {
  id: AppRoleId;
  label: string;
  description: string;
  color: 'error' | 'warning' | 'primary' | 'secondary' | 'info' | 'success';
  flags: AppRoleFlags;
  supportsEnvironmentScope: boolean;
  supportsAccessDomainScope: boolean;
  supportsDerivedRoleScope: boolean;
}

export function rolesToFlags(roleIds: AppRoleId[]): AppRoleFlags {
  const effective: AppRoleFlags = {
    isSuperAdmin: false,
    canManageAppUsers: false,
    canManageSettings: false,
    canManageOrgRoles: false,
    canManageSingleRoles: false,
    canManageDerivedRoles: false,
    canAssignRoles: false,
    canManageReplications: false,
    canViewAuditLogs: false,
  };
  for (const id of roleIds) {
    const def = APP_ROLES_BY_ID[id];
    if (!def) continue;
    (Object.keys(effective) as (keyof AppRoleFlags)[]).forEach((k) => {
      if (def.flags[k]) effective[k] = true;
    });
  }
  return effective;
}

export function inferAppRolesFromFlags(auth: Record<string, any>): AppRoleId[] {
  if (auth.isSuperAdmin) return ['SUPER_ADMIN'];
  const roles: AppRoleId[] = [];
  if (auth.canManageSettings || auth.canManageAppUsers) roles.push('SYSTEM_ADMIN');
  if (auth.canManageOrgRoles || auth.canManageSingleRoles) {
    roles.push('AUTHORIZATION_ARCHITECT');
  } else if (auth.canManageDerivedRoles) {
    roles.push('DERIVED_ROLE_MANAGER');
  }
  if (auth.canAssignRoles) roles.push('USER_ASSIGNMENT_ADMIN');
  if (auth.canViewAuditLogs) roles.push('AUDITOR');
  return roles.length > 0 ? roles : ['AUDITOR'];
}
```

---

## Testing Strategy
- **Frontend Build & Type Verification:** Run `npm run build --prefix app/catalog` to verify zero TypeScript or bundler errors.
- **Backend Regression Suite:** Run `npm run test` (`test/auth_enforcement.test.js`, `test/backend_tests.test.js`, `test/dynamic_generation.test.js`) to confirm all 60 backend tests pass with the existing `AppAuthorizations` entity structure.
- **Unit / Integration Verification:** Verify that selecting one or multiple roles in `AppAuthorizationsView.tsx` computes the boolean union of flags via `rolesToFlags(roleIds)` and sends the exact expected payload to `POST /odata/v4/auth/AppAuthorizations` and `PATCH /odata/v4/auth/AppAuthorizations('<ID>')`.

---

## Boundaries
- **Always do:**
  - Map the 6 fixed Application Roles (and any multi-role combination) directly to the existing `AppAuthorizations` boolean flags so backend enforcement in `srv/lib/authGuard.js` remains 100% compatible.
  - Ensure that selecting `SUPER_ADMIN` supersedes other roles (or automatically grants full access across all scopes).
  - Use unified MUI theme tokens and `AppToast` for notifications.
  - Run `npm run build --prefix app/catalog` and `npm run test` before completion.
- **Ask first:**
  - Any change to `db/schema.cds` or `srv/authorization-service.cds`.
  - Adding or removing any of the 6 fixed roles.
- **Never do:**
  - Touch `sqlite.db`, `gen/`, or `node_modules/` directly.
  - Alter the core HANA replication Cartesian product logic.
  - Call `fetch()` directly inside `AppAuthorizationsView.tsx` (always use `app/catalog/src/api.ts`).

---

## Success Criteria
1. **Single Unified Table in `AppAuthorizationsView.tsx`:** The two separate tabs (`System Management` and `Role Management`) and the 8 boolean checkbox columns are replaced by a single table with columns:
   - `User ID`
   - `User Name`
   - `Active` (toggle)
   - `Application Roles` (inline multi-select `Autocomplete` / role `Chip`s allowing admins to view, add, and remove one or more fixed roles per user)
   - `Derived Role Scope` (editable `ScopeSelector` when `DERIVED_ROLE_MANAGER` is assigned without `AUTHORIZATION_ARCHITECT` or `SUPER_ADMIN`; otherwise displays `All Roles` or `—`)
   - `Environments` (editable `EnvironmentSelection` for scoped roles; `ALL` chip for `SUPER_ADMIN`)
   - `Access Domains` (editable `AccessDomainCell` when any selected role supports Access Domain scoping and `SUPER_ADMIN` is not selected; otherwise `All Access Domains` chip)
   - `Actions` (`Delete` user button)
2. **Multi-Role "Add User" Dialog:**
   - Admin selects a SCIM user via `UserSelection`.
   - Admin selects **one or more of the 6 Fixed Application Roles** (interactive multi-select cards/checkboxes with clear title + one-line description of what each role can do; selecting `SUPER_ADMIN` toggles exclusive full access).
   - Scoping controls (*Allowed Environments*, *Allowed Access Domains*, and *Derived Role Scope*) dynamically appear based on the union of the selected roles.
   - Clicking **Add** persists the unioned boolean flags (`rolesToFlags(selectedRoles)`) and scoping fields via `api.createAppAuthorization(...)`.
3. **Zero Regressions:** `npm run build --prefix app/catalog` compiles with 0 errors and `npm run test` passes all 60 tests.

---

## Open Questions
- None — all requirements were clarified during the `/interview-me` session.
