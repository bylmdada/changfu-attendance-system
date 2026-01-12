'use client';

import React, { useEffect, useState } from 'react';
import { UserMinus, Search, Check, X, Clock, FileText, ChevronDown, ChevronUp, CheckCircle, AlertCircle, Users, Download, Eye } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';


interface HandoverItem {
  id: number;
  category: string;
  description: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
  assignedTo?: string;
  notes?: string;
}

interface ResignationRecord {
  id: number;
  employeeId: number;
  applicationDate: string;
  expectedDate: string;
  actualDate?: string;
  reason: string;
  reasonType: string;
  status: string;
  approvedAt?: string;
  rejectionReason?: string;
  notes?: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
  handoverItems: HandoverItem[];
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待審核', color: 'bg-yellow-100 text-yellow-800' },
  APPROVED: { label: '已核准', color: 'bg-blue-100 text-blue-800' },
  REJECTED: { label: '已拒絕', color: 'bg-red-100 text-red-800' },
  IN_HANDOVER: { label: '交接中', color: 'bg-purple-100 text-purple-800' },
  COMPLETED: { label: '已離職', color: 'bg-gray-100 text-gray-800' }
};

const REASON_TYPE_MAP: Record<string, string> = {
  VOLUNTARY: '自願離職',
  LAYOFF: '資遣',
  RETIREMENT: '退休',
  OTHER: '其他'
};

const CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  EQUIPMENT: { label: '設備', color: 'bg-blue-50 text-blue-700' },
  DATA: { label: '資料', color: 'bg-green-50 text-green-700' },
  PERMISSION: { label: '權限', color: 'bg-orange-50 text-orange-700' },
  DOCUMENT: { label: '文件', color: 'bg-purple-50 text-purple-700' },
  OTHER: { label: '其他', color: 'bg-gray-50 text-gray-700' }
};

