# 社團法人網域與子網域設定說明

## 概述

本文件說明如何為社團法人組織申請網域，並設定子網域用於考勤系統。

---

## 網域選擇

### 推薦網域類型

| 網域 | 說明 | 適合對象 |
|------|------|---------|
| **.org.tw** | 社團法人專用 | ✅ 最推薦 |
| **.org** | 國際非營利組織 | ✅ 推薦 |
| **.tw** | 台灣通用 | 可用 |

### 範例

```
主網域：changfu.org.tw
子網域：attendance.changfu.org.tw （考勤系統）
```

---

## 網域申請

### .org.tw 申請管道

| 服務商 | 網址 | 價格 |
|-------|------|------|
| 網路中文 | net-chinese.com.tw | ~NT$800/年 |
| PChome 買網址 | myname.pchome.com.tw | ~NT$800/年 |
| HiNet 域名註冊 | domain.hinet.net | ~NT$800/年 |

### 申請所需文件

1. 社團法人立案證書
2. 負責人身份證明
3. 聯絡人資料

---

## 子網域設定

### DNS 設定

在網域註冊商的 DNS 管理介面新增 A 記錄：

| 類型 | 主機名稱 | 目標值 | TTL |
|------|---------|--------|-----|
| A | attendance | VPS IP 位址 | 3600 |

> 設定後約需 5-30 分鐘生效

---

## VPS Nginx 設定

### 1. 建立設定檔

```bash
sudo nano /etc/nginx/sites-available/attendance
```

### 2. 設定內容

```nginx
server {
    listen 80;
    server_name attendance.changfu.org.tw;

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

### 3. 啟用設定

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## SSL 憑證設定

### 安裝 Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 申請憑證

```bash
sudo certbot --nginx -d attendance.changfu.org.tw
```

### 自動續期測試

```bash
sudo certbot renew --dry-run
```

---

## 完成後架構

```
使用者瀏覽器
      ↓
https://attendance.changfu.org.tw
      ↓
DNS 解析 → VPS IP
      ↓
Nginx (443 SSL)
      ↓
反向代理 → localhost:3000
      ↓
Next.js 考勤系統
```

---

## 檢查清單

- [ ] 申請 .org.tw 網域
- [ ] 設定 DNS A 記錄
- [ ] VPS 安裝 Nginx
- [ ] 設定 Nginx 反向代理
- [ ] 申請 SSL 憑證
- [ ] 測試 HTTPS 連線
