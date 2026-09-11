# 長福會考勤系統 — DigitalOcean → Oracle Cloud 遷移可行性與費用評估

> 評估日期:2026-06-30。帳號類型:Oracle Pay As You Go (PAYG)。

## 結論摘要(TL;DR)

- **可行,且可做到零費用。** 建議在 Oracle 新建 1 台 **A1.Flex(ARM)1 OCPU / 6 GB** 跑考勤 App。
- 這台落在 Oracle **新版**免費上限(2 OCPU / 12 GB)內,而且規格比現行 DO Droplet(1 vCPU / 1 GB)更好。
- App 與 ARM **完全相容**(無 chromium,PDF 走純 JS;`sharp`、Prisma 皆有 aarch64 版本)。
- 部署工具現成:`deploy-vps.sh` 只需改 `VPS_HOST` 指向新機即可重用。
- **最大變數(2026/6 新政)**:Oracle 把 Always Free 的 A1 額度從 4 OCPU/24GB 砍半為 2 OCPU/12GB;對 PAYG 帳號是否計費,官方說法與客服說法不一致 → 以保守上限規劃 + 設 $1 預算警示。

---

## 一、現況盤點

### DigitalOcean(將退役)
- Droplet:Singapore SGP1、Ubuntu 22.04、**1 vCPU / 1 GB / 25 GB SSD**
- 架構:Nginx 反向代理 → PM2(port 3000)、SSL 走 Let's Encrypt 或 Cloudflare Origin Cert
- 資料:**SQLite**(`prisma/prod.db`,`DATABASE_URL="file:./prisma/prod.db"`)
- 備份:rclone → Google Drive / Synology,每日 cron(`scripts/backup-database.sh`)
- 成本:GitHub Student Pack $200 額度,**7 月底到期**;原價 $7.2/月

### 應用技術棧(決定 ARM 相容性)
- Next.js 15 / React 19 / Node `>=20.19.6 <23`(正式環境用 20.19.6)
- DB:SQLite(檔案型,搬遷=複製檔案)
- 程序管理:PM2 fork 單實例,`max_memory_restart: 700M` → **App 很輕**
- 原生相依僅 `sharp`(影像)、Prisma engine;PDF 用 `jspdf`/`pdf-lib`(純 JS)、條碼 `bwip-js`、`@e965/xlsx`(純 JS)→ **無 puppeteer/chromium**

### Oracle 現況(依截圖 2026-06-30)
| 名稱 | 配置 | OCPU | RAM | 備註 |
|---|---|---|---|---|
| car charger | A1.Flex (ARM) | 1 | 6 GB | 佔用 A1 免費額度 |
| KingKitchen web | E2.1.Micro (AMD) | 1 | 1 GB | 永遠免費 |
| instance-howchill | E2.1.Micro (AMD) | 1 | 1 GB | 永遠免費 |
- 帳號類型:**Pay As You Go (PAYG)**
- 區域:AD-1(單一 home region;已能跑 A1,代表該區有 A1 容量)

---

## 二、Oracle Always Free 額度(2026/6 新制)

| 資源 | 免費額度 | 你的使用 | 剩餘(保守) |
|---|---|---|---|
| AMD VM.Standard.E2.1.Micro | **2 台** | 2 台 | **0(已用滿)** |
| ARM Ampere A1(總量) | **2 OCPU / 12 GB**(原 4/24,2026/6 砍半) | 1 OCPU / 6 GB | **1 OCPU / 6 GB** |
| Block Volume(boot+block 總和) | **200 GB** | 約 3×47≈141 GB | 約 59 GB |
| 對外流量 Egress | **10 TB/月** | 極少 | 充足 |

**PAYG 模糊地帶**:官方政策=超過 2/12 的部分對 PAYG **計費**;但 2026/6/22 起多名 Oracle 客服以 email 告知 PAYG 仍可免費用 4/24。無正式公告、執行不一致。→ **本評估一律以 2/12 為準**,確保零費用。

