import { NextRequest } from 'next/server';
import { DELETE, POST, PUT } from '@/app/api/resignation/handover/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    handoverItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('resignation handover route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedPrisma.handoverItem.findUnique.mockResolvedValue({
      id: 5,
      resignationId: 3,
      category: 'EQUIPMENT',
      description: '公司電腦',
      assignedTo: null,
      completed: false,
      completedAt: null,
      completedBy: null,
      notes: null,
    } as never);
  });

  it('returns 400 on PUT when request JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/handover', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"itemId":5',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockedPrisma.handoverItem.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.handoverItem.update).not.toHaveBeenCalled();
  });

  it('returns 400 on PUT when itemId is not a clean positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/handover', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        itemId: '5abc',
        completed: true,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '項目ID格式無效' });
    expect(mockedPrisma.handoverItem.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.handoverItem.update).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when request JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/handover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"resignationId":3',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockedPrisma.handoverItem.create).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when resignationId is not a clean positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/handover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resignationId: '3abc',
        category: 'EQUIPMENT',
        description: '公司手機',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '離職申請ID格式無效' });
    expect(mockedPrisma.handoverItem.create).not.toHaveBeenCalled();
  });

  it('returns 400 on DELETE when id query is not a clean positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/handover?id=5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '項目ID格式無效' });
    expect(mockedPrisma.handoverItem.delete).not.toHaveBeenCalled();
  });
});