'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
}

export default function SystemSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 檢查是否為系統設定主頁面（主頁面有自己完整的導航和側邊欄）
  const isMainPage = pathname === '/system-settings';

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          // ADMIN 可以訪問所有系統設定
          // HR 只能訪問特定頁面（如 2FA）
          const isAdmin = currentUser.role === 'ADMIN';
          const isHR = currentUser.role === 'HR';
          const is2FAPage = pathname === '/system-settings/2fa';
          
          if (!isAdmin && !(isHR && is2FAPage)) {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
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
  }, [router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }
  
  // 系統設定主頁面已有自己的完整導航和側邊欄，直接返回 children
  if (isMainPage) {
    return <>{children}</>;
  }

  // 子頁面：添加側邊欄並偏移主內容
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 響應式側邊欄 */}
      <ResponsiveSidebar user={user} />
      
      {/* 子頁面內容容器 - 桌面版偏移側邊欄寬度 */}
      <div className="lg:pl-64">
        {children}
      </div>
    </div>
  );
}
