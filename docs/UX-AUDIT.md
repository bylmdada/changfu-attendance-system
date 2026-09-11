# UX 逐畫面優化盤點(系統功能 + 系統設定)

長福會考勤系統(Next.js,`src/app`)。本文件**逐畫面**列出「畫面 UI」與「操作」上需改善/優化的項目,供後續挑選實作。

**驗證說明**:標 *(已驗證)* 者經實際讀碼/grep 確認;標 *(觀察)* 者來自探索,實作前建議再開畫面確認。已剔除探索誤判:批次審批列**有** loading(`BatchApproveBar.tsx:152`)、請假/補打卡**有**分頁 UI(`leave-management:1785`、`missed-clock:1053`)。

---

## 〇、跨畫面共通問題(影響最大,先讀)

以下為全站量化現況,幾乎每個畫面都受影響:

1. **回饋機制混用** *(已驗證)*:**34 個畫面/元件**用瀏覽器原生 `alert()`/`confirm()`/`window.prompt()`,同時 **35 個**檔案已用 Toast。兩套並存、風格割裂、原生對話框阻塞 UI 且無法統一樣式。
   → 建議:統一收斂到既有 Toast + 一個共用 `ConfirmDialog` 元件。
2. **Loading 佔位稀少** *(已驗證)*:全站僅 **13 檔**用 skeleton/animate-pulse,多數列表頁載入只有 spinner 或無提示 → 版面跳動、感知延遲高。
3. **無障礙薄弱** *(已驗證)*:僅 **8 檔**含 `aria-label`;大量圖示按鈕無文字標籤,狀態多僅以顏色區分。
4. **危險操作確認不足**:批次審批/刪除、員工停用/刪除等不可逆動作多無「操作前」確認,或用原生 confirm 帶過。
5. **行動版表格溢出**:多處 8–9 欄寬表格在手機需橫向滑動,操作鈕文字過長。

---

## 一、系統功能畫面

### 打卡 `/attendance` ([attendance/page.tsx](../src/app/attendance/page.tsx))
- GPS 檢查進度條無**超時提示**,卡住時使用者不知所措;定位被拒時缺恢復指引 *(觀察)*。
- WiFi 選擇流程複雜、提示簡略 *(觀察)*。
- 提早/延後打卡的「原因→加班申請」多步對話框邏輯重,使用者不解為何要填加班;「跳過」鈕易誤點 *(觀察)*。
- 與排班時間偏離時的原因對話框與 `login` 快速打卡重複實作,缺共用元件。

### 快速打卡(登入頁) `/login` ([login/page.tsx](../src/app/login/page.tsx))
- 同上的提早/延後對話框問題 *(觀察)*。
- 表單為 Tab 切換(登入 / 快速打卡),行動裝置上右側品牌區佔比過大。

### 我的班表 `/my-schedule` ([my-schedule/page.tsx](../src/app/my-schedule/page.tsx))
- 載入無 skeleton;無班表時缺 empty state *(觀察)*。
- 月曆與班型表格資訊密,行動版可讀性待加強。
- 班表確認/取消確認的回饋不明顯。

### 請假管理 `/leave-management` ([leave-management/page.tsx](../src/app/leave-management/page.tsx))
- 已有篩選、排序 *(已驗證 :485)*、分頁 *(已驗證 :1785)*,但分頁僅上/下頁,無跳頁、無每頁筆數。
- 表單驗證僅在送出時以 Toast 提示,無即時欄位高亮;必填欄位無視覺標示(紅 *)*(觀察)*。
- 長表單無草稿持久化,重新整理即遺失 *(觀察)*。
- 首次無資料的 empty state 薄弱。

### 加班管理 `/overtime-management` ([overtime-management/page.tsx](../src/app/overtime-management/page.tsx))
- 無伺服器端搜尋,僅前端 filter *(觀察)*。
- 「其他」理由為必填時無視覺強調 *(觀察)*。

### 調班管理 `/shift-exchange` ([shift-exchange/page.tsx](../src/app/shift-exchange/page.tsx))
- 用原生對話框 *(已驗證:在原生對話框檔案清單內)*。
- 申請清單缺排序/匯出 *(觀察)*。

### 補打卡 `/missed-clock` ([missed-clock/page.tsx](../src/app/missed-clock/page.tsx))
- 已有分頁 *(已驗證 :1053)*。
- 再次密碼驗證對話框與打卡頁重複,缺共用元件 *(觀察)*。

