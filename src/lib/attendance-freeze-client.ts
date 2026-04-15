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

export function buildAttendanceFreezeRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/system-settings/attendance-freeze`,
    options: { credentials: 'include' },
  };
}