'use client';

import { useState, useEffect } from 'react';

interface ApiResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

export default function DebugAuth() {
  const [authStatus, setAuthStatus] = useState<ApiResponse | null>(null);
  const [clockStatus, setClockStatus] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      console.log('🔍 開始檢查身份驗證狀態...');
      
      // 檢查 /api/auth/me
      const authResponse = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      
      const authData = {
        status: authResponse.status,
        ok: authResponse.ok,
        data: authResponse.ok ? await authResponse.json() : await authResponse.text()
      };
      
      setAuthStatus(authData);
      console.log('🔐 Auth API 結果:', authData);

      // 檢查 /api/attendance/clock
      const clockResponse = await fetch('/api/attendance/clock', {
        credentials: 'include'
      });
      
      const clockData = {
        status: clockResponse.status,
        ok: clockResponse.ok,
        data: clockResponse.ok ? await clockResponse.json() : await clockResponse.text()
      };
      
      setClockStatus(clockData);
      console.log('⏰ Clock API 結果:', clockData);
      
    } catch (error) {
      console.error('❌ 檢查失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8">載入中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">🔍 身份驗證調試工具</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Auth Status */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-semibold mb-4">🔐 登入狀態檢查</h2>
            <div className="space-y-2">
              <div><strong>狀態碼:</strong> {authStatus?.status}</div>
              <div><strong>是否成功:</strong> {authStatus?.ok ? '✅ 是' : '❌ 否'}</div>
              <div><strong>回應內容:</strong></div>
              <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
                {JSON.stringify(authStatus?.data, null, 2)}
              </pre>
            </div>
          </div>

          {/* Clock Status */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-semibold mb-4">⏰ 打卡 API 狀態</h2>
            <div className="space-y-2">
              <div><strong>狀態碼:</strong> {clockStatus?.status}</div>
              <div><strong>是否成功:</strong> {clockStatus?.ok ? '✅ 是' : '❌ 否'}</div>
              <div><strong>回應內容:</strong></div>
              <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
                {JSON.stringify(clockStatus?.data, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">💡 調試提示:</h3>
          <ul className="text-yellow-700 text-sm space-y-1">
            <li>• 如果登入狀態顯示 401，表示需要重新登入</li>
            <li>• 如果打卡 API 顯示 401，表示身份驗證有問題</li>
            <li>• 檢查瀏覽器開發者工具的 Console 和 Network 標籤</li>
            <li>• 確認 Cookie 是否正確設置</li>
          </ul>
        </div>

        <div className="mt-6 flex space-x-4">
          <button 
            onClick={checkAuthStatus}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            🔄 重新檢查
          </button>
          <a 
            href="/login" 
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 no-underline"
          >
            🚪 前往登入
          </a>
          <a 
            href="/attendance" 
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 no-underline"
          >
            ⏰ 前往打卡
          </a>
        </div>
      </div>
    </div>
  );
}
