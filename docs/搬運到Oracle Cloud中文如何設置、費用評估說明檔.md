# 搬運到 Oracle Cloud 中文如何設置、費用評估說明檔

最後更新：2026-06-16

本文件說明如何把目前長福會考勤系統從既有 VPS 搬運到 Oracle Cloud Infrastructure（OCI），採用與現行正式環境相同的架構：

- Ubuntu VPS
- Node.js 20.19.6（nvm）
- PM2
- Nginx 反向代理
- SQLite `prisma/prod.db`
- Cloudflare 或 Let's Encrypt HTTPS

補充前提：

- 目前使用者已有 Oracle Cloud **Pay-as-you-go** 帳號。
- 本專案是約 **40 人規模** 的考勤、班表、薪資、保險、報表系統。
- 目前 OCI Console 截圖日期：2026-06-16，已存在 3 台執行中的 VM。
- 使用情境屬於「低到中等流量、資料正確性高要求」的內部系統，不是高流量公開網站。

> 重要：Oracle Cloud 免費額度、Always Free 限制與單價可能會調整。正式申請與下單前，請以 Oracle Console 的 Limits / Quotas、Oracle Cloud Price List、Oracle Cost Estimator 為準。

## 1. 建議規格與成本結論

### 1.1 40 人專案負載判斷

此系統的主要負載特性：

| 模組 | 負載特性 | 對資源影響 |
|---|---|---|
| 上下班打卡 | 40 人集中在上下班幾分鐘內操作 | 瞬間 API 請求增加，但總量很低 |
| 班表/月曆 | 管理員查詢與編輯較多 | 主要吃資料庫查詢與前端渲染 |
| 薪資計算 | 月底或薪資日批次計算 | 短時間 CPU / SQLite I/O 增加 |
| PDF / CSV / Excel 匯出 | 管理員偶發操作 | 會吃 CPU 與記憶體，但人數少 |
| 附件 / 圖片 | 若有財產、公告、證明附件 | 主要吃磁碟空間與備份空間 |
| 一般員工查詢 | 每日零星使用 | 負載很低 |

40 人內部系統的結論：

- **1 OCPU / 6GB RAM** 可以跑，但薪資計算、PDF 匯出、Next.js runtime 同時發生時餘裕較少。
- **2 OCPU / 12GB RAM** 是最平衡建議，對 40 人規模已非常充裕，也比目前常見 1GB VPS 穩定很多。
- SQLite 可繼續使用，但必須做好備份；若未來超過 100 到 150 人、或多人同時大量寫入，再評估 PostgreSQL。

### 1.2 目前 OCI 使用情形

依 2026-06-16 截圖，目前 Oracle Cloud 已有以下執行個體：

| 名稱 | Shape | OCPU | Memory | 狀態 | 截圖標示 | 判讀 |
|---|---|---:|---:|---|---|---|
| `car charger` | `VM.Standard.A1.Flex` | 1 | 6GB | 執行中 | 未看到永遠免費標籤 | 已使用一半 A1 建議免費容量 |
| `KingKitchen web` | `VM.Standard.E2.1.Micro` | 1 | 1GB | 執行中 | 永遠免費 | 已使用第 1 台 E2 Micro |
| `instance-howchill` | `VM.Standard.E2.1.Micro` | 1 | 1GB | 執行中 | 永遠免費 | 已使用第 2 台 E2 Micro |

重要判斷：

- 兩台 `VM.Standard.E2.1.Micro` 已用滿 Oracle 文件列出的「最多兩台 Always Free Micro instances」。
- 目前 A1 已用 `1 OCPU / 6GB`；若以 Oracle Always Free 文件中常見的 `2 OCPU / 12GB` 可用容量判斷，A1 還有約 `1 OCPU / 6GB` 的免費餘裕。
- 因你是 Pay-as-you-go 帳號，超出 Always Free 的資源不會被擋下，而是可能開始計費；所以搬遷前一定要用 Console 的 `Always Free-eligible` 標籤、Limits / Quotas、Cost Analysis 確認。
- 目前截圖未顯示 boot volume 大小；如果 3 台 VM 都是預設 50GB boot volume，已用約 `150GB / 200GB` Always Free Block Volume，理論上剩約 `50GB`。若要替長福系統新開一台 100GB boot volume，就可能超過免費 block volume 額度。

