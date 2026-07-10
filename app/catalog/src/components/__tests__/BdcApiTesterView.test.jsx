import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import BdcApiTesterView from '../BdcApiTesterView';
import * as api from '../../api';

expect.extend(matchers);

vi.mock('../../api', () => ({
  getBdcSettings: vi.fn(),
  fetchRawBdcSpaces: vi.fn(),
  fetchRawBdcAssets: vi.fn(),
  fetchRawBdcRelationalValues: vi.fn(),
  fetchRawBdcAssetColumns: vi.fn(),
  runBdcTaskChain: vi.fn(),
  fetchBdcTaskChainLog: vi.fn(),
  fetchBdcAssociations: vi.fn(),
}));

describe('BdcApiTesterView Component', () => {
  const mockConnections = [
    {
      ID: 'conn-1',
      systemName: 'Datasphere Dev',
      connectionType: 'OData',
      url: 'https://mock.datasphere.com',
      tokenUrl: 'https://mock.oauth.com',
      clientId: 'client-123',
      clientSecret: 'secret-456',
      space: 'SPACE_1',
      taskChainFlat: 'chain-flat-id',
    }
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    api.getBdcSettings.mockResolvedValue(mockConnections);
  });

  it('renders correctly and loads connections', async () => {
    render(<BdcApiTesterView />);
    expect(screen.getByText('API Test Suite Settings')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Datasphere Dev')).toBeInTheDocument();
    });
  });

  it('handles FETCH_TASK_CHAIN_LOG option selection and execution successfully', async () => {
    api.fetchBdcTaskChainLog.mockResolvedValue(JSON.stringify({ status: 'COMPLETED', logId: 'log-123' }, null, 2));

    render(<BdcApiTesterView />);
    await waitFor(() => {
      expect(screen.getByText('Datasphere Dev')).toBeInTheDocument();
    });

    // Select FETCH_TASK_CHAIN_LOG from select endpoint dropdown
    const selectContainer = screen.getByTestId('api-endpoint-select');
    const selectEl = selectContainer.querySelector('input');
    await waitFor(() => {
      expect(selectEl.value).toBe('SPACES');
    });

    const selectCombo = selectContainer.querySelector('[role="combobox"]');
    fireEvent.mouseDown(selectCombo);
    
    const option = await screen.findByRole('option', { name: /fetchBdcTaskChainLog/ });
    fireEvent.click(option);

    // Enter Space ID and Log ID inputs
    const spaceInputContainer = await screen.findByTestId('space-input');
    const logIdInputContainer = await screen.findByTestId('log-id-input');
    const spaceInput = spaceInputContainer.querySelector('input');
    const logIdInput = logIdInputContainer.querySelector('input');

    fireEvent.change(spaceInput, { target: { value: 'SPACE_TEST' } });
    fireEvent.change(logIdInput, { target: { value: 'log-789' } });

    // Execute
    const execBtn = screen.getByRole('button', { name: /Execute API Request/i });
    fireEvent.click(execBtn);

    await waitFor(() => {
      expect(api.fetchBdcTaskChainLog).toHaveBeenCalledWith(
        'https://mock.datasphere.com',
        'https://mock.oauth.com',
        'client-123',
        'secret-456',
        'SPACE_TEST',
        'log-789'
      );
    });

    // Verify response output
    await waitFor(() => {
      expect(screen.getByText(/"logId": "log-123"/)).toBeInTheDocument();
    });
  });

  it('handles ASSOCIATIONS option selection and execution successfully', async () => {
    const mockAssocs = [
      { name: "to_TextTable", targetType: "MY_SPACE.COMPANY_TEXT" }
    ];
    api.fetchBdcAssociations.mockResolvedValue(JSON.stringify(mockAssocs, null, 2));

    render(<BdcApiTesterView />);
    await waitFor(() => {
      expect(screen.getByText('Datasphere Dev')).toBeInTheDocument();
    });

    // Select ASSOCIATIONS from select endpoint dropdown
    const selectContainer = screen.getByTestId('api-endpoint-select');
    const selectEl = selectContainer.querySelector('input');
    await waitFor(() => {
      expect(selectEl.value).toBe('SPACES');
    });

    const selectCombo = selectContainer.querySelector('[role="combobox"]');
    fireEvent.mouseDown(selectCombo);
    
    const option = await screen.findByRole('option', { name: /fetchBdcAssociations/ });
    fireEvent.click(option);

    // Enter Space ID and Asset ID inputs
    const spaceInputContainer = await screen.findByTestId('space-input');
    const assetInputContainer = await screen.findByTestId('asset-input');
    const spaceInput = spaceInputContainer.querySelector('input');
    const assetInput = assetInputContainer.querySelector('input');

    fireEvent.change(spaceInput, { target: { value: 'SPACE_TEST' } });
    fireEvent.change(assetInput, { target: { value: 'asset-789' } });

    // Execute
    const execBtn = screen.getByRole('button', { name: /Execute API Request/i });
    fireEvent.click(execBtn);

    await waitFor(() => {
      expect(api.fetchBdcAssociations).toHaveBeenCalledWith(
        'https://mock.datasphere.com',
        'https://mock.oauth.com',
        'client-123',
        'secret-456',
        'SPACE_TEST',
        'asset-789'
      );
    });

    // Verify response output
    await waitFor(() => {
      expect(screen.getByText(/"to_TextTable"/)).toBeInTheDocument();
    });
  });
});
