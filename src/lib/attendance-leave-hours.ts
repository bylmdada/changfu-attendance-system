export interface AttendanceLeaveIntervalSource {
  startDate: Date;
  endDate: Date;
  status: string;
  managerOpinion?: string | null;
  voidedAt?: Date | null;
}

export function getAttendanceRegularTimeExclusions(
  leaves: AttendanceLeaveIntervalSource[]
) {
  return leaves
    .filter((leave) => (
      !leave.voidedAt
      && (
        leave.status === 'APPROVED'
        || (leave.status === 'PENDING_ADMIN' && leave.managerOpinion === 'AGREE')
      )
    ))
    .map((leave) => ({
      startTime: leave.startDate,
      endTime: leave.endDate,
    }));
}
