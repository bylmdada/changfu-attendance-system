# 員工扶養眷屬人數設定與管理指南

## 文檔概述

本文檔詳細說明長富考勤系統中員工健保扶養眷屬人數的設定、管理、變更流程以及相關業務規則。系統支援靈活的眷屬管理功能，確保健保費計算的準確性和合規性。

**更新日期**: 2025年9月4日
**版本**: 2.0
**適用法規**: 台灣全民健康保險法第8-15條

## 眷屬定義與資格

### 法定眷屬範圍

根據全民健康保險法，可列為被保險人眷屬的對象包括：

#### 1. 配偶
- **條件**: 合法配偶且無職業或所得未達一定標準
- **證明文件**: 戶籍謄本、結婚證書
- **特殊情況**: 分居但未離婚者仍可申報

#### 2. 直系血親尊親屬
- **包括**: 父母、祖父母、外祖父母等
- **條件**: 無職業或所得未達一定標準
- **年齡限制**: 無特殊年齡限制

#### 3. 直系血親卑親屬
- **包括**: 子女、孫子女等
- **年齡限制**: 
  - 未滿20歲者
  - 20歲以上在學學生（最高至25歲）
  - 身心障礙無謀生能力者（無年齡限制）

#### 4. 其他特殊情況
- **收養關係**: 合法收養的子女
- **監護關係**: 法院指定監護的未成年人
- **同性配偶**: 依法登記的同性配偶

### 所得標準限制

眷屬必須符合以下所得標準之一：
- 無職業者
- 年所得未超過基本工資 × 12個月
- 在學學生（符合年齡條件）

## 系統中的眷屬管理

### 資料結構設計

#### 員工眷屬基本資訊
```typescript
interface EmployeeDependents {
  employeeId: number;
  dependentsCount: number;        // 申報眷屬總人數
  dependentsDetails: DependentInfo[]; // 眷屬詳細資訊
  effectiveDate: Date;           // 生效日期
  lastUpdated: Date;             // 最後更新時間
  updatedBy: string;             // 更新者
  isActive: boolean;             // 是否啟用
}

interface DependentInfo {
  id: string;                    // 眷屬識別碼
  name: string;                  // 姓名
  relationship: DependentRelationship; // 關係
  idNumber: string;              // 身分證字號
  birthDate: Date;               // 出生日期
  isStudent: boolean;            // 是否在學
  hasIncome: boolean;            // 是否有收入
  annualIncome?: number;         // 年收入
  documents: Document[];         // 證明文件
  startDate: Date;               // 投保開始日
  endDate?: Date;                // 投保結束日
  status: 'active' | 'inactive' | 'pending'; // 狀態
}

enum DependentRelationship {
  SPOUSE = 'spouse',             // 配偶
  CHILD = 'child',               // 子女
  PARENT = 'parent',             // 父母
  GRANDPARENT = 'grandparent',   // 祖父母
  GRANDCHILD = 'grandchild',     // 孫子女
  ADOPTED_CHILD = 'adopted_child', // 收養子女
  WARD = 'ward'                  // 監護對象
}
```

### 數據庫設計

#### 眷屬管理表結構

```sql
-- 員工健保眷屬主表
CREATE TABLE employee_health_dependents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  dependents_count INTEGER DEFAULT 0,
  effective_date DATETIME NOT NULL,
  end_date DATETIME,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  change_reason TEXT,
  
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_employee_effective (employee_id, effective_date)
);

-- 眷屬詳細資訊表
CREATE TABLE dependent_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dependent_record_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  id_number TEXT,
  birth_date DATETIME,
  is_student BOOLEAN DEFAULT 0,
  has_income BOOLEAN DEFAULT 0,
  annual_income REAL,
  start_date DATETIME NOT NULL,
  end_date DATETIME,
  status TEXT DEFAULT 'active',
  notes TEXT,
  
  FOREIGN KEY (dependent_record_id) REFERENCES employee_health_dependents(id)
);

-- 眷屬證明文件表
CREATE TABLE dependent_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dependent_id INTEGER NOT NULL,
  document_type TEXT NOT NULL, -- 戶籍謄本、學生證、所得證明等
  file_path TEXT,
  upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiry_date DATETIME,
  verified BOOLEAN DEFAULT 0,
  verified_by TEXT,
  verified_at DATETIME,
  
  FOREIGN KEY (dependent_id) REFERENCES dependent_details(id)
);
```

