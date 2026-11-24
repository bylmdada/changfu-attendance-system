jest.mock('@/lib/database', () => ({
  prisma: {
    propertySite: { findUniqueOrThrow: jest.fn() },
    propertyAsset: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    maintenanceRecord: { findMany: jest.fn() },
  },
}));

import * as XLSX from 'xlsx';
import { prisma } from '@/lib/database';
import {
  buildEvidenceSingle,
  buildMaintenanceHistoryReport,
  buildMonthlyReport,
  buildSummary,
} from '@/lib/property-report-service';

const db = prisma as unknown as {
  propertySite: { findUniqueOrThrow: jest.Mock };
  propertyAsset: { findMany: jest.Mock; findFirst: jest.Mock };
  maintenanceRecord: { findMany: jest.Mock };
};

const SITE = { id: 1, code: 'XIBEI', institutionTitle: '溪北輔具中心', evidenceTitle: '佐證' };

function rowsOf(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][];
}

function record(overrides: Record<string, unknown>) {
  return {
    recordId: 'M-1',
    siteId: 1,
    assetId: 1,
    assetCode: 'A001',
    maintenanceCycle: '每月一次',
    dueDate: new Date('2026-11-15T00:00:00.000Z'),
    status: 'DONE',
    rawStatus: null,
    conditionAssessmentStatus: null,
    maintainerRaw: '王小明',
    completedDate: new Date('2026-11-15T01:00:00.000Z'),
    inventoryResult: null,
    assetCondition: null,
    maintenanceItem: null,
    photoPath: null,
    signaturePath: null,
    auditStatus: 'PENDING',
    supervisorName: null,
    supervisorAuditDate: null,
    supervisorSignaturePath: null,
    note: null,
    abnormalConditionItems: null,
    abnormalDescription: null,
    ...overrides,
  };
}

const SCAN_RECORDS = [
  // 掃碼提交「有異常」：舊版寫入時 rawStatus 被預設成「已完成」
  record({ recordId: 'M-ABN', status: 'ABNORMAL', rawStatus: '已完成', conditionAssessmentStatus: 'ABNORMAL' }),
  record({ recordId: 'M-OK', status: 'DONE', rawStatus: '已完成', conditionAssessmentStatus: 'NO_ABNORMALITY' }),
  // 歷史匯入：沒有結構化評量，保留原文
  record({ recordId: 'M-OLD', status: 'DONE', rawStatus: '完成', conditionAssessmentStatus: null }),
  // 尚未提交：沿用系統狀態
  record({ recordId: 'M-NEW', status: 'PENDING', rawStatus: null, conditionAssessmentStatus: null }),
];

describe('property report maintenance status text', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.propertySite.findUniqueOrThrow.mockResolvedValue(SITE);
  });

  it('monthly report shows the structured assessment result for scan submissions', async () => {
    db.maintenanceRecord.findMany.mockResolvedValue(SCAN_RECORDS);

    const { buffer } = await buildMonthlyReport(1, 2026, 11);
    const statusById = Object.fromEntries(rowsOf(buffer).slice(2).map((row) => [row[0], row[4]]));

    expect(statusById).toEqual({ 'M-ABN': '有異常', 'M-OK': '無異常', 'M-OLD': '完成', 'M-NEW': '待執行' });
  });

  it('single-asset evidence sheet shows the same status text', async () => {
    db.propertyAsset.findFirst.mockResolvedValue({ id: 1, assetCode: 'A001', name: '輪椅', location: null, managerName: null });
    db.maintenanceRecord.findMany.mockResolvedValue(SCAN_RECORDS);

    const result = await buildEvidenceSingle(1, 'A001');
    const statusById = Object.fromEntries(rowsOf(result!.buffer).slice(3).map((row) => [row[1], row[4]]));

    expect(statusById).toEqual({ 'M-ABN': '有異常', 'M-OK': '無異常', 'M-OLD': '完成', 'M-NEW': '待執行' });
  });

  it('maintenance history export shows the same status text', async () => {
    db.maintenanceRecord.findMany.mockResolvedValue(
      SCAN_RECORDS.map((r) => ({
        ...r,
        site: { name: '溪北', code: 'XIBEI' },
        asset: { assetCode: 'A001', name: '輪椅', location: null, managerName: null, acquiredDate: null, nextMaintenanceDate: null },
        attachments: [],
      }))
    );

    const result = await buildMaintenanceHistoryReport();
    const rows = rowsOf(result!.xlsxBuffer);
    const header = rows[1] as string[];
    const idCol = header.indexOf('紀錄ID');
    const statusCol = header.indexOf('維護狀態');
    const statusById = Object.fromEntries(rows.slice(2).map((row) => [row[idCol], row[statusCol]]));

    expect(statusById).toEqual({ 'M-ABN': '有異常', 'M-OK': '無異常', 'M-OLD': '完成', 'M-NEW': '待執行' });
  });
});

