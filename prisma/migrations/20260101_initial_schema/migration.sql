-- Missing initial schema; existing databases must baseline this migration explicitly.

-- CreateTable
CREATE TABLE "employees" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthday" DATETIME NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "emergency_contact" TEXT,
    "emergency_phone" TEXT,
    "hire_date" DATETIME NOT NULL,
    "base_salary" REAL NOT NULL,
    "hourly_rate" REAL NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "managed_location" TEXT,
    "employee_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "insured_base" REAL,
    "dependents" INTEGER DEFAULT 0,
    "labor_pension_self_rate" REAL,
    "labor_insurance_active" BOOLEAN NOT NULL DEFAULT true,
    "labor_insurance_note" TEXT,
    "health_insurance_active" BOOLEAN NOT NULL DEFAULT true,
    "health_insurance_start_date" DATETIME,
    "health_insurance_end_date" DATETIME,
    "id_number" TEXT,
    "bank_code" TEXT DEFAULT '806',
    "bank_account" TEXT
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_number" TEXT NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "department" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "items" TEXT NOT NULL,
    "total_amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "approved_by" INTEGER,
    "approved_at" DATETIME,
    "reject_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "purchase_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchase_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "last_login" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "backup_codes" TEXT,
    "current_session_id" TEXT,
    CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "device_name" TEXT,
    "transports" TEXT,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "annual_leaves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "years_of_service" INTEGER NOT NULL,
    "total_days" INTEGER NOT NULL,
    "used_days" REAL NOT NULL DEFAULT 0,
    "remaining_days" REAL NOT NULL,
    "expiry_date" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "annual_leaves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME NOT NULL,
    "total_days" REAL NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" INTEGER,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manager_reviewer_id" INTEGER,
    "manager_opinion" TEXT,
    "manager_note" TEXT,
    "manager_reviewed_at" DATETIME,
    "cancellation_status" TEXT,
    "cancellation_reason" TEXT,
    "cancellation_requested_at" DATETIME,
    "cancellation_hr_reviewer_id" INTEGER,
    "cancellation_hr_opinion" TEXT,
    "cancellation_hr_note" TEXT,
    "cancellation_hr_reviewed_at" DATETIME,
    "cancellation_admin_approver_id" INTEGER,
    "cancellation_admin_note" TEXT,
    "cancellation_approved_at" DATETIME,
    "voided_by" INTEGER,
    "voided_at" DATETIME,
    "void_reason" TEXT,
    CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "overtime_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "overtime_date" DATETIME NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "total_hours" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "work_content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "compensation_type" TEXT NOT NULL DEFAULT 'COMP_LEAVE',
    "overtime_type" TEXT,
    "overtime_pay" REAL,
    "hourly_rate_used" REAL,
    "approved_by" INTEGER,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manager_reviewer_id" INTEGER,
    "manager_opinion" TEXT,
    "manager_note" TEXT,
    "manager_reviewed_at" DATETIME,
    "cancellation_status" TEXT,
    "cancellation_reason" TEXT,
    "cancellation_requested_at" DATETIME,
    "cancellation_hr_reviewer_id" INTEGER,
    "cancellation_hr_opinion" TEXT,
    "cancellation_hr_note" TEXT,
    "cancellation_hr_reviewed_at" DATETIME,
    "cancellation_admin_approver_id" INTEGER,
    "cancellation_admin_note" TEXT,
    "cancellation_approved_at" DATETIME,
    "voided_by" INTEGER,
    "voided_at" DATETIME,
    "void_reason" TEXT,
    "comp_leave_reversed" BOOLEAN NOT NULL DEFAULT false,
    "comp_leave_reversed_at" DATETIME,
    CONSTRAINT "overtime_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "overtime_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "work_date" DATETIME NOT NULL,
    "clock_in_time" DATETIME,
    "clock_out_time" DATETIME,
    "clock_in_latitude" REAL,
    "clock_in_longitude" REAL,
    "clock_in_accuracy" REAL,
    "clock_in_address" TEXT,
    "clock_out_latitude" REAL,
    "clock_out_longitude" REAL,
    "clock_out_accuracy" REAL,
    "clock_out_address" TEXT,
    "regular_hours" REAL,
    "overtime_hours" REAL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "salary_histories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "effective_date" DATETIME NOT NULL,
    "base_salary" REAL NOT NULL,
    "hourly_rate" REAL NOT NULL,
    "previous_salary" REAL,
    "adjustment_amount" REAL,
    "adjustment_type" TEXT NOT NULL DEFAULT 'INITIAL',
    "reason" TEXT,
    "approved_by_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "salary_histories_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "salary_histories_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "pay_year" INTEGER NOT NULL,
    "pay_month" INTEGER NOT NULL,
    "regular_hours" REAL NOT NULL,
    "overtime_hours" REAL NOT NULL,
    "weekday_overtime_hours" REAL NOT NULL DEFAULT 0,
    "rest_day_overtime_hours" REAL NOT NULL DEFAULT 0,
    "holiday_overtime_hours" REAL NOT NULL DEFAULT 0,
    "mandatory_rest_overtime_hours" REAL NOT NULL DEFAULT 0,
    "base_pay" REAL NOT NULL,
    "overtime_pay" REAL NOT NULL,
    "weekday_overtime_pay" REAL NOT NULL DEFAULT 0,
    "rest_day_overtime_pay" REAL NOT NULL DEFAULT 0,
    "holiday_overtime_pay" REAL NOT NULL DEFAULT 0,
    "mandatory_rest_overtime_pay" REAL NOT NULL DEFAULT 0,
    "gross_pay" REAL NOT NULL,
    "labor_insurance" REAL NOT NULL DEFAULT 0,
    "health_insurance" REAL NOT NULL DEFAULT 0,
    "supplementary_insurance" REAL NOT NULL DEFAULT 0,
    "labor_pension_self" REAL NOT NULL DEFAULT 0,
    "income_tax" REAL NOT NULL DEFAULT 0,
    "total_deductions" REAL NOT NULL DEFAULT 0,
    "net_pay" REAL NOT NULL,
    "hourly_wage" REAL NOT NULL,
    "overtime_calculation_details" JSONB,
    "deduction_details" JSONB,
    "calculation_notes" JSONB,
    "health_insurance_details" JSONB,
    "dependents_count_used" INTEGER DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "publisher_id" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" DATETIME,
    "expiry_date" DATETIME,
    "scheduled_publish_at" DATETIME,
    "target_departments" TEXT,
    "is_global_announcement" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "announcements_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "announcement_attachments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "announcement_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_attachments_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "work_date" TEXT NOT NULL,
    "shift_type" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "schedules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_monthly_releases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year_month" TEXT NOT NULL,
    "department" TEXT,
    "published_by_id" INTEGER NOT NULL,
    "published_at" DATETIME NOT NULL,
    "deadline" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_modified" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_monthly_releases_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_confirmations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "year_month" TEXT NOT NULL,
    "release_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_at" DATETIME NOT NULL,
    "comment" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_confirmations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "schedule_confirmations_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "schedule_monthly_releases" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shift_exchange_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requester_id" INTEGER NOT NULL,
    "target_employee_id" INTEGER NOT NULL,
    "original_work_date" TEXT NOT NULL,
    "target_work_date" TEXT NOT NULL,
    "request_reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "admin_remarks" TEXT,
    "approved_by" INTEGER,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "manager_reviewer_id" INTEGER,
    "manager_opinion" TEXT,
    "manager_note" TEXT,
    "manager_reviewed_at" DATETIME,
    "cancellation_status" TEXT,
    "cancellation_reason" TEXT,
    "cancellation_requested_at" DATETIME,
    "cancellation_hr_reviewer_id" INTEGER,
    "cancellation_hr_opinion" TEXT,
    "cancellation_hr_note" TEXT,
    "cancellation_hr_reviewed_at" DATETIME,
    "cancellation_admin_approver_id" INTEGER,
    "cancellation_admin_note" TEXT,
    "cancellation_approved_at" DATETIME,
    "voided_by" INTEGER,
    "voided_at" DATETIME,
    "void_reason" TEXT,
    CONSTRAINT "shift_exchange_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "shift_exchange_requests_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "shift_exchange_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payroll_item_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payroll_id" INTEGER NOT NULL,
    "item_config_id" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unit_price" REAL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_items_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payroll_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payroll_items_item_config_id_fkey" FOREIGN KEY ("item_config_id") REFERENCES "payroll_item_configs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attendance_freezes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "freeze_date" DATETIME NOT NULL,
    "target_month" INTEGER NOT NULL,
    "target_year" INTEGER NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attendance_freezes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "health_insurance_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "premium_rate" REAL NOT NULL DEFAULT 0.0517,
    "employee_contribution_ratio" REAL NOT NULL DEFAULT 0.30,
    "company_contribution_ratio" REAL NOT NULL DEFAULT 0.60,
    "government_subsidy_ratio" REAL NOT NULL DEFAULT 0.10,
    "max_dependents" INTEGER NOT NULL DEFAULT 3,
    "supplementary_rate" REAL NOT NULL DEFAULT 0.0217,
    "supplementary_threshold" REAL NOT NULL DEFAULT 744000,
    "effective_date" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "health_insurance_salary_levels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "config_id" INTEGER NOT NULL,
    "min_salary" REAL NOT NULL,
    "max_salary" REAL NOT NULL,
    "insured_amount" REAL NOT NULL,
    "level" INTEGER NOT NULL,
    CONSTRAINT "health_insurance_salary_levels_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "health_insurance_configs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "employee_annual_bonus" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "total_bonus_amount" REAL NOT NULL DEFAULT 0,
    "supplementary_premium" REAL NOT NULL DEFAULT 0,
    "last_updated" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_annual_bonus_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bonus_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "annual_bonus_id" INTEGER NOT NULL,
    "bonusType" TEXT NOT NULL,
    "bonus_type_name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "payroll_year" INTEGER NOT NULL,
    "payroll_month" INTEGER NOT NULL,
    "service_months" REAL,
    "total_months" INTEGER NOT NULL DEFAULT 12,
    "pro_rated_ratio" REAL NOT NULL DEFAULT 1.0,
    "full_amount" REAL,
    "is_pro_rated" BOOLEAN NOT NULL DEFAULT false,
    "service_start_date" DATETIME,
    "service_end_date" DATETIME,
    "calculation_date" DATETIME,
    "eligible_for_bonus" BOOLEAN NOT NULL DEFAULT false,
    "minimum_service_met" BOOLEAN NOT NULL DEFAULT false,
    "insured_amount" REAL NOT NULL,
    "exempt_threshold" REAL NOT NULL,
    "cumulative_bonus_before" REAL NOT NULL,
    "cumulative_bonus_after" REAL NOT NULL,
    "calculation_base" REAL NOT NULL DEFAULT 0,
    "supplementary_premium" REAL NOT NULL DEFAULT 0,
    "premium_rate" REAL NOT NULL DEFAULT 0.0211,
    "is_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_reason" TEXT,
    "original_record_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "bonus_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bonus_records_annual_bonus_id_fkey" FOREIGN KEY ("annual_bonus_id") REFERENCES "employee_annual_bonus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bonus_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bonus_records_original_record_id_fkey" FOREIGN KEY ("original_record_id") REFERENCES "bonus_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bonus_configurations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bonusType" TEXT NOT NULL,
    "bonus_type_name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_amount" REAL,
    "calculation_formula" TEXT,
    "eligibility_rules" JSONB,
    "payment_schedule" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "password_exceptions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "exception_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "expires_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "password_exceptions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "password_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "health_insurance_dependents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "dependent_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "id_number" TEXT NOT NULL,
    "birth_date" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "remarks" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "health_insurance_dependents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attendance_permissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attendance_permissions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "allowed_locations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "radius" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "department" TEXT,
    "work_hours" TEXT,
    "wifi_ssid_list" TEXT,
    "wifi_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wifi_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "gps_attendance_permissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER,
    "department" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gps_attendance_permissions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gps_attendance_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "missed_clock_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "work_date" TEXT NOT NULL,
    "clock_type" TEXT NOT NULL,
    "requested_time" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" INTEGER,
    "approved_at" DATETIME,
    "reject_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "manager_reviewer_id" INTEGER,
    "manager_opinion" TEXT,
    "manager_note" TEXT,
    "manager_reviewed_at" DATETIME,
    "cancellation_status" TEXT,
    "cancellation_reason" TEXT,
    "cancellation_requested_at" DATETIME,
    "cancellation_hr_reviewer_id" INTEGER,
    "cancellation_hr_opinion" TEXT,
    "cancellation_hr_note" TEXT,
    "cancellation_hr_reviewed_at" DATETIME,
    "cancellation_admin_approver_id" INTEGER,
    "cancellation_admin_note" TEXT,
    "cancellation_approved_at" DATETIME,
    "voided_by" INTEGER,
    "voided_at" DATETIME,
    "void_reason" TEXT,
    CONSTRAINT "missed_clock_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "missed_clock_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "employee_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" INTEGER,
    "old_value" TEXT,
    "new_value" TEXT,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_msg" TEXT,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rate_limit_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "reset_time" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "csrf_tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ip_blocks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ip_address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "comp_leave_balances" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "total_earned" REAL NOT NULL DEFAULT 0,
    "total_used" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "pending_earn" REAL NOT NULL DEFAULT 0,
    "pending_use" REAL NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "comp_leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comp_leave_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "hours" REAL NOT NULL,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "reference_id" INTEGER,
    "reference_type" TEXT,
    "year_month" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comp_leave_transactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resignation_settlements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "comp_leave_hours" REAL NOT NULL,
    "hourly_rate" REAL NOT NULL,
    "total_amount" REAL NOT NULL,
    "settlement_date" DATETIME NOT NULL,
    "processed_by" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resignation_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "resignation_settlements_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "overtime_clock_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "clock_type" TEXT NOT NULL,
    "clock_time" DATETIME NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "accuracy" REAL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "invalid_reason" TEXT,
    "overtime_request_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "overtime_clock_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_flows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "steps" TEXT NOT NULL,
    "auto_approve_rules" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "approval_delegates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "delegator_id" INTEGER NOT NULL,
    "delegate_id" INTEGER NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME NOT NULL,
    "resource_types" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_delegates_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "approval_delegates_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payroll_settlement_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payroll_record_id" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" REAL,
    "days" REAL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "reference_id" INTEGER,
    "reference_type" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_settlement_items_payroll_record_id_fkey" FOREIGN KEY ("payroll_record_id") REFERENCES "payroll_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "leave_expiry" BOOLEAN NOT NULL DEFAULT true,
    "leave_approval" BOOLEAN NOT NULL DEFAULT true,
    "overtime_approval" BOOLEAN NOT NULL DEFAULT true,
    "shift_exchange_approval" BOOLEAN NOT NULL DEFAULT true,
    "system_announcements" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_endpoint" TEXT,
    "push_p256dh" TEXT,
    "push_auth" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_settings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "departments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "positions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "department_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resignation_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "application_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" DATETIME NOT NULL,
    "actual_date" DATETIME,
    "reason" TEXT NOT NULL,
    "reason_type" TEXT NOT NULL DEFAULT 'VOLUNTARY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by_id" INTEGER,
    "approved_at" DATETIME,
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "resignation_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handover_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "resignation_id" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigned_to" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" DATETIME,
    "completed_by" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "handover_items_resignation_id_fkey" FOREIGN KEY ("resignation_id") REFERENCES "resignation_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "smtp_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "smtp_host" TEXT,
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_user" TEXT,
    "smtp_password" TEXT,
    "from_email" TEXT,
    "from_name" TEXT DEFAULT '長福考勤系統',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "holiday_compensations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "holiday_id" INTEGER NOT NULL,
    "holiday_date" DATETIME NOT NULL,
    "holiday_name" TEXT NOT NULL,
    "worked_on_date" BOOLEAN NOT NULL DEFAULT false,
    "compensation_date" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "year" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "holiday_compensations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "holiday_compensations_holiday_id_fkey" FOREIGN KEY ("holiday_id") REFERENCES "holidays" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payslip_email_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "smtp_host" TEXT,
    "smtp_port" INTEGER DEFAULT 587,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_user" TEXT,
    "smtp_password" TEXT,
    "from_email" TEXT,
    "from_name" TEXT DEFAULT '薪資系統',
    "subject_template" TEXT DEFAULT '[%YEAR%年%MONTH%月] 薪資條通知',
    "body_template" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "payslip_send_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payroll_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_email" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "sent_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "sent_by" TEXT
);

