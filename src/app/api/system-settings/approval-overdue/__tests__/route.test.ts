jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/approval-scheduler', () => ({
  updateOverdueSettings: jest.fn(),
  getOverdueSettings: jest.fn(),
  processOverdueApprovals: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { getOverdueSettings, processOverdueApprovals, updateOverdueSettings } from '@/lib/approval-scheduler';
import { POST, PUT } from '../route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockUpdateOverdueSettings = updateOverdueSettings as jest.MockedFunction<typeof updateOverdueSettings>;
const mockGetOverdueSettings = getOverdueSettings as jest.MockedFunction<typeof getOverdueSettings>;
const mockProcessOverdueApprovals = processOverdueApprovals as jest.MockedFunction<typeof processOverdueApprovals>;

describe('approval overdue route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockUpdateOverdueSettings.mockResolvedValue({
      success: true,
      settings: {},
    } as never);
    mockGetOverdueSettings.mockResolvedValue({ enabled: false } as never);
    mockProcessOverdueApprovals.mockResolvedValue({
      skipped: false,
      escalated: 0,
      rejected: 0,
      reportSent: false,
      processedAt: '2026-04-11T00:00:00.000Z',
    } as never);
  });

  it('rejects non-integer autoEscalateHours before updating overdue settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        autoEscalateHours: '24',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '自動升級時間必須為 1-168 的整數小時' });
    expect(mockUpdateOverdueSettings).not.toHaveBeenCalled();
  });

  it('rejects non-integer autoRejectDays before updating overdue settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        autoRejectDays: 'abc',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '自動拒絕天數必須為 1-30 的整數天數' });
    expect(mockUpdateOverdueSettings).not.toHaveBeenCalled();
  });

  it('rejects non-boolean overdue toggle fields before updating overdue settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: 'yes',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '逾期處理開關欄位必須為布林值' });
    expect(mockUpdateOverdueSettings).not.toHaveBeenCalled();
  });

  it('rejects null bodies before updating overdue settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockUpdateOverdueSettings).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"enabled":true,',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockUpdateOverdueSettings).not.toHaveBeenCalled();
  });

  it('blocks manual overdue processing when disabled and forceRun is missing', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      message: '功能未啟用。若要強制執行，請設定 forceRun: true',
    });
    expect(mockProcessOverdueApprovals).not.toHaveBeenCalled();
  });

  it('allows manual overdue processing with forceRun even when disabled', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forceRun: true }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockProcessOverdueApprovals).toHaveBeenCalledWith({ forceRun: true });
  });

  it('returns 400 when POST body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"forceRun":true,',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockGetOverdueSettings).not.toHaveBeenCalled();
    expect(mockProcessOverdueApprovals).not.toHaveBeenCalled();
  });

  it('rejects non-boolean forceRun values before loading overdue settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-overdue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forceRun: 'true' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'forceRun 必須為布林值' });
    expect(mockGetOverdueSettings).not.toHaveBeenCalled();
    expect(mockProcessOverdueApprovals).not.toHaveBeenCalled();
  });
});