### 1.3 以目前帳號狀態推估搬遷費用

以目前已存在的 3 台 VM 來看，長福系統搬到 Oracle Cloud 有 4 種現實方案：

| 方案 | 做法 | 每月費用判斷 | 優點 | 風險 / 限制 | 建議 |
|---|---|---:|---|---|---|
| A. 直接使用現有 `car charger` A1 | 在既有 `1 OCPU / 6GB` VM 上部署長福系統，或先備份後改作長福正式站 | 可能 US$0 | 不新增 compute / boot volume，最省 | 會與原服務共用資源；正式系統隔離性較差 | 可作測試，不建議長期混用正式服務 |
| B. 將現有 A1 升級到 `2 OCPU / 12GB` | 把 `car charger` resize，或釋放後建立長福專用 A1 | 可能 US$0 | 符合 40 人正式站建議規格 | 需確認原服務可搬離；需確認升規後仍標示 Always Free / 未超額 | **最推薦，如果可調整現有 A1 用途** |
| C. 新增一台 A1 `1 OCPU / 6GB` | 保留現有 3 台 VM，再新開長福 A1 | 可能 US$0 到少量付費 | 長福系統獨立，不影響既有服務 | 若 A1 免費容量只剩 1/6，compute 可能仍免費；但 boot volume 很可能碰到 200GB 上限 | 可行，但要先算 boot volume |
| D. 新增一台 A1 `2 OCPU / 12GB` | 保留現有 3 台 VM，再新開推薦規格 | 可能約 US$27 到 US$30/月起 | 長福系統最乾淨、資源充裕 | 幾乎一定超過目前剩餘 A1 免費容量；boot volume 也可能超額 | 若願意付費、想避免干擾，這是最穩 |

本專案 40 人規模的建議順序：

1. **正式推薦：方案 B**，把現有 A1 整理成長福專用 VM，規格調到 `2 OCPU / 12GB`，boot volume 控制在免費額度內。
2. **零成本測試：方案 A**，先把長福系統部署到現有 `car charger` A1 驗證 Arm 相容性、建置流程、Nginx、PM2、SQLite 備份。
3. **保留現有服務且低成本：方案 C**，新增 `1 OCPU / 6GB / 50GB` 長福專用 VM，但需要確認 block volume 是否仍在 200GB 內。
4. **最穩但可能付費：方案 D**，新增 `2 OCPU / 12GB / 100GB` 長福專用 VM，預估若完全不落在免費額度內，compute 約 US$27 到 US$30/月級距，另加可能的超額 storage。

### 1.4 最推薦方案：整理現有 A1 作為長福正式站

你已經有 Pay-as-you-go 帳號，也已經有一台 A1 Flex 正在跑。對 40 人正式系統來說，最好的成本 / 穩定性平衡不是盲目新開 VM，而是先整理現有 A1 額度。

| 項目 | 建議值 | 說明 |
|---|---:|---|
| Shape | `VM.Standard.A1.Flex` | Arm 架構 Ampere A1 |
| OCPU | 2 | 40 人正式站建議值；若只測試可先用 1 |
| Memory | 12 GB | Next.js、PM2、PDF 匯出、薪資批次較有餘裕；若只測試可先用 6GB |
| Boot Volume | 50GB 到 100GB | 目前已有 3 台 VM，若都為 50GB，新增/擴容前要確認 200GB 免費 block volume 餘額 |
| Region | Japan East / Singapore / South Korea Central | 依可用性與延遲選擇；台灣使用者通常建議日本或新加坡 |
| OS | Ubuntu 22.04 或 24.04 | 文件以下以 Ubuntu 為例 |
| Database | SQLite | 維持現況，降低搬遷風險 |
| Nginx / PM2 | 單機部署 | 不需要 Load Balancer |

可選方案：

