import {
  LEAVE_TYPE_OPTIONS,
  combineLeaveReason,
  getLeaveReasonOptions,
  normalizeLeaveTypeCode,
  splitLeaveReason,
} from '../leave-types';

describe('leave type helpers', () => {
  it('includes family care and menstrual leave in selectable options', () => {
    expect(LEAVE_TYPE_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'FAMILY_CARE', label: '家庭照顧假' },
        { value: 'MENSTRUAL', label: '生理假' },
      ])
    );
  });

  it('returns leave-type specific reason options', () => {
    expect(getLeaveReasonOptions('SICK').map((option) => option.value)).toEqual(
      expect.arrayContaining(['身體不適', '感冒發燒', '就醫治療'])
    );
    expect(getLeaveReasonOptions('PERSONAL').map((option) => option.value)).toEqual(
      expect.arrayContaining([
        '個人重要事故需親自處理',
        '子女或家屬臨時照顧',
        '政府機關或司法程序辦理'
      ])
    );
    expect(getLeaveReasonOptions('UNPAID_LEAVE').map((option) => option.value)).toEqual(
      expect.arrayContaining([
        '育嬰留職停薪',
        '家庭照顧或長期陪護',
        '其他經勞雇協議留職停薪事由'
      ])
    );
    expect(getLeaveReasonOptions('OCCUPATIONAL_INJURY').map((option) => option.value)).toEqual(
      expect.arrayContaining([
        '職業災害就醫治療',
        '職災回診或後續手術',
        '其他職災醫療休養事由'
      ])
    );
    expect(getLeaveReasonOptions('BEREAVEMENT').map((option) => option.value)).toEqual(
      expect.arrayContaining(['配偶', '父母', '配偶之父母', '繼父母', '兄弟姊妹'])
    );
    expect(getLeaveReasonOptions('OFFICIAL').map((option) => option.value)).toEqual(
      expect.arrayContaining(['公出洽公', '教育訓練'])
    );
  });

  it('normalizes legacy leave type aliases before reading reason options', () => {
    expect(normalizeLeaveTypeCode('ANNUAL_LEAVE')).toBe('ANNUAL');
    expect(getLeaveReasonOptions('ANNUAL_LEAVE').map((option) => option.value)).toContain('旅遊休假');
  });

  it('combines selected reasons with detail text', () => {
    expect(combineLeaveReason('家庭重要事故需親自處理', '需返家處理')).toBe('家庭重要事故需親自處理：需返家處理');
    expect(combineLeaveReason('', '純文字說明')).toBe('純文字說明');
  });

  it('splits stored reason strings using leave-type specific options', () => {
    expect(splitLeaveReason('照顧子女：孩子發燒需就醫', 'FAMILY_CARE')).toEqual({
      leaveReason: '照顧子女',
      detail: '孩子發燒需就醫',
    });
    expect(splitLeaveReason('配偶：治喪安排與告別式', 'BEREAVEMENT')).toEqual({
      leaveReason: '配偶',
      detail: '治喪安排與告別式',
    });
    expect(splitLeaveReason('舊資料自由輸入內容', 'FAMILY_CARE')).toEqual({
      leaveReason: '',
      detail: '舊資料自由輸入內容',
    });
  });
});
