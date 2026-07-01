import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import AuditLogsView from '../AuditLogsView';
import * as api from '../../api';

expect.extend(matchers);

// Mock the API module
vi.mock('../../api', () => ({
  getAuditLogs: vi.fn(),
  getRoles: vi.fn(),
}));

describe('AuditLogsView Component - Full Coverage Suite', () => {
  const mockRoles = [
    { ID: 'role-1', name: 'ROLE_CRITICAL', critical: true }
  ];

  // Logs for consolidation and filters
  const mockAuditLogs = [
    // Duplicate logs created < 5 seconds apart to trigger consolidation
    {
      ID: 'log-1a',
      entityName: 'Roles',
      recordId: 'role-1',
      targetName: 'ROLE_CRITICAL',
      action: 'UPDATE',
      createdBy: 'admin-user-1',
      createdAt: '2026-06-19T10:00:00.000Z',
      details: JSON.stringify({ description: 'first edit' }),
    },
    {
      ID: 'log-1b',
      entityName: 'Roles',
      recordId: 'role-1',
      targetName: 'ROLE_CRITICAL',
      action: 'UPDATE',
      createdBy: 'admin-user-1',
      createdAt: '2026-06-19T10:00:02.000Z', // 2 seconds later
      details: JSON.stringify({ critical: true }),
    },
    // Distinct log for action filters
    {
      ID: 'log-2',
      entityName: 'RoleAssignments',
      recordId: 'assignment-1',
      targetName: 'user-2',
      action: 'CREATE',
      createdBy: 'admin-user-2',
      createdAt: '2026-06-19T10:05:00.000Z', // today relative to test
      details: JSON.stringify({ role_ID: 'role-1' }),
    },
    // Another distinct log for DELETE action
    {
      ID: 'log-3',
      entityName: 'Roles',
      recordId: 'role-3',
      targetName: 'ROLE_DELETED',
      action: 'DELETE',
      createdBy: 'admin-user-3',
      createdAt: '2026-05-19T10:00:00.000Z', // older
      details: JSON.stringify({ name: 'ROLE_DELETED' }),
    }
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    api.getAuditLogs.mockResolvedValue(mockAuditLogs);
    api.getRoles.mockResolvedValue(mockRoles);
  });

  it('renders and consolidates matching logs', async () => {
    render(<AuditLogsView />);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    // Verify first page items are loaded
    expect(screen.getByText('admin-user-1')).toBeInTheDocument();
    expect(screen.getByText('admin-user-2')).toBeInTheDocument();
  });

  it('filters by search input text', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by Target, User, details/i);
    fireEvent.change(searchInput, { target: { value: 'ROLE_DELETED' } });

    await waitFor(() => {
      expect(screen.getByText('ROLE_DELETED')).toBeInTheDocument();
      expect(screen.queryByText('ROLE_CRITICAL')).not.toBeInTheDocument();
    });
  });

  it('filters logs by action types (CREATE, UPDATE, DELETE)', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
    });

    // Click Action selector (showing 'All Actions')
    const actionSelect = screen.getByText('All Actions');
    fireEvent.mouseDown(actionSelect);

    const updateOption = await screen.findByRole('option', { name: 'UPDATE' });
    fireEvent.click(updateOption);

    // Verify only UPDATE log is shown
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
      expect(screen.queryByText('user-2')).not.toBeInTheDocument();
    });
  });

  it('filters logs by entity types (Roles, Role Assignments)', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
    });

    // Click Entity Type select (showing 'All Entities')
    const entitySelect = screen.getByText('All Entities');
    fireEvent.mouseDown(entitySelect);

    const roleAssignmentsOption = await screen.findByRole('option', { name: 'Role Assignments' });
    fireEvent.click(roleAssignmentsOption);

    // Verify only RoleAssignments are shown
    await waitFor(() => {
      expect(screen.getByText('user-2')).toBeInTheDocument();
      expect(screen.queryByText('ROLE_CRITICAL')).not.toBeInTheDocument();
    });
  });

  it('filters logs by Performed By (Actor)', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('admin-user-1')).toBeInTheDocument();
    });

    // Click Performed By select (showing 'All Performers')
    const performerSelect = screen.getByText('All Performers');
    fireEvent.mouseDown(performerSelect);

    const admin2Option = await screen.findByRole('option', { name: 'admin-user-2' });
    fireEvent.click(admin2Option);

    const logTable = screen.getByRole('table');
    await waitFor(() => {
      expect(within(logTable).getByText('admin-user-2')).toBeInTheDocument();
      expect(within(logTable).queryByText('admin-user-1')).not.toBeInTheDocument();
    });
  });

  it('filters by critical roles checkbox', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
      expect(screen.getByText('ROLE_DELETED')).toBeInTheDocument();
    });

    const criticalCheckbox = screen.getByRole('checkbox', { name: /Critical Roles Only/i });
    fireEvent.click(criticalCheckbox);

    // Verify only ROLE_CRITICAL is shown (ROLE_DELETED is non-critical role)
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
      expect(screen.queryByText('ROLE_DELETED')).not.toBeInTheDocument();
    });
  });

  it('opens and closes the Details dialog showing formatted tables', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
    });

    // Find first details eye button (for update log)
    const eyeButtons = screen.getAllByRole('button', { name: '' }).filter(btn => btn.querySelector('svg'));
    fireEvent.click(eyeButtons[0]);

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByText('Audit Details')).toBeInTheDocument();
    });

    // Dialog table content should be visible
    expect(screen.getByText('Property')).toBeInTheDocument();

    // Close Dialog
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Audit Details')).not.toBeInTheDocument();
    });
  });

  it('handles other time filters: Today, Past 7 Days, Past 30 Days', async () => {
    render(<AuditLogsView />);
    await waitFor(() => {
      expect(screen.getByText('ROLE_CRITICAL')).toBeInTheDocument();
    });

    // Time Range -> Today
    const timeSelect = screen.getByText('All Time');
    fireEvent.mouseDown(timeSelect);
    const todayOption = await screen.findByRole('option', { name: 'Today' });
    fireEvent.click(todayOption);

    // Time Range -> Past 7 Days
    const todaySelect = screen.getAllByText('Today')[0];
    fireEvent.mouseDown(todaySelect);
    const weekOption = await screen.findByRole('option', { name: 'Past 7 Days' });
    fireEvent.click(weekOption);

    // Time Range -> Past 30 Days
    const weekSelect = screen.getAllByText('Past 7 Days')[0];
    fireEvent.mouseDown(weekSelect);
    const monthOption = await screen.findByRole('option', { name: 'Past 30 Days' });
    fireEvent.click(monthOption);
  });
});