| 方案 | 規格 | 適合情境 | 建議 |
|---|---:|---|---|
| 保守免費優先 | 1 OCPU / 6GB / 50GB | 先測試搬遷、確認 Arm 相容性 | 可用，但餘裕少 |
| 推薦正式站 | 2 OCPU / 12GB / 50GB 到 100GB | 40 人正式使用 | 建議採用，但優先整理現有 A1 |
| 高餘裕 | 4 OCPU / 24GB / 150GB | 大量 PDF、報表、附件或未來擴張 | 目前不建議，除非已接受付費 |
| x86 paid VM | E 系列 x86 | Arm 套件遇到相容性問題 | 備案，不作第一選擇 |

### 1.5 月費粗估

| 情境 | 月費估算 | 說明 |
|---|---:|---|
| 使用現有 A1 `1 OCPU / 6GB` 部署長福 | 可能約 US$0 | 不新增 compute；適合先驗證，但不建議長期混用 |
| 現有 A1 調整為長福專用 `2 OCPU / 12GB` | 可能約 US$0 | 若 Console 仍標示在 Always Free / 未超額，這是最佳方案 |
| 保留現有 3 台 VM，再新增 A1 `1 OCPU / 6GB / 50GB` | 可能約 US$0 到少量付費 | compute 可能仍在剩餘 A1 額度，但 storage 可能逼近 200GB |
| 保留現有 3 台 VM，再新增 A1 `2 OCPU / 12GB / 100GB` | 可能約 US$27 到 US$30/月起 | 多半超過目前剩餘 A1 免費容量；另看 storage 是否超額 |
| A1 4 OCPU / 24GB，150GB boot volume | 約 US$55 到 US$60/月級距 | 目前 40 人專案不需要 |
| 超過 Always Free compute 限制 | 依 OCPU hour + memory GB hour 計費 | 請用 Cost Estimator 即時確認 |
| 超過 200GB block volume | 超出部分依 block volume 單價計費 | 需看 Price List |
| 對外流量超過 10TB/月 | 超出部分依區域流量單價計費 | APAC 首 10TB/月官方列為 Free |
| 使用付費 Load Balancer 或額外服務 | 可能產生費用 | 不建議第一版搬遷使用付費 LB |

40 人專案通常每月成本判斷：

- Compute：若能整理現有 A1，建議把長福正式站放在 A1 `2 OCPU / 12GB`；若不動現有 VM，新增推薦規格可能開始計費。
- Storage：目前已有 3 台 VM，若各 50GB boot volume，已用約 150GB；長福若新增 50GB 還可能剛好在 200GB 內，新增 100GB 則可能超額。
- Outbound：40 人內部系統很難超過 10TB/月，通常 US$0。
- Object Storage：若只放近期 SQLite 備份，20GB Always Free 可能夠；若上傳附件很多，需控管備份保留天數。
- Load Balancer：不使用，避免額外費用。

> 粗略付費上限推估：若 A1 完全不落在免費額度內，常見公開標價約為 OCPU hour + memory GB hour 計算。以 2 OCPU / 12GB 連續 730 小時計，約 US$27 到 US$30/月等級；以 4 OCPU / 24GB 連續 730 小時計，約 US$55 到 US$60/月等級。這只是估算，實際請以 Oracle Cost Estimator 為準。

### 1.6 Pay-as-you-go 費用控管設定

因你已是 Pay-as-you-go 帳號，搬遷前務必先設定：

1. Budget：建議建立 US$1、US$5、US$10 三段告警。
2. Email alert：確認收費告警會寄到常用信箱。
3. Compartment Quota：限制 compute、block volume、load balancer。
4. 不建立 NAT Gateway、付費 Load Balancer、大容量 Object Storage。
5. 每週查看 Cost Analysis，直到穩定運作 1 個月。

若採用「長福正式站最多 A1 2 OCPU / 12GB」的策略，建議 quota 方向：

```text
set compute-core quota standard-a1-core-count to 2 in compartment <compartment_name>
set compute-memory quota standard-a1-memory-count to 12 in compartment <compartment_name>
```