## 眷屬設定與變更流程

### 新員工眷屬設定

#### 1. 初始設定流程
```typescript
async function setupInitialDependents(
  employeeId: number,
  dependentsInfo: DependentInfo[],
  effectiveDate: Date = new Date()
): Promise<EmployeeDependents> {
  
  // 1. 驗證眷屬資格
  for (const dependent of dependentsInfo) {
    await validateDependentEligibility(dependent);
  }
  
  // 2. 檢查眷屬人數限制
  if (dependentsInfo.length > MAX_DEPENDENTS) {
    throw new Error(`眷屬人數不能超過 ${MAX_DEPENDENTS} 位`);
  }
  
  // 3. 建立眷屬記錄
  const dependentRecord = await prisma.employeeHealthDependents.create({
    data: {
      employeeId,
      dependentsCount: dependentsInfo.length,
      effectiveDate,
      isActive: true,
      updatedBy: getCurrentUser().id,
      changeReason: '新員工初始設定'
    }
  });
  
  // 4. 建立眷屬詳細資訊
  for (const dependent of dependentsInfo) {
    await prisma.dependentDetails.create({
      data: {
        dependentRecordId: dependentRecord.id,
        ...dependent,
        startDate: effectiveDate
      }
    });
  }
  
  // 5. 記錄變更日誌
  await logDependentsChange({
    employeeId,
    changeType: 'initial_setup',
    oldCount: 0,
    newCount: dependentsInfo.length,
    effectiveDate,
    operator: getCurrentUser().username
  });
  
  return dependentRecord;
}
```

#### 2. 眷屬資格驗證
```typescript
async function validateDependentEligibility(dependent: DependentInfo): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 年齡檢查
  const age = calculateAge(dependent.birthDate);
  
  switch (dependent.relationship) {
    case DependentRelationship.CHILD:
      if (age >= 20 && !dependent.isStudent) {
        errors.push('20歲以上子女必須為在學學生才能列為眷屬');
      }
      if (age > 25) {
        errors.push('子女年齡超過25歲，不符合眷屬資格');
      }
      break;
      
    case DependentRelationship.SPOUSE:
      if (dependent.hasIncome && dependent.annualIncome > INCOME_THRESHOLD) {
        warnings.push('配偶收入可能超過標準，請確認是否符合眷屬資格');
      }
      break;
      
    case DependentRelationship.PARENT:
    case DependentRelationship.GRANDPARENT:
      if (dependent.hasIncome && dependent.annualIncome > INCOME_THRESHOLD) {
        errors.push('直系尊親屬有收入者不得列為眷屬');
      }
      break;
  }
  
  // 證件檢查
  if (!dependent.idNumber || !isValidIdNumber(dependent.idNumber)) {
    errors.push('身分證字號格式不正確');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
```

### 眷屬資訊變更

#### 1. 新增眷屬
```typescript
async function addDependent(
  employeeId: number,
  newDependent: DependentInfo,
  effectiveDate: Date
): Promise<void> {
  
  // 1. 取得當前眷屬記錄
  const currentRecord = await getCurrentDependentsRecord(employeeId);
  
  // 2. 檢查人數限制
  if (currentRecord.dependentsCount >= MAX_DEPENDENTS) {
    throw new Error('眷屬人數已達上限，無法新增');
  }
  
  // 3. 驗證新眷屬資格
  await validateDependentEligibility(newDependent);
  
  // 4. 結束當前記錄
  await prisma.employeeHealthDependents.update({
    where: { id: currentRecord.id },
    data: {
      endDate: new Date(effectiveDate.getTime() - 1),
      isActive: false
    }
  });
  
  // 5. 建立新記錄
  const newRecord = await prisma.employeeHealthDependents.create({
    data: {
      employeeId,
      dependentsCount: currentRecord.dependentsCount + 1,
      effectiveDate,
      isActive: true,
      updatedBy: getCurrentUser().id,
      changeReason: `新增眷屬: ${newDependent.name}`
    }
  });
  
  // 6. 複製現有眷屬資訊
  await copyExistingDependents(currentRecord.id, newRecord.id);
  
  // 7. 新增新眷屬
  await prisma.dependentDetails.create({
    data: {
      dependentRecordId: newRecord.id,
      ...newDependent,
      startDate: effectiveDate
    }
  });
  
  // 8. 記錄變更
  await logDependentsChange({
    employeeId,
    changeType: 'add_dependent',
    oldCount: currentRecord.dependentsCount,
    newCount: currentRecord.dependentsCount + 1,
    effectiveDate,
    details: `新增眷屬: ${newDependent.name} (${newDependent.relationship})`
  });
}
```

