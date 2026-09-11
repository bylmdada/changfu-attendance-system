jest.mock('@/lib/auth', () => ({ getUserFromRequest: jest.fn() }));
jest.mock('@/lib/database', () => ({ prisma: { dependentApplicationAttachment: { findUnique: jest.fn() } } }));
jest.mock('node:fs/promises', () => ({ readFile: jest.fn(), realpath: jest.fn() }));
import { NextRequest } from 'next/server';
import { readFile, realpath } from 'node:fs/promises';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { GET } from '../route';

test('private attachment downloads enforce ownership before reading files', async () => {
  const request = new NextRequest('http://localhost/api/my-dependents/attachments/1');
  const params = { params: Promise.resolve({ id: '1' }) };
  (getUserFromRequest as jest.Mock).mockResolvedValue(null);
  expect((await GET(request, params)).status).toBe(401);
  (getUserFromRequest as jest.Mock).mockResolvedValue({employeeId:99,role:'EMPLOYEE'});
  (prisma.dependentApplicationAttachment.findUnique as jest.Mock).mockResolvedValue({id:1,application:{employeeId:10},
    filePath:'/uploads/dependent-attachments/doc.pdf',mimeType:'application/pdf',fileName:'document.pdf'});
  expect((await GET(request, params)).status).toBe(404);
  expect(readFile).not.toHaveBeenCalled();
  (getUserFromRequest as jest.Mock).mockResolvedValue({employeeId:10,role:'EMPLOYEE'});
  (realpath as jest.Mock).mockImplementation(async value => value);
  (readFile as jest.Mock).mockResolvedValue(Buffer.from('private fixture'));
  const response = await GET(request, params);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.text()).toBe('private fixture');
});
