interface SessionRequest {
  url: string;
  options: {
    credentials: 'include';
  };
}

export function buildAuthMeRequest(origin: string): SessionRequest {
  return {
    url: `${origin}/api/auth/me`,
    options: {
      credentials: 'include'
    }
  };
}

export function buildPayslipManagementRequest(origin: string): SessionRequest {
  return {
    url: `${origin}/api/system-settings/payslip-management`,
    options: {
      credentials: 'include'
    }
  };
}