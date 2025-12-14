#!/usr/bin/env node

/**
 * 🛠️ 長福考勤系統 - 資料庫維護工具
 * 
 * 提供完整的資料庫維護功能
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class DatabaseMaintenanceTool {
  constructor() {
    this.dbPath = 'prisma/dev.db';
    this.backupDir = 'backups';
  }

  // 顯示主選單
  showMenu() {
    console.log('\n🛠️  長福考勤系統 - 資料庫維護工具');
    console.log('='.repeat(50));
    console.log('1. 📊 檢查資料庫狀態');
    console.log('2. ⚡ 執行性能優化');
    console.log('3. 💾 創建備份');
    console.log('4. 🔄 從備份恢復');
    console.log('5. 🧹 清理過期資料');
    console.log('6. 📈 生成統計報告');
    console.log('7. 🔧 修復資料庫');
    console.log('8. 📋 查看維護記錄');
    console.log('9. 🚀 執行完整維護');
    console.log('0. 退出');
    console.log('='.repeat(50));
  }

  // 檢查資料庫狀態
  async checkDatabaseStatus() {
    console.log('\n📊 檢查資料庫狀態...\n');

    try {
      // 1. 檢查檔案存在
      if (fs.existsSync(this.dbPath)) {
        const stats = fs.statSync(this.dbPath);
        console.log(`✅ 資料庫檔案: ${this.dbPath}`);
        console.log(`📁 檔案大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`📅 修改時間: ${stats.mtime.toLocaleString()}`);
      } else {
        console.log('❌ 資料庫檔案不存在！');
        return;
      }

      // 2. 檢查資料庫完整性
      console.log('\n🔍 檢查資料庫完整性...');
      const integrityCheck = execSync(`sqlite3 "${this.dbPath}" "PRAGMA integrity_check;"`, { encoding: 'utf8' });
      console.log(`✅ 完整性檢查: ${integrityCheck.trim()}`);

      // 3. 檢查 WAL 模式
      console.log('\n⚙️  檢查資料庫配置...');
      const walMode = execSync(`sqlite3 "${this.dbPath}" "PRAGMA journal_mode;"`, { encoding: 'utf8' });
      console.log(`📝 日誌模式: ${walMode.trim()}`);

      const cacheSize = execSync(`sqlite3 "${this.dbPath}" "PRAGMA cache_size;"`, { encoding: 'utf8' });
      console.log(`💾 緩存大小: ${cacheSize.trim()} pages`);

      // 4. 檢查表統計
      console.log('\n📊 資料表統計...');
      const tables = [
        'Employee',
        'User', 
        'AttendanceRecord',
        'Schedule',
        'PayrollRecord',
        'LeaveRequest',
        'OvertimeRequest'
      ];

      for (const table of tables) {
        try {
          const count = execSync(`sqlite3 "${this.dbPath}" "SELECT COUNT(*) FROM ${table};"`, { encoding: 'utf8' });
          console.log(`📋 ${table}: ${count.trim()} 筆記錄`);
        } catch (error) {
          console.log(`⚠️  ${table}: 無法取得統計`);
        }
      }

    } catch (error) {
      console.error('❌ 檢查資料庫狀態時發生錯誤:', error.message);
    }
  }

  // 執行性能優化
  async performanceOptimization() {
    console.log('\n⚡ 執行資料庫性能優化...\n');

    try {
      const optimizations = [
        { name: '啟用 WAL 模式', sql: 'PRAGMA journal_mode = WAL;' },
        { name: '設置緩存大小', sql: 'PRAGMA cache_size = -10240;' },
        { name: '啟用外鍵約束', sql: 'PRAGMA foreign_keys = ON;' },
        { name: '設置同步模式', sql: 'PRAGMA synchronous = NORMAL;' },
        { name: '設置臨時儲存', sql: 'PRAGMA temp_store = MEMORY;' },
        { name: '設置 mmap 大小', sql: 'PRAGMA mmap_size = 67108864;' },
        { name: '重建索引', sql: 'REINDEX;' },
        { name: '更新統計資訊', sql: 'ANALYZE;' }
      ];

      for (const opt of optimizations) {
        try {
          console.log(`🔧 ${opt.name}...`);
          execSync(`sqlite3 "${this.dbPath}" "${opt.sql}"`, { encoding: 'utf8' });
          console.log(`✅ ${opt.name} 完成`);
        } catch (error) {
          console.log(`⚠️  ${opt.name} 失敗: ${error.message}`);
        }
      }

      console.log('\n🎉 性能優化完成！');

    } catch (error) {
      console.error('❌ 性能優化時發生錯誤:', error.message);
    }
  }

  // 創建備份
  async createBackup() {
    console.log('\n💾 創建資料庫備份...\n');

    try {
      // 確保備份目錄存在
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `attendance_${timestamp}.db`);

      console.log('🚀 正在創建備份...');
      execSync(`sqlite3 "${this.dbPath}" ".backup '${backupPath}'"`, { encoding: 'utf8' });

      const backupStats = fs.statSync(backupPath);
      console.log(`✅ 備份完成: ${backupPath}`);
      console.log(`📁 備份大小: ${(backupStats.size / 1024 / 1024).toFixed(2)} MB`);

      // 壓縮備份 (可選)
      const gzipPath = `${backupPath}.gz`;
      console.log('📦 壓縮備份...');
      execSync(`gzip -c "${backupPath}" > "${gzipPath}"`, { encoding: 'utf8' });
      
      const gzipStats = fs.statSync(gzipPath);
      const compressionRatio = ((1 - gzipStats.size / backupStats.size) * 100).toFixed(1);
      
      console.log(`✅ 壓縮完成: ${gzipPath}`);
      console.log(`📊 壓縮率: ${compressionRatio}%`);

      // 刪除未壓縮的備份
      fs.unlinkSync(backupPath);

    } catch (error) {
      console.error('❌ 創建備份時發生錯誤:', error.message);
    }
  }

  // 清理過期資料
  async cleanupExpiredData() {
    console.log('\n🧹 清理過期資料...\n');

    try {
      const cleanupQueries = [
        {
          name: '清理3個月前的系統日誌',
          sql: `DELETE FROM SystemLog WHERE created_at < datetime('now', '-3 months');`
        },
        {
          name: '清理1年前的臨時資料',
          sql: `DELETE FROM TempData WHERE created_at < datetime('now', '-1 year');`
        },
        {
          name: '清理過期的密碼重置令牌',
          sql: `DELETE FROM PasswordResetToken WHERE expires_at < datetime('now');`
        }
      ];

      for (const cleanup of cleanupQueries) {
        try {
          console.log(`🗑️  ${cleanup.name}...`);
          const result = execSync(`sqlite3 "${this.dbPath}" "${cleanup.sql}"`, { encoding: 'utf8' });
          console.log(`✅ 完成`);
        } catch (error) {
          console.log(`⚠️  ${cleanup.name} 失敗: ${error.message}`);
        }
      }

      // 執行 VACUUM 釋放空間
      console.log('\n📦 壓縮資料庫空間...');
      execSync(`sqlite3 "${this.dbPath}" "VACUUM;"`, { encoding: 'utf8' });
      console.log('✅ 空間壓縮完成');

      console.log('\n🎉 資料清理完成！');

    } catch (error) {
      console.error('❌ 清理資料時發生錯誤:', error.message);
    }
  }

  // 生成統計報告
  async generateReport() {
    console.log('\n📈 生成資料庫統計報告...\n');

    try {
      const reportData = {};

      // 基本統計
      console.log('📊 收集基本統計...');
      const basicStats = [
        { name: '員工總數', table: 'Employee', condition: '' },
        { name: '使用者總數', table: 'User', condition: '' },
        { name: '本月出勤記錄', table: 'AttendanceRecord', condition: `WHERE DATE(clockInTime) >= '${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}-01'` },
        { name: '本月排班記錄', table: 'Schedule', condition: `WHERE date >= '${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}-01'` },
        { name: '待處理請假申請', table: 'LeaveRequest', condition: `WHERE status = 'PENDING'` },
        { name: '待處理加班申請', table: 'OvertimeRequest', condition: `WHERE status = 'PENDING'` }
      ];

      for (const stat of basicStats) {
        try {
          const count = execSync(`sqlite3 "${this.dbPath}" "SELECT COUNT(*) FROM ${stat.table} ${stat.condition};"`, { encoding: 'utf8' });
          reportData[stat.name] = parseInt(count.trim());
          console.log(`✅ ${stat.name}: ${reportData[stat.name]}`);
        } catch (error) {
          reportData[stat.name] = '無法取得';
          console.log(`⚠️  ${stat.name}: 無法取得`);
        }
      }

      // 資料庫大小資訊
      console.log('\n📁 資料庫檔案資訊...');
      if (fs.existsSync(this.dbPath)) {
        const stats = fs.statSync(this.dbPath);
        reportData['資料庫大小'] = `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
        console.log(`✅ 資料庫大小: ${reportData['資料庫大小']}`);
      }

      // 生成報告檔案
      const reportPath = `database_report_${new Date().toISOString().split('T')[0]}.json`;
      fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
      console.log(`\n📄 報告已生成: ${reportPath}`);

    } catch (error) {
      console.error('❌ 生成報告時發生錯誤:', error.message);
    }
  }

  // 修復資料庫
  async repairDatabase() {
    console.log('\n🔧 修復資料庫...\n');

    try {
      console.log('🔍 檢查資料庫完整性...');
      const integrityResult = execSync(`sqlite3 "${this.dbPath}" "PRAGMA integrity_check;"`, { encoding: 'utf8' });
      
      if (integrityResult.trim() === 'ok') {
        console.log('✅ 資料庫完整性正常');
      } else {
        console.log('⚠️  發現完整性問題:', integrityResult);
        
        console.log('🔧 嘗試修復...');
        execSync(`sqlite3 "${this.dbPath}" "REINDEX;"`, { encoding: 'utf8' });
        console.log('✅ 重建索引完成');
      }

      // 檢查和修復 WAL 檔案
      console.log('\n🔍 檢查 WAL 檔案...');
      const walPath = `${this.dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        console.log('🔧 合併 WAL 檔案...');
        execSync(`sqlite3 "${this.dbPath}" "PRAGMA wal_checkpoint(TRUNCATE);"`, { encoding: 'utf8' });
        console.log('✅ WAL 檔案處理完成');
      }

      console.log('\n🎉 資料庫修復完成！');

    } catch (error) {
      console.error('❌ 修復資料庫時發生錯誤:', error.message);
    }
  }

  // 執行完整維護
  async fullMaintenance() {
    console.log('\n🚀 執行完整資料庫維護...\n');

    const startTime = Date.now();

    try {
      console.log('📋 步驟 1/5: 檢查資料庫狀態');
      await this.checkDatabaseStatus();

      console.log('\n📋 步驟 2/5: 創建備份');
      await this.createBackup();

      console.log('\n📋 步驟 3/5: 清理過期資料');
      await this.cleanupExpiredData();

      console.log('\n📋 步驟 4/5: 性能優化');
      await this.performanceOptimization();

      console.log('\n📋 步驟 5/5: 生成報告');
      await this.generateReport();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n🎉 完整維護完成！耗時: ${duration} 秒`);

    } catch (error) {
      console.error('❌ 完整維護時發生錯誤:', error.message);
    }
  }

  // 互動式選單
  async interactiveMenu() {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

    while (true) {
      this.showMenu();
      const choice = await question('\n請選擇操作 (0-9): ');

      switch (choice) {
        case '1':
          await this.checkDatabaseStatus();
          break;
        case '2':
          await this.performanceOptimization();
          break;
        case '3':
          await this.createBackup();
          break;
        case '4':
          console.log('🔄 備份恢復功能需要手動操作，請參考維護指南');
          break;
        case '5':
          await this.cleanupExpiredData();
          break;
        case '6':
          await this.generateReport();
          break;
        case '7':
          await this.repairDatabase();
          break;
        case '8':
          console.log('📋 維護記錄功能開發中...');
          break;
        case '9':
          await this.fullMaintenance();
          break;
        case '0':
          console.log('\n👋 再見！');
          rl.close();
          return;
        default:
          console.log('\n❌ 無效選擇，請重新輸入');
      }

      await question('\n按 Enter 繼續...');
    }
  }
}

// 主程式
async function main() {
  const tool = new DatabaseMaintenanceTool();
  
  // 檢查是否有命令列參數
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // 互動式模式
    await tool.interactiveMenu();
  } else {
    // 命令列模式
    const command = args[0];
    
    switch (command) {
      case 'status':
        await tool.checkDatabaseStatus();
        break;
      case 'optimize':
        await tool.performanceOptimization();
        break;
      case 'backup':
        await tool.createBackup();
        break;
      case 'cleanup':
        await tool.cleanupExpiredData();
        break;
      case 'report':
        await tool.generateReport();
        break;
      case 'repair':
        await tool.repairDatabase();
        break;
      case 'full':
        await tool.fullMaintenance();
        break;
      default:
        console.log(`
🛠️  長福考勤系統 - 資料庫維護工具

使用方式:
  node db-maintenance.js                # 互動式模式
  node db-maintenance.js status         # 檢查狀態
  node db-maintenance.js optimize       # 性能優化
  node db-maintenance.js backup         # 創建備份
  node db-maintenance.js cleanup        # 清理資料
  node db-maintenance.js report         # 生成報告
  node db-maintenance.js repair         # 修復資料庫
  node db-maintenance.js full           # 完整維護
        `);
    }
  }
}

// 執行主程式
main().catch(console.error);
