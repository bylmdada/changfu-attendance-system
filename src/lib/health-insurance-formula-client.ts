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

export function buildHealthInsuranceFormulaRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/system-settings/health-insurance-formula`,
    options: { credentials: 'include' },
  };
}