#### 2. 移除眷屬
```typescript
async function removeDependent(
  employeeId: number,
  dependentId: string,
  effectiveDate: Date,
  reason: string
): Promise<void> {
  
  // 1. 取得當前眷屬記錄
  const currentRecord = await getCurrentDependentsRecord(employeeId);
  
  // 2. 找到要移除的眷屬
  const dependentToRemove = currentRecord.dependentsDetails.find(
    d => d.id === dependentId
  );
  
  if (!dependentToRemove) {
    throw new Error('找不到指定的眷屬記錄');
  }
  
  // 3. 結束當前記錄
  await prisma.employeeHealthDependents.update({
    where: { id: currentRecord.id },
    data: {
      endDate: new Date(effectiveDate.getTime() - 1),
      isActive: false
    }
  });
  
  // 4. 建立新記錄
  const newRecord = await prisma.employeeHealthDependents.create({
    data: {
      employeeId,
      dependentsCount: currentRecord.dependentsCount - 1,
      effectiveDate,
      isActive: true,
      updatedBy: getCurrentUser().id,
      changeReason: `移除眷屬: ${dependentToRemove.name} - ${reason}`
    }
  });
  
  // 5. 複製除了被移除眷屬外的其他眷屬
  const remainingDependents = currentRecord.dependentsDetails.filter(
    d => d.id !== dependentId
  );
  
  for (const dependent of remainingDependents) {
    await prisma.dependentDetails.create({
      data: {
        dependentRecordId: newRecord.id,
        ...dependent,
        startDate: dependent.startDate
      }
    });
  }
  
  // 6. 設定被移除眷屬的結束日期
  await prisma.dependentDetails.updateMany({
    where: {
      dependentRecordId: currentRecord.id,
      id: dependentId
    },
    data: {
      endDate: effectiveDate,
      status: 'inactive'
    }
  });
  
  // 7. 記錄變更
  await logDependentsChange({
    employeeId,
    changeType: 'remove_dependent',
    oldCount: currentRecord.dependentsCount,
    newCount: currentRecord.dependentsCount - 1,
    effectiveDate,
    details: `移除眷屬: ${dependentToRemove.name} - ${reason}`
  });
}
```

### 批量眷屬管理

#### 1. 批量更新眷屬人數
```typescript
async function batchUpdateDependents(
  updates: DependentsUpdate[],
  effectiveDate: Date
): Promise<BatchUpdateResult> {
  
  const results: UpdateResult[] = [];
  const errors: string[] = [];
  
  // 使用事務處理批量更新
  await prisma.$transaction(async (prisma) => {
    for (const update of updates) {
      try {
        // 驗證更新請求
        await validateDependentsUpdate(update);
        
        // 執行更新
        const result = await updateEmployeeDependents(
          update.employeeId,
          update.newDependentsCount,
          effectiveDate,
          update.reason
        );
        
        results.push({
          employeeId: update.employeeId,
          success: true,
          oldCount: result.oldCount,
          newCount: result.newCount
        });
        
      } catch (error) {
        errors.push(`員工 ${update.employeeId}: ${error.message}`);
        results.push({
          employeeId: update.employeeId,
          success: false,
          error: error.message
        });
      }
    }
  });
  
  return {
    totalProcessed: updates.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
    errors
  };
}
```

## API設計與使用

### RESTful API端點

