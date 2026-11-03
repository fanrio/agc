import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    { username: 'alice@fanrio.com', displayName: 'Alice Smith', email: 'alice@fanrio.com', department: 'Finance' },
    { username: 'charlie@fanrio.com', displayName: 'Charlie Brown', email: 'charlie@fanrio.com', department: 'IT' }
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

describe('UserRoleAssignment Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal layout with multi-user selection, role catalog, and filter dropdowns', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Assign Authorization Roles')).toBeInTheDocument();
    expect(screen.getByText(/1\. Select Users/)).toBeInTheDocument();
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

  it('disables roles without restrictions', () => {
    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        onClose={vi.fn()}
      />
    );

    // Empty Role has no restrictions, so its checkbox is disabled
    const emptyRoleText = screen.getByText('Empty Role');
    const emptyRoleCard = emptyRoleText.closest('.MuiCard-root');
    const checkbox = emptyRoleCard?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeDisabled();
  });

  it('supports M:N assignment workflow: multiple users assigned to multiple roles', async () => {
    const onSuccessMock = vi.fn();
    const onCloseMock = vi.fn();

    render(
      <UserRoleAssignment
        open={true}
        roles={mockRoles}
        allRoles={mockRoles}
        existingAssignments={[
          { ID: 'ass-1', userId: 'alice@fanrio.com', role_ID: 'role-1' }
        ]}
        onSuccess={onSuccessMock}
        onClose={onCloseMock}
      />
    );

    // Select User 1: Search 'bob'
    const userInput = screen.getByPlaceholderText('Type name, email, or username...');
    fireEvent.focus(userInput);
    fireEvent.change(userInput, { target: { value: 'bob' } });
    await new Promise(resolve => setTimeout(resolve, 350));

    await waitFor(() => {
      expect(api.searchScimUsers).toHaveBeenCalledWith('bob');
    });

    const bobOption = await screen.findByText('Bob Martin');
    fireEvent.click(bobOption);

    // Select User 2: Search 'alice'
    fireEvent.focus(userInput);
    fireEvent.change(userInput, { target: { value: 'alice' } });
    await new Promise(resolve => setTimeout(resolve, 350));

    await waitFor(() => {
      expect(api.searchScimUsers).toHaveBeenCalledWith('alice');
    });

    const aliceOption = await screen.findByText('Alice Smith');
    fireEvent.click(aliceOption);

    // Both users should now be selected (2 selected)
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Select Role Two and Role Three (N = 2 roles)
    const roleTwoCard = screen.getByText('Role Two');
    fireEvent.click(roleTwoCard);

    const roleThreeCard = screen.getByText('Role Three');
    fireEvent.click(roleThreeCard);

    // Submit button shows "Assign 4 Role Assignments" (2 users x 2 roles = 4 assignments)
    const submitBtn = screen.getByRole('button', { name: /Assign 4 Role Assignments/i });
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createAssignment).toHaveBeenCalledTimes(4);
    });

    // Check that createAssignment was called for all (user, role) combinations
    expect(api.createAssignment).toHaveBeenCalledWith({
      userId: 'bob@fanrio.com',
      userName: 'Bob Martin',
      role_ID: 'role-2'
    });
    expect(api.createAssignment).toHaveBeenCalledWith({
      userId: 'bob@fanrio.com',
      userName: 'Bob Martin',
      role_ID: 'role-3'
    });
    expect(api.createAssignment).toHaveBeenCalledWith({
      userId: 'alice@fanrio.com',
      userName: 'Alice Smith',
      role_ID: 'role-2'
    });
    expect(api.createAssignment).toHaveBeenCalledWith({
      userId: 'alice@fanrio.com',
      userName: 'Alice Smith',
      role_ID: 'role-3'
    });

    expect(onSuccessMock).toHaveBeenCalledWith(expect.stringContaining('Successfully created 4 assignments (2 users × 2 roles)'));
    expect(onCloseMock).toHaveBeenCalled();
  });
});
