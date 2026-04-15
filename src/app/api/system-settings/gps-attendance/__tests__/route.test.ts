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
import { GET, PATCH, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('gps attendance settings route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('allows unauthenticated GET requests so login and attendance screens can read settings', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'gps_settings',
      value: JSON.stringify({
        enabled: false,
        requiredAccuracy: 25,
      }),
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      enabled: false,
      requiredAccuracy: 25,
    });
  });

  it('allows non-admin GET requests because attendance flows need the live GPS policy', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'gps_settings',
      value: JSON.stringify({
        enabled: true,
        allowOfflineMode: true,
      }),
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      enabled: true,
      allowOfflineMode: true,
    });
  });

  it('falls back to defaults when stored settings JSON is malformed', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'gps_settings',
      value: '{bad-json',
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      enabled: true,
      requiredAccuracy: 50,
      allowOfflineMode: false,
      verificationTimeout: 30,
    });
  });

  it('preserves existing values when POST only updates part of the settings payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'gps_settings',
      value: JSON.stringify({
        enabled: true,
        requiredAccuracy: 35,
        allowOfflineMode: true,
        offlineGracePeriod: 12,
        maxDistanceVariance: 45,
        verificationTimeout: 55,
        enableLocationHistory: false,
        requireAddressInfo: false,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          enabled: false,
          verificationTimeout: 40,
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      enabled: false,
      requiredAccuracy: 35,
      allowOfflineMode: true,
      offlineGracePeriod: 12,
      maxDistanceVariance: 45,
      verificationTimeout: 40,
      enableLocationHistory: false,
      requireAddressInfo: false,
    });
    expect(mockPrisma.systemSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: JSON.stringify(payload.settings),
        }),
        update: expect.objectContaining({
          value: JSON.stringify(payload.settings),
        }),
      })
    );
  });

  it('rejects null bodies on POST before destructuring settings payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 when POST body contains malformed json', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{bad-json',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects POST when requiredAccuracy is not a clean integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          requiredAccuracy: '35abc',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: 'requiredAccuracy 格式無效' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects POST when boolean settings fields are not booleans', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          enabled: 'false',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: 'enabled 必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects null bodies on PATCH before reading update fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 when PATCH body contains malformed json', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: '{bad-json',
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects PATCH when requiredAccuracy is not a clean integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requiredAccuracy: '35abc',
      }),
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: 'requiredAccuracy 格式無效' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects PATCH when boolean update fields are not booleans', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/gps-attendance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: 'false',
      }),
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, message: 'enabled 必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});