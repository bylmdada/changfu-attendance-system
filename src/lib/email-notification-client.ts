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

export function buildEmailNotificationRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/system-settings/email-notification`,
    options: { credentials: 'include' },
  };
}

export function buildSmtpSettingsRequest(origin: string): RequestDescriptor {
  return {
    url: `${origin}/api/system-settings/smtp`,
    options: { credentials: 'include' },
  };
}