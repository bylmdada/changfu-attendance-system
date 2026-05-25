/**
 * 財產管理據點權限（§19、§25）。
 *
 * 規則：所有已登入員工可唯讀查詢財產；全域 User.role 為 ADMIN/HR → 全據點維護/管理；
 * 否則依 UserSiteAssignment（isActive）取得可維護據點與 per-site 維護角色。
 */
import { prisma } from '@/lib/database';

export type MaintenanceRole = 'MAINTAINER' | 'SUPERVISOR' | 'ADMIN';

export interface SiteAccess {
  /** 全域管理者（ADMIN/HR）可見全部據點 */
  isGlobalAdmin: boolean;
  /** 可維護的據點 id（isGlobalAdmin 時為空陣列，請改用 canMaintainSite()） */
  siteIds: number[];
  /** 可審核（SUPERVISOR/ADMIN）的據點 id */
  supervisorSiteIds: number[];
  /** siteId → 該據點維護角色 */
  roleBySite: Map<number, MaintenanceRole>;
}

interface AuthUserLike {
  userId: number;
  role: string;
}

const GLOBAL_ADMIN_ROLES = new Set(['ADMIN', 'HR']);

export async function getSiteAccess(user: AuthUserLike): Promise<SiteAccess> {
  const isGlobalAdmin = GLOBAL_ADMIN_ROLES.has(user.role);

  const assignments = await prisma.userSiteAssignment.findMany({
    where: { userId: user.userId, isActive: true },
    select: { siteId: true, maintenanceRole: true },
  });

  const roleBySite = new Map<number, MaintenanceRole>();
  const siteIds: number[] = [];
  const supervisorSiteIds: number[] = [];
  for (const a of assignments) {
    const role = (a.maintenanceRole as MaintenanceRole) ?? 'MAINTAINER';
    roleBySite.set(a.siteId, role);
    siteIds.push(a.siteId);
    if (role === 'SUPERVISOR' || role === 'ADMIN') supervisorSiteIds.push(a.siteId);
  }

  return { isGlobalAdmin, siteIds, supervisorSiteIds, roleBySite };
}

/**
 * Prisma where 片段：唯讀查詢不限制據點；修改操作需改用 canMaintainSite/canManageSite。
 * 用法：prisma.maintenanceRecord.findMany({ where: { ...siteWhere(access), status } })
 */
export function siteWhere(access: SiteAccess): { siteId?: { in: number[] } } {
  void access;
  return {};
}

/** Prisma where 片段：限制在使用者可維護的據點；全域管理者不限制。 */
export function maintainableSiteWhere(access: SiteAccess): { siteId?: { in: number[] } } {
  if (access.isGlobalAdmin) return {};
  return { siteId: { in: access.siteIds } };
}

/** 是否可存取（讀取）某據點 */
export function canAccessSite(access: SiteAccess, siteId: number): boolean {
  void access;
  void siteId;
  return true;
}

/** 是否可維護（提交維護紀錄/上傳維護附件）某據點 */
export function canMaintainSite(access: SiteAccess, siteId: number): boolean {
  return access.isGlobalAdmin || access.siteIds.includes(siteId);
}

/** 是否可在某據點執行主管稽核 */
export function canSuperviseSite(access: SiteAccess, siteId: number): boolean {
  return access.isGlobalAdmin || access.supervisorSiteIds.includes(siteId);
}

/** 是否可管理（建立/編輯資產、設定、匯入）某據點：全域 ADMIN 或該據點 ADMIN 角色 */
export function canManageSite(access: SiteAccess, siteId: number): boolean {
  return access.isGlobalAdmin || access.roleBySite.get(siteId) === 'ADMIN';
}

/** 是否有任何財產管理存取（決定 sidebar 是否顯示「財產管理」） */
export function hasAnyPropertyAccess(access: SiteAccess): boolean {
  void access;
  return true;
}
