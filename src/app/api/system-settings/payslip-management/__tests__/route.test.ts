jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    },
    systemSettings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payslip management route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.systemSettings.findUnique
      .mockResolvedValueOnce({
        key: 'payslip_settings',
        value: JSON.stringify({ autoGeneration: { enabled: false } })
      } as never)
      .mockResolvedValueOnce({
        key: 'payslip_templates',
        value: JSON.stringify([{ id: 1, name: '標準範本' }])
      } as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.templates)).toBe(true);
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'payslip_settings',
      value: JSON.stringify({ autoGeneration: { enabled: true } })
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        type: 'settings',
        data: {
          autoGeneration: {
            enabled: true,
            scheduleDay: 25,
            scheduleTime: '17:00'
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('薪資條設定已儲存');
  });

  it('returns empty templates without creating a settings row on first GET', async () => {
    mockPrisma.systemSettings.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.templates).toEqual([]);
    expect(mockPrisma.systemSettings.create).not.toHaveBeenCalled();
  });

  it('marks the first created template as default when requested', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValueOnce(null as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'payslip_templates',
      value: '[]'
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        type: 'template',
        data: {
          name: '第一版範本',
          description: '首個範本',
          isDefault: true,
          isActive: true,
          headerConfig: {},
          employeeSection: {},
          earningsSection: { items: [], showSubtotal: true },
          deductionsSection: { items: [], showSubtotal: true },
          summarySection: {},
          footerConfig: {},
          formatting: {}
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    const upsertArg = mockPrisma.systemSettings.upsert.mock.calls[0][0];
    const createdTemplates = JSON.parse(upsertArg.create.value);
    const updatedTemplatesValue = typeof upsertArg.update.value === 'string'
      ? upsertArg.update.value
      : upsertArg.update.value?.set ?? '[]';
    const updatedTemplates = JSON.parse(updatedTemplatesValue);

    expect(upsertArg.create.key).toBe('payslip_templates');
    expect(createdTemplates).toEqual([
      expect.objectContaining({
        id: 1,
        name: '第一版範本',
        isDefault: true
      })
    ]);
    expect(updatedTemplates).toEqual([
      expect.objectContaining({
        id: 1,
        name: '第一版範本',
        isDefault: true
      })
    ]);
  });

  it('rejects null bodies on POST before destructuring payslip management payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on POST before destructuring payslip management payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"type":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects null bodies on PUT before destructuring payslip template payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: 'null'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on PUT before destructuring payslip template payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-management', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"template":'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.update).not.toHaveBeenCalled();
  });
});