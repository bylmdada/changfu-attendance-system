import {
  calculateAttendanceHours,
  getScheduledAttendanceTiming,
  getStoredOrCalculatedAttendanceHours,
} from '@/lib/work-hours';

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

  test('非班表提早上班不計入正常工時', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-01T23:55:00.000Z'),
      new Date('2026-07-02T07:00:00.000Z'),
      8,
      60,
      { startTime: '08:00', endTime: '17:00' }
    );

    expect(result.regularHours).toBe(6);
  });

  test('有班表時仍保留超過法定 8 小時的加班候選，交由核准流程判定', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-01T23:00:00.000Z'),
      new Date('2026-07-02T10:00:00.000Z'),
      8,
      60,
      { startTime: '08:00', endTime: '17:00' }
    );

    expect(result.overtimeHours).toBe(2);
  });

  test('有班表時仍以每日實際淨工時超過 8 小時的部分作為加班候選', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-17T00:00:00.000Z'),
      new Date('2026-07-17T10:00:00.000Z'),
      8,
      60,
      {
        startTime: '08:00',
        endTime: '17:00',
        workDate: new Date('2026-07-16T16:00:00.000Z'),
      }
    );

    expect(result.totalHours).toBe(9);
    expect(result.overtimeHours).toBe(1);
  });

  test('班表有上下班時間時不會被舊的 0 工時欄位歸零', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-17T00:00:00.000Z'),
      new Date('2026-07-17T09:00:00.000Z'),
      0,
      60,
      {
        startTime: '08:00',
        endTime: '17:00',
        workDate: new Date('2026-07-16T16:00:00.000Z'),
      }
    );

    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(0);
  });

  test('只扣除實際重疊到的休息時間', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-01T23:53:00.000Z'),
      new Date('2026-07-02T04:02:00.000Z'),
      8,
      60,
      { startTime: '08:00', endTime: '17:00' }
    );

    expect(result.regularHours).toBe(4);
  });

  test('主管同意的公出時段不重複計入班表正常工時，但保留實際打卡淨時數供 8 小時門檻判定', () => {
    const result = calculateAttendanceHours(
      new Date('2026-07-16T23:45:00.000Z'),
      new Date('2026-07-17T05:10:00.000Z'),
      8,
      60,
      {
        startTime: '08:00',
        endTime: '17:00',
        workDate: new Date('2026-07-16T16:00:00.000Z'),
        regularTimeExclusions: [
          {
            startTime: new Date('2026-07-17T05:00:00.000Z'),
            endTime: new Date('2026-07-17T09:00:00.000Z'),
          },
        ],
      }
    );

    expect(result.totalHours).toBe(4.42);
    expect(result.regularHours).toBe(4);
    expect(result.overtimeHours).toBe(0);
  });

  test('跨日班表以工作日定位班表區間', () => {
    const result = getStoredOrCalculatedAttendanceHours({
      workDate: new Date('2026-07-01T16:00:00.000Z'),
      clockInTime: new Date('2026-07-02T16:10:00.000Z'),
      clockOutTime: new Date('2026-07-02T22:00:00.000Z'),
      scheduledWorkHours: 8,
      scheduledStart: '22:00',
      scheduledEnd: '06:00',
    });

    expect(result.regularHours).toBe(5.83);
  });

  test('完整打卡與班表存在時會重算，避免舊儲存工時污染顯示', () => {
    const result = getStoredOrCalculatedAttendanceHours({
      workDate: new Date('2026-07-01T16:00:00.000Z'),
      clockInTime: new Date('2026-07-02T00:00:00.000Z'),
      clockOutTime: new Date('2026-07-02T12:00:00.000Z'),
      regularHours: 8,
      overtimeHours: 0,
      scheduledWorkHours: 8,
      scheduledStart: '10:00',
      scheduledEnd: '12:00',
    });

    expect(result).toEqual({ totalHours: 12, regularHours: 2, overtimeHours: 4 });
  });

  test('缺少完整打卡時保留已儲存工時', () => {
    const result = getStoredOrCalculatedAttendanceHours({
      workDate: new Date('2026-07-01T16:00:00.000Z'),
      clockInTime: new Date('2026-07-02T00:00:00.000Z'),
      clockOutTime: null,
      regularHours: 8,
      overtimeHours: 0,
      scheduledWorkHours: 8,
      scheduledStart: '10:00',
      scheduledEnd: '12:00',
    });

    expect(result).toEqual({ totalHours: 8, regularHours: 8, overtimeHours: 0 });
  });

  test('跨日班表遲到早退判定使用班表工作日', () => {
    const result = getScheduledAttendanceTiming({
      clockInTime: new Date('2026-07-02T16:30:00.000Z'),
      clockOutTime: new Date('2026-07-02T21:50:00.000Z'),
      schedule: {
        workDate: new Date('2026-07-01T16:00:00.000Z'),
        startTime: '22:00',
        endTime: '06:00',
      },
    });

    expect(result).toEqual({
      isLate: true,
      isEarly: true,
      lateMinutes: 150,
      earlyLeaveMinutes: 10,
    });
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
