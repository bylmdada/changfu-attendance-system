# 續租 DigitalOcean VPS 費用分析中文說明檔

最後更新：2026-06-16

本文件分析目前長福會考勤系統續租 DigitalOcean VPS 的費用。重點情境是：目前使用 GitHub Student Developer Pack 提供的 DigitalOcean credits，但 DigitalOcean 將結束參與 GitHub Student Developer Pack，透過該方案提供的 credits 會在 **2026-07-31** 到期。

> 重要：DigitalOcean 單價、稅金、credit 規則可能調整。正式續租前，請以 DigitalOcean Console 的 Billing、Usage、Droplet plan 頁面為準。

## 1. 目前專案與 VPS 狀態

目前長福會考勤系統部署方式：

| 項目 | 目前狀態 |
|---|---|
| 部署平台 | DigitalOcean Droplet / VPS |
| 部署方式 | Ubuntu + nvm Node.js + PM2 + Nginx |
| Node.js | `20.19.6` |
| App port | `3000`，由 Nginx 反向代理 |
| Database | SQLite `prisma/prod.db` |
| 專案規模 | 約 40 人內部考勤、班表、薪資、保險、報表系統 |
| 目前文件建議 Droplet | Basic `1GB RAM / 1 vCPU / 25GB SSD` |
| Region | Singapore `SGP1` |

40 人專案的負載特性：

| 模組 | 負載特性 | 對 VPS 的影響 |
|---|---|---|
| 上下班打卡 | 40 人在上下班時間集中使用 | API 瞬間請求增加，但總量不高 |
| 班表/月曆 | 管理員查詢、編輯與月曆渲染 | CPU 與 SQLite 查詢較多 |
| 考勤記錄 | 月份、年份、部門、員工篩選 | 查詢與前端資料渲染 |
| 薪資計算 | 月底、薪資日、年終時批次操作 | CPU、記憶體與 SQLite I/O 較明顯 |
| PDF / CSV / Excel 匯出 | 管理員偶發使用 | 匯出時會吃 CPU 與記憶體 |
| 備份 | SQLite 與 uploads 備份 | 需要穩定磁碟空間與備份策略 |

結論：

- `1GB RAM / 1 vCPU` 可以維持低成本運行，但 Next.js runtime、PDF 匯出、薪資計算、PM2、Nginx 同時存在時，記憶體餘裕偏緊。
- 若繼續使用 DigitalOcean 作為正式站，建議至少評估升到 `2GB RAM / 1 vCPU`。
- 若要更穩、降低月底薪資與匯出時的風險，`4GB RAM / 2 vCPU` 是更舒服的正式站規格，但成本會明顯上升。

## 2. GitHub Student credits 到期影響

使用者補充資訊：

```text
DigitalOcean is winding down participation in the GitHub Student Developer Pack,
and all credits provided through the pack will expire on July 31, 2026.
```

影響判斷：

- 2026-07-31 前，若帳戶仍有可用 credits，DigitalOcean usage 會優先抵扣 credits。
- 2026-07-31 後，GitHub Student Pack 來源的剩餘 credits 會失效，之後 VPS、備份、snapshot、額外流量等資源會開始由帳戶付款方式支付。
- DigitalOcean 官方文件說 Droplet 建立後即開始計費，關機仍會計費，因為資源仍保留在 hypervisor；要停止計費必須 destroy Droplet。
- DigitalOcean 通常在每月第一天針對前一個月 usage 開立帳單並向主要付款方式收費。

實務時間線：

| 日期 | 判斷 |
|---|---|
| 2026-06-16 到 2026-07-31 | 還可以使用剩餘學生 credits 抵扣，但要確認 Console 顯示的 credit balance 與 expiration |
| 2026-08-01 起 | 應假設 DigitalOcean 開始以一般付費帳戶計算 |
| 2026-09-01 左右 | 可能收到 2026-08 usage 的第一筆完整月費帳單 |

## 3. DigitalOcean 官方計費重點

依 DigitalOcean 官方 Droplet pricing / docs，目前與本專案最相關的計費規則：

