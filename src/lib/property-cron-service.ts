/**
 * 財產維護排程服務（§4 產生任務、§13 週四彙整、§12 每日提醒）。
 *
 * 三個 cron 路由的薄包裝目標。每個 job 逐據點 try/catch（單站失敗不中斷其他，
 * 例外發 systemError 給 ADMIN），尊重 per-site email 開關，空則不寄，並以
 * PropertyMaintenanceReminderLog.dedupeKey 去重。
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/email';
import { resolveSiteConfig, APP_CONFIG } from '@/lib/app-config';
import {
  addDays,
  buildRecordId,
  deriveDisplayStatus,
  startOfDay,
  ymd,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';

// ── Cron 授權（沿用 process-overdue 樣式）
export function hasValidCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get('Authorization');
  const header = request.headers.get('x-cron-secret');
  const query = request.nextUrl.searchParams.get('secret');
  return header === secret || query === secret || auth === `Bearer ${secret}`;
}

interface Recipient {
  email: string;
  name: string;
  employeeId: number | null;
}

/** 取得 ADMIN 收件人（系統錯誤通知用） */
async function getAdminRecipients(): Promise<Recipient[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    include: { employee: { select: { id: true, name: true, email: true } } },
  });
  return admins
    .filter((a) => a.employee?.email)
    .map((a) => ({ email: a.employee!.email!, name: a.employee!.name, employeeId: a.employee!.id }));
}

async function notifyOne(
  r: Recipient,
  title: string,
  message: string,
  emailEnabled: boolean
): Promise<void> {
  // 有 employeeId 才能寫站內通知；外部人員（如人員名冊 gmail）僅寄 email。
  const channel = r.employeeId ? (emailEnabled ? 'BOTH' : 'IN_APP') : 'EMAIL';
  await sendNotification(
    {
      type: 'GENERAL',
      recipientEmployeeId: r.employeeId ?? 0,
      recipientEmail: r.email || undefined,
      recipientName: r.name,
      title,
      message,
    },
    channel
  );
}

/** dedupeKey 已存在 → 回 true（已寄過，跳過） */
async function alreadySent(dedupeKey: string): Promise<boolean> {
  const hit = await prisma.propertyMaintenanceReminderLog.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  return !!hit;
}

async function markSent(
  recordId: number,
  reminderType: string,
  dedupeKey: string,
  channel: string
): Promise<void> {
  try {
    await prisma.propertyMaintenanceReminderLog.create({
      data: { recordId, reminderType, dedupeKey, channel },
    });
  } catch {
    /* P2002 競態：視為已寄 */
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const maybeError = error as { code?: unknown };
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    maybeError.code === 'P2002'
  );
}

async function notifyAdminsError(context: string, err: unknown): Promise<void> {
  try {
    const admins = await getAdminRecipients();
    const msg = `${context}\n\n錯誤：${err instanceof Error ? err.message : String(err)}`;
    for (const a of admins) {
      await notifyOne(a, APP_CONFIG.NOTIFICATION.subjects.systemError, msg, true);
    }

  } catch (e) {
    console.error('notifyAdminsError 失敗:', e);
  }
}

