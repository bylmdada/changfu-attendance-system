interface RequestDescriptor {
  url: string;
  options: RequestInit;
}

export function buildAuthMeRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/auth/me`,
    options: { credentials: 'include' },
  };
}

export function buildClockTimeRestrictionRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/system-settings/clock-time-restriction`,
    options: { credentials: 'include' },
  };
}