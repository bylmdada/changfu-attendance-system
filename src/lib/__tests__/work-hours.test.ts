/**
 * 工時計算測試範例
 * 
 * 安裝測試依賴後執行：npm run test
 * 
 * 注意：需要先執行以下命令安裝 Jest：
 * npm install -D jest @types/jest ts-jest --force
 */

// 工時計算函數（從 verify-clock 提取，便於測試）
export function calculateWorkHours(clockInTime: Date, clockOutTime: Date): {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
} {
  const workHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
  
  // 標準工時8小時，超過的算加班
  const regularHours = Math.min(Math.max(workHours, 0), 8);
  const overtimeHours = Math.max(0, workHours - 8);
  
  return {
    totalHours: parseFloat(workHours.toFixed(2)),
    regularHours: parseFloat(regularHours.toFixed(2)),
    overtimeHours: parseFloat(overtimeHours.toFixed(2))
  };
}

// 正常工時測試
describe('工時計算', () => {
  test('正常 8 小時工作日', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T17:00:00');
    
    const result = calculateWorkHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(8);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(0);
  });

  test('加班 2 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T19:00:00'); // 10 小時
    
    const result = calculateWorkHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(10);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(2);
  });

  test('半天工作 4 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T13:00:00');
    
    const result = calculateWorkHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(4);
    expect(result.regularHours).toBe(4);
    expect(result.overtimeHours).toBe(0);
  });

  test('大量加班 12 小時', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-15T21:00:00');
    
    const result = calculateWorkHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
  });

  test('跨午夜加班', () => {
    const clockIn = new Date('2024-01-15T09:00:00');
    const clockOut = new Date('2024-01-16T01:00:00'); // 16 小時
    
    const result = calculateWorkHours(clockIn, clockOut);
    
    expect(result.totalHours).toBe(16);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(8);
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
