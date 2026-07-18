ALTER TABLE "attendance_records" ADD COLUMN "clock_in_has_fever" BOOLEAN;
ALTER TABLE "attendance_records" ADD COLUMN "clock_in_temperature" REAL;
ALTER TABLE "attendance_records" ADD COLUMN "clock_in_has_acute_cough" BOOLEAN;
ALTER TABLE "attendance_records" ADD COLUMN "clock_out_has_fever" BOOLEAN;
ALTER TABLE "attendance_records" ADD COLUMN "clock_out_temperature" REAL;
ALTER TABLE "attendance_records" ADD COLUMN "clock_out_has_acute_cough" BOOLEAN;
