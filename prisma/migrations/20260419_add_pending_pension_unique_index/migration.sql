CREATE UNIQUE INDEX IF NOT EXISTS "pension_contribution_pending_unique_employee_idx"
ON "pension_contribution_applications" ("employee_id")
WHERE "status" IN ('PENDING_HR', 'PENDING_ADMIN');
