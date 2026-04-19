CREATE UNIQUE INDEX IF NOT EXISTS "overtime_requests_active_unique_employee_date_idx"
ON "overtime_requests" ("employee_id", "overtime_date")
WHERE "status" IN ('PENDING', 'PENDING_ADMIN', 'APPROVED');
