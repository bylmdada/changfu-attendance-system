export function buildAuthMeRequest(origin: string) {
  return {
    url: `${origin}/api/auth/me`,
    options: {
      credentials: 'include' as const,
    },
  };
}

export function buildBonusManagementRequest(origin: string) {
  return {
    url: `${origin}/api/system-settings/bonus-management`,
    options: {
      credentials: 'include' as const,
    },
  };
}