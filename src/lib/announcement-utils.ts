export function parseAnnouncementTargetDepartments(raw: string | null | undefined): string[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized = [...new Set(
      parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )];

    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export function validateAnnouncementTargetDepartments(raw: string | null | undefined): {
  normalized: string | null;
  error?: string;
} {
  const departments = parseAnnouncementTargetDepartments(raw);
  if (!departments) {
    return {
      normalized: null,
      error: '目標部門格式無效，請至少選擇一個有效部門'
    };
  }

  return {
    normalized: JSON.stringify(departments)
  };
}

export function canUserAccessAnnouncement(params: {
  isGlobalAnnouncement?: boolean;
  targetDepartments?: string | null;
  employeeDepartment?: string | null;
}): boolean {
  if (params.isGlobalAnnouncement || !params.targetDepartments) {
    return true;
  }

  const departments = parseAnnouncementTargetDepartments(params.targetDepartments);
  if (!departments || !params.employeeDepartment) {
    return false;
  }

  return departments.includes(params.employeeDepartment);
}

export function parseAnnouncementDate(
  raw: string | null | undefined,
  fieldName: string,
  options: { mustBeFuture?: boolean } = {}
): { value: Date | null; error?: string } {
  if (!raw) {
    return { value: null };
  }

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    return { value: null, error: `${fieldName} 格式無效` };
  }

  if (options.mustBeFuture && value <= new Date()) {
    return { value: null, error: `${fieldName} 必須晚於目前時間` };
  }

  return { value };
}

/**
 * 定時發布的公告要到排定時間才會被排程選中，而選取條件要求「尚未到期」。
 * 所以發布時間必須早於到期時間，否則這筆公告會顯示排程成功、卻永遠不會發布。
 * 回傳錯誤訊息；沒問題（或其中一個沒設）回傳 null。
 */
export function validateScheduledPublishBeforeExpiry(
  scheduledPublishAt: Date | string | null | undefined,
  expiryDate: Date | string | null | undefined
): string | null {
  if (!scheduledPublishAt || !expiryDate) {
    return null;
  }

  const publishTime = new Date(scheduledPublishAt).getTime();
  const expiryTime = new Date(expiryDate).getTime();
  if (Number.isNaN(publishTime) || Number.isNaN(expiryTime)) {
    return null;
  }

  return publishTime < expiryTime
    ? null
    : '定時發布時間必須早於到期日，否則公告到點時已經過期，不會發布';
}
