/**
 * 財產盤點 xlsx 匯入（§4、§21、§26）。
 *
 * 由 admin API 路由與 CLI 腳本共用。冪等：以唯一鍵 upsert，可重複執行不重複。
 * 效能：預載 assets/personnel 進 Map，紀錄分批 200 包 $transaction 序列寫入
 *（SQLite 單寫者，勿 Promise.all 寫）。
 */
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database';
import { findColumnIndex, type ColumnKey } from '@/lib/app-config';
import {
  findExistingDefaultPropertySite,
  getOrCreateDefaultPropertySite,
} from '@/lib/property-site-service';
import {
  excelSerialToDate,
  normalizeFrequencyDays,
  normalizeStatus,
} from '@/lib/property-maintenance-utils';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';
import { isCode128Compatible } from '@/lib/property-barcode';
import { normalizePropertyAuditStatus } from '@/lib/property-audit-status';

export interface ImportOptions {
  siteId?: number;
  defaultSiteName: string;
  defaultSiteCode: string;
  institutionTitle: string;
  dryRun?: boolean;
}

export interface ImportResult {
  success: boolean;
  message: string;
  results: {
    site: { id: number; name: string };
    personnel: { created: number; updated: number };
    assets: { created: number; updated: number; skippedNoCode: number; duplicateInFile: number };
    records: { created: number; updated: number; skippedNoId: number; skippedNoAsset: number };
  };
  preview?: {
    assets: {
      newSamples: string[];
      updateSamples: string[];
      duplicateSamples: string[];
    };
  };
  unresolvedMaintainers: { value: string; count: number }[];
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHUNK = 200;

/** workbook 內以 trim 後表名尋找工作表 */
function getSheet(wb: XLSX.WorkBook, trimmedName: string): unknown[][] | null {
  const real = wb.SheetNames.find((n) => n.trim() === trimmedName);
  if (!real) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[real], {
    header: 1,
    blankrows: false,
  }) as unknown[][];
}