function taiwanDateTime(d: Date = new Date()): string {
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

// ────────────────────────────────────────────────────────────
// Job A：產生維護任務（週三 08:00）
// ────────────────────────────────────────────────────────────
export async function generateMaintenanceTasks(now: Date = new Date()) {
  const today = startOfDay(now);
  const sites = await prisma.propertySite.findMany({ where: { isActive: true } });
  const summary: Record<string, { created: number; skipped: number; errors: number }> = {};

  for (const site of sites) {
    const stat = { created: 0, skipped: 0, errors: 0 };
    summary[site.name] = stat;
    try {
      const assets = await prisma.propertyAsset.findMany({
        where: {
          siteId: site.id,
          isActive: true,
          frequencyDays: { not: null },
          nextMaintenanceDate: { not: null },
        },
      });

      for (const a of assets) {
        const due = a.nextMaintenanceDate!;
        if (startOfDay(due).getTime() > today.getTime()) {
          stat.skipped++;
          continue;
        }
        // §4：該財產已有待執行任務 → 跳過不重複產生，且不推進排程
        //（避免逾期資產每次執行重複產生多筆任務）
        const openTask = await prisma.maintenanceRecord.findFirst({
          where: { assetId: a.id, status: 'PENDING' },
          select: { id: true },
        });
        if (openTask) {
          stat.skipped++;
          continue;
        }
        try {
          const created = await prisma.$transaction(async (tx) => {
            const openTaskInTransaction = await tx.maintenanceRecord.findFirst({
              where: { assetId: a.id, status: 'PENDING' },
              select: { id: true },
            });
            if (openTaskInTransaction) return false;

            const advanced = await tx.propertyAsset.updateMany({
              where: { id: a.id, nextMaintenanceDate: due },
              data: { nextMaintenanceDate: addDays(due, a.frequencyDays!) },
            });
            if (advanced.count === 0) return false;

            await tx.maintenanceRecord.create({
              data: {
                recordId: buildRecordId(a.assetCode, due),
                siteId: site.id,
                assetId: a.id,
                assetCode: a.assetCode,
                maintenanceCycle: a.maintenanceFrequency,
                dueDate: due,
                status: 'PENDING',
                auditStatus: '待主管稽核',
                maintainerRaw: a.managerName,
                generatedByCron: true,
                note: `系統自動產生任務（頻率：${a.maintenanceFrequency ?? ''}）`,
              },
            });
            return true;
          });

          if (created) {
            stat.created++;
          } else {
            stat.skipped++;
          }
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
          stat.skipped++;
        }
      }
    } catch (err) {
      stat.errors++;
      console.error(`[generateMaintenanceTasks] site=${site.name} 失敗:`, err);
      await notifyAdminsError(`產生維護任務失敗（據點：${site.name}）`, err);
    }
  }
  return { ok: true, summary };
}

// ────────────────────────────────────────────────────────────
// 收件人解析
// ────────────────────────────────────────────────────────────
export async function getSupervisorRecipients(
  siteId: number,
  overrideEmails: string[]
): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  for (const e of overrideEmails) out.set(e.toLowerCase(), { email: e, name: '主管', employeeId: null });

  const assigns = await prisma.userSiteAssignment.findMany({
    where: { siteId, isActive: true, maintenanceRole: { in: ['SUPERVISOR', 'ADMIN'] } },
    include: { user: { include: { employee: { select: { id: true, name: true, email: true } } } } },
  });
  for (const a of assigns) {
    const e = a.user.employee;
    if (e?.email) out.set(e.email.toLowerCase(), { email: e.email, name: e.name, employeeId: e.id });
  }

  const sups = await prisma.propertyPersonnel.findMany({
    where: { siteId, isActive: true, isSupervisor: true },
  });
  for (const p of sups) {
    if (p.email && !out.has(p.email.toLowerCase())) {
      out.set(p.email.toLowerCase(), { email: p.email, name: p.name, employeeId: p.linkedEmployeeId });
    }
  }
  return [...out.values()];
}

async function getMaintainerRecipients(siteId: number): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  const assigns = await prisma.userSiteAssignment.findMany({
    where: { siteId, isActive: true, maintenanceRole: 'MAINTAINER' },
    include: { user: { include: { employee: { select: { id: true, name: true, email: true } } } } },
  });
  for (const a of assigns) {
    const e = a.user.employee;
    if (e?.email) out.set(e.email.toLowerCase(), { email: e.email, name: e.name, employeeId: e.id });
  }
  return [...out.values()];
}

type DigestRec = {
  assetCode: string;
  asset?: { name: string | null; managerName?: string | null } | null;
  maintainerRaw: string | null;
  dueDate: Date | null;
  completedDate?: Date | null;
  inventoryResult?: string | null;
  maintenanceItem?: string | null;
  status: string;
};

/** §17 已完成：財產編號／名稱／維護人員／維護日期／維護項目／盤點結果 */
function fmtCompleted(r: DigestRec): string {
  const name = r.asset?.name ?? '';
  return `・${r.assetCode} ${name}｜維護人員 ${r.maintainerRaw ?? '-'}｜維護日期 ${
    r.completedDate ? ymd(r.completedDate) : '-'
  }｜項目 ${r.maintenanceItem ?? '-'}｜盤點 ${r.inventoryResult ?? '-'}`;
}

