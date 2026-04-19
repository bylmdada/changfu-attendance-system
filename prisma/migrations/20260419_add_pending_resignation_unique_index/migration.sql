CREATE UNIQUE INDEX IF NOT EXISTS "resignation_records_pending_unique_employee_idx"
ON "resignation_records" ("employee_id")
WHERE "status" IN ('PENDING', 'APPROVED', 'IN_HANDOVER');