---

## 三、ARM 相容性評估(A1 為 aarch64)

| 項目 | ARM 支援 | 說明 |
|---|---|---|
| Node.js 20 | ✅ | 官方 arm64 build |
| Prisma 6 / @prisma/client | ✅ | linux-arm64 engine |
| sharp 0.34 | ✅ | 預編譯 arm64 |
| jspdf / pdf-lib / @pdfme/pdf-lib / fontkit | ✅ | 純 JS |
| bwip-js(條碼)、qrcode、xlsx、bcryptjs、otplib、web-push | ✅ | 純 JS |
| puppeteer / chromium | — | **未使用**(無 ARM headless 瀏覽器負擔) |

**結論:ARM 遷移無相容性障礙。**

---

## 四、零費用可行性與作法

### 推薦方案 A(乾淨、可保證零費用)
新建 **A1.Flex 1 OCPU / 6 GB** 專跑考勤 App。
- A1 總量 → 2 OCPU / 12 GB = 新免費上限,**$0**(即使用保守解讀)。
- 規格升級:6 GB RAM(DO 只有 1 GB)、1 顆完整 ARM 核心;Next.js 15 本機 build 後同步即可,執行記憶體 700M 綽綽有餘。

### 替代方案 B(不另開機)
把考勤 App 併到現有 car charger(A1 1/6)同機共存。省一台,但兩專案混機、互相影響、維運較亂 → 不建議。

### 守住「零費用」的四個條件
1. **A1 總量 ≤ 2 OCPU / 12 GB**(保守);方案 A 剛好打平,**無餘裕**。
2. **所有 boot + block volume 總和 ≤ 200 GB**。現有 3 台 + 新 1 台約 188 GB,**偏緊**(詳見下方〈200 GB 儲存上限:檢查與解法〉)。
3. **同 home region**(Always Free 鎖區;與現有實例同區,該區已知有 A1 容量,但偶有 "Out of host capacity",需重試)。
4. **設 Budget Alert = US$1**:PAYG 模糊地帶的保險,任何意外計費立即收到通知。

### 風險與緩解
| 風險 | 機率 | 緩解 |
|---|---|---|
| PAYG 被依新制計費(超 2/12) | 中 | 方案 A 不超上限;設 $1 預算警示 |
| Storage 超 200 GB 被計費 | 低–中 | 新機 boot 最小化;勿掛大 block volume |
| A1 容量不足無法開機 | 低 | 同區已有 A1;失敗重試/換 AD |
| 之後 Oracle 進一步縮減免費額度 | 低 | App 輕量,必要時付費 A1 也僅約數美元/月 |

### 200 GB 儲存上限:檢查與解法

**先查實際用量(別只憑估算)**
- 主控台:Storage → Boot Volumes 與 Block Volumes,逐一看每顆大小並加總;或 OCI CLI:
  `oci bv boot-volume list --compartment-id <OCID> --all` 與 `oci bv volume list --compartment-id <OCID> --all`
- 加總「所有 boot volume + 所有 block volume」,看離 200 GB 還有多少。

**現況數學**:OCI boot volume 下限約 **47–50 GB(無法更低)**。4 台都用下限 = 4 × 47 ≈ **188 GB < 200 GB**,理論上塞得下 → **多半不必動 car charger**。真正會超標的情形只有:某台 boot 被擴大過、掛了額外 block volume、或有已終止實例殘留的孤兒磁碟。

**關鍵限制**:OCI 磁碟**只能擴大、不能原地縮小**。所以「縮減 car charger」不是按鈕調小,而是要重建——這也是為什麼下面把它排在較後面。

