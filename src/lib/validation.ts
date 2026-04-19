import { z } from 'zod';

// 基礎驗證模式
export const BaseSchemas = {
  // 通用字段
  id: z.number().int().positive(),
  employeeId: z.string().min(1).max(20),
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().optional(),
  phone: z.string().regex(/^[0-9\-\(\)\+\s]+$/).optional(),
  
  // 日期時間
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  datetime: z.string().datetime(),
  
  // 密碼
  password: z.string().min(8).max(128)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/,
      '密碼必須包含大小寫字母、數字和特殊字符'),
  
  // 用戶名
  username: z.string().min(3).max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, '用戶名只能包含字母、數字、下劃線和連字號'),
  
  // 金額
  amount: z.number().min(0).max(999999.99),
  
  // 時數
  hours: z.number().min(0).max(24),
  
  // 狀態
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  
  // 角色
  role: z.enum(['ADMIN', 'HR', 'EMPLOYEE']),
  
  // 部門
  department: z.string().min(1).max(50).optional(),
  
  // 職位
  position: z.string().min(1).max(50).optional(),
};

// 認證相關驗證
export const AuthSchemas = {
  login: z.object({
    username: BaseSchemas.username,
    password: z.string().min(1, '密碼不能為空')
  }),
  
  changePassword: z.object({
    currentPassword: z.string().min(1, '當前密碼不能為空'),
    newPassword: BaseSchemas.password,
    confirmPassword: z.string()
  }).refine(
    (data) => data.newPassword === data.confirmPassword,
    {
      message: '確認密碼與新密碼不符',
      path: ['confirmPassword']
    }
  ),
  
  createUser: z.object({
    username: BaseSchemas.username,
    password: BaseSchemas.password,
    role: BaseSchemas.role,
    employeeId: BaseSchemas.id
  })
};

// 員工管理驗證
export const EmployeeSchemas = {
  create: z.object({
    employeeId: BaseSchemas.employeeId,
    name: BaseSchemas.name,
    birthday: BaseSchemas.date,
    phone: BaseSchemas.phone,
    address: z.string().max(200).optional(),
    emergencyContact: BaseSchemas.name.optional(),
    emergencyPhone: BaseSchemas.phone,
    hireDate: BaseSchemas.date,
    baseSalary: BaseSchemas.amount,
    hourlyRate: BaseSchemas.amount,
    department: BaseSchemas.department,
    position: BaseSchemas.position,
    // 帳號創建選項
    createAccount: z.boolean().optional(),
    username: BaseSchemas.username.optional(),
    password: BaseSchemas.password.optional()
  }),
  
  update: z.object({
    name: BaseSchemas.name.optional(),
    phone: BaseSchemas.phone,
    address: z.string().max(200).optional(),
    emergencyContact: BaseSchemas.name.optional(),
    emergencyPhone: BaseSchemas.phone,
    baseSalary: BaseSchemas.amount.optional(),
    hourlyRate: BaseSchemas.amount.optional(),
    department: BaseSchemas.department,
    position: BaseSchemas.position
  }),
  
  search: z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(10),
    search: z.string().max(100).optional()
  })
};

// 請假申請驗證
export const LeaveRequestSchemas = {
  create: z.object({
    startDate: BaseSchemas.datetime,
    endDate: BaseSchemas.datetime,
    leaveType: z.enum(['SICK', 'PERSONAL', 'ANNUAL', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'COMPENSATORY', 'MENSTRUAL', 'OFFICIAL', 'FAMILY_CARE']),
    reason: z.string().min(1).max(500),
    totalHours: BaseSchemas.hours
  }).refine(
    (data) => new Date(data.endDate) > new Date(data.startDate),
    {
      message: '結束時間必須晚於開始時間',
      path: ['endDate']
    }
  ),
  
  query: z.object({
    employeeId: BaseSchemas.id.optional(),
    status: BaseSchemas.status.optional(),
    startDate: BaseSchemas.date.optional(),
    endDate: BaseSchemas.date.optional()
  })
};