### 薪資查詢/管理 `/payroll` ([payroll/page.tsx](../src/app/payroll/page.tsx))
- 建立/錯誤/匯出失敗全用 `alert()` *(已驗證 :316,327,420)*;密碼提示用 `confirm()` *(已驗證 :437)*。
- 批量刪除無操作前確認 modal *(觀察)*。
- 操作按鈕(HTML 薪資條/列印/刪除)無 `aria-label`,行動版文字過長換行 *(觀察)*。
- 匯出無進度提示;HTML 薪資條開新視窗,被瀏覽器擋彈窗時降級為下載,使用者無明確提示。

### 我的特休 `/my-annual-leave` / 我的補休 `/my-comp-leave`
- 列表載入無 skeleton;餘額/待審/待發生分區資訊密集,行動版可讀性待加強 *(觀察)*。

### 公告 `/announcements` ([announcements/page.tsx](../src/app/announcements/page.tsx))
- 用原生對話框 *(已驗證)*。
- 無公告時 empty state 不明確;優先級/類別僅以顏色區分(a11y)*(觀察)*。

### 個人設定 `/personal-settings` ([personal-settings/page.tsx](../src/app/personal-settings/page.tsx))
- 刪除生物辨識裝置用原生 `confirm()` *(已驗證)*,應改 ConfirmDialog。

### 密碼管理 `/password-management`
- 用原生對話框 *(已驗證)*。

### 主儀表板 `/dashboard` ([dashboard/page.tsx](../src/app/dashboard/page.tsx))
- 多支統計 API **序列 fetch**(瀑布),可改 `Promise.all` 併發 *(觀察)*。
- 統計卡片載入無佔位符。

### 員工管理 `/employees` ([employees/page.tsx](../src/app/employees/page.tsx))(ADMIN/HR)
- 停用/刪除用 `window.prompt()` 二次確認(高風險操作)*(已驗證:在原生對話框清單內)* → 改 ConfirmDialog 並顯示影響範圍。
- 狀態變更後無 optimistic UI,需等 API 回應 *(觀察)*。
- 分頁僅上/下頁,無跳頁輸入 *(觀察)*;批量匯入 modal 無進度條/錯誤明細。

### 出勤紀錄 `/attendance/records` ([attendance/records/page.tsx](../src/app/attendance/records/page.tsx))(ADMIN/HR)
- 匯出(PDF/CSV/Excel)無進度提示 *(觀察)*。
- 排序在前端,大資料量效能差;無篩選結果時無 empty state *(觀察)*。
- 統計摘要前端計算,易與後端不一致。

### 特休假管理 `/annual-leaves` ([annual-leaves/page.tsx](../src/app/annual-leaves/page.tsx))(ADMIN)
- 用原生對話框 *(已驗證)*。
- Excel 匯入錯誤僅顯示前 3 筆,無完整錯誤日誌下載;檔案僅驗副檔名、無大小限制 *(觀察)*。
- 表格無排序、無分頁 *(觀察)*。

### 其他管理列表(共通)
`comp-leave-management`、`salary-transfer`、`bonus-management`、`pro-rated-bonus`、`payroll-statistics`、`reports`、`disaster-day-off`、`schedule-management`、`schedule-management/weekly-templates`、`payroll-disputes`、`pension-contribution` —— **皆在原生對話框清單內** *(已驗證)*,並普遍缺 skeleton/empty state。建議納入第一波「Toast/ConfirmDialog 統一」。

### 批次審批列(共用元件)([BatchApproveBar.tsx](../src/components/BatchApproveBar.tsx))
- 批准/拒絕**無操作前確認**,點下即不可逆 *(已驗證 :66-122)*。
- 結果以 `alert()` 呈現 *(已驗證 :98,102,114)*;失敗項雖回填選取,但無清楚的失敗原因列表。
- 拒絕原因輸入框固定 `w-64`,長文字超出 *(已驗證 :147)*。
- (註:loading 狀態**已具備**,disabled + spinner。)

---

## 二、系統設定畫面(共 31 個子畫面 *(已驗證)*)

### 設定首頁 `/system-settings` ([system-settings/page.tsx](../src/app/system-settings/page.tsx))
- 31 個模組卡片平鋪,**無搜尋、無分類錨點導航** → 找特定設定需大量滾動 *(觀察)*。
- 進子畫面後缺一致的「返回設定首頁」麵包屑 *(觀察)*。

### 已詳查畫面

**考勤凍結 `/attendance-freeze`** *(觀察)*
- 成功訊息不自動消失,需手動刷新才知是否生效;修改即生效但無二次確認;參數無建議值說明。

**班別設定 `/shift-definitions`**(原生對話框 *(已驗證)*)
- 編輯時班別代碼禁用但未說明原因;編輯 Modal 欄位過多、小屏需捲動易漏填;工時自動計算過程不透明;`sortOrder` 無單位/說明;排序等欄位無法在列表內直接改。

