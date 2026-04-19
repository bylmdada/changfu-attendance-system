import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { POST } from '@/app/api/my-dependents/route';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    healthInsuranceDependent: {
      findFirst: jest.fn(),
    },
    dependentApplication: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

describe('my dependents root route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'user1',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      employee: {
        id: 10,
        name: '王小明',
        department: '行政部',
      },
    } as never);
    mockPrisma.healthInsuranceDependent.findFirst.mockResolvedValue(null as never);
    mockPrisma.dependentApplication.findFirst.mockResolvedValue(null as never);
    mockPrisma.dependentApplication.create.mockResolvedValue({ id: 55 } as never);
    mockCreateApprovalForRequest.mockResolvedValue({ success: true } as never);
  });

  it('returns 400 when POST body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"applicationType":"ADD"',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dependentApplication.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when REMOVE targets a dependent outside the current employee', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        applicationType: 'REMOVE',
        dependentId: 999,
        effectiveDate: '2026-05-01',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: '找不到可退保的眷屬資料' });
    expect(mockPrisma.dependentApplication.create).not.toHaveBeenCalled();
  });

  it('returns a top-level id when creating ADD applications for attachment uploads', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        applicationType: 'ADD',
        dependentName: '王小美',
        relationship: '配偶',
        idNumber: 'a123456789',
        birthDate: '1990-01-01',
        effectiveDate: '2026-05-01',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe(55);
    expect(mockPrisma.dependentApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idNumber: 'A123456789',
      }),
    });
  });
});