function cell(row: unknown[], idx: number): string | null {
  if (idx < 0) return null;
  const v = row[idx];
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function buildColMap(headers: unknown[], keys: ColumnKey[]): Partial<Record<ColumnKey, number>> {
  const map: Partial<Record<ColumnKey, number>> = {};
  for (const k of keys) {
    const i = findColumnIndex(headers, k);
    if (i >= 0) map[k] = i;
  }
  return map;
}

async function previewPropertyWorkbook(
  wb: XLSX.WorkBook,
  site: { id: number; name: string },
  errors: string[]
): Promise<ImportResult> {
  const assetStat = { created: 0, updated: 0, skippedNoCode: 0, duplicateInFile: 0 };
  const newSamples: string[] = [];
  const updateSamples: string[] = [];
  const duplicateSamples: string[] = [];
  const seen = new Set<string>();
  const assetCodes: string[] = [];
  const assetSheet = getSheet(wb, '財產主檔');

  if (assetSheet && assetSheet.length > 1) {
    const cm = buildColMap(assetSheet[0], [
      'assetCode',
      'assetName',
      'photo',
      'location',
      'manager',
      'frequency',
      'acquiredDate',
      'nextMaintDate',
    ]);
    for (let r = 1; r < assetSheet.length; r++) {
      const row = assetSheet[r];
      const assetCode = cell(row, cm.assetCode ?? -1);
      if (!assetCode) {
        assetStat.skippedNoCode++;
        continue;
      }
      if (!isCode128Compatible(assetCode)) {
        errors.push(`資產 ${assetCode} 不符合 CODE_128 條碼格式（請使用英數、符號，最多 80 字元）`);
        continue;
      }
      if (seen.has(assetCode)) {
        assetStat.duplicateInFile++;
        if (duplicateSamples.length < 10) duplicateSamples.push(assetCode);
        continue;
      }
      seen.add(assetCode);
      assetCodes.push(assetCode);
      const freqRaw = cell(row, cm.frequency ?? -1);
      if (freqRaw && normalizeFrequencyDays(freqRaw) == null) {
        errors.push(`資產 ${assetCode} 未知維護頻率「${freqRaw}」（不自動產生任務）`);
      }
    }
  } else {
    errors.push('找不到「財產主檔」工作表或無資料');
  }

  const existingCodes = site.id > 0 && assetCodes.length > 0
    ? new Set(
        (
          await prisma.propertyAsset.findMany({
            where: { siteId: site.id, assetCode: { in: assetCodes } },
            select: { assetCode: true },
          })
        ).map((asset) => asset.assetCode)
      )
    : new Set<string>();

  for (const assetCode of assetCodes) {
    if (existingCodes.has(assetCode)) {
      assetStat.updated++;
      if (updateSamples.length < 10) updateSamples.push(assetCode);
    } else {
      assetStat.created++;
      if (newSamples.length < 10) newSamples.push(assetCode);
    }
  }

  return {
    success: true,
    message: `檢測完成：新增 ${assetStat.created}、更新 ${assetStat.updated}、檔內重複 ${assetStat.duplicateInFile}、空白編號 ${assetStat.skippedNoCode}`,
    results: {
      site,
      personnel: { created: 0, updated: 0 },
      assets: assetStat,
      records: { created: 0, updated: 0, skippedNoId: 0, skippedNoAsset: 0 },
    },
    preview: {
      assets: { newSamples, updateSamples, duplicateSamples },
    },
    unresolvedMaintainers: [],
    errors,
  };
}

export async function importPropertyWorkbook(
  data: ArrayBuffer | Buffer | Uint8Array,
  opts: ImportOptions
): Promise<ImportResult> {
  const errors: string[] = [];
  const wb = XLSX.read(data, { type: 'array' });

  // 1) 據點（API 可指定；CLI 沿用預設據點，依 name upsert，冪等）
  const site = opts.siteId
    ? await prisma.propertySite.findUniqueOrThrow({
        where: { id: opts.siteId },
        select: { id: true, name: true },
      })
    : opts.dryRun
      ? (await findExistingDefaultPropertySite()) ?? { id: 0, name: opts.defaultSiteName }
      : await getOrCreateDefaultPropertySite();
  const siteId = site.id;

  if (opts.dryRun) {
    return previewPropertyWorkbook(wb, site, errors);
  }

  // 員工查找表（解析歷史維護人員用）
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true },
  });
  const empByEmail = new Map<string, number>();
  const empByName = new Map<string, number>();
  for (const e of employees) {
    if (e.email) empByEmail.set(e.email.trim().toLowerCase(), e.id);
    if (e.name) empByName.set(e.name.trim(), e.id);
  }

  // 2) 人員名冊
  const personnelStat = { created: 0, updated: 0 };
  const personnelSheet = getSheet(wb, '人員名冊');
  if (personnelSheet && personnelSheet.length > 1) {
    const cm = buildColMap(personnelSheet[0], ['personnelEmail', 'personnelName', 'jobTitle']);
    for (let r = 1; r < personnelSheet.length; r++) {
      const row = personnelSheet[r];
      const name = cell(row, cm.personnelName ?? -1);
      if (!name) continue;
      const email = cell(row, cm.personnelEmail ?? -1);
      const jobTitle = cell(row, cm.jobTitle ?? -1);
      const isSupervisor = !!jobTitle && jobTitle.includes('主管');
      const aliases = JSON.stringify([name, email].filter(Boolean));
      const linkedEmployeeId =
        (email && empByEmail.get(email.toLowerCase())) || empByName.get(name) || null;

      const existing = await prisma.propertyPersonnel.findUnique({
        where: { siteId_name: { siteId, name } },
        select: { id: true },
      });
      await prisma.propertyPersonnel.upsert({
        where: { siteId_name: { siteId, name } },
        update: { email, jobTitle, isSupervisor, aliases, linkedEmployeeId, isActive: true },
        create: { siteId, name, email, jobTitle, isSupervisor, aliases, linkedEmployeeId },
      });
      if (existing) personnelStat.updated++;
      else personnelStat.created++;
    }
  } else {
    errors.push('找不到「人員名冊」工作表或無資料');
  }

  // 重新載入該據點人員，建立解析索引
  const personnel = await prisma.propertyPersonnel.findMany({
    where: { siteId },
    select: { id: true, name: true, email: true, aliases: true, linkedEmployeeId: true },
  });
  const persByEmail = new Map<string, (typeof personnel)[number]>();
  const persByName = new Map<string, (typeof personnel)[number]>();
  for (const p of personnel) {
    if (p.email) persByEmail.set(p.email.trim().toLowerCase(), p);
    persByName.set(p.name.trim(), p);
    try {
      for (const a of JSON.parse(p.aliases ?? '[]') as string[]) {
        if (a) persByName.set(String(a).trim(), p);
      }
    } catch {
      /* ignore */
    }
  }

  const unresolved = new Map<string, number>();
  function resolveMaintainer(raw: string | null): {
    personnelId: number | null;
    employeeId: number | null;
  } {
    if (!raw) return { personnelId: null, employeeId: null };
    const v = raw.trim();
    // (a) email
    if (EMAIL_RE.test(v)) {
      const p = persByEmail.get(v.toLowerCase());
      if (p) return { personnelId: p.id, employeeId: p.linkedEmployeeId ?? null };
      const eid = empByEmail.get(v.toLowerCase());
      if (eid) return { personnelId: null, employeeId: eid };
    }
    // (b) 別名/姓名精確
    const pExact = persByName.get(v);
    if (pExact) return { personnelId: pExact.id, employeeId: pExact.linkedEmployeeId ?? null };
    // (c) Employee 姓名精確
    const eExact = empByName.get(v);
    if (eExact) return { personnelId: null, employeeId: eExact };
    // (d) 子字串（處理「淑涵」↔「李淑涵」）
    for (const p of personnel) {
      const n = p.name.trim();
      if (n && (n.includes(v) || v.includes(n))) {
        return { personnelId: p.id, employeeId: p.linkedEmployeeId ?? null };
      }
    }
    unresolved.set(v, (unresolved.get(v) ?? 0) + 1);
    return { personnelId: null, employeeId: null };
  }

  // 3) 財產主檔
  const assetStat = { created: 0, updated: 0, skippedNoCode: 0, duplicateInFile: 0 };
  const assetSheet = getSheet(wb, '財產主檔');
  if (assetSheet && assetSheet.length > 1) {
    const cm = buildColMap(assetSheet[0], [
      'assetCode',
      'assetName',
      'photo',
      'location',
      'manager',
      'frequency',
      'acquiredDate',
      'nextMaintDate',
    ]);
    const seenAssetCodes = new Set<string>();
    for (let r = 1; r < assetSheet.length; r++) {
      const row = assetSheet[r];
      const assetCode = cell(row, cm.assetCode ?? -1);
      if (!assetCode) {
        assetStat.skippedNoCode++;
        continue;
      }
      if (!isCode128Compatible(assetCode)) {
        errors.push(`資產 ${assetCode} 不符合 CODE_128 條碼格式（已略過）`);
        continue;
      }
      if (seenAssetCodes.has(assetCode)) {
        assetStat.duplicateInFile++;
        continue;
      }
      seenAssetCodes.add(assetCode);
      const name = cell(row, cm.assetName ?? -1) ?? assetCode;
      const freqRaw = cell(row, cm.frequency ?? -1);
      const data = {
        siteId,
        assetCode,
        name,
        photoPath: normalizePropertyAttachmentPath(cell(row, cm.photo ?? -1)),
        location: cell(row, cm.location ?? -1),
        managerName: cell(row, cm.manager ?? -1),
        maintenanceFrequency: freqRaw,
        frequencyDays: normalizeFrequencyDays(freqRaw),
        acquiredDate: excelSerialToDate(row[cm.acquiredDate ?? -1]),
        nextMaintenanceDate: excelSerialToDate(row[cm.nextMaintDate ?? -1]),
      };
      if (freqRaw && data.frequencyDays == null) {
        errors.push(`資產 ${assetCode} 未知維護頻率「${freqRaw}」（不自動產生任務）`);
      }
      const existing = await prisma.propertyAsset.findUnique({
        where: { siteId_assetCode: { siteId, assetCode } },
        select: { id: true },
      });
      await prisma.propertyAsset.upsert({
        where: { siteId_assetCode: { siteId, assetCode } },
        update: { ...data, isActive: true },
        create: data,
      });
      if (existing) assetStat.updated++;
      else assetStat.created++;
    }
  } else {
    errors.push('找不到「財產主檔」工作表或無資料');
  }

  // 資產查找表
  const assets = await prisma.propertyAsset.findMany({
    where: { siteId },
    select: { id: true, assetCode: true },
  });
  const assetByCode = new Map<string, number>();
  for (const a of assets) assetByCode.set(a.assetCode, a.id);

  // 4) 維護執行紀錄（分批 upsert）
  const recStat = { created: 0, updated: 0, skippedNoId: 0, skippedNoAsset: 0 };
  const recSheet = getSheet(wb, '維護執行紀錄');
  if (recSheet && recSheet.length > 1) {
    const cm = buildColMap(recSheet[0], [
      'recordId',
      'assetCode',
      'cycle',
      'dueDate',
      'status',
      'maintainer',
      'completedDate',
      'inventoryResult',
      'assetCondition',
      'maintenanceItem',
      'otherNote',
      'maintPhoto',
      'maintSignature',
      'auditStatus',
      'rejectReason',
      'supervisorName',
      'supervisorDate',
      'supervisorSign',
      'note',
      'notified',
    ]);

    // 預先解析所有列 → payload，再分批寫
    const payloads: {
      recordId: string;
      create: Prisma.MaintenanceRecordUncheckedCreateInput;
      update: Prisma.MaintenanceRecordUncheckedUpdateInput;
    }[] = [];
    for (let r = 1; r < recSheet.length; r++) {
      const row = recSheet[r];
      const recordId = cell(row, cm.recordId ?? -1);
      if (!recordId) {
        recStat.skippedNoId++;
        continue;
      }
      const assetCode = cell(row, cm.assetCode ?? -1);
      const assetId = assetCode ? assetByCode.get(assetCode) : undefined;
      if (!assetCode || !assetId) {
        recStat.skippedNoAsset++;
        continue;
      }
      const rawStatus = cell(row, cm.status ?? -1);
      const maintainerRaw = cell(row, cm.maintainer ?? -1);
      const { personnelId, employeeId } = resolveMaintainer(maintainerRaw);
      const notifiedRaw = cell(row, cm.notified ?? -1);

      const base = {
        siteId,
        assetId,
        assetCode,
        maintenanceCycle: cell(row, cm.cycle ?? -1),
        dueDate: excelSerialToDate(row[cm.dueDate ?? -1]),
        status: normalizeStatus(rawStatus),
        rawStatus,
        maintainerRaw,
        maintainerPersonnelId: personnelId,
        maintainerEmployeeId: employeeId,
        completedDate: excelSerialToDate(row[cm.completedDate ?? -1]),
        inventoryResult: cell(row, cm.inventoryResult ?? -1),
        assetCondition: cell(row, cm.assetCondition ?? -1),
        maintenanceItem: cell(row, cm.maintenanceItem ?? -1),
        otherNote: cell(row, cm.otherNote ?? -1),
        photoPath: normalizePropertyAttachmentPath(cell(row, cm.maintPhoto ?? -1)),
        signaturePath: normalizePropertyAttachmentPath(cell(row, cm.maintSignature ?? -1)),
        auditStatus: normalizePropertyAuditStatus(cell(row, cm.auditStatus ?? -1)),
        rejectReason: cell(row, cm.rejectReason ?? -1),
        supervisorName: cell(row, cm.supervisorName ?? -1),
        supervisorAuditDate: excelSerialToDate(row[cm.supervisorDate ?? -1]),
        supervisorSignaturePath: normalizePropertyAttachmentPath(cell(row, cm.supervisorSign ?? -1)),
        note: cell(row, cm.note ?? -1),
        notified: notifiedRaw != null && /^(true|1|是|已通知|y)$/i.test(notifiedRaw),
      };
      payloads.push({ recordId, create: { recordId, ...base }, update: base });
    }

    // 既有 recordId（判斷 created vs updated）
    const existingIds = new Set(
      (
        await prisma.maintenanceRecord.findMany({
          where: { recordId: { in: payloads.map((p) => p.recordId) } },
          select: { recordId: true },
        })
      ).map((x) => x.recordId)
    );

    for (let i = 0; i < payloads.length; i += CHUNK) {
      const slice = payloads.slice(i, i + CHUNK);
      await prisma.$transaction(
        slice.map((p) =>
          prisma.maintenanceRecord.upsert({
            where: { recordId: p.recordId },
            update: p.update,
            create: p.create,
          })
        )
      );
      for (const p of slice) {
        if (existingIds.has(p.recordId)) recStat.updated++;
        else recStat.created++;
      }
    }
  } else {
    errors.push('找不到「維護執行紀錄」工作表或無資料');
  }

  const unresolvedMaintainers = [...unresolved.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    message: `匯入完成：人員 +${personnelStat.created}/~${personnelStat.updated}、資產 +${assetStat.created}/~${assetStat.updated}、紀錄 +${recStat.created}/~${recStat.updated}`,
    results: {
      site,
      personnel: personnelStat,
      assets: assetStat,
      records: recStat,
    },
    unresolvedMaintainers,
    errors,
  };
}
