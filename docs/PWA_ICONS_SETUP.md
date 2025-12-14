# PWA 設定指南

本指南說明如何設定 PWA（Progressive Web App）圖示。

---

## 圖示需求

需要以下尺寸的 PNG 圖示：

| 尺寸 | 檔名 | 用途 |
|-----|------|------|
| 72x72 | icon-72x72.png | 小尺寸圖示 |
| 96x96 | icon-96x96.png | 中尺寸圖示 |
| 128x128 | icon-128x128.png | 中尺寸圖示 |
| 144x144 | icon-144x144.png | Windows/Android |
| 152x152 | icon-152x152.png | iOS |
| 192x192 | icon-192x192.png | Android |
| 384x384 | icon-384x384.png | 高解析度 |
| 512x512 | icon-512x512.png | Splash Screen |

---

## 圖示放置位置

將所有圖示放到：
```
public/icons/
├── icon-72x72.png
├── icon-96x96.png
├── icon-128x128.png
├── icon-144x144.png
├── icon-152x152.png
├── icon-192x192.png
├── icon-384x384.png
└── icon-512x512.png
```

---

## 產生圖示工具

### 方法一：線上工具

使用 [PWA Asset Generator](https://www.pwabuilder.com/imageGenerator) 上傳 512x512 的原始圖片，自動產生所有尺寸。

### 方法二：命令列工具

```bash
# 安裝 sharp-cli
npm install -g sharp-cli

# 從 512x512 原始圖片產生各尺寸
sharp -i original.png -o icon-72x72.png resize 72 72
sharp -i original.png -o icon-96x96.png resize 96 96
sharp -i original.png -o icon-128x128.png resize 128 128
sharp -i original.png -o icon-144x144.png resize 144 144
sharp -i original.png -o icon-152x152.png resize 152 152
sharp -i original.png -o icon-192x192.png resize 192 192
sharp -i original.png -o icon-384x384.png resize 384 384
sharp -i original.png -o icon-512x512.png resize 512 512
```

---

## 圖示設計建議

1. **簡潔明瞭**：圖示在小尺寸時也要清晰可辨
2. **品牌一致**：使用公司 Logo 或代表色
3. **正方形**：確保圖片為正方形
4. **無透明背景**：iOS 不支援透明 PNG，建議使用白色背景

---

## 暫時使用 Logo

如果尚未準備專用圖示，可以暫時使用現有的 logo.png：

```bash
# 複製現有 logo 作為暫時圖示
cp public/logo.png public/icons/icon-192x192.png
cp public/logo.png public/icons/icon-512x512.png
```

---

## 驗證 PWA 設定

1. 開啟 Chrome DevTools
2. 前往 Application 標籤
3. 點擊 Manifest
4. 確認沒有錯誤訊息

---

*最後更新：2024年12月*
