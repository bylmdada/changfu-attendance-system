const LEAVE_TYPE_ALIASES: Record<string, string> = {
  ANNUAL_LEAVE: 'ANNUAL',
  SICK_LEAVE: 'SICK',
};

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  BEREAVEMENT: '喪假',
  PRENATAL_CHECKUP: '產檢假',
  ANNUAL: '特休假',
  COMPENSATORY: '補休',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  UNPAID_LEAVE: '留職停薪',
  OCCUPATIONAL_INJURY: '公傷假',
  MATERNITY: '產假',
  BREASTFEEDING: '哺乳假',
  PATERNITY_CHECKUP: '陪產檢及陪產假',
  MISCARRIAGE: '流產假',
  OFFICIAL: '公假',
  MILITARY_SERVICE: '公假(教召)',
  FAMILY_CARE: '家庭照顧假',
  MENSTRUAL: '生理假',
};

export interface LeaveTypeOption {
  value: string;
  label: string;
}

export interface LeaveReasonOption {
  value: string;
  label: string;
}

export const BEREAVEMENT_LEAVE_TYPE_CODE = 'BEREAVEMENT';

const ORDERED_LEAVE_TYPE_CODES = [
  'BEREAVEMENT',
  'PRENATAL_CHECKUP',
  'ANNUAL',
  'COMPENSATORY',
  'SICK',
  'PERSONAL',
  'MARRIAGE',
  'UNPAID_LEAVE',
  'OCCUPATIONAL_INJURY',
  'MATERNITY',
  'BREASTFEEDING',
  'PATERNITY_CHECKUP',
  'MISCARRIAGE',
  'OFFICIAL',
  'MILITARY_SERVICE',
  'FAMILY_CARE',
  'MENSTRUAL',
] as const;

const DEFAULT_LEAVE_REASON_OPTIONS: LeaveReasonOption[] = [
  { value: '其他', label: '其他' },
];

