'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import SystemNavbar from './SystemNavbar';
import ResponsiveSidebar from './ResponsiveSidebar';

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

interface AuthenticatedLayoutProps {
  children: ReactNode;
  backUrl?: string;
  backLabel?: string;
  hideSidebar?: boolean; // 某些頁面可隱藏側邊欄
}

export default function AuthenticatedLayout({ 
  children, 
  backUrl, 
  backLabel,
  hideSidebar = false
}: AuthenticatedLayoutProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        if (userData?.user) {
          setUser(userData.user);
        } else if (userData?.id) {
          setUser(userData);
        }
      } else {
        // 檢查是否為被其他裝置踢出
        const errorData = await response.json().catch(() => ({}));
        if (errorData.code === 'SESSION_INVALID') {
          alert('您已在其他裝置登入，此會話已失效。請重新登入。');
        }
        router.push('/login');
      }
    } catch (error) {
      console.error('Auth check error:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導覽列 */}
      <SystemNavbar user={user} backUrl={backUrl} backLabel={backLabel} />
      
      {/* 側邊欄 */}
      {!hideSidebar && <ResponsiveSidebar user={user} />}
      
      {/* 主內容區 - 桌面版有側邊欄時需偏移 */}
      <main className={!hideSidebar ? 'lg:pl-64' : ''}>
        {children}
      </main>
    </div>
  );
}
