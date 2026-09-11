import type { WorkSheet } from 'xlsx';

type WorkbookCell = string | number | boolean | Date | null | undefined;

interface WorkbookSheet {
  name: string;
  rows: WorkbookCell[][];
  columnWidths?: number[];
}

interface DownloadWorkbookOptions {
  fileName: string;
  sheets: WorkbookSheet[];
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function parseDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function sanitizeSheetName(name: string) {
  const sanitized = name.replace(/[\\/?*:\[\]]/g, '_').trim();
  return (sanitized || 'Sheet').slice(0, 31);
}

export function sanitizeFileNameSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || '未命名';
}

export function formatExportDate(value: string) {
  if (!value) return '';

  const date = parseDateString(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function getWeekdayLabel(value: string) {
  if (!value) return '';
  return WEEKDAY_LABELS[parseDateString(value).getDay()] ?? '';
}

export async function downloadWorkbookAsXlsx({ fileName, sheets }: DownloadWorkbookOptions) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows) as WorkSheet;
    if (sheet.columnWidths && sheet.columnWidths.length > 0) {
      worksheet['!cols'] = sheet.columnWidths.map((wch) => ({ wch }));
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name));
  });

  const excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
