import { prisma } from '@/lib/database';
import {
  DEFAULT_SHIFT_DEFINITIONS,
  ShiftDefinitionDTO,
  formatShiftDefinitionLabel,
} from '@/lib/shift-definition-utils';

type ShiftDefinitionRecord = {
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
};

export function toShiftDefinitionDTO(shift: ShiftDefinitionRecord): ShiftDefinitionDTO {
  return {
    id: shift.id,
    code: shift.code,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakTime: shift.breakTime,
    workHours: shift.workHours ?? 0,
    specialLeaveHours: shift.specialLeaveHours ?? 0,
    compLeaveHours: shift.compLeaveHours ?? 0,
    overtimeHours: shift.overtimeHours ?? 0,
    requiresTime: shift.requiresTime,
    isActive: shift.isActive,
    sortOrder: shift.sortOrder,
    description: shift.description,
    label: formatShiftDefinitionLabel(shift),
  };
}

export async function ensureDefaultShiftDefinitions() {
  if (!prisma.shiftDefinition?.count) {
    return;
  }

  const existingCount = await prisma.shiftDefinition.count();
  if (existingCount > 0) {
    return;
  }

  await prisma.$transaction(
    DEFAULT_SHIFT_DEFINITIONS.map((shift) =>
      prisma.shiftDefinition.upsert({
        where: { code: shift.code },
        create: shift,
        update: {},
      })
    )
  );
}

export async function listShiftDefinitions(options: { includeInactive?: boolean } = {}) {
  await ensureDefaultShiftDefinitions();

  if (!prisma.shiftDefinition?.findMany) {
    return buildFallbackShiftDefinitions(options.includeInactive);
  }

  const shifts = await prisma.shiftDefinition.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    orderBy: [
      { sortOrder: 'asc' },
      { code: 'asc' },
    ],
  });

  return shifts.map(toShiftDefinitionDTO);
}

export async function findActiveShiftDefinition(code: string) {
  await ensureDefaultShiftDefinitions();

  if (!prisma.shiftDefinition?.findFirst) {
    return buildFallbackShiftDefinitions(false).find((shift) => shift.code === code) ?? buildLegacyShiftDefinition(code);
  }

  const shift = await prisma.shiftDefinition.findFirst({
    where: {
      code,
      isActive: true,
    },
  });

  return shift ? toShiftDefinitionDTO(shift) : null;
}

export async function findShiftDefinition(code: string) {
  await ensureDefaultShiftDefinitions();

  if (!prisma.shiftDefinition?.findUnique) {
    return buildFallbackShiftDefinitions(true).find((shift) => shift.code === code) ?? buildLegacyShiftDefinition(code);
  }

  const shift = await prisma.shiftDefinition.findUnique({
    where: { code },
  });

  return shift ? toShiftDefinitionDTO(shift) : null;
}

function buildFallbackShiftDefinitions(includeInactive = false) {
  const shifts = DEFAULT_SHIFT_DEFINITIONS.map((shift, index) =>
    toShiftDefinitionDTO({
      id: -(index + 1),
      ...shift,
      isActive: true,
      description: shift.description,
    })
  );

  return includeInactive ? shifts : shifts.filter((shift) => shift.isActive);
}

function buildLegacyShiftDefinition(code: string): ShiftDefinitionDTO {
  return toShiftDefinitionDTO({
    id: -999999,
    code,
    name: code,
    startTime: '',
    endTime: '',
    breakTime: 0,
    workHours: 0,
    specialLeaveHours: 0,
    compLeaveHours: 0,
    overtimeHours: 0,
    requiresTime: true,
    isActive: true,
    sortOrder: 999999,
    description: null,
  });
}