const LEAVE_REASON_OPTIONS_BY_TYPE: Record<string, LeaveReasonOption[]> = {
  ANNUAL: [
    { value: '旅遊休假', label: '旅遊休假' },
    { value: '返鄉探親', label: '返鄉探親' },
    { value: '家庭活動', label: '家庭活動' },
    { value: '個人休息', label: '個人休息' },
    { value: '預約事項', label: '預約事項' },
    { value: '其他', label: '其他' },
  ],
  COMPENSATORY: [
    { value: '加班補休', label: '加班補休' },
    { value: '國定假日補休', label: '國定假日補休' },
    { value: '輪班調整補休', label: '輪班調整補休' },
    { value: '個人休息', label: '個人休息' },
    { value: '其他', label: '其他' },
  ],
  SICK: [
    { value: '身體不適', label: '身體不適' },
    { value: '感冒發燒', label: '感冒發燒' },
    { value: '就醫治療', label: '就醫治療' },
    { value: '住院休養', label: '住院休養' },
    { value: '回診追蹤', label: '回診追蹤' },
    { value: '其他', label: '其他' },
  ],
  PERSONAL: [
    { value: '個人重要事故需親自處理', label: '個人重要事故需親自處理' },
    { value: '家庭重要事故需親自處理', label: '家庭重要事故需親自處理' },
    { value: '子女或家屬臨時照顧', label: '子女或家屬臨時照顧' },
    { value: '政府機關或司法程序辦理', label: '政府機關或司法程序辦理' },
    { value: '銀行戶政或證件親自辦理', label: '銀行戶政或證件親自辦理' },
    { value: '交通事故或保險理賠處理', label: '交通事故或保險理賠處理' },
    { value: '搬遷簽約或住宅修繕處理', label: '搬遷簽約或住宅修繕處理' },
    { value: '其他必須親自處理事項', label: '其他必須親自處理事項' },
  ],
  FAMILY_CARE: [
    { value: '照顧子女', label: '照顧子女' },
    { value: '照顧配偶', label: '照顧配偶' },
    { value: '照顧父母', label: '照顧父母' },
    { value: '陪同就醫', label: '陪同就醫' },
    { value: '家庭緊急事件', label: '家庭緊急事件' },
    { value: '其他', label: '其他' },
  ],
  MENSTRUAL: [
    { value: '生理不適', label: '生理不適' },
    { value: '腹痛休息', label: '腹痛休息' },
    { value: '身體調養', label: '身體調養' },
    { value: '就醫檢查', label: '就醫檢查' },
    { value: '其他', label: '其他' },
  ],
  BEREAVEMENT: [
    { value: '配偶', label: '配偶（8日）' },
    { value: '父母', label: '父母（8日）' },
    { value: '配偶之父母', label: '配偶之父母（8日）' },
    { value: '繼父母', label: '繼父母（6日，需符合扶養或共居）' },
    { value: '繼父母之配偶', label: '繼父母之配偶（6日，需符合扶養或共居）' },
    { value: '配偶之繼父母', label: '配偶之繼父母（6日，需符合扶養或共居）' },
    { value: '子女', label: '子女（6日）' },
    { value: '配偶之子女', label: '配偶之子女（6日）' },
    { value: '祖父母', label: '祖父母（3日）' },
    { value: '外祖父母', label: '外祖父母（3日）' },
    { value: '配偶之祖父母', label: '配偶之祖父母（3日）' },
    { value: '配偶之外祖父母', label: '配偶之外祖父母（3日）' },
    { value: '兄弟姊妹', label: '兄弟姊妹（3日）' },
    { value: '配偶之兄弟姊妹', label: '配偶之兄弟姊妹（3日）' },
    { value: '曾祖父母', label: '曾祖父母（3日）' },
    { value: '外曾祖父母', label: '外曾祖父母（3日）' },
  ],
  PRENATAL_CHECKUP: [
    { value: '產檢', label: '產檢' },
    { value: '婦產科回診', label: '婦產科回診' },
    { value: '醫師安排檢查', label: '醫師安排檢查' },
    { value: '其他', label: '其他' },
  ],
  MARRIAGE: [
    { value: '結婚登記', label: '結婚登記' },
    { value: '婚禮籌備', label: '婚禮籌備' },
    { value: '婚禮儀式', label: '婚禮儀式' },
    { value: '新婚安排', label: '新婚安排' },
    { value: '其他', label: '其他' },
  ],
  UNPAID_LEAVE: [
    { value: '育嬰留職停薪', label: '育嬰留職停薪' },
    { value: '家庭照顧或長期陪護', label: '家庭照顧或長期陪護' },
    { value: '個人重大傷病延長休養', label: '個人重大傷病延長休養' },
    { value: '進修留學或職涯進修', label: '進修留學或職涯進修' },
    { value: '配偶外派或家庭搬遷', label: '配偶外派或家庭搬遷' },
    { value: '其他經勞雇協議留職停薪事由', label: '其他經勞雇協議留職停薪事由' },
  ],
  OCCUPATIONAL_INJURY: [
    { value: '職業災害就醫治療', label: '職業災害就醫治療' },
    { value: '職業災害住院或居家休養', label: '職業災害住院或居家休養' },
    { value: '職災復健治療', label: '職災復健治療' },
    { value: '職災回診或後續手術', label: '職災回診或後續手術' },
    { value: '職災心理創傷治療', label: '職災心理創傷治療' },
    { value: '其他職災醫療休養事由', label: '其他職災醫療休養事由' },
  ],
  MATERNITY: [
    { value: '分娩待產', label: '分娩待產' },
    { value: '產後休養', label: '產後休養' },
    { value: '醫囑安胎', label: '醫囑安胎' },
    { value: '其他', label: '其他' },
  ],
  BREASTFEEDING: [
    { value: '哺乳時間', label: '哺乳時間' },
    { value: '擠乳安排', label: '擠乳安排' },
    { value: '返回照護場所', label: '返回照護場所' },
    { value: '其他', label: '其他' },
  ],
  PATERNITY_CHECKUP: [
    { value: '陪同產檢', label: '陪同產檢' },
    { value: '陪產照護', label: '陪產照護' },
    { value: '新生兒照顧', label: '新生兒照顧' },
    { value: '其他', label: '其他' },
  ],
  MISCARRIAGE: [
    { value: '流產休養', label: '流產休養' },
    { value: '手術治療', label: '手術治療' },
    { value: '回診追蹤', label: '回診追蹤' },
    { value: '其他', label: '其他' },
  ],
  OFFICIAL: [
    { value: '公出洽公', label: '公出洽公' },
    { value: '教育訓練', label: '教育訓練' },
    { value: '公司指派任務', label: '公司指派任務' },
    { value: '政府機關辦理事項', label: '政府機關辦理事項' },
    { value: '其他', label: '其他' },
  ],
  MILITARY_SERVICE: [
    { value: '教召報到', label: '教召報到' },
    { value: '教召訓練', label: '教召訓練' },
    { value: '軍事勤務', label: '軍事勤務' },
    { value: '其他', label: '其他' },
  ],
};

