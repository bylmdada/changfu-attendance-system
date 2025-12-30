'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Megaphone, Plus, Search, Filter, Edit2, Trash2, Download, 
  FileText, User, Calendar, Clock, AlertTriangle, CheckCircle,
  Eye, EyeOff, Upload, X, Building2, Pin, ChevronDown, ChevronUp
} from 'lucide-react';
import { DEPARTMENT_OPTIONS } from '@/constants/departments';
import { fetchWithCSRF, fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';


interface Announcement {
  id: number;
  title: string;
  content: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  category: 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL';
  publisherId: number;
  isPublished: boolean;
  publishedAt?: string;
  expiryDate?: string;
  scheduledPublishAt?: string; // 定時發布時間
  
  // 新增：部門相關字段
  targetDepartments?: string; // JSON格式的部門列表
  isGlobalAnnouncement?: boolean; // 是否為全員通告
  
  createdAt: string;
  updatedAt: string;
  publisher?: {
    id: number;
    name: string;
    department: string;
    position: string;
  };
  attachments?: {
    id: number;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
  }[];
}

interface CurrentUser {
  id: number;
  username: string;
  role: string;
  employeeId: number;
}

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

const PRIORITY_LABELS = {
  HIGH: '高',
  NORMAL: '普通',
  LOW: '低'
};

const PRIORITY_COLORS = {
  HIGH: 'bg-red-100 text-red-800',
  NORMAL: 'bg-blue-100 text-blue-800',
  LOW: 'bg-gray-100 text-gray-800'
};

const PRIORITY_BORDER = {
  HIGH: 'border-l-red-500',
  NORMAL: 'border-l-blue-500',
  LOW: 'border-l-gray-500'
};

// 公告類型常數
const CATEGORY_OPTIONS = [
  { value: 'PERSONNEL', label: '人事公告', icon: '🟣', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  { value: 'POLICY', label: '政策規定', icon: '🟢', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'EVENT', label: '活動通知', icon: '🟢', color: 'bg-green-100 text-green-800 border-green-200' },
  { value: 'SYSTEM', label: '系統公告', icon: '⚪', color: 'bg-gray-100 text-gray-800 border-gray-200' },
  { value: 'BENEFITS', label: '福利通知', icon: '🟡', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'URGENT', label: '緊急通知', icon: '🔴', color: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'GENERAL', label: '一般通知', icon: '⚪', color: 'bg-slate-100 text-slate-800 border-slate-200' }
];

const CATEGORY_LABELS: Record<string, string> = {
  PERSONNEL: '人事公告',
  POLICY: '政策規定',
  EVENT: '活動通知',
  SYSTEM: '系統公告',
  BENEFITS: '福利通知',
  URGENT: '緊急通知',
  GENERAL: '一般通知'
};

const CATEGORY_COLORS: Record<string, string> = {
  PERSONNEL: 'bg-purple-100 text-purple-800',
  POLICY: 'bg-blue-100 text-blue-800',
  EVENT: 'bg-green-100 text-green-800',
  SYSTEM: 'bg-gray-100 text-gray-800',
  BENEFITS: 'bg-yellow-100 text-yellow-800',
  URGENT: 'bg-red-100 text-red-800',
  GENERAL: 'bg-slate-100 text-slate-800'
};

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filteredAnnouncements, setFilteredAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLoading, setUserLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<User | null>(null);
  const [showNewAnnouncementForm, setShowNewAnnouncementForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

  // 新公告表單狀態
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    content: '',
    priority: 'NORMAL' as 'HIGH' | 'NORMAL' | 'LOW',
    category: 'GENERAL' as 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL',
    isPublished: false,
    expiryDate: '',
    scheduledPublishAt: '', // 定時發布時間
    // 新增：部門相關字段
    isGlobalAnnouncement: true, // 預設為全員通告
    selectedDepartments: [] as string[] // 選定的部門列表
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // 篩選狀態
  const [filters, setFilters] = useState({
    priority: '',
    category: '',
    isPublished: '',
    search: ''
  });

  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{
    field: 'createdAt' | 'priority' | 'isPublished' | 'expiryDate';
    direction: 'asc' | 'desc';
  }>({ field: 'createdAt', direction: 'desc' });

  // Toast 訊息狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 刪除確認對話框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; title: string } | null>(null);

  // 預覽狀態
  const [previewAnnouncement, setPreviewAnnouncement] = useState<Announcement | null>(null);

  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 審核歷程
  const [approvalHistoryId, setApprovalHistoryId] = useState<number | null>(null);
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
  } | null>(null);

  useEffect(() => {
    fetchCurrentUser();
    fetchAnnouncements();
  }, []);

  const filterAnnouncements = useCallback(() => {
    let filtered = announcements || [];

    if (filters.priority) {
      filtered = filtered.filter(ann => ann.priority === filters.priority);
    }

    if (filters.category) {
      filtered = filtered.filter(ann => ann.category === filters.category);
    }

    if (filters.isPublished !== '') {
      filtered = filtered.filter(ann => 
        ann.isPublished === (filters.isPublished === 'true')
      );
    }

    if (filters.search) {
      filtered = filtered.filter(ann =>
        ann.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        ann.content.toLowerCase().includes(filters.search.toLowerCase()) ||
        (ann.publisher?.name && ann.publisher.name.includes(filters.search))
      );
    }

    setFilteredAnnouncements(filtered);
  }, [announcements, filters]);

  useEffect(() => {
    filterAnnouncements();
  }, [filterAnnouncements]);

  const fetchCurrentUser = async () => {
    try {
      setUserLoading(true);
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.user) {
          setCurrentUser(data.user);
          setUser(data.user);
        } else if (data && data.id) {
          // 向後兼容：如果 API 返回直接的用戶對象
          setCurrentUser(data);
          setUser(data);
        }
      } else {
        console.error('Failed to fetch user:', response.status);
      }
    } catch (error) {
      console.error('獲取當前用戶失敗:', error);
    } finally {
      setUserLoading(false);
    }
  };

  const fetchAnnouncements = async () => {
    try {
      const response = await fetch('/api/announcements', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setAnnouncements(data.announcements || []);
      } else {
        console.error('獲取公告列表失敗:', response.status);
        setAnnouncements([]);
      }
    } catch (error) {
      console.error('獲取公告列表失敗:', error);
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();

    // 驗證部門選擇
    if (!newAnnouncement.isGlobalAnnouncement && newAnnouncement.selectedDepartments.length === 0) {
      alert('請至少選擇一個部門，或選擇全部部門發送通告');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('title', newAnnouncement.title);
      formData.append('content', newAnnouncement.content);
      formData.append('priority', newAnnouncement.priority);
      formData.append('category', newAnnouncement.category);
      formData.append('isPublished', newAnnouncement.isPublished.toString());
      if (newAnnouncement.expiryDate) {
        formData.append('expiryDate', newAnnouncement.expiryDate);
      }
      
      // 定時發布
      if (newAnnouncement.scheduledPublishAt) {
        formData.append('scheduledPublishAt', newAnnouncement.scheduledPublishAt);
      }

      // 新增：部門相關數據
      formData.append('isGlobalAnnouncement', newAnnouncement.isGlobalAnnouncement.toString());
      if (!newAnnouncement.isGlobalAnnouncement && newAnnouncement.selectedDepartments.length > 0) {
        formData.append('targetDepartments', JSON.stringify(newAnnouncement.selectedDepartments));
      }

      // 添加附件
      selectedFiles.forEach(file => {
        formData.append('attachments', file);
      });

      const response = await fetchWithCSRF('/api/announcements', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        setShowNewAnnouncementForm(false);
        resetForm();
        fetchAnnouncements();
      } else {
        const error = await response.json();
        alert(error.error);
      }
    } catch {
      alert('提交失敗，請稍後再試');
    }
  };

  const handleUpdateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAnnouncement) return;

    // 驗證部門選擇
    if (editingAnnouncement.isGlobalAnnouncement === false) {
      const selectedDepts = editingAnnouncement.targetDepartments 
        ? JSON.parse(editingAnnouncement.targetDepartments) 
        : [];
      if (selectedDepts.length === 0) {
        alert('請至少選擇一個部門，或選擇全部部門發送通告');
        return;
      }
    }

    try {
      const response = await fetchJSONWithCSRF(`/api/announcements/${editingAnnouncement.id}`, {
        method: 'PUT',
        body: {
          title: editingAnnouncement.title,
          content: editingAnnouncement.content,
          priority: editingAnnouncement.priority,
          category: editingAnnouncement.category || 'GENERAL',
          isPublished: editingAnnouncement.isPublished,
          expiryDate: editingAnnouncement.expiryDate || null,
          isGlobalAnnouncement: editingAnnouncement.isGlobalAnnouncement,
          targetDepartments: editingAnnouncement.isGlobalAnnouncement 
            ? null 
            : editingAnnouncement.targetDepartments
        }
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        setShowEditForm(false);
        setEditingAnnouncement(null);
        fetchAnnouncements();
      } else {
        const error = await response.json();
        alert(error.error);
      }
    } catch {
      alert('更新失敗，請稍後再試');
    }
  };

  // 顯示 Toast 訊息
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 顯示刪除確認對話框
  const showDeleteConfirm = (announcement: Announcement) => {
    setDeleteConfirm({ id: announcement.id, title: announcement.title });
  };

  // 執行刪除公告
  const handleDeleteAnnouncement = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/announcements/${deleteConfirm.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setSelectedIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(deleteConfirm.id);
          return newIds;
        });
        showToast('success', '公告刪除成功');
        fetchAnnouncements();
      } else {
        const error = await response.json();
        showToast('error', error.error || '刪除失敗');
      }
    } catch {
      showToast('error', '刪除失敗，請稍後再試');
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 快速發布/取消發布
  const handleTogglePublish = async (announcement: Announcement) => {
    try {
      const response = await fetchJSONWithCSRF(`/api/announcements/${announcement.id}`, {
        method: 'PUT',
        body: {
          title: announcement.title,
          content: announcement.content,
          priority: announcement.priority,
          isPublished: !announcement.isPublished,
          expiryDate: announcement.expiryDate || null,
          isGlobalAnnouncement: announcement.isGlobalAnnouncement,
          targetDepartments: announcement.targetDepartments
        }
      });

      if (response.ok) {
        showToast('success', `公告已${announcement.isPublished ? '取消發布' : '發布'}`);
        fetchAnnouncements();
      } else {
        showToast('error', '操作失敗');
      }
    } catch {
      showToast('error', '操作失敗，請稍後再試');
    }
  };

  // 複製公告
  const handleCopyAnnouncement = (announcement: Announcement) => {
    setNewAnnouncement({
      title: `${announcement.title} (複製)`,
      content: announcement.content,
      priority: announcement.priority,
      category: announcement.category || 'GENERAL',
      isPublished: false,
      expiryDate: '',
      scheduledPublishAt: '',
      isGlobalAnnouncement: announcement.isGlobalAnnouncement ?? true,
      selectedDepartments: announcement.targetDepartments 
        ? JSON.parse(announcement.targetDepartments) 
        : []
    });
    setShowNewAnnouncementForm(true);
    showToast('success', '已複製公告內容，請修改後儲存');
  };

  // 切換選擇公告
  const toggleSelectAnnouncement = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAnnouncements.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAnnouncements.map(ann => ann.id)));
    }
  };

  // 批量發布/取消發布
  const handleBatchTogglePublish = async (publish: boolean) => {
    if (selectedIds.size === 0) {
      showToast('error', '請先選擇公告');
      return;
    }

    try {
      const selectedAnnouncements = announcements.filter(ann => selectedIds.has(ann.id));
      const promises = selectedAnnouncements.map(ann =>
        fetchJSONWithCSRF(`/api/announcements/${ann.id}`, {
          method: 'PUT',
          body: {
            title: ann.title,
            content: ann.content,
            priority: ann.priority,
            isPublished: publish,
            expiryDate: ann.expiryDate || null,
            isGlobalAnnouncement: ann.isGlobalAnnouncement,
            targetDepartments: ann.targetDepartments
          }
        })
      );

      await Promise.all(promises);
      setSelectedIds(new Set());
      showToast('success', `已${publish ? '發布' : '取消發布'} ${selectedAnnouncements.length} 個公告`);
      fetchAnnouncements();
    } catch {
      showToast('error', '批量操作失敗');
    }
  };

  // 批量刪除
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '請先選擇公告');
      return;
    }

    if (!confirm(`確定要刪除 ${selectedIds.size} 個公告嗎？此操作無法復原。`)) return;

    try {
      const promises = Array.from(selectedIds).map(id =>
        fetchJSONWithCSRF(`/api/announcements/${id}`, {
          method: 'DELETE'
        })
      );

      await Promise.all(promises);
      setSelectedIds(new Set());
      showToast('success', `已刪除 ${selectedIds.size} 個公告`);
      fetchAnnouncements();
    } catch {
      showToast('error', '批量刪除失敗');
    }
  };

  // 排序函數
  const handleSort = (field: 'createdAt' | 'priority' | 'isPublished' | 'expiryDate') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 排序公告（緊急通知自動置頂）
  const sortedAnnouncements = [...filteredAnnouncements].sort((a, b) => {
    // 緊急通知優先置頂
    if (a.category === 'URGENT' && b.category !== 'URGENT') return -1;
    if (a.category !== 'URGENT' && b.category === 'URGENT') return 1;
    
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    
    switch (sortConfig.field) {
      case 'createdAt':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
      case 'priority': {
        const priorityOrder = { HIGH: 3, NORMAL: 2, LOW: 1 };
        return (priorityOrder[a.priority] - priorityOrder[b.priority]) * direction;
      }
      case 'isPublished':
        return ((a.isPublished ? 1 : 0) - (b.isPublished ? 1 : 0)) * direction;
      case 'expiryDate':
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return direction;
        if (!b.expiryDate) return -direction;
        return (new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()) * direction;
      default:
        return 0;
    }
  });

  // 開啟預覽
  const openPreview = (announcement: Announcement) => {
    setPreviewAnnouncement(announcement);
  };

  const handleDownloadAttachment = async (attachmentId: number, fileName: string) => {
    try {
      const response = await fetch(`/api/announcements/attachments/${attachmentId}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        alert('下載失敗');
      }
    } catch {
      alert('下載失敗，請稍後再試');
    }
  };

  const resetForm = () => {
    setNewAnnouncement({
      title: '',
      content: '',
      priority: 'NORMAL',
      category: 'GENERAL',
      isPublished: false,
      expiryDate: '',
      scheduledPublishAt: '',
      isGlobalAnnouncement: true,
      selectedDepartments: []
    });
    setSelectedFiles([]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 新增：部門選擇處理函數
  const handleDepartmentChange = (department: string, checked: boolean) => {
    if (checked) {
      setNewAnnouncement(prev => ({
        ...prev,
        selectedDepartments: [...prev.selectedDepartments, department]
      }));
    } else {
      setNewAnnouncement(prev => ({
        ...prev,
        selectedDepartments: prev.selectedDepartments.filter(d => d !== department)
      }));
    }
  };

  const handleGlobalAnnouncementChange = (isGlobal: boolean) => {
    setNewAnnouncement(prev => ({
      ...prev,
      isGlobalAnnouncement: isGlobal,
      selectedDepartments: isGlobal ? [] : prev.selectedDepartments
    }));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 顯示審核歷程
  const handleShowApprovalHistory = async (announcementId: number) => {
    if (approvalHistoryId === announcementId) {
      setApprovalHistoryId(null);
      setApprovalData(null);
      return;
    }
    
    setApprovalHistoryId(announcementId);
    setApprovalData(null);
    
    try {
      const response = await fetch(`/api/approval-reviews?requestType=ANNOUNCEMENT&requestId=${announcementId}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setApprovalData({
          currentLevel: data.currentLevel,
          maxLevel: data.maxLevel,
          status: data.status,
          reviews: data.reviews
        });
      }
    } catch (error) {
      console.error('取得審核歷程失敗:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Megaphone className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  // 更嚴格的權限檢查
  const canManage = currentUser && currentUser.role && (currentUser.role === 'ADMIN' || currentUser.role === 'HR');

  if (loading || userLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Megaphone className="w-8 h-8 text-blue-600 mr-3" />
                公告訊息管理
              </h1>
              <p className="text-gray-600 mt-2">管理系統公告，支援附件上傳</p>
            </div>
            {canManage && (
              <button
                onClick={() => setShowNewAnnouncementForm(true)}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center"
              >
                <Plus className="w-5 h-5 mr-2" />
                發布公告
              </button>
            )}
            {!canManage && currentUser && (
              <div className="text-sm text-gray-500 bg-gray-100 px-4 py-2 rounded-lg flex items-center">
                <span>👁️ 瀏覽模式 - 只能查看公告</span>
              </div>
            )}
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <FileText className="w-8 h-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總公告數</p>
                <p className="text-2xl font-bold text-gray-900">
                  {announcements.length}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">已發布</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(announcements || []).filter(ann => ann.isPublished).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
            <div className="flex items-center">
              <Pin className="w-8 h-8 text-red-600 -rotate-45" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">緊急通知</p>
                <p className="text-2xl font-bold text-red-600">
                  {(announcements || []).filter(ann => ann.category === 'URGENT').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">高優先級</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(announcements || []).filter(ann => ann.priority === 'HIGH').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-yellow-500">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-yellow-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">待定時發布</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {(announcements || []).filter(ann => 
                    ann.scheduledPublishAt && !ann.isPublished
                  ).length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 篩選和搜索 */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <div className="flex items-center mb-4">
            <Filter className="w-5 h-5 text-gray-600 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">篩選條件</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder="搜索標題、內容或發布者"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">優先級</label>
              <select
                value={filters.priority}
                onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              >
                <option value="">全部優先級</option>
                <option value="HIGH">高</option>
                <option value="NORMAL">普通</option>
                <option value="LOW">低</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">公告類型</label>
              <select
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              >
                <option value="">全部類型</option>
                {CATEGORY_OPTIONS.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            {canManage && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">狀態</label>
                <select
                  value={filters.isPublished}
                  onChange={(e) => setFilters({ ...filters, isPublished: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">全部狀態</option>
                  <option value="true">已發布</option>
                  <option value="false">草稿</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 排序和批量操作欄 */}
        <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* 全選 */}
            {canManage && filteredAnnouncements.length > 0 && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredAnnouncements.length && filteredAnnouncements.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">全選</span>
              </label>
            )}
            
            {/* 排序選項 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">排序：</span>
              <button
                onClick={() => handleSort('createdAt')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'createdAt' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                日期 {sortConfig.field === 'createdAt' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('priority')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'priority' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                優先級 {sortConfig.field === 'priority' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('isPublished')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'isPublished' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                狀態 {sortConfig.field === 'isPublished' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
            </div>
          </div>

          {/* 批量操作按鈕 */}
          {canManage && selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">已選 {selectedIds.size} 項：</span>
              <button
                onClick={() => handleBatchTogglePublish(true)}
                className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
              >
                批量發布
              </button>
              <button
                onClick={() => handleBatchTogglePublish(false)}
                className="px-3 py-1.5 text-sm bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors"
              >
                批量取消
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
              >
                批量刪除
              </button>
            </div>
          )}
        </div>

        {/* 公告列表 */}
        <div className="space-y-6">
          {sortedAnnouncements.map((announcement) => (
            <div 
              key={announcement.id} 
              className={`bg-white rounded-lg shadow border-l-4 ${
                announcement.category === 'URGENT' 
                  ? 'border-l-red-500 bg-red-50/30' 
                  : PRIORITY_BORDER[announcement.priority]
              } ${selectedIds.has(announcement.id) ? 'ring-2 ring-blue-400' : ''}`}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  {/* 勾選框 */}
                  {canManage && (
                    <div className="flex items-center mr-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(announcement.id)}
                        onChange={() => toggleSelectAnnouncement(announcement.id)}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                  )}
                  
                  <div className="flex-1">
                    <div className="flex items-center mb-2 flex-wrap gap-2">
                      {announcement.category === 'URGENT' && (
                        <span title="置頂"><Pin className="w-5 h-5 text-red-500 -rotate-45" /></span>
                      )}
                      <h3 className="text-xl font-bold text-gray-900">
                        {announcement.title}
                      </h3>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${CATEGORY_COLORS[announcement.category] || CATEGORY_COLORS.GENERAL}`}>
                        {CATEGORY_LABELS[announcement.category] || '一般通知'}
                      </span>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${PRIORITY_COLORS[announcement.priority]}`}>
                        {PRIORITY_LABELS[announcement.priority]}
                      </span>
                      {canManage ? (
                        announcement.scheduledPublishAt && !announcement.isPublished ? (
                          <span className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-50 text-yellow-700">
                            <Clock className="w-3 h-3" />
                            定時發布: {new Date(announcement.scheduledPublishAt).toLocaleString('zh-TW')}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleTogglePublish(announcement)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                              announcement.isPublished 
                                ? 'bg-green-50 text-green-700 hover:bg-green-100' 
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            } transition-colors`}
                            title={announcement.isPublished ? '點擊取消發布' : '點擊發布'}
                          >
                            {announcement.isPublished ? (
                              <><Eye className="w-3 h-3" /> 已發布</>
                            ) : (
                              <><EyeOff className="w-3 h-3" /> 草稿</>
                            )}
                          </button>
                        )
                      ) : (
                        <div className="flex items-center">
                          {announcement.isPublished ? (
                            <Eye className="w-4 h-4 text-green-600 mr-1" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-gray-400 mr-1" />
                          )}
                          <span className={`text-sm ${announcement.isPublished ? 'text-green-600' : 'text-gray-400'}`}>
                            {announcement.isPublished ? '已發布' : '草稿'}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center text-sm text-gray-500 mb-3">
                      <User className="w-4 h-4 mr-1" />
                      <span className="mr-4">
                        {announcement.publisher?.name ? `${announcement.publisher.name} - ${announcement.publisher.department}` : '未知發布者'}
                      </span>
                      <Calendar className="w-4 h-4 mr-1" />
                      <span className="mr-4">
                        {announcement.isPublished && announcement.publishedAt 
                          ? `發布於 ${new Date(announcement.publishedAt).toLocaleDateString('zh-TW')}`
                          : `創建於 ${new Date(announcement.createdAt).toLocaleDateString('zh-TW')}`
                        }
                      </span>
                      {announcement.expiryDate && (
                        <>
                          <Clock className="w-4 h-4 mr-1 text-orange-500" />
                          <span className="text-orange-600">
                            到期：{new Date(announcement.expiryDate).toLocaleDateString('zh-TW')}
                          </span>
                        </>
                      )}
                    </div>

                    {/* 新增：顯示公告對象信息 */}
                    <div className="flex items-center text-sm text-gray-500 mb-3">
                      <Building2 className="w-4 h-4 mr-1" />
                      <span>
                        {announcement.isGlobalAnnouncement ? (
                          <span className="font-medium text-blue-600">全部部門（通告）</span>
                        ) : announcement.targetDepartments ? (
                          <>
                            <span className="font-medium">指定部門：</span>
                            <span className="ml-1">
                              {JSON.parse(announcement.targetDepartments).join('、')}
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400">部門信息未設定</span>
                        )}
                      </span>
                    </div>
                  </div>
                  
                  {/* 操作按鈕 */}
                  {canManage && (
                    <div className="flex space-x-1">
                      <button
                        onClick={() => openPreview(announcement)}
                        className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
                        title="預覽"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleCopyAnnouncement(announcement)}
                        className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
                        title="複製"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingAnnouncement(announcement);
                          setShowEditForm(true);
                        }}
                        className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                        title="編輯"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => showDeleteConfirm(announcement)}
                        className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                        title="刪除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="prose max-w-none mb-4">
                  <div className="text-gray-700 whitespace-pre-wrap">
                    {announcement.content}
                  </div>
                </div>

                {/* 附件區域 */}
                {announcement.attachments && announcement.attachments.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                      <FileText className="w-4 h-4 mr-2" />
                      附件 ({announcement.attachments.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {announcement.attachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                          <div className="flex items-center flex-1 min-w-0">
                            <FileText className="w-5 h-5 text-gray-400 mr-2 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {attachment.originalName}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatFileSize(attachment.fileSize)}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownloadAttachment(attachment.id, attachment.originalName)}
                            className="ml-3 p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded"
                            title="下載"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {filteredAnnouncements.length === 0 && (
            <div className="text-center py-12">
              <Megaphone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">尚無公告記錄</p>
            </div>
          )}
        </div>
      </div>

      {/* 新增公告表單彈窗 */}
      {showNewAnnouncementForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">發布新公告</h2>
                <button
                  onClick={() => {
                    setShowNewAnnouncementForm(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmitAnnouncement} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">標題</label>
                  <input
                    type="text"
                    value={newAnnouncement.title}
                    onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    placeholder="請輸入公告標題"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">內容</label>
                  <textarea
                    value={newAnnouncement.content}
                    onChange={(e) => setNewAnnouncement({ ...newAnnouncement, content: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={8}
                    placeholder="請輸入公告內容"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">公告類型</label>
                    <select
                      value={newAnnouncement.category}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, category: e.target.value as typeof newAnnouncement.category })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    >
                      {CATEGORY_OPTIONS.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">優先級</label>
                    <select
                      value={newAnnouncement.priority}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, priority: e.target.value as 'HIGH' | 'NORMAL' | 'LOW' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    >
                      <option value="HIGH">高</option>
                      <option value="NORMAL">普通</option>
                      <option value="LOW">低</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">到期日期</label>
                    <input
                      type="date"
                      value={newAnnouncement.expiryDate}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, expiryDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    />
                    <p className="text-xs text-gray-500 mt-1">留空表示不會過期</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">定時發布</label>
                    <input
                      type="datetime-local"
                      value={newAnnouncement.scheduledPublishAt}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, scheduledPublishAt: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      min={new Date().toISOString().slice(0, 16)}
                    />
                    <p className="text-xs text-gray-500 mt-1">留空表示立即發布（若已勾選發布）</p>
                  </div>
                </div>

                {/* 新增：公告對象設定 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">公告對象</label>
                  
                  <div className="space-y-3">
                    {/* 全員通告選項 */}
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id="globalAnnouncement"
                        name="announcementTarget"
                        checked={newAnnouncement.isGlobalAnnouncement}
                        onChange={() => handleGlobalAnnouncementChange(true)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="globalAnnouncement" className="ml-2 text-sm text-gray-700">
                        <span className="font-medium">全部部門</span> - 通告性質，所有員工都會收到
                      </label>
                    </div>

                    {/* 特定部門選項 */}
                    <div className="flex items-start">
                      <input
                        type="radio"
                        id="specificDepartments"
                        name="announcementTarget"
                        checked={!newAnnouncement.isGlobalAnnouncement}
                        onChange={() => handleGlobalAnnouncementChange(false)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mt-0.5"
                      />
                      <div className="ml-2 flex-1">
                        <label htmlFor="specificDepartments" className="text-sm text-gray-700 font-medium">
                          指定部門
                        </label>
                        
                        {!newAnnouncement.isGlobalAnnouncement && (
                          <div className="mt-2 grid grid-cols-2 gap-2 p-3 border border-gray-200 rounded-md bg-gray-50">
                            {DEPARTMENT_OPTIONS.map((department) => (
                              <div key={department} className="flex items-center">
                                <input
                                  type="checkbox"
                                  id={`dept-${department}`}
                                  checked={newAnnouncement.selectedDepartments.includes(department)}
                                  onChange={(e) => handleDepartmentChange(department, e.target.checked)}
                                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor={`dept-${department}`} className="ml-2 text-sm text-gray-700">
                                  {department}
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {!newAnnouncement.isGlobalAnnouncement && newAnnouncement.selectedDepartments.length === 0 && (
                          <p className="text-xs text-red-600 mt-1">請至少選擇一個部門</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">附件</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
                    <div className="text-center">
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600 mb-2">點擊選擇檔案或拖曳到此處</p>
                      <input
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                    </div>
                    
                    {selectedFiles.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {selectedFiles.map((file, index) => (
                          <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                            <div className="flex items-center">
                              <FileText className="w-4 h-4 text-gray-400 mr-2" />
                              <span className="text-sm text-gray-700">{file.name}</span>
                              <span className="text-xs text-gray-500 ml-2">({formatFileSize(file.size)})</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFile(index)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isPublished"
                    checked={newAnnouncement.isPublished}
                    onChange={(e) => setNewAnnouncement({ ...newAnnouncement, isPublished: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="isPublished" className="ml-2 text-sm text-gray-700">
                    立即發布（取消勾選將儲存為草稿）
                  </label>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewAnnouncementForm(false);
                      resetForm();
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {newAnnouncement.isPublished ? '發布公告' : '儲存草稿'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 編輯公告表單彈窗 */}
      {showEditForm && editingAnnouncement && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">編輯公告</h2>
                <button
                  onClick={() => {
                    setShowEditForm(false);
                    setEditingAnnouncement(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleUpdateAnnouncement} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">標題</label>
                  <input
                    type="text"
                    value={editingAnnouncement.title}
                    onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">內容</label>
                  <textarea
                    value={editingAnnouncement.content}
                    onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, content: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={8}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">公告類型</label>
                    <select
                      value={editingAnnouncement.category || 'GENERAL'}
                      onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, category: e.target.value as Announcement['category'] })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    >
                      {CATEGORY_OPTIONS.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">優先級</label>
                    <select
                      value={editingAnnouncement.priority}
                      onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, priority: e.target.value as 'HIGH' | 'NORMAL' | 'LOW' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    >
                      <option value="HIGH">高</option>
                      <option value="NORMAL">普通</option>
                      <option value="LOW">低</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">到期日期</label>
                  <input
                    type="date"
                    value={editingAnnouncement.expiryDate ? editingAnnouncement.expiryDate.split('T')[0] : ''}
                    onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, expiryDate: e.target.value || undefined })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  />
                </div>

                {/* 編輯：公告對象設定 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">公告對象</label>
                  
                  <div className="space-y-3">
                    {/* 全員通告選項 */}
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id="editGlobalAnnouncement"
                        name="editAnnouncementTarget"
                        checked={editingAnnouncement.isGlobalAnnouncement !== false}
                        onChange={() => setEditingAnnouncement({ 
                          ...editingAnnouncement, 
                          isGlobalAnnouncement: true,
                          targetDepartments: undefined
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="editGlobalAnnouncement" className="ml-2 text-sm text-gray-700">
                        <span className="font-medium">全部部門</span> - 通告性質，所有員工都會收到
                      </label>
                    </div>

                    {/* 特定部門選項 */}
                    <div className="flex items-start">
                      <input
                        type="radio"
                        id="editSpecificDepartments"
                        name="editAnnouncementTarget"
                        checked={editingAnnouncement.isGlobalAnnouncement === false}
                        onChange={() => setEditingAnnouncement({ 
                          ...editingAnnouncement, 
                          isGlobalAnnouncement: false 
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mt-0.5"
                      />
                      <div className="ml-2 flex-1">
                        <label htmlFor="editSpecificDepartments" className="text-sm text-gray-700 font-medium">
                          指定部門
                        </label>
                        
                        {editingAnnouncement.isGlobalAnnouncement === false && (
                          <div className="mt-2 grid grid-cols-2 gap-2 p-3 border border-gray-200 rounded-md bg-gray-50">
                            {DEPARTMENT_OPTIONS.map((department) => {
                              const currentDepartments = editingAnnouncement.targetDepartments 
                                ? JSON.parse(editingAnnouncement.targetDepartments) 
                                : [];
                              return (
                                <div key={department} className="flex items-center">
                                  <input
                                    type="checkbox"
                                    id={`edit-dept-${department}`}
                                    checked={currentDepartments.includes(department)}
                                    onChange={(e) => {
                                      const currentDepts = editingAnnouncement.targetDepartments 
                                        ? JSON.parse(editingAnnouncement.targetDepartments) 
                                        : [];
                                      let newDepts;
                                      if (e.target.checked) {
                                        newDepts = [...currentDepts, department];
                                      } else {
                                        newDepts = currentDepts.filter((d: string) => d !== department);
                                      }
                                      setEditingAnnouncement({
                                        ...editingAnnouncement,
                                        targetDepartments: JSON.stringify(newDepts)
                                      });
                                    }}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  <label htmlFor={`edit-dept-${department}`} className="ml-2 text-sm text-gray-700">
                                    {department}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="editIsPublished"
                    checked={editingAnnouncement.isPublished}
                    onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, isPublished: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="editIsPublished" className="ml-2 text-sm text-gray-700">
                    已發布
                  </label>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditForm(false);
                      setEditingAnnouncement(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    更新公告
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          {toast.message}
        </div>
      )}

      {/* 刪除確認對話框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">確認刪除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除公告「{deleteConfirm.title}」嗎？此操作無法復原。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteAnnouncement}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 預覽對話框 */}
      {previewAnnouncement && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">公告預覽</h2>
                <button
                  onClick={() => setPreviewAnnouncement(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              {/* 預覽內容 */}
              <div className={`bg-white rounded-lg shadow border-l-4 ${PRIORITY_BORDER[previewAnnouncement.priority]}`}>
                <div className="p-6">
                  <div className="flex items-center mb-3 flex-wrap gap-2">
                    <h3 className="text-2xl font-bold text-gray-900">
                      {previewAnnouncement.title}
                    </h3>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${CATEGORY_COLORS[previewAnnouncement.category] || CATEGORY_COLORS.GENERAL}`}>
                      {CATEGORY_LABELS[previewAnnouncement.category] || '一般通知'}
                    </span>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${PRIORITY_COLORS[previewAnnouncement.priority]}`}>
                      {PRIORITY_LABELS[previewAnnouncement.priority]}
                    </span>
                  </div>
                  
                  <div className="flex items-center text-sm text-gray-500 mb-4">
                    <User className="w-4 h-4 mr-1" />
                    <span className="mr-4">
                      {previewAnnouncement.publisher?.name || '未知'}
                    </span>
                    <Calendar className="w-4 h-4 mr-1" />
                    <span>
                      {new Date(previewAnnouncement.createdAt).toLocaleDateString('zh-TW')}
                    </span>
                  </div>
                  
                  <div className="prose max-w-none">
                    <div className="text-gray-700 whitespace-pre-wrap">
                      {previewAnnouncement.content}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 審核歷程區塊 */}
              <div className="mt-4 border-t pt-4">
                <button
                  onClick={() => handleShowApprovalHistory(previewAnnouncement.id)}
                  className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
                >
                  {approvalHistoryId === previewAnnouncement.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {approvalHistoryId === previewAnnouncement.id ? '隱藏審核歷程' : '查看審核歷程'}
                </button>
                
                {approvalHistoryId === previewAnnouncement.id && (
                  <div className="mt-4">
                    {approvalData ? (
                      <ApprovalProgress
                        currentLevel={approvalData.currentLevel}
                        maxLevel={approvalData.maxLevel}
                        status={approvalData.status}
                        reviews={approvalData.reviews}
                      />
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        載入審核歷程中...
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex justify-end pt-4">
                <button
                  onClick={() => setPreviewAnnouncement(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  關閉預覽
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </AuthenticatedLayout>
  );
}
