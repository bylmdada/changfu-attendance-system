export interface RequestDescriptor {
  url: string;
  options: RequestInit;
}

export function buildCookieSessionRequest(origin: string, path: string): RequestDescriptor {
  return {
    url: `${origin}${path}`,
    options: {
      credentials: 'include',
    },
  };
}

export function buildAuthMeRequest(origin: string): RequestDescriptor {
  return buildCookieSessionRequest(origin, '/api/auth/me');
}

export function buildSalaryManagementListRequest(origin: string): RequestDescriptor {
  return buildCookieSessionRequest(origin, '/api/salary-management?type=list');
}

export function buildLogoutRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/auth/logout`,
    options: {
      method: 'POST',
    },
  };
}