# DigitalOcean + Cloudflare SSL 部署與 Webhook 設定指南

本指南將協助您在 DigitalOcean VPS 上配置 Cloudflare SSL (Full/Strict 模式)，並固定 Telegram 與 LINE Bot 的 Webhook URL。

## 一、Cloudflare SSL 設定

### 1. 設定 SSL/TLS 模式
1. 登入 Cloudflare Dashboard。
2. 選擇您的網域（例如 `changfu.me`）。
3. 進入 **SSL/TLS** > **Overview**。
4. 將加密模式設定為 **Full (Strict)**。
   > 這確保 Cloudflare 與您的 VPS 之間的連線是加密的，且使用受信任的憑證。

### 2. 建立 Origin Certificate (源伺服器憑證)
這張憑證由 Cloudflare 簽發，安裝在您的 VPS 上，有效期可長達 15 年。

1. 進入 **SSL/TLS** > **Origin Server**。
2. 點擊 **Create Certificate**。
3. 保持預設設定 (RSA 2048, Hostnames 包含 `*.yourdomain.com` 和 `yourdomain.com`)。
4. 憑證有效期建議選擇 **15 年**。
5. 點擊 **Create**。
6. **重要**：您會看到 **Origin Certificate** (公鑰) 和 **Private Key** (私鑰)。請勿關閉視窗，您需要將這些內容複製到 VPS。

### 3. 安裝憑證到 VPS

連線到您的 VPS：
```bash
ssh deploy@your-vps-ip
```

建立存放憑證的目錄：
```bash
sudo mkdir -p /etc/nginx/ssl
```

**建立公鑰檔案：**
```bash
sudo nano /etc/nginx/ssl/cert.pem
```
* 將 Cloudflare 的 **Origin Certificate** 內容貼上並儲存。

**建立私鑰檔案：**
```bash
sudo nano /etc/nginx/ssl/key.pem
```
* 將 Cloudflare 的 **Private Key** 內容貼上並儲存。

設定權限：
```bash
sudo chmod 600 /etc/nginx/ssl/key.pem
```

---

## 二、Nginx 設定

修改 Nginx 設定檔以使用 Cloudflare 憑證。

```bash
sudo nano /etc/nginx/sites-available/attendance
```

將內容修改為：

```nginx
server {
    listen 80;
    server_name your-domain.com; # 請替換為您的網域
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com; # 請替換為您的網域

    # Cloudflare Origin Certificate
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    # 建議的 SSL 設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

測試並重啟 Nginx：
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 三、固定 Webhook URL

為了讓 Telegram 和 LINE Bot 正常運作，您必須在環境變數中設定正確的網域，並向平台註冊 Webhook。

### 1. 設定環境變數

編輯 `.env` 檔案：
```bash
cd ~/apps/changfu-attendance
nano .env
```

確保以下變數設定正確（請替換為您的實際網域）：

```env
# 應用程式網址 (重要)
NEXT_PUBLIC_APP_URL="https://your-domain.com"

# Telegram Bot 設定
TELEGRAM_BOT_TOKEN="your-bot-token"
# Webhook 路徑通常是固定的，系統會自動組合 NEXT_PUBLIC_APP_URL + 路徑
# 但如果您有自定義，請確保程式碼中使用的是正確的組合

# LINE Bot 設定
LINE_CHANNEL_ACCESS_TOKEN="your-channel-access-token"
LINE_CHANNEL_SECRET="your-channel-secret"
```

儲存後重啟應用程式：
```bash
pm2 restart attendance
```

### 2. 註冊 Telegram Webhook

您需要手動告訴 Telegram 您的 Webhook 網址。請在您的電腦或 VPS 上執行以下指令：

```bash
# 請替換 <YOUR_BOT_TOKEN> 和 <YOUR_DOMAIN>
curl -F "url=https://your-domain.com/api/webhooks/telegram" https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```

如果成功，您會看到類似回應：
`{"ok":true,"result":true,"description":"Webhook was set"}`

### 3. 註冊 LINE Webhook

1. 登入 [LINE Developers Console](https://developers.line.biz/)。
2. 選擇您的 Provider 和 Channel。
3. 進入 **Messaging API** 分頁。
4. 找到 **Webhook settings**。
5. 在 **Webhook URL** 輸入：
   `https://your-domain.com/api/webhooks/line`
6. 點擊 **Update**。
7. 點擊 **Verify** 按鈕測試連線（如果伺服器已啟動且 SSL 設定正確，應顯示 Success）。
8. 啟用 **Use webhook** 選項。

---

## 四、故障排除

### 1. Telegram Bot 沒有反應
* 檢查 `pm2 logs attendance` 是否有收到請求。
* 確認 Webhook 是否設定正確：
  ```bash
  curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
  ```

### 2. LINE Bot 沒有反應
* 在 LINE Developers Console 點擊 Verify 檢查錯誤。
* 確認 Nginx 是否正確轉發 `X-Forwarded-Proto` (LINE 需要 HTTPS)。

### 3. 瀏覽器顯示 521 Error
* 這表示 Cloudflare 無法連線到您的 VPS。
* 檢查 Nginx 是否正在執行 (`sudo systemctl status nginx`)。
* 檢查防火牆是否允許 443 port (`sudo ufw status`)。