-- CreateTable
CREATE TABLE "dependent_enrollment_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dependent_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "dependent_name" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effective_date" DATETIME NOT NULL,
    "report_status" TEXT NOT NULL DEFAULT 'PENDING',
    "report_date" DATETIME,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "dependent_history_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dependent_id" INTEGER NOT NULL,
    "dependent_name" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field_name" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT NOT NULL,
    "changed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "dependent_applications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "application_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dependent_id" INTEGER,
    "dependent_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "id_number" TEXT NOT NULL,
    "birth_date" DATETIME NOT NULL,
    "effective_date" DATETIME NOT NULL,
    "change_field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "remarks" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "review_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "dependent_application_attachments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "application_id" INTEGER NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dependent_application_attachments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "dependent_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "labor_law_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "basic_wage" INTEGER NOT NULL DEFAULT 29500,
    "labor_insurance_rate" REAL NOT NULL DEFAULT 0.115,
    "employment_insurance_rate" REAL NOT NULL DEFAULT 0.01,
    "labor_insurance_max" INTEGER NOT NULL DEFAULT 45800,
    "labor_employee_rate" REAL NOT NULL DEFAULT 0.2,
    "effective_date" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "leave_rules_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parental_leave_flexible" BOOLEAN NOT NULL DEFAULT true,
    "parental_leave_max_days" INTEGER NOT NULL DEFAULT 30,
    "parental_leave_combined_max" INTEGER NOT NULL DEFAULT 60,
    "family_care_leave_max_days" INTEGER NOT NULL DEFAULT 7,
    "family_care_hourly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "family_care_hourly_max_hours" INTEGER NOT NULL DEFAULT 56,
    "family_care_no_deduct" BOOLEAN NOT NULL DEFAULT true,
    "sick_leave_annual_max" INTEGER NOT NULL DEFAULT 30,
    "sick_leave_no_deduct_days" INTEGER NOT NULL DEFAULT 10,
    "sick_leave_half_pay" BOOLEAN NOT NULL DEFAULT true,
    "annual_leave_rollover" BOOLEAN NOT NULL DEFAULT false,
    "annual_leave_rollover_max" INTEGER NOT NULL DEFAULT 0,
    "comp_leave_rollover" BOOLEAN NOT NULL DEFAULT false,
    "comp_leave_rollover_max" INTEGER NOT NULL DEFAULT 0,
    "comp_leave_expiry_months" INTEGER NOT NULL DEFAULT 6,
    "effective_date" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "username" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL,
    "fail_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_balance_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "leave_type" TEXT NOT NULL,
    "entitled" REAL NOT NULL,
    "used" REAL NOT NULL DEFAULT 0,
    "remaining" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leave_balance_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_notification_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "leave_approval_notify" BOOLEAN NOT NULL DEFAULT true,
    "overtime_approval_notify" BOOLEAN NOT NULL DEFAULT true,
    "shift_approval_notify" BOOLEAN NOT NULL DEFAULT true,
    "annual_leave_expiry_notify" BOOLEAN NOT NULL DEFAULT true,
    "annual_leave_expiry_days" INTEGER NOT NULL DEFAULT 90,
    "reminder_stages" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "leave_expiry_reminder_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "annual_leave_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "sent_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "in_app_notifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payroll_disputes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "payroll_id" INTEGER,
    "pay_year" INTEGER NOT NULL,
    "pay_month" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requested_amount" REAL,
    "file_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" INTEGER,
    "reviewed_at" DATETIME,
    "review_note" TEXT,
    "adjusted_amount" REAL,
    "adjust_in_year" INTEGER,
    "adjust_in_month" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payroll_disputes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payroll_disputes_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payroll_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payroll_disputes_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payroll_id" INTEGER NOT NULL,
    "dispute_id" INTEGER,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "original_year" INTEGER,
    "original_month" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_adjustments_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payroll_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payroll_adjustments_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "payroll_disputes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payroll_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "disaster_day_offs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "disaster_date" TEXT NOT NULL,
    "disaster_type" TEXT NOT NULL,
    "stop_work_type" TEXT NOT NULL,
    "affected_scope" TEXT NOT NULL DEFAULT 'ALL',
    "affected_departments" TEXT,
    "affected_employee_ids" TEXT,
    "description" TEXT,
    "affected_count" INTEGER NOT NULL DEFAULT 0,
    "original_schedules" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "disaster_day_offs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workflow_type" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '__ALL__',
    "workflow_name" TEXT NOT NULL,
    "approval_level" INTEGER NOT NULL DEFAULT 2,
    "require_manager" BOOLEAN NOT NULL DEFAULT true,
    "final_approver" TEXT NOT NULL DEFAULT 'ADMIN',
    "deadline_mode" TEXT NOT NULL DEFAULT 'FIXED',
    "deadline_hours" INTEGER,
    "enable_forward" BOOLEAN NOT NULL DEFAULT false,
    "enable_cc" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "approval_freeze_reminders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "days_before_freeze_1" INTEGER NOT NULL DEFAULT 3,
    "days_before_freeze_2" INTEGER NOT NULL DEFAULT 1,
    "freeze_day_reminder_time" TEXT NOT NULL DEFAULT '09:00',
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "department_managers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "department" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "can_approve_leave" BOOLEAN NOT NULL DEFAULT true,
    "can_approve_overtime" BOOLEAN NOT NULL DEFAULT true,
    "can_approve_shift" BOOLEAN NOT NULL DEFAULT true,
    "can_approve_purchase" BOOLEAN NOT NULL DEFAULT true,
    "can_schedule" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "department_managers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "manager_deputies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "manager_id" INTEGER NOT NULL,
    "deputy_employee_id" INTEGER NOT NULL,
    "start_date" DATETIME,
    "end_date" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_deputies_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "department_managers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_deputies_deputy_employee_id_fkey" FOREIGN KEY ("deputy_employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_type" TEXT NOT NULL,
    "request_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "applicant_name" TEXT NOT NULL,
    "department" TEXT,
    "current_level" INTEGER NOT NULL DEFAULT 1,
    "max_level" INTEGER NOT NULL,
    "require_manager" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deadline_at" DATETIME,
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "is_escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "approval_reviews" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "instance_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "reviewer_id" INTEGER NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "reviewer_role" TEXT NOT NULL,
    "is_deputy" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "forward_to_id" INTEGER,
    "forward_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_reviews_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approval_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_ccs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "instance_id" INTEGER NOT NULL,
    "cc_by_employee_id" INTEGER NOT NULL,
    "cc_by_name" TEXT NOT NULL,
    "cc_to_employee_id" INTEGER NOT NULL,
    "cc_to_name" TEXT NOT NULL,
    "cc_type" TEXT NOT NULL DEFAULT 'ACKNOWLEDGE',
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responded_at" DATETIME,
    "response" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_ccs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approval_ccs_cc_by_employee_id_fkey" FOREIGN KEY ("cc_by_employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "approval_ccs_cc_to_employee_id_fkey" FOREIGN KEY ("cc_to_employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pension_contribution_applications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_id" INTEGER NOT NULL,
    "current_rate" REAL NOT NULL DEFAULT 0,
    "requested_rate" REAL NOT NULL,
    "effective_date" DATETIME NOT NULL,
    "application_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_HR',
    "hr_reviewer_id" INTEGER,
    "hr_reviewed_at" DATETIME,
    "hr_opinion" TEXT,
    "hr_note" TEXT,
    "admin_approver_id" INTEGER,
    "admin_approved_at" DATETIME,
    "admin_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "pension_contribution_applications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pension_contribution_applications_hr_reviewer_id_fkey" FOREIGN KEY ("hr_reviewer_id") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pension_contribution_applications_admin_approver_id_fkey" FOREIGN KEY ("admin_approver_id") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_id_key" ON "employees"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_request_number_key" ON "purchase_requests"("request_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "annual_leaves_employee_id_year_key" ON "annual_leaves"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employee_id_work_date_key" ON "attendance_records"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "salary_histories_employee_id_effective_date_idx" ON "salary_histories"("employee_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_employee_id_pay_year_pay_month_key" ON "payroll_records"("employee_id", "pay_year", "pay_month");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_employee_id_work_date_key" ON "schedules"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_monthly_releases_year_month_department_key" ON "schedule_monthly_releases"("year_month", "department");

-- CreateIndex
CREATE INDEX "schedule_confirmations_employee_id_year_month_idx" ON "schedule_confirmations"("employee_id", "year_month");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_confirmations_employee_id_release_id_key" ON "schedule_confirmations"("employee_id", "release_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_item_configs_code_key" ON "payroll_item_configs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_payroll_id_item_config_id_key" ON "payroll_items"("payroll_id", "item_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_annual_bonus_employee_id_year_key" ON "employee_annual_bonus"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_records_employee_id_bonusType_payroll_year_payroll_month_is_adjustment_key" ON "bonus_records"("employee_id", "bonusType", "payroll_year", "payroll_month", "is_adjustment");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_configurations_bonusType_key" ON "bonus_configurations"("bonusType");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "password_exceptions_employee_id_idx" ON "password_exceptions"("employee_id");

-- CreateIndex
CREATE INDEX "password_exceptions_exception_type_idx" ON "password_exceptions"("exception_type");

-- CreateIndex
CREATE UNIQUE INDEX "health_insurance_dependents_id_number_key" ON "health_insurance_dependents"("id_number");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_permissions_employee_id_key" ON "attendance_permissions"("employee_id");

-- CreateIndex
CREATE INDEX "gps_attendance_permissions_employee_id_idx" ON "gps_attendance_permissions"("employee_id");

-- CreateIndex
CREATE INDEX "gps_attendance_permissions_department_idx" ON "gps_attendance_permissions"("department");

-- CreateIndex
CREATE INDEX "missed_clock_requests_employee_id_idx" ON "missed_clock_requests"("employee_id");

-- CreateIndex
CREATE INDEX "missed_clock_requests_work_date_idx" ON "missed_clock_requests"("work_date");

-- CreateIndex
CREATE INDEX "missed_clock_requests_status_idx" ON "missed_clock_requests"("status");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_employee_id_idx" ON "audit_logs"("employee_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_success_idx" ON "audit_logs"("success");

-- CreateIndex
CREATE INDEX "audit_logs_is_flagged_idx" ON "audit_logs"("is_flagged");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_records_key_key" ON "rate_limit_records"("key");

-- CreateIndex
CREATE INDEX "rate_limit_records_reset_time_idx" ON "rate_limit_records"("reset_time");

-- CreateIndex
CREATE UNIQUE INDEX "csrf_tokens_session_id_key" ON "csrf_tokens"("session_id");

-- CreateIndex
CREATE INDEX "csrf_tokens_expires_at_idx" ON "csrf_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "ip_blocks_blocked_until_idx" ON "ip_blocks"("blocked_until");

-- CreateIndex
CREATE UNIQUE INDEX "ip_blocks_ip_address_reason_key" ON "ip_blocks"("ip_address", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "comp_leave_balances_employee_id_key" ON "comp_leave_balances"("employee_id");

-- CreateIndex
CREATE INDEX "comp_leave_transactions_employee_id_year_month_idx" ON "comp_leave_transactions"("employee_id", "year_month");

-- CreateIndex
CREATE INDEX "comp_leave_transactions_is_frozen_idx" ON "comp_leave_transactions"("is_frozen");

-- CreateIndex
CREATE UNIQUE INDEX "resignation_settlements_employee_id_key" ON "resignation_settlements"("employee_id");

-- CreateIndex
CREATE INDEX "overtime_clock_records_employee_id_clock_time_idx" ON "overtime_clock_records"("employee_id", "clock_time");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flows_resource_type_key" ON "approval_flows"("resource_type");

-- CreateIndex
CREATE INDEX "approval_delegates_delegator_id_is_active_idx" ON "approval_delegates"("delegator_id", "is_active");

-- CreateIndex
CREATE INDEX "approval_delegates_delegate_id_is_active_idx" ON "approval_delegates"("delegate_id", "is_active");

-- CreateIndex
CREATE INDEX "payroll_settlement_items_payroll_record_id_idx" ON "payroll_settlement_items"("payroll_record_id");

-- CreateIndex
CREATE INDEX "notifications_employee_id_is_read_idx" ON "notifications"("employee_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_employee_id_key" ON "notification_settings"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "positions_department_id_idx" ON "positions"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_department_id_name_key" ON "positions"("department_id", "name");

-- CreateIndex
CREATE INDEX "resignation_records_employee_id_idx" ON "resignation_records"("employee_id");

-- CreateIndex
CREATE INDEX "resignation_records_status_idx" ON "resignation_records"("status");

-- CreateIndex
CREATE INDEX "handover_items_resignation_id_idx" ON "handover_items"("resignation_id");

-- CreateIndex
CREATE INDEX "handover_items_category_idx" ON "handover_items"("category");

-- CreateIndex
CREATE INDEX "holidays_year_idx" ON "holidays"("year");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holiday_compensations_employee_id_year_idx" ON "holiday_compensations"("employee_id", "year");

-- CreateIndex
CREATE INDEX "holiday_compensations_status_idx" ON "holiday_compensations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_compensations_employee_id_holiday_id_key" ON "holiday_compensations"("employee_id", "holiday_id");

-- CreateIndex
CREATE INDEX "payslip_send_history_employee_id_idx" ON "payslip_send_history"("employee_id");

-- CreateIndex
CREATE INDEX "payslip_send_history_year_month_idx" ON "payslip_send_history"("year", "month");

-- CreateIndex
CREATE INDEX "payslip_send_history_status_idx" ON "payslip_send_history"("status");

-- CreateIndex
CREATE INDEX "dependent_enrollment_logs_dependent_id_idx" ON "dependent_enrollment_logs"("dependent_id");

-- CreateIndex
CREATE INDEX "dependent_enrollment_logs_employee_id_idx" ON "dependent_enrollment_logs"("employee_id");

-- CreateIndex
CREATE INDEX "dependent_enrollment_logs_type_idx" ON "dependent_enrollment_logs"("type");

-- CreateIndex
CREATE INDEX "dependent_enrollment_logs_report_status_idx" ON "dependent_enrollment_logs"("report_status");

-- CreateIndex
CREATE INDEX "dependent_history_logs_dependent_id_idx" ON "dependent_history_logs"("dependent_id");

-- CreateIndex
CREATE INDEX "dependent_history_logs_action_idx" ON "dependent_history_logs"("action");

-- CreateIndex
CREATE INDEX "dependent_history_logs_changed_at_idx" ON "dependent_history_logs"("changed_at");

-- CreateIndex
CREATE INDEX "dependent_applications_employee_id_idx" ON "dependent_applications"("employee_id");

-- CreateIndex
CREATE INDEX "dependent_applications_status_idx" ON "dependent_applications"("status");

-- CreateIndex
CREATE INDEX "dependent_applications_application_type_idx" ON "dependent_applications"("application_type");

-- CreateIndex
CREATE INDEX "dependent_application_attachments_application_id_idx" ON "dependent_application_attachments"("application_id");

-- CreateIndex
CREATE INDEX "login_logs_user_id_idx" ON "login_logs"("user_id");

-- CreateIndex
CREATE INDEX "login_logs_username_idx" ON "login_logs"("username");

-- CreateIndex
CREATE INDEX "login_logs_created_at_idx" ON "login_logs"("created_at");

-- CreateIndex
CREATE INDEX "leave_balance_history_employee_id_year_idx" ON "leave_balance_history"("employee_id", "year");

-- CreateIndex
CREATE INDEX "leave_expiry_reminder_logs_employee_id_idx" ON "leave_expiry_reminder_logs"("employee_id");

-- CreateIndex
CREATE INDEX "leave_expiry_reminder_logs_annual_leave_id_idx" ON "leave_expiry_reminder_logs"("annual_leave_id");

-- CreateIndex
CREATE INDEX "leave_expiry_reminder_logs_sent_at_idx" ON "leave_expiry_reminder_logs"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "leave_expiry_reminder_logs_employee_id_annual_leave_id_stage_key" ON "leave_expiry_reminder_logs"("employee_id", "annual_leave_id", "stage");

-- CreateIndex
CREATE INDEX "in_app_notifications_employee_id_idx" ON "in_app_notifications"("employee_id");

-- CreateIndex
CREATE INDEX "in_app_notifications_is_read_idx" ON "in_app_notifications"("is_read");

-- CreateIndex
CREATE INDEX "in_app_notifications_created_at_idx" ON "in_app_notifications"("created_at");

-- CreateIndex
CREATE INDEX "payroll_disputes_employee_id_idx" ON "payroll_disputes"("employee_id");

-- CreateIndex
CREATE INDEX "payroll_disputes_payroll_id_idx" ON "payroll_disputes"("payroll_id");

-- CreateIndex
CREATE INDEX "payroll_disputes_status_idx" ON "payroll_disputes"("status");

-- CreateIndex
CREATE INDEX "payroll_disputes_pay_year_pay_month_idx" ON "payroll_disputes"("pay_year", "pay_month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_adjustments_dispute_id_key" ON "payroll_adjustments"("dispute_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_payroll_id_idx" ON "payroll_adjustments"("payroll_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_dispute_id_idx" ON "payroll_adjustments"("dispute_id");

-- CreateIndex
CREATE INDEX "disaster_day_offs_disaster_date_idx" ON "disaster_day_offs"("disaster_date");

-- CreateIndex
CREATE INDEX "disaster_day_offs_disaster_type_idx" ON "disaster_day_offs"("disaster_type");

-- CreateIndex
CREATE UNIQUE INDEX "disaster_day_offs_disaster_date_affected_scope_key" ON "disaster_day_offs"("disaster_date", "affected_scope");

-- CreateIndex
CREATE INDEX "department_managers_department_idx" ON "department_managers"("department");

-- CreateIndex
CREATE UNIQUE INDEX "department_managers_employee_id_department_key" ON "department_managers"("employee_id", "department");

-- CreateIndex
CREATE INDEX "manager_deputies_manager_id_idx" ON "manager_deputies"("manager_id");

-- CreateIndex
CREATE INDEX "manager_deputies_deputy_employee_id_idx" ON "manager_deputies"("deputy_employee_id");

-- CreateIndex
CREATE INDEX "approval_instances_request_type_request_id_idx" ON "approval_instances"("request_type", "request_id");

-- CreateIndex
CREATE INDEX "approval_instances_status_idx" ON "approval_instances"("status");

-- CreateIndex
CREATE INDEX "approval_instances_applicant_id_idx" ON "approval_instances"("applicant_id");

-- CreateIndex
CREATE INDEX "approval_reviews_instance_id_idx" ON "approval_reviews"("instance_id");

-- CreateIndex
CREATE INDEX "approval_reviews_reviewer_id_idx" ON "approval_reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "approval_ccs_instance_id_idx" ON "approval_ccs"("instance_id");

-- CreateIndex
CREATE INDEX "approval_ccs_cc_to_employee_id_idx" ON "approval_ccs"("cc_to_employee_id");

-- CreateIndex
CREATE INDEX "pension_contribution_applications_employee_id_idx" ON "pension_contribution_applications"("employee_id");

-- CreateIndex
CREATE INDEX "pension_contribution_applications_status_idx" ON "pension_contribution_applications"("status");

-- CreateIndex
CREATE INDEX "pension_contribution_applications_effective_date_idx" ON "pension_contribution_applications"("effective_date");