| 項目 | 官方資訊 | 對本專案的意思 |
|---|---|---|
| Basic 512MB / 1 vCPU / 10GB | US$4/月 | 不建議，記憶體太小 |
| Basic 1GB / 1 vCPU / 25GB | US$6/月 | 目前低成本方案 |
| Basic 2GB / 1 vCPU / 50GB | US$12/月 | 40 人正式站較合理的低成本方案 |
| Basic 2GB / 2 vCPU / 60GB | US$18/月 | CPU 多一些，適合匯出/報表較多 |
| Basic 4GB / 2 vCPU / 80GB | US$24/月 | 40 人正式站較穩方案 |
| Weekly Backups | Droplet 成本 20% | `US$6` Droplet 的週備份約 `US$1.20/月` |
| Daily Backups | Droplet 成本 30% | `US$6` Droplet 的日備份約 `US$1.80/月` |
| Snapshots | US$0.06/GB/月 | 手動快照會另外計費 |
| Bandwidth | 每個 Droplet 有免費 outbound transfer，超額 US$0.01/GiB | 40 人內部系統通常不會超額 |
| 關機 | Powered off 仍計費 | 不用的 Droplet 要 destroy，不是只關機 |

## 4. 續租方案與月費估算

以下不含稅金，不含額外 snapshot，不含額外 Volume，不含 Managed Database。

### 4.1 方案 A：維持目前最低成本 VPS

| 項目 | 規格 / 費用 |
|---|---:|
| Droplet | Basic `1GB / 1 vCPU / 25GB` |
| Droplet 月費 | US$6.00 |
| Weekly Backups | US$1.20 |
| Daily Backups | US$1.80 |
| 月費，週備份 | **US$7.20/月** |
| 月費，日備份 | **US$7.80/月** |
| 年費，週備份 | **US$86.40/年** |
| 年費，日備份 | **US$93.60/年** |

適合：

- 希望成本最低。
- 目前系統流量很低。
- 部署流程採用本機 build，再同步 `.next` 到 VPS，避免在 1GB VPS 上 build。

風險：

- Next.js + PM2 + Nginx + Prisma + PDF/Excel 匯出在 1GB RAM 上餘裕偏低。
- 月底薪資計算、匯出報表、多人查詢同時發生時，可能出現慢、swap、PM2 restart 或 502。
- 只適合願意密切監控並接受偶發性能風險的低成本續租。

### 4.2 方案 B：推薦低成本正式站

| 項目 | 規格 / 費用 |
|---|---:|
| Droplet | Basic `2GB / 1 vCPU / 50GB` |
| Droplet 月費 | US$12.00 |
| Weekly Backups | US$2.40 |
| Daily Backups | US$3.60 |
| 月費，週備份 | **US$14.40/月** |
| 月費，日備份 | **US$15.60/月** |
| 年費，週備份 | **US$172.80/年** |
| 年費，日備份 | **US$187.20/年** |

適合：

- 40 人正式站繼續留在 DigitalOcean。
- 想要比 1GB 穩定，但仍控制成本。
- SQLite 繼續使用，並保留 PM2 + Nginx 單機部署。

建議：

- 這是 DigitalOcean 續租的首選平衡方案。
- 若 2026-07-31 後不搬到 Oracle Cloud，建議至少升到此方案。
- 備份建議選 Daily Backups 或保留 Weekly Backups 再搭配每日 SQLite 應用層備份。

### 4.3 方案 C：較穩正式站

| 項目 | 規格 / 費用 |
|---|---:|
| Droplet | Basic `2GB / 2 vCPU / 60GB` |
| Droplet 月費 | US$18.00 |
| Weekly Backups | US$3.60 |
| Daily Backups | US$5.40 |
| 月費，週備份 | **US$21.60/月** |
| 月費，日備份 | **US$23.40/月** |
| 年費，週備份 | **US$259.20/年** |
| 年費，日備份 | **US$280.80/年** |

適合：

- 管理員常匯出 PDF / CSV / Excel。
- 薪資、考勤、班表查詢比現在更頻繁。
- 希望多一顆 vCPU，讓尖峰操作比較不互相卡住。

