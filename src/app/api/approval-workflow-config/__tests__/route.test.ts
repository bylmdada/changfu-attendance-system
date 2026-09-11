jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn()
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { GET } from '../route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

describe('approval workflow config route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when request is unauthenticated', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/approval-workflow-config?type=LEAVE');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockGetApprovalWorkflow).not.toHaveBeenCalled();
  });

  it('passes the requested department when resolving workflow config', async () => {
    mockGetUserFromRequest.mockResolvedValue({ id: 1, role: 'ADMIN' } as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'LEAVE',
      workflowName: '請假審核',
      department: '溪北輔具中心',
      approvalLevel: 1,
      requireManager: false,
      finalApprover: 'ADMIN',
      enableForward: false,
      enableCC: false
    } as never);

    const request = new NextRequest('http://localhost/api/approval-workflow-config?type=LEAVE&department=%E6%BA%AA%E5%8C%97%E8%BC%94%E5%85%B7%E4%B8%AD%E5%BF%83');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.department).toBe('溪北輔具中心');
    expect(mockGetApprovalWorkflow).toHaveBeenCalledWith('LEAVE', { department: '溪北輔具中心' });
  });

  it('returns 404 when workflow type cannot be resolved', async () => {
    mockGetUserFromRequest.mockResolvedValue({ id: 1, role: 'ADMIN' } as never);
    mockGetApprovalWorkflow.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/approval-workflow-config?type=UNKNOWN');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('找不到審核流程設定');
  });

  it('returns normalized level metadata for manager-based workflows', async () => {
    mockGetUserFromRequest.mockResolvedValue({ id: 1, role: 'ADMIN' } as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'LEAVE',
      workflowName: '請假審核',
      approvalLevel: 2,
      requireManager: true,
      finalApprover: 'ADMIN',
      enableForward: true,
      enableCC: true
    } as never);

    const request = new NextRequest('http://localhost/api/approval-workflow-config?type=LEAVE');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.maxLevel).toBe(2);
    expect(payload.labels).toEqual({
      1: { name: '一階', role: '部門主管' },
      2: { name: '二階', role: '管理員決核' }
    });
  });

  it('downgrades unsupported third-level metadata to the implemented two-step flow', async () => {
    mockGetUserFromRequest.mockResolvedValue({ id: 1, role: 'ADMIN' } as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'LEAVE',
      workflowName: '請假審核',
      approvalLevel: 3,
      requireManager: true,
      finalApprover: 'ADMIN',
      enableForward: true,
      enableCC: true
    } as never);

    const request = new NextRequest('http://localhost/api/approval-workflow-config?type=LEAVE');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.approvalLevel).toBe(2);
    expect(payload.maxLevel).toBe(2);
    expect(payload.labels).toEqual({
      1: { name: '一階', role: '部門主管' },
      2: { name: '二階', role: '管理員決核' }
    });
  });
});
