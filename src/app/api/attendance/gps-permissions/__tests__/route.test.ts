import { NextRequest } from 'next/server';

import { DELETE, GET, POST, PUT } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('gps permissions route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects GET for non-admin users before querying GPS permissions', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 99,
      employeeId: 99,
      username: 'staff',
      role: 'EMPLOYEE',
    });

    const response = await GET(new NextRequest('http://localhost/api/attendance/gps-permissions'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Unauthorized');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects POST when csrf validation fails before writing GPS permissions', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false });
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'POST',
      body: JSON.stringify({ department: '護理部', isEnabled: true, priority: 1 }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns 400 when POST body contains malformed json', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'POST',
      body: '{"employeeId":1',
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects POST when employeeId is not a positive integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'POST',
      body: JSON.stringify({ employeeId: '1abc', isEnabled: true }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式無效');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects PUT when csrf validation fails before updating GPS permissions', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false });
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'PUT',
      body: JSON.stringify({ id: 7, isEnabled: false }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body contains malformed json', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'PUT',
      body: '{"id":7',
      headers: { 'content-type': 'application/json' },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects PUT when employeeId is not a positive integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'PUT',
      body: JSON.stringify({ id: 7, employeeId: '2abc', isEnabled: false }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式無效');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails before deleting GPS permissions', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false });
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'DELETE',
      body: JSON.stringify({ id: 7 }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns 400 when DELETE body contains malformed json', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'DELETE',
      body: '{"id":7',
      headers: { 'content-type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects PUT when permission id is not a positive integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'PUT',
      body: JSON.stringify({ id: 'abc', isEnabled: false }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Permission ID is required');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns 404 when updating a non-existent GPS permission', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });
    mockPrisma.$executeRaw.mockResolvedValue(0 as never);
    mockPrisma.$queryRaw.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'PUT',
      body: JSON.stringify({ id: 999, isEnabled: false }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('GPS permission not found');
  });

  it('returns 404 when deleting a non-existent GPS permission', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    });
    mockPrisma.$queryRaw.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/attendance/gps-permissions', {
      method: 'DELETE',
      body: JSON.stringify({ id: 999 }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('GPS permission not found');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM gps_attendance_permissions'));
  });
});