// 加班申請驗證
export const OvertimeRequestSchemas = {
  create: z.object({
    overtimeDate: BaseSchemas.date,
    startTime: BaseSchemas.time,
    endTime: BaseSchemas.time,
    reason: z.string().min(1).max(500),
    workContent: z.string().max(1000).optional()
  }).refine(
    (data) => {
      const start = parseInt(data.startTime.split(':')[0]);
      return start >= 17; // 加班必須在17:00之後
    },
    {
      message: '加班開始時間必須在17:00之後',
      path: ['startTime']
    }
  ).refine(
    (data) => {
      const startMinutes = timeToMinutes(data.startTime);
      const endMinutes = timeToMinutes(data.endTime);
      const duration = endMinutes > startMinutes ? 
        endMinutes - startMinutes : 
        (24 * 60) + endMinutes - startMinutes;
      return duration >= 30 && duration <= 240; // 0.5-4小時
    },
    {
      message: '加班時數必須在0.5-4小時之間',
      path: ['endTime']
    }
  ),
  
  query: z.object({
    employeeId: BaseSchemas.id.optional(),
    startDate: BaseSchemas.date.optional(),
    endDate: BaseSchemas.date.optional(),
    status: BaseSchemas.status.optional()
  })
};

// 調班申請驗證
export const ShiftExchangeSchemas = {
  create: z.object({
    shiftDate: BaseSchemas.date,
    originalShiftType: z.string().min(1).max(20),
    newShiftType: z.string().min(1).max(20),
    reason: z.string().min(1).max(500),
    leaveType: z.string().max(50).optional()
  }).refine(
    (data) => {
      return data.originalShiftType !== data.newShiftType;
    },
    {
      message: '原班別與新班別不可相同',
      path: ['newShiftType']
    }
  ),
  
  query: z.object({
    status: BaseSchemas.status.optional(),
    requesterId: BaseSchemas.id.optional()
  })
};

// 薪資記錄驗證
export const PayrollSchemas = {
  create: z.object({
    employeeId: BaseSchemas.id,
    payYear: z.number().int().min(2020).max(2030),
    payMonth: z.number().int().min(1).max(12)
  }),
  
  query: z.object({
    employeeId: BaseSchemas.id.optional(),
    year: z.number().int().min(2020).max(2030).optional(),
    month: z.number().int().min(1).max(12).optional()
  })
};

// 考勤凍結驗證
export const AttendanceFreezeSchemas = {
  create: z.object({
    freezeDate: BaseSchemas.datetime,
    description: z.string().min(1).max(200)
  }),
  
  query: z.object({
    year: z.number().int().min(2020).max(2030).optional(),
    month: z.number().int().min(1).max(12).optional()
  })
};

// 班表驗證
export const ScheduleSchemas = {
  query: z.object({
    startDate: BaseSchemas.date.optional(),
    endDate: BaseSchemas.date.optional(),
    year: z.number().int().min(2020).max(2030).optional(),
    month: z.number().int().min(1).max(12).optional()
  })
};

// 輔助函數
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// 通用驗證函數
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean;
  data?: T;
  errors?: string[];
} {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((err: z.ZodIssue) => 
        `${err.path.join('.')}: ${err.message}`
      );
      return { success: false, errors };
    }
    return { success: false, errors: ['未知的驗證錯誤'] };
  }
}

// 查詢參數驗證
export function validateQueryParams<T>(schema: z.ZodSchema<T>, searchParams: URLSearchParams): {
  success: boolean;
  data?: T;
  errors?: string[];
} {
  const params: Record<string, string | number | boolean> = {};
  
  for (const [key, value] of searchParams.entries()) {
    // 嘗試轉換數字類型
    if (/^\d+$/.test(value)) {
      params[key] = parseInt(value);
    } else if (/^\d+\.\d+$/.test(value)) {
      params[key] = parseFloat(value);
    } else if (value === 'true' || value === 'false') {
      params[key] = value === 'true';
    } else {
      params[key] = value;
    }
  }
  
  return validateRequest(schema, params);
}

export const EMPTY_BODY_PARSE_ERROR = 'empty_body';

// 安全的JSON解析
export async function safeParseJSON(request: Request): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const text = await request.text();
    if (!text.trim()) {
      return { success: false, error: EMPTY_BODY_PARSE_ERROR };
    }
    
    const data = JSON.parse(text) as Record<string, unknown>;
    return { success: true, data };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '無效的JSON格式' 
    };
  }
}
