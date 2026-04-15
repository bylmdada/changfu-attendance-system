'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Users, Plus, Clock, CheckCircle, XCircle, Send, X, Upload, FileText, Trash2, Image as ImageIcon, File, Edit, AlertTriangle, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF, fetchWithCSRF } from '@/lib/fetchWithCSRF';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';


// 附件類型
const FILE_TYPES = [
  { value: 'ID_FRONT', label: '身分證正面' },
  { value: 'ID_BACK', label: '身分證反面' },
  { value: 'HOUSEHOLD_REGISTER', label: '戶籍謄本' },
  { value: 'HOUSEHOLD_BOOK', label: '戶口名簿' },
  { value: 'OTHER', label: '其他證明' }
];

interface Attachment {
  id: number;
  fileType: string;
  fileTypeName: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

interface Dependent {
  id: number;
  dependentName: string;
  relationship: string;
  idNumber: string;
  birthDate: string;
  isActive: boolean;
  startDate: string;
  endDate?: string;
}

interface Application {
  id: number;
  applicationType: string;
  status: string;
  dependentName: string;
  relationship: string;
  idNumber?: string;
  birthDate?: string;
  effectiveDate: string;
  remarks: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export default function MyDependentsPage() {
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [employee, setEmployee] = useState<{ id: number; name: string; department: string } | null>(null);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 申請表單
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRemoveForm, setShowRemoveForm] = useState(false);
  const [selectedDependent, setSelectedDependent] = useState<Dependent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    dependentName: '',
    relationship: '',
    idNumber: '',
    birthDate: '',
    effectiveDate: new Date().toISOString().split('T')[0],
    remarks: ''
  });

  // 附件相關狀態
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [currentApplicationId, setCurrentApplicationId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileType, setPendingFileType] = useState<string>('');

  // 編輯/撤銷相關狀態
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState<Application | null>(null);

  // 審核歷程狀態
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

  const loadData = async () => {
    try {
      const response = await fetch('/api/my-dependents', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setEmployee(data.employee);
        setDependents(data.dependents || []);
        setApplications(data.applications || []);
      }
    } catch (error) {
      console.error('載入資料失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetchJSONWithCSRF('/api/my-dependents', {
        method: 'POST',
        body: {
          applicationType: 'ADD',
          ...formData
        }
      });

      if (response.ok) {
        const data = await response.json();
        // 如果有附件需要上傳，先保存申請 ID
        if (data.id) {
          setCurrentApplicationId(data.id);
        }
        showToast('success', '加保申請已提交');
        setShowAddForm(false);
        setFormData({
          dependentName: '',
          relationship: '',
          idNumber: '',
          birthDate: '',
          effectiveDate: new Date().toISOString().split('T')[0],
          remarks: ''
        });
        setAttachments([]);
        setCurrentApplicationId(null);
        await loadData();
      } else {
        const error = await response.json();
        showToast('error', error.error || '申請失敗');
      }
    } catch (error) {
      console.error('提交失敗:', error);
      showToast('error', '提交失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // 上傳附件
  const handleUploadAttachment = async (file: File, fileType: string, applicationId: number) => {
    setUploadingType(fileType);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      formDataUpload.append('fileType', fileType);
      formDataUpload.append('applicationId', applicationId.toString());

      const response = await fetchWithCSRF('/api/my-dependents/attachments', {
        method: 'POST',
        body: formDataUpload
      });

      if (response.ok) {
        const data = await response.json();
        setAttachments(prev => [...prev, data.attachment]);
        showToast('success', '附件上傳成功');
      } else {
        const error = await response.json();
        showToast('error', error.error || '上傳失敗');
      }
    } catch (error) {
      console.error('上傳附件失敗:', error);
      showToast('error', '上傳失敗');
    } finally {
      setUploadingType(null);
    }
  };

  // 刪除附件
  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      const response = await fetchJSONWithCSRF(`/api/my-dependents/attachments?id=${attachmentId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setAttachments(prev => prev.filter(a => a.id !== attachmentId));
        showToast('success', '附件已刪除');
      } else {
        showToast('error', '刪除失敗');
      }
    } catch (error) {
      console.error('刪除附件失敗:', error);
    }
  };

  // 取得檔案圖示
  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-green-600" />;
    if (mimeType === 'application/pdf') return <FileText className="h-5 w-5 text-red-600" />;
    return <File className="h-5 w-5 text-blue-600" />;
  };

  // 格式化檔案大小
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 編輯申請
  const handleEditApplication = async (app: Application) => {
    // 取得申請詳情
    try {
      const response = await fetch(`/api/my-dependents/${app.id}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const appData = data.application;
        setEditingApplication(app);
        setFormData({
          dependentName: appData.dependentName,
          relationship: appData.relationship,
          idNumber: appData.idNumber || '',
          birthDate: appData.birthDate || '',
          effectiveDate: appData.effectiveDate,
          remarks: appData.remarks || ''
        });
        setCurrentApplicationId(app.id);
        setAttachments(appData.attachments || []);
        setShowEditForm(true);
      } else {
        showToast('error', '取得申請詳情失敗');
      }
    } catch (error) {
      console.error('取得申請詳情失敗:', error);
      showToast('error', '取得申請詳情失敗');
    }
  };

  // 更新申請
  const handleUpdateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApplication) return;
    setSubmitting(true);

    try {
      const response = await fetchJSONWithCSRF(`/api/my-dependents/${editingApplication.id}`, {
        method: 'PUT',
        body: formData
      });

      if (response.ok) {
        showToast('success', '申請已更新');
        setShowEditForm(false);
        setEditingApplication(null);
        setFormData({
          dependentName: '',
          relationship: '',
          idNumber: '',
          birthDate: '',
          effectiveDate: new Date().toISOString().split('T')[0],
          remarks: ''
        });
        setAttachments([]);
        setCurrentApplicationId(null);
        await loadData();
      } else {
        const error = await response.json();
        showToast('error', error.error || '更新失敗');
      }
    } catch (error) {
      console.error('更新申請失敗:', error);
      showToast('error', '更新失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // 撤銷申請
  const handleCancelApplication = async () => {
    if (!showCancelConfirm) return;
    setSubmitting(true);

    try {
      const response = await fetchJSONWithCSRF(`/api/my-dependents/${showCancelConfirm.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '申請已撤銷');
        setShowCancelConfirm(null);
        await loadData();
      } else {
        const error = await response.json();
        showToast('error', error.error || '撤銷失敗');
      }
    } catch (error) {
      console.error('撤銷申請失敗:', error);
      showToast('error', '撤銷失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRemove = async () => {
    if (!selectedDependent) return;
    setSubmitting(true);

    try {
      const response = await fetchJSONWithCSRF('/api/my-dependents', {
        method: 'POST',
        body: {
          applicationType: 'REMOVE',
          dependentId: selectedDependent.id,
          dependentName: selectedDependent.dependentName,
          relationship: selectedDependent.relationship,
          idNumber: selectedDependent.idNumber,
          birthDate: selectedDependent.birthDate,
          effectiveDate: formData.effectiveDate,
          remarks: formData.remarks
        }
      });

      if (response.ok) {
        showToast('success', '退保申請已提交');
        setShowRemoveForm(false);
        setSelectedDependent(null);
        await loadData();
      } else {
        const error = await response.json();
        showToast('error', error.error || '申請失敗');
      }
    } catch (error) {
      console.error('提交失敗:', error);
      showToast('error', '提交失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const relationshipOptions = ['配偶', '子女', '父親', '母親', '祖父', '祖母', '外祖父', '外祖母', '其他'];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800"><Clock className="h-3 w-3" />待審核</span>;
      case 'APPROVED':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><CheckCircle className="h-3 w-3" />已通過</span>;
      case 'REJECTED':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800"><XCircle className="h-3 w-3" />已退回</span>;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ADD': return '加保';
      case 'REMOVE': return '退保';
      case 'UPDATE': return '變更';
      default: return type;
    }
  };

  // 顯示審核歷程
  const handleShowApprovalHistory = async (appId: number) => {
    if (approvalHistoryId === appId) {
      setApprovalHistoryId(null);
      setApprovalData(null);
      return;
    }
    
    setApprovalHistoryId(appId);
    setApprovalData(null);
    
    try {
      const [reviewsRes, workflowRes] = await Promise.all([
        fetch(`/api/approval-reviews?requestType=DEPENDENT_APP&requestId=${appId}`, {
          credentials: 'include'
        }),
        fetch(`/api/approval-workflow-config?type=DEPENDENT_APP`, {
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
      <div className="max-w-4xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-3" />
            我的眷屬
          </h1>
          <p className="text-gray-600 mt-1">管理您的健保投保眷屬資料</p>
        </div>

        {/* 我的眷屬 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">目前眷屬</h2>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              申請加保
            </button>
          </div>
          
          {dependents.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>尚無眷屬資料</p>
            </div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">關係</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">生日</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {dependents.map(dep => (
                  <tr key={dep.id}>
                    <td className="px-4 py-3 text-gray-900 font-medium">{dep.dependentName}</td>
                    <td className="px-4 py-3 text-gray-600">{dep.relationship}</td>
                    <td className="px-4 py-3 text-gray-600">{dep.birthDate}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        dep.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {dep.isActive ? '投保中' : '已停保'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {dep.isActive && (
                        <button
                          onClick={() => {
                            setSelectedDependent(dep);
                            setShowRemoveForm(true);
                          }}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          申請退保
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 申請記錄 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">申請記錄</h2>
          </div>
          
          {applications.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Clock className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>尚無申請記錄</p>
            </div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">申請時間</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">眷屬</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {applications.map(app => (
                  <React.Fragment key={app.id}>
                  <tr>
                    <td className="px-4 py-3 text-gray-600 text-sm">{new Date(app.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        app.applicationType === 'ADD' ? 'bg-green-100 text-green-800' :
                        app.applicationType === 'REMOVE' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {getTypeLabel(app.applicationType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{app.dependentName}</td>
                    <td className="px-4 py-3">{getStatusBadge(app.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {app.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleEditApplication(app)}
                              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                            >
                              <Edit className="h-3 w-3" />
                              編輯
                            </button>
                            <button
                              onClick={() => setShowCancelConfirm(app)}
                              className="flex items-center gap-1 text-red-600 hover:text-red-800 text-sm"
                            >
                              <Trash2 className="h-3 w-3" />
                              撤銷
                            </button>
                          </>
                        )}
                        {/* 查看審核進度按鈕 */}
                        <button
                          onClick={() => handleShowApprovalHistory(app.id)}
                          className="flex items-center gap-1 text-gray-600 hover:text-blue-600 text-sm"
                          title="查看審核進度"
                        >
                          <Eye className="h-3 w-3" />
                          {approvalHistoryId === app.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* 展開的審核進度區域 */}
                  {approvalHistoryId === app.id && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 bg-gray-50">
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
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 加保申請表單 */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white rounded-lg max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">申請加保</h3>
                <button onClick={() => { setShowAddForm(false); setAttachments([]); setCurrentApplicationId(null); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleSubmitAdd} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">眷屬姓名 *</label>
                    <input
                      type="text"
                      required
                      value={formData.dependentName}
                      onChange={e => setFormData({ ...formData, dependentName: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">關係 *</label>
                    <select
                      required
                      value={formData.relationship}
                      onChange={e => setFormData({ ...formData, relationship: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    >
                      <option value="">請選擇</option>
                      {relationshipOptions.map(rel => (
                        <option key={rel} value={rel}>{rel}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">身分證號 *</label>
                    <input
                      type="text"
                      required
                      pattern="[A-Z][0-9]{9}"
                      value={formData.idNumber}
                      onChange={e => setFormData({ ...formData, idNumber: e.target.value.toUpperCase() })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      placeholder="A123456789"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">生日 *</label>
                    <input
                      type="date"
                      required
                      value={formData.birthDate}
                      onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">希望生效日 *</label>
                  <input
                    type="date"
                    required
                    value={formData.effectiveDate}
                    onChange={e => setFormData({ ...formData, effectiveDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                  <textarea
                    value={formData.remarks}
                    onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>

                {/* 附件上傳區 */}
                <div className="border-t pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    <Upload className="inline h-4 w-4 mr-1" />
                    證明文件上傳
                    <span className="text-xs text-gray-500 ml-2">(支援 JPG, PNG, PDF, Word)</span>
                  </label>
                  
                  {/* 上傳按鈕列表 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                    {FILE_TYPES.map(type => {
                      const uploaded = attachments.find(a => a.fileType === type.value);
                      const isUploading = uploadingType === type.value;
                      return (
                        <button
                          key={type.value}
                          type="button"
                          disabled={!!uploaded || isUploading || !currentApplicationId}
                          onClick={() => {
                            setPendingFileType(type.value);
                            fileInputRef.current?.click();
                          }}
                          className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                            uploaded 
                              ? 'bg-green-50 border-green-300 text-green-700'
                              : isUploading
                                ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                                : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                          } disabled:opacity-50`}
                        >
                          {uploaded ? <CheckCircle className="h-4 w-4" /> : isUploading ? <Clock className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {type.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 無申請 ID 提示 */}
                  {!currentApplicationId && (
                    <div className="text-center py-3 text-sm text-amber-600 bg-amber-50 rounded-lg">
                      請先點擊「先儲存申請」後再上傳附件
                    </div>
                  )}

                  {/* 已上傳附件列表 */}
                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500">已上傳附件：</p>
                      {attachments.map(att => (
                        <div key={att.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <div className="flex items-center gap-2">
                            {getFileIcon(att.mimeType)}
                            <div>
                              <p className="text-sm font-medium text-gray-900">{att.fileTypeName}</p>
                              <p className="text-xs text-gray-500">{att.fileName} ({formatFileSize(att.fileSize)})</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="p-1 text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 隱藏的檔案輸入 */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && currentApplicationId && pendingFileType) {
                        handleUploadAttachment(file, pendingFileType, currentApplicationId);
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
                
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setAttachments([]); setCurrentApplicationId(null); }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    取消
                  </button>
                  {!currentApplicationId && (
                    <button
                      type="button"
                      onClick={async () => {
                        // 先儲存申請取得 ID
                        if (!formData.dependentName || !formData.relationship || !formData.idNumber || !formData.birthDate) {
                          showToast('error', '請先填寫必填欄位');
                          return;
                        }
                        setSubmitting(true);
                        try {
                          const response = await fetchJSONWithCSRF('/api/my-dependents', {
                            method: 'POST',
                            body: {
                              applicationType: 'ADD',
                              ...formData
                            }
                          });
                          if (response.ok) {
                            const data = await response.json();
                            setCurrentApplicationId(data.id);
                            showToast('success', '申請已儲存，請上傳附件');
                          } else {
                            const error = await response.json();
                            showToast('error', error.error || '儲存失敗');
                          }
                        } catch {
                          showToast('error', '儲存失敗');
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                      disabled={submitting}
                      className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                    >
                      {submitting ? '儲存中...' : '先儲存申請'}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {submitting ? '提交中...' : currentApplicationId ? '完成' : '直接提交'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 退保申請表單 */}
        {showRemoveForm && selectedDependent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-lg w-full mx-4 p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">申請退保</h3>
                <button onClick={() => { setShowRemoveForm(false); setSelectedDependent(null); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-gray-600">眷屬姓名：<span className="font-medium text-gray-900">{selectedDependent.dependentName}</span></p>
                <p className="text-gray-600">關係：<span className="font-medium text-gray-900">{selectedDependent.relationship}</span></p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">退保生效日 *</label>
                  <input
                    type="date"
                    required
                    value={formData.effectiveDate}
                    onChange={e => setFormData({ ...formData, effectiveDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">退保原因</label>
                  <textarea
                    value={formData.remarks}
                    onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="請說明退保原因..."
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowRemoveForm(false); setSelectedDependent(null); }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmitRemove}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {submitting ? '提交中...' : '提交退保申請'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 編輯申請表單 */}
        {showEditForm && editingApplication && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white rounded-lg max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">編輯申請</h3>
                <button onClick={() => { setShowEditForm(false); setEditingApplication(null); setAttachments([]); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleUpdateApplication} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">眷屬姓名 *</label>
                    <input
                      type="text"
                      required
                      value={formData.dependentName}
                      onChange={e => setFormData({ ...formData, dependentName: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">關係 *</label>
                    <select
                      required
                      value={formData.relationship}
                      onChange={e => setFormData({ ...formData, relationship: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    >
                      <option value="">請選擇</option>
                      {relationshipOptions.map(rel => (
                        <option key={rel} value={rel}>{rel}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">身分證號 *</label>
                    <input
                      type="text"
                      required
                      pattern="[A-Z][0-9]{9}"
                      value={formData.idNumber}
                      onChange={e => setFormData({ ...formData, idNumber: e.target.value.toUpperCase() })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">生日 *</label>
                    <input
                      type="date"
                      required
                      value={formData.birthDate}
                      onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">希望生效日 *</label>
                  <input
                    type="date"
                    required
                    value={formData.effectiveDate}
                    onChange={e => setFormData({ ...formData, effectiveDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                  <textarea
                    value={formData.remarks}
                    onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>

                {/* 已上傳附件列表 */}
                {attachments.length > 0 && (
                  <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">已上傳附件</label>
                    <div className="space-y-2">
                      {attachments.map(att => (
                        <div key={att.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <div className="flex items-center gap-2">
                            {getFileIcon(att.mimeType)}
                            <div>
                              <p className="text-sm font-medium text-gray-900">{att.fileTypeName || att.fileType}</p>
                              <p className="text-xs text-gray-500">{att.fileName} ({formatFileSize(att.fileSize)})</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="p-1 text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowEditForm(false); setEditingApplication(null); setAttachments([]); }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {submitting ? '更新中...' : '更新申請'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 撤銷確認對話框 */}
        {showCancelConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-md w-full mx-4 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 rounded-full">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">確認撤銷申請</h3>
              </div>
              <p className="text-gray-600 mb-6">
                確定要撤銷 <span className="font-medium">{showCancelConfirm.dependentName}</span> 的{getTypeLabel(showCancelConfirm.applicationType)}申請嗎？此操作無法復原。
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCancelConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleCancelApplication}
                  disabled={submitting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {submitting ? '撤銷中...' : '確認撤銷'}
                </button>
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
