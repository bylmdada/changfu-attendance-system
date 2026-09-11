export interface OvertimeApprovalActor {
  id: number;
  employeeId: string;
  name: string;
  department?: string | null;
  position?: string | null;
}

interface OvertimeApprovalState {
  status: string;
  managerOpinion?: string | null;
  managerReviewer?: OvertimeApprovalActor | null;
  approver?: OvertimeApprovalActor | null;
  historyApprover?: OvertimeApprovalActor | null;
}

export interface OvertimeApprovalStep {
  stage: '一階' | '二階' | '批准';
  decision: '同意' | '不同意' | '批准' | '拒絕';
  actor: OvertimeApprovalActor;
}

export function getOvertimeApprovalSteps(request: OvertimeApprovalState): OvertimeApprovalStep[] {
  const steps: OvertimeApprovalStep[] = [];
  const finalApprover = request.approver ?? request.historyApprover ?? null;
  const isOneLevelManagerDecision = Boolean(
    request.managerReviewer &&
    finalApprover &&
    request.managerReviewer.id === finalApprover.id
  );

  if (request.managerReviewer) {
    steps.push({
      stage: '一階',
      decision: isOneLevelManagerDecision
        ? (request.status === 'REJECTED' ? '拒絕' : '批准')
        : (request.managerOpinion === 'DISAGREE' ? '不同意' : '同意'),
      actor: request.managerReviewer,
    });
  }

  if (finalApprover && !isOneLevelManagerDecision) {
    steps.push({
      stage: request.managerReviewer ? '二階' : '批准',
      decision: request.status === 'REJECTED' ? '拒絕' : '批准',
      actor: finalApprover,
    });
  }

  return steps;
}
