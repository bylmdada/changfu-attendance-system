import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, canMaintainSite } from '@/lib/property-access';
import { resolvePropertyAttachmentPath } from '@/lib/property-attachment-paths';

const MAX = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

async function loadRec(recordId: string) {
  return prisma.maintenanceRecord.findUnique({
    where: { recordId },
    include: { site: { select: { code: true } } },
  });
}

// POST：上傳維護照片/簽章（§9）。form: file, field=photo|signature
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { recordId } = await params;
  const rid = decodeURIComponent(recordId);
  const rec = await loadRec(rid);
  if (!rec) return fail('找不到紀錄', 404);
  if (!canMaintainSite(g.ctx.access, rec.siteId)) return fail('僅維護人員可上傳維護附件', 403);
  if (rec.status !== 'PENDING') return fail('此紀錄已提交或完成，無法修改附件', 409);

  const form = await request.formData();
  const file = form.get('file') as File | null;
  const field = String(form.get('field') ?? 'photo');
  if (!file) return fail('請選擇檔案');
  if (file.size > MAX) return fail('檔案過大（上限 8MB）');
  if (!ALLOWED.includes(file.type)) return fail('僅支援 JPG/PNG/WebP');
  if (!['photo', 'signature'].includes(field)) return fail('field 參數錯誤');

  const ext = mimeToExtension(file.type);
  const safeRid = rid.replace(/[^A-Za-z0-9_-]/g, '_');
  const fileName = `${safeRid}.${field}.${Date.now()}.${ext}`;
  const dir = join(process.cwd(), 'uploads', 'property-maintenance', rec.site.code);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  const relPath = `uploads/property-maintenance/${rec.site.code}/${fileName}`;

  await prisma.maintenanceRecord.update({
    where: { recordId: rid },
    data: field === 'photo' ? { photoPath: relPath } : { signaturePath: relPath },
  });
  return ok({ path: relPath, field }, '已上傳');
}

function mimeToExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

// GET ?field=photo|signature：串流檔案供檢視
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { recordId } = await params;
  const rec = await loadRec(decodeURIComponent(recordId));
  if (!rec) return fail('找不到紀錄', 404);
  if (!canAccessSite(g.ctx.access, rec.siteId)) return fail('無權限', 403);

  const field = request.nextUrl.searchParams.get('field') ?? 'photo';
  if (!['photo', 'signature'].includes(field)) return fail('field 參數錯誤');
  const rel = field === 'signature' ? rec.signaturePath : rec.photoPath;
  const fullPath = resolvePropertyAttachmentPath(rel);
  if (!fullPath) return fail('無附件', 404);
  try {
    const buf = await readFile(fullPath);
    const ext = fullPath.split('.').pop()?.toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': type } });
  } catch {
    return fail('檔案不存在（可能為舊系統相對路徑）', 404);
  }
}