### 4.4 方案 D：舒適正式站

| 項目 | 規格 / 費用 |
|---|---:|
| Droplet | Basic `4GB / 2 vCPU / 80GB` |
| Droplet 月費 | US$24.00 |
| Weekly Backups | US$4.80 |
| Daily Backups | US$7.20 |
| 月費，週備份 | **US$28.80/月** |
| 月費，日備份 | **US$31.20/月** |
| 年費，週備份 | **US$345.60/年** |
| 年費，日備份 | **US$374.40/年** |

適合：

- 想讓正式站穩定性優先於最低成本。
- 未來人數可能超過 40 人。
- 報表、薪資、匯出功能會越來越常用。

判斷：

- 對 40 人內部系統來說，這是舒服但不一定必要的規格。
- 若預算可接受，會比 `2GB / 1 vCPU` 更不容易遇到記憶體與 CPU 尖峰。

## 5. Snapshot、Volume、Managed Database 成本提醒

續租時容易忽略的成本：

| 項目 | 是否建議 | 原因 |
|---|---|---|
| Droplet Backups | 建議開啟 | 最簡單的整機還原保護 |
| 手動 Snapshot | 只在重大升級前做 | Snapshot 會依 GB/月收費，做完不用要刪 |
| Volume Block Storage | 暫不建議 | 目前 SQLite + uploads 應可先用 Droplet disk |
| Managed Database | 暫不建議 | 40 人 SQLite 單機還可承受，Managed DB 會明顯增加月費 |
| Load Balancer | 不建議 | 單台 VPS + Nginx 足夠 |
| Spaces Object Storage | 可選 | 若 uploads 或備份變大，再評估 |

備份策略建議：

- 開 DigitalOcean Weekly 或 Daily Backups，保護整台 Droplet。
- 另外做應用層備份：每日備份 `prisma/prod.db` 與 `uploads`。
- 重大更新前手動建立 Snapshot，更新完成並穩定後刪除舊 Snapshot。
- 每月檢查一次 Billing，確認 Snapshot、Volume、額外資源沒有殘留。

## 6. 與 Oracle Cloud 方案比較

目前你已有 Oracle Cloud Pay-as-you-go 帳號，且已存在 A1 `1 OCPU / 6GB` 與兩台 E2 Micro。

| 方案 | 月費 | 穩定性 | 管理成本 | 判斷 |
|---|---:|---|---|---|
| DigitalOcean 1GB | 約 US$7.20 到 US$7.80 | 勉強可用 | 低 | 最省，但資源緊 |
| DigitalOcean 2GB | 約 US$14.40 到 US$15.60 | 較合理 | 低 | DO 續租首選 |
| DigitalOcean 4GB | 約 US$28.80 到 US$31.20 | 較穩 | 低 | 預算足夠可選 |
| Oracle A1 1/6 | 可能 US$0 | 可用 | 中 | 適合測試搬遷 |
| Oracle A1 2/12 | 可能 US$0，若超額則可能付費 | 很適合 40 人 | 中 | 若能整理現有 A1，是成本最佳 |

判斷：

- 若只看成本，Oracle A1 成本優勢最大。
- 若看操作熟悉度與現有部署穩定性，DigitalOcean 續租比較省心。
- 若 2026-07-31 前能完成 Oracle 搬遷並驗收，DigitalOcean 可降為備援或到期後停用。
- 若不想在學生額度到期前冒搬遷風險，建議 DigitalOcean 先續租 `2GB / 1 vCPU` 一到兩個月，同時完成 Oracle 壓力測試。

## 7. 建議決策

### 7.1 最推薦路線

建議採用「短期續租 DigitalOcean，並完成 Oracle 搬遷驗證」：

1. 2026-07-31 前：保留 DigitalOcean 正式站，避免服務中斷。
2. 2026-07-31 前：把 Oracle A1 測試站部署完成，驗證登入、打卡、班表、薪資、保險、PDF / CSV / Excel。
3. 若 Oracle 驗收成功：切 DNS 到 Oracle，DigitalOcean 保留 7 到 14 天作回滾備援。
4. 若 Oracle 驗收不穩：DigitalOcean 續租並升到 `2GB / 1 vCPU`。
5. 2026-08 起：確認只保留一個正式站，避免 DigitalOcean 與 Oracle 雙邊持續收費。

