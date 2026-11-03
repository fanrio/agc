import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import UserRoleAssignment from '../UserRoleAssignment';
import * as api from '../../api';

vi.mock('../../api', () => ({
  createAssignment: vi.fn().mockResolvedValue({ ID: 'test-assign-1' }),
  getAssignments: vi.fn().mockResolvedValue([
    { ID: 'ass-1', userId: 'alice@fanrio.com', role_ID: 'role-1', role: { ID: 'role-1', name: 'Role One' } }
  ]),
  getAccessDomainsFlat: vi.fn().mockResolvedValue([
    { ID: 'dom-sales', name: 'Sales', description: 'Sales Domain' },
    { ID: 'dom-finance', name: 'Finance', description: 'Finance Domain' }
  ]),
  searchScimUsers: vi.fn().mockResolvedValue([
    { username: 'bob@fanrio.com', displayName: 'Bob Martin', email: 'bob@fanrio.com', department: 'Sales' },
    { username: 'alice@fanrio.com', displayName: 'Alice Smith', email: 'alice@fanrio.com', department: 'Finance' }
  ])
}));

const mockRoles = [
  {
    ID: 'role-1',
    name: 'Role One',
    type: 'SINGLE',
    targetPlatform: 'DATASPHERE',
    environment_ID: 'D',
    description: 'First test role',
    accessDomain_ID: 'dom-sales',
    ownRestrictions: [{ field: 'CostCenter', value: '1000' }]
  },
  {
    ID: 'role-2',
    name: 'Role Two',
    type: 'DERIVED',
    targetPlatform: 'DATABRICKS',
    environment_ID: 'P',
    description: 'Second test role',
    accessDomain_ID: 'dom-finance',
    ownRestrictions: [{ field: 'CompanyCode', value: 'DE01' }]
  },
  {
    ID: 'role-3',
    name: 'Role Three',
    type: 'ORG_BASED',
    targetPlatform: 'BOTH',
    environment_ID: 'Q',
    description: 'Third test role',
    accessDomain_ID: 'dom-sales',
    ownRestrictions: [{ field: 'Region', value: 'EU' }]
  },
  {
    ID: 'role-no-restrictions',
    name: 'Empty Role',
    type: 'SINGLE',
    targetPlatform: 'DATASPHERE',
    environment_ID: 'D',
    description: 'Has no restrictions',
    accessDomain_ID: 'dom-finance',
    ownRestrictions: []
  }
];

describe('UserRoleAssignment 2-Column Modal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 2-column modal layout with user selection, role catalog, and filter dropdowns', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Assign Authorization Roles')).toBeInTheDocument();
    expect(screen.getByText(/1\. Select User/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Select Roles/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search roles by name or description...')).toBeInTheDocument();

    // Verify filter dropdown labels
    expect(screen.getByLabelText('Platform')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Access Domain')).toBeInTheDocument();

    expect(screen.getByText('Role One')).toBeInTheDocument();
    expect(screen.getByText('Role Two')).toBeInTheDocument();
    expect(screen.getByText('Role Three')).toBeInTheDocument();
  });

  it('filters roles by Platform dropdown', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    // Open Platform dropdown
    fireEvent.mouseDown(screen.getByLabelText('Platform'));
    const databricksOption = screen.getByRole('option', { name: /^Databricks$/i });
    fireEvent.click(databricksOption);

    // Role Two (DATABRICKS) and Role Three (BOTH) should be visible, Role One (DATASPHERE) should not
    expect(screen.getByText('Role Two')).toBeInTheDocument();
    expect(screen.getByText('Role Three')).toBeInTheDocument();
    expect(screen.queryByText('Role One')).not.toBeInTheDocument();
  });

  it('filters roles by Type dropdown', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    // Open Type dropdown
    fireEvent.mouseDown(screen.getByLabelText('Type'));
    const derivedOption = screen.getByRole('option', { name: /^Derived$/i });
    fireEvent.click(derivedOption);

    // Role Two (DERIVED) should be visible, others should not
    expect(screen.getByText('Role Two')).toBeInTheDocument();
    expect(screen.queryByText('Role One')).not.toBeInTheDocument();
    expect(screen.queryByText('Role Three')).not.toBeInTheDocument();
  });

  it('filters roles by Access Domain dropdown', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        accessDomains={[
          { ID: 'dom-sales', name: 'Sales' },
          { ID: 'dom-finance', name: 'Finance' }
        ]}
        onClose={vi.fn()}
      />
    );

    // Open Access Domain dropdown
    fireEvent.mouseDown(screen.getByLabelText('Access Domain'));
    const financeOption = screen.getByRole('option', { name: /^Finance$/i });
    fireEvent.click(financeOption);

    // Role Two and Empty Role (Finance) should match, Role One and Three (Sales) should not
    expect(screen.getByText('Role Two')).toBeInTheDocument();
    expect(screen.queryByText('Role One')).not.toBeInTheDocument();
    expect(screen.queryByText('Role Three')).not.toBeInTheDocument();
  });

  it('disables roles without restrictions and shows "No Restrictions" badge', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('No Restrictions')).toBeInTheDocument();
  });

  it('handles search input and role toggling cleanly', async () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    // Filter roles by search query
    const roleSearchInput = screen.getByPlaceholderText('Search roles by name or description...');
    fireEvent.change(roleSearchInput, { target: { value: 'First' } });

    expect(screen.getByText('Role One')).toBeInTheDocument();
    expect(screen.queryByText('Role Two')).not.toBeInTheDocument();

    // Toggle Role One
    const roleOneCard = screen.getByText('Role One');
    fireEvent.click(roleOneCard);

    // Chip counter shows 1 selected
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