#### 1. 眷屬資訊查詢
```typescript
// GET /api/employees/{employeeId}/dependents
interface GetDependentsResponse {
  success: boolean;
  data: {
    employeeId: number;
    currentDependentsCount: number;
    maxAllowedDependents: number;
    effectiveDate: Date;
    dependentsDetails: DependentInfo[];
    history: DependentsHistoryRecord[];
  };
}
```

#### 2. 新增/更新眷屬
```typescript
// POST /api/employees/{employeeId}/dependents
interface AddDependentRequest {
  dependent: DependentInfo;
  effectiveDate: Date;
  documents?: FileUpload[];
}

// PUT /api/employees/{employeeId}/dependents/{dependentId}
interface UpdateDependentRequest {
  updates: Partial<DependentInfo>;
  effectiveDate: Date;
  reason: string;
}
```

#### 3. 移除眷屬
```typescript
// DELETE /api/employees/{employeeId}/dependents/{dependentId}
interface RemoveDependentRequest {
  effectiveDate: Date;
  reason: string;
  transferInsurance?: boolean; // 是否轉移至其他投保單位
}
```

#### 4. 批量操作
```typescript
// POST /api/dependents/batch-update
interface BatchUpdateRequest {
  updates: DependentsUpdate[];
  effectiveDate: Date;
  notificationSettings?: {
    emailNotification: boolean;
    affectedEmployeesOnly: boolean;
  };
}
```

### 前端表單設計

#### 眷屬管理界面
```tsx
const DependentsManagementForm: React.FC<{employeeId: number}> = ({ employeeId }) => {
  const [dependents, setDependents] = useState<DependentInfo[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  
  return (
    <Card>
      <CardHeader>
        <Title>健保眷屬管理</Title>
        <Subtitle>
          目前眷屬人數: {dependents.length} / {MAX_DEPENDENTS}
        </Subtitle>
      </CardHeader>
      
      <CardContent>
        {/* 眷屬列表 */}
        <DependentsList 
          dependents={dependents}
          onEdit={handleEditDependent}
          onRemove={handleRemoveDependent}
        />
        
        {/* 新增眷屬按鈕 */}
        {dependents.length < MAX_DEPENDENTS && (
          <Button 
            onClick={() => setIsEditing(true)}
            variant="outline"
          >
            新增眷屬
          </Button>
        )}
        
        {/* 新增/編輯表單 */}
        {isEditing && (
          <DependentForm
            onSubmit={handleSubmitDependent}
            onCancel={() => setIsEditing(false)}
          />
        )}
        
        {/* 變更歷史 */}
        <DependentsHistory employeeId={employeeId} />
      </CardContent>
    </Card>
  );
};
```

#### 眷屬表單組件
```tsx
const DependentForm: React.FC<DependentFormProps> = ({ onSubmit, onCancel, initialData }) => {
  const form = useForm<DependentInfo>({
    defaultValues: initialData || {
      name: '',
      relationship: DependentRelationship.CHILD,
      idNumber: '',
      birthDate: new Date(),
      isStudent: false,
      hasIncome: false
    }
  });
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>姓名 *</FormLabel>
              <FormControl>
                <Input {...field} placeholder="請輸入眷屬姓名" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="relationship"
          render={({ field }) => (
            <FormItem>
              <FormLabel>關係 *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="請選擇關係" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={DependentRelationship.SPOUSE}>配偶</SelectItem>
                  <SelectItem value={DependentRelationship.CHILD}>子女</SelectItem>
                  <SelectItem value={DependentRelationship.PARENT}>父母</SelectItem>
                  <SelectItem value={DependentRelationship.GRANDPARENT}>祖父母</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* 其他欄位... */}
        
        <div className="flex gap-2">
          <Button type="submit">儲存</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        </div>
      </form>
    </Form>
  );
};
```

## 自動化與通知

### 自動檢查機制

