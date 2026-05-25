export interface ShiftDefinitionDTO {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  workHours: number;
  specialLeaveHours: number;
  compLeaveHours: number;
  overtimeHours: number;
  requiresTime: boolean;
  isActive: boolean;
  sortOrder: number;
  description: string | null;
  label: string;
}

export interface ShiftDefinitionSeed {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  workHours: number;
  specialLeaveHours: number;
  compLeaveHours: number;
  overtimeHours: number;
  requiresTime: boolean;
  sortOrder: number;
  description: string;
}

export const DEFAULT_SHIFT_DEFINITIONS: ShiftDefinitionSeed[] = [
  { code: 'A', name: 'A班', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: true, sortOrder: 10, description: '早班' },
  { code: 'B', name: 'B班', startTime: '08:00', endTime: '17:00', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: true, sortOrder: 20, description: '標準班' },
  { code: 'C', name: 'C班', startTime: '08:30', endTime: '17:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: true, sortOrder: 30, description: '晚班' },
  { code: 'NH', name: '國定假日', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: false, sortOrder: 100, description: '國定假日' },
  { code: 'RD', name: '例假', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: false, sortOrder: 110, description: '例假日' },
  { code: 'rd', name: '休息日', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: false, sortOrder: 120, description: '休息日' },
  { code: 'FDL', name: '全日請假', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 8, compLeaveHours: 0, overtimeHours: 0, requiresTime: false, sortOrder: 130, description: '全日請假' },
  { code: 'OFF', name: '休假', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 8, overtimeHours: 0, requiresTime: false, sortOrder: 140, description: '補休／休假' },
  { code: 'TD', name: '天災假', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: false, sortOrder: 150, description: '天災假' },
];

export const SHIFT_COLOR_CLASSES = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-red-100 text-red-800 border-red-200',
  'bg-gray-100 text-gray-800 border-gray-200',
  'bg-gray-50 text-gray-600 border-gray-100',
  'bg-yellow-100 text-yellow-800 border-yellow-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
];

export function formatHourLabel(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return Number.isInteger(hours) ? `${hours}小時` : `${hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}小時`;
}

export function calculateNetWorkHours(startTime: string, endTime: string, breakTime: number) {
  if (!startTime || !endTime) return 0;
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((value) => !Number.isFinite(value))) {
    return 0;
  }
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal < startTotal) endTotal += 24 * 60;
  const netMinutes = Math.max(0, endTotal - startTotal - Math.max(0, breakTime));
  return Math.round((netMinutes / 60) * 100) / 100;
}

export function formatShiftHourSummary(shift: Pick<ShiftDefinitionDTO, 'workHours' | 'specialLeaveHours' | 'compLeaveHours' | 'overtimeHours'>) {
  const parts = [`工時 ${formatHourLabel(shift.workHours) || '0小時'}`];
  const specialLeave = formatHourLabel(shift.specialLeaveHours);
  const compLeave = formatHourLabel(shift.compLeaveHours);
  const overtime = formatHourLabel(shift.overtimeHours);
  if (specialLeave) parts.push(`特休 ${specialLeave}`);
  if (compLeave) parts.push(`補休 ${compLeave}`);
  if (overtime) parts.push(`加班 ${overtime}`);
  return parts.join(' / ');
}

export function formatShiftDefinitionLabel(
  shift: Pick<ShiftDefinitionDTO, 'code' | 'name' | 'startTime' | 'endTime' | 'requiresTime' | 'workHours' | 'specialLeaveHours' | 'compLeaveHours' | 'overtimeHours'>
) {
  if (shift.requiresTime) {
    return `${shift.name} (${shift.startTime}-${shift.endTime}｜${formatShiftHourSummary(shift)})`;
  }

  return `${shift.code} (${shift.name}｜${formatShiftHourSummary(shift)})`;
}

export function buildDefaultShiftDTOs(): ShiftDefinitionDTO[] {
  return DEFAULT_SHIFT_DEFINITIONS.map((shift, index) => ({
    id: -(index + 1),
    code: shift.code,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakTime: shift.breakTime,
    workHours: shift.workHours,
    specialLeaveHours: shift.specialLeaveHours,
    compLeaveHours: shift.compLeaveHours,
    overtimeHours: shift.overtimeHours,
    requiresTime: shift.requiresTime,
    isActive: true,
    sortOrder: shift.sortOrder,
    description: shift.description,
    label: formatShiftDefinitionLabel(shift),
  }));
}

export function getShiftColorClass(code: string, shiftDefinitions: Array<Pick<ShiftDefinitionDTO, 'code'>>) {
  const index = shiftDefinitions.findIndex((shift) => shift.code === code);
  if (index >= 0) {
    return SHIFT_COLOR_CLASSES[index % SHIFT_COLOR_CLASSES.length];
  }

  return 'bg-slate-100 text-slate-800 border-slate-200';
}

export function getShiftTemplate(code: string, shiftDefinitions: ShiftDefinitionDTO[]) {
  const shift = shiftDefinitions.find((definition) => definition.code === code);

  return {
    startTime: shift?.startTime ?? '',
    endTime: shift?.endTime ?? '',
    breakTime: shift?.breakTime ?? 0,
    workHours: shift?.workHours ?? 0,
    specialLeaveHours: shift?.specialLeaveHours ?? 0,
    compLeaveHours: shift?.compLeaveHours ?? 0,
    overtimeHours: shift?.overtimeHours ?? 0,
    requiresTime: shift?.requiresTime ?? true,
  };
}
