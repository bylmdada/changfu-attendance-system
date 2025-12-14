/**
 * 📊 System Monitoring Page - 系統監控頁面
 * 
 * 系統維護與監控的主要入口頁面
 * 
 * @created 2024-11-10
 * @phase System Maintenance - 系統維護階段
 */

import { Metadata } from 'next';
import SystemMonitoringDashboard from '@/components/SystemMonitoringDashboard';

export const metadata: Metadata = {
  title: '系統監控 - 長福會考勤系統',
  description: '即時系統健康監控與維護管理',
};

export default function SystemMonitoringPage() {
  return (
    <div>
      <SystemMonitoringDashboard />
    </div>
  );
}
