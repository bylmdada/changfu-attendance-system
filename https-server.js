/**
 * 🔒 HTTPS 開發服務器啟動腳本
 * 
 * 為考勤系統提供 HTTPS 環境，支持 GPS 定位功能
 */

const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const os = require('os');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = process.env.PORT || 3001;

// 初始化 Next.js 應用
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 獲取本機 IP 地址
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      const { address, family, internal } = interface;
      if (family === 'IPv4' && !internal) {
        return address;
      }
    }
  }
  return 'localhost';
}

// HTTPS 服務器配置
const httpsOptions = {
  key: fs.readFileSync('./certs/server.key'),
  cert: fs.readFileSync('./certs/server.crt'),
};

app.prepare().then(() => {
  const server = createServer(httpsOptions, async (req, res) => {
    try {
      // 設置 HTTPS 相關的安全標頭
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      
      // 允許跨域訪問 (開發環境)
      if (dev) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-csrf-token');
      }

      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // 錯誤處理
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`❌ 端口 ${port} 已被占用，請嘗試其他端口`);
      process.exit(1);
    } else {
      console.error('HTTPS 服務器錯誤:', err);
    }
  });

  server.listen(port, hostname, (err) => {
    if (err) throw err;
    
    const localIP = getLocalIPAddress();
    
    console.log('\n🔒 HTTPS網路服務器啟動成功！\n');
    console.log('📱 手機可使用以下網址訪問：');
    console.log(`   https://${localIP}:${port}\n`);
    console.log('💻 電腦可使用以下網址訪問：');
    console.log(`   https://localhost:${port}`);
    console.log(`   https://127.0.0.1:${port}`);
    console.log(`   https://${localIP}:${port}\n`);
    console.log('⚠️  注意事項：');
    console.log('   1. 首次訪問時瀏覽器會顯示安全警告');
    console.log('   2. 點擊「進階」→「繼續前往不安全的網站」');
    console.log('   3. 確保手機和電腦在同一個WiFi網路');
    console.log('   4. 某些公司網路可能會阻擋此類連接\n');
    console.log('🔧 如遇問題，請檢查：');
    console.log('   - 防火牆設定');
    console.log('   - 路由器設定');
    console.log('   - WiFi網路權限\n');
    console.log('🎯 GPS 定位功能現在可以在 HTTPS 環境下正常運作！');
    console.log('📊 系統監控: https://localhost:3001/system-monitoring\n');
  });
});
