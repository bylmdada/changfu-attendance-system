import {
  CONDITION_ASSESSMENT_STATUS,
  DEFAULT_NORMAL_CONDITION_ITEMS,
  parseConditionAssessmentInput,
  parseJsonStringArray,
} from '@/lib/property-condition-assessment';

describe('property condition assessment', () => {
  it('normalizes no-abnormality assessments with checked normal items', () => {
    const result = parseConditionAssessmentInput({
      status: CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY,
      normalConditionItems: [...DEFAULT_NORMAL_CONDITION_ITEMS, '不允許項目'],
      abnormalConditionItems: ['輔具配件'],
      abnormalDescription: 'should be ignored',
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        conditionAssessmentStatus: 'NO_ABNORMALITY',
        maintenanceStatus: 'DONE',
        rawStatus: '無異常',
        normalConditionItems: DEFAULT_NORMAL_CONDITION_ITEMS,
        abnormalConditionItems: [],
        abnormalDescription: null,
      }),
    });
  });

  it('requires abnormal items and description when abnormality is selected', () => {
    expect(parseConditionAssessmentInput({
      status: CONDITION_ASSESSMENT_STATUS.ABNORMAL,
      abnormalConditionItems: [],
      abnormalDescription: '輪椅左側煞車鬆脫',
    })).toEqual({ ok: false, error: '請至少勾選一項財產異常狀態' });

    expect(parseConditionAssessmentInput({
      status: CONDITION_ASSESSMENT_STATUS.ABNORMAL,
      abnormalConditionItems: ['輔具零件'],
      abnormalDescription: '',
    })).toEqual({ ok: false, error: '請詳細說明財產異常處' });
  });

  it('normalizes abnormal assessments', () => {
    const result = parseConditionAssessmentInput({
      status: CONDITION_ASSESSMENT_STATUS.ABNORMAL,
      abnormalConditionItems: ['輔具配件', '輔具配件', '電子輔具元件', '不允許項目'],
      abnormalDescription: '輪椅左側煞車鬆脫',
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        conditionAssessmentStatus: 'ABNORMAL',
        maintenanceStatus: 'ABNORMAL',
        rawStatus: '有異常',
        normalConditionItems: [],
        abnormalConditionItems: ['輔具配件', '電子輔具元件'],
        abnormalDescription: '輪椅左側煞車鬆脫',
      }),
    });
  });

  it('parses stored JSON arrays defensively', () => {
    expect(parseJsonStringArray('["輔具配件完整"]')).toEqual(['輔具配件完整']);
    expect(parseJsonStringArray('{bad-json')).toEqual([]);
    expect(parseJsonStringArray(null)).toEqual([]);
  });
});
