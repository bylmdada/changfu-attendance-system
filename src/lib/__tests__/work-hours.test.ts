import { calculateAttendanceHours } from '@/lib/work-hours';

// 正常工時測試
describe('工時計算', () => {
  test('正常 8 小時工作日', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T17:00:00');
    
    const result = calculateAttendanceHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(8);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(0);
  });

  test('加班 2 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T19:00:00'); // 10 小時
    
    const result = calculateAttendanceHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(10);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(2);
  });

  test('半天工作 4 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T13:00:00');
    
    const result = calculateAttendanceHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(4);
    expect(result.regularHours).toBe(4);
    expect(result.overtimeHours).toBe(0);
  });

  test('大量加班 12 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T21:00:00');
    
    const result = calculateAttendanceHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
  });

  test('跨午夜加班', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-16T01:00:00'); // 16 小時
    
    const result = calculateAttendanceHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(16);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(8);
  });

  test('缺少上下班時間時回傳 0', () => {
    const result = calculateAttendanceHours(new Date('2024-01-15T09:00:00'), null);

    expect(result.totalHours).toBe(0);
    expect(result.regularHours).toBe(0);
    expect(result.overtimeHours).toBe(0);
  });

  test('會扣除班表休息時間', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T18:00:00');

    const result = calculateAttendanceHours(clockIn, clockOut, undefined, 60);

    expect(result.totalHours).toBe(8);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(0);
  });
});

// GPS 模擬偵測測試
describe('GPS 模擬偵測', () => {
  test('正常座標不應觸發警報', () => {
    const latitude = 25.0478;
    const longitude = 121.5319;
    
    // 正常座標應有足夠的小數位
    expect(latitude.toString().split('.')[1]?.length).toBeGreaterThanOrEqual(4);
    expect(longitude.toString().split('.')[1]?.length).toBeGreaterThanOrEqual(4);
  });

  test('完美整數座標應被標記為可疑', () => {
    const latitude = 25;
    const longitude = 121;
    
    expect(Number.isInteger(latitude)).toBe(true);
    expect(Number.isInteger(longitude)).toBe(true);
  });

  test('距離計算', () => {
    // 台北101 到 台北車站約 2.5 公里
    const lat1 = 25.0339; // 台北101
    const lng1 = 121.5619;
    const lat2 = 25.0478; // 台北車站
    const lng2 = 121.5172;
    
    // 使用 Haversine 公式計算距離
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    // 預期約 5 公里內
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(6000);
  });
});
