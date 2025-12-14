-- 檢查attendance_records表結構
PRAGMA table_info(attendance_records);

-- 添加GPS欄位（如果不存在）
ALTER TABLE attendance_records ADD COLUMN clock_in_latitude REAL;
ALTER TABLE attendance_records ADD COLUMN clock_in_longitude REAL;
ALTER TABLE attendance_records ADD COLUMN clock_in_accuracy REAL;
ALTER TABLE attendance_records ADD COLUMN clock_in_address TEXT;
ALTER TABLE attendance_records ADD COLUMN clock_out_latitude REAL;
ALTER TABLE attendance_records ADD COLUMN clock_out_longitude REAL;
ALTER TABLE attendance_records ADD COLUMN clock_out_accuracy REAL;
ALTER TABLE attendance_records ADD COLUMN clock_out_address TEXT;
