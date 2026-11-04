import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RoleAssignmentsView from '../RoleAssignmentsView';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getAssignments: vi.fn(),
  getRoles: vi.fn(),
  deleteAssignment: vi.fn()
}));

vi.mock('../../context/PermissionsContext', () => ({
  usePermissions: vi.fn().mockReturnValue({
    permissions: { isSuperAdmin: true, canAssignRoles: true },
    loading: false
  })
}));

const mockAssignments = [
  {
    ID: 'ass-1',
    userId: 'alice@fanrio.com',
    userName: 'Alice Smith',
    role_ID: 'role-1',
    role: { ID: 'role-1', name: 'Sales Manager', type: 'SINGLE', targetPlatform: 'DATASPHERE' },
    createdAt: '2026-11-01T10:00:00Z',
    createdBy: 'admin'
  },
  {
    ID: 'ass-2',
    userId: 'alice@fanrio.com',
    userName: 'Alice Smith',
    role_ID: 'role-2',
    role: { ID: 'role-2', name: 'Finance Viewer', type: 'DERIVED', targetPlatform: 'DATABRICKS' },
    createdAt: '2026-11-02T11:00:00Z',
    createdBy: 'admin'
  },
  {
    ID: 'ass-3',
    userId: 'bob@fanrio.com',
    userName: 'Bob Martin',
    role_ID: 'role-1',
    role: { ID: 'role-1', name: 'Sales Manager', type: 'SINGLE', targetPlatform: 'DATASPHERE' },
    createdAt: '2026-11-03T12:00:00Z',
    createdBy: 'manager'
  }
];

const mockRoles = [
  { ID: 'role-1', name: 'Sales Manager', type: 'SINGLE' },
  { ID: 'role-2', name: 'Finance Viewer', type: 'DERIVED' }
];

describe('RoleAssignmentsView Component - Grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAssignments as any).mockResolvedValue(mockAssignments);
    (api.getRoles as any).mockResolvedValue(mockRoles);
  });

  it('groups role assignments by user by default', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Martin')).toBeInTheDocument();
    });

    // Verify "User" toggle is selected by default
    const userToggle = screen.getByRole('button', { name: /^User$/i });
    expect(userToggle).toHaveAttribute('aria-pressed', 'true');

    // Alice has 2 roles, Bob has 1 role
    expect(screen.getByText('2 roles')).toBeInTheDocument();
    expect(screen.getByText('1 role')).toBeInTheDocument();

    // Verify role rows under Alice
    expect(screen.getAllByText('Sales Manager').length).toBeGreaterThan(0);
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
  });

  it('switches grouping to role when "Role" toggle is clicked', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Click "Role" toggle
    const roleToggle = screen.getByRole('button', { name: /^Role$/i });
    fireEvent.click(roleToggle);

    // Now group headers should be roles
    expect(roleToggle).toHaveAttribute('aria-pressed', 'true');

    // Sales Manager has 2 users, Finance Viewer has 1 user
    expect(screen.getByText('2 users')).toBeInTheDocument();
    expect(screen.getByText('1 user')).toBeInTheDocument();

    // Verify user rows under Sales Manager and Finance Viewer (Alice has 2 roles, Bob has 1)
    expect(screen.getAllByText('alice@fanrio.com').length).toBe(2);
    expect(screen.getByText('bob@fanrio.com')).toBeInTheDocument();
  });

  it('toggles collapsing and expanding of groups', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
    });

    // Click Alice Smith group row to collapse
    const aliceHeader = screen.getByText('Alice Smith');
    fireEvent.click(aliceHeader);

    // Finance Viewer should now be collapsed/hidden
    expect(screen.queryByText('Finance Viewer')).not.toBeInTheDocument();

    // Click Alice Smith again to expand
    fireEvent.click(aliceHeader);
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();

    // Test Collapse All / Expand All
    const collapseAllBtn = screen.getByText('Collapse All');
    fireEvent.click(collapseAllBtn);
    expect(screen.queryByText('Finance Viewer')).not.toBeInTheDocument();

    const expandAllBtn = screen.getByText('Expand All');
    fireEvent.click(expandAllBtn);
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
  });
});
