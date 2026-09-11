jest.mock('@/lib/realtime-notifications', () => ({ notificationSystem: {}, sendNotification: jest.fn() }));
jest.mock('@/lib/intelligent-cache', () => ({ CacheManager: { cleanupAll: jest.fn() } }));
import { SystemMaintenanceMonitor, type MaintenanceTask } from '@/lib/system-maintenance';

test('unmeasured checks stay unknown and unsupported backup cannot complete', async () => {
  const monitor = SystemMaintenanceMonitor.getInstance();
  const internals = monitor as unknown as {
    checkAPIHealth: () => Promise<{status:string;details:object}>;
    checkSecurityHealth: () => Promise<{status:string;details:object}>;
    maintenanceTasks: Map<string, MaintenanceTask>;
  };
  for (const health of [await internals.checkAPIHealth(), await internals.checkSecurityHealth()]) {
    expect(health.status).toBe('unknown');
    expect(health.details).toMatchObject({measured:false});
  }
  const backup = {...monitor.getMaintenanceTasks()[0],id:'test-backup',category:'backup'} as MaintenanceTask;
  internals.maintenanceTasks.set(backup.id, backup);
  expect(await monitor.executeMaintenanceTask(backup.id)).toBe(false);
  expect(backup.status).toBe('disabled');
  internals.maintenanceTasks.delete(backup.id);
});