**解法(由簡到繁,超標才需要)**:
1. **新機 boot 用最小(47–50 GB),不掛額外 block volume** — 預設就該如此(SQLite + uploads 很小)。最省、零停機,通常做到這點就夠。
2. **清孤兒磁碟與舊備份** — 曾終止的實例殘留的 boot volume、用不到的 block volume backup 仍佔 200 GB 額度;在 Boot Volumes / Block Volumes / Backups 清單把無用的刪掉即釋放。
3. **備份與 uploads 改放 Object Storage(10 GB 永遠免費)** — 把 DB 每日備份、上傳檔移到物件儲存,降低 block volume 需求(App 輕,一般用不到,列為選項)。你現有 rclone → Google Drive / Synology 的異地備份,本來就比佔用 OCI block backup 更省額度。
4. **縮減 car charger boot(需重建、有停機)** — 僅當它的 boot 真的過大才值得:
   ① 先備份(boot volume backup 或把資料另存)→ ② 以較小 boot(47–50 GB)新建一台 A1 → ③ 把 car charger 的服務/資料遷過去 → ④ 終止舊機並刪除舊 boot volume。
   工序重、會中斷 car charger 服務,且新建仍受 A1 的 2 OCPU/12GB 上限約束。
5. **退役或合併實例** — 若 car charger 或某台 E2 micro 已用不到,直接終止並刪其 boot volume,一次釋放整顆(~47 GB 以上),最乾脆。

> 小結:先「查實際大小 + 新機用最小 boot」,九成情況就過關;真的超標再依序考慮清孤兒磁碟 → 移 Object Storage → 最後才動到重建 car charger。

### 建議硬碟大小

| 項目 | 實際需求估算 |
|---|---|
| OS(Ubuntu minimal) | 3–5 GB |
| node_modules + .next build | 2–4 GB |
| SQLite `prod.db` | 數十–數百 MB |
| uploads/ + logs | 視照片量,通常 < 數 GB |
| **實際用量合計** | **多落在 10–15 GB** |

**建議:新機 boot volume = 50 GB(OCI 下限),不另掛 block volume。**
- 50 GB 已是能選的最小 boot,且約為實際需求的 3 倍以上,綽綽有餘。
- 在 200 GB 總額度偏緊時,**用下限就是最佳解**;別為了「保險」開大,那只會吃掉免費額度。
- 日後 uploads 若真的暴增(考勤照片少見),把它與備份移到 Object Storage(10 GB 免費),不要擴大 boot。

### 超量費用分析(僅對「超過 200 GB 的部分」計費,全租戶加總)

單價(PAYG,2026,USD):
- **Boot volume(Balanced,預設;boot 不可用 Lower Cost)** ≈ 儲存 $0.025 + 效能 10 VPU ≈ **$0.043 / GB / 月**
- **Block volume(可選 Lower Cost 層,僅算儲存)** ≈ **$0.025 / GB / 月** ← 額外資料碟用這層最省

| 超出量 | Boot(Balanced)$0.043/GB | Block(Lower Cost)$0.025/GB | 約合新台幣/月* |
|---|---|---|---|
| +10 GB | $0.43 | $0.25 | NT$8–14 |
| +50 GB | $2.15 | $1.25 | NT$40–70 |
| +100 GB | $4.30 | $2.50 | NT$80–140 |

*以約 NT$32/USD 概估。

**解讀**:儲存超量單價極低,即使超出 100 GB 也僅每月數美元——**不會爆帳單**,但會打破「$0」目標。只要照「新機 boot 用 50 GB 下限 + 不掛額外碟」,全租戶總量約 188 GB < 200 GB,維持 **$0**。

> 對照運算超量更貴:若 A1 超過 2 OCPU/12GB 被計費,Ampere A1 約 **$0.01/OCPU/小時 + $0.0015/GB/小時**,等於 1 OCPU/6GB 全月約 **$14/月**——遠高於儲存超量。所以**守住 A1 的 2 OCPU/12GB 上限,比守住儲存更關鍵**。

---

## 五、遷移步驟(重用既有 `deploy-vps.sh`)

1. **開機**:OCI 主控台建 A1.Flex、Ubuntu 22.04/24.04 (ARM)、1 OCPU / 6 GB、最小 boot volume、home region;上傳 SSH 公鑰。
2. **網路**:Security List / NSG 開 ingress 22 / 80 / 443;**並修 OS 防火牆**——Oracle Ubuntu image 預設 iptables 會擋 80/443(OCI 經典坑),需加規則或改用 ufw 並處理 netfilter-persistent。
3. **環境**:裝 nvm + Node 20.19.6、`pm2`、`nginx`(或改用 Caddy 自動 HTTPS,省 certbot)。
4. **一次性搬資料**(deploy 腳本會排除這些,需手動):從 DO 把 `prisma/prod.db`、`.env.production`、`uploads/` 以 scp/rsync 複製到新機。
5. **部署**:本機執行 `VPS_HOST=<新機IP> npm run deploy:vps`(自動 build → 同步 → `prisma migrate deploy` → PM2 reload)。
6. **SSL**:無 Cloudflare → `certbot --nginx`;有 Cloudflare → 配 Origin Certificate(參考 repo `CLOUDFLARE_DEPLOYMENT_GUIDE.md`)。
7. **DNS**:A record 指向新公用 IP(若用 Cloudflare 在其後台改)。
8. **備份**:重設 rclone + `scripts/backup-database.sh` 每日 cron。
9. **驗證與收尾**:`curl https://<網域>/api/health` + 冒煙測試登入/打卡/薪資 → 確認無誤後,**7/31 前關閉 DO Droplet**。

---

## 六、費用總結

| 項目 | DO(到期後原價) | Oracle 方案 A |
|---|---|---|
| 月費 | $7.2 | **$0** |
| 一次性 | — | 數小時人力 |
| 規格 | 1 vCPU / 1 GB | 1 OCPU(完整核心)/ 6 GB |

---

## 七、待確認(影響步驟細節,非阻擋)
- home region 與網域 DNS 是否走 **Cloudflare**(決定 SSL 作法)。
- 接受方案 A「無免費餘裕」的 1 OCPU/6GB,或想保留餘裕(例如縮減 car charger / 改規格)。

---

## 附錄 A:Oracle Cloud 設定配置(可直接照做)

> 多數步驟沿用 repo 既有的 `deploy-vps.sh`、Nginx/.env/rclone 設定;以下標 **OCI 特有** 的才是與 DO 不同、需特別注意的設定。

### A1. 建立 Compute 實例(OCI 特有)
主控台 → Compute → Instances → Create instance:
- **Name**:`attendance`
- **Placement**:home region(與現有 car charger 同區)
- **Image**:Canonical **Ubuntu 22.04**,務必選 **aarch64 / ARM** 版本
- **Shape**:`VM.Standard.A1.Flex`,**1 OCPU / 6 GB**
- **Boot volume**:勾「Specify a custom boot volume size」→ **50 GB**(下限),Performance 用預設 Balanced
- **Networking**:選現有 VCN/subnet,勾 Assign public IPv4
- **SSH keys**:貼上公鑰(`~/.ssh/id_ed25519.pub`)
- 預設登入帳號為 **`ubuntu`**(非 root)

> 出現 "Out of host capacity" = 該區 A1 容量暫時不足,稍後或換 AD 重試。

### A2. 防火牆兩層(OCI 特有,最常見的坑)
**第一層 OCI 端**(VCN → Security Lists 或實例 NSG)新增 Ingress:`0.0.0.0/0` TCP **22 / 80 / 443**。

**第二層 OS 端**:Oracle Ubuntu image 內建 iptables 預設只放行 22,80/443 會被擋。SSH 進去後:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save   # 持久化,重開機仍有效
```

### A3. 基礎環境
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip nginx
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20.19.6 && nvm use 20.19.6 && nvm alias default 20.19.6   # ARM 自動抓 arm64
npm install -g pm2
mkdir -p ~/apps/changfu-attendance/{prisma,uploads}
```
> `deploy-vps.sh` 預設 `VPS_USER=deploy`、`DEPLOY_PATH=/home/deploy/...`;OCI 預設帳號是 `ubuntu`,最簡單是部署時覆寫 `VPS_USER=ubuntu`(見 A5)。

### A4. 一次性搬資料(從 DO → 新機)
deploy 腳本排除了 db/.env/uploads,需手動搬:
```bash
scp prod.db          ubuntu@<新機IP>:~/apps/changfu-attendance/prisma/prod.db
scp .env.production  ubuntu@<新機IP>:~/apps/changfu-attendance/.env.production
rsync -avz uploads/  ubuntu@<新機IP>:~/apps/changfu-attendance/uploads/
```
`.env.production` 必備鍵(**沿用現行正式值,切勿重產 `JWT_SECRET`/`ENCRYPTION_KEY`,否則既有登入失效、加密欄位無法解密**):
```env
DATABASE_URL="file:./prisma/prod.db"
JWT_SECRET=<沿用現行值>
ENCRYPTION_KEY=<沿用現行值>
NODE_ENV=production
# 連同現行既有的 SMTP / VAPID(web-push)/ Sentry 等鍵一併帶過來
```

### A5. 部署(本機執行,重用腳本)
```bash
VPS_HOST=<新機IP> VPS_USER=ubuntu npm run deploy:vps
```
自動:本機 build → 同步檔案與 `.next` → `npm ci --omit=dev` → `prisma generate` → `prisma migrate deploy` → PM2 start/reload → 打 `/api/health`。
接著設 PM2 開機自啟:
```bash
pm2 startup      # 依輸出貼上那段 sudo env PATH=... 指令
pm2 save
```

### A6. Nginx 反向代理 + SSL
`/etc/nginx/sites-available/attendance`(與 repo DO 指南同款):
```nginx
server {
    listen 80;
    server_name <你的網域>;
    client_max_body_size 12m;          # 上傳/匯入需要,務必保留
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
SSL 二選一:
- 無 Cloudflare:`sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d <網域>`
- 有 Cloudflare(Full/Strict):配 Origin Certificate,參考 repo `docs/CLOUDFLARE_DEPLOYMENT_GUIDE.md`

### A7. 備份(沿用現行 rclone 腳本)
```bash
curl https://rclone.org/install.sh | sudo bash
rclone config        # 設定 gdrive / synology(同現行)
scp scripts/backup-database.sh ubuntu@<新機IP>:~/backup-database.sh
ssh ubuntu@<新機IP> 'chmod +x ~/backup-database.sh'
crontab -e           # 加:0 19 * * * /home/ubuntu/backup-database.sh
```

### A8. DNS 切換與驗證
```bash
ssh ubuntu@<新機IP> 'curl -i http://127.0.0.1:3000/api/health'
curl -I https://<網域>
```
A record 指向新機公用 IP(用 Cloudflare 就在後台改)→ 冒煙測試登入/打卡/薪資匯出/上傳 → 確認無誤後 **7/31 前關閉 DO Droplet**。

### A9. 守零費用收尾(OCI 特有)
- Billing → Cost Management → **Budgets** 建 **US$1 預算 + email 警示**。
- 確認 A1 總量 = 2 OCPU/12GB、所有 boot+block volume 總和 < 200 GB。

---

## 資料來源(Oracle Always Free 2026/6 變動)
- Oracle 官方 — [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [TerminalBytes — Oracle Cloud free tier 2026: 4 OCPU/24GB cut to 2 OCPU/12GB](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/)
- [Linuxiac — Oracle Quietly Cuts Free Tier Ampere A1 Resources in Half](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)
- [Oracle Cloud Customer Connect — Do the new reduced A1 limits apply to existing users?](https://community.oracle.com/customerconnect/discussion/964620/do-the-new-reduced-ampere-a1-free-tier-limits-apply-to-existing-users)
