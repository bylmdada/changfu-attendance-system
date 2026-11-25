import { getCompLeaveAvailableHours } from '../comp-leave-balance';

describe('getCompLeaveAvailableHours', () => {
  it('is confirmed + pending earn - pending use', () => {
    expect(getCompLeaveAvailableHours({ balance: 8, pendingEarn: 0, pendingUse: 6 })).toBe(2);
    expect(getCompLeaveAvailableHours({ balance: 8, pendingEarn: 3, pendingUse: 0 })).toBe(11);
    expect(getCompLeaveAvailableHours({ balance: 4, pendingEarn: 0, pendingUse: 6 })).toBe(-2);
  });

  it('is 0 when the employee has no balance row, and hides float noise', () => {
    expect(getCompLeaveAvailableHours(null)).toBe(0);
    expect(getCompLeaveAvailableHours(undefined)).toBe(0);
    expect(getCompLeaveAvailableHours({ balance: 8.3, pendingEarn: 0, pendingUse: 6.1 })).toBe(2.2);
  });
});
