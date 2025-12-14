#!/usr/bin/env node

/**
 * 🚀 快速啟動 HTTPS 服務器
 */

console.log('🔒 正在啟動 HTTPS 開發服務器...\n');

// 檢查環境
const fs = require('fs');
const path = require('path');

// 檢查證書
const keyPath = path.join(__dirname, 'certs', 'server.key');
const certPath = path.join(__dirname, 'certs', 'server.crt');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log('⚠️  SSL 證書不存在，正在生成...');
  
  // 創建證書目錄
  const certsDir = path.join(__dirname, 'certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir);
  }
  
  // 生成自簽名證書
  const { execSync } = require('child_process');
  
  try {
    // 生成私鑰
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });
    
    // 生成證書
    const configPath = path.join(__dirname, 'certs', 'localhost.conf');
    execSync(`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -config "${configPath}" -extensions v3_req`, { stdio: 'inherit' });
    
    console.log('✅ SSL 證書生成成功！');
  } catch (error) {
    console.error('❌ 證書生成失敗:', error.message);
    console.log('\n📋 請手動執行以下命令：');
    console.log(`cd certs`);
    console.log(`openssl genrsa -out server.key 2048`);
    console.log(`openssl req -new -x509 -key server.key -out server.crt -days 365 -config localhost.conf -extensions v3_req`);
    process.exit(1);
  }
}

console.log('✅ SSL 證書檢查完成');

// 啟動 HTTPS 服務器
console.log('🚀 正在啟動 Next.js HTTPS 服務器...\n');

const https = require('https');
const next = require('next');
const os = require('os');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// 獲取本地網路 IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.prepare().then(() => {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  const server = https.createServer(httpsOptions, (req, res) => {
    handle(req, res);
  });

  const port = 3001;
  const localIP = getLocalIP();

  server.listen(port, '0.0.0.0', (err) => {
    if (err) throw err;
    
    console.log('🔒 HTTPS網路服務器啟動成功！\n');
    console.log('📱 手機可使用以下網址訪問：');
    console.log(`   https://${localIP}:${port}\n`);
    console.log('💻 電腦可使用以下網址訪問：');
    console.log(`   https://localhost:${port}`);
    console.log(`   https://127.0.0.1:${port}`);
    console.log(`   https://${localIP}:${port}\n`);
    console.log('🎯 GPS 定位打卡頁面：');
    console.log(`   https://localhost:${port}/attendance`);
    console.log(`   https://${localIP}:${port}/attendance\n`);
    console.log('📊 系統監控頁面：');
    console.log(`   https://localhost:${port}/system-monitoring\n`);
    console.log('⚠️  瀏覽器安全警告處理：');
    console.log('   1. 看到「不安全」警告時點擊「進階」');
    console.log('   2. 選擇「繼續前往 localhost (不安全)」');
    console.log('   3. GPS 功能需要 HTTPS 環境才能運作\n');
    console.log('🎉 系統已就緒，可以開始使用 GPS 定位打卡！');
  });
});
