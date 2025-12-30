'use client';

import { useEffect, useState } from 'react';
import { 
  ClipboardList, 
  Bell, 
  CheckCircle, 
  Eye,
  MessageSquare,
  Calendar,
  User,
  AlertCircle
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface CCItem {
  id: number;
  instanceId: number;
  requestType: string;
  requestTypeName: string;
  requestId: number;
  applicantName: string;
  department: string;
  ccType: string;
  ccTypeName: string;
  reason: string | null;
  ccByName: string;
  status: string;
  statusName: string;
  createdAt: string;
}

interface Stats {
  pending: number;
  total: number;
}

export default function MyTodosPage() {
  const [loading, setLoading] = useState(true);
  const [ccs, setCCs] = useState<CCItem[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, total: 0 });
  const [filter, setFilter] = useState<'PENDING' | 'all'>('PENDING');
  const [selectedCC, setSelectedCC] = useState<CCItem | null>(null);
  const [response, setResponse] = useState('');
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadCCs();
  }, [filter]);

  const loadCCs = async () => {
    try {
      const res = await fetch(`/api/approval-cc?status=${filter}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCCs(data.ccs || []);
        setStats(data.stats || { pending: 0, total: 0 });
      }
    } catch (error) {
      console.error('載入待辦項目失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async (action: 'ACKNOWLEDGE' | 'AGREE') => {
    if (!selectedCC) return;
    
    setProcessing(true);
    setMessage(null);
    
    try {
      const res = await fetchJSONWithCSRF('/api/approval-cc', {
        method: 'POST',
        body: {
          ccId: selectedCC.id,
          action,
          response
        }
      });
      
      if (res.ok) {
        setMessage({ 
          type: 'success', 
          text: action === 'ACKNOWLEDGE' ? '已確認知悉' : '已確認同意' 
        });
        setSelectedCC(null);
        setResponse('');
        await loadCCs();
      } else {
        const error = await res.json();
        setMessage({ type: 'error', text: error.error || '操作失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '操作失敗' });
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRequestLink = (item: CCItem) => {
    const links: Record<string, string> = {
      LEAVE: `/leave-management?id=${item.requestId}`,
      OVERTIME: `/overtime-management?id=${item.requestId}`,
      MISSED_CLOCK: `/missed-clock?id=${item.requestId}`,
      SHIFT_CHANGE: `/schedule-management?id=${item.requestId}`,
      SHIFT_SWAP: `/shift-swap?id=${item.requestId}`,
      PURCHASE: `/purchase-requests?id=${item.requestId}`,
      RESIGNATION: `/resignation-management?id=${item.requestId}`,
      PAYROLL_DISPUTE: `/payroll-disputes?id=${item.requestId}`,
      DEPENDENT_APP: `/health-insurance-dependents?id=${item.requestId}`,
      ANNOUNCEMENT: `/announcements?id=${item.requestId}`
    };
    return links[item.requestType] || '#';
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-600">載入中...</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-4xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <ClipboardList className="w-8 h-8 text-blue-600 mr-3" />
            我的待辦
          </h1>
          <p className="text-gray-600 mt-2">查看需要您回應的項目</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">待處理</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">{stats.pending}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Bell className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">總數量</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-6 h-6 text-gray-600" />
              </div>
            </div>
          </div>
        </div>

        {/* 篩選標籤 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter('PENDING')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'PENDING' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            待處理
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'all' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
        </div>

        {/* 待辦列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {ccs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
              <p className="text-lg">目前沒有待處理項目</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {ccs.map(cc => (
                <div 
                  key={cc.id}
                  className={`p-4 hover:bg-gray-50 cursor-pointer transition ${
                    cc.status === 'PENDING' ? 'bg-orange-50' : ''
                  }`}
                  onClick={() => setSelectedCC(cc)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* 類型標籤 */}
                      <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                        cc.ccType === 'ACKNOWLEDGE' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {cc.ccTypeName}
                      </span>
                      
                      <span className="px-3 py-1 text-sm font-medium bg-gray-100 text-gray-800 rounded-full">
                        {cc.requestTypeName}
                      </span>
                      
                      {/* 申請人資訊 */}
                      <div>
                        <div className="flex items-center text-gray-900 font-medium">
                          <User className="w-4 h-4 mr-1 text-gray-400" />
                          {cc.applicantName}
                          <span className="text-gray-400 ml-2 text-sm">
                            {cc.department}
                          </span>
                        </div>
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <Calendar className="w-3 h-3 mr-1" />
                          {formatDate(cc.createdAt)}
                          <span className="mx-2">•</span>
                          由 {cc.ccByName} 轉會
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        cc.status === 'PENDING' 
                          ? 'bg-yellow-100 text-yellow-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {cc.statusName}
                      </span>
                    </div>
                  </div>
                  
                  {cc.reason && (
                    <div className="mt-2 ml-16 text-sm text-gray-600 flex items-start">
                      <MessageSquare className="w-4 h-4 mr-2 mt-0.5 text-gray-400" />
                      {cc.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 回應 Modal */}
        {selectedCC && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedCC.ccType === 'ACKNOWLEDGE' ? '確認知悉' : '確認同意'}
                </h3>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">申請類型：</span>
                      <span className="font-medium text-gray-900 ml-1">{selectedCC.requestTypeName}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">申請人：</span>
                      <span className="font-medium text-gray-900 ml-1">{selectedCC.applicantName}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">轉會者：</span>
                      <span className="font-medium text-gray-900 ml-1">{selectedCC.ccByName}</span>
                    </div>
                  </div>
                  
                  {selectedCC.reason && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <span className="text-gray-500 text-sm">轉會原因：</span>
                      <p className="text-gray-900 mt-1">{selectedCC.reason}</p>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <a 
                    href={getRequestLink(selectedCC)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-blue-600 hover:underline text-sm"
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    查看申請詳情 →
                  </a>
                </div>

                {selectedCC.status === 'PENDING' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      回應（選填）
                    </label>
                    <textarea
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      placeholder="輸入回應..."
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setSelectedCC(null);
                    setResponse('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                
                {selectedCC.status === 'PENDING' && (
                  <button
                    onClick={() => handleRespond(selectedCC.ccType === 'ACKNOWLEDGE' ? 'ACKNOWLEDGE' : 'AGREE')}
                    disabled={processing}
                    className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {selectedCC.ccType === 'ACKNOWLEDGE' ? '確認知悉' : '確認同意'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
