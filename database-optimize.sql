-- 🚀 資料庫效能優化 SQL 腳本
-- 提升查詢速度和整體效能

-- 1. 用戶表索引優化
CREATE INDEX IF NOT EXISTS idx_users_username ON User(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON User(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON User(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON User(createdAt);

-- 2. 員工表索引優化  
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON Employee(employeeId);
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON Employee(userId);
CREATE INDEX IF NOT EXISTS idx_employees_department ON Employee(department);
CREATE INDEX IF NOT EXISTS idx_employees_position ON Employee(position);
CREATE INDEX IF NOT EXISTS idx_employees_hire_date ON Employee(hireDate);

-- 3. 考勤記錄索引優化
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON AttendanceRecord(employeeId, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON AttendanceRecord(date);
CREATE INDEX IF NOT EXISTS idx_attendance_clock_in ON AttendanceRecord(clockInTime);
CREATE INDEX IF NOT EXISTS idx_attendance_clock_out ON AttendanceRecord(clockOutTime);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON AttendanceRecord(status);

-- 4. 排班表索引優化
CREATE INDEX IF NOT EXISTS idx_schedules_employee_date ON Schedule(employeeId, date);
CREATE INDEX IF NOT EXISTS idx_schedules_date_range ON Schedule(date, startTime, endTime);
CREATE INDEX IF NOT EXISTS idx_schedules_shift_type ON Schedule(shiftType);

-- 5. 請假記錄索引優化
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON LeaveRequest(employeeId);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON LeaveRequest(startDate, endDate);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON LeaveRequest(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_type ON LeaveRequest(leaveType);

-- 6. 加班申請索引優化
CREATE INDEX IF NOT EXISTS idx_overtime_requests_employee ON OvertimeRequest(employeeId);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_date ON OvertimeRequest(date);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_status ON OvertimeRequest(status);

-- 7. 薪資記錄索引優化
CREATE INDEX IF NOT EXISTS idx_payroll_employee_period ON PayrollRecord(employeeId, payPeriod);
CREATE INDEX IF NOT EXISTS idx_payroll_pay_date ON PayrollRecord(payDate);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON PayrollRecord(status);

-- 8. 公告索引優化
CREATE INDEX IF NOT EXISTS idx_announcements_published ON Announcement(publishedAt);
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON Announcement(priority);
CREATE INDEX IF NOT EXISTS idx_announcements_author ON Announcement(authorId);

-- 9. 系統設定索引優化
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON SystemSettings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated ON SystemSettings(updatedAt);

-- 10. 複合索引優化
CREATE INDEX IF NOT EXISTS idx_attendance_employee_month ON AttendanceRecord(employeeId, strftime('%Y-%m', date));
CREATE INDEX IF NOT EXISTS idx_schedules_employee_week ON Schedule(employeeId, strftime('%Y-%W', date));
CREATE INDEX IF NOT EXISTS idx_payroll_employee_year ON PayrollRecord(employeeId, strftime('%Y', payPeriod));

-- 效能統計更新
ANALYZE;