export default function ResignationManagementPage() {
  const [records, setRecords] = useState<ResignationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ show: boolean; recordId: number | null; reason: string }>({
    show: false,
    recordId: null,
    reason: ''
  });
  
  // 離職申請表單
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: number; role: string; employee?: { id: number; name: string; department?: string } } | null>(null);
  const [applyForm, setApplyForm] = useState({
    expectedDate: '',
    reasonType: 'PERSONAL',
    reason: ''
  });

  // 審核歷程
  const [approvalHistoryId, setApprovalHistoryId] = useState<number | null>(null);
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
    labels?: Record<number, { name: string; role: string }>;
  } | null>(null);


  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 判斷是否為管理員
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';

  const loadRecords = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      // 非管理員只取自己的記錄
      if (!isAdmin) params.set('myOnly', 'true');
      
      const response = await fetch(`/api/resignation?${params}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRecords(data.records || []);
      }
    } catch (error) {
      console.error('載入離職記錄失敗:', error);
      showToast('error', '載入失敗');
    } finally {
      setLoading(false);
    }
  };

  // 取得當前用戶資料
  const fetchCurrentUser = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
      }
    } catch (error) {
      console.error('取得用戶資料失敗:', error);
    }
  };

  // 提交離職申請
  const handleApplyResignation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyForm.expectedDate || !applyForm.reason) {
      showToast('error', '請填寫預計離職日期和離職原因');
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetchJSONWithCSRF('/api/resignation', {
        method: 'POST',
        body: {
          expectedDate: applyForm.expectedDate,
          reasonType: applyForm.reasonType,
          reason: applyForm.reason
        }
      });

      if (response.ok) {
        showToast('success', '離職申請已提交');
        setShowApplyModal(false);
        setApplyForm({ expectedDate: '', reasonType: 'PERSONAL', reason: '' });
        loadRecords();
      } else {
        const error = await response.json();
        showToast('error', error.error || '申請失敗');
      }
    } catch (error) {
      console.error('提交離職申請失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setActionLoading(false);
    }
  };

  // 取得部門列表
  const departments = [...new Set(records.map(r => r.employee.department).filter(Boolean))].sort();

  // 篩選後的記錄
  const filteredRecords = records.filter(r => {
    if (departmentFilter && r.employee.department !== departmentFilter) return false;
    return true;
  });

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // 審核操作
  const handleAction = async (recordId: number, action: string, extra?: Record<string, unknown>) => {
    setActionLoading(true);
    try {
      const response = await fetchJSONWithCSRF(`/api/resignation/${recordId}`, {
        method: 'PUT',
        body: { action, ...extra }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message);
        loadRecords();
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch (error) {
      console.error('操作失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setActionLoading(false);
    }
  };

  // 更新交接項目
  const handleHandoverUpdate = async (itemId: number, completed: boolean) => {
    try {
      const response = await fetchJSONWithCSRF('/api/resignation/handover', {
        method: 'PUT',
        body: { itemId, completed }
      });

      if (response.ok) {
        showToast('success', completed ? '已標記完成' : '已取消完成');
        loadRecords();
      }
    } catch (error) {
      console.error('更新失敗:', error);
    }
  };

  // 統計
  const stats = {
    pending: records.filter(r => r.status === 'PENDING').length,
    inHandover: records.filter(r => r.status === 'IN_HANDOVER').length,
    completed: records.filter(r => r.status === 'COMPLETED').length,
    total: records.length
  };

  // 顯示審核歷程
  const handleShowApprovalHistory = async (recordId: number) => {
    if (approvalHistoryId === recordId) {
      setApprovalHistoryId(null);
      setApprovalData(null);
      return;
    }
    
    setApprovalHistoryId(recordId);
    setApprovalData(null);
    
    try {
      const [reviewsRes, workflowRes] = await Promise.all([
        fetch(`/api/approval-reviews?requestType=RESIGNATION&requestId=${recordId}`, {
          credentials: 'include'
        }),
        fetch(`/api/approval-workflow-config?type=RESIGNATION`, {
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
            <UserMinus className="w-8 h-8 text-red-600 mr-3" />
            {isAdmin ? '離職管理' : '離職申請'}
          </h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? '管理員工離職申請與交接流程' : '查看您的離職申請狀態與交接進度'}
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
              <FileText className="h-5 w-5 text-purple-600" />
              <span className="text-sm text-gray-600">交接中</span>
            </div>
            <p className="text-2xl font-bold text-purple-600 mt-2">{stats.inHandover}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-gray-600" />
              <span className="text-sm text-gray-600">已離職</span>
            </div>
            <p className="text-2xl font-bold text-gray-600 mt-2">{stats.completed}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              <span className="text-sm text-gray-600">總計</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 mt-2">{stats.total}</p>
          </div>
        </div>

        {/* 篩選 */}
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
                <option value="IN_HANDOVER">交接中</option>
                <option value="COMPLETED">已離職</option>
                <option value="REJECTED">已拒絕</option>
              </select>
              
              {/* 部門篩選 - 只有管理員可見 */}
              {isAdmin && (
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                >
                  <option value="">全部部門</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              )}
            </div>
            
            {/* 申請離職按鈕 */}
            {currentUser?.employee && (
              <button
                onClick={() => setShowApplyModal(true)}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <UserMinus className="w-4 h-4 mr-2" />
                申請離職
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        {filteredRecords.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p>暫無離職申請記錄</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map(record => (
              <div key={record.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* 主要資訊 */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="font-bold text-lg text-gray-900">{record.employee.name}</span>
                        <span className="text-sm text-gray-500 ml-2">({record.employee.employeeId})</span>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs ${STATUS_MAP[record.status]?.color || 'bg-gray-100'}`}>
                        {STATUS_MAP[record.status]?.label || record.status}
                      </span>
                      <span className="text-sm text-gray-500">
                        {REASON_TYPE_MAP[record.reasonType] || record.reasonType}
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                    >
                      {expandedId === record.id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                  </div>
                  <div className="mt-2 text-sm text-gray-600">
                    <span>部門：{record.employee.department || '-'}</span>
                    <span className="mx-3">|</span>
                    <span>申請日期：{new Date(record.applicationDate).toLocaleDateString()}</span>
                    <span className="mx-3">|</span>
                    <span>預計離職：{new Date(record.expectedDate).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* 展開詳情 */}
                {expandedId === record.id && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50">
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-700 mb-2">離職原因</h4>
                      <p className="text-gray-600 bg-white p-3 rounded border">{record.reason}</p>
                    </div>

                    {/* 交接項目 */}
                    {(record.status === 'APPROVED' || record.status === 'IN_HANDOVER') && (
                      <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">交接項目</h4>
                        <div className="space-y-2">
                          {record.handoverItems.map(item => (
                            <div key={item.id} className="flex items-center gap-3 bg-white p-3 rounded border">
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={(e) => handleHandoverUpdate(item.id, e.target.checked)}
                                className="h-5 w-5 text-blue-600"
                              />
                              <span className={`px-2 py-0.5 rounded text-xs ${CATEGORY_MAP[item.category]?.color}`}>
                                {CATEGORY_MAP[item.category]?.label}
                              </span>
                              <span className={item.completed ? 'text-gray-400 line-through' : 'text-gray-700'}>
                                {item.description}
                              </span>
                              {item.completedAt && (
                                <span className="text-xs text-gray-400 ml-auto">
                                  {new Date(item.completedAt).toLocaleDateString()} by {item.completedBy}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 pt-4 border-t border-gray-200">
                      {/* 管理員操作 - 核准/拒絕 */}
                      {isAdmin && record.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleAction(record.id, 'approve')}
                            disabled={actionLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" />
                            核准
                          </button>
                          <button
                            onClick={() => setRejectModal({ show: true, recordId: record.id, reason: '' })}
                            disabled={actionLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                            拒絕
                          </button>
                        </>
                      )}
                      {/* 員工視角 - 待審核中 */}
                      {!isAdmin && record.status === 'PENDING' && (
                        <span className="text-sm text-yellow-600 flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          您的離職申請正在審核中...
                        </span>
                      )}
                      {/* 管理員操作 - 開始交接 */}
                      {isAdmin && record.status === 'APPROVED' && (
                        <button
                          onClick={() => handleAction(record.id, 'start_handover')}
                          disabled={actionLoading}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                        >
                          <FileText className="h-4 w-4" />
                          開始交接
                        </button>
                      )}
                      {/* 員工視角 - 已核准 */}
                      {!isAdmin && record.status === 'APPROVED' && (
                        <span className="text-sm text-blue-600 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4" />
                          您的離職申請已核准，等待開始交接
                        </span>
                      )}
                      {/* 管理員操作 - 完成離職 */}
                      {isAdmin && record.status === 'IN_HANDOVER' && (
                        <button
                          onClick={() => handleAction(record.id, 'complete')}
                          disabled={actionLoading}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          完成離職
                        </button>
                      )}
                      {/* 員工視角 - 交接中 */}
                      {!isAdmin && record.status === 'IN_HANDOVER' && (
                        <span className="text-sm text-purple-600 flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          交接進行中，請完成以下交接項目
                        </span>
                      )}
                      {record.status === 'COMPLETED' && (
                        <>
                          <a
                            href={`/api/resignation/${record.id}/certificate/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                          >
                            <FileText className="h-4 w-4" />
                            預覽
                          </a>
                          <a
                            href={`/api/resignation/${record.id}/certificate`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                          >
                            <Download className="h-4 w-4" />
                            下載 PDF
                          </a>
                        </>
                      )}
                      {record.status !== 'COMPLETED' && record.status !== 'REJECTED' && (
                        <a
                          href={`/api/resignation/${record.id}/certificate/preview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          <FileText className="h-4 w-4" />
                          預覽離職證明
                        </a>
                      )}
                      
                      {/* 查看審核歷程按鈕 */}
                      <button
                        onClick={() => handleShowApprovalHistory(record.id)}
                        className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
                      >
                        <Eye className="h-4 w-4" />
                        {approvalHistoryId === record.id ? '隱藏審核歷程' : '查看審核歷程'}
                      </button>
                    </div>
                    
                    {/* 審核歷程顯示 */}
                    {approvalHistoryId === record.id && (
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
                )}
              </div>
            ))}
          </div>
        )}

        {/* 拒絕原因 Modal */}
        {rejectModal.show && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">拒絕離職申請</h3>
                <button
                  onClick={() => setRejectModal({ show: false, recordId: null, reason: '' })}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <textarea
                value={rejectModal.reason}
                onChange={(e) => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="請輸入拒絕原因..."
                className="w-full border border-gray-300 rounded-lg p-3 h-32 text-gray-900"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => setRejectModal({ show: false, recordId: null, reason: '' })}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (rejectModal.recordId && rejectModal.reason) {
                      handleAction(rejectModal.recordId, 'reject', { rejectionReason: rejectModal.reason });
                      setRejectModal({ show: false, recordId: null, reason: '' });
                    }
                  }}
                  disabled={!rejectModal.reason}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  確認拒絕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 離職申請彈窗 */}
        {showApplyModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <UserMinus className="w-5 h-5 text-red-600 mr-2" />
                  申請離職
                </h3>
                <button onClick={() => setShowApplyModal(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleApplyResignation} className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">申請人</label>
                  <p className="text-gray-900">{currentUser?.employee?.name} ({currentUser?.employee?.department})</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">預計離職日期 *</label>
                  <input
                    type="date"
                    value={applyForm.expectedDate}
                    onChange={(e) => setApplyForm({ ...applyForm, expectedDate: e.target.value })}
                    min={new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">依勞基法規定，至少需提前 10-30 天提出</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">離職原因類型</label>
                  <select
                    value={applyForm.reasonType}
                    onChange={(e) => setApplyForm({ ...applyForm, reasonType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  >
                    <option value="PERSONAL">個人因素</option>
                    <option value="CAREER">職涯發展</option>
                    <option value="FAMILY">家庭因素</option>
                    <option value="HEALTH">健康因素</option>
                    <option value="RELOCATION">搬遷</option>
                    <option value="OTHER">其他</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">離職原因說明 *</label>
                  <textarea
                    value={applyForm.reason}
                    onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 h-24 resize-none"
                    placeholder="請詳細說明離職原因..."
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
                    disabled={actionLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {actionLoading ? '提交中...' : '確認申請'}
                  </button>
                </div>
              </form>
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
