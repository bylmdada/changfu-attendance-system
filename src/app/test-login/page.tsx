'use client';

import { useState } from 'react';

export default function TestLoginPage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const createTestAccount = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-test-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`錯誤: ${error}`);
    }
    setLoading(false);
  };

  const testLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'employee',
          password: 'emp123'
        })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`登入錯誤: ${error}`);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">測試帳號診斷工具</h1>
        
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">測試帳號資訊</h2>
          <div className="bg-gray-50 p-4 rounded">
            <p><strong>帳號:</strong> employee</p>
            <p><strong>密碼:</strong> emp123</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">操作</h2>
          <div className="space-x-4">
            <button
              onClick={createTestAccount}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '處理中...' : '創建/檢查測試帳號'}
            </button>
            
            <button
              onClick={testLogin}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? '處理中...' : '測試登入'}
            </button>
          </div>
        </div>

        {result && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">結果</h2>
            <pre className="bg-gray-900 text-green-400 p-4 rounded overflow-auto text-sm">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
