'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Menu,
  X,
  Home,
  Clock,
  Calendar,
  FileText,
  Users,
  DollarSign,
  Settings,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  UserCog,
  Shield,
  Bell,
  CreditCard,
  BarChart3,
  Cloud
} from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: string;
  isDepartmentManager?: boolean;
  isDeputyManager?: boolean;
  hasSchedulePermission?: boolean; // 有班表管理權限
  employee?: {
    id: number;
    employeeId?: string;
    name: string;
    department?: string;
    position?: string;
  };
}

interface SidebarProps {
  user: User;
}

interface MenuItem {
  name: string;
  href?: string;
  icon: React.ElementType;
  children?: { name: string; href: string; roles?: string[] }[];
  roles?: string[]; // 允許的角色，空表示所有人
}

// 選單結構定義 - 按使用頻率和邏輯分組排列
const menuItems: MenuItem[] = [
  // ===== 首頁 =====
  {
    name: '儀表板',
    href: '/dashboard',
    icon: Home,
  },
  {
    name: '審核儀表板',
    href: '/approval-dashboard',
    icon: ClipboardList,
    roles: ['ADMIN', 'HR', 'MANAGER'],
  },
  
  // ===== 日常工作（所有員工） =====
  {
    name: '考勤管理',
    icon: Clock,
    children: [
      { name: '出勤打卡', href: '/attendance' },
      { name: '我的班表', href: '/my-schedule' },
      { name: '出勤紀錄', href: '/attendance/records' },
      { name: '補打卡申請', href: '/missed-clock' },
    ],
  },
  {
    name: '請假管理',
    icon: Calendar,
    children: [
      { name: '請假申請', href: '/leave-management' },
      { name: '特休假查詢', href: '/my-annual-leave' },
      { name: '年假餘額', href: '/annual-leaves' },
      { name: '補休查詢', href: '/my-comp-leave' },
      { name: '補休管理', href: '/comp-leave-management', roles: ['ADMIN', 'HR'] },
    ],
  },
  {
    name: '加班管理',
    href: '/overtime-management',
    icon: FileText,
  },
  {
    name: '換班管理',
    href: '/shift-exchange',
    icon: ClipboardList,
  },
  
  // ===== 薪資相關（所有員工） =====
  {
    name: '薪資相關',
    icon: CreditCard,
    children: [
      { name: '薪資查詢', href: '/payroll' },
      { name: '扣繳憑單', href: '/withholding-certificate' },
      { name: '薪資異議', href: '/payroll-disputes' },
      { name: '勞退自提', href: '/pension-contribution' },
    ],
  },
  
  // ===== 資訊與個人（所有員工） =====
  {
    name: '公告通知',
    href: '/announcements',
    icon: Bell,
  },
  {
    name: '眷屬資料',
    href: '/my-dependents',
    icon: Users,
  },
  {
    name: '密碼管理',
    href: '/password-management',
    icon: Shield,
  },
  {
    name: '個人設定',
    href: '/personal-settings',
    icon: Settings,
  },
  
  // ===== 人事異動（所有員工可申請） =====
  {
    name: '離職申請',
    href: '/employee-resignation',
    icon: UserCog,
  },
  
  // ===== 管理功能（ADMIN/HR） =====
  {
    name: '員工管理',
    icon: UserCog,
    roles: ['ADMIN', 'HR'],
    children: [
      { name: '員工列表', href: '/employees' },
      { name: '離職審核', href: '/resignation-management' },
    ],
  },
  {
    name: '班表管理',
    icon: Calendar,
    roles: ['ADMIN', 'HR', 'MANAGER', 'SCHEDULE_MANAGER'],
    children: [
      { name: '班表設定', href: '/schedule-management' },
      { name: '週班表範本', href: '/schedule-management/weekly-templates' },
    ],
  },
  {
    name: '薪資管理',
    icon: DollarSign,
    roles: ['ADMIN', 'HR'],
    children: [
      { name: '薪資計算', href: '/employee-payroll' },
      { name: '薪資報表', href: '/reports' },
      { name: '薪資統計', href: '/payroll-statistics' },
      { name: '薪資轉帳', href: '/salary-transfer' },
      { name: '獎金管理', href: '/bonus-management' },
      { name: '按比例獎金', href: '/pro-rated-bonus' },
    ],
  },
  {
    name: '統計分析',
    href: '/dashboard-stats',
    icon: BarChart3,
    roles: ['ADMIN', 'HR'],
  },
  {
    name: '採購申請',
    href: '/purchase-requests',
    icon: ClipboardList,
    roles: ['ADMIN', 'HR'],
  },
  {
    name: '天災假管理',
    href: '/disaster-day-off',
    icon: Cloud,
    roles: ['ADMIN', 'HR'],
  },
  {
    name: '健保眷屬管理',
    href: '/health-insurance-dependents',
    icon: Users,
    roles: ['ADMIN', 'HR'],
  },
  
  // ===== 系統管理（僅 ADMIN） =====
  {
    name: '系統設定',
    href: '/system-settings',
    icon: Settings,
    roles: ['ADMIN'],
  },
];

