jest.mock('@/lib/database', () => ({
  prisma: {
    approvalWorkflow: {
      findMany: jest.fn(),
      update: jest.fn()
    },
    approvalFreezeReminder: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn()
    },
    systemSettings: {
      findFirst: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/approval-workflow', () => {
  const actual = jest.requireActual('@/lib/approval-workflow');

  return {
    ...actual,
    clearWorkflowCache: jest.fn()
  };
});

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { clearWorkflowCache } from '@/lib/approval-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockClearWorkflowCache = clearWorkflowCache as jest.MockedFunction<typeof clearWorkflowCache>;

describe('approval workflows route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma as never) as never);
  });

  it('returns default freeze reminder without creating a row on first GET', async () => {
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([] as never);
    mockPrisma.approvalFreezeReminder.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.freezeReminder).toEqual({
      id: 0,
      daysBeforeFreeze1: 3,
      daysBeforeFreeze2: 1,
      freezeDayReminderTime: '09:00'
    });
    expect(mockPrisma.approvalFreezeReminder.create).not.toHaveBeenCalled();
  });

  it('persists enableForward and enableCC and creates freeze reminder on PUT when missing', async () => {
    mockPrisma.approvalWorkflow.update.mockResolvedValue({ id: 1 } as never);
    mockPrisma.approvalFreezeReminder.findFirst.mockResolvedValue(null as never);
    mockPrisma.approvalFreezeReminder.create.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflows: [
          {
            id: 7,
            approvalLevel: 3,
            requireManager: true,
            deadlineMode: 'FREEZE_BASED',
            deadlineHours: 48,
            enableForward: true,
            enableCC: true
          }
        ],
        freezeReminder: {
          daysBeforeFreeze1: 5,
          daysBeforeFreeze2: 2,
          freezeDayReminderTime: '08:30'
        }
      })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.approvalWorkflow.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        approvalLevel: 3,
        requireManager: true,
        deadlineMode: 'FREEZE_BASED',
        deadlineHours: 48,
        enableForward: true,
        enableCC: true
      }
    });
    expect(mockPrisma.approvalFreezeReminder.create).toHaveBeenCalledWith({
      data: {
        daysBeforeFreeze1: 5,
        daysBeforeFreeze2: 2,
        freezeDayReminderTime: '08:30'
      }
    });
    expect(mockClearWorkflowCache).toHaveBeenCalled();
  });

  it('normalizes direct-admin workflows to one effective level before saving', async () => {
    mockPrisma.approvalWorkflow.update.mockResolvedValue({ id: 7 } as never);

    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflows: [
          {
            id: 7,
            approvalLevel: 3,
            requireManager: false,
            deadlineMode: 'FIXED',
            deadlineHours: 24,
            enableForward: false,
            enableCC: false
          }
        ]
      })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.approvalWorkflow.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        approvalLevel: 1,
        requireManager: false,
        deadlineMode: 'FIXED',
        deadlineHours: 24,
        enableForward: false,
        enableCC: false
      }
    });
    expect(mockClearWorkflowCache).toHaveBeenCalled();
  });

  it('returns 429 when GET rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false } as never);

    const response = await GET(new NextRequest('http://localhost/api/system-settings/approval-workflows'));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'Too many requests' });
    expect(mockPrisma.approvalWorkflow.findMany).not.toHaveBeenCalled();
  });

  it('rejects null bodies before updating approval workflows', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.approvalWorkflow.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reading approval workflow payloads', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.approvalWorkflow.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.create).not.toHaveBeenCalled();
  });

  it('rejects invalid workflow field types before any writes', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/approval-workflows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflows: [
          {
            id: 7,
            approvalLevel: 3,
            requireManager: true,
            deadlineMode: 'FREEZE_BASED',
            deadlineHours: 48,
            enableForward: 'true',
            enableCC: true
          }
        ]
      })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '工作流程設定格式不正確' });
    expect(mockPrisma.approvalWorkflow.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalFreezeReminder.create).not.toHaveBeenCalled();
  });
});
