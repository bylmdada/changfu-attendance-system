export function extractLeaveDatePart(dateTimeValue: string): string {
  const matchedDate = dateTimeValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matchedDate) {
    return matchedDate[1];
  }

  const parsedDate = new Date(dateTimeValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLeaveDisplayDate(dateTimeValue: string): string {
  const datePart = extractLeaveDatePart(dateTimeValue);
  return datePart ? datePart.replace(/-/g, '/') : dateTimeValue;
}

export function getLeaveStatusSortOrder(status: string): number {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'PENDING_ADMIN':
      return 1;
    case 'APPROVED':
      return 2;
    case 'REJECTED':
      return 3;
    case 'CANCELLED':
      return 4;
    case 'VOIDED':
      return 5;
    default:
      return 99;
  }
}

export function buildLeaveReviewRequestBody(
  status: 'APPROVED' | 'REJECTED',
  options: { canFinalApprove: boolean; canSubmitManagerOpinion: boolean }
): { status: 'APPROVED' | 'REJECTED' } | { opinion: 'AGREE' | 'DISAGREE' } {
  if (!options.canFinalApprove && options.canSubmitManagerOpinion) {
    return { opinion: status === 'APPROVED' ? 'AGREE' : 'DISAGREE' };
  }

  return { status };
}
