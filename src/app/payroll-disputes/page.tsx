'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  AlertCircle, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Plus, 
  Search, 
  DollarSign,
  FileText,
  ChevronDown,
  ChevronUp,
  X,
  Eye
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';

function getNextPayrollPeriod() {
  const now = new Date();
  const nextMonth = now.getMonth() + 2;

  return nextMonth > 12
    ? { year: now.getFullYear() + 1, month: 1 }
    : { year: now.getFullYear(), month: nextMonth };
}


interface PayrollDispute {
  id: number;
  employeeId: number;
  payrollId?: number;
  payYear: number;
  payMonth: number;
  type: string;
  description: string;
  requestedAmount?: number;
  fileUrl?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy?: number;
  reviewedAt?: string;
  reviewNote?: string;
  adjustedAmount?: number;
  adjustInYear?: number;
  adjustInMonth?: number;
  createdAt: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
  reviewer?: {
    id: number;
    name: string;
  };
}

interface User {
  id: number;
  role: string;
  employeeId: number;
  employee?: {
    id: number;
    name: string;
    department?: string;
  };
}

const DISPUTE_TYPES = [
  { value: 'OVERTIME_MISSING', label: '漏報加班', icon: '⏰' },
  { value: 'LEAVE_MISSING', label: '漏報請假（應扣未扣）', icon: '📋' },
  { value: 'CALCULATION_ERROR', label: '計算錯誤', icon: '🔢' },
  { value: 'ALLOWANCE_MISSING', label: '津貼漏發', icon: '💰' },
  { value: 'DEDUCTION_ERROR', label: '扣款錯誤', icon: '❌' },
  { value: 'OTHER', label: '其他', icon: '📝' }
];

