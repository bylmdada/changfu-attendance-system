'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 員工離職申請頁面
 * 重定向到統一的離職管理頁面
 * 該頁面會根據用戶角色自動顯示不同的視角
 */
export default function EmployeeResignationPage() {
  const router = useRouter();
  
  useEffect(() => {
    // 重定向到統一的離職管理頁面
    router.replace('/resignation-management');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
        <p className="text-gray-600">正在跳轉...</p>
      </div>
    </div>
  );
}
