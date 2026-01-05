'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ClipboardCheck, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  User,
  Calendar,
  ChevronRight,
  FileText,
  Forward,
  Share2,
  Search
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface PendingItem {
  id: number;
  requestType: string;
  requestTypeName: string;
  requestId: number;
  applicantName: string;
  department: string;
  status: string;
  statusName: string;
  currentLevel: number;
  maxLevel: number;
  deadlineAt: string | null;
  isOverdue: boolean;
  isUrgent: boolean;
  createdAt: string;
  reviews: Array<{
    level: number;
    reviewerName: string;
    reviewerDepartment: string;
    roleShortLabel: string;
    action: string;
    comment: string | null;
    createdAt: string;
  }>;
  requestDetails?: {
    type: string;
    // 請假
    leaveType?: string;
    startDate?: string;
    endDate?: string;
    totalDays?: number;
    // 加班
    date?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
    // 補打卡
    time?: string;
    clockType?: string;
    // 公告
    title?: string;
    content?: string;
    priority?: string;
    category?: string;
    // 勞退自提
    currentRate?: number;
    requestedRate?: number;
    effectiveDate?: string;
    // 共用
    reason?: string | null;
  } | null;
}

interface Stats {
  total: number;
  urgent: number;
  overdue: number;
}

export default function ApprovalDashboardPage() {
  const _router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, urgent: 0, overdue: 0 });
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // CC/轉會功能狀態
  const [ccMode, setCcMode] = useState<'none' | 'forward' | 'cc'>('none');
  const [ccType, setCcType] = useState<'ACKNOWLEDGE' | 'AGREE'>('ACKNOWLEDGE');
  const [ccReason, setCcReason] = useState('');
  const [employees, setEmployees] = useState<{ id: number; name: string; department: string }[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: number; name: string } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [workflowSettings, setWorkflowSettings] = useState<{ enableForward: boolean; enableCC: boolean } | null>(null);
  
  // 部門篩選
  const [filterDepartment, setFilterDepartment] = useState('');
  
  // 取得部門列表
  const departments = [...new Set(pending.map(p => p.department).filter(Boolean))] as string[];

  useEffect(() => {
    loadPending();
  }, []);

  const loadPending = async () => {
    try {
      const response = await fetch('/api/approval-instances?type=pending', { 
        credentials: 'include' 
      });
      if (response.ok) {
        const data = await response.json();
        setPending(data.pending || []);
        setStats(data.stats || { total: 0, urgent: 0, overdue: 0 });
      }
    } catch (error) {
      console.error('載入待審核項目失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  // 載入員工列表
  const loadEmployees = useCallback(async () => {
    try {
      const response = await fetch('/api/employees?isActive=true', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('載入員工列表失敗:', error);
    }
  }, []);

  // 載入工作流程設定
  const loadWorkflowSettings = useCallback(async (requestType: string) => {
    try {
      const response = await fetch(`/api/system-settings/approval-workflows?type=${requestType}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setWorkflowSettings(data.workflow || null);
      }
    } catch {
      setWorkflowSettings(null);
    }
  }, []);

  // 處理 CC/轉會
  const handleCC = async () => {
    if (!selectedItem || !selectedEmployee) return;
    
    setProcessing(true);
    setMessage(null);
    
    try {
      const response = await fetchJSONWithCSRF('/api/approval-cc', {
        method: 'POST',
        body: {
          instanceId: selectedItem.id,
          ccToEmployeeId: selectedEmployee.id,
          ccToName: selectedEmployee.name,
          ccType: ccType,
          reason: ccReason,
          action: 'CREATE'
        }
      });
      
      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: ccMode === 'forward' ? '已轉會給 ' + selectedEmployee.name : '已 CC 給 ' + selectedEmployee.name
        });
        setCcMode('none');
        setSelectedEmployee(null);
        setCcReason('');
        setSelectedItem(null);
        await loadPending();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '操作失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '操作失敗' });
    } finally {
      setProcessing(false);
    }
  };

  // 當選擇項目時載入工作流程設定
  useEffect(() => {
    if (selectedItem) {
      loadWorkflowSettings(selectedItem.requestType);
      loadEmployees();
    }
  }, [selectedItem, loadWorkflowSettings, loadEmployees]);

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (!selectedItem) return;
    
    setProcessing(true);
    setMessage(null);
    
    try {
      let response;
      
      // 勞退自提使用專屬 API
      if (selectedItem.requestType === 'PENSION_CONTRIBUTION') {
        response = await fetchJSONWithCSRF(`/api/pension-contribution/${selectedItem.requestId}`, {
          method: 'PATCH',
          body: {
            action: action === 'APPROVE' ? 'APPROVE' : 'REJECT',
            note: reviewComment
          }
        });
      } else {
        // 其他申請使用通用審核 API
        response = await fetchJSONWithCSRF('/api/approval-instances', {
          method: 'POST',
          body: {
            instanceId: selectedItem.id,
            action,
            comment: reviewComment
          }
        });
      }
      
      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: action === 'APPROVE' ? '已核准' : '已退回' 
        });
        setSelectedItem(null);
        setReviewComment('');
        await loadPending();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '操作失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '操作失敗' });
    } finally {
      setProcessing(false);
    }
  };

  const getRequestLink = (item: PendingItem) => {
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
      ANNOUNCEMENT: `/announcements?id=${item.requestId}`,
      PENSION_CONTRIBUTION: `/pension-contribution`
    };
    return links[item.requestType] || '#';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getWaitingTime = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} 天`;
    return `${hours} 小時`;
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
      <div className="max-w-6xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <ClipboardCheck className="w-8 h-8 text-blue-600 mr-3" />
            審核儀表板
          </h1>
          <p className="text-gray-600 mt-2">管理待審核的各類申請</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">總待審核</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">即將逾期</p>
                <p className="text-3xl font-bold text-yellow-600 mt-1">{stats.urgent}</p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">已逾期</p>
                <p className="text-3xl font-bold text-red-600 mt-1">{stats.overdue}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>
        </div>

        {/* 待審核列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">待審核項目</h2>
            {departments.length > 0 && (
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="">全部部門</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>
          
          {pending.filter(p => !filterDepartment || p.department === filterDepartment).length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
              <p className="text-lg">目前沒有待審核項目</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {pending.filter(p => !filterDepartment || p.department === filterDepartment).map(item => (
                <div 
                  key={item.id}
                  className={`p-4 hover:bg-gray-50 cursor-pointer transition ${
                    item.isOverdue ? 'bg-red-50' : item.isUrgent ? 'bg-yellow-50' : ''
                  }`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* 緊急標記 */}
                      {item.isOverdue && (
                        <span className="px-2 py-1 text-xs font-semibold bg-red-500 text-white rounded">
                          逾期
                        </span>
                      )}
                      {item.isUrgent && !item.isOverdue && (
                        <span className="px-2 py-1 text-xs font-semibold bg-yellow-500 text-white rounded">
                          緊急
                        </span>
                      )}
                      
                      {/* 類型標籤 */}
                      <span className="px-3 py-1 text-sm font-medium bg-blue-100 text-blue-800 rounded-full">
                        {item.requestTypeName}
                      </span>
                      
                      {/* 申請人資訊 */}
                      <div>
                        <div className="flex items-center text-gray-900 font-medium">
                          <User className="w-4 h-4 mr-1 text-gray-400" />
                          {item.applicantName}
                          <span className="text-gray-400 ml-2 text-sm">
                            {item.department}
                          </span>
                        </div>
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <Calendar className="w-3 h-3 mr-1" />
                          {formatDate(item.createdAt)}
                          <span className="mx-2">•</span>
                          等待 {getWaitingTime(item.createdAt)}
                        </div>
                      </div>
                    </div>
                                        <div className="flex items-center space-x-4">
                        {/* 審核層級 */}
                        <div className="text-right">
                          <span className="text-sm text-gray-500">
                            {item.currentLevel === 1 ? '主管審核' : 
                             item.currentLevel === 2 ? 'HR會簽' : '管理員決核'}
                          </span>
                          <div className="text-xs text-gray-400">
                            第 {item.currentLevel}/{item.maxLevel} 階
                          </div>
                        </div>
                      
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 審核 Modal */}
        {selectedItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  審核 - {selectedItem.requestTypeName}
                </h3>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">申請人：</span>
                      <span className="font-medium text-gray-900 ml-1">{selectedItem.applicantName}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">部門：</span>
                      <span className="font-medium text-gray-900 ml-1">{selectedItem.department}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">申請時間：</span>
                      <span className="font-medium text-gray-900 ml-1">{formatDate(selectedItem.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">等待時間：</span>
                      <span className="font-medium text-gray-900 ml-1">{getWaitingTime(selectedItem.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* 申請詳情 */}
                {selectedItem.requestDetails && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-800 mb-3">申請詳情</h4>
                    
                    {/* 請假 */}
                    {selectedItem.requestDetails.type === 'leave' && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">假別：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.leaveType}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">天數：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.totalDays} 天</span>
                        </div>
                        <div>
                          <span className="text-gray-500">開始：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.startDate}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">結束：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.endDate}</span>
                        </div>
                        {selectedItem.requestDetails.reason && (
                          <div className="col-span-2">
                            <span className="text-gray-500">原因：</span>
                            <span className="text-gray-900 ml-1">{selectedItem.requestDetails.reason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 加班 */}
                    {selectedItem.requestDetails.type === 'overtime' && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">日期：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.date}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">時數：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.hours} 小時</span>
                        </div>
                        <div>
                          <span className="text-gray-500">開始：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.startTime}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">結束：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.endTime}</span>
                        </div>
                        {selectedItem.requestDetails.reason && (
                          <div className="col-span-2">
                            <span className="text-gray-500">原因：</span>
                            <span className="text-gray-900 ml-1">{selectedItem.requestDetails.reason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 補打卡 */}
                    {selectedItem.requestDetails.type === 'missed_clock' && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">日期：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.date}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">時間：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.time}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-gray-500">類型：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.clockType}</span>
                        </div>
                        {selectedItem.requestDetails.reason && (
                          <div className="col-span-2">
                            <span className="text-gray-500">原因：</span>
                            <span className="text-gray-900 ml-1">{selectedItem.requestDetails.reason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 公告 */}
                    {selectedItem.requestDetails.type === 'announcement' && (
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">標題：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.title}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">優先級：</span>
                          <span className="font-medium text-gray-900 ml-1">{selectedItem.requestDetails.priority}</span>
                        </div>
                        {selectedItem.requestDetails.content && (
                          <div>
                            <span className="text-gray-500">內容：</span>
                            <p className="text-gray-900 mt-1">{selectedItem.requestDetails.content}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 勞退自提 */}
                    {selectedItem.requestDetails.type === 'pension_contribution' && (
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center">
                          <span className="text-gray-500 w-24">目前比例：</span>
                          <span className="font-medium text-gray-900">{selectedItem.requestDetails.currentRate}%</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-500 w-24">申請比例：</span>
                          <span className="font-medium text-blue-600">{selectedItem.requestDetails.requestedRate}% ✨</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-500 w-24">生效日期：</span>
                          <span className="font-medium text-gray-900">{selectedItem.requestDetails.effectiveDate}</span>
                        </div>
                        {selectedItem.requestDetails.reason && (
                          <div className="flex items-start">
                            <span className="text-gray-500 w-24 flex-shrink-0">申請原因：</span>
                            <span className="text-gray-900">{selectedItem.requestDetails.reason}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="text-center">
                  <a 
                    href={getRequestLink(selectedItem)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    前往申請詳情頁面 →
                  </a>
                </div>

                {/* 審核歷程 */}
                {selectedItem.reviews.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">審核歷程</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border border-gray-200 rounded-lg">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">審核者</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-20">狀態</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">審核意見</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-24">時間</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {selectedItem.reviews.map((review, idx) => (
                            <tr key={idx} className="bg-white hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <div className="flex flex-col">
                                  <span className="text-gray-900 font-medium">
                                    {review.reviewerName}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {review.reviewerDepartment} {review.roleShortLabel}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  review.action === 'APPROVE' 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {review.action === 'APPROVE' ? '✓ 核准' : '✕ 退回'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {review.comment || <span className="text-gray-400">-</span>}
                              </td>
                              <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                                {new Date(review.createdAt).toLocaleString('zh-TW', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 審核意見 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    審核意見（選填）
                  </label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="輸入審核意見..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* CC/轉會功能 */}
                {ccMode !== 'none' && (
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <h4 className="text-sm font-medium text-blue-800 mb-3 flex items-center">
                      {ccMode === 'forward' ? <Forward className="w-4 h-4 mr-2" /> : <Share2 className="w-4 h-4 mr-2" />}
                      {ccMode === 'forward' ? '轉會給其他審核者' : 'CC 給員工知悉'}
                    </h4>
                    
                    {/* 員工選擇 */}
                    <div className="mb-3">
                      <label className="block text-xs text-gray-600 mb-1">選擇員工</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={employeeSearch}
                          onChange={(e) => setEmployeeSearch(e.target.value)}
                          placeholder="搜尋員工..."
                          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      {employeeSearch && (
                        <div className="mt-2 max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                          {employees
                            .filter(e => 
                              e.name.includes(employeeSearch) || 
                              e.department.includes(employeeSearch)
                            )
                            .slice(0, 5)
                            .map(emp => (
                              <button
                                key={emp.id}
                                onClick={() => {
                                  setSelectedEmployee({ id: emp.id, name: emp.name });
                                  setEmployeeSearch('');
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex justify-between"
                              >
                                <span>{emp.name}</span>
                                <span className="text-gray-400">{emp.department}</span>
                              </button>
                            ))
                          }
                        </div>
                      )}
                      {selectedEmployee && (
                        <div className="mt-2 flex items-center justify-between bg-white rounded px-3 py-2 border border-gray-200">
                          <span className="text-sm font-medium">{selectedEmployee.name}</span>
                          <button
                            onClick={() => setSelectedEmployee(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* CC 類型選擇 */}
                    {ccMode === 'cc' && (
                      <div className="mb-3">
                        <label className="block text-xs text-gray-600 mb-1">通知類型</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setCcType('ACKNOWLEDGE')}
                            className={`px-3 py-1 text-sm rounded ${
                              ccType === 'ACKNOWLEDGE' 
                                ? 'bg-blue-600 text-white' 
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            知悉
                          </button>
                          <button
                            onClick={() => setCcType('AGREE')}
                            className={`px-3 py-1 text-sm rounded ${
                              ccType === 'AGREE' 
                                ? 'bg-blue-600 text-white' 
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            同意
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 原因 */}
                    <div className="mb-3">
                      <label className="block text-xs text-gray-600 mb-1">原因（選填）</label>
                      <textarea
                        value={ccReason}
                        onChange={(e) => setCcReason(e.target.value)}
                        placeholder="輸入原因..."
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setCcMode('none');
                          setSelectedEmployee(null);
                          setCcReason('');
                        }}
                        className="flex-1 px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleCC}
                        disabled={!selectedEmployee || processing}
                        className="flex-1 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        確認{ccMode === 'forward' ? '轉會' : 'CC'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-between">
                {/* 左側：CC/轉會按鈕 */}
                <div className="flex gap-2">
                  {workflowSettings?.enableForward && ccMode === 'none' && (
                    <button
                      onClick={() => setCcMode('forward')}
                      className="flex items-center gap-1 px-3 py-2 text-sm text-orange-700 bg-orange-100 rounded-lg hover:bg-orange-200"
                    >
                      <Forward className="w-4 h-4" />
                      轉會
                    </button>
                  )}
                  {workflowSettings?.enableCC && ccMode === 'none' && (
                    <button
                      onClick={() => setCcMode('cc')}
                      className="flex items-center gap-1 px-3 py-2 text-sm text-purple-700 bg-purple-100 rounded-lg hover:bg-purple-200"
                    >
                      <Share2 className="w-4 h-4" />
                      CC
                    </button>
                  )}
                </div>

                {/* 右側：審核按鈕 */}
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setSelectedItem(null);
                      setReviewComment('');
                      setCcMode('none');
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleReview('REJECT')}
                    disabled={processing || ccMode !== 'none'}
                    className="flex items-center gap-2 px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    退回
                  </button>
                  <button
                    onClick={() => handleReview('APPROVE')}
                    disabled={processing || ccMode !== 'none'}
                    className="flex items-center gap-2 px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    核准
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
