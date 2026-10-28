import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React, { Profiler, ProfilerOnRenderCallback } from 'react';
import RolesDashboard from '../RolesDashboard';
import RoleTableView from '../RoleTableView';
import RoleTreeView from '../RoleTreeView';
import RoleCard from '../RoleCard';
import * as api from '../../api';
import { PermissionsProvider } from '../../context/PermissionsContext';

expect.extend(matchers);

// Mock api methods
vi.mock('../../api', () => ({
  getRoles: vi.fn(),
  getAllOrgNodesFlat: vi.fn(),
  getEnvironments: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
  deleteRole: vi.fn(),
  resolveEffective: vi.fn(),
  setSimulatedUser: vi.fn(),
}));

const mockPermissions = {
  isSuperAdmin: true,
  canManageAppUsers: true,
  canManageOrgRoles: true,
  canManageSingleRoles: true,
  canManageDerivedRoles: true,
  managedDerivedRolesScope: [],
  canAssignRoles: true,
  canManageReplications: true,
  canViewAuditLogs: true,
  canManageSettings: true,
  allowedEnvironments: [],
  allowedAccessDomains: [],
  isActive: true,
  userId: 'admin-user',
  userName: 'Admin'
};

const mockOrgNodes = [
  { ID: 'node-0', name: 'Sales Division' },
  { ID: 'node-1', name: 'Engineering Division' },
  { ID: 'node-2', name: 'Finance Division' }
];

const mockEnvironments = [
  { ID: 'DEV', name: 'Development' },
  { ID: 'TST', name: 'Testing' },
  { ID: 'PRD', name: 'Production' }
];

function generateMockRoles(count: number) {
  const roles: any[] = [];
  for (let i = 0; i < count; i++) {
    const isRoot = (i % 5 === 0);
    const parentId = isRoot ? null : `role-${Math.floor(i / 5) * 5}`;
    
    roles.push({
      ID: `role-${i}`,
      name: `Role_${i.toString().padStart(4, '0')}`,
      description: `Description for test role ${i} with extended permissions details`,
      type: i % 3 === 0 ? 'ORG_BASED' : (i % 3 === 1 ? 'DERIVED' : 'SINGLE'),
      environment_ID: i % 2 === 0 ? 'DEV' : 'PRD',
      critical: i % 10 === 0,
      modifiedAt: '2026-07-31T12:00:00.000Z',
      assignmentsCount: i % 4,
      assignments: Array.from({ length: i % 4 }, (_, k) => ({ userId: `user_${i}_${k}` })),
      ownRestrictions: [
        { ID: `rest-${i}`, field: 'BEGDA', operator: 'EQ', value: '20260101' }
      ],
      parentRoles: parentId ? [{ parent_ID: parentId, parent: { ID: parentId, name: `Role_${parentId}` } }] : [],
      approvers: [{ userId: 'admin-user' }],
      orgNode_ID: `node-${i % 3}`
    });
  }
  return roles;
}

interface ProfilerRecord {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
}