> Quota 語法會依 OCI Console 顯示的 service / resource name 調整，上面是方向示例；正式套用前請在 Oracle Console 的 Quotas 頁面確認。

### 1.7 免費額度注意事項

Oracle 官方文件目前列出：

- Free Trial 有 US$300 credits，通常有效 30 天。
- Always Free resources 可長期使用，但有容量限制。
- Always Free A1 在文件中列出每月 `1,500 OCPU hours` 與 `9,000 GB hours`，並說明對 Always Free tenancy 等效為 `2 OCPU / 12GB`；Price List 另列 A1 可有前段免費用量。實際可建立與是否收費，請以 Console 顯示為準。
- Always Free Block Volume 總量包含 boot volume 與 block volume。
- Always Free 對外流量包含每月 10TB outbound data。
- Always Free instance 若長期低使用率，可能被判定 idle 並回收；正式站建議保持正常監控、排程備份與實際服務流量。
- Pay-as-you-go 帳號仍要避免建立超出 Always Free 的資源；Oracle 會針對超額資源收費。

## 2. 搬遷前檢查清單

先在目前正式 VPS 上確認：

```bash
cd /home/deploy/apps/changfu-attendance
node -v
npm -v
pm2 status attendance
curl -fsS http://127.0.0.1:3000/api/health
ls -lh prisma/prod.db
du -sh uploads prisma backups
```

本機專案確認：

```bash
npm test -- --runInBand
npm run lint
npm run build
```

建議搬遷前先產生備份：

```bash
ssh deploy@OLD_VPS_IP '
  cd /home/deploy/apps/changfu-attendance &&
  mkdir -p ~/migration-backup &&
  cp prisma/prod.db ~/migration-backup/prod.db.$(date +%Y%m%d-%H%M%S) &&
  tar -czf ~/migration-backup/uploads.$(date +%Y%m%d-%H%M%S).tar.gz uploads || true
'
```

## 3. Oracle Cloud 建立 VM

### 3.1 Pay-as-you-go 帳號與選 Region

1. 使用現有 Oracle Cloud Pay-as-you-go 帳號登入 OCI Console。
2. 先確認 Tenancy 的 Home Region，以及該 region 是否能建立 A1。
3. 台灣使用者常見選擇：
   - Japan East（Tokyo）：延遲通常穩定。
   - Singapore：東南亞路由常見。
   - South Korea Central：可測試延遲與可用容量。
4. 若建立 A1 顯示 `out of host capacity`，可換 availability domain、等待，或改成 paid compute shape 作為備案。
5. 建議為此專案建立獨立 compartment，例如 `changfu-attendance-prod`，方便成本追蹤與 quota 管控。

### 3.2 建立 VCN / Subnet

在 OCI Console 建議：

1. Networking > Virtual Cloud Networks > Start VCN Wizard。
2. 選 `VCN with Internet Connectivity`。
3. 建立 public subnet。
4. Security List / Network Security Group 放行：
   - TCP 22：SSH，建議只允許你的固定 IP。
   - TCP 80：HTTP。
   - TCP 443：HTTPS。
   - 不要開放 TCP 3000 到公網，讓 Nginx 代理到本機即可。

### 3.3 建立 Compute Instance

1. Compute > Instances > Create Instance。
2. Image 選 Ubuntu 22.04 或 Ubuntu 24.04。
3. Shape 選 `VM.Standard.A1.Flex`。
4. OCPU / Memory 建議：
   - 先用現有 A1 測試：1 OCPU / 6GB RAM。
   - 40 人正式站：2 OCPU / 12GB RAM。
   - 若保留現有 3 台 VM 又新增長福 VM，先用 1 OCPU / 6GB RAM 確認是否仍在免費額度。
   - 暫不建議一開始開到 4 OCPU / 24GB，除非你確認仍在免費額度或願意承擔付費。
5. Boot volume：
   - 若使用現有 A1：沿用現有 boot volume，先不要擴大。
   - 若新增長福 VM：先用 50GB，比較可能控制在 200GB Always Free Block Volume 內。
   - 若要用 100GB：先到 Block Volume / Boot Volume 檢查目前三台 VM 合計容量，確認超額成本可接受。
