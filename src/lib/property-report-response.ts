import { NextResponse } from 'next/server';

/** 將 xlsx Buffer 包成附件下載回應（檔名含中文，用 RFC 5987 編碼） */
export function xlsxResponse(buffer: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

/** 將 CSV 文字包成附件下載回應（含 BOM，避免 Excel 開啟中文亂碼） */
export function csvResponse(content: string, filename: string): NextResponse {
  return new NextResponse(`\uFEFF${content}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