export default function ResponsiveSidebar({ user }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const pathname = usePathname();

  const toggleExpand = (name: string) => {
    setExpandedItems(prev =>
      prev.includes(name)
        ? prev.filter(item => item !== name)
        : [...prev, name]
    );
  };

  // 過濾選單項目（根據角色和部門主管狀態）
  const filteredMenuItems = menuItems.filter(item => {
    if (!item.roles || item.roles.length === 0) return true;
    // 如果用戶是部門主管或代理人，也視為有 MANAGER 權限
    if (item.roles.includes('MANAGER') && (user.isDepartmentManager || user.isDeputyManager)) return true;
    // 如果用戶有班表管理權限，願示班表管理選單
    if (item.roles.includes('SCHEDULE_MANAGER') && user.hasSchedulePermission) return true;
    return item.roles.includes(user.role);
  });

  // 檢查路徑是否匹配
  const isActive = (href: string) => pathname === href;
  const isParentActive = (children?: { href: string }[]) =>
    children?.some(child => pathname === child.href);

  // 渲染選單項
  const renderMenuItem = (item: MenuItem, isMobile: boolean = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const active = item.href ? isActive(item.href) : isParentActive(item.children);

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpand(item.name)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
              active
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.name}</span>
            </div>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {/* 桌面版：可折疊子選單 */}
          {!isMobile && isExpanded && (
            <div className="ml-8 mt-1 space-y-1">
              {item.children?.filter(child => !child.roles || child.roles.includes(user.role)).map(child => (
                <Link
                  key={child.href}
                  href={child.href}
                  className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive(child.href)
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {child.name}
                </Link>
              ))}
            </div>
          )}
          {/* 手機版：展開顯示扁平子選單 */}
          {isMobile && isExpanded && (
            <div className="mt-1 space-y-1">
              {item.children?.filter(child => !child.roles || child.roles.includes(user.role)).map(child => (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={() => setIsOpen(false)}
                  className={`block pl-12 pr-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive(child.href)
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {child.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.name}
        href={item.href!}
        onClick={() => isMobile && setIsOpen(false)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
          active
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <item.icon className="w-5 h-5" />
        <span>{item.name}</span>
      </Link>
    );
  };

  return (
    <>
      {/* 漢堡按鈕 - 只在手機顯示 */}
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-white rounded-lg shadow-md hover:bg-gray-50"
        aria-label="開啟選單"
      >
        <Menu className="w-6 h-6 text-gray-700" />
      </button>

      {/* 手機版側邊欄抽屜 */}
      {isOpen && (
        <>
          {/* 遮罩 */}
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsOpen(false)}
          />
          {/* 抽屜 */}
          <div className="lg:hidden fixed inset-y-0 left-0 w-80 bg-white z-50 shadow-xl overflow-y-auto">
            {/* 抽屜頭部 */}
            <div className="flex items-center justify-between p-4 border-b">
              <span className="font-bold text-lg text-gray-900">選單</span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-700" />
              </button>
            </div>
            
            {/* 用戶資訊 */}
            <div className="p-4 border-b bg-gray-50">
              <div className="font-medium text-gray-900">
                {user.employee?.name || user.username}
              </div>
              <div className="text-sm text-gray-500">
                {user.employee?.department} · {user.role === 'ADMIN' ? '管理員' : user.role === 'HR' ? '人資' : '員工'}
              </div>
            </div>

            {/* 選單列表 */}
            <nav className="p-3 space-y-1">
              {filteredMenuItems.map(item => renderMenuItem(item, true))}
            </nav>
          </div>
        </>
      )}

      {/* 桌面版固定側邊欄 */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r lg:border-gray-200 lg:bg-white lg:pt-16">
        <div className="flex-1 overflow-y-auto p-4">
          <nav className="space-y-1">
            {filteredMenuItems.map(item => renderMenuItem(item, false))}
          </nav>
        </div>
      </aside>
    </>
  );
}
