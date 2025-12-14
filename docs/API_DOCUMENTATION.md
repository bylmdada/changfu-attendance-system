# 長福考勤系統 - API 文件

## API 概覽

**Base URL:** `https://your-domain.com/api`

所有 API 都需要認證，使用 JWT Token 或 Cookie 認證。

---

## 認證 API

### POST /api/auth/login
登入並取得認證 Token。

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "登入成功",
  "user": {
    "id": 1,
    "username": "string",
    "role": "ADMIN|HR|SUPERVISOR|EMPLOYEE",
    "employee": {
      "id": 1,
      "employeeId": "string",
      "name": "string"
    }
  }
}
```

### GET /api/auth/me
取得目前登入使用者資訊。

### POST /api/auth/logout
登出並清除 Session。

---

## 考勤 API

### GET /api/attendance/records
取得考勤記錄。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| year | number | 年份 |
| month | number | 月份 |
| employeeId | number | 員工 ID（可選）|

### POST /api/attendance/clock
打卡（上班/下班）。

**Request Body:**
```json
{
  "type": "CLOCK_IN|CLOCK_OUT",
  "latitude": 25.0478,
  "longitude": 121.5319,
  "accuracy": 10.5,
  "wifiSsid": "string (optional)"
}
```

### POST /api/attendance/verify-clock
驗證打卡資格（GPS、時間限制）。

---

## 請假 API

### GET /api/leave/requests
取得請假申請列表。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| status | string | PENDING/APPROVED/REJECTED |
| employeeId | number | 員工 ID |

### POST /api/leave/requests
建立請假申請。

**Request Body:**
```json
{
  "leaveType": "ANNUAL|SICK|PERSONAL|COMP_LEAVE",
  "startDate": "2024-12-01",
  "endDate": "2024-12-02",
  "totalDays": 2,
  "reason": "string"
}
```

### PUT /api/leave/requests/:id
審核請假申請。

**Request Body:**
```json
{
  "status": "APPROVED|REJECTED",
  "rejectReason": "string (if rejected)"
}
```

---

## 加班 API

### GET /api/overtime/requests
取得加班申請列表。

### POST /api/overtime/requests
建立加班申請。

**Request Body:**
```json
{
  "overtimeDate": "2024-12-01",
  "startTime": "18:00",
  "endTime": "21:00",
  "totalHours": 3,
  "reason": "string",
  "compensationType": "COMP_LEAVE|OVERTIME_PAY"
}
```

### PUT /api/overtime/requests/:id
審核加班申請。

---

## 員工 API

### GET /api/employees
取得員工列表。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| department | string | 部門篩選 |
| isActive | boolean | 是否在職 |
| page | number | 頁碼 |
| pageSize | number | 每頁筆數 |

### POST /api/employees
新增員工。

**Request Body:**
```json
{
  "employeeId": "string",
  "name": "string",
  "birthday": "1990-01-01",
  "phone": "string",
  "department": "string",
  "position": "string",
  "hireDate": "2024-01-01",
  "baseSalary": 50000,
  "hourlyRate": 208.33
}
```

### GET /api/employees/:id
取得單一員工資料。

### PUT /api/employees/:id
更新員工資料。

### DELETE /api/employees/:id
停用員工（軟刪除）。

---

## 系統設定 API

### GET /api/system-settings/gps-attendance
取得 GPS 打卡設定。

### POST /api/system-settings/gps-attendance
更新 GPS 打卡設定。

### GET /api/system-settings/clock-time-restriction
取得打卡時間限制設定。

### POST /api/system-settings/clock-time-restriction
更新打卡時間限制設定。

**Request Body:**
```json
{
  "enabled": true,
  "restrictedStartHour": 23,
  "restrictedEndHour": 5,
  "message": "夜間時段暫停打卡服務"
}
```

---

## 報表 API

### GET /api/reports/attendance
取得考勤報表資料。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| year | number | 年份 |
| month | number | 月份 |
| department | string | 部門篩選（可選）|

**Response:**
```json
{
  "success": true,
  "report": {
    "title": "2024年12月 考勤報表",
    "period": { "year": 2024, "month": 12, "workDays": 22 },
    "summary": {
      "totalEmployees": 50,
      "avgAttendanceRate": 95,
      "totalOvertimeHours": 150,
      "totalLeaveDays": 30
    },
    "employees": [...]
  }
}
```

---

## 儀表板 API

### GET /api/dashboard-stats
取得儀表板統計資料。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| year | number | 年份 |
| month | number | 月份 |

---

## 通知 API

### GET /api/notifications
取得使用者通知。

**Query Parameters:**
| 參數 | 類型 | 說明 |
|-----|------|------|
| unreadOnly | boolean | 僅未讀 |
| limit | number | 筆數限制 |

### POST /api/notifications
發送通知（管理員）。

### PUT /api/notifications
標記通知已讀。

---

## 錯誤回應格式

所有錯誤回應都遵循統一格式：

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "未授權訪問",
    "timestamp": "2024-12-12T12:00:00.000Z"
  }
}
```

### 錯誤代碼

| 代碼 | HTTP 狀態 | 說明 |
|-----|----------|------|
| UNAUTHORIZED | 401 | 未授權 |
| FORBIDDEN | 403 | 權限不足 |
| NOT_FOUND | 404 | 資源不存在 |
| BAD_REQUEST | 400 | 請求格式錯誤 |
| RATE_LIMIT_EXCEEDED | 429 | 請求過於頻繁 |
| INTERNAL_ERROR | 500 | 系統錯誤 |

---

## 安全機制

### CSRF 保護
POST/PUT/DELETE 請求需攜帶 CSRF Token：

```
X-CSRF-Token: <token>
```

Token 可從 `GET /api/csrf-token` 取得。

### Rate Limiting
每個 IP 每分鐘最多 100 次請求。

---

*最後更新：2024年12月*
