import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

test.describe('login quick clock mobile flow', () => {
  test('supports mobile quick clock clock-out and late reason submission without login session', async ({ page, context }) => {
    let verifyClockPayload: Record<string, unknown> | null = null;
    let updateReasonPayload: Record<string, unknown> | null = null;

    await context.route('**/api/system-settings/gps-attendance', async (route) => {
      await route.fulfill(
        jsonResponse({
          settings: {
            enabled: false,
            requiredAccuracy: 50,
            allowOfflineMode: true,
          },
        })
      );
    });

    await context.route('**/api/attendance/check-today', async (route) => {
      await route.fulfill(
        jsonResponse({
          hasClockIn: true,
          hasClockOut: false,
          employee: {
            employeeId: 'EMP001',
            name: '測試員工',
            department: '營運部',
          },
          clockInTime: '2026-04-08T01:00:00.000Z',
          clockOutTime: null,
        })
      );
    });

    await context.route('**/api/webauthn/check**', async (route) => {
      await route.fulfill(jsonResponse({ hasCredentials: false }));
    });

    await context.route('**/api/attendance/verify-clock', async (route) => {
      verifyClockPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill(
        jsonResponse({
          employee: '測試員工',
          clockOutTime: '2026-04-08T10:25:00.000Z',
          workHours: 8,
          overtimeHours: 0.5,
          isLateClockOut: true,
          scheduleEndTime: '18:00',
          attendance: {
            id: 99,
          },
        })
      );
    });

    await context.route('**/api/csrf-token', async (route) => {
      await route.fulfill(jsonResponse({ success: true, csrfToken: 'test-csrf-token' }));
    });

    await context.route('**/api/attendance/update-reason', async (route) => {
      updateReasonPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill(jsonResponse({ message: '原因已記錄' }));
    });

    await page.goto('/login?mode=quickclock');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/login\?mode=quickclock$/);
    await expect(page.getByRole('button', { name: '快速打卡' })).toBeVisible();

    await page.getByPlaceholder('請輸入員編').fill('worker1');
    await page.getByPlaceholder('請輸入密碼').fill('secret123');

    await expect(page.getByRole('button', { name: '已上班' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下班打卡' })).toBeVisible();

    await page.getByRole('button', { name: '下班打卡' }).click();

    await expect
      .poll(() => verifyClockPayload)
      .toMatchObject({
        username: 'worker1',
        password: 'secret123',
        type: 'out',
      });

    await expect(page.getByRole('heading', { name: '超時下班原因' })).toBeVisible();
    await expect(page.getByText(/已超過班表時間/)).toBeVisible();

    await page.getByRole('button', { name: '非公務因素' }).click();

    await expect
      .poll(() => updateReasonPayload)
      .toMatchObject({
        attendanceId: 99,
        lateClockOutReason: 'PERSONAL',
        username: 'worker1',
        password: 'secret123',
      });

    await expect(page.getByRole('heading', { name: '超時下班原因' })).not.toBeVisible();
  });
});