/** §17 未完成：財產編號／名稱／負責人／應維護日期／目前狀態 */
function fmtOutstanding(r: DigestRec, statusLabel: string): string {
  const name = r.asset?.name ?? '';
  const owner = r.asset?.managerName || r.maintainerRaw || '-';
  return `・${r.assetCode} ${name}｜負責人 ${owner}｜應維護 ${
    r.dueDate ? ymd(r.dueDate) : '-'
  }｜狀態 ${statusLabel}`;
}

/**
 * §14：維護表單提交後通知主管稽核。
 * 由 records/[recordId] PUT（提交維護）呼叫。失敗不阻斷提交流程。
 */
export async function notifySupervisorsOfSubmission(
  siteId: number,
  record: {
    recordId: string;
    assetCode: string;
    assetName?: string | null;
    maintainerRaw?: string | null;
    submittedByEmployeeId?: number | null;
  }
): Promise<void> {
  try {
    const site = await prisma.propertySite.findUnique({ where: { id: siteId } });
    if (!site) return;
    const cfg = resolveSiteConfig(site.settings);
    const recipients = (await getSupervisorRecipients(siteId, cfg.supervisorEmail)).filter(
      (recipient) =>
        !record.submittedByEmployeeId || recipient.employeeId !== record.submittedByEmployeeId
    );
    if (recipients.length === 0) return;
    const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/property-management/review`;
    const message = [
      `${site.name} 有一筆維護紀錄待主管稽核：`,
      '',
      `財產編號：${record.assetCode}${record.assetName ? `（${record.assetName}）` : ''}`,
      `紀錄ID：${record.recordId}`,
      `盤點人員：${record.maintainerRaw ?? '-'}`,
      `提交時間：${taiwanDateTime()}`,
      '',
      `請至系統審核：${link}`,
    ].join('\n');
    for (const r of recipients) {
      await notifyOne(r, cfg.subjects.submitAudit, message, cfg.emailEnabled);
    }
  } catch (e) {
    console.error('notifySupervisorsOfSubmission 失敗:', e);
  }
}

// ────────────────────────────────────────────────────────────
// Job B：週四主管審查彙整（週四 08:00）
// ────────────────────────────────────────────────────────────
export async function sendSupervisorDigest(now: Date = new Date()) {
  const sites = await prisma.propertySite.findMany({ where: { isActive: true } });
  const summary: Record<string, string> = {};

  // 前一天（通常為週三）
  const wed = startOfDay(addDays(now, -1));
  const wedEnd = addDays(wed, 1);

  for (const site of sites) {
    try {
      const cfg = resolveSiteConfig(site.settings);
      const dedupeKey = `THURSDAY_DIGEST:${site.id}:${ymd(now)}`;
      if (await alreadySent(dedupeKey)) {
        summary[site.name] = '已寄過，略過';
        continue;
      }

      const completed = await prisma.maintenanceRecord.findMany({
        where: {
          siteId: site.id,
          status: 'DONE',
          completedDate: { gte: wed, lt: wedEnd },
        },
        include: { asset: { select: { name: true, managerName: true } } },
        orderBy: { completedDate: 'asc' },
      });

      const outstanding = await prisma.maintenanceRecord.findMany({
        where: { siteId: site.id, status: 'PENDING' },
        include: { asset: { select: { name: true, managerName: true } } },
        orderBy: { dueDate: 'asc' },
      });

      if (completed.length === 0 && outstanding.length === 0) {
        summary[site.name] = '無資料，未寄信';
        continue;
      }

      const recipients = await getSupervisorRecipients(site.id, cfg.supervisorEmail);
      if (recipients.length === 0) {
        summary[site.name] = '無主管收件人';
        continue;
      }

      const lines: string[] = [];
      lines.push(`【${site.name}】週四審查彙整（${ymd(now)}）`, '');
      lines.push(`一、本週三已完成維護紀錄（${completed.length} 筆）`);
      lines.push('（財產編號 名稱｜維護人員｜維護日期｜維護項目｜盤點結果）');
      lines.push(completed.length ? completed.map(fmtCompleted).join('\n') : '（無）');
      lines.push('');
      lines.push(`二、應維護但尚未完成清冊（${outstanding.length} 筆，逾期優先）`);
      lines.push('（財產編號 名稱｜負責人｜應維護日期｜目前狀態）');
      const sortedOut = outstanding
        .map((r) => ({ r, d: deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now) }))
        .sort((a, b) => (a.d === 'OVERDUE' ? -1 : 1) - (b.d === 'OVERDUE' ? -1 : 1));
      lines.push(
        sortedOut.length
          ? sortedOut
              .map(({ r, d }) => fmtOutstanding(r, d === 'OVERDUE' ? '逾期' : '待維護'))
              .join('\n')
          : '（無）'
      );

      const message = lines.join('\n');
      for (const rec of recipients) {
        await notifyOne(rec, cfg.subjects.thursdayDigest, message, cfg.emailEnabled);
      }
      await markSent(0, 'THURSDAY_DIGEST', dedupeKey, cfg.emailEnabled ? 'BOTH' : 'IN_APP');
      summary[site.name] = `已寄 ${recipients.length} 位（完成 ${completed.length}／待辦 ${outstanding.length}）`;
    } catch (err) {
      console.error(`[sendSupervisorDigest] site=${site.name} 失敗:`, err);
      summary[site.name] = '錯誤';
      await notifyAdminsError(`週四彙整失敗（據點：${site.name}）`, err);
    }
  }
  return { ok: true, summary };
}

// ────────────────────────────────────────────────────────────
// Job C：每日維護提醒（每日 08:00）
// ────────────────────────────────────────────────────────────
export async function sendDailyReminders(now: Date = new Date()) {
  const today = startOfDay(now);
  const sites = await prisma.propertySite.findMany({ where: { isActive: true } });
  const summary: Record<string, string> = {};

  for (const site of sites) {
    try {
      const cfg = resolveSiteConfig(site.settings);
      const windowEnd = addDays(today, cfg.reminderDays + 1); // 到期前 N 天（含逾期）
      const records = await prisma.maintenanceRecord.findMany({
        where: {
          siteId: site.id,
          status: 'PENDING',
          dueDate: { lt: windowEnd },
        },
        include: { asset: { select: { name: true, managerName: true } } },
        orderBy: { dueDate: 'asc' },
      });
      if (records.length === 0) {
        summary[site.name] = '無到期任務';
        continue;
      }

      const recipients = await getMaintainerRecipients(site.id);
      if (recipients.length === 0) {
        summary[site.name] = '無維護人員收件人';
        continue;
      }

      // 過濾本日尚未寄過的紀錄
      const toSend: typeof records = [];
      for (const r of records) {
        const dedupeKey = `DAILY_REMINDER:${r.id}:${ymd(now)}`;
        if (await alreadySent(dedupeKey)) continue;
        toSend.push(r);
      }
      if (toSend.length === 0) {
        summary[site.name] = '本日皆已提醒';
        continue;
      }

      const overdue = toSend.filter(
        (r) => deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now) === 'OVERDUE'
      );
      const upcoming = toSend.filter(
        (r) => deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now) !== 'OVERDUE'
      );
      const lines: string[] = [`【${site.name}】每日維護提醒（${ymd(now)}）`, ''];
      lines.push(`■ 已逾期（${overdue.length} 筆）`);
      lines.push(
        overdue.length ? overdue.map((r) => fmtOutstanding(r, '逾期')).join('\n') : '（無）'
      );
      lines.push('', `■ 即將到期（${upcoming.length} 筆）`);
      lines.push(
        upcoming.length ? upcoming.map((r) => fmtOutstanding(r, '待維護')).join('\n') : '（無）'
      );
      const message = lines.join('\n');

      for (const rec of recipients) {
        await notifyOne(rec, cfg.subjects.dailyReminder, message, cfg.emailEnabled);
      }
      // 記錄去重 + 標記已通知
      for (const r of toSend) {
        await markSent(
          r.id,
          'DAILY_REMINDER',
          `DAILY_REMINDER:${r.id}:${ymd(now)}`,
          cfg.emailEnabled ? 'BOTH' : 'IN_APP'
        );
      }
      await prisma.maintenanceRecord.updateMany({
        where: { id: { in: toSend.map((r) => r.id) } },
        data: { notified: true },
      });
      summary[site.name] = `已寄 ${recipients.length} 位（提醒 ${toSend.length} 筆）`;
    } catch (err) {
      console.error(`[sendDailyReminders] site=${site.name} 失敗:`, err);
      summary[site.name] = '錯誤';
      await notifyAdminsError(`每日提醒失敗（據點：${site.name}）`, err);
    }
  }
  return { ok: true, summary };
}