export const LEAVE_TYPE_OPTIONS: LeaveTypeOption[] = ORDERED_LEAVE_TYPE_CODES.map((code) => ({
  value: code,
  label: LEAVE_TYPE_LABELS[code],
}));

export function normalizeLeaveTypeCode(leaveType?: string | null): string {
  if (!leaveType) {
    return '';
  }

  return LEAVE_TYPE_ALIASES[leaveType] ?? leaveType;
}

export function isAnnualLeaveType(leaveType?: string | null): boolean {
  return normalizeLeaveTypeCode(leaveType) === 'ANNUAL';
}

export function isBereavementLeaveType(leaveType?: string | null): boolean {
  return normalizeLeaveTypeCode(leaveType) === BEREAVEMENT_LEAVE_TYPE_CODE;
}

export function getLeaveTypeLabel(leaveType?: string | null): string {
  const normalizedLeaveType = normalizeLeaveTypeCode(leaveType);
  return LEAVE_TYPE_LABELS[normalizedLeaveType] ?? normalizedLeaveType;
}

export function getLeaveReasonOptions(leaveType?: string | null): LeaveReasonOption[] {
  const normalizedLeaveType = normalizeLeaveTypeCode(leaveType);
  return LEAVE_REASON_OPTIONS_BY_TYPE[normalizedLeaveType] ?? DEFAULT_LEAVE_REASON_OPTIONS;
}

export function isLeaveReasonOptionValid(leaveType: string | null | undefined, reason: string): boolean {
  return getLeaveReasonOptions(leaveType).some((option) => option.value === reason);
}

export function combineLeaveReason(selectedReason?: string | null, detail?: string | null): string {
  const trimmedReason = selectedReason?.trim() ?? '';
  const trimmedDetail = detail?.trim() ?? '';

  if (trimmedReason && trimmedDetail) {
    return `${trimmedReason}：${trimmedDetail}`;
  }

  return trimmedReason || trimmedDetail;
}

export function splitLeaveReason(
  combinedReason?: string | null,
  leaveType?: string | null
): { leaveReason: string; detail: string } {
  const rawReason = combinedReason?.trim() ?? '';
  if (!rawReason) {
    return { leaveReason: '', detail: '' };
  }

  for (const option of getLeaveReasonOptions(leaveType)) {
    if (rawReason === option.value) {
      return { leaveReason: option.value, detail: '' };
    }

    const prefix = `${option.value}：`;
    if (rawReason.startsWith(prefix)) {
      return {
        leaveReason: option.value,
        detail: rawReason.slice(prefix.length).trim(),
      };
    }
  }

  return { leaveReason: '', detail: rawReason };
}
