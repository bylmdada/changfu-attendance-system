import { getOvertimeApprovalSteps } from '@/lib/overtime-approval-display';

const manager = {
  id: 7,
  employeeId: 'M007',
  name: '溪北中心主任',
  department: '溪北輔具中心',
  position: '主任',
};

const admin = {
  id: 8,
  employeeId: 'A008',
  name: '系統管理員',
  department: '行政部',
  position: '管理員',
};

describe('getOvertimeApprovalSteps', () => {
  it('shows the actual first-stage reviewer after manager approval', () => {
    expect(getOvertimeApprovalSteps({
      status: 'PENDING_ADMIN',
      managerOpinion: 'AGREE',
      managerReviewer: manager,
      approver: null,
    })).toEqual([
      { stage: '一階', decision: '同意', actor: manager },
    ]);
  });

  it('shows both actual reviewers after a two-stage approval', () => {
    expect(getOvertimeApprovalSteps({
      status: 'APPROVED',
      managerOpinion: 'AGREE',
      managerReviewer: manager,
      approver: admin,
    })).toEqual([
      { stage: '一階', decision: '同意', actor: manager },
      { stage: '二階', decision: '批准', actor: admin },
    ]);
  });

  it('labels a direct one-stage final approver without inventing a manager review', () => {
    expect(getOvertimeApprovalSteps({
      status: 'APPROVED',
      managerOpinion: null,
      managerReviewer: null,
      approver: admin,
    })).toEqual([
      { stage: '批准', decision: '批准', actor: admin },
    ]);
  });

  it('shows a one-level manager approver once when both stored reviewer fields point to that manager', () => {
    expect(getOvertimeApprovalSteps({
      status: 'APPROVED',
      managerOpinion: 'AGREE',
      managerReviewer: manager,
      approver: manager,
    })).toEqual([
      { stage: '一階', decision: '批准', actor: manager },
    ]);
  });

  it('uses the final approval-history reviewer when legacy approvedBy is missing', () => {
    expect(getOvertimeApprovalSteps({
      status: 'APPROVED',
      managerOpinion: 'AGREE',
      managerReviewer: manager,
      approver: null,
      historyApprover: admin,
    })).toEqual([
      { stage: '一階', decision: '同意', actor: manager },
      { stage: '二階', decision: '批准', actor: admin },
    ]);
  });
});
