/**
 * 📊 System Monitoring Dashboard - 系統監控儀表板
 * 
 * 提供即時系統健康監控與維護管理介面
 * 
 * @created 2024-11-10
 * @phase System Maintenance - 系統維護階段
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';

// 系統健康狀態介面
interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical' | 'maintenance';
  score: number;
  components: {
    database: ComponentHealth;
    cache: ComponentHealth;
    api: ComponentHealth;
    notifications: ComponentHealth;
    security: ComponentHealth;
    performance: ComponentHealth;
  };
  lastCheck: string;
  uptime: number;
  issues: SystemIssue[];
  recommendations: string[];
}

interface ComponentHealth {
  status: 'healthy' | 'warning' | 'critical' | 'offline';
  score: number;
  responseTime: number;
  errorRate: number;
  lastCheck: string;
  details: Record<string, unknown>;
}

interface SystemIssue {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  detectedAt: string;
  resolved: boolean;
  autoFixAvailable: boolean;
}

interface MaintenanceTask {
  id: string;
  name: string;
  type: 'scheduled' | 'emergency' | 'routine';
  category: string;
  nextRun: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'disabled';
  priority: 'low' | 'normal' | 'high' | 'critical';
}

// 主監控儀表板組件
export default function SystemMonitoringDashboard() {
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>([]);
  const [activeIssues, setActiveIssues] = useState<SystemIssue[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 獲取 CSRF Token
  const getCSRFToken = useCallback(async (): Promise<string | null> => {
    if (csrfToken) {
      return csrfToken;
    }
    
    try {
      const response = await fetch('/api/csrf-token');
      const result = await response.json();
      if (result.success) {
        setCsrfToken(result.csrfToken);
        return result.csrfToken;
      }
    } catch (err) {
      console.error('獲取 CSRF Token 失敗:', err);
    }
    return null;
  }, [csrfToken]);

  // 載入系統狀態
  const loadSystemStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/system-maintenance?action=overview');
      const result = await response.json();
      
      if (result.success) {
        setSystemHealth(result.data.health);
        setMaintenanceTasks(result.data.upcomingTasks);
        setActiveIssues(result.data.issues);
        setIsMonitoring(result.data.monitoring.isMonitoring);
        setError(null); // 清除之前的錯誤
        setLastRefresh(new Date()); // 更新刷新時間
      } else {
        setError(result.error || '載入系統狀態失敗');
      }
    } catch (err) {
      setError('網路錯誤：無法載入系統狀態');
      console.error('載入系統狀態錯誤:', err);
    } finally {
      setLoading(false);
    }
  };

  // 執行健康檢查
  const performHealthCheck = async () => {
    try {
      setLoading(true);
      const token = await getCSRFToken();
      if (!token) {
        alert('無法獲取安全令牌，請刷新頁面重試');
        return;
      }

      const response = await fetch('/api/system-maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ action: 'health-check' })
      });
      
      const result = await response.json();
      if (result.success) {
        setSystemHealth(result.data);
        alert('健康檢查已完成！');
      } else {
        alert('健康檢查失敗: ' + result.error);
      }
    } catch (err) {
      alert('健康檢查錯誤: ' + err);
    } finally {
      setLoading(false);
    }
  };

  // 切換監控狀態
  const toggleMonitoring = async () => {
    try {
      const token = await getCSRFToken();
      if (!token) {
        alert('無法獲取安全令牌，請刷新頁面重試');
        return;
      }

      const action = isMonitoring ? 'stop-monitoring' : 'start-monitoring';
      const response = await fetch('/api/system-maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ action })
      });
      
      const result = await response.json();
      if (result.success) {
        setIsMonitoring(!isMonitoring);
        alert(result.message);
      } else {
        alert('操作失敗: ' + result.error);
      }
    } catch (err) {
      alert('操作錯誤: ' + err);
    }
  };

  // 執行維護任務
  const runMaintenanceTask = async (taskId: string, taskName: string) => {
    if (!confirm(`確定要執行維護任務「${taskName}」嗎？`)) {
      return;
    }

    try {
      const token = await getCSRFToken();
      if (!token) {
        alert('無法獲取安全令牌，請刷新頁面重試');
        return;
      }

      const response = await fetch('/api/system-maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ 
          action: 'run-maintenance-task',
          taskId 
        })
      });
      
      const result = await response.json();
      alert(result.message);
      
      if (result.success) {
        loadSystemStatus(); // 重新載入狀態
      }
    } catch (err) {
      alert('執行任務錯誤: ' + err);
    }
  };

  // 系統優化
  const optimizeSystem = async () => {
    if (!confirm('確定要執行系統優化嗎？這可能會暫時影響性能。')) {
      return;
    }

    try {
      setLoading(true);
      const token = await getCSRFToken();
      if (!token) {
        alert('無法獲取安全令牌，請刷新頁面重試');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/system-maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ action: 'optimize-system' })
      });
      
      const result = await response.json();
      alert(result.message);
      
      if (result.success) {
        loadSystemStatus();
      }
    } catch (err) {
      alert('系統優化錯誤: ' + err);
    } finally {
      setLoading(false);
    }
  };

  // 獲取狀態顏色
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'critical': return 'text-red-600 bg-red-100';
      case 'offline': return 'text-gray-600 bg-gray-100';
      default: return 'text-blue-600 bg-blue-100';
    }
  };

  // 獲取優先級顏色
  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'critical': return 'text-red-800 bg-red-200';
      case 'high': return 'text-orange-800 bg-orange-200';
      case 'normal': return 'text-blue-800 bg-blue-200';
      case 'low': return 'text-gray-800 bg-gray-200';
      default: return 'text-gray-800 bg-gray-200';
    }
  };

  // 格式化時間
  const formatTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString('zh-TW');
  };

  // 格式化運行時間
  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}天 ${hours}小時 ${minutes}分鐘`;
    } else if (hours > 0) {
      return `${hours}小時 ${minutes}分鐘`;
    } else {
      return `${minutes}分鐘`;
    }
  };

  // 初始載入
  useEffect(() => {
    // 初始化時載入狀態和獲取 CSRF token
    const initialize = async () => {
      await loadSystemStatus();
      await getCSRFToken();
    };
    
    initialize();
    
    // 設定自動刷新 (每30秒)
    const interval = setInterval(loadSystemStatus, 30000);
    
    return () => clearInterval(interval);
  }, [getCSRFToken]);

  if (loading && !systemHealth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入系統監控資料...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-600 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">系統監控錯誤</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadSystemStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 標題與控制按鈕 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">🔧 系統監控儀表板</h1>
            <p className="text-gray-600 mt-2">
              即時系統健康監控與維護管理 • 
              上次檢查: {systemHealth ? formatTime(systemHealth.lastCheck) : '未知'} • 
              頁面刷新: {lastRefresh ? formatTime(lastRefresh.toISOString()) : '未知'}
            </p>
          </div>
          
          <div className="flex space-x-4">
            <button
              onClick={toggleMonitoring}
              className={`px-4 py-2 rounded font-medium ${
                isMonitoring 
                  ? 'bg-red-600 text-white hover:bg-red-700' 
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isMonitoring ? '🛑 停止監控' : '▶️ 啟動監控'}
            </button>
            
            <button
              onClick={performHealthCheck}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              🏥 健康檢查
            </button>
            
            <button
              onClick={optimizeSystem}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            >
              ⚡ 系統優化
            </button>
            
            <button
              onClick={loadSystemStatus}
              disabled={loading}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 flex items-center space-x-2"
            >
              <span className={loading ? 'animate-spin' : ''}>🔄</span>
              <span>{loading ? '刷新中...' : '刷新'}</span>
            </button>
          </div>
        </div>

        {/* 系統健康總覽 */}
        {systemHealth && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">整體健康</p>
                  <p className="text-3xl font-bold text-gray-900">{systemHealth.score}</p>
                  <p className={`text-sm px-2 py-1 rounded-full inline-block mt-2 ${getStatusColor(systemHealth.overall)}`}>
                    {systemHealth.overall.toUpperCase()}
                  </p>
                </div>
                <div className="text-4xl">
                  {systemHealth.overall === 'healthy' ? '💚' : 
                   systemHealth.overall === 'warning' ? '💛' : '❤️'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">系統運行時間</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatUptime(systemHealth.uptime)}
                  </p>
                </div>
                <div className="text-4xl">⏱️</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">活躍問題</p>
                  <p className="text-3xl font-bold text-gray-900">{activeIssues.length}</p>
                  <p className="text-sm text-gray-500">
                    {activeIssues.filter(i => i.severity === 'critical').length} 嚴重
                  </p>
                </div>
                <div className="text-4xl">
                  {activeIssues.length === 0 ? '✅' : '⚠️'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">監控狀態</p>
                  <p className={`text-lg font-bold ${isMonitoring ? 'text-green-600' : 'text-gray-600'}`}>
                    {isMonitoring ? '運行中' : '已停止'}
                  </p>
                </div>
                <div className="text-4xl">
                  {isMonitoring ? '🟢' : '🔴'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 系統組件狀態 */}
        {systemHealth && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h3 className="text-lg font-bold text-gray-900 mb-4">📊 系統組件狀態</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {Object.entries(systemHealth.components).map(([name, component]) => (
                <div key={name} className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ${getStatusColor(component.status)}`}>
                    <span className="text-2xl">
                      {name === 'database' ? '🗄️' :
                       name === 'cache' ? '💾' :
                       name === 'api' ? '🔗' :
                       name === 'notifications' ? '📢' :
                       name === 'security' ? '🔒' : '⚡'}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 capitalize">{name}</p>
                  <p className="text-sm text-gray-600">{Math.round(component.score)}分</p>
                  <p className="text-xs text-gray-500">{component.responseTime}ms</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 維護任務 */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">🔧 即將執行的維護任務</h3>
            
            {maintenanceTasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暫無待執行的維護任務</p>
            ) : (
              <div className="space-y-4">
                {maintenanceTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{task.name}</h4>
                      <p className="text-sm text-gray-600">
                        類型: {task.type} • 下次執行: {formatTime(task.nextRun)}
                      </p>
                      <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(task.priority)}`}>
                        {task.priority.toUpperCase()}
                      </span>
                    </div>
                    
                    <button
                      onClick={() => runMaintenanceTask(task.id, task.name)}
                      className="ml-4 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                    >
                      立即執行
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 系統問題 */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">⚠️ 系統問題</h3>
            
            {activeIssues.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <p className="text-green-600 font-medium">系統運行正常</p>
                <p className="text-gray-500 text-sm">未發現任何問題</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeIssues.map((issue) => (
                  <div key={issue.id} className="p-3 border-l-4 border-red-500 bg-red-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{issue.title}</h4>
                        <p className="text-sm text-gray-600 mt-1">{issue.description}</p>
                        <div className="flex items-center space-x-2 mt-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            issue.severity === 'critical' ? 'bg-red-200 text-red-800' :
                            issue.severity === 'high' ? 'bg-orange-200 text-orange-800' :
                            issue.severity === 'medium' ? 'bg-yellow-200 text-yellow-800' :
                            'bg-gray-200 text-gray-800'
                          }`}>
                            {issue.severity.toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatTime(issue.detectedAt)}
                          </span>
                          {issue.autoFixAvailable && (
                            <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                              可自動修復
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 系統建議 */}
        {systemHealth && systemHealth.recommendations.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-6 mt-8">
            <h3 className="text-lg font-bold text-blue-900 mb-4">💡 系統建議</h3>
            <ul className="space-y-2">
              {systemHealth.recommendations.map((recommendation, index) => (
                <li key={index} className="flex items-start text-blue-800">
                  <span className="mr-2">•</span>
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
