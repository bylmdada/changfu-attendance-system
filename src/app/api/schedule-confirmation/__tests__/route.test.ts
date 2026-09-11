jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    scheduleMonthlyRelease: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    scheduleConfirmation: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  getScheduleConfirmSettings: jest.fn(),
  sendSchedulePublishNotification: jest.fn(),
  sendReminderToUnconfirmed: jest.fn(),
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getScheduleConfirmSettings, sendSchedulePublishNotification } from '@/lib/schedule-confirm-service';
import { sendNotification } from '@/lib/realtime-notifications';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockGetScheduleConfirmSettings = getScheduleConfirmSettings as jest.MockedFunction<typeof getScheduleConfirmSettings>;
const mockSendSchedulePublishNotification = sendSchedulePublishNotification as jest.MockedFunction<typeof sendSchedulePublishNotification>;
const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;

describe('schedule confirmation csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetScheduleConfirmSettings.mockResolvedValue({
      enabled: true,
      blockClock: false,
      enableReminder: true,
    });
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 31,
      department: '行政部',
    } as never);
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null as never);
    mockPrisma.scheduleMonthlyRelease.create.mockResolvedValue({
      id: 9,
      yearMonth: '2026-04',
      department: '行政部',
      version: 1,
      deadline: new Date('2026-04-30T23:59:59.000Z'),
    } as never);
    mockPrisma.scheduleMonthlyRelease.update.mockResolvedValue({
      id: 9,
      yearMonth: '2026-04',
      department: '行政部',
      version: 2,
      deadline: new Date('2026-04-30T23:59:59.000Z'),
    } as never);
    mockPrisma.scheduleMonthlyRelease.upsert.mockResolvedValue({
      id: 9,
      yearMonth: '2026-04',
      version: 1,
      deadline: new Date('2026-04-30T23:59:59.000Z'),
    } as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([] as never);
    mockPrisma.scheduleConfirmation.findMany.mockResolvedValue([] as never);
    mockPrisma.scheduleConfirmation.count.mockResolvedValue(0 as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockSendSchedulePublishNotification.mockResolvedValue({ sent: 0, errors: 0 } as never);
    mockSendNotification.mockResolvedValue('notification-1');
  });

  it('rejects malformed yearMonth on GET my-status before querying release records', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation?type=my-status&yearMonth=2026-13abc', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 格式錯誤');
    expect(mockPrisma.scheduleMonthlyRelease.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });

  it('returns reminder and clock blocking flags with my-status payload', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-04`;

    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{
      id: 9,
      yearMonth,
      department: '行政部',
      publishedAt: new Date(`${yearMonth}-01T00:00:00.000Z`),
      deadline: new Date(`${yearMonth}-30T23:59:59.000Z`),
      version: 2,
      lastModified: new Date(`${yearMonth}-01T00:00:00.000Z`),
      publishedBy: { name: '排班主管' },
      confirmations: [],
    }] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe('PENDING');
    expect(payload.reminderEnabled).toBe(true);
    expect(payload.clockBlockingEnabled).toBe(false);
  });

  it('keeps my-status as not released when schedules exist but no正式發布紀錄', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-09`;

    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        shiftType: 'A',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 0,
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
      },
    ] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe('NOT_RELEASED');
    expect(payload.release).toBeNull();
    expect(payload.scheduleSummary).toBeNull();
  });

  it('returns dynamic shift counts in my-status schedule summary', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-05`;

    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{
      id: 10,
      yearMonth,
      department: '行政部',
      publishedAt: new Date(`${yearMonth}-01T00:00:00.000Z`),
      deadline: new Date(`${yearMonth}-31T23:59:59.000Z`),
      version: 1,
      lastModified: new Date(`${yearMonth}-01T00:00:00.000Z`),
      publishedBy: { name: '排班主管' },
      confirmations: [],
    }] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { shiftType: 'A', workHours: 8 },
      { shiftType: 'D1', workHours: 8 },
      { shiftType: 'D1', workHours: 8 },
      { shiftType: 'OFF', workHours: 0 },
    ] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scheduleSummary).toEqual(expect.objectContaining({
      total: 4,
      workDays: 3,
      restDays: 1,
      shiftCounts: [
        { shiftType: 'A', count: 1 },
        { shiftType: 'D1', count: 2 },
        { shiftType: 'OFF', count: 1 },
      ],
    }));
  });

  it('returns scheduled-but-unpublished employees as pending and unscheduled employees as not released for admin status list queries', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-07`;

    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 11,
        employeeId: 'E001',
        name: '王小明',
        department: '行政部',
        position: '專員',
      },
      {
        id: 12,
        employeeId: 'E002',
        name: '李小華',
        department: '資訊部',
        position: '工程師',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 11 },
    ] as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=admin-status-list&yearMonth=${yearMonth}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.employees).toEqual([
      expect.objectContaining({
        employeeId: 'E001',
        status: 'PENDING',
        release: null,
        confirmation: null,
        scheduleCount: 1,
        hasSchedules: true,
      }),
      expect.objectContaining({
        employeeId: 'E002',
        status: 'NOT_RELEASED',
        release: null,
        confirmation: null,
        scheduleCount: 0,
        hasSchedules: false,
      }),
    ]);
    expect(payload.stats).toEqual(expect.objectContaining({
      total: 2,
      pending: 1,
      notReleased: 1,
      confirmed: 0,
      progress: 0,
    }));
  });

  it('includes scheduled-but-unpublished employees when filtering admin status list by pending', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-08`;

    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 31,
        employeeId: 'E201',
        name: '流程測試',
        department: '資訊部',
        position: '工程師',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 31 },
      { employeeId: 31 },
    ] as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=admin-status-list&yearMonth=${yearMonth}&status=PENDING`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.employees).toEqual([
      expect.objectContaining({
        employeeId: 'E201',
        status: 'PENDING',
        release: null,
        confirmation: null,
        scheduleCount: 2,
        hasSchedules: true,
      }),
    ]);
    expect(payload.stats).toEqual(expect.objectContaining({
      total: 1,
      pending: 1,
      progress: 0,
    }));
  });

  it('filters admin status list by confirmation status using applicable releases', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-08`;

    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 21,
        employeeId: 'E101',
        name: '陳確認',
        department: '行政部',
        position: '專員',
      },
      {
        id: 22,
        employeeId: 'E102',
        name: '林待確認',
        department: '行政部',
        position: '專員',
      },
    ] as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([
      {
        id: 701,
        yearMonth,
        department: '行政部',
        publishedAt: new Date(`${yearMonth}-01T09:00:00.000Z`),
        deadline: new Date(`${yearMonth}-31T23:59:59.000Z`),
        version: 3,
        lastModified: new Date(`${yearMonth}-02T09:00:00.000Z`),
        publishedBy: { name: '排班主管' },
      },
    ] as never);
    mockPrisma.scheduleConfirmation.findMany.mockResolvedValue([
      {
        id: 900,
        employeeId: 21,
        yearMonth,
        releaseId: 701,
        version: 3,
        confirmedAt: new Date(`${yearMonth}-03T12:00:00.000Z`),
        comment: '已確認',
        isValid: true,
      },
    ] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=admin-status-list&yearMonth=${yearMonth}&status=CONFIRMED`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.employees).toHaveLength(1);
    expect(payload.employees[0]).toEqual(expect.objectContaining({
      employeeId: 'E101',
      status: 'CONFIRMED',
      confirmation: expect.objectContaining({
        version: 3,
        comment: '已確認',
      }),
    }));
    expect(payload.stats).toEqual(expect.objectContaining({
      total: 1,
      confirmed: 1,
      progress: 100,
    }));
  });

  it('returns my-history across past months and applies status filters', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 31,
      department: '行政部',
    } as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([
      {
        id: 801,
        yearMonth: '2026-03',
        department: null,
        publishedAt: new Date('2026-03-01T08:00:00.000Z'),
        deadline: new Date('2026-03-31T23:59:59.000Z'),
        version: 1,
        lastModified: new Date('2026-03-01T08:00:00.000Z'),
        publishedBy: { name: '全公司排班' },
      },
      {
        id: 802,
        yearMonth: '2026-04',
        department: '行政部',
        publishedAt: new Date('2026-04-01T08:00:00.000Z'),
        deadline: new Date('2026-04-30T23:59:59.000Z'),
        version: 2,
        lastModified: new Date('2026-04-05T08:00:00.000Z'),
        publishedBy: { name: '行政排班' },
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { workDate: '2026-02-12' },
      { workDate: '2026-04-05' },
    ] as never);
    mockPrisma.scheduleConfirmation.findMany.mockResolvedValue([
      {
        id: 950,
        employeeId: 31,
        yearMonth: '2026-03',
        releaseId: 801,
        version: 1,
        confirmedAt: new Date('2026-03-02T10:00:00.000Z'),
        comment: '收到',
        isValid: true,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation?type=my-history&status=CONFIRMED', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([
      expect.objectContaining({
        yearMonth: '2026-03',
        status: 'CONFIRMED',
        release: expect.objectContaining({
          publisherName: '全公司排班',
        }),
        confirmation: expect.objectContaining({
          comment: '收到',
        }),
      }),
    ]);
    expect(payload.stats).toEqual(expect.objectContaining({
      total: 1,
      confirmed: 1,
      progress: 100,
    }));
  });

  it('uses effective shift hours for my-status work and rest day summary', async () => {
    const nextYear = new Date().getFullYear() + 1;
    const yearMonth = `${nextYear}-06`;

    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{
      id: 11,
      yearMonth,
      department: '行政部',
      publishedAt: new Date(`${yearMonth}-01T00:00:00.000Z`),
      deadline: new Date(`${yearMonth}-30T23:59:59.000Z`),
      version: 1,
      lastModified: new Date(`${yearMonth}-01T00:00:00.000Z`),
      publishedBy: { name: '排班主管' },
      confirmations: [],
    }] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
      },
      {
        shiftType: 'OFF',
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
      },
    ] as never);

    const request = new NextRequest(`http://localhost/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scheduleSummary).toEqual(expect.objectContaining({
      total: 2,
      workDays: 1,
      restDays: 1,
      shiftCounts: [
        { shiftType: 'B', count: 1 },
        { shiftType: 'OFF', count: 1 },
      ],
    }));
  });

  it('rejects publish POST when csrf validation fails before mutating release state', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'publish',
        yearMonth: '2026-04',
        department: '行政部',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed yearMonth on publish before mutating release state', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'publish',
        yearMonth: '2026-13abc',
        department: '行政部',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 格式錯誤');
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before reading schedule confirmation payloads', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"action":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('sends schedule update in-app notification only to employees with schedules when publishing', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 31 },
      { employeeId: 32 },
      { employeeId: 31 },
    ] as never);
    mockSendSchedulePublishNotification.mockResolvedValue({ sent: 2, errors: 0 } as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'publish',
        yearMonth: '2026-04',
        department: '行政部',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith({
      where: {
        workDate: {
          gte: '2026-04-01',
          lte: '2026-04-30',
        },
        employee: {
          is: {
            isActive: true,
            department: '行政部',
          },
        },
      },
      select: { employeeId: true },
    });
    expect(mockSendSchedulePublishNotification).toHaveBeenCalledWith(
      '2026-04',
      [31, 32],
      new Date('2026-04-30T15:59:59.000Z')
    );
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before republishing a release with valid confirmations', async () => {
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue({ id: 9, version: 2 } as never);
    mockPrisma.scheduleConfirmation.count.mockResolvedValue(12 as never);

    const response = await POST(new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'publish', yearMonth: '2026-04', department: '行政部' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: '重新發布將使 12 筆已確認班表失效',
      requiresRepublishConfirmation: true,
      confirmedCount: 12,
    });
    expect(mockPrisma.scheduleMonthlyRelease.update).not.toHaveBeenCalled();
  });

  it('stores new company-wide releases with a non-null unique department key', async () => {
    mockPrisma.scheduleMonthlyRelease.upsert.mockResolvedValue({
      id: 9,
      yearMonth: '2026-04',
      department: '__ALL__',
      version: 1,
      deadline: new Date('2026-04-30T15:59:59.000Z'),
    } as never);

    const response = await POST(new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'publish', yearMonth: '2026-04' }),
    }));

    expect(response.status).toBe(200);
    expect(mockPrisma.scheduleMonthlyRelease.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        yearMonth_department: { yearMonth: '2026-04', department: '__ALL__' },
      },
      create: expect.objectContaining({ department: '__ALL__' }),
    }));
  });

  it('rejects null POST bodies before reading schedule confirmation payloads', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的班表確認資料');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects confirm POST when the month has not been published yet', async () => {
    const bcrypt = await import('bcryptjs');
    mockPrisma.user.findFirst.mockResolvedValue({
      passwordHash: await bcrypt.hash('Password123!', 4)
    } as never);
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'confirm',
        yearMonth: '2026-04',
        password: 'Password123!'
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('本月班表尚未發布，無法確認');
    expect(mockPrisma.scheduleMonthlyRelease.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleConfirmation.upsert).not.toHaveBeenCalled();
  });

  it('does not auto-create a release during confirm POST when schedules exist without publish records', async () => {
    const bcrypt = await import('bcryptjs');
    mockPrisma.user.findFirst.mockResolvedValue({
      passwordHash: await bcrypt.hash('Password123!', 4)
    } as never);
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'confirm',
        yearMonth: '2026-04',
        password: 'Password123!'
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('本月班表尚未發布，無法確認');
    expect(mockPrisma.scheduleConfirmation.upsert).not.toHaveBeenCalled();
  });
});