### 7.2 如果繼續留在 DigitalOcean

建議選：

```text
Basic 2GB / 1 vCPU / 50GB + Daily Backups
預估：US$15.60/月，不含稅
```

若想再省：

```text
Basic 2GB / 1 vCPU / 50GB + Weekly Backups + 每日 SQLite 自動備份
預估：US$14.40/月，不含稅
```

若非常重視穩定：

```text
Basic 4GB / 2 vCPU / 80GB + Daily Backups
預估：US$31.20/月，不含稅
```

### 7.3 如果搬到 Oracle Cloud

建議 DigitalOcean 不要立刻 destroy，先保留短期備援：

| 階段 | DigitalOcean 狀態 | Oracle 狀態 |
|---|---|---|
| 搬遷前 | 正式站 | 測試站 |
| 切換當天 | 保留，不更新資料或只讀備援 | 正式站 |
| 切換後 7 到 14 天 | 保留備援 | 正式站 |
| 確認穩定後 | 匯出最後備份，destroy Droplet 停止計費 | 正式站 |

## 8. 續租前檢查清單

在 2026-07-31 前完成：

- DigitalOcean Billing > Credits：確認 GitHub Student credits 餘額與到期日。
- DigitalOcean Billing > Usage：確認目前每月 projected usage。
- DigitalOcean Billing Alerts：設定 US$5、US$10、US$20 告警。
- Droplet plan：確認目前是否仍是 `1GB / 1 vCPU / 25GB`。
- Backups：確認是 Weekly、Daily，或未開啟。
- Snapshots：刪除不再需要的舊 snapshot。
- Volumes：確認沒有閒置 volume。
- Floating IP：確認沒有未綁定的 floating IP。
- DNS：確認 Cloudflare / DNS 可快速切回。
- VPS：確認每日 SQLite 備份有成功產生。

檢查 VPS 資源：

```bash
ssh deploy@YOUR_DROPLET_IP
free -h
df -h
pm2 status attendance
pm2 logs attendance --lines 100 --nostream
curl -fsS http://127.0.0.1:3000/api/health
du -sh /home/deploy/apps/changfu-attendance/prisma
du -sh /home/deploy/apps/changfu-attendance/uploads
```

若 1GB VPS 經常出現可用記憶體很低、swap 高、PM2 restart、Nginx 502，建議不要續留 1GB，直接升到 2GB。

## 9. 總結

以 40 人正式考勤 / 薪資 / 班表系統來看：

| 選項 | 建議程度 | 預估月費 | 結論 |
|---|---|---:|---|
| DigitalOcean 1GB + Weekly Backups | 可短期 | US$7.20 | 最省，但正式站風險偏高 |
| DigitalOcean 2GB + Weekly Backups | 推薦 | US$14.40 | 續租最平衡 |
| DigitalOcean 2GB + Daily Backups | 推薦 | US$15.60 | 資料安全更好 |
| DigitalOcean 4GB + Daily Backups | 可選 | US$31.20 | 穩但成本較高 |
| Oracle A1 2/12 | 推薦測試 | 可能 US$0 | 若驗收成功，長期成本最佳 |

最務實建議：

```text
2026-07-31 前完成 Oracle 搬遷測試。
若 Oracle 穩定，切到 Oracle，DigitalOcean 保留 7 到 14 天後 destroy。
若 Oracle 尚未穩定，DigitalOcean 續租並升級到 2GB / 1 vCPU / 50GB。
```

## 10. 參考來源

- DigitalOcean Droplet Pricing：https://www.digitalocean.com/pricing/droplets
- DigitalOcean Droplet Pricing Documentation：https://docs.digitalocean.com/products/droplets/details/pricing/
- GitHub Student Developer Pack：https://education.github.com/pack
- 使用者補充通知：DigitalOcean GitHub Student Developer Pack credits 將於 2026-07-31 到期