6. 加入 SSH public key。
7. 建立後記下 public IP。

## 4. Oracle VM 首次初始化

以 `ubuntu` 或 Oracle 顯示的預設使用者登入：

```bash
ssh ubuntu@ORACLE_PUBLIC_IP
```

更新系統、建立部署者：

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git rsync nginx ufw unzip htop

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

sudo adduser deploy
sudo usermod -aG sudo deploy
sudo rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

切到 `deploy`：

```bash
su - deploy
```

安裝 nvm / Node / PM2：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. /home/deploy/.nvm/nvm.sh
nvm install 20.19.6
nvm alias default 20.19.6
nvm use default
npm install -g pm2
node -v
pm2 -v
```

## 5. 建立專案目錄與環境檔

```bash
mkdir -p /home/deploy/apps/changfu-attendance
cd /home/deploy/apps/changfu-attendance
mkdir -p prisma uploads backups
```

建立 `.env`：

```bash
nano /home/deploy/apps/changfu-attendance/.env
```

範例：

```env
DATABASE_URL="file:./prisma/prod.db"
JWT_SECRET="請填入至少32字元且不要外洩"
NEXTAUTH_SECRET="請填入至少32字元且不要外洩"
NEXTAUTH_URL="https://your-domain.example"
NODE_ENV="production"
PORT="3000"
HOSTNAME="0.0.0.0"
TZ="Asia/Taipei"
NEXT_TELEMETRY_DISABLED="1"
```

> 若目前正式 VPS 已有 `.env`，可安全地用 `scp` 複製到 Oracle VM，但要確認 `NEXTAUTH_URL` 改成新網域。

## 6. 搬運資料庫與附件

從舊 VPS 拉回本機：

```bash
mkdir -p /tmp/changfu-migration
scp deploy@OLD_VPS_IP:/home/deploy/apps/changfu-attendance/prisma/prod.db /tmp/changfu-migration/prod.db
scp -r deploy@OLD_VPS_IP:/home/deploy/apps/changfu-attendance/uploads /tmp/changfu-migration/uploads
```

再推到 Oracle VM：

```bash
scp /tmp/changfu-migration/prod.db deploy@ORACLE_PUBLIC_IP:/home/deploy/apps/changfu-attendance/prisma/prod.db
scp -r /tmp/changfu-migration/uploads deploy@ORACLE_PUBLIC_IP:/home/deploy/apps/changfu-attendance/uploads
```

如果資料庫很大，建議壓縮：

```bash
ssh deploy@OLD_VPS_IP 'cd /home/deploy/apps/changfu-attendance && gzip -c prisma/prod.db > /tmp/prod.db.gz'
scp deploy@OLD_VPS_IP:/tmp/prod.db.gz /tmp/changfu-migration/prod.db.gz
scp /tmp/changfu-migration/prod.db.gz deploy@ORACLE_PUBLIC_IP:/home/deploy/apps/changfu-attendance/prisma/prod.db.gz
ssh deploy@ORACLE_PUBLIC_IP 'cd /home/deploy/apps/changfu-attendance && gunzip -f prisma/prod.db.gz'
```

## 7. 使用現有部署腳本部署到 Oracle VM

本專案根目錄的 `deploy-vps.sh` 不限定 DigitalOcean，只要是 SSH + Ubuntu + nvm + PM2 的 VPS 都能用。

在本機專案根目錄執行：

```bash
VPS_HOST=ORACLE_PUBLIC_IP \
VPS_USER=deploy \
VPS_PORT=22 \
DEPLOY_PATH=/home/deploy/apps/changfu-attendance \
PM2_APP_NAME=attendance \
APP_PORT=3000 \
npm run deploy:vps
```

如果要固定 Node 版本：

```bash
VPS_HOST=ORACLE_PUBLIC_IP EXPECTED_NODE_VERSION=20.19.6 npm run deploy:vps
```

部署腳本會做：

1. 讀取 Oracle VM 的 Node 版本。
2. 本機用同版 Node 執行 `npm ci` 與 `npm run build`。
3. 同步專案檔案與 `.next`。
4. 在 Oracle VM 執行 `npm ci --omit=dev`。
5. 執行 `npx prisma generate`。
6. 執行 `npx prisma migrate deploy || npx prisma db push`。
7. 用 PM2 reload `attendance`。
8. 呼叫 `http://127.0.0.1:3000/api/health` 健康檢查。

