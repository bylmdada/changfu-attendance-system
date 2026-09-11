jest.mock('@/lib/database', () => ({
  prisma: {
    auditLog: {
      create: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/database';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('logSystemSettingsChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes a settings audit log with actor and request metadata', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      headers: {
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        'user-agent': 'Jest Browser',
      },
    });

    await logSystemSettingsChange({
      request,
      user: {
        userId: 9,
        employeeId: 21,
        username: 'admin',
        role: 'ADMIN',
      },
      settingKey: 'smtp',
      description: 'SMTP 設定變更',
      oldValue: { smtpHost: 'old.example.com' },
      newValue: { smtpHost: 'new.example.com' },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 9,
        employeeId: 21,
        action: 'SETTINGS_UPDATE',
        targetType: 'SystemSettings',
        description: 'SMTP 設定變更',
        ipAddress: '203.0.113.7',
        userAgent: 'Jest Browser',
        success: true,
      }),
    });
    const auditPayload = mockPrisma.auditLog.create.mock.calls[0][0].data;
    expect(JSON.parse(auditPayload.oldValue as string)).toEqual({
      settingKey: 'smtp',
      value: { smtpHost: 'old.example.com' },
    });
    expect(JSON.parse(auditPayload.newValue as string)).toEqual({
      settingKey: 'smtp',
      value: { smtpHost: 'new.example.com' },
    });
  });

  it('masks secret-like fields before writing oldValue and newValue', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp');

    await logSystemSettingsChange({
      request,
      user: { id: 3, role: 'ADMIN' },
      settingKey: 'smtp',
      description: 'SMTP 設定變更',
      oldValue: {
        smtpPassword: 'old-secret',
        nested: {
          apiToken: 'abc',
          normal: 'kept',
        },
      },
      newValue: {
        smtpPassword: 'new-secret',
        nested: {
          clientSecret: 'def',
          normal: 'kept',
        },
      },
    });

    const auditPayload = mockPrisma.auditLog.create.mock.calls[0][0].data;
    expect(JSON.parse(auditPayload.oldValue as string).value).toEqual({
      smtpPassword: '********',
      nested: {
        apiToken: '********',
        normal: 'kept',
      },
    });
    expect(JSON.parse(auditPayload.newValue as string).value).toEqual({
      smtpPassword: '********',
      nested: {
        clientSecret: '********',
        normal: 'kept',
      },
    });
  });

  it('keeps every mutating system-settings route wired to settings audit logging', () => {
    const apiRoot = path.join(process.cwd(), 'src/app/api/system-settings');
    const routeFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name === 'route.ts') {
          routeFiles.push(fullPath);
        }
      }
    }

    walk(apiRoot);

    const exceptions: Record<string, number> = {
      'labor-law-config/route.ts': 1, // DELETE returns history only.
      'smtp/test/route.ts': 0, // Sends a test mail; does not persist settings.
    };
    const missing: string[] = [];

    for (const file of routeFiles) {
      const relPath = path.relative(apiRoot, file);
      const source = fs.readFileSync(file, 'utf8');
      const mutatingHandlers = source.match(/export async function (POST|PUT|PATCH|DELETE)\(/g) ?? [];
      if (mutatingHandlers.length === 0) {
        continue;
      }

      const requiredCalls = exceptions[relPath] ?? mutatingHandlers.length;
      const actualCalls = source.match(/await logSystemSettingsChange\(/g)?.length ?? 0;
      if (actualCalls < requiredCalls) {
        missing.push(`${relPath}: expected ${requiredCalls}, found ${actualCalls}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