**GPS 打卡 `/gps-attendance`**(原生對話框 *(已驗證)*)
- 儲存成功/失敗用 `alert()`;權限頁員工選擇器交互複雜;「獲取當前位置」依賴瀏覽器授權,失敗體驗差;位置/權限表 9 欄手機橫滑;有批量啟用/停用但無批量刪除。

**審核流程 `/approval-workflows`**(原生對話框 *(已驗證)*)
- 表格 cell 內 inline 編輯,無 Enter/Esc、需點外部按鈕才存,易誤以為已存;代理人內嵌表單儲存點不明;「常態代理(日期留空)」說明字太小;逾期統計卡片是即時或定時更新不明。

**部門職位 `/department-positions`**
- 刪除前用 JS `confirm()`;`sortOrder` 未暴露,無法直接調排序;搜尋只比對部門名稱,不含職位;部門展開/折疊狀態無持久化,刷新即重置。

**考勤權限 `/attendance-permissions`**(原生對話框 *(已驗證)*)
- 部門複選清單過長、無搜尋/過濾;權限以多行顯示佔空間;無「全部門」或「複製他人權限」快速選項;表頭「權限」命名模糊。

**假別規則 `/leave-rules-config`** *(觀察)*
- 提示「使用預設值」但無一鍵「重置為預設」;欄位說明長導致卡片高度不均;2 欄網格平板上擁擠;未列出系統支援的全部假別。

**通知設定 `/notification-config`** *(觀察)*
- 即時保存無視覺回饋(無 loading/成功動畫);依賴 SMTP 但無快速連結到 SMTP 設定;「提前 N 天提醒」語意不清;無寄送測試通知功能。

**郵件通知 `/email-notification`** *(觀察)*
- 主開關與子開關關係不夠明確;SMTP 狀態僅前端檢查欄位是否存在、無真正連線驗證;即時保存無確認。

**加班費計算 `/overtime-calculation`** *(觀察)*
- 欄位顯示技術名(如 weekdayFirstTwoHoursRate)、難懂;倍率無單位(1.34 倍 vs 134%);補償模式選項缺說明;無「示例計算」可驗證設定。

**密碼政策 `/password-policy`**(原生對話框 *(已驗證)*)
- 單頁 30+ 配置項,難一次消化(建議分區/分步);密碼測試工具混在設定頁,宜獨立;例外有效期、自訂封鎖密碼清單的輸入方式不明;各項缺建議值。

**獎金配置 `/bonus-config`** *(觀察)*
- 獎金類型(YEAR_END / FESTIVAL)邏輯缺說明;部門覆蓋設定複雜、開啟時無預設值說明;計算法(MONTHLY / DAILY)無詳述。

### 其餘設定畫面(共通建議)
以下畫面本盤點未逐一深入,但套用上方〇與設定首頁的共通問題(回饋一致性、儲存反饋、行動版、欄位說明):
`2fa`、`approval-delegates`(原生對話框)、`attendance-salary-deduction`、`bank-accounts`、`bonus-management`(原生對話框)、`clock-reason-prompt`、`clock-time-restriction`、`health-insurance-formula`、`holidays`(原生對話框)、`income-tax-management`、`labor-law-config`、`login-logs`、`payslip-email`、`payslip-management`、`property-management`、`push-notifications`、`schedule-confirm`、`smtp`、`supplementary-premium`。
- 其中 `holidays`、`approval-delegates`、`bonus-management` *(已驗證在原生對話框清單)* → 納入第一波 Toast/ConfirmDialog 統一。
- `smtp`、`labor-law-config`、`health-insurance-formula`、`supplementary-premium`、`income-tax-management` 多為參數表單,重點在欄位中文化、單位、建議值與儲存回饋。

---

## 三、優先順序(依影響程度)

- **P0**:跨畫面〇-1(34 檔原生對話框→Toast/ConfirmDialog 統一)、〇-4(批次/刪除操作前確認)、員工停用刪除確認。
- **P1**:設定首頁搜尋/分類導航、列表 skeleton、empty state 統一、行動版表格、設定頁 inline 編輯與即時儲存回饋。
- **P2**:分頁加跳頁/每頁筆數、加班/調班/年假排序與匯出、設定欄位術語/單位/建議值、假別規則重置鍵、a11y(aria-label/非純色狀態)、請假表單草稿、dashboard 併發 fetch。

---

## 四、驗證/實作時的查核法
1. 原生對話框清單:`grep -rln "alert(\|confirm(\|window.prompt(" src/app src/components`(目前 34 個非測試檔)。
2. 設定子畫面:`ls -1d src/app/system-settings/*/`(31 個)。
3. 改動後 `npm run dev` 以 ADMIN 逐頁開啟、DevTools 行動視窗檢視;`npm test` 確認 API 不回歸。
