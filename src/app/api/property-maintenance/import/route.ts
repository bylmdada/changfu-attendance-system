import { NextRequest } from 'next/server';
import { importPropertyWorkbook } from '@/lib/property-import-service';
import { DEFAULT_SITE } from '@/lib/app-config';
import { guard, fail, ok } from '@/lib/property-api';
import { canManageSite } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';

export const maxDuration = 120;

const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const XLSX_ZIP_SIGNATURES = new Set(['504b0304', '504b0506', '504b0708']);

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

function hasXlsxSignature(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
  const signature = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return XLSX_ZIP_SIGNATURES.has(signature);
}

export async function POST(request: NextRequest) {
  try {
    const g = await guard(request, { csrf: true });
    if ('res' in g) return g.res;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const siteId = parsePositiveInt(formData.get('siteId'));
    const dryRun = formData.get('mode') === 'preview';
    if (siteId !== null && !canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
    if (siteId === null && !g.ctx.access.isGlobalAdmin) return fail('需要管理員或人資權限', 403);
    if (!file) {
      return fail('請上傳檔案');
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return fail('僅支援 Excel (.xlsx) 格式');
    }
    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      return fail('檔案大小超過限制（最大 10MB）');
    }

    const arrayBuffer = await file.arrayBuffer();
    if (!hasXlsxSignature(arrayBuffer)) {
      return fail('檔案內容不是有效的 Excel (.xlsx) 格式');
    }
    const result = await importPropertyWorkbook(arrayBuffer, {
      siteId: siteId ?? undefined,
      defaultSiteName: DEFAULT_SITE.name,
      defaultSiteCode: DEFAULT_SITE.code,
      institutionTitle: DEFAULT_SITE.institutionTitle,
      dryRun,
    });

    return ok(result);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail('匯入資料與既有資料重複，或另一個匯入正在進行中；請重新檢測後再儲存', 409);
    }
    console.error('財產盤點匯入失敗:', error);
    return fail('系統錯誤', 500);
  }
}
