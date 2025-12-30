'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Megaphone, Search, Filter, FileText, User, Calendar, Clock, 
  AlertTriangle, CheckCircle, Download, Pin
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

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

const PRIORITY_ICONS = {
  HIGH: AlertTriangle,
  NORMAL: Clock,
  LOW: CheckCircle
};

// 公告類型常數
const CATEGORY_OPTIONS = [
  { value: 'PERSONNEL', label: '人事公告', color: 'bg-purple-100 text-purple-800' },
  { value: 'POLICY', label: '政策規定', color: 'bg-blue-100 text-blue-800' },
  { value: 'EVENT', label: '活動通知', color: 'bg-green-100 text-green-800' },
  { value: 'SYSTEM', label: '系統公告', color: 'bg-gray-100 text-gray-800' },
  { value: 'BENEFITS', label: '福利通知', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'URGENT', label: '緊急通知', color: 'bg-red-100 text-red-800' },
  { value: 'GENERAL', label: '一般通知', color: 'bg-slate-100 text-slate-800' }
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

export default function AnnouncementViewPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filteredAnnouncements, setFilteredAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLoading, setUserLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  // 篩選狀態
  const [filters, setFilters] = useState({
    priority: '',
    category: '',
    search: ''
  });

  useEffect(() => {
    fetchCurrentUser();
    fetchAnnouncements();
  }, []);

  const filterAnnouncements = useCallback(() => {
    let filtered = announcements.filter(ann => ann.isPublished);

    if (filters.priority) {
      filtered = filtered.filter(ann => ann.priority === filters.priority);
    }

    if (filters.category) {
      filtered = filtered.filter(ann => ann.category === filters.category);
    }

    if (filters.search) {
      filtered = filtered.filter(ann =>
        ann.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        ann.content.toLowerCase().includes(filters.search.toLowerCase()) ||
        (ann.publisher?.name && ann.publisher.name.includes(filters.search))
      );
    }

    // 緊急通知置頂，再依優先級和日期排序
    filtered.sort((a, b) => {
      // 緊急通知優先
      if (a.category === 'URGENT' && b.category !== 'URGENT') return -1;
      if (a.category !== 'URGENT' && b.category === 'URGENT') return 1;
      
      const priorityOrder = { HIGH: 3, NORMAL: 2, LOW: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime();
    });

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
        } else if (data && data.id) {
          setCurrentUser(data);
        }
      } else {
        console.error('Failed to fetch user:', response.status);
        // 如果用戶未登入，重導向到登入頁
        if (response.status === 401) {
          window.location.href = '/login';
        }
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
      }
    } catch (error) {
      console.error('獲取公告列表失敗:', error);
    } finally {
      setLoading(false);
    }
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

  const isExpired = (announcement: Announcement) => {
    if (!announcement.expiryDate) return false;
    return new Date(announcement.expiryDate) < new Date();
  };

  if (loading || userLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Megaphone className="mr-3 h-8 w-8" />
              公告訊息
            </h1>
            <p className="mt-2 text-gray-600">查看公司重要公告與通知訊息</p>
          </div>

          {/* 統計資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Megaphone className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">總公告數</dt>
                      <dd className="text-lg font-medium text-gray-900">
                        {announcements.filter(ann => ann.isPublished).length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg border-l-4 border-red-500">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Pin className="h-6 w-6 text-red-600 -rotate-45" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">緊急通知</dt>
                      <dd className="text-lg font-medium text-red-600">
                        {announcements.filter(ann => ann.isPublished && ann.category === 'URGENT').length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <AlertTriangle className="h-6 w-6 text-orange-600" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">重要公告</dt>
                      <dd className="text-lg font-medium text-gray-900">
                        {announcements.filter(ann => ann.isPublished && ann.priority === 'HIGH').length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Clock className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">本月新增</dt>
                      <dd className="text-lg font-medium text-gray-900">
                        {announcements.filter(ann => {
                          const monthAgo = new Date();
                          monthAgo.setMonth(monthAgo.getMonth() - 1);
                          return ann.isPublished && new Date(ann.publishedAt || ann.createdAt) > monthAgo;
                        }).length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 篩選和搜索 */}
          <div className="bg-white shadow rounded-lg p-6 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">搜索</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    placeholder="搜索公告標題或內容..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">公告類型</label>
                <select
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                >
                  <option value="">全部類型</option>
                  {CATEGORY_OPTIONS.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">優先級</label>
                <select
                  value={filters.priority}
                  onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                >
                  <option value="">全部優先級</option>
                  <option value="HIGH">高</option>
                  <option value="NORMAL">普通</option>
                  <option value="LOW">低</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => setFilters({ priority: '', category: '', search: '' })}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Filter className="w-4 h-4 mr-2 inline" />
                  清除篩選
                </button>
              </div>
            </div>
          </div>

          {/* 公告列表 */}
          <div className="space-y-6">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">載入中...</p>
              </div>
            ) : filteredAnnouncements.length === 0 ? (
              <div className="text-center py-12">
                <Megaphone className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">暫無公告</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {filters.search || filters.priority ? '沒有符合篩選條件的公告' : '目前沒有已發布的公告'}
                </p>
              </div>
            ) : (
              filteredAnnouncements.map((announcement) => {
                const PriorityIcon = PRIORITY_ICONS[announcement.priority] || Clock;
                const expired = isExpired(announcement);
                const isUrgent = announcement.category === 'URGENT';
                
                return (
                  <div
                    key={announcement.id}
                    className={`bg-white rounded-lg shadow-sm border-l-4 ${
                      isUrgent ? 'border-l-red-500 bg-red-50/30' : PRIORITY_BORDER[announcement.priority]
                    } p-6 ${expired ? 'opacity-75' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center flex-wrap gap-2">
                        {isUrgent && (
                          <span title="置頂"><Pin className="w-5 h-5 text-red-500 -rotate-45" /></span>
                        )}
                        <PriorityIcon className={`w-5 h-5 ${
                          announcement.priority === 'HIGH' ? 'text-red-500' :
                          announcement.priority === 'NORMAL' ? 'text-blue-500' : 'text-gray-500'
                        }`} />
                        <h3 className="text-xl font-semibold text-gray-900">{announcement.title}</h3>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${CATEGORY_COLORS[announcement.category] || CATEGORY_COLORS.GENERAL}`}>
                          {CATEGORY_LABELS[announcement.category] || '一般通知'}
                        </span>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${PRIORITY_COLORS[announcement.priority]}`}>
                          {PRIORITY_LABELS[announcement.priority]}
                        </span>
                        {expired && (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">
                            已過期
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center text-sm text-gray-500 mb-4">
                      <User className="w-4 h-4 mr-1" />
                      <span className="mr-4">
                        {announcement.publisher?.name 
                          ? `${announcement.publisher.name} - ${announcement.publisher.department}` 
                          : '發布者信息不可用'
                        }
                      </span>
                      <Calendar className="w-4 h-4 mr-1" />
                      <span className="mr-4">
                        {announcement.publishedAt 
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
                            <div
                              key={attachment.id}
                              className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                              onClick={() => handleDownloadAttachment(attachment.id, attachment.originalName)}
                            >
                              <FileText className="w-5 h-5 text-blue-600 mr-3" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {attachment.originalName}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {(attachment.fileSize / 1024).toFixed(1)} KB
                                </p>
                              </div>
                              <Download className="w-4 h-4 text-gray-400" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
