jest.mock('@/lib/database', () => ({
  prisma: {
    dependentApplication: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    healthInsuranceDependent: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    dependentEnrollmentLog: {
      create: jest.fn(),
    },
    dependentHistoryLog: {
      create: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalReview: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { PUT } from '@/app/api/dependent-applications/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('dependent applications review body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      userId: 1,
      employeeId: 1,
      username: 'reviewer',
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      dependentApplication: {
        updateMany: mockPrisma.dependentApplication.updateMany,
      },
      healthInsuranceDependent: {
        findFirst: mockPrisma.healthInsuranceDependent.findFirst,
        create: mockPrisma.healthInsuranceDependent.create,
        update: mockPrisma.healthInsuranceDependent.update,
        updateMany: mockPrisma.healthInsuranceDependent.updateMany,
      },
      dependentEnrollmentLog: {
        create: mockPrisma.dependentEnrollmentLog.create,
      },
      dependentHistoryLog: {
        create: mockPrisma.dependentHistoryLog.create,
      },
      approvalInstance: {
        findFirst: mockPrisma.approvalInstance.findFirst,
        updateMany: mockPrisma.approvalInstance.updateMany,
      },
      approvalReview: {
        create: mockPrisma.approvalReview.create,
      },
    } as never) as never);
    mockPrisma.dependentApplication.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.healthInsuranceDependent.findFirst.mockResolvedValue(null as never);
    mockPrisma.healthInsuranceDependent.create.mockResolvedValue({ id: 88 } as never);
    mockPrisma.healthInsuranceDependent.update.mockResolvedValue({ id: 88 } as never);
    mockPrisma.healthInsuranceDependent.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.dependentEnrollmentLog.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.dependentHistoryLog.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.approvalReview.create.mockResolvedValue({ id: 1 } as never);
  });

  it('rejects malformed PUT bodies before querying applications', async () => {
    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.dependentApplication.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before querying applications', async () => {
    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的眷屬申請審核資料' });
    expect(mockPrisma.dependentApplication.findUnique).not.toHaveBeenCalled();
  });

  it('uses the created dependent id in the enrollment log when approving ADD applications', async () => {
    mockPrisma.dependentApplication.findUnique.mockResolvedValue({
      id: 7,
      status: 'PENDING',
      applicationType: 'ADD',
      employeeId: 10,
      employeeName: '王小明',
      dependentId: null,
      dependentName: '王小美',
      relationship: '配偶',
      idNumber: 'A123456789',
      birthDate: new Date('1990-01-01'),
      effectiveDate: new Date('2026-05-01'),
      changeField: null,
      oldValue: null,
      newValue: null,
      remarks: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({ id: 7, action: 'APPROVE' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.dependentEnrollmentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dependentId: 88,
      }),
    });
  });

  it('rejects UPDATE approvals that try to modify protected dependent fields', async () => {
    mockPrisma.dependentApplication.findUnique.mockResolvedValue({
      id: 9,
      status: 'PENDING',
      applicationType: 'UPDATE',
      employeeId: 10,
      employeeName: '王小明',
      dependentId: 3,
      dependentName: '王小美',
      relationship: '配偶',
      idNumber: 'A123456789',
      birthDate: new Date('1990-01-01'),
      effectiveDate: new Date('2026-05-01'),
      changeField: 'employeeId',
      oldValue: '10',
      newValue: '999',
      remarks: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({ id: 9, action: 'APPROVE' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不支援的眷屬變更欄位' });
    expect(mockPrisma.healthInsuranceDependent.update).not.toHaveBeenCalled();
  });
});