const TYPE_LABELS: Record<string, string> = {
  OVERTIME_MISSING: '漏報加班',
  LEAVE_MISSING: '漏報請假',
  CALCULATION_ERROR: '計算錯誤',
  ALLOWANCE_MISSING: '津貼漏發',
  DEDUCTION_ERROR: '扣款錯誤',
  OTHER: '其他'
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: { label: '待審核', color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-4 w-4" /> },
  APPROVED: { label: '已核准', color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-4 w-4" /> },
  REJECTED: { label: '已拒絕', color: 'bg-red-100 text-red-800', icon: <XCircle className="h-4 w-4" /> }
};

export default function PayrollDisputesPage() {
  const [disputes, setDisputes] = useState<PayrollDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 新增申請表單
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyForm, setApplyForm] = useState({
    payYear: new Date().getFullYear(),
    payMonth: new Date().getMonth() + 1,
    type: 'OVERTIME_MISSING',
    description: '',
    requestedAmount: ''
  });
  const [submitting, setSubmitting] = useState(false);
  
  // 審核表單
  const [reviewModal, setReviewModal] = useState<{
    show: boolean;
    disputeId: number | null;
    action: 'approve' | 'reject' | null;
    reviewNote: string;
    adjustedAmount: string;
    adjustInYear: number;
    adjustInMonth: number;
  }>({
    show: false,
    disputeId: null,
    action: null,
    reviewNote: '',
    adjustedAmount: '',
    adjustInYear: getNextPayrollPeriod().year,
    adjustInMonth: getNextPayrollPeriod().month
  });
  
  // 統計
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });

  // 審核歷程
  const [approvalHistoryId, setApprovalHistoryId] = useState<number | null>(null);
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
    labels?: Record<number, { name: string; role: string }>;
  } | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
      }
    } catch (error) {
      console.error('取得用戶資料失敗:', error);
    }
  }, []);

  const fetchDisputes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      
      const response = await fetch(`/api/payroll-disputes?${params}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setDisputes(data.disputes || []);
        setStats(data.stats || { pending: 0, approved: 0, rejected: 0, total: 0 });
      }
    } catch (error) {
      console.error('載入異議申請失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchDisputes();
    }
  }, [currentUser, fetchDisputes]);

  useEffect(() => {
    const rawId = new URLSearchParams(window.location.search).get('id');
    if (!rawId) {
      return;
    }

    const targetId = Number(rawId);
    if (!Number.isInteger(targetId) || targetId < 1) {
      return;
    }

    if (disputes.some(dispute => dispute.id === targetId)) {
      setExpandedId(targetId);
    }
  }, [disputes]);

  // 提交異議申請
  const handleSubmitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyForm.description) {
      showToast('error', '請填寫異議說明');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetchJSONWithCSRF('/api/payroll-disputes', {
        method: 'POST',
        body: applyForm
      });

      if (response.ok) {
        showToast('success', '異議申請已提交');
        setShowApplyModal(false);
        setApplyForm({
          payYear: new Date().getFullYear(),
          payMonth: new Date().getMonth() + 1,
          type: 'OVERTIME_MISSING',
          description: '',
          requestedAmount: ''
        });
        fetchDisputes();
      } else {
        const error = await response.json();
        showToast('error', error.error || '提交失敗');
      }
    } catch (error) {
      console.error('提交異議失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // 審核異議
  const handleReview = async () => {
    if (!reviewModal.disputeId || !reviewModal.action) return;

    if (reviewModal.action === 'approve' && !reviewModal.adjustedAmount) {
      showToast('error', '請填寫調整金額');
      return;
    }

    if (reviewModal.action === 'reject' && !reviewModal.reviewNote) {
      showToast('error', '請填寫拒絕原因');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetchJSONWithCSRF(`/api/payroll-disputes/${reviewModal.disputeId}`, {
        method: 'PUT',
        body: {
          action: reviewModal.action,
          reviewNote: reviewModal.reviewNote,
          adjustedAmount: reviewModal.adjustedAmount,
          adjustInYear: reviewModal.adjustInYear,
          adjustInMonth: reviewModal.adjustInMonth
        }
      });

      if (response.ok) {
        const data = await response.json();
        const nextPeriod = getNextPayrollPeriod();
        showToast('success', data.message);
        setReviewModal({
          show: false,
          disputeId: null,
          action: null,
          reviewNote: '',
          adjustedAmount: '',
          adjustInYear: nextPeriod.year,
          adjustInMonth: nextPeriod.month
        });
        fetchDisputes();
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch (error) {
      console.error('審核失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // 撤回申請
  const handleWithdraw = async (disputeId: number) => {
    if (!confirm('確定要撤回此異議申請嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/payroll-disputes/${disputeId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '已撤回異議申請');
        fetchDisputes();
      } else {
        const error = await response.json();
        showToast('error', error.error || '撤回失敗');
      }
    } catch (error) {
      console.error('撤回失敗:', error);
      showToast('error', '操作失敗');
    }
  };

  // 顯示審核歷程
  const handleShowApprovalHistory = async (disputeId: number) => {
    if (approvalHistoryId === disputeId) {
      setApprovalHistoryId(null);
      setApprovalData(null);
      return;
    }
    
    setApprovalHistoryId(disputeId);
    setApprovalData(null);
    
    try {
      const [reviewsRes, workflowRes] = await Promise.all([
        fetch(`/api/approval-reviews?requestType=PAYROLL_DISPUTE&requestId=${disputeId}`, {
          credentials: 'include'
        }),
        fetch(`/api/approval-workflow-config?type=PAYROLL_DISPUTE`, {
          credentials: 'include'
        })
      ]);
      
      let labels: Record<number, { name: string; role: string }> | undefined;
      if (workflowRes.ok) {
        const workflowData = await workflowRes.json();
        labels = workflowData.labels;
      }
      
      if (reviewsRes.ok) {
        const data = await reviewsRes.json();
        setApprovalData({
          currentLevel: data.currentLevel,
          maxLevel: labels ? Object.keys(labels).length : data.maxLevel,
          status: data.status,
          reviews: data.reviews,
          labels
        });
      }
    } catch (error) {
      console.error('取得審核歷程失敗:', error);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-600">載入中...</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <DollarSign className="w-8 h-8 text-orange-600 mr-3" />
            {isAdmin ? '薪資異議管理' : '薪資異議申請'}
          </h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? '審核員工薪資異議申請' : '對薪資有疑問時可提出異議申請'}
          </p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-600" />
              <span className="text-sm text-gray-600">待審核</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600 mt-2">{stats.pending}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-sm text-gray-600">已核准</span>
            </div>
            <p className="text-2xl font-bold text-green-600 mt-2">{stats.approved}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <span className="text-sm text-gray-600">已拒絕</span>
            </div>
            <p className="text-2xl font-bold text-red-600 mt-2">{stats.rejected}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              <span className="text-sm text-gray-600">總計</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 mt-2">{stats.total}</p>
          </div>
        </div>

        {/* 篩選與操作 */}
        <div className="bg-white rounded-lg p-4 border border-gray-200 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Search className="h-5 w-5 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                <option value="">全部狀態</option>
                <option value="PENDING">待審核</option>
                <option value="APPROVED">已核准</option>
                <option value="REJECTED">已拒絕</option>
              </select>
              
              {/* 部門篩選器 - 僅管理員可見 */}
              {isAdmin && (
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                >
                  <option value="">全部部門</option>
                  {Array.from(new Set(disputes.map(d => d.employee.department).filter(Boolean))).map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              )}
            </div>
            
            {/* 申請按鈕 - 所有人都可以申請 */}
            <button
              onClick={() => setShowApplyModal(true)}
              className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              提出薪資異議
            </button>
          </div>
        </div>

        {/* 列表 */}
        {disputes
          .filter(d => !departmentFilter || d.employee.department === departmentFilter)
          .length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p>暫無薪資異議申請</p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes
              .filter(d => !departmentFilter || d.employee.department === departmentFilter)
              .map(dispute => (
              <div key={dispute.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* 主要資訊 */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {isAdmin && (
                        <div>
                          <span className="font-bold text-lg text-gray-900">{dispute.employee.name}</span>
                          <span className="text-sm text-gray-500 ml-2">({dispute.employee.department})</span>
                        </div>
                      )}
                      <span className="text-gray-700 font-medium">
                        {dispute.payYear}年{dispute.payMonth}月薪資
                      </span>
                      <span className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 ${STATUS_MAP[dispute.status]?.color}`}>
                        {STATUS_MAP[dispute.status]?.icon}
                        {STATUS_MAP[dispute.status]?.label}
                      </span>
                      <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                        {TYPE_LABELS[dispute.type] || dispute.type}
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedId(expandedId === dispute.id ? null : dispute.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                    >
                      {expandedId === dispute.id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                  </div>
                  
                  <div className="mt-2 text-sm text-gray-600">
                    申請時間：{new Date(dispute.createdAt).toLocaleDateString()}
                    {dispute.requestedAmount && (
                      <span className="ml-4">申請調整：${dispute.requestedAmount.toLocaleString()}</span>
                    )}
                  </div>
                </div>

                {/* 展開詳情 */}
                {expandedId === dispute.id && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-gray-500">異議說明：</span>
                        <p className="text-gray-900 mt-1 bg-white p-3 rounded border">{dispute.description}</p>
                      </div>

                      {dispute.status !== 'PENDING' && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-sm text-gray-500 mb-1">
                            審核人：{dispute.reviewer?.name} | 
                            審核時間：{dispute.reviewedAt ? new Date(dispute.reviewedAt).toLocaleString() : '-'}
                          </div>
                          {dispute.reviewNote && (
                            <p className="text-gray-700">審核備註：{dispute.reviewNote}</p>
                          )}
                          {dispute.status === 'APPROVED' && dispute.adjustedAmount && (
                            <p className="text-green-700 font-medium mt-2">
                              核准調整：${dispute.adjustedAmount.toLocaleString()} 
                              → 計入 {dispute.adjustInYear}年{dispute.adjustInMonth}月薪資
                            </p>
                          )}
                        </div>
                      )}

                      {/* 操作按鈕 */}
                      <div className="flex gap-2 pt-2">
                        {/* 管理員審核操作 */}
                        {isAdmin && dispute.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => {
                                const nextPeriod = getNextPayrollPeriod();
                                setReviewModal({
                                show: true,
                                disputeId: dispute.id,
                                action: 'approve',
                                reviewNote: '',
                                adjustedAmount: dispute.requestedAmount?.toString() || '',
                                adjustInYear: nextPeriod.year,
                                adjustInMonth: nextPeriod.month
                              });
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4" />
                              核准
                            </button>
                            <button
                              onClick={() => {
                                const nextPeriod = getNextPayrollPeriod();
                                setReviewModal({
                                show: true,
                                disputeId: dispute.id,
                                action: 'reject',
                                reviewNote: '',
                                adjustedAmount: '',
                                adjustInYear: nextPeriod.year,
                                adjustInMonth: nextPeriod.month
                              });
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                              <XCircle className="h-4 w-4" />
                              拒絕
                            </button>
                          </>
                        )}

                        {/* 申請人撤回操作 */}
                        {dispute.employeeId === currentUser?.employeeId && dispute.status === 'PENDING' && (
                          <button
                            onClick={() => handleWithdraw(dispute.id)}
                            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
                          >
                            撤回申請
                          </button>
                        )}

                        {/* 員工查看狀態 */}
                        {!isAdmin && dispute.status === 'PENDING' && (
                          <span className="text-sm text-yellow-600 flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            您的異議申請正在審核中...
                          </span>
                        )}
                        
                        {/* 查看審核歷程按鈕 */}
                        <button
                          onClick={() => handleShowApprovalHistory(dispute.id)}
                          className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
                        >
                          <Eye className="h-4 w-4" />
                          {approvalHistoryId === dispute.id ? '隱藏審核歷程' : '查看審核歷程'}
                        </button>
                      </div>
                      
                      {/* 審核歷程顯示 */}
                      {approvalHistoryId === dispute.id && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          {approvalData ? (
                            <ApprovalProgress
                              currentLevel={approvalData.currentLevel}
                              maxLevel={approvalData.maxLevel}
                              status={approvalData.status}
                              reviews={approvalData.reviews}
                              customLabels={approvalData.labels}
                            />
                          ) : (
                            <div className="text-center py-4 text-gray-500">
                              載入審核歷程中...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 新增異議申請彈窗 */}
        {showApplyModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <DollarSign className="w-5 h-5 text-orange-600 mr-2" />
                  提出薪資異議
                </h3>
                <button onClick={() => setShowApplyModal(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmitDispute} className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">薪資年份 *</label>
                    <select
                      value={applyForm.payYear}
                      onChange={(e) => setApplyForm({ ...applyForm, payYear: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {[new Date().getFullYear(), new Date().getFullYear() - 1].map(year => (
                        <option key={year} value={year}>{year}年</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">薪資月份 *</label>
                    <select
                      value={applyForm.payMonth}
                      onChange={(e) => setApplyForm({ ...applyForm, payMonth: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                        <option key={month} value={month}>{month}月</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">異議類型 *</label>
                  <select
                    value={applyForm.type}
                    onChange={(e) => setApplyForm({ ...applyForm, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  >
                    {DISPUTE_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.icon} {type.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">申請調整金額</label>
                  <input
                    type="number"
                    value={applyForm.requestedAmount}
                    onChange={(e) => setApplyForm({ ...applyForm, requestedAmount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    placeholder="若知道具體金額可填寫"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">異議說明 *</label>
                  <textarea
                    value={applyForm.description}
                    onChange={(e) => setApplyForm({ ...applyForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 h-24 resize-none"
                    placeholder="請詳細說明薪資異議的原因..."
                    required
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowApplyModal(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  >
                    {submitting ? '提交中...' : '提交申請'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 審核彈窗 */}
        {reviewModal.show && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {reviewModal.action === 'approve' ? '核准異議' : '拒絕異議'}
                </h3>
                <button 
                  onClick={() => setReviewModal({ ...reviewModal, show: false })} 
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {reviewModal.action === 'approve' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">實際調整金額 *</label>
                      <input
                        type="number"
                        value={reviewModal.adjustedAmount}
                        onChange={(e) => setReviewModal({ ...reviewModal, adjustedAmount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        placeholder="正數為補發，負數為扣除"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">計入年份</label>
                        <select
                          value={reviewModal.adjustInYear}
                          onChange={(e) => setReviewModal({ ...reviewModal, adjustInYear: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                          {[new Date().getFullYear(), new Date().getFullYear() + 1].map(year => (
                            <option key={year} value={year}>{year}年</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">計入月份</label>
                        <select
                          value={reviewModal.adjustInMonth}
                          onChange={(e) => setReviewModal({ ...reviewModal, adjustInMonth: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                            <option key={month} value={month}>{month}月</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {reviewModal.action === 'approve' ? '審核備註' : '拒絕原因 *'}
                  </label>
                  <textarea
                    value={reviewModal.reviewNote}
                    onChange={(e) => setReviewModal({ ...reviewModal, reviewNote: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 h-24 resize-none"
                    placeholder={reviewModal.action === 'approve' ? '選填' : '請說明拒絕原因...'}
                    required={reviewModal.action === 'reject'}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setReviewModal({ ...reviewModal, show: false })}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReview}
                    disabled={submitting}
                    className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${
                      reviewModal.action === 'approve' 
                        ? 'bg-green-600 hover:bg-green-700' 
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {submitting ? '處理中...' : reviewModal.action === 'approve' ? '確認核准' : '確認拒絕'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
            {toast.message}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
