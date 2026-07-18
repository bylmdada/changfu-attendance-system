import { getImmediateMaintenanceDueDate } from '@/lib/property-due-task-service';

const NOW = new Date('2026-05-24T01:08:00+08:00');
const TAIPEI_TODAY = '2026-05-23T16:00:00.000Z';

describe('property due task service', () => {
  it('creates an immediate task when next maintenance date is blank', () => {
    expect(
      getImmediateMaintenanceDueDate({ frequencyDays: 28, nextMaintenanceDate: null }, NOW)?.toISOString()
    ).toBe(TAIPEI_TODAY);
  });

  it('creates an immediate task when next maintenance date is farther than the frequency window', () => {
    expect(
      getImmediateMaintenanceDueDate(
        { frequencyDays: 7, nextMaintenanceDate: new Date('2026-06-15T00:00:00.000Z') },
        NOW
      )?.toISOString()
    ).toBe(TAIPEI_TODAY);
  });

  it('keeps near-future assets out of the immediate maintenance list', () => {
    expect(
      getImmediateMaintenanceDueDate(
        { frequencyDays: 7, nextMaintenanceDate: new Date('2026-05-28T00:00:00.000Z') },
        NOW
      )
    ).toBeNull();
  });

  it('marks already due assets using the Taiwan calendar day', () => {
    expect(
      getImmediateMaintenanceDueDate(
        { frequencyDays: 28, nextMaintenanceDate: new Date('2026-05-24T00:00:00.000Z') },
        NOW
      )?.toISOString()
    ).toBe(TAIPEI_TODAY);
  });

  it('does not create automatic tasks when frequency is unavailable', () => {
    expect(
      getImmediateMaintenanceDueDate({ frequencyDays: null, nextMaintenanceDate: null }, NOW)
    ).toBeNull();
  });
});