describe('Roles Page Performance Benchmarking Suite', () => {
  let profilerLogs: ProfilerRecord[] = [];

  const onRenderCallback: ProfilerOnRenderCallback = (
    id, phase, actualDuration, baseDuration, startTime, commitTime
  ) => {
    profilerLogs.push({
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    profilerLogs = [];

    (api.getCurrentUserPermissions as any).mockResolvedValue(mockPermissions);
    (api.getAllOrgNodesFlat as any).mockResolvedValue(mockOrgNodes);
    (api.getEnvironments as any).mockResolvedValue(mockEnvironments);
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <PermissionsProvider userId="admin-user">
        {ui}
      </PermissionsProvider>
    );
  };

  // --- Suite 1: Initial Render Scalability ---
  describe('1. Initial Render Scalability (10, 100, 500 roles)', () => {
    [10, 100, 500].forEach((roleCount) => {
      it(`measures initial render performance for ${roleCount} roles`, async () => {
        const testRoles = generateMockRoles(roleCount);
        (api.getRoles as any).mockImplementation((params?: any) => {
          const top = params?.top || roleCount;
          const skip = params?.skip || 0;
          const sliced = testRoles.slice(skip, skip + top);
          return Promise.resolve({ value: sliced, count: testRoles.length });
        });

        const startWall = performance.now();

        renderWithProviders(
          <Profiler id={`roles-dashboard-${roleCount}`} onRender={onRenderCallback}>
            <RolesDashboard />
          </Profiler>
        );

        await waitFor(() => {
          expect(screen.getByText(new RegExp(`Showing ${Math.min(25, roleCount)} of ${roleCount} roles`, 'i'))).toBeInTheDocument();
        });

        const endWall = performance.now();
        const totalWallDuration = endWall - startWall;

        const mountLogs = profilerLogs.filter(l => l.phase === 'mount');
        const totalActualDuration = profilerLogs.reduce((acc, l) => acc + l.actualDuration, 0);
        const lastBaseDuration = profilerLogs[profilerLogs.length - 1]?.baseDuration || 0;

        console.log(`\n=== Benchmark Result: Dataset Size = ${roleCount} Roles ===`);
        console.log(`Wall Clock Time (start to loaded): ${totalWallDuration.toFixed(2)} ms`);
        console.log(`Profiler Mount Actual Duration: ${mountLogs[0]?.actualDuration.toFixed(2) ?? 'N/A'} ms`);
        console.log(`Profiler Total Actual Duration (all renders): ${totalActualDuration.toFixed(2)} ms`);
        console.log(`Profiler Base Duration: ${lastBaseDuration.toFixed(2)} ms`);
        console.log(`Total Commit Count: ${profilerLogs.length}`);

        expect(totalWallDuration).toBeGreaterThan(0);
        expect(profilerLogs.length).toBeGreaterThan(0);
      }, 15000);
    });
  });

  // --- Suite 2: Standalone Component Rendering Scaling ---
  describe('2. Standalone Component View Scaling (RoleTableView, RoleCard Grid, RoleTreeView)', () => {
    [10, 100, 500].forEach((roleCount) => {
      it(`measures TableView render duration for ${roleCount} roles`, () => {
        const testRoles = generateMockRoles(roleCount);

        const startWall = performance.now();
        renderWithProviders(
          <Profiler id={`table-view-${roleCount}`} onRender={onRenderCallback}>
            <RoleTableView
              roles={testRoles}
              allRoles={testRoles}
              orgNodes={mockOrgNodes}
              permissions={mockPermissions}
            />
          </Profiler>
        );
        const endWall = performance.now();

        const mountLog = profilerLogs.find(l => l.phase === 'mount');
        console.log(`[TableView Standalone - ${roleCount} roles] Wall: ${(endWall - startWall).toFixed(2)}ms | Profiler Actual: ${mountLog?.actualDuration.toFixed(2)}ms | Base: ${mountLog?.baseDuration.toFixed(2)}ms`);

        expect(screen.getByText('Role Name')).toBeInTheDocument();
      }, 15000);

      it(`measures Grid View (RoleCard) render duration for ${roleCount} roles`, () => {
        const testRoles = generateMockRoles(roleCount);

        const startWall = performance.now();
        renderWithProviders(
          <Profiler id={`grid-view-${roleCount}`} onRender={onRenderCallback}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {testRoles.map(r => (
                <RoleCard
                  key={r.ID}
                  role={r}
                  allRoles={testRoles}
                  orgNodes={mockOrgNodes}
                  depth={0}
                  isCompact={true}
                  permissions={mockPermissions}
                />
              ))}
            </div>
          </Profiler>
        );
        const endWall = performance.now();

        const mountLog = profilerLogs.find(l => l.phase === 'mount');
        console.log(`[Grid View Standalone - ${roleCount} roles] Wall: ${(endWall - startWall).toFixed(2)}ms | Profiler Actual: ${mountLog?.actualDuration.toFixed(2)}ms | Base: ${mountLog?.baseDuration.toFixed(2)}ms`);

        expect(screen.getByText('Role_0000')).toBeInTheDocument();
      }, 15000);

      it(`measures Tree View render duration for ${roleCount} roles`, () => {
        const testRoles = generateMockRoles(roleCount);

        const startWall = performance.now();
        renderWithProviders(
          <Profiler id={`tree-view-${roleCount}`} onRender={onRenderCallback}>
            <RoleTreeView
              roles={testRoles}
              allRoles={testRoles}
              orgNodes={mockOrgNodes}
              permissions={mockPermissions}
            />
          </Profiler>
        );
        const endWall = performance.now();

        const mountLog = profilerLogs.find(l => l.phase === 'mount');
        console.log(`[Tree View Standalone - ${roleCount} roles] Wall: ${(endWall - startWall).toFixed(2)}ms | Profiler Actual: ${mountLog?.actualDuration.toFixed(2)}ms | Base: ${mountLog?.baseDuration.toFixed(2)}ms`);

        expect(screen.getByText('Role_0000')).toBeInTheDocument();
      }, 15000);
    });
  });

  // --- Suite 3: View Toggling Latency ---
  describe('3. View Toggling Latency (Table -> Grid -> Tree -> Table)', () => {
    it('measures re-render metrics when switching view modes with 100 roles', async () => {
      const testRoles = generateMockRoles(100);
      (api.getRoles as any).mockImplementation((params?: any) => {
        const top = params?.top || 100;
        const skip = params?.skip || 0;
        return Promise.resolve({ value: testRoles.slice(skip, skip + top), count: testRoles.length });
      });

      renderWithProviders(
        <Profiler id="view-toggle-benchmark" onRender={onRenderCallback}>
          <RolesDashboard />
        </Profiler>
      );

      await waitFor(() => {
        expect(screen.getByText(/Showing 25 of 100 roles/i)).toBeInTheDocument();
      });

      profilerLogs = []; // reset log tracking before interaction

      // Switch to Grid View
      const gridBtn = screen.getByRole('button', { name: /Grid/i });
      const startGridToggle = performance.now();
      await act(async () => {
        fireEvent.click(gridBtn);
      });
      const endGridToggle = performance.now();

      const gridUpdateLog = profilerLogs.find(l => l.phase === 'update');
      console.log(`\n=== Benchmark Result: View Switch to Grid ===`);
      console.log(`Wall Clock Time: ${(endGridToggle - startGridToggle).toFixed(2)} ms`);
      console.log(`Profiler Actual Duration: ${gridUpdateLog?.actualDuration.toFixed(2) ?? 'N/A'} ms`);
      console.log(`Profiler Base Duration: ${gridUpdateLog?.baseDuration.toFixed(2) ?? 'N/A'} ms`);

      profilerLogs = []; // reset log tracking

      // Switch to Tree View
      const treeBtn = screen.getByRole('button', { name: /Tree/i });
      const startTreeToggle = performance.now();
      await act(async () => {
        fireEvent.click(treeBtn);
      });
      const endTreeToggle = performance.now();

      const treeUpdateLog = profilerLogs.find(l => l.phase === 'update');
      console.log(`\n=== Benchmark Result: View Switch to Tree ===`);
      console.log(`Wall Clock Time: ${(endTreeToggle - startTreeToggle).toFixed(2)} ms`);
      console.log(`Profiler Actual Duration: ${treeUpdateLog?.actualDuration.toFixed(2) ?? 'N/A'} ms`);
      console.log(`Profiler Base Duration: ${treeUpdateLog?.baseDuration.toFixed(2) ?? 'N/A'} ms`);

      profilerLogs = []; // reset log tracking

      // Switch back to Table View
      const tableBtn = screen.getByRole('button', { name: /Table/i });
      const startTableToggle = performance.now();
      await act(async () => {
        fireEvent.click(tableBtn);
      });
      const endTableToggle = performance.now();

      const tableUpdateLog = profilerLogs.find(l => l.phase === 'update');
      console.log(`\n=== Benchmark Result: View Switch back to Table ===`);
      console.log(`Wall Clock Time: ${(endTableToggle - startTableToggle).toFixed(2)} ms`);
      console.log(`Profiler Actual Duration: ${tableUpdateLog?.actualDuration.toFixed(2) ?? 'N/A'} ms`);
      console.log(`Profiler Base Duration: ${tableUpdateLog?.baseDuration.toFixed(2) ?? 'N/A'} ms`);
    }, 20000);
  });

  // --- Suite 4: Search & Filtering Latency ---
  describe('4. Search Filtering Latency & Re-render Performance', () => {
    it('measures response time and re-render duration on typing search query', async () => {
      const testRoles = generateMockRoles(100);
      (api.getRoles as any).mockImplementation((params?: any) => {
        const query = params?.search || '';
        const filtered = testRoles.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));
        const top = params?.top || 25;
        const skip = params?.skip || 0;
        return Promise.resolve({ value: filtered.slice(skip, skip + top), count: filtered.length });
      });

      renderWithProviders(
        <Profiler id="search-filter-benchmark" onRender={onRenderCallback}>
          <RolesDashboard />
        </Profiler>
      );

      await waitFor(() => {
        expect(screen.getByText(/Showing 25 of 100 roles/i)).toBeInTheDocument();
      });

      profilerLogs = []; // Reset logs

      const searchInput = screen.getByPlaceholderText(/Search roles or restrictions/i);

      const startSearchWall = performance.now();
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'Role_0005' } });
      });

      await waitFor(() => {
        expect(api.getRoles).toHaveBeenCalledWith(expect.objectContaining({ search: 'Role_0005' }));
      });
      const endSearchWall = performance.now();

      const filterDuration = endSearchWall - startSearchWall;
      const searchLogs = profilerLogs.filter(l => l.phase === 'update');
      const totalSearchActual = searchLogs.reduce((acc, l) => acc + l.actualDuration, 0);

      console.log(`\n=== Benchmark Result: Search Filter Interaction ===`);
      console.log(`Wall Clock Search Interaction Latency: ${filterDuration.toFixed(2)} ms`);
      console.log(`Total Re-render Actual Duration across search updates: ${totalSearchActual.toFixed(2)} ms`);
      console.log(`Search Commit Count: ${searchLogs.length}`);

      expect(filterDuration).toBeGreaterThan(0);
    }, 15000);
  });

  // --- Suite 5: Pagination Re-render Latency ---
  describe('5. Pagination Change Latency', () => {
    it('measures latency and re-render duration when changing page and rows per page', async () => {
      const testRoles = generateMockRoles(100);
      (api.getRoles as any).mockImplementation((params?: any) => {
        const top = params?.top || 25;
        const skip = params?.skip || 0;
        return Promise.resolve({ value: testRoles.slice(skip, skip + top), count: testRoles.length });
      });

      renderWithProviders(
        <Profiler id="pagination-benchmark" onRender={onRenderCallback}>
          <RolesDashboard />
        </Profiler>
      );

      await waitFor(() => {
        expect(screen.getByText(/Showing 25 of 100 roles/i)).toBeInTheDocument();
      });

      profilerLogs = []; // Reset logs

      // Trigger Next Page click
      const nextPageBtn = screen.getByRole('button', { name: /Go to next page/i });
      const startPageWall = performance.now();
      await act(async () => {
        fireEvent.click(nextPageBtn);
      });

      await waitFor(() => {
        expect(api.getRoles).toHaveBeenCalledWith(expect.objectContaining({ skip: 25 }));
      });
      const endPageWall = performance.now();

      const pageChangeDuration = endPageWall - startPageWall;
      const pageUpdateLogs = profilerLogs.filter(l => l.phase === 'update');
      const totalPageActual = pageUpdateLogs.reduce((acc, l) => acc + l.actualDuration, 0);

      console.log(`\n=== Benchmark Result: Pagination Next Page ===`);
      console.log(`Wall Clock Page Switch Latency: ${pageChangeDuration.toFixed(2)} ms`);
      console.log(`Total Re-render Actual Duration: ${totalPageActual.toFixed(2)} ms`);

      expect(pageChangeDuration).toBeGreaterThan(0);
    }, 15000);
  });
});
