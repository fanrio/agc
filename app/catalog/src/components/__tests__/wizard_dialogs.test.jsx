import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import Wizard from '../Wizard';
import * as api from '../../api';

expect.extend(matchers);

// Mock the API module
vi.mock('../../api', () => ({
  getRoles: vi.fn(),
  getAllOrgNodesFlat: vi.fn(),
  getEnvironments: vi.fn(),
  getRestrictionFields: vi.fn(),
  resolveEffective: vi.fn(),
  updateRole: vi.fn(),
  deleteRestriction: vi.fn(),
  deleteRoleApprover: vi.fn(),
  deleteRoleInheritance: vi.fn(),
  createRestriction: vi.fn(),
  createRoleInheritance: vi.fn(),
  createRoleApprover: vi.fn(),
  createAssignment: vi.fn(),
  searchLdapUsers: vi.fn(),
  simulateAccess: vi.fn(),
  fetchBdcRelationalValues: vi.fn(() => Promise.resolve([])),
}));

describe('Wizard Component - Expanded Tests', () => {
  const mockRoles = [
    {
      ID: 'role-1',
      name: 'ROLE_TEST',
      type: 'SINGLE',
      description: 'Original Description',
      orgNode_ID: '',
      parentRoles: [],
      ownRestrictions: [
        { ID: 'rest-1', field: 'Country', filterType: 'SINGLE_VALUE', value: 'ALL' }
      ],
      approvers: [],
      critical: true,
      environment_ID: 'D',
    },
    {
      ID: 'role-parent',
      name: 'ROLE_PARENT',
      type: 'SINGLE',
      description: 'Parent Description',
      orgNode_ID: '',
      parentRoles: [],
      ownRestrictions: [],
      approvers: [],
      critical: false,
      environment_ID: 'D',
    },
    {
      ID: 'role-derived',
      name: 'ROLE_DERIVED',
      type: 'DERIVED',
      description: 'Derived Description',
      parentRoles: [{ parent_ID: 'role-1', parent: { ID: 'role-1' } }],
      assignments: [{ userId: 'user-affected', userName: 'Affected User' }],
      ownRestrictions: [],
      approvers: [],
      critical: true,
      environment_ID: 'D',
    }
  ];

  const mockEnvironments = [
    { ID: 'D', name: 'Development' },
    { ID: 'P', name: 'Production' }
  ];

  const mockOrgNodes = [
    { ID: 'org-1', name: 'Sales DE', type: { name: 'PLANT' }, parent_ID: '' }
  ];

  const mockRestrictionFields = [
    { ID: 'f-1', name: 'Country' },
    { ID: 'f-2', name: 'Plant' }
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    api.getRoles.mockResolvedValue(mockRoles);
    api.getEnvironments.mockResolvedValue(mockEnvironments);
    api.getAllOrgNodesFlat.mockResolvedValue(mockOrgNodes);
    api.getRestrictionFields.mockResolvedValue(mockRestrictionFields);
    api.searchLdapUsers.mockResolvedValue([
      { username: 'jdoe', displayName: 'John Doe', email: 'jdoe@comp.com', department: 'IT' }
    ]);
    api.resolveEffective.mockResolvedValue([]);
  });

  // --- Step 0 ---
  it('handles Step 0 selections correctly (Role Type, Org Node, Parent Roles, Env)', async () => {
    render(<Wizard onDone={() => {}} />);

    // Wait for reference data to load
    await waitFor(() => {
      expect(screen.getByText('Org-Based Role')).toBeInTheDocument();
    });

    // 1. Select Org-Based Role type
    fireEvent.click(screen.getByText('Org-Based Role'));
    
    // Select Org Node
    const orgSelect = screen.getByLabelText(/Select Org Node/i);
    fireEvent.mouseDown(orgSelect);
    const orgOption = await screen.findByRole('option', { name: 'Sales DE (PLANT)' });
    fireEvent.click(orgOption);

    // Assert auto-generated role name
    await waitFor(() => {
      expect(screen.getByLabelText(/Role Name/i).value).toBe('ROLE_ORG_SALES_DE');
    });

    // 2. Select Single Role type
    fireEvent.click(screen.getByText('Single Role'));

    // Inherit from Roles (select parent role)
    const inheritSelect = screen.getByLabelText(/Inherit from Roles/i);
    fireEvent.mouseDown(inheritSelect);
    const parentRoleOption = await screen.findByRole('option', { name: 'ROLE_PARENT' });
    fireEvent.click(parentRoleOption);

    // Verify parent role name is in selection list and auto-generates custom role name
    await waitFor(() => {
      expect(screen.getByLabelText(/Role Name/i).value).toBe('ROLE_PARENT_CUSTOM');
    });

    // Change environment
    const envSelect = screen.getByLabelText(/Environment/i);
    fireEvent.mouseDown(envSelect);
    const envOption = await screen.findByRole('option', { name: 'P - Production' });
    fireEvent.click(envOption);
  });

  // --- Step 1 ---
  it('handles Step 1 restrictions adding of different types', async () => {
    render(<Wizard onDone={() => {}} />);

    // Fill in required name first to proceed
    await waitFor(() => {
      fireEvent.change(screen.getByLabelText(/Role Name/i), { target: { value: 'ROLE_NEW' } });
    });

    // Go to Restrictions step
    fireEvent.click(screen.getByText('Restrictions'));
    await waitFor(() => {
      expect(screen.getByText('Data Access Restrictions')).toBeInTheDocument();
    });

    // Add a SINGLE_VALUE (Equals) restriction
    const fieldSelect = screen.getByLabelText(/Field/i);
    fireEvent.mouseDown(fieldSelect);
    const fieldOption = await screen.findByRole('option', { name: 'Country' });
    fireEvent.click(fieldOption);

    // Wait for the field selection to register
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. Germany')).toBeInTheDocument();
    });

    const valInput = screen.getByPlaceholderText('e.g. Germany');
    fireEvent.change(valInput, { target: { value: 'US' } });
    await waitFor(() => {
      expect(valInput.value).toBe('US');
    });

    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // Verify it was added to "Own restrictions" list
    await waitFor(() => {
      expect(screen.getByText('US')).toBeInTheDocument();
    });

    // Select Country field again for the second restriction (avoiding Org Node type matching)
    fireEvent.mouseDown(fieldSelect);
    const fieldOptionRange = await screen.findByRole('option', { name: 'Country' });
    fireEvent.click(fieldOptionRange);

    // Now test a RANGE restriction with lower/upper values
    const typeSelect = screen.getByLabelText(/Type/i);
    fireEvent.mouseDown(typeSelect);
    const rangeOption = await screen.findByRole('option', { name: 'Range' });
    fireEvent.click(rangeOption);

    // Wait for the range type selection to register and update input fields
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('From')).toBeInTheDocument();
    });

    // Fetch From field and type
    const fromInput = screen.getByPlaceholderText('From');
    fireEvent.change(fromInput, { target: { value: '10' } });
    await waitFor(() => {
      expect(fromInput.value).toBe('10');
    });

    // Fetch To field fresh from the DOM and type
    const toInput = screen.getByPlaceholderText('To');
    fireEvent.change(toInput, { target: { value: '20' } });
    await waitFor(() => {
      expect(toInput.value).toBe('20');
    });

    fireEvent.click(screen.getByRole('button', { name: /Add/i }));
    await waitFor(() => {
      expect(screen.getByText('10 – 20')).toBeInTheDocument();
    });
  });

  // --- Step 2 ---
  it('handles Step 2 LDAP approver searches, selection, and deletion', async () => {
    render(<Wizard onDone={() => {}} />);

    // Proceed to Approvers step
    fireEvent.click(screen.getByText('Approvers'));
    await waitFor(() => {
      expect(screen.getByText('Approvers List')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Type name, department, or username/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'jdoe' } });

    // Flush value update
    await waitFor(() => {
      expect(searchInput.value).toBe('jdoe');
    });

    // Wait for the 250ms debounce delay using standard setTimeout promise
    await new Promise(resolve => setTimeout(resolve, 350));

    // Wait for the mock API call
    await waitFor(() => {
      const calls = api.searchLdapUsers.mock.calls;
      const hasJdoe = calls.some(call => call[0] === 'jdoe');
      expect(hasJdoe).toBe(true);
    }, { timeout: 2000 });

    // Find option and select it
    const option = await screen.findByText(/John Doe \(jdoe\)/i);
    fireEvent.click(option);

    // Verify added to list
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Click delete icon to remove the approver
    const deleteBtn = screen.getByRole('button', { name: '' }); // the X icon button
    fireEvent.click(deleteBtn);

    // Verify removed
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });

  // --- Step 3 ---
  it('handles Step 3 simulation run and result rendering', async () => {
    api.simulateAccess.mockResolvedValue([
      { rowIndex: 0, passed: true, reason: 'All restrictions satisfied' }
    ]);
    render(<Wizard onDone={() => {}} />);

    // Fill in role name
    await waitFor(() => {
      fireEvent.change(screen.getByLabelText(/Role Name/i), { target: { value: 'ROLE_TEST_SIM' } });
    });

    // Go to Step 3 (Review & Deploy)
    fireEvent.click(screen.getByText('Review & Deploy'));
    await waitFor(() => {
      expect(screen.getByText('Access Simulation')).toBeInTheDocument();
    });

    // Run simulation
    const runBtn = screen.getByRole('button', { name: /Run Simulation/i });
    fireEvent.click(runBtn);

    // Verify simulation result row is rendered
    await waitFor(() => {
      expect(screen.getByText('✓ Pass')).toBeInTheDocument();
    });
  });

  // --- Manual Critical Preservation & Save popup ---
  it('preserves manual critical status and triggers impact popup correctly', async () => {
    render(<Wizard context={{ roleId: 'role-1' }} onDone={() => {}} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Original Description')).toBeInTheDocument();
    });

    const criticalCheckbox = screen.getByRole('checkbox', { name: /critical status/i });
    expect(criticalCheckbox.checked).toBe(true);

    // Manually uncheck
    fireEvent.click(criticalCheckbox);
    expect(criticalCheckbox.checked).toBe(false);

    // Edit description (does not trigger popup)
    const descInput = screen.getByLabelText(/Description/i);
    fireEvent.change(descInput, { target: { value: 'Bypassed update description' } });

    // Click save Changes on step 3
    fireEvent.click(screen.getByText('Review & Deploy'));
    await waitFor(() => {
      expect(screen.getByText('Role Summary')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    // It should open Impact Dialog because critical status was changed
    await waitFor(() => {
      expect(screen.getByText('Confirm Changes & Analyze Impact')).toBeInTheDocument();
    });

    // Verify that derived roles and affected users are displayed
    expect(screen.getAllByText('ROLE_DERIVED')[0]).toBeInTheDocument();
    expect(screen.getByText('Affected User')).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText('Confirm Changes & Analyze Impact')).not.toBeInTheDocument();
    });

    // Open it again to click OK
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByText('Confirm Changes & Analyze Impact')).toBeInTheDocument();
    });

    // Click OK
    fireEvent.click(screen.getByRole('button', { name: /OK/i }));
    await waitFor(() => {
      expect(screen.queryByText('Confirm Changes & Analyze Impact')).not.toBeInTheDocument();
    });
  });
});
