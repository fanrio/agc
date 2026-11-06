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
    role: { ID: 'role-1', name: 'Sales Manager', type: 'SINGLE' },
    createdAt: '2026-11-01T10:00:00Z',
    createdBy: 'admin'
  },
  {
    ID: 'ass-2',
    userId: 'alice@fanrio.com',
    userName: 'Alice Smith',
    role_ID: 'role-2',
    role: { ID: 'role-2', name: 'Finance Viewer', type: 'DERIVED' },
    createdAt: '2026-11-02T11:00:00Z',
    createdBy: 'admin'
  },
  {
    ID: 'ass-3',
    userId: 'bob@fanrio.com',
    userName: 'Bob Martin',
    role_ID: 'role-1',
    role: { ID: 'role-1', name: 'Sales Manager', type: 'SINGLE' },
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

  it('groups role assignments by user and is collapsed by default', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Martin')).toBeInTheDocument();
    });

    // Verify "User" toggle is selected by default
    const userToggle = screen.getByRole('button', { name: /^User$/i });
    expect(userToggle).toHaveAttribute('aria-pressed', 'true');

    // Group count chips are visible on the headers
    expect(screen.getByText('2 roles')).toBeInTheDocument();
    expect(screen.getByText('1 role')).toBeInTheDocument();

    // Per default the groups are COLLAPSED: child role rows are not rendered
    expect(screen.queryByText('Finance Viewer')).not.toBeInTheDocument();

    // Click on Alice Smith header to expand
    fireEvent.click(screen.getByText('Alice Smith'));

    // Now Finance Viewer and Sales Manager are visible under Alice
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
    expect(screen.getByText('Sales Manager')).toBeInTheDocument();
  });

  it('switches grouping to role and remains collapsed by default until expanded', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Click "Role" toggle
    const roleToggle = screen.getByRole('button', { name: /^Role$/i });
    fireEvent.click(roleToggle);

    expect(roleToggle).toHaveAttribute('aria-pressed', 'true');

    // Role group headers are visible
    expect(screen.getByText('Sales Manager')).toBeInTheDocument();
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
    expect(screen.getByText('2 users')).toBeInTheDocument();
    expect(screen.getByText('1 user')).toBeInTheDocument();

    // Per default collapsed: user rows are not rendered initially
    expect(screen.queryByText('alice@fanrio.com')).not.toBeInTheDocument();
    expect(screen.queryByText('bob@fanrio.com')).not.toBeInTheDocument();

    // Click "Sales Manager" header to expand it
    fireEvent.click(screen.getByText('Sales Manager'));

    // Now users under Sales Manager are visible
    expect(screen.getByText('alice@fanrio.com')).toBeInTheDocument();
    expect(screen.getByText('bob@fanrio.com')).toBeInTheDocument();
  });

  it('supports Expand All and Collapse All', async () => {
    render(<RoleAssignmentsView />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Groups are collapsed by default
    expect(screen.queryByText('Finance Viewer')).not.toBeInTheDocument();

    // Click "Expand All"
    const expandAllBtn = screen.getByText('Expand All');
    fireEvent.click(expandAllBtn);

    // All child items should be visible
    expect(screen.getByText('Finance Viewer')).toBeInTheDocument();
    expect(screen.getAllByText('Sales Manager').length).toBeGreaterThan(0);

    // Click "Collapse All"
    const collapseAllBtn = screen.getByText('Collapse All');
    fireEvent.click(collapseAllBtn);

    // All child items should be hidden again
    expect(screen.queryByText('Finance Viewer')).not.toBeInTheDocument();
  });
});