## 8. Nginx 設定

在 Oracle VM：

```bash
sudo nano /etc/nginx/sites-available/attendance
```

內容：

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 12m;

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

啟用：

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
sudo nginx -t
sudo systemctl reload nginx
```

若暫時還沒切 DNS，可先用 Oracle public IP 測：

```bash
curl -I http://ORACLE_PUBLIC_IP
curl -fsS http://ORACLE_PUBLIC_IP/api/health
```

## 9. HTTPS 與 DNS 切換

### 9.1 使用 Cloudflare

1. Cloudflare DNS 新增或修改 A record：
   - Name：`changfu.me` 或子網域。
   - IPv4：Oracle VM public IP。
   - Proxy：建議先灰雲 DNS only，確認正常後再開橘雲。
2. SSL/TLS 模式建議 `Full (strict)`。
3. 在 Oracle VM 安裝 Cloudflare Origin Certificate，或改用 Let's Encrypt。

### 9.2 使用 Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
sudo systemctl reload nginx
```

驗證：

```bash
curl -fsS https://your-domain.example/api/health
```

## 10. PM2 開機自動啟動

在 Oracle VM 的 `deploy` 使用者：

```bash
. /home/deploy/.nvm/nvm.sh
pm2 status attendance
pm2 save
```

依 `setup-production.sh` 輸出的提示執行類似：

```bash
sudo env PATH=/home/deploy/.nvm/versions/node/v20.19.6/bin:$PATH /home/deploy/.nvm/versions/node/v20.19.6/bin/pm2 startup systemd -u deploy --hp /home/deploy
pm2 save
```

重開機測試：

```bash
sudo reboot
```

重開後：

```bash
ssh deploy@ORACLE_PUBLIC_IP
. /home/deploy/.nvm/nvm.sh
pm2 status attendance
curl -fsS http://127.0.0.1:3000/api/health
```

## 11. 備份策略

SQLite 正式站一定要做備份。建議先用 VM 本機備份，再加 Object Storage 或外部雲端。

本機每日備份範例：

```bash
mkdir -p /home/deploy/backups
crontab -e
```

加入：

```cron
15 3 * * * cp /home/deploy/apps/changfu-attendance/prisma/prod.db /home/deploy/backups/prod-$(date +\%Y\%m\%d-\%H\%M\%S).db
30 3 * * * find /home/deploy/backups -type f -name 'prod-*.db' -mtime +14 -delete
```

若使用 OCI Object Storage：

- Always Free Object Storage 有容量限制，適合放少量近期備份。
- 超過容量或請求數可能收費。
- 正式營運建議至少保留一份跨雲備份，例如 Google Drive、Backblaze、NAS 或另一台 VPS。

## 12. 搬遷切換流程建議

建議採用低風險流程：

1. Oracle VM 建好但不切 DNS。
2. 搬運 `prod.db` 與 `uploads`。
3. 使用 `VPS_HOST=ORACLE_PUBLIC_IP npm run deploy:vps` 部署。
4. 用 IP 或臨時子網域測試 `/api/health`、登入、員工列表、考勤、薪資、PDF 匯出。
5. 在舊 VPS 暫停寫入或安排短維護窗。
6. 再同步一次最新 `prod.db` 與 `uploads`。
7. Oracle VM reload PM2。
8. 切 DNS 到 Oracle public IP。
9. 觀察 PM2 logs、Nginx logs、健康檢查。
10. 舊 VPS 保留至少 7 到 14 天，不要立刻刪除。

維護窗最後同步範例：

