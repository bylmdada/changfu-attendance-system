jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: { findUnique: jest.fn() },
    allowedLocation: { findMany: jest.fn() },
  },
}));

import {
  defaultGPSSettings,
  isClockLocationPayload,
  validateGpsClockLocation,
  type AllowedLocationLite,
  type ClockLocationPayload,
} from '@/lib/gps-attendance';

describe('isClockLocationPayload', () => {
  it('rejects impossible latitude and longitude ranges', () => {
    expect(
      isClockLocationPayload({
        latitude: 95,
        longitude: 121.564468,
        accuracy: 15,
      })
    ).toBe(false);

    expect(
      isClockLocationPayload({
        latitude: 25.033964,
        longitude: -181,
        accuracy: 15,
      })
    ).toBe(false);
  });
});

describe('validateGpsClockLocation', () => {
  const allowedLocations: AllowedLocationLite[] = [
    {
      id: 1,
      name: '長福總部',
      latitude: 25.033964,
      longitude: 121.564468,
      radius: 120,
      isActive: true,
    },
  ];

  const baseLocation: ClockLocationPayload = {
    latitude: 25.033964,
    longitude: 121.564468,
    accuracy: 15,
  };

  it('rejects clocking when GPS accuracy is worse than the required threshold', () => {
    const result = validateGpsClockLocation({
      gpsSettings: {
        ...defaultGPSSettings,
        requiredAccuracy: 50,
      },
      location: {
        ...baseLocation,
        accuracy: 88,
      },
      allowedLocations,
    });

    expect(result).toEqual({
      ok: false,
      code: 'ACCURACY_TOO_LOW',
      error: 'GPS精確度不足（±88公尺，需在±50公尺內），請移動到GPS訊號較好的位置',
    });
  });

  it('rejects clocking when location is outside every active allowed radius', () => {
    const result = validateGpsClockLocation({
      gpsSettings: defaultGPSSettings,
      location: {
        latitude: 25.047675,
        longitude: 121.517055,
        accuracy: 12,
      },
      allowedLocations,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'OUT_OF_RANGE',
      nearestLocation: '長福總部',
    });
    if (result.ok) {
      throw new Error('Expected location validation to fail');
    }

    expect(result.error).toContain('不在允許的打卡範圍內');
  });

  it('allows clocking when location is within an active allowed radius', () => {
    const result = validateGpsClockLocation({
      gpsSettings: defaultGPSSettings,
      location: baseLocation,
      allowedLocations,
    });

    expect(result).toEqual({
      ok: true,
      code: 'VALID',
    });
  });

  it('allows clocking when location is slightly outside the radius but within configured variance', () => {
    const result = validateGpsClockLocation({
      gpsSettings: {
        ...defaultGPSSettings,
        maxDistanceVariance: 30,
      },
      location: {
        latitude: 25.035085,
        longitude: 121.564468,
        accuracy: 12,
      },
      allowedLocations: [
        {
          ...allowedLocations[0],
          radius: 100,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      code: 'VALID',
    });
  });

  it('still rejects clocking when location exceeds both radius and variance', () => {
    const result = validateGpsClockLocation({
      gpsSettings: {
        ...defaultGPSSettings,
        maxDistanceVariance: 10,
      },
      location: {
        latitude: 25.0354,
        longitude: 121.564468,
        accuracy: 12,
      },
      allowedLocations: [
        {
          ...allowedLocations[0],
          radius: 100,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'OUT_OF_RANGE',
    });
  });
});