describe('property summary report', () => {
  const assets = [
    { id: 1, assetCode: 'A001', name: '輪椅', location: '1F', maintenanceFrequency: '每月一次', isActive: true },
    { id: 2, assetCode: 'A002', name: '電動床', location: '2F', maintenanceFrequency: '每月一次', isActive: false },
    { id: 3, assetCode: 'A003', name: '助行器', location: '3F', maintenanceFrequency: '每月一次', isActive: true },
    { id: 4, assetCode: 'A004', name: '舊拐杖', location: '4F', maintenanceFrequency: '每月一次', isActive: false },
  ];
  const monthRecords = [
    { assetId: 1, status: 'DONE', dueDate: new Date('2026-11-15T00:00:00.000Z') },
    { assetId: 2, status: 'DONE', dueDate: new Date('2026-11-16T00:00:00.000Z') },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    db.propertySite.findUniqueOrThrow.mockResolvedValue(SITE);
    db.maintenanceRecord.findMany.mockResolvedValue(monthRecords);
    // 模擬資料庫對 OR 條件的篩選，驗證的是「列出哪些資產」而不只是查詢長相
    db.propertyAsset.findMany.mockImplementation(async ({ where }: { where: { OR: Array<{ isActive?: boolean; id?: { in: number[] } }> } }) =>
      assets.filter((a) => where.OR.some((cond) => (cond.isActive !== undefined ? a.isActive === cond.isActive : cond.id!.in.includes(a.id)))
      )
    );
  });

  it('keeps a disabled asset that still has tasks this month, so the detail rows add up to the total', async () => {
    const { buffer } = await buildSummary(1, 2026, 11);
    const rows = rowsOf(buffer).slice(2);
    const detail = rows.slice(0, -1);
    const total = rows[rows.length - 1];

    // A001（啟用、有任務）、A002（已停用但本月有紀錄）、A003（啟用、本月零任務）；A004 已停用且無紀錄 → 不列
    expect(detail.map((row) => row[0])).toEqual(['A001', 'A002', 'A003']);
    expect(detail.find((row) => row[0] === 'A002')?.[1]).toBe('電動床（目前已停用）');
    expect(detail.find((row) => row[0] === 'A001')?.[1]).toBe('輪椅');
    expect(detail.find((row) => row[0] === 'A003')?.slice(4, 8)).toEqual([0, 0, 0, 0]);

    // 合計 = 明細加總（任務數、已完成），並與月報筆數一致
    const sum = (col: number) => detail.reduce((acc, row) => acc + Number(row[col]), 0);
    expect(total[4]).toBe(sum(4));
    expect(total[4]).toBe(monthRecords.length);
    expect(total[5]).toBe(sum(5));
  });

  it('counts a submitted abnormal task as not completed (business rule)', async () => {
    db.maintenanceRecord.findMany.mockResolvedValue([
      { assetId: 1, status: 'DONE', dueDate: new Date('2026-11-15T00:00:00.000Z') },
      { assetId: 1, status: 'ABNORMAL', dueDate: new Date('2026-11-16T00:00:00.000Z') },
    ]);

    const { buffer } = await buildSummary(1, 2026, 11);
    const rows = rowsOf(buffer).slice(2);
    const a001 = rows.find((row) => row[0] === 'A001')!;
    const total = rows[rows.length - 1];

    // 應維護 2、已完成 1、未完成 1（異常算未完成）、逾期 0；完成率 50%
    expect(a001.slice(4, 10)).toEqual([2, 1, 1, 0, '50%', '0%']);
    expect(total.slice(4, 10)).toEqual([2, 1, 1, 0, '50%', '0%']);
  });

  it('still works when there are no records this month', async () => {
    db.maintenanceRecord.findMany.mockResolvedValue([]);

    const { buffer, count } = await buildSummary(1, 2026, 11);
    const rows = rowsOf(buffer).slice(2);

    expect(rows.slice(0, -1).map((row) => row[0])).toEqual(['A001', 'A003']);
    expect(count).toBe(2);
    expect(rows[rows.length - 1][4]).toBe(0);
  });
});