```bash
ssh deploy@OLD_VPS_IP 'pm2 stop attendance'
scp deploy@OLD_VPS_IP:/home/deploy/apps/changfu-attendance/prisma/prod.db /tmp/changfu-migration/prod.db.final
scp /tmp/changfu-migration/prod.db.final deploy@ORACLE_PUBLIC_IP:/home/deploy/apps/changfu-attendance/prisma/prod.db
ssh deploy@ORACLE_PUBLIC_IP 'cd /home/deploy/apps/changfu-attendance && . ~/.nvm/nvm.sh && npx prisma generate && pm2 restart attendance'
```

## 13. 常見問題

### A1 建立時出現 out of host capacity

這是 Oracle Always Free A1 常見狀況。可嘗試：

- 換 availability domain。
- 過幾小時或幾天再試。
- 改建立 E2.1.Micro 測試，但它只有 1GB RAM，不適合 Next.js 15 正式站。
- 你已是 Pay-as-you-go 帳號，若 A1 持續無容量，可短期改用 paid x86 / paid Arm shape 作為備案，但務必先設定 budget alert。

### 建議使用 Arm 還是 x86？

本專案是 Next.js + Prisma + SQLite，常用 npm package 大多可在 Arm64 執行。建議：

- 優先選 A1 Arm，成本最低。
- 部署後務必跑 `npm run build`、`npx prisma generate`、登入與 PDF 匯出測試。
- 若遇到套件原生 binary 不支援 Arm，再改 x86 paid instance。

### SQLite database is locked

目前部署腳本執行 `prisma migrate deploy` 時，若 PM2 正在持有 SQLite 連線，可能出現 `database is locked`。腳本會 fallback 到 `prisma db push`。若正式搬遷需要做 schema migration，建議維護窗中：

```bash
pm2 stop attendance
npx prisma migrate deploy
npx prisma generate
pm2 start attendance
```

### 是否要用 Oracle Load Balancer？

第一版不建議。單台 VM + Nginx 足夠，成本也最可控。若未來要高可用，才評估 Always Free Flexible Load Balancer 或付費 Load Balancer。

### 40 人正式站驗收項目

搬遷後請至少驗收：

- 管理員登入、員工登入。
- 員工清單、員工編輯、薪資管理調薪。
- 今日打卡、補打卡、考勤記錄月份/年份篩選。
- 班表月曆、某日班表明細、部門篩選。
- 薪資預覽、薪資產生、薪資條 PDF / CSV / Excel。
- 健保眷屬、保險設定、薪資條扣除項目。
- 40 人尖峰模擬：用 5 到 10 個瀏覽器分頁同時查詢考勤/班表/薪資頁，觀察 PM2 memory 與 CPU。

觀察指令：

```bash
pm2 monit
pm2 logs attendance --lines 100 --nostream
df -h
free -h
curl -fsS http://127.0.0.1:3000/api/health
```

## 14. 費用控管建議

1. 設定 Budget 與告警：
   - Oracle Console > Billing & Cost Management > Budgets。
   - 建議先設 US$1、US$5、US$10 告警。
2. 建立 Compartment Quotas：
   - 限制 compute OCPU、block volume GB、load balancer 數量。
3. 不要建立不必要的付費服務：
   - NAT Gateway、付費 Load Balancer、大容量 Block Volume、大量 Object Storage。
4. 每週檢查 Cost Analysis。
5. DNS 切換前不要刪舊 VPS，避免回滾時被迫重建。

## 15. 參考來源

- Oracle Cloud Free Tier：https://www.oracle.com/cloud/free/
- Oracle Cloud Free Tier FAQ：https://www.oracle.com/cloud/free/faq/
- Oracle OCI Free Tier documentation：https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm
- Oracle Always Free Resources：https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle OCI Price List：https://www.oracle.com/cloud/price-list/
- Oracle Cost Estimator：https://www.oracle.com/cloud/costestimator.html
- 專案現有 DigitalOcean 部署指南：`docs/DIGITALOCEAN_PM2_VPS_QUICKSTART.md`
- 專案部署腳本：`deploy-vps.sh`
