'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  Mail,
  Settings,
  Bell,
  Smartphone,
  CreditCard,
  Receipt,
  Search
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  buildAuthMeRequest,
  buildLogoutRequest,
} from '@/lib/admin-session-client';
import SystemNavbar from '@/components/SystemNavbar';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';
import EmptyState from '@/components/EmptyState';

export default function SystemSettingsPage() {
  const router = useRouter();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
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
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const request = buildAuthMeRequest(window.location.origin);
        const response = await fetch(request.url, request.options);
        
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
      const request = buildLogoutRequest(window.location.origin);
      await fetchJSONWithCSRF(request.url, {
        method: request.options.method,
      });
      
      router.push('/login');
    } catch (error) {
      console.error('登出失敗:', error);
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
          name: '班別設定',
          path: '/system-settings/shift-definitions',
          description: '建立與管理班表可使用的班別、時間與休息設定',
          icon: Clock
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
          name: '提早/延後打卡提示',
          path: '/system-settings/clock-reason-prompt',
          description: '設定員工提早上班或延後下班時的原因提示',
          icon: Clock
        },
        {
          name: '郵件伺服器設定',
          path: '/system-settings/smtp',
          description: '設定系統共用的 SMTP 郵件發送伺服器',
          icon: Mail
        },
        {
          name: '郵件通知設定',
          path: '/system-settings/email-notification',
          description: '設定考勤相關事件的 Email 通知開關',
          icon: Mail
        },
        {
          name: '系統通知設定',
          path: '/system-settings/notification-config',
          description: '設定審核通知、年假到期提醒等系統通知功能',
          icon: Bell
        },
        {
          name: '推播通知設定',
          path: '/system-settings/push-notifications',
          description: '設定 PWA 推播通知，接收即時打卡提醒',
          icon: Smartphone
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
        },
        {
          name: '雙因素驗證 (2FA)',
          path: '/system-settings/2fa',
          description: '設定管理員/HR 雙因素驗證保護',
          icon: Shield
        },
        {
          name: '登入日誌',
          path: '/system-settings/login-logs',
          description: '查看系統登入記錄與安全監控',
          icon: FileText
        },
        {
          name: '審核代理人',
          path: '/system-settings/approval-delegates',
          description: '設定審核權限代理，主管請假時由代理人審核',
          icon: Users
        },
        {
          name: '審核流程管理',
          path: '/system-settings/approval-workflows',
          description: '設定各類申請的審核層級、時效與部門主管',
          icon: Settings
        },
        {
          name: '班表確認機制',
          path: '/system-settings/schedule-confirm',
          description: '設定班表確認與未確認阻止打卡功能',
          icon: Calendar
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
          name: '薪資管理',
          path: '/salary-management',
          description: '員工薪資調整、薪資歷史查詢',
          icon: DollarSign
        },
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
        },
        {
          name: '所得稅管理',
          path: '/system-settings/income-tax-management',
          description: '設定薪資試算、薪資條是否扣除與顯示所得稅項目',
          icon: Receipt
        },
        {
          name: '出勤扣薪控管',
          path: '/system-settings/attendance-salary-deduction',
          description: '設定遲到、早退、缺勤是否納入新薪資試算與薪資條扣薪',
          icon: Clock
        },
        {
          name: '薪資條發送設定',
          path: '/system-settings/payslip-email',
          description: '薪資條 Email 發送郵件範本設定',
          icon: Mail
        },
        {
          name: '國定假日管理',
          path: '/system-settings/holidays',
          description: '管理年度國定假日，用於薪資加班費計算',
          icon: Calendar
        },
        {
          name: '銀行帳戶管理',
          path: '/system-settings/bank-accounts',
          description: '管理員工薪轉銀行帳號，產出元大銀行薪轉格式',
          icon: CreditCard
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
          name: '獎金配置設定',
          path: '/system-settings/bonus-config',
          description: '整合設定年終/三節獎金基數、計算方式與服務月數',
          icon: Settings
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
          name: '健保公式配置管理',
          path: '/system-settings/health-insurance-formula',
          description: '設定健保費計算公式與參數',
          icon: Heart
        },
        {
          name: '法規參數設定',
          path: '/system-settings/labor-law-config',
          description: '設定勞基法相關參數（基本工資、勞健保費率等）',
          icon: Shield
        },
        {
          name: '假別規則設定',
          path: '/system-settings/leave-rules-config',
          description: '設定育嬰留停、家庭照顧假、病假等假別規則',
          icon: Calendar
        }
      ]
    },
    {
      title: '財產管理設定',
      description: '據點、維護人員與主管、頻率與通知設定',
      icon: Settings,
      color: 'blue',
      items: [
        {
          name: '財產管理設定',
          path: '/system-settings/property-management',
          description: '據點維護/審核人員指派、頻率與時段、Email 通知、資料匯入',
          icon: Settings
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

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredCategories = settingsCategories
    .map((category) => {
      const categoryMatches =
        !normalizedSearchTerm ||
        `${category.title} ${category.description}`.toLowerCase().includes(normalizedSearchTerm);
      const items = category.items.filter((item) => {
        if (categoryMatches) return true;

        return `${item.name} ${item.description} ${item.path}`
          .toLowerCase()
          .includes(normalizedSearchTerm);
      });

      return { ...category, items };
    })
    .filter((category) => category.items.length > 0);
  const visibleSettingCount = filteredCategories.reduce((sum, category) => sum + category.items.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 響應式側邊欄 */}
      <ResponsiveSidebar user={user} />
      
      {/* 頂部導航 */}
      <SystemNavbar user={user} />

      {/* 主要內容 - 桌面版需偏移側邊欄寬度 */}
      <main className="lg:pl-64 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 安全提醒 */}
        <div className="mb-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Shield className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">安全提醒</h3>
              <p className="text-sm text-yellow-700 mt-1">
                系統設定將影響整個薪資計算系統，請謹慎操作。建議在非上班時間進行重要參數調整，並事先備份相關資料。
              </p>
              <Link
                href="/audit-logs?targetType=SystemSettings&action=SETTINGS_UPDATE"
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-yellow-300 bg-white px-3 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
              >
                <FileText className="mr-2 h-4 w-4" />
                設定變更紀錄
              </Link>
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="搜尋設定名稱、說明或路徑"
                className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {filteredCategories.map((category, categoryIndex) => {
                const colors = getColorClasses(category.color);

                return (
                  <a
                    key={category.title}
                    href={`#setting-category-${categoryIndex}`}
                    className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${colors.bg} ${colors.border} ${colors.text} ${colors.hover}`}
                  >
                    {category.title}
                  </a>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>目前顯示 {visibleSettingCount} 個設定</span>
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="min-h-11 rounded-lg px-3 font-medium text-blue-700 hover:bg-blue-50"
              >
                清除搜尋
              </button>
            )}
          </div>
        </div>

        {/* 設定分類 */}
        <div className="space-y-8">
          {filteredCategories.map((category, categoryIndex) => {
            const colors = getColorClasses(category.color);
            const IconComponent = category.icon;
            
            return (
              <div id={`setting-category-${categoryIndex}`} key={category.title} className="scroll-mt-24 bg-white rounded-lg shadow-sm border border-gray-200">
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
                        <Link
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
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredCategories.length === 0 && (
            <EmptyState
              icon={<Search className="h-10 w-10" />}
              title={`找不到符合「${searchTerm}」的系統設定`}
              description="請改用設定名稱、分類或路徑關鍵字搜尋。"
            />
          )}
        </div>

        {/* 系統資訊 */}
        <div className="mt-8 bg-gray-100 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">系統資訊</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-700">系統版本：</span>
              <span className="font-medium text-gray-700">{appVersion}</span>
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
