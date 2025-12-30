'use client';

import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Plus, ShoppingCart, Check, X, Trash2, Clock, 
  CheckCircle, XCircle, Eye, Search, Download, ChevronDown, ChevronUp 
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';


interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
}

interface PurchaseRequest {
  id: number;
  requestNumber: string;
  employeeId: number;
  department: string;
  title: string;
  category: string;
  items: string;
  totalAmount: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  approvedBy?: number;
  approvedAt?: string;
  rejectReason?: string;
  createdAt: string;
  employee: Employee;
  approver?: { id: number; name: string };
}

interface User {
  id: number;
  username: string;
  role: string;
  employee: Employee;
}

const STATUS_LABELS = {
  PENDING: '待審核',
  APPROVED: '已核准',
  REJECTED: '已駁回'
};

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  APPROVED: 'bg-green-100 text-green-800 border-green-300',
  REJECTED: 'bg-red-100 text-red-800 border-red-300'
};

const PRIORITY_LABELS = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  URGENT: '緊急'
};

const PRIORITY_COLORS = {
  LOW: 'bg-gray-100 text-gray-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700'
};

// 單位選項
const UNIT_OPTIONS = [
  '個', '件', '組', '套', '箱', '包', '桶',
  '瓶', '罐', '袋', '盒', '卷', '張',
  '台', '支', '政', '本', '冊', '頁',
  'kg', 'g', 'L', 'ml', 'm', 'cm'
];

// 類別選項（針對長照機構）
const CATEGORY_OPTIONS = [
  { value: 'MEDICAL', label: '醫療耗材', icon: '🏥' },
  { value: 'CARE_SUPPLIES', label: '照護用品', icon: '💊' },
  { value: 'OFFICE', label: '辦公文具', icon: '📎' },
  { value: 'IT_EQUIPMENT', label: '資訊設備', icon: '💻' },
  { value: 'FURNITURE', label: '家具設備', icon: '🛋️' },
  { value: 'CLEANING', label: '清潔用品', icon: '🧹' },
  { value: 'FOOD', label: '食品飲料', icon: '🍱' },
  { value: 'KITCHEN', label: '廚房用品', icon: '🍳' },
  { value: 'MAINTENANCE', label: '維修保養', icon: '🔧' },
  { value: 'UNIFORM', label: '制服服裝', icon: '👔' },
  { value: 'ACTIVITY', label: '活動用品', icon: '🎉' },
  { value: 'OTHER', label: '其他', icon: '📦' }
];

const CATEGORY_LABELS: Record<string, string> = {
  MEDICAL: '醫療耗材',
  CARE_SUPPLIES: '照護用品',
  OFFICE: '辦公文具',
  IT_EQUIPMENT: '資訊設備',
  FURNITURE: '家具設備',
  CLEANING: '清潔用品',
  FOOD: '食品飲料',
  KITCHEN: '廚房用品',
  MAINTENANCE: '維修保養',
  UNIFORM: '制服服裝',
  ACTIVITY: '活動用品',
  OTHER: '其他'
};

const CATEGORY_COLORS: Record<string, string> = {
  MEDICAL: 'bg-red-100 text-red-700 border-red-300',
  CARE_SUPPLIES: 'bg-pink-100 text-pink-700 border-pink-300',
  OFFICE: 'bg-blue-100 text-blue-700 border-blue-300',
  IT_EQUIPMENT: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  FURNITURE: 'bg-amber-100 text-amber-700 border-amber-300',
  CLEANING: 'bg-cyan-100 text-cyan-700 border-cyan-300',
  FOOD: 'bg-orange-100 text-orange-700 border-orange-300',
  KITCHEN: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  MAINTENANCE: 'bg-gray-100 text-gray-700 border-gray-300',
  UNIFORM: 'bg-purple-100 text-purple-700 border-purple-300',
  ACTIVITY: 'bg-green-100 text-green-700 border-green-300',
  OTHER: 'bg-slate-100 text-slate-700 border-slate-300'
};

