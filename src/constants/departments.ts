// 公司部門常數定義
export const DEPARTMENT_OPTIONS = [
  '溪北輔具中心',
  '礁溪失智據點',
  '羅東失智據點',
  '三星失智據點',
  '冬瓜山失智據點',
  '八寶日照中心',
  '蘇西日照中心',
  '經營管理部',
  '資訊部'
] as const;

// 部門對應職位定義
export const DEPARTMENT_POSITIONS = {
  '溪北輔具中心': [
    '主任',
    '社工員',
    '社工師',
    '輔具評估治療師',
    '物理治療師',
    '職能治療師',
    '聽力師',
    '行政人員',
    '輔具諮詢人員',
    '維修技術員'
  ],
  '礁溪失智據點': [
    '專員',
    '個案管理員',
    '社工員',
    '照服員',
    '護理師',
    '課程帶領員'
  ],
  '羅東失智據點': [
    '專員',
    '個案管理員',
    '社工員',
    '照服員',
    '護理師',
    '課程帶領員'
  ],
  '三星失智據點': [
    '專員',
    '個案管理員',
    '社工員',
    '照服員',
    '護理師',
    '課程帶領員'
  ],
  '冬瓜山失智據點': [
    '專員',
    '個案管理員',
    '社工員',
    '照服員',
    '護理師',
    '課程帶領員'
  ],
  '八寶日照中心': [
    '日照中心主任',
    '護理師',
    '照顧服務員',
    '社工員',
    '活動帶領員',
    '個案管理員',
    '行政人員',
    '儲備幹部',
    '團康老師'
  ],
  '蘇西日照中心': [
    '日照中心主任',
    '護理師',
    '照顧服務員',
    '社工員',
    '活動帶領員',
    '個案管理員',
    '行政人員',
    '儲備幹部',
    '團康老師'
  ],
  '經營管理部': [
    '總經理',
    '副總經理',
    '執行長',
    '副執行長',
    '主任',
    '副主任',
    '專案主任',
    '專案副主任',
    '資深專員',
    '專員',
    '助理',
    '顧問'
  ],
  '資訊部': [
    '資訊主任',
    '資訊副主任',
    '資訊資深專員',
    '資訊專員',
    '專員',
    '助理'
  ]
} as const;

// 部門類型
export type Department = typeof DEPARTMENT_OPTIONS[number];

// 職位類型
export type DepartmentPosition = typeof DEPARTMENT_POSITIONS[Department][number];

// 檢查是否為有效部門
export function isValidDepartment(department: string): department is Department {
  return DEPARTMENT_OPTIONS.includes(department as Department);
}

// 獲取所有部門選項
export function getDepartmentOptions() {
  return [...DEPARTMENT_OPTIONS];
}

// 獲取指定部門的職位選項
export function getPositionsByDepartment(department: Department): readonly string[] {
  return DEPARTMENT_POSITIONS[department] || [];
}

// 獲取所有職位選項（不重複）
export function getAllPositions(): string[] {
  const allPositions = new Set<string>();
  Object.values(DEPARTMENT_POSITIONS).forEach(positions => {
    positions.forEach(position => allPositions.add(position));
  });
  return Array.from(allPositions).sort();
}
