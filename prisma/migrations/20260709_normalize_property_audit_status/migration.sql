UPDATE "maintenance_records"
SET "audit_status" = CASE "audit_status"
  WHEN '待主管稽核' THEN 'PENDING'
  WHEN '已通過' THEN 'APPROVED'
  WHEN '退回補正' THEN 'REJECTED'
  ELSE "audit_status"
END;
