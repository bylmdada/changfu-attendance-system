// 員工相關類型
export interface Employee {
  id: number;
  employeeId: string;
  name: string;
  birthday: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  hireDate: string;
  baseSalary: number;
  hourlyRate: number;
  department?: string;
  position?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// 用戶相關類型
export interface User {
  id: number;
  employeeId: number;
  username: string;
  role: string;
  lastLogin?: string;
  isActive: boolean;
  createdAt: string;
  employee: Employee;
}

// 請假申請相關類型
export interface LeaveRequest {
  id: number;
  employeeId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason?: string;
  status: LeaveStatus;
  approvedBy?: number;
  approvedAt?: string;
  createdAt: string;
  employee: Employee;
}

export type LeaveType = 
  | 'ANNUAL'      // 年假
  | 'SICK'        // 病假
  | 'PERSONAL'    // 事假
  | 'MATERNITY'   // 產假
  | 'PATERNITY'   // 陪產假
  | 'BEREAVEMENT' // 喪假
  | 'MARRIAGE'    // 婚假
  | 'COMPENSATORY' // 補休
  | 'MENSTRUAL'   // 生理假
  | 'OFFICIAL'    // 公假
  | 'FAMILY_CARE' // 家庭照顧假
  | 'OTHER';      // 其他

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// 年假相關類型
export interface AnnualLeave {
  id: number;
  employeeId: number;
  year: number;
  yearsOfService: number;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  expiryDate: string;
  createdAt: string;
  employee: Employee;
}

// 加班申請相關類型
export interface OvertimeRequest {
  id: number;
  employeeId: number;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  reason: string;
  workContent?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: number;
  approvedAt?: string;
  createdAt: string;
  employee: Employee;
}

// 考勤記錄相關類型
export interface AttendanceRecord {
  id: number;
  employeeId: number;
  workDate: string;
  clockInTime?: string;
  clockOutTime?: string;
  regularHours?: number;
  overtimeHours?: number;
  status: AttendanceStatus;
  notes?: string;
  createdAt: string;
  employee: Employee;
}

export type AttendanceStatus = 
  | 'PRESENT'    // 正常出勤
  | 'ABSENT'     // 缺勤
  | 'LATE'       // 遲到
  | 'EARLY'      // 早退
  | 'LEAVE'      // 請假
  | 'OVERTIME';  // 加班

// 薪資記錄相關類型
export interface PayrollRecord {
  id: number;
  employeeId: number;
  payYear: number;
  payMonth: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  netPay: number;
  createdAt: string;
  employee: Employee;
}

// API 響應類型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// 表單狀態類型
export interface FormState {
  loading: boolean;
  error?: string;
  success?: boolean;
}

// 分頁類型
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// 篩選參數類型
export interface LeaveRequestFilters {
  status?: LeaveStatus;
  leaveType?: LeaveType;
  startDate?: string;
  endDate?: string;
  employeeId?: number;
  search?: string;
}

export interface AnnualLeaveFilters {
  year?: number;
  employeeId?: number;
  search?: string;
}

export interface AttendanceFilters {
  startDate?: string;
  endDate?: string;
  status?: AttendanceStatus;
  employeeId?: number;
  search?: string;
}

// 薪資相關篩選類型
export interface PayrollFilters {
  year?: number;
  month?: number;
  employeeId?: number;
  search?: string;
}

// 薪資統計類型
export interface PayrollStatistics {
  overall: {
    totalRecords: number;
    totalGrossPay: number;
    totalNetPay: number;
    totalRegularHours: number;
    totalOvertimeHours: number;
    avgGrossPay: number;
    avgNetPay: number;
    avgRegularHours: number;
    avgOvertimeHours: number;
  };
  departmentStats: DepartmentPayrollStats[];
  monthlyTrends: MonthlyPayrollTrend[];
  salaryDistribution: SalaryDistribution[];
}

export interface DepartmentPayrollStats {
  department: string;
  employeeCount: number;
  totalGrossPay: number;
  totalNetPay: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  avgGrossPay: number;
  avgNetPay: number;
}

export interface MonthlyPayrollTrend {
  month: number;
  employeeCount: number;
  totalGrossPay: number;
  totalNetPay: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
}

export interface SalaryDistribution {
  label: string;
  count: number;
  min: number;
  max: number;
}