const CATEGORY_ICONS: Record<string, string> = {
  MEDICAL: '🏥',
  CARE_SUPPLIES: '💊',
  OFFICE: '📎',
  IT_EQUIPMENT: '💻',
  FURNITURE: '🛋️',
  CLEANING: '🧹',
  FOOD: '🍱',
  KITCHEN: '🍳',
  MAINTENANCE: '🔧',
  UNIFORM: '👔',
  ACTIVITY: '🎉',
  OTHER: '📦'
};

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [showNewForm, setShowNewForm] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  
  // 新增表單
  const [newRequest, setNewRequest] = useState({
    title: '',
    category: 'OTHER',
    items: [{ name: '', quantity: 1, unit: '個', price: 0, note: '' }],
    reason: '',
    priority: 'NORMAL' as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  });

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'HR';

  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 確認框狀態
  const [actionConfirm, setActionConfirm] = useState<{ type: 'approve' | 'delete'; id: number; title: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'date' | 'status' | 'amount' | 'priority'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });

  // 展開審核進度
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
  } | null>(null);

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'date' | 'status' | 'amount' | 'priority') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 排序後的記錄
  const sortedRequests = [...requests]
    // 部門篩選
    .filter(r => departmentFilter === 'ALL' || r.department === departmentFilter)
    // 類別篩選
    .filter(r => categoryFilter === 'ALL' || r.category === categoryFilter)
    .sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'date':
        return direction * a.createdAt.localeCompare(b.createdAt);
      case 'status':
        return direction * a.status.localeCompare(b.status);
      case 'amount':
        return direction * (a.totalAmount - b.totalAmount);
      case 'priority':
        const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
        return direction * (priorityOrder[a.priority] - priorityOrder[b.priority]);
      default:
        return 0;
    }
  });

  // 取得所有部門列表
  const departments = [...new Set(requests.map(r => r.department))].filter(Boolean).sort();

  // 匹出 CSV
  const exportToCSV = () => {
    const headers = ['單號', '主旨', '類別', '申請人', '部門', '金額', '優先級', '狀態', '建立日期'];
    const rows = sortedRequests.map(r => [
      r.requestNumber,
      r.title,
      CATEGORY_LABELS[r.category] || '其他',
      r.employee.name,
      r.department,
      r.totalAmount,
      PRIORITY_LABELS[r.priority],
      STATUS_LABELS[r.status],
      formatDate(r.createdAt)
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `請購單_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error('取得用戶資料失敗:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchRequests = useCallback(async () => {
    try {
      const url = statusFilter === 'ALL' 
        ? '/api/purchase-requests' 
        : `/api/purchase-requests?status=${statusFilter}`;
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRequests(data.purchaseRequests || []);
      }
    } catch (error) {
      console.error('取得請購單失敗:', error);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (user) {
      fetchRequests();
    }
  }, [user, fetchRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRequest.title || !newRequest.reason) {
      showToast('error', '請填寫採購主旨和原因');
      return;
    }

    const validItems = newRequest.items.filter(item => item.name.trim());
    if (validItems.length === 0) {
      showToast('error', '請至少填寫一項採購項目');
      return;
    }

    const totalAmount = validItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);

    try {
      const response = await fetchJSONWithCSRF('/api/purchase-requests', {
        method: 'POST',
        body: {
          title: newRequest.title,
          category: newRequest.category,
          items: JSON.stringify(validItems),
          totalAmount,
          reason: newRequest.reason,
          priority: newRequest.priority
        }
      });

      if (response.ok) {
        showToast('success', '請購單已提交');
        setShowNewForm(false);
        setNewRequest({
          title: '',
          category: 'OTHER',
          items: [{ name: '', quantity: 1, unit: '個', price: 0, note: '' }],
          reason: '',
          priority: 'NORMAL'
        });
        fetchRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '提交失敗');
      }
    } catch (error) {
      console.error('提交請購單失敗:', error);
      showToast('error', '操作失敗');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const response = await fetchJSONWithCSRF('/api/purchase-requests', {
        method: 'PUT',
        body: { id, status: 'APPROVED' }
      });

      if (response.ok) {
        showToast('success', '已核准');
        setShowDetailModal(false);
        fetchRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch (error) {
      console.error('核准失敗:', error);
      showToast('error', '操作失敗');
    }
    setActionConfirm(null);
  };

  const handleReject = async (id: number) => {
    if (!rejectReason.trim()) {
      showToast('error', '請填寫駁回原因');
      return;
    }
    
    try {
      const response = await fetchJSONWithCSRF('/api/purchase-requests', {
        method: 'PUT',
        body: { id, status: 'REJECTED', rejectReason }
      });

      if (response.ok) {
        showToast('success', '已駁回');
        setShowDetailModal(false);
        setRejectReason('');
        fetchRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch (error) {
      console.error('駁回失敗:', error);
      showToast('error', '操作失敗');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetchJSONWithCSRF(`/api/purchase-requests?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '已刪除');
        fetchRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '刪除失敗');
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      showToast('error', '操作失敗');
    }
    setActionConfirm(null);
  };

  const addItem = () => {
    setNewRequest({
      ...newRequest,
      items: [...newRequest.items, { name: '', quantity: 1, unit: '個', price: 0, note: '' }]
    });
  };

  const removeItem = (index: number) => {
    if (newRequest.items.length > 1) {
      setNewRequest({
        ...newRequest,
        items: newRequest.items.filter((_, i) => i !== index)
      });
    }
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    const updatedItems = [...newRequest.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setNewRequest({ ...newRequest, items: updatedItems });
  };

  const parseItems = (itemsJson: string) => {
    try {
      return JSON.parse(itemsJson);
    } catch {
      return [];
    }
  };

  // 展開/收合審核進度並取得真實資料
  const handleToggleApproval = async (requestId: number) => {
    if (expandedId === requestId) {
      setExpandedId(null);
      setApprovalData(null);
      return;
    }
    
    setExpandedId(requestId);
    setApprovalData(null);
    
    try {
      const response = await fetch(`/api/approval-reviews?requestType=PURCHASE&requestId=${requestId}`, {
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ShoppingCart className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  const statusCounts = {
    ALL: requests.length,
    PENDING: requests.filter(r => r.status === 'PENDING').length,
    APPROVED: requests.filter(r => r.status === 'APPROVED').length,
    REJECTED: requests.filter(r => r.status === 'REJECTED').length
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <ShoppingCart className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">請購管理</h1>
                <p className="text-gray-600 text-sm">申請採買項目，等待管理審核</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                新增請購
              </button>
              <button
                onClick={exportToCSV}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Download className="w-5 h-5 mr-2" />
                匯出 CSV
              </button>
            </div>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">總請購金額</p>
                <p className="text-2xl font-bold text-blue-600">
                  ${requests.reduce((sum, r) => sum + r.totalAmount, 0).toLocaleString()}
                </p>
              </div>
              <ShoppingCart className="w-10 h-10 text-blue-200" />
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-yellow-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">待審核金額</p>
                <p className="text-2xl font-bold text-yellow-600">
                  ${requests.filter(r => r.status === 'PENDING').reduce((sum, r) => sum + r.totalAmount, 0).toLocaleString()}
                </p>
              </div>
              <Clock className="w-10 h-10 text-yellow-200" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {requests.filter(r => r.status === 'PENDING').length} 筆待審核
            </p>
          </div>
          
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">已核准金額</p>
                <p className="text-2xl font-bold text-green-600">
                  ${requests.filter(r => r.status === 'APPROVED').reduce((sum, r) => sum + r.totalAmount, 0).toLocaleString()}
                </p>
              </div>
              <CheckCircle className="w-10 h-10 text-green-200" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {requests.filter(r => r.status === 'APPROVED').length} 筆已核准
            </p>
          </div>
          
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">最多請購類別</p>
                {(() => {
                  const categoryCounts = requests.reduce((acc, r) => {
                    acc[r.category] = (acc[r.category] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);
                  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
                  return topCategory ? (
                    <p className="text-lg font-bold text-purple-600">
                      {CATEGORY_ICONS[topCategory[0]] || '📦'} {CATEGORY_LABELS[topCategory[0]] || '其他'}
                    </p>
                  ) : (
                    <p className="text-lg font-bold text-purple-600">-</p>
                  );
                })()}
              </div>
              <div className="text-2xl">📊</div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              共 {Object.keys(requests.reduce((acc, r) => { acc[r.category] = true; return acc; }, {} as Record<string, boolean>)).length} 種類別
            </p>
          </div>
        </div>

        {/* 狀態篩選 */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex space-x-2">
              {[
                { key: 'ALL', label: '全部', icon: Search },
                { key: 'PENDING', label: '待審核', icon: Clock },
                { key: 'APPROVED', label: '已核准', icon: CheckCircle },
                { key: 'REJECTED', label: '已駁回', icon: XCircle }
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                    statusFilter === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {label}
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-white/20">
                    {statusCounts[key as keyof typeof statusCounts]}
                  </span>
                </button>
              ))}
            </div>
            
            {/* 管理員部門篩選 */}
            {isAdmin && departments.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-gray-600">部門：</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">全部部門</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* 類別篩選 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">類別：</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">全部類別</option>
                {CATEGORY_OPTIONS.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 列表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {requests.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">目前沒有請購單</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">單號</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">申請人</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">主旨</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">類別</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('amount')}>金額 {sortConfig.field === 'amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('priority')}>優先 {sortConfig.field === 'priority' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('date')}>申請日期 {sortConfig.field === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedRequests.map((req) => (
                  <React.Fragment key={req.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                      {req.requestNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {req.employee.name}
                      <div className="text-xs text-gray-500">{req.department}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {req.title}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full border ${CATEGORY_COLORS[req.category] || CATEGORY_COLORS.OTHER}`}>
                        {CATEGORY_ICONS[req.category] || '📦'} {CATEGORY_LABELS[req.category] || '其他'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                      ${req.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full ${PRIORITY_COLORS[req.priority]}`}>
                        {PRIORITY_LABELS[req.priority]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 text-xs rounded-full border ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(req.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            setSelectedRequest(req);
                            setShowDetailModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-800"
                          title="查看詳情"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        {req.status === 'PENDING' && (
                          <>
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => handleApprove(req.id)}
                                  className="text-green-600 hover:text-green-800"
                                  title="核准"
                                >
                                  <Check className="w-5 h-5" />
                                </button>
                              </>
                            )}
                            {(isAdmin || req.employeeId === user?.employee?.id) && (
                              <button
                                onClick={() => handleDelete(req.id)}
                                className="text-red-600 hover:text-red-800"
                                title="刪除"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            )}
                          </>
                        )}
                        {/* 查看審核進度按鈕 */}
                        <button
                          onClick={() => handleToggleApproval(req.id)}
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-600"
                          title="查看審核進度"
                        >
                          {expandedId === req.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* 展開的審核進度區域 */}
                  {expandedId === req.id && (
                    <tr>
                      <td colSpan={9} className="px-6 py-4 bg-gray-50">
                        {approvalData ? (
                          <ApprovalProgress
                            currentLevel={approvalData.currentLevel}
                            maxLevel={approvalData.maxLevel}
                            status={approvalData.status}
                            reviews={approvalData.reviews}
                          />
                        ) : (
                          <div className="text-center py-4 text-gray-500">
                            載入中...
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
      </div>

      {/* 新增表單 Modal */}
      {showNewForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">新增請購單</h2>
                <button onClick={() => setShowNewForm(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">採購主旨 *</label>
                  <input
                    type="text"
                    value={newRequest.title}
                    onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="例：辦公室用品採購"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">採購類別 *</label>
                  <select
                    value={newRequest.category}
                    onChange={(e) => setNewRequest({ ...newRequest, category: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                  >
                    {CATEGORY_OPTIONS.map(cat => (
                      <option key={cat.value} value={cat.value}>
                        {cat.icon} {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">優先等級</label>
                <select
                  value={newRequest.priority}
                  onChange={(e) => setNewRequest({ ...newRequest, priority: e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="LOW">低</option>
                  <option value="NORMAL">一般</option>
                  <option value="HIGH">高</option>
                  <option value="URGENT">緊急</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-800">採購項目 *</label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    + 新增項目
                </button>
                </div>
                
                {/* 欄位標題 */}
                <div className="grid grid-cols-12 gap-3 px-3 py-2 bg-gray-100 rounded-t-lg text-xs font-medium text-gray-600">
                  <div className="col-span-3">品項</div>
                  <div className="col-span-3">數量/單位</div>
                  <div className="col-span-2">單價</div>
                  <div className="col-span-1">小計</div>
                  <div className="col-span-2">備註</div>
                  <div className="col-span-1"></div>
                </div>
                
                <div className="space-y-2 border border-gray-200 border-t-0 rounded-b-lg p-3">
                  {newRequest.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-3">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateItem(index, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="品項名稱"
                        />
                      </div>
                      <div className="col-span-3 flex gap-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                          className="w-16 px-2 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          min="1"
                        />
                        <select
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                          className="w-16 px-1 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
                        >
                          {UNIT_OPTIONS.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => updateItem(index, 'price', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="單價"
                          min="0"
                        />
                      </div>
                      <div className="col-span-1">
                        <span className="text-sm font-medium text-gray-700">
                          ${(item.quantity * item.price).toLocaleString()}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={item.note}
                          onChange={(e) => updateItem(index, 'note', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="備註"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        {newRequest.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-right text-sm text-gray-600">
                  預估總金額：$
                  {newRequest.items.reduce((sum, item) => sum + (item.quantity * item.price), 0).toLocaleString()}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">採購原因 *</label>
                <textarea
                  value={newRequest.reason}
                  onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                  rows={3}
                  placeholder="說明採購需求..."
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  提交申請
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 詳情 Modal */}
      {showDetailModal && selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedRequest.requestNumber}</h2>
                  <p className="text-sm text-gray-500">{formatDate(selectedRequest.createdAt)}</p>
                </div>
                <button onClick={() => setShowDetailModal(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-500">申請人</label>
                  <p className="font-medium text-gray-900">{selectedRequest.employee.name}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">部門</label>
                  <p className="font-medium text-gray-900">{selectedRequest.department}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">狀態</label>
                  <p>
                    <span className={`px-3 py-1 text-xs rounded-full border ${STATUS_COLORS[selectedRequest.status]}`}>
                      {STATUS_LABELS[selectedRequest.status]}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">優先等級</label>
                  <p>
                    <span className={`px-2 py-1 text-xs rounded-full ${PRIORITY_COLORS[selectedRequest.priority]}`}>
                      {PRIORITY_LABELS[selectedRequest.priority]}
                    </span>
                  </p>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-500">採購主旨</label>
                <p className="font-medium text-gray-900 mt-1">{selectedRequest.title}</p>
              </div>

              <div>
                <label className="text-sm text-gray-500">採購類別</label>
                <p className="mt-1">
                  <span className={`px-2 py-1 text-xs rounded-full border ${CATEGORY_COLORS[selectedRequest.category] || CATEGORY_COLORS.OTHER}`}>
                    {CATEGORY_ICONS[selectedRequest.category] || '📦'} {CATEGORY_LABELS[selectedRequest.category] || '其他'}
                  </span>
                </p>
              </div>

              <div>
                <label className="text-sm text-gray-500">採購項目</label>
                <div className="mt-2 border rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">品項</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">數量</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">單價</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">小計</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">備註</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {parseItems(selectedRequest.items).map((item: { name: string; quantity: number; unit: string; price: number; note: string }, i: number) => (
                        <tr key={i}>
                          <td className="px-4 py-2 text-sm text-gray-900">{item.name}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">${item.price}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">${item.quantity * item.price}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{item.note}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-sm font-medium text-gray-900 text-right">合計</td>
                        <td className="px-4 py-2 text-sm font-bold text-gray-900" colSpan={2}>${selectedRequest.totalAmount.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-500">採購原因</label>
                <p className="mt-1 text-gray-900 whitespace-pre-wrap">{selectedRequest.reason}</p>
              </div>

              {selectedRequest.status === 'APPROVED' && selectedRequest.approver && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-green-800">
                    <CheckCircle className="w-4 h-4 inline mr-1" />
                    由 {selectedRequest.approver.name} 於 {formatDate(selectedRequest.approvedAt || '')} 核准
                  </p>
                </div>
              )}

              {selectedRequest.status === 'REJECTED' && (
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="text-sm text-red-800">
                    <XCircle className="w-4 h-4 inline mr-1" />
                    駁回原因：{selectedRequest.rejectReason}
                  </p>
                  {selectedRequest.approver && (
                    <p className="text-xs text-red-600 mt-1">
                      由 {selectedRequest.approver.name} 於 {formatDate(selectedRequest.approvedAt || '')} 駁回
                    </p>
                  )}
                </div>
              )}

              {/* 管理員審核操作 */}
              {isAdmin && selectedRequest.status === 'PENDING' && (
                <div className="border-t pt-4">
                  <h3 className="font-medium text-gray-900 mb-3">審核操作</h3>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleApprove(selectedRequest.id)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      <Check className="w-5 h-5" />
                      核准
                    </button>
                    <div>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        placeholder="駁回原因..."
                        rows={2}
                      />
                      <button
                        onClick={() => handleReject(selectedRequest.id)}
                        className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        <X className="w-5 h-5" />
                        駁回
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 確認框 */}
      {actionConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {actionConfirm.type === 'approve' ? '確認核准' : '確認刪除'}
            </h3>
            <p className="text-gray-600 mb-6">
              {actionConfirm.type === 'approve' 
                ? `確定要核准「${actionConfirm.title}」請購單嗎？` 
                : `確定要刪除「${actionConfirm.title}」請購單嗎？此操作無法恢復。`}
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setActionConfirm(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => actionConfirm.type === 'approve' ? handleApprove(actionConfirm.id) : handleDelete(actionConfirm.id)}
                className={`flex-1 px-4 py-2 text-white rounded-md ${actionConfirm.type === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {actionConfirm.type === 'approve' ? '確認核准' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
          {toast.message}
        </div>
      )}
    </AuthenticatedLayout>
  );
}
