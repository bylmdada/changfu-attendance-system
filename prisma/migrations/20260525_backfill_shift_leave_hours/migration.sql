UPDATE "shift_definitions"
SET "special_leave_hours" = 8
WHERE "code" = 'FDL'
  AND "special_leave_hours" = 0;

UPDATE "shift_definitions"
SET "comp_leave_hours" = 8,
    "description" = CASE
      WHEN "description" IS NULL OR "description" = '' OR "description" = '休假' THEN '補休／休假'
      ELSE "description"
    END
WHERE "code" = 'OFF'
  AND "comp_leave_hours" = 0;

UPDATE "schedules"
SET "special_leave_hours" = 8
WHERE "shift_type" = 'FDL'
  AND "special_leave_hours" = 0;

UPDATE "schedules"
SET "comp_leave_hours" = 8
WHERE "shift_type" = 'OFF'
  AND "comp_leave_hours" = 0;