#### 1. 眷屬資格定期檢查
```typescript
async function scheduleQualificationCheck(): Promise<void> {
  // 每月檢查一次眷屬資格
  cron.schedule('0 0 1 * *', async () => {
    console.log('開始進行眷屬資格定期檢查...');
    
    const expiredDependents = await findExpiredDependents();
    const agingOutDependents = await findAgingOutDependents();
    const incomeExceededDependents = await findIncomeExceededDependents();
    
    // 發送通知
    await notifyHRDepartment({
      expiredDependents,
      agingOutDependents,
      incomeExceededDependents
    });
    
    // 生成報告
    await generateQualificationReport({
      checkDate: new Date(),
      findings: {
        expired: expiredDependents.length,
        agingOut: agingOutDependents.length,
        incomeExceeded: incomeExceededDependents.length
      }
    });
  });
}

// 查找即將年滿20歲的子女眷屬
async function findAgingOutDependents(): Promise<AgingOutDependent[]> {
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
  
  return await prisma.dependentDetails.findMany({
    where: {
      relationship: DependentRelationship.CHILD,
      status: 'active',
      birthDate: {
        lte: new Date(threeMonthsFromNow.getFullYear() - 20, threeMonthsFromNow.getMonth(), threeMonthsFromNow.getDate())
      }
    },
    include: {
      dependentRecord: {
        include: {
          employee: true
        }
      }
    }
  });
}
```

#### 2. 學生身分驗證提醒
```typescript
async function scheduleStudentVerification(): Promise<void> {
  // 每年9月提醒更新學生證
  cron.schedule('0 0 1 9 *', async () => {
    const students = await prisma.dependentDetails.findMany({
      where: {
        isStudent: true,
        status: 'active',
        relationship: DependentRelationship.CHILD
      },
      include: {
        dependentRecord: {
          include: {
            employee: true
          }
        }
      }
    });
    
    for (const student of students) {
      await sendStudentVerificationReminder({
        employee: student.dependentRecord.employee,
        dependent: student,
        dueDate: new Date(new Date().getFullYear(), 10, 30) // 11月30日前
      });
    }
  });
}
```

### 通知系統

#### 1. 變更通知模板
```typescript
interface NotificationTemplates {
  dependentAdded: {
    subject: '眷屬投保通知';
    template: `
      親愛的 {{ employeeName }}：
      
      您已成功為 {{ dependentName }} ({{ relationship }}) 申請健保眷屬投保。
      
      生效日期：{{ effectiveDate }}
      新的健保費：{{ newPremium }} 元/月
      
      如有任何問題，請聯繫人事部門。
    `;
  };
  
  dependentRemoved: {
    subject: '眷屬退保通知';
    template: `
      親愛的 {{ employeeName }}：
      
      {{ dependentName }} ({{ relationship }}) 的健保眷屬資格已於 {{ effectiveDate }} 終止。
      
      調整後健保費：{{ newPremium }} 元/月
      節省金額：{{ savedAmount }} 元/月
      
      請確認是否需要為該眷屬另外投保。
    `;
  };
  
  qualificationExpiring: {
    subject: '眷屬資格即將到期提醒';
    template: `
      親愛的 {{ employeeName }}：
      
      {{ dependentName }} ({{ relationship }}) 的眷屬資格將於 {{ expiryDate }} 到期。
      
      到期原因：{{ reason }}
      
      請於到期前提供相關證明文件以維持眷屬資格，或辦理退保手續。
    `;
  };
}
```

#### 2. 通知發送邏輯
```typescript
async function sendDependentNotification(
  type: keyof NotificationTemplates,
  employeeId: number,
  data: NotificationData
): Promise<void> {
  
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true }
  });
  
  if (!employee || !employee.user) {
    throw new Error('員工資料不完整，無法發送通知');
  }
  
  const template = NotificationTemplates[type];
  const content = compileTemplate(template.template, {
    employeeName: employee.name,
    ...data
  });
  
  // 發送郵件通知
  await sendEmail({
    to: employee.user.email,
    subject: template.subject,
    content,
    category: 'dependent_management'
  });
  
  // 記錄通知歷史
  await prisma.notificationHistory.create({
    data: {
      employeeId,
      type,
      subject: template.subject,
      content,
      sentAt: new Date(),
      status: 'sent'
    }
  });
}
```

## 報表與統計

### 眷屬統計報表

