'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  RefreshCw,
  Send,
  Users,
  FileText
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface CurrentInfo {
  currentRate: number;
  insuredBase: number;
  monthlyAmount: number;
  maxRate: number;
  minRate: number;
}

interface Application {
  id: number;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
  currentRate: number;
  requestedRate: number;
  effectiveDate: string;
  reason: string | null;
  status: string;
  hrOpinion: string | null;
  hrNote: string | null;
  hrReviewer: { id: number; name: string } | null;
  adminNote: string | null;
  adminApprover: { id: number; name: string } | null;
  createdAt: string;
}

interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'HR' | 'EMPLOYEE';
  employeeId?: number;
  employee?: {
    id: number;
    name: string;
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING_HR: { label: '待 HR 審核', color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-4 h-4" /> },
  PENDING_ADMIN: { label: '待管理員決核', color: 'bg-blue-100 text-blue-800', icon: <Clock className="w-4 h-4" /> },
  APPROVED: { label: '已核准', color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-4 h-4" /> },
  REJECTED: { label: '已駁回', color: 'bg-red-100 text-red-800', icon: <XCircle className="w-4 h-4" /> }
};

export default function PensionContributionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentInfo, setCurrentInfo] = useState<CurrentInfo | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [hasPending, setHasPending] = useState(false);
  const [pendingApplications, setPendingApplications] = useState<Application[]>([]);
  
  // 申請表單
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [requestedRate, setRequestedRate] = useState(0);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 審核表單
  const [reviewingApp, setReviewingApp] = useState<Application | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  // 取得用戶資訊
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        // 處理兩種可能的格式
        if (data.user) {
          setUser(data.user);
        } else if (data.id) {
          setUser(data);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  const isAdminOrHR = user?.role === 'ADMIN' || user?.role === 'HR';

  // 取得資料
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 取得個人資訊
      const personalRes = await fetch('/api/pension-contribution');
      if (!personalRes.ok) {
        console.error('API error:', personalRes.status);
        return;
      }
      const personalData = await personalRes.json();
      
      if (personalData.success) {
        setCurrentInfo(personalData.currentInfo);
        setApplications(personalData.applications);
        setHasPending(personalData.hasPendingApplication);
      }

      // HR/Admin 取得待審核列表
      if (isAdminOrHR) {
        const pendingRes = await fetch('/api/pension-contribution?mode=pending');
        const pendingData = await pendingRes.json();
        if (pendingData.success) {
          setPendingApplications(pendingData.applications);
        }
      }
    } catch (error) {
      console.error('取得資料失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [isAdminOrHR]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  // 提交申請
  const handleSubmit = async () => {
    if (requestedRate === currentInfo?.currentRate) {
      alert('新比例與目前相同，無需申請');
      return;
    }
    
    setSubmitting(true);
    try {
      const csrfRes = await fetch('/api/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/pension-contribution', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ requestedRate, reason })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        setShowApplyModal(false);
        setReason('');
        fetchData();
      } else {
        alert(data.error);
      }
    } catch {
      alert('提交失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // HR 審核
  const handleHRReview = async (opinion: 'AGREE' | 'DISAGREE') => {
    if (!reviewingApp) return;
    
    try {
      const csrfRes = await fetch('/api/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`/api/pension-contribution/${reviewingApp.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ opinion, note: reviewNote })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        setReviewingApp(null);
        setReviewNote('');
        fetchData();
      } else {
        alert(data.error);
      }
    } catch {
      alert('審核失敗');
    }
  };

  // Admin 決核
  const handleAdminApprove = async (action: 'APPROVE' | 'REJECT') => {
    if (!reviewingApp) return;
    
    try {
      const csrfRes = await fetch('/api/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`/api/pension-contribution/${reviewingApp.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ action, note: reviewNote })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        setReviewingApp(null);
        setReviewNote('');
        fetchData();
      } else {
        alert(data.error);
      }
    } catch {
      alert('決核失敗');
    }
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-6xl mx-auto p-6">
        {/* 標題 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Wallet className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">勞退自提管理</h1>
              <p className="text-sm text-gray-500">勞工自願提繳退休金 0-6%</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
            <p className="mt-2 text-gray-500">載入中...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 目前自提資訊卡片 */}
            <div className="bg-linear-to-r from-blue-500 to-blue-600 rounded-xl p-6 text-white">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                目前自提狀態
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-blue-100 text-sm">目前提繳比例</p>
                  <p className="text-3xl font-bold">{currentInfo?.currentRate || 0}%</p>
                </div>
                <div>
                  <p className="text-blue-100 text-sm">月提繳工資</p>
                  <p className="text-3xl font-bold">
                    ${currentInfo?.insuredBase?.toLocaleString() || 0}
                  </p>
                </div>
                <div>
                  <p className="text-blue-100 text-sm">每月自提金額</p>
                  <p className="text-3xl font-bold">
                    ${currentInfo?.monthlyAmount?.toLocaleString() || 0}
                  </p>
                </div>
              </div>
              
              {!hasPending && (
                <button
                  onClick={() => {
                    setRequestedRate(currentInfo?.currentRate || 0);
                    setShowApplyModal(true);
                  }}
                  className="mt-4 bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  申請變更比例
                </button>
              )}
              {hasPending && (
                <p className="mt-4 bg-yellow-100 text-yellow-800 px-4 py-2 rounded-lg inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  您有待處理的申請中
                </p>
              )}
            </div>

            {/* HR/Admin 待審核列表 */}
            {isAdminOrHR && pendingApplications.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900">
                  <Users className="w-5 h-5 text-orange-600" />
                  待審核申請 ({pendingApplications.length})
                </h2>
                <div className="space-y-3">
                  {pendingApplications.map(app => (
                    <div 
                      key={app.id}
                      className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        setReviewingApp(app);
                        setReviewNote('');
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{app.employee?.name}</p>
                          <p className="text-sm text-gray-600">
                            {app.employee?.department} · {app.employee?.position}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-blue-600">
                            {app.currentRate}% → {app.requestedRate}%
                          </p>
                          <p className="text-sm text-gray-600">生效日: {app.effectiveDate}</p>
                        </div>
                      </div>
                      {app.status === 'PENDING_ADMIN' && app.hrOpinion && (
                        <p className={`mt-2 text-sm ${app.hrOpinion === 'AGREE' ? 'text-green-600' : 'text-red-600'}`}>
                          HR {app.hrReviewer?.name}：{app.hrOpinion === 'AGREE' ? '同意' : '不同意'}
                          {app.hrNote && ` - ${app.hrNote}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 申請歷史 */}
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900">
                <FileText className="w-5 h-5 text-gray-600" />
                申請歷史
              </h2>
              {applications.length === 0 ? (
                <p className="text-gray-500 text-center py-8">尚無申請紀錄</p>
              ) : (
                <div className="space-y-3">
                  {applications.map(app => {
                    const statusInfo = STATUS_LABELS[app.status] || { label: app.status, color: 'bg-gray-100', icon: null };
                    return (
                      <div key={app.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${statusInfo.color}`}>
                              {statusInfo.icon}
                              {statusInfo.label}
                            </span>
                            <span className="text-sm text-gray-500">
                              {new Date(app.createdAt).toLocaleDateString('zh-TW')}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold">{app.currentRate}% → {app.requestedRate}%</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          生效日：{app.effectiveDate}
                          {app.reason && ` · 原因：${app.reason}`}
                        </p>
                        {app.hrNote && (
                          <p className="text-sm text-gray-500 mt-1">
                            HR 意見：{app.hrNote}
                          </p>
                        )}
                        {app.adminNote && (
                          <p className="text-sm text-gray-500 mt-1">
                            管理員備註：{app.adminNote}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 申請 Modal */}
        {showApplyModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-bold mb-4 text-gray-900">申請變更自提比例</h3>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  選擇新的提繳比例
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3, 4, 5, 6].map(rate => (
                    <button
                      key={rate}
                      onClick={() => setRequestedRate(rate)}
                      className={`py-2 rounded-lg border text-sm font-medium transition
                        ${requestedRate === rate 
                          ? 'bg-blue-600 text-white border-blue-600' 
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  新月提繳金額：<strong>${Math.round((currentInfo?.insuredBase || 0) * requestedRate / 100).toLocaleString()}</strong>
                </p>
                <div className="mt-2 pt-2 border-t border-blue-200">
                  <p className="text-sm font-medium text-blue-800 mb-1">
                    📅 預計生效日期：<strong>
                      {(() => {
                        const today = new Date();
                        const day = today.getDate();
                        const year = today.getFullYear();
                        const month = today.getMonth();
                        const effectiveDate = day <= 25 
                          ? new Date(year, month + 1, 1)
                          : new Date(year, month + 2, 1);
                        return effectiveDate.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
                      })()}
                    </strong>
                  </p>
                  <p className="text-xs text-blue-600">
                    {new Date().getDate() <= 25 
                      ? `📌 每月 25 日（含）前申請，次月 1 日生效` 
                      : `📌 每月 25 日後申請，隔月 1 日生效（確保 HR 有足夠作業時間）`}
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  申請原因（選填）
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm text-gray-900 border-gray-300"
                  rows={2}
                  placeholder="例如：調整退休規劃"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowApplyModal(false)}
                  className="flex-1 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '提交申請'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 審核 Modal */}
        {reviewingApp && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-bold mb-4">
                {user?.role === 'HR' ? 'HR 審核' : '管理員決核'}
              </h3>
              
              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <p className="font-medium">{reviewingApp.employee?.name}</p>
                <p className="text-sm text-gray-500">
                  {reviewingApp.employee?.department} · {reviewingApp.employee?.position}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-lg font-bold">{reviewingApp.currentRate}%</span>
                  <span>→</span>
                  <span className="text-lg font-bold text-blue-600">{reviewingApp.requestedRate}%</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">生效日：{reviewingApp.effectiveDate}</p>
                {reviewingApp.reason && (
                  <p className="text-sm text-gray-600">原因：{reviewingApp.reason}</p>
                )}
              </div>

              {/* HR 審核意見顯示（給 Admin 看） */}
              {user?.role === 'ADMIN' && reviewingApp.hrOpinion && (
                <div className={`mb-4 p-3 rounded-lg ${reviewingApp.hrOpinion === 'AGREE' ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-sm font-medium ${reviewingApp.hrOpinion === 'AGREE' ? 'text-green-800' : 'text-red-800'}`}>
                    HR {reviewingApp.hrReviewer?.name}：{reviewingApp.hrOpinion === 'AGREE' ? '同意' : '不同意'}
                  </p>
                  {reviewingApp.hrNote && (
                    <p className="text-sm text-gray-600 mt-1">{reviewingApp.hrNote}</p>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {user?.role === 'HR' ? '審核意見' : '決核備註'}（選填）
                </label>
                <textarea
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setReviewingApp(null)}
                  className="flex-1 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                {user?.role === 'HR' ? (
                  <>
                    <button
                      onClick={() => handleHRReview('DISAGREE')}
                      className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      不同意
                    </button>
                    <button
                      onClick={() => handleHRReview('AGREE')}
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      同意
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleAdminApprove('REJECT')}
                      className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      駁回
                    </button>
                    <button
                      onClick={() => handleAdminApprove('APPROVE')}
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      核准
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
