/**
 * 財產維護報表（§14 月報、§15 佐證、§16 評鑑總表、§23 命名規則）。
 * 以 xlsx 產生，版面比對來源 財產盤點.xlsx 的「2025年12月報表」與「佐證_*」分頁。
 */
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/database';
import {
  ymd,
  deriveDisplayStatus,
  monthRange,
  STATUS_LABEL,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';

function d(v: Date | null | undefined): string {
  return v ? ymd(new Date(v)) : '';
}

function sheetFromAoa(aoa: unknown[][], colWidths?: number[], merges?: XLSX.Range[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  if (merges) ws['!merges'] = merges;
  return ws;
}

function toBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 安全分頁名（Excel 上限 31 字、禁用字元），並去重 */
function safeSheetName(base: string, used: Set<string>): string {
  let name = base.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';
  let i = 1;
  while (used.has(name)) {
    const suffix = `~${i++}`;
    name = `${name.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

// ── §14 月報：應維護日期落在指定年月之紀錄
const MONTHLY_HEADER = [
  '紀錄ID', '財產編號', '維護週期', '應維護日期', '維護狀態', '維護人員',
  '維護完成日期', '盤點結果', '財產狀態', '維護項目', '維護照片', '維護人簽章',
  '稽核狀態', '主管稽核人', '主管稽核日期', '主管簽章', '備註',
];

export async function buildMonthlyReport(siteId: number, year: number, month: number) {
  const site = await prisma.propertySite.findUniqueOrThrow({ where: { id: siteId } });
  const { start, end } = monthRange(year, month);
  const records = await prisma.maintenanceRecord.findMany({
    where: { siteId, dueDate: { gte: start, lt: end } },
    orderBy: [{ dueDate: 'asc' }, { assetCode: 'asc' }],
  });

  const aoa: unknown[][] = [
    [site.institutionTitle],
    MONTHLY_HEADER,
    ...records.map((r) => [
      r.recordId,
      r.assetCode,
      r.maintenanceCycle ?? '',
      d(r.dueDate),
      r.rawStatus || STATUS_LABEL[r.status as MaintenanceStatus] || r.status,
      r.maintainerRaw ?? '',
      d(r.completedDate),
      r.inventoryResult ?? '',
      r.assetCondition ?? '',
      r.maintenanceItem ?? '',
      r.photoPath ?? '',
      r.signaturePath ?? '',
      r.auditStatus ?? '',
      r.supervisorName ?? '',
      d(r.supervisorAuditDate),
      r.supervisorSignaturePath ?? '',
      r.note ?? '',
    ]),
  ];
  const ws = sheetFromAoa(
    aoa,
    [22, 18, 10, 12, 10, 14, 12, 10, 10, 12, 16, 16, 12, 12, 12, 12, 20],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: MONTHLY_HEADER.length - 1 } }]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year}年${month}月報表`);
  return {
    buffer: toBuffer(wb),
    filename: `維護紀錄表_${site.code}_${year}-${String(month).padStart(2, '0')}.xlsx`,
    count: records.length,
  };
}

// ── §15 佐證：單一資產維護歷程
const EVIDENCE_HEADER = [
  '序號', '紀錄ID', '應維護日期', '維護完成日期', '維護狀態', '盤點結果',
  '維護項目', '資產健康狀態', '維護人員', '稽核狀態', '主管稽核人',
  '主管稽核日期', '備註', '維護照片',
];

function evidenceSheetAoa(
  evidenceTitle: string,
  asset: { assetCode: string; name: string; location: string | null; managerName: string | null },
  records: Array<{
    recordId: string;
    dueDate: Date | null;
    completedDate: Date | null;
    status: string;
    rawStatus: string | null;
    inventoryResult: string | null;
    maintenanceItem: string | null;
    assetCondition: string | null;
    maintainerRaw: string | null;
    auditStatus: string | null;
    supervisorName: string | null;
    supervisorAuditDate: Date | null;
    note: string | null;
    photoPath: string | null;
  }>
): unknown[][] {
  return [
    [evidenceTitle],
    [
      '財產編號', asset.assetCode, '', '財產名稱', asset.name, '', '',
      '放置地點', asset.location ?? '', '', '財產管理人', asset.managerName ?? '',
    ],
    EVIDENCE_HEADER,
    ...records.map((r, i) => [
      i + 1,
      r.recordId,
      d(r.dueDate),
      d(r.completedDate),
      r.rawStatus || STATUS_LABEL[r.status as MaintenanceStatus] || r.status,
      r.inventoryResult ?? '',
      r.maintenanceItem ?? '',
      r.assetCondition ?? '',
      r.maintainerRaw ?? '',
      r.auditStatus ?? '',
      r.supervisorName ?? '',
      d(r.supervisorAuditDate),
      r.note ?? '',
      r.photoPath ?? '',
    ]),
  ];
}

export async function buildEvidenceSingle(siteId: number, assetCode: string) {
  const site = await prisma.propertySite.findUniqueOrThrow({ where: { id: siteId } });
  const asset = await prisma.propertyAsset.findFirst({ where: { siteId, assetCode } });
  if (!asset) return null;
  const records = await prisma.maintenanceRecord.findMany({
    where: { siteId, assetId: asset.id },
    orderBy: [{ dueDate: 'asc' }, { recordId: 'asc' }],
  });
  const aoa = evidenceSheetAoa(site.evidenceTitle, asset, records);
  const ws = sheetFromAoa(
    aoa,
    [6, 22, 12, 12, 10, 10, 12, 12, 14, 12, 12, 12, 20, 16],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: EVIDENCE_HEADER.length - 1 } }]
  );
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(assetCode, used));
  return {
    buffer: toBuffer(wb),
    filename: `佐證_${assetCode}.xlsx`, // §23 檔名須含財產編號
    count: records.length,
  };
}

