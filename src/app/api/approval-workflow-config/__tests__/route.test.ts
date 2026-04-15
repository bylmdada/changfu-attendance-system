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

  it('preserves third-level metadata for three-step manager workflows', async () => {
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
    expect(payload.maxLevel).toBe(3);
    expect(payload.labels).toEqual({
      1: { name: '一階', role: '部門主管' },
      2: { name: '二階', role: 'HR會簽' },
      3: { name: '三階', role: '管理員決核' }
    });
  });
});