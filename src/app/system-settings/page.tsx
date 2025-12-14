'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Calendar, 
  DollarSign, 
  Calculator, 
  Gift, 
  Clock, 
  Users, 
  Heart, 
  FileText,
  Shield,
  MapPin,
  Key,
  Mail
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';

export default function SystemSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee: {
      id: number;
      employeeId: string;
      name: string;
      department: string;
      position: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Helper function to get auth headers
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
        } else if (response.status === 401 || response.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          router.push('/login');
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('驗證失敗:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        }
      });
      
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
      
      router.push('/login');
    } catch (error) {
      console.error('登出失敗:', error);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
      router.push('/login');
    }
  };
  
  // 保留 handleLogout 供內部使用
  void handleLogout;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const settingsCategories = [
    {
      title: '考勤管理設定',
      description: '考勤規則與凍結管理',
      icon: Calendar,
      color: 'blue',
      items: [
        {
          name: '考勤凍結管理',
          path: '/system-settings/attendance-freeze',
          description: '設定考勤凍結規則與時間點',
          icon: Calendar
        },
        {
          name: 'GPS打卡設定',
          path: '/system-settings/gps-attendance',
          description: '設定GPS位置驗證與打卡範圍',
          icon: MapPin
        },
        {
          name: '打卡時間限制',
          path: '/system-settings/clock-time-restriction',
          description: '設定禁止打卡的時段範圍',
          icon: Clock
        },
        {
          name: 'Email 通知設定',
          path: '/system-settings/email-notification',
          description: '設定 Email 通知功能與 SMTP 伺服器',
          icon: Mail
        },
        {
          name: '部門職位管理',
          path: '/system-settings/department-positions',
          description: '管理各部門對應職位設定',
          icon: Users
        },
        {
          name: '考勤權限管理',
          path: '/system-settings/attendance-permissions',
          description: '設定員工考勤審核權限與範圍',
          icon: Shield
        },
        {
          name: '密碼安全政策',
          path: '/system-settings/password-policy',
          description: '設定密碼複雜度要求與安全規則',
          icon: Key
        }
      ]
    },
    {
      title: '薪資計算設定',
      description: '薪資計算相關參數配置',
      icon: DollarSign,
      color: 'green',
      items: [
        {
          name: '加班費計算管理',
          path: '/system-settings/overtime-calculation',
          description: '設定加班費計算規則與倍率',
          icon: Clock
        },
        {
          name: '補充保費計算系統',
          path: '/system-settings/supplementary-premium',
          description: '配置補充保費計算參數',
          icon: Calculator
        },
        {
          name: '薪資條管理系統',
          path: '/system-settings/payslip-management',
          description: '薪資條格式與內容設定',
          icon: FileText
        }
      ]
    },
    {
      title: '獎金管理設定',
      description: '各類獎金計算與配置',
      icon: Gift,
      color: 'purple',
      items: [
        {
          name: '獎金管理系統',
          path: '/system-settings/bonus-management',
          description: '設定獎金類型與計算規則',
          icon: Gift
        },
        {
          name: '按比例獎金系統',
          path: '/system-settings/prorated-bonus',
          description: '配置按比例獎金計算方式',
          icon: Calculator
        }
      ]
    },
    {
      title: '保險管理設定',
      description: '健保與相關保險配置',
      icon: Heart,
      color: 'red',
      items: [
        {
          name: '健保眷屬管理',
          path: '/system-settings/health-insurance-dependents',
          description: '管理員工健保眷屬資料',
          icon: Users
        },
        {
          name: '健保公式配置管理',
          path: '/system-settings/health-insurance-formula',
          description: '設定健保費計算公式與參數',
          icon: Heart
        }
      ]
    }
  ];

  const getColorClasses = (color: string) => {
    const colorMap = {
      blue: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: 'text-blue-600',
        text: 'text-blue-900',
        hover: 'hover:bg-blue-100'
      },
      green: {
        bg: 'bg-green-50',
        border: 'border-green-200',
        icon: 'text-green-600',
        text: 'text-green-900',
        hover: 'hover:bg-green-100'
      },
      purple: {
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        icon: 'text-purple-600',
        text: 'text-purple-900',
        hover: 'hover:bg-purple-100'
      },
      red: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: 'text-red-600',
        text: 'text-red-900',
        hover: 'hover:bg-red-100'
      }
    };
    return colorMap[color as keyof typeof colorMap] || colorMap.blue;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <SystemNavbar user={user} />

      {/* 主要內容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 安全提醒 */}
        <div className="mb-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Shield className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">安全提醒</h3>
              <p className="text-sm text-yellow-700 mt-1">
                系統設定將影響整個薪資計算系統，請謹慎操作。建議在非上班時間進行重要參數調整，並事先備份相關資料。
              </p>
            </div>
          </div>
        </div>

        {/* 設定分類 */}
        <div className="space-y-8">
          {settingsCategories.map((category, categoryIndex) => {
            const colors = getColorClasses(category.color);
            const IconComponent = category.icon;
            
            return (
              <div key={categoryIndex} className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className={`px-6 py-4 border-b border-gray-200 ${colors.bg}`}>
                  <div className="flex items-center space-x-3">
                    <IconComponent className={`h-6 w-6 ${colors.icon}`} />
                    <div>
                      <h2 className={`text-lg font-semibold ${colors.text}`}>{category.title}</h2>
                      <p className="text-sm text-gray-600">{category.description}</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {category.items.map((item, itemIndex) => {
                      const ItemIcon = item.icon;
                      return (
                        <a
                          key={itemIndex}
                          href={item.path}
                          className={`${colors.bg} ${colors.border} border rounded-lg p-4 ${colors.hover} transition-colors group`}
                        >
                          <div className="flex items-start space-x-3">
                            <ItemIcon className={`h-5 w-5 ${colors.icon} mt-0.5 group-hover:scale-110 transition-transform`} />
                            <div className="flex-1">
                              <h3 className={`font-medium ${colors.text} group-hover:underline`}>
                                {item.name}
                              </h3>
                              <p className="text-sm text-gray-600 mt-1">
                                {item.description}
                              </p>
                            </div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 系統資訊 */}
        <div className="mt-8 bg-gray-100 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">系統資訊</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-700">系統版本：</span>
              <span className="font-medium text-gray-700">v2.1.0</span>
            </div>
            <div>
              <span className="text-gray-700">最後更新：</span>
              <span className="font-medium text-gray-700">2024年12月</span>
            </div>
            <div>
              <span className="text-gray-700">管理員：</span>
              <span className="font-medium text-gray-700">{user.employee?.name}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