/** §15 批次：一本活頁簿、每資產一分頁 */
export async function buildEvidenceBatch(siteId: number, assetCodes?: string[]) {
  const site = await prisma.propertySite.findUniqueOrThrow({ where: { id: siteId } });
  const assets = await prisma.propertyAsset.findMany({
    where: { siteId, isActive: true, ...(assetCodes?.length ? { assetCode: { in: assetCodes } } : {}) },
    orderBy: { assetCode: 'asc' },
  });
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const asset of assets) {
    const records = await prisma.maintenanceRecord.findMany({
      where: { siteId, assetId: asset.id },
      orderBy: [{ dueDate: 'asc' }, { recordId: 'asc' }],
    });
    const ws = sheetFromAoa(
      evidenceSheetAoa(site.evidenceTitle, asset, records),
      [6, 22, 12, 12, 10, 10, 12, 12, 14, 12, 12, 12, 20, 16],
      [{ s: { r: 0, c: 0 }, e: { r: 0, c: EVIDENCE_HEADER.length - 1 } }]
    );
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(asset.assetCode, used));
  }
  if (assets.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['（無資產）']]), '空');
  }
  return {
    buffer: toBuffer(wb),
    filename: `佐證批次_${site.code}_${ymd(new Date())}.xlsx`,
    count: assets.length,
  };
}

// ── §16 評鑑總表：每資產維護彙總（完成率/逾期率）
export async function buildSummary(siteId: number, year: number, month: number) {
  const site = await prisma.propertySite.findUniqueOrThrow({ where: { id: siteId } });
  const { start, end } = monthRange(year, month);
  const now = new Date();

  const assets = await prisma.propertyAsset.findMany({
    where: { siteId, isActive: true },
    orderBy: { assetCode: 'asc' },
  });
  const records = await prisma.maintenanceRecord.findMany({
    where: { siteId, dueDate: { gte: start, lt: end } },
    select: { assetId: true, status: true, dueDate: true },
  });
  const byAsset = new Map<number, { total: number; done: number; pending: number; overdue: number }>();
  for (const r of records) {
    const m = byAsset.get(r.assetId) ?? { total: 0, done: 0, pending: 0, overdue: 0 };
    m.total++;
    if (r.status === 'DONE') m.done++;
    else {
      m.pending++;
      if (deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now) === 'OVERDUE') m.overdue++;
    }
    byAsset.set(r.assetId, m);
  }

  const pct = (n: number, d0: number) => (d0 ? `${Math.round((n / d0) * 1000) / 10}%` : '—');
  const header = [
    '財產編號', '財產名稱', '放置地點', '應維護頻率',
    '應維護任務數', '已完成', '未完成', '逾期', '完成率', '逾期率',
  ];
  const aoa: unknown[][] = [
    [`${site.institutionTitle}　${year}年${month}月　評鑑總表`],
    header,
    ...assets.map((a) => {
      const m = byAsset.get(a.id) ?? { total: 0, done: 0, pending: 0, overdue: 0 };
      return [
        a.assetCode,
        a.name,
        a.location ?? '',
        a.maintenanceFrequency ?? '',
        m.total,
        m.done,
        m.pending,
        m.overdue,
        pct(m.done, m.total),
        pct(m.overdue, m.total),
      ];
    }),
  ];
  // 合計列
  const tot = [...byAsset.values()].reduce(
    (s, m) => ({
      total: s.total + m.total,
      done: s.done + m.done,
      pending: s.pending + m.pending,
      overdue: s.overdue + m.overdue,
    }),
    { total: 0, done: 0, pending: 0, overdue: 0 }
  );
  aoa.push([
    '合計', '', '', '', tot.total, tot.done, tot.pending, tot.overdue,
    pct(tot.done, tot.total), pct(tot.overdue, tot.total),
  ]);

  const ws = sheetFromAoa(
    aoa,
    [22, 20, 14, 12, 12, 10, 10, 8, 10, 10],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '評鑑總表');
  return {
    buffer: toBuffer(wb),
    filename: `評鑑總表_${site.code}_${year}-${String(month).padStart(2, '0')}.xlsx`,
    count: assets.length,
  };
}
