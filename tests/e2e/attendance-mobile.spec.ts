import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

test.describe('mobile attendance clock-out regression', () => {
  test('prefills logged-in username and opens the late clock-out reason modal', async ({ page, context }) => {
    let verifyClockPayload: Record<string, unknown> | null = null;
    let clockReasonPayload: Record<string, unknown> | null = null;

    await page.addInitScript(() => {
      window.localStorage.setItem('attendance_remembered_username', 'stale-worker');
    });

    await context.route('**/api/auth/me', async (route) => {
      await route.fulfill(
        jsonResponse({
          user: {
            id: 1,
            username: 'worker1',
            role: 'employee',
            employee: {
              id: 10,
              employeeId: 'EMP001',
              name: '測試員工',
              department: '營運部',
              position: '專員',
            },
          },
        })
      );
    });

    await context.route('**/api/attendance/clock', async (route) => {
      await route.fulfill(
        jsonResponse({
          hasClockIn: true,
          hasClockOut: false,
          today: {
            id: 99,
            workDate: '2026-04-08',
            clockInTime: '2026-04-08T01:00:00.000Z',
            clockOutTime: null,
            regularHours: null,
            overtimeHours: null,
            status: 'NORMAL',
          },
        })
      );
    });

    await context.route('**/api/attendance/allowed-locations', async (route) => {
      await route.fulfill(jsonResponse({ locations: [], isRequired: false }));
    });

    await context.route('**/api/system-settings/gps-attendance', async (route) => {
      await route.fulfill(
        jsonResponse({
          settings: {
            enabled: false,
            requiredAccuracy: 50,
            allowOfflineMode: true,
            requireAddressInfo: false,
          },
        })
      );
    });

    await context.route('**/api/webauthn/check**', async (route) => {
      await route.fulfill(jsonResponse({ hasCredentials: false }));
    });

    await context.route('**/api/csrf-token', async (route) => {
      await route.fulfill(jsonResponse({ success: true, csrfToken: 'test-csrf-token' }));
    });

    await context.route('**/api/attendance/verify-clock', async (route) => {
      verifyClockPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill(
        jsonResponse({
          message: '下班打卡成功',
          requiresReason: true,
          reasonPrompt: {
            type: 'LATE_OUT',
            minutesDiff: 25,
            scheduledTime: '18:00',
            recordId: 99,
          },
        })
      );
    });

    await context.route('**/api/attendance/clock-reason', async (route) => {
      clockReasonPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill(jsonResponse({ message: '原因已記錄' }));
    });

    await page.goto('/attendance');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/attendance$/);

    await expect(page.getByRole('button', { name: '下班打卡' })).toBeVisible();
    await page.getByRole('button', { name: '下班打卡' }).click();

    await expect(page.getByRole('heading', { name: '下班打卡確認' })).toBeVisible();
    await expect(page.getByPlaceholder('請輸入您的帳號')).toHaveValue('worker1');
    await expect(page.getByPlaceholder('請輸入您的帳號')).not.toHaveValue('stale-worker');

    await page.getByPlaceholder('請輸入您的密碼').fill('secret123');
    await page.getByRole('button', { name: '確認打卡' }).click();

    await expect
      .poll(() => verifyClockPayload)
      .toMatchObject({
        username: 'worker1',
        password: 'secret123',
        clockType: 'out',
      });

    await expect(page.getByRole('heading', { name: '延後下班提示' })).toBeVisible();
    await expect(page.getByText(/班表時間：18:00/)).toBeVisible();

    await page.getByRole('button', { name: '非公務（預設）' }).click();

    await expect
      .poll(() => clockReasonPayload)
      .toMatchObject({
        recordId: 99,
        clockType: 'out',
        reason: 'PERSONAL',
      });

    await expect(page.getByRole('heading', { name: '延後下班提示' })).not.toBeVisible();
  });

  test('still sends GPS location when GPS is enabled and allowed-locations omits isRequired', async ({ page, context }) => {
    let verifyClockPayload: Record<string, unknown> | null = null;

    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 25.033964, longitude: 121.564468 });

    await context.route('**/api/auth/me', async (route) => {
      await route.fulfill(
        jsonResponse({
          user: {
            id: 1,
            username: 'worker1',
            role: 'employee',
            employee: {
              id: 10,
              employeeId: 'EMP001',
              name: '測試員工',
              department: '營運部',
              position: '專員',
            },
          },
        })
      );
    });

    await context.route('**/api/attendance/clock', async (route) => {
      await route.fulfill(
        jsonResponse({
          hasClockIn: true,
          hasClockOut: false,
          today: {
            id: 100,
            workDate: '2026-04-17',
            clockInTime: '2026-04-17T00:02:00.000Z',
            clockOutTime: null,
            regularHours: null,
            overtimeHours: null,
            status: 'NORMAL',
          },
        })
      );
    });

    await context.route('**/api/attendance/allowed-locations', async (route) => {
      await route.fulfill(jsonResponse({ locations: [] }));
    });

    await context.route('**/api/system-settings/gps-attendance', async (route) => {
      await route.fulfill(
        jsonResponse({
          settings: {
            enabled: true,
            requiredAccuracy: 50,
            allowOfflineMode: false,
            maxDistanceVariance: 20,
            verificationTimeout: 30,
            requireAddressInfo: false,
          },
        })
      );
    });

    await context.route('**/api/attendance/location-validation', async (route) => {
      await route.fulfill(
        jsonResponse({
          status: 'valid',
          error: '',
        })
      );
    });

    await context.route('**/api/webauthn/check**', async (route) => {
      await route.fulfill(jsonResponse({ hasCredentials: false }));
    });

    await context.route('**/api/csrf-token', async (route) => {
      await route.fulfill(jsonResponse({ success: true, csrfToken: 'test-csrf-token' }));
    });

    await context.route('**/api/attendance/verify-clock', async (route) => {
      verifyClockPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill(jsonResponse({ message: '下班打卡成功' }));
    });

    await page.goto('/attendance');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '下班打卡' }).click();
    await expect(page.getByRole('heading', { name: '下班打卡確認' })).toBeVisible();

    await page.getByPlaceholder('請輸入您的密碼').fill('secret123');
    await page.getByRole('button', { name: '確認打卡' }).click();

    await expect
      .poll(() => verifyClockPayload)
      .toMatchObject({
        username: 'worker1',
        password: 'secret123',
        clockType: 'out',
        location: {
          latitude: 25.033964,
          longitude: 121.564468,
        },
      });
  });
});