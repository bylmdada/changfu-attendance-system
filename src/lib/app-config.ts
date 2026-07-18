/**
 * 財產管理集中設定：通知主旨/收件人來源 + 欄位相容別名（§20、§21）
 *
 * 這些是系統預設值；每個 PropertySite 可在 settings(JSON) 覆寫部分項目，
 * 由 resolveSiteConfig() 合併後使用。
 */

export const APP_CONFIG = {
  NOTIFICATION: {
    /** 到期前幾天開始每日提醒（site 可覆寫） */
    reminderDaysDefault: 3,
    /**
     * 主管 email 來源優先序：
     * 1. PropertySite.settings.supervisorEmail（覆寫）
     * 2. UserSiteAssignment 角色 SUPERVISOR 之 User → Employee.email
     * 3. PropertyPersonnel.isSupervisor 之 email
     */
    supervisorEmailSource: 'SITE_OVERRIDE > USER_SITE_SUPERVISOR > PERSONNEL_SUPERVISOR',
    subjects: {
      submitAudit: '【財產維護】維護紀錄待主管稽核通知',
      dailyReminder: '【財產維護】每日待維護／逾期提醒',
      thursdayDigest: '【財產維護】本週維護完成與待辦彙整（週四審查）',
      systemError: '【財產維護】系統排程錯誤通知',
    },
  },

  /**
   * 欄位相容別名（§21）。key 為系統內部欄位名，value 為可能出現在匯入檔的標頭。
   * 比對前兩邊都會經過 normalizeHeader()（trim → 去空白 → 去括號 → 小寫），
   * 以容忍 AppSheet 尾端空白與全/半形括號。
   */
  COLUMN_ALIASES: {
    // 財產主檔
    assetCode: ['財產編號', '財產代號', '財編', 'assetCode'],
    assetName: ['財產名稱', '品名', '名稱', 'assetName'],
    photo: ['財產照片', '照片', 'photo'],
    location: ['放置地點', '存放地點', '位置', 'location'],
    manager: ['財產管理人', '負責維護人', '管理人', '保管人', 'manager'],
    frequency: ['應維護頻率', '維護頻率', '頻率', 'frequency'],
    acquiredDate: ['取得日期', '購入日期', 'acquiredDate'],
    nextMaintDate: ['應維護日期', '預定維護日期', '下次維護日', 'nextMaintenanceDate'],

    // 維護執行紀錄
    recordId: ['紀錄ID', '記錄ID', '紀錄編號', 'recordId'],
    cycle: ['維護週期', '週期', 'cycle'],
    dueDate: ['應維護日期', '預定維護日期', '維護日期', 'dueDate'],
    status: ['維護狀態', '任務狀態', '狀態', 'status'],
    maintainer: ['維護人員', '維護人員email', '維護人員信箱', '管理人email', '維護人', '執行人員', 'maintainer'],
    completedDate: ['維護完成日期', '完成日期', 'completedDate'],
    inventoryResult: ['盤點結果', '檢查結果', '盤點', 'inventoryResult'],
    assetCondition: ['財產狀態', '資產健康狀態', '設備狀態', 'assetCondition'],
    maintenanceItem: ['維護項目', '保養項目', '項目', 'maintenanceItem'],
    otherNote: ['其他維護說明', '處理說明', '說明', 'otherNote'],
    maintPhoto: ['維護照片', '維護相片', '佐證照片'],
    maintSignature: ['維護人簽章', '維護人簽名', '簽章', 'signature'],
    auditStatus: ['稽核狀態', '審核狀態', 'auditStatus'],
    rejectReason: ['不通過原因', '退回原因', '駁回原因', 'rejectReason'],
    supervisorName: ['主管稽核人', '稽核人', '主管', 'supervisor'],
    supervisorDate: ['主管稽核日期', '稽核日期', 'supervisorAuditDate'],
    supervisorSign: ['主管簽章', '主管簽名'],
    note: ['備註', 'remark', 'note'],
    notified: ['已通知', 'notified'],

    // 人員名冊
    personnelEmail: ['email', '信箱', '電子郵件', 'e-mail'],
    personnelName: ['姓名', '名字', 'name'],
    jobTitle: ['職稱', '職位', 'title'],
  },
} as const;

/** 匯入時的預設據點（§決策6） */
export const DEFAULT_SITE = {
  name: '溪北輔具中心',
  legacyNames: ['溪北輔具中心展示間'],
  code: 'XIBEI',
  institutionTitle: '宜蘭縣溪北輔具資源中心財產維護紀錄表',
} as const;

export type ColumnKey = keyof typeof APP_CONFIG.COLUMN_ALIASES;

/** site.settings(JSON) 可覆寫的設定 */
export interface SiteConfigOverride {
  /** 主管 email 覆寫（可為陣列或逗號分隔字串） */
  supervisorEmail?: string | string[];
  /** 到期前提醒天數覆寫 */
  reminderDays?: number;
  /** 是否寄送 email（false → 僅站內通知） */
  emailEnabled?: boolean;
  /** 維護日（0=日…6=六，預設 3=週三） */
  maintenanceWeekday?: number;
  /** 審查日（預設 4=週四） */
  reviewWeekday?: number;
  /** 各頻率預設天數覆寫（如 { '每月一次': 30 }） */
  frequencyOverrides?: Record<string, number>;
}

export interface ResolvedSiteConfig {
  supervisorEmail: string[];
  reminderDays: number;
  emailEnabled: boolean;
  maintenanceWeekday: number;
  reviewWeekday: number;
  frequencyOverrides: Record<string, number>;
  subjects: typeof APP_CONFIG.NOTIFICATION.subjects;
}

/** 解析 PropertySite.settings(JSON) 疊在系統預設上 */
export function resolveSiteConfig(settingsJson: string | null | undefined): ResolvedSiteConfig {
  let parsed: SiteConfigOverride = {};
  if (settingsJson) {
    try {
      parsed = JSON.parse(settingsJson) as SiteConfigOverride;
    } catch {
      parsed = {};
    }
  }

  const supervisorEmail = Array.isArray(parsed.supervisorEmail)
    ? parsed.supervisorEmail.filter(Boolean)
    : typeof parsed.supervisorEmail === 'string'
      ? parsed.supervisorEmail.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    supervisorEmail,
    reminderDays:
      typeof parsed.reminderDays === 'number' && parsed.reminderDays >= 0
        ? parsed.reminderDays
        : APP_CONFIG.NOTIFICATION.reminderDaysDefault,
    emailEnabled: parsed.emailEnabled !== false, // 預設開啟
    maintenanceWeekday: typeof parsed.maintenanceWeekday === 'number' ? parsed.maintenanceWeekday : 3,
    reviewWeekday: typeof parsed.reviewWeekday === 'number' ? parsed.reviewWeekday : 4,
    frequencyOverrides: parsed.frequencyOverrides ?? {},
    subjects: APP_CONFIG.NOTIFICATION.subjects,
  };
}

/** 標頭正規化：trim → 去所有空白 → 去全/半形括號 → 小寫 */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase();
}

/**
 * 在一列標頭中，依別名找出指定欄位的欄索引；找不到回 -1。
 * headers：原始標頭陣列（會逐一 normalizeHeader 後比對）。
 */
export function findColumnIndex(headers: unknown[], key: ColumnKey): number {
  const aliases = APP_CONFIG.COLUMN_ALIASES[key].map(normalizeHeader);
  const normalized = headers.map(normalizeHeader);
  for (let i = 0; i < normalized.length; i++) {
    if (aliases.includes(normalized[i])) return i;
  }
  return -1;
}
