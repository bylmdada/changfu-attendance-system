jest.mock('@/lib/database', () => ({ prisma: {} }));
import { applyApprovedLeaveAccounting, reverseApprovedAnnualLeaveAccounting } from '@/lib/annual-leave-schedule-accounting';

test('partial leave records its original hours and reverses them even after the schedule changes', async () => {
  const tx = {
    schedule: {
      findMany: jest.fn().mockResolvedValue([{ workDate: '2027-01-01', startTime: '00:00', endTime: '08:00', breakTime: 0, workHours: 8 }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ specialLeaveHours: 4 }),
      update: jest.fn(),
    },
    annualLeave: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    leaveRequest: { update: jest.fn() },
  };
  const leave = { id: 1, employeeId: 10, leaveType: 'ANNUAL',
    startDate: new Date('2027-01-01T00:00:00+08:00'), endDate: new Date('2027-01-01T04:00:00+08:00') };
  await applyApprovedLeaveAccounting(tx as never, leave);
  expect(tx.annualLeave.updateMany).toHaveBeenCalledWith({
    where: { employeeId: 10, year: 2027, remainingDays: { gte: 0.5 } },
    data: { usedDays: { increment: 0.5 }, remainingDays: { decrement: 0.5 } },
  });
  const snapshot = tx.leaveRequest.update.mock.calls[0][0].data.annualLeaveAccounting;
  tx.schedule.findMany.mockRejectedValue(new Error('schedule must not be re-read for reversal'));
  await reverseApprovedAnnualLeaveAccounting(tx as never, { ...leave, annualLeaveAccounting: snapshot });
  expect(tx.annualLeave.updateMany).toHaveBeenLastCalledWith({
    where: { employeeId: 10, year: 2027 },
    data: { usedDays: { decrement: 0.5 }, remainingDays: { increment: 0.5 } },
  });
  expect(tx.schedule.update).toHaveBeenCalledWith({
    where: { employeeId_workDate: { employeeId: 10, workDate: '2027-01-01' } },
    data: { specialLeaveHours: { decrement: 4 } },
  });
  tx.schedule.findMany.mockResolvedValue([{workDate:'2027-01-01', startTime:'00:00', endTime:'08:00', workHours:8, breakTime:0}]);
  tx.annualLeave.updateMany.mockResolvedValue({count:0});
  await expect(applyApprovedLeaveAccounting(tx as never, leave)).rejects.toThrow('特休餘額不足');
});

test('the shared approval handler enforces compensatory leave balance', async () => {
  const tx = { compLeaveBalance: { findUnique: jest.fn().mockResolvedValue({balance:1,pendingEarn:0,pendingUse:0}) },
    compLeaveTransaction: { create: jest.fn() } };
  await expect(applyApprovedLeaveAccounting(tx as never, {id:1,employeeId:10,leaveType:'COMPENSATORY',totalDays:1})).rejects.toThrow('補休餘額不足');
  expect(tx.compLeaveTransaction.create).not.toHaveBeenCalled();
});
