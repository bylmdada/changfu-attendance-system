jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('income tax management route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
  });

  it('returns default settings when stored JSON is malformed', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'income_tax_management_settings',
      value: '{broken-json',
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/system-settings/income-tax-management'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      withholdingEnabled: true,
    });
  });

  it('rejects non-admin requests before loading settings', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 2,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/system-settings/income-tax-management'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.message).toBe('需要管理員權限');
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('preserves existing description when POST only updates withholding flag', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'income_tax_management_settings',
      value: JSON.stringify({
        withholdingEnabled: true,
        description: 'custom tax setting',
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/income-tax-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        withholdingEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      withholdingEnabled: false,
      description: 'custom tax setting',
    });
    expect(mockPrisma.systemSettings.upsert).toHaveBeenCalled();
  });

  it('rejects null bodies before updating settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/income-tax-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      message: '請提供有效的設定資料',
    });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});
