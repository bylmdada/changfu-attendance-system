import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

test('shows a larger leave form with five-minute and reason dropdowns', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await context.route('**/api/auth/me', async (route) => {
    await route.fulfill(jsonResponse({
      user: {
        id: 1,
        username: 'leave.user',
        role: 'USER',
        employeeId: 10,
        employee: {
          id: 10,
          employeeId: 'EMP010',
          name: '溪北測試員工',
          department: '溪北輔具中心',
          position: '專員',
        },
      },
    }));
  });
  await context.route('**/api/leave-requests**', async (route) => {
    await route.fulfill(jsonResponse({ leaveRequests: [] }));
  });
  await context.route('**/api/departments', async (route) => {
    await route.fulfill(jsonResponse({ departments: ['溪北輔具中心'] }));
  });

  await page.goto('/leave-management');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '申請請假' }).click();

  const heading = page.getByRole('heading', { name: '申請請假' });
  const modal = heading.locator('..').locator('..');
  const form = modal.locator('form');
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS('font-size', '24px');
  await expect.poll(async () => (await modal.boundingBox())?.width ?? 0).toBeGreaterThan(750);

  const startMinute = page.getByLabel('開始分鐘');
  const endMinute = page.getByLabel('結束分鐘');
  const expectedMinutes = ['', '00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
  await expect(startMinute.locator('option')).toHaveCount(expectedMinutes.length);
  await expect(endMinute.locator('option')).toHaveCount(expectedMinutes.length);
  await expect(startMinute.locator('option').nth(0)).toHaveAttribute('value', expectedMinutes[0]);
  await expect(startMinute.locator('option').nth(12)).toHaveAttribute('value', '55');

  const leaveType = form.locator('select').nth(0);
  const leaveReason = form.locator('select').nth(5);
  await expect(leaveReason).toBeDisabled();
  await leaveType.selectOption('SICK');
  await expect(leaveReason).toBeEnabled();
  await expect(leaveReason.locator('option')).toContainText([
    '請選擇申請原因',
    '身體不適',
    '感冒發燒',
    '就醫治療',
  ]);
  await leaveReason.selectOption('就醫治療');
  await expect(leaveReason).toHaveValue('就醫治療');
});
