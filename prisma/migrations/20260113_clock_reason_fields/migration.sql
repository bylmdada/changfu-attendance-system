-- Add clock reason fields to AttendanceRecord
ALTER TABLE attendance_records ADD COLUMN clock_in_reason TEXT;
ALTER TABLE attendance_records ADD COLUMN clock_out_reason TEXT;
ALTER TABLE attendance_records ADD COLUMN clock_in_overtime_id INTEGER;
ALTER TABLE attendance_records ADD COLUMN clock_out_overtime_id INTEGER;
