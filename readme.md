# fanrio-auth — SAP BDC Authorization Wizard

A full-stack application for managing role-based authorization in SAP BDC / DataSphere environments.

- **Backend**: SAP CAP (Node.js) — OData v4 service
- **Frontend**: React + Vite + Material UI
- **Dev DB**: SQLite  |  **Prod DB**: SAP HANA Cloud

---

## Quick Start

```bash
# Install dependencies
npm install
cd app/catalog && npm install && cd ../..

# Deploy database schema
npx cds deploy

# Start full dev stack (CAP + Vite)
npm run dev
```

Runs at:
- CAP Backend: `http://localhost:4004`
- React Frontend: `http://localhost:5173`

---

## Documentation

| Document | Description |
|---|---|
| [`.agents/AGENTS.md`](.agents/AGENTS.md) | **AI agent rules** — read this first before making any changes |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture, tech stack, backend/frontend structure |
| [`DATA_MODEL.md`](DATA_MODEL.md) | Complete entity reference with all fields and relationships |
| [`API_REFERENCE.md`](API_REFERENCE.md) | All OData endpoints and frontend API functions |
| [`FRONTEND_COMPONENTS.md`](FRONTEND_COMPONENTS.md) | React component reference with props and responsibilities |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Step-by-step guides for common extension patterns |

---

## Project Structure

```
fanrio-auth/
├── db/                     # CDS data model + seed CSVs
│   ├── schema.cds          # Entity definitions (source of truth)
│   └── data/               # CSV seed data
├── srv/                    # CAP backend
│   ├── authorization-service.cds  # OData service contract
│   ├── authorization-service.js   # Wiring layer (thin)
│   ├── handlers/           # Entity event hooks
│   ├── services/           # Business logic services
│   └── lib/                # Utility modules
├── app/catalog/            # React frontend
│   └── src/
│       ├── api.js          # All OData API calls
│       ├── App.jsx         # Navigation shell
│       ├── context/        # Permissions context
│       └── components/     # Views and Wizard
└── test/                   # Node.js test suites
```

---

## Dev Commands

```bash
npm run dev          # Start full stack (CAP + Vite)
npm run dev:cap      # CAP backend only
npm run dev:ui       # Vite frontend only
npx cds deploy       # Deploy schema to SQLite
npm run test         # Run all backend tests
npm run build        # Production build
```

---

## Key Concepts

- **Roles** have **Restrictions** that filter which data a user can access
- **Streams** classify roles into hierarchical categories; each Stream auto-creates a HANA flat authorization table
- **HANA Replication**: When a user is assigned a role, restrictions are expanded (Cartesian product) into flat rows written to HANA
- **DRAGE**: Dynamic Role & Assignment Generation Engine — rules that auto-create roles and assignments when master data changes
