import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canManageSite } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';

const ROLES = ['MAINTAINER', 'SUPERVISOR', 'ADMIN'];
const MAX_CANDIDATES = 200;

async function ensureActiveManagedSite(siteId: number) {
  const site = await prisma.propertySite.findUnique({
    where: { id: siteId },
    select: { id: true, isActive: true },
  });
  if (!site) return fail('找不到據點', 404);
  if (!site.isActive) return fail('據點已停用，無法修改指派', 403);
  return null;
}

// GET：列出該據點人員指派
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { id } = await params;
  const siteId = parsePositiveInt(id);
  if (!siteId) return fail('據點 ID 錯誤');
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
  const siteError = await ensureActiveManagedSite(siteId);
  if (siteError) return siteError;

  if (request.nextUrl.searchParams.get('candidates') === '1') {
    const q = request.nextUrl.searchParams.get('q')?.trim();
    const department = request.nextUrl.searchParams.get('department')?.trim();
    const position = request.nextUrl.searchParams.get('position')?.trim();
    const where: Prisma.EmployeeWhereInput = {
      isActive: true,
      ...(department ? { department } : {}),
      ...(position ? { position } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { employeeId: { contains: q } },
              { user: { is: { username: { contains: q } } } },
            ],
          }
        : {}),
      user: { is: { isActive: true } },
    };
    const [employees, departments, positions] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: [{ department: 'asc' }, { name: 'asc' }],
        take: MAX_CANDIDATES,
        select: {
          id: true,
          employeeId: true,
          name: true,
          email: true,
          department: true,
          position: true,
          user: { select: { id: true, username: true, role: true } },
        },
      }),
      prisma.employee.findMany({
        where: { isActive: true, department: { not: null }, user: { is: { isActive: true } } },
        distinct: ['department'],
        orderBy: { department: 'asc' },
        select: { department: true },
      }),
      prisma.employee.findMany({
        where: { isActive: true, position: { not: null }, user: { is: { isActive: true } } },
        distinct: ['position'],
        orderBy: { position: 'asc' },
        select: { position: true },
      }),
    ]);
    return ok({
      employees: employees
        .filter((employee) => employee.user)
        .map((employee) => ({
          id: employee.id,
          employeeId: employee.employeeId,
          name: employee.name,
          email: employee.email,
          department: employee.department,
          position: employee.position,
          userId: employee.user!.id,
          username: employee.user!.username,
          role: employee.user!.role,
        })),
      filters: {
        departments: departments.map((item) => item.department).filter(Boolean),
        positions: positions.map((item) => item.position).filter(Boolean),
      },
    });
  }

  const rows = await prisma.userSiteAssignment.findMany({
    where: { siteId },
    include: {
      user: { include: { employee: { select: { id: true, name: true, email: true, department: true, position: true, employeeId: true } } } },
    },
    orderBy: { id: 'asc' },
  });
  return ok(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      maintenanceRole: r.maintenanceRole,
      isActive: r.isActive,
      employeeName: r.user.employee?.name,
      employeeId: r.user.employee?.employeeId,
      email: r.user.employee?.email,
      department: r.user.employee?.department,
      position: r.user.employee?.position,
      username: r.user.username,
    }))
  );
}

// POST：新增/更新指派（upsert by userId+siteId）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { id } = await params;
  const siteId = parsePositiveInt(id);
  if (!siteId) return fail('據點 ID 錯誤');
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
  const siteError = await ensureActiveManagedSite(siteId);
  if (siteError) return siteError;

  const body = await request.json().catch(() => null);
  const role = String(body?.maintenanceRole ?? 'MAINTAINER');
  if (!ROLES.includes(role)) return fail('角色參數錯誤');

  let userId = parsePositiveInt(body?.userId);
  if (!userId && body?.username) {
    const u = await prisma.user.findUnique({
      where: { username: String(body.username).trim() },
      select: { id: true },
    });
    if (!u) return fail('查無此使用者帳號', 404);
    userId = u.id;
  }
  if (!userId) return fail('請提供 userId 或 username');

  const row = await prisma.userSiteAssignment.upsert({
    where: { userId_siteId: { userId, siteId } },
    update: { maintenanceRole: role, isActive: true },
    create: { userId, siteId, maintenanceRole: role },
  });
  return ok(row, '已儲存指派');
}

// DELETE：移除指派（?userId=）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { id } = await params;
  const siteId = parsePositiveInt(id);
  if (!siteId) return fail('據點 ID 錯誤');
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
  const siteError = await ensureActiveManagedSite(siteId);
  if (siteError) return siteError;
  const userId = parsePositiveInt(request.nextUrl.searchParams.get('userId'));
  if (!userId) return fail('參數錯誤');
  await prisma.userSiteAssignment.deleteMany({ where: { userId, siteId } });
  return ok(null, '已移除指派');
}