#### 1. 眷屬人數分佈統計
```typescript
async function generateDependentsDistributionReport(
  startDate: Date,
  endDate: Date
): Promise<DependentsDistributionReport> {
  
  const distribution = await prisma.$queryRaw`
    SELECT 
      dependents_count,
      COUNT(*) as employee_count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
    FROM employee_health_dependents 
    WHERE effective_date <= ${endDate}
      AND (end_date IS NULL OR end_date >= ${startDate})
      AND is_active = 1
    GROUP BY dependents_count
    ORDER BY dependents_count
  `;
  
  const totalEmployees = distribution.reduce((sum, item) => sum + item.employee_count, 0);
  const averageDependents = distribution.reduce(
    (sum, item) => sum + (item.dependents_count * item.employee_count), 0
  ) / totalEmployees;
  
  return {
    reportPeriod: { startDate, endDate },
    distribution,
    summary: {
      totalEmployees,
      averageDependents: Math.round(averageDependents * 100) / 100,
      maxDependents: Math.max(...distribution.map(d => d.dependents_count)),
      employeesWithDependents: distribution
        .filter(d => d.dependents_count > 0)
        .reduce((sum, item) => sum + item.employee_count, 0)
    }
  };
}
```

#### 2. 眷屬變更趨勢分析
```typescript
async function generateDependentsChangesTrendReport(
  months: number = 12
): Promise<ChangesTrendReport> {
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const monthlyChanges = await prisma.$queryRaw`
    SELECT 
      strftime('%Y-%m', effective_date) as month,
      SUM(CASE WHEN change_type = 'add_dependent' THEN 1 ELSE 0 END) as additions,
      SUM(CASE WHEN change_type = 'remove_dependent' THEN 1 ELSE 0 END) as removals,
      COUNT(*) as total_changes
    FROM dependents_change_log
    WHERE effective_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY strftime('%Y-%m', effective_date)
    ORDER BY month
  `;
  
  return {
    reportPeriod: { startDate, endDate },
    monthlyChanges,
    summary: {
      totalAdditions: monthlyChanges.reduce((sum, m) => sum + m.additions, 0),
      totalRemovals: monthlyChanges.reduce((sum, m) => sum + m.removals, 0),
      netChange: monthlyChanges.reduce((sum, m) => sum + (m.additions - m.removals), 0),
      averageChangesPerMonth: monthlyChanges.reduce((sum, m) => sum + m.total_changes, 0) / monthlyChanges.length
    }
  };
}
```

#### 3. 健保費影響分析
```typescript
async function generateHealthInsuranceImpactReport(
  changeDate: Date
): Promise<HealthInsuranceImpactReport> {
  
  // 計算變更前後的健保費差異
  const impactData = await prisma.$queryRaw`
    SELECT 
      e.id as employee_id,
      e.name as employee_name,
      e.base_salary,
      old_dep.dependents_count as old_dependents,
      new_dep.dependents_count as new_dependents,
      (new_dep.dependents_count - old_dep.dependents_count) as dependents_change
    FROM employees e
    LEFT JOIN employee_health_dependents old_dep ON e.id = old_dep.employee_id 
      AND old_dep.end_date = ${new Date(changeDate.getTime() - 1)}
    LEFT JOIN employee_health_dependents new_dep ON e.id = new_dep.employee_id 
      AND new_dep.effective_date = ${changeDate}
    WHERE old_dep.dependents_count != new_dep.dependents_count
      OR (old_dep.dependents_count IS NULL AND new_dep.dependents_count IS NOT NULL)
      OR (old_dep.dependents_count IS NOT NULL AND new_dep.dependents_count IS NULL)
  `;
  
  const calculations = impactData.map(employee => {
    const oldPremium = calculateHealthInsurance(
      employee.base_salary, 
      employee.old_dependents || 0
    );
    const newPremium = calculateHealthInsurance(
      employee.base_salary, 
      employee.new_dependents || 0
    );
    
    return {
      ...employee,
      oldPremium: oldPremium.totalPremium,
      newPremium: newPremium.totalPremium,
      premiumChange: newPremium.totalPremium - oldPremium.totalPremium
    };
  });
  
  return {
    changeDate,
    affectedEmployees: calculations.length,
    totalPremiumIncrease: calculations
      .filter(c => c.premiumChange > 0)
      .reduce((sum, c) => sum + c.premiumChange, 0),
    totalPremiumDecrease: calculations
      .filter(c => c.premiumChange < 0)
      .reduce((sum, c) => sum + Math.abs(c.premiumChange), 0),
    details: calculations
  };
}
```

## 合規性與稽核

### 法規遵循檢查

#### 1. 眷屬資格合規性檢查
```typescript
async function performComplianceAudit(): Promise<ComplianceAuditReport> {
  const issues: ComplianceIssue[] = [];
  
  // 檢查超齡子女
  const overAgeChildren = await prisma.dependentDetails.findMany({
    where: {
      relationship: DependentRelationship.CHILD,
      status: 'active',
      isStudent: false,
      birthDate: {
        lte: new Date(new Date().getFullYear() - 20, new Date().getMonth(), new Date().getDate())
      }
    }
  });
  
  for (const child of overAgeChildren) {
    issues.push({
      type: 'over_age_dependent',
      severity: 'high',
      employeeId: child.dependentRecord.employeeId,
      dependentId: child.id,
      description: `${child.name} 已超過20歲且非在學學生，不符合眷屬資格`,
      recommendation: '請辦理退保或提供在學證明'
    });
  }
  
  // 檢查未提供證明文件的眷屬
  const missingDocuments = await prisma.dependentDetails.findMany({
    where: {
      status: 'active',
      documents: {
        none: {}
      }
    }
  });
  
  for (const dependent of missingDocuments) {
    issues.push({
      type: 'missing_documents',
      severity: 'medium',
      employeeId: dependent.dependentRecord.employeeId,
      dependentId: dependent.id,
      description: `${dependent.name} 缺少相關證明文件`,
      recommendation: '請補齊戶籍謄本或相關證明文件'
    });
  }
  
  return {
    auditDate: new Date(),
    totalIssues: issues.length,
    highSeverityIssues: issues.filter(i => i.severity === 'high').length,
    issues,
    complianceScore: Math.max(0, 100 - (issues.length * 5)) // 每個問題扣5分
  };
}
```

#### 2. 定期稽核排程
```typescript
// 每季進行一次合規性檢查
cron.schedule('0 0 1 */3 *', async () => {
  console.log('開始進行季度合規性稽核...');
  
  const auditReport = await performComplianceAudit();
  
  // 發送稽核報告給管理層
  await sendAuditReport(auditReport);
  
  // 如果有高風險問題，立即通知
  const highRiskIssues = auditReport.issues.filter(i => i.severity === 'high');
  if (highRiskIssues.length > 0) {
    await sendUrgentComplianceNotification(highRiskIssues);
  }
  
  // 儲存稽核記錄
  await prisma.complianceAuditRecord.create({
    data: {
      auditDate: auditReport.auditDate,
      totalIssues: auditReport.totalIssues,
      complianceScore: auditReport.complianceScore,
      issues: JSON.stringify(auditReport.issues),
      status: 'completed'
    }
  });
});
```

## 最佳實踐建議

### 操作建議

1. **及時更新**
   - 員工應在眷屬狀況改變後30天內通知人事部門
   - 人事部門應在收到通知後7個工作日內完成變更
   - 所有變更都應有完整的文件證明

2. **定期檢查**
   - 每年至少進行一次眷屬資格全面檢查
   - 每季檢查即將年滿20歲的子女眷屬
   - 每月檢查證明文件到期情況

3. **文件管理**
   - 建立完整的眷屬證明文件檔案
   - 設定文件到期提醒機制
   - 定期更新和驗證文件真實性

### 系統設計建議

1. **用戶體驗**
   - 提供直觀的眷屬管理界面
   - 實施自動驗證和提醒功能
   - 支援批量操作和匯出功能

2. **數據完整性**
   - 實施嚴格的資料驗證規則
   - 建立完整的變更歷史記錄
   - 提供數據恢復和回滾功能

3. **安全性**
   - 敏感資料加密存儲
   - 實施細粒度的權限控制
   - 完整的操作審計記錄

---

*本指南涵蓋了員工健保扶養眷屬人數的完整管理流程，從設定、變更到監控都有詳細說明。建議根據公司實際情況調整相關流程和規則。*

**文檔維護**:
- **版本**: 2.0
- **最後更新**: 2025年9月4日
- **維護負責人**: 人事管理系統團隊
- **審核週期**: 每季度
