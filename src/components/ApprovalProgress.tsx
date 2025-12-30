'use client';

import React from 'react';
import { CheckCircle, Circle, XCircle, AlertTriangle, Clock } from 'lucide-react';

// 審核歷程記錄類型
export interface ApprovalReviewRecord {
  level: number;            // 層級 (1, 2, 3)
  reviewerName: string;     // 審核者姓名
  reviewerRole: string;     // 審核角色 (MANAGER, HR, ADMIN)
  reviewerDepartment?: string;  // 審核者部門
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'DISAGREED';  // 狀態
  comment?: string;         // 意見
  reviewedAt?: string;      // 審核時間
}

interface ApprovalProgressProps {
  currentLevel: number;     // 當前審核層級
  maxLevel: number;         // 最大層級 (2 或 3)
  status: string;           // 整體狀態
  reviews: ApprovalReviewRecord[];  // 審核歷程
  showHistoryTable?: boolean;  // 是否顯示歷程表格
}

// 角色標籤映射（簡稱，與員工清單格式統一）
const ROLE_LABELS: Record<string, string> = {
  MANAGER: '正',
  DEPUTY: '副',
  HR: 'HR',
  ADMIN: '管理員'
};

// 層級標籤
const LEVEL_LABELS: Record<number, { name: string; role: string }> = {
  1: { name: '一階', role: '部門主管' },
  2: { name: '二階', role: 'HR會簽' },
  3: { name: '三階', role: '管理員決核' }
};

// 狀態色彩
const STATUS_STYLES: Record<string, { bg: string; text: string; Icon: React.ElementType }> = {
  APPROVED: { bg: 'bg-green-100', text: 'text-green-700', Icon: CheckCircle },
  REJECTED: { bg: 'bg-red-100', text: 'text-red-700', Icon: XCircle },
  PENDING: { bg: 'bg-gray-100', text: 'text-gray-500', Icon: Clock },
  DISAGREED: { bg: 'bg-orange-100', text: 'text-orange-700', Icon: AlertTriangle }
};

// 狀態標籤
const STATUS_LABELS: Record<string, string> = {
  APPROVED: '同意',
  REJECTED: '退回',
  PENDING: '待審核',
  DISAGREED: '不同意'
};

export default function ApprovalProgress({
  currentLevel,
  maxLevel,
  status,
  reviews,
  showHistoryTable = true
}: ApprovalProgressProps) {
  // 格式化時間
  const formatDateTime = (dateString?: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  // 獲取層級狀態
  const getLevelStatus = (level: number): 'completed' | 'current' | 'pending' | 'rejected' => {
    const review = reviews.find(r => r.level === level);
    if (review) {
      if (review.status === 'REJECTED') return 'rejected';
      if (review.status === 'APPROVED' || review.status === 'DISAGREED') return 'completed';
    }
    if (level === currentLevel) return 'current';
    if (level < currentLevel) return 'completed';
    return 'pending';
  };

  // 生成進度節點
  const renderProgressNodes = () => {
    const levels = Array.from({ length: maxLevel }, (_, i) => i + 1);
    
    return (
      <div className="flex items-center justify-center space-x-2">
        {/* 提交節點 */}
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs text-gray-600 mt-1">提交</span>
        </div>
        
        {levels.map((level, index) => {
          const levelStatus = getLevelStatus(level);
          const isLast = index === levels.length - 1;
          
          // 節點顏色
          let nodeClass = '';
          let IconComponent = Circle;
          
          switch (levelStatus) {
            case 'completed':
              nodeClass = 'bg-green-500';
              IconComponent = CheckCircle;
              break;
            case 'current':
              nodeClass = 'bg-blue-500 animate-pulse';
              IconComponent = Clock;
              break;
            case 'rejected':
              nodeClass = 'bg-red-500';
              IconComponent = XCircle;
              break;
            default:
              nodeClass = 'bg-gray-300';
              IconComponent = Circle;
          }
          
          return (
            <React.Fragment key={level}>
              {/* 連接線 */}
              <div className={`w-12 h-1 ${levelStatus === 'pending' ? 'bg-gray-300' : 'bg-green-500'}`} />
              
              {/* 節點 */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full ${nodeClass} flex items-center justify-center`}>
                  <IconComponent className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs text-gray-600 mt-1 text-center whitespace-nowrap">
                  {LEVEL_LABELS[level]?.name || `第${level}階`}
                </span>
                <span className="text-xs text-gray-400">
                  {LEVEL_LABELS[level]?.role || ''}
                </span>
              </div>
              
              {/* 最後的結果節點 */}
              {isLast && status === 'APPROVED' && (
                <>
                  <div className="w-12 h-1 bg-green-500" />
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xs text-green-600 mt-1 font-medium">完成</span>
                  </div>
                </>
              )}
              
              {isLast && status === 'REJECTED' && (
                <>
                  <div className="w-12 h-1 bg-red-500" />
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xs text-red-600 mt-1 font-medium">已退回</span>
                  </div>
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // 渲染歷程表格
  const renderHistoryTable = () => {
    // 建立完整的層級列表
    const allLevels: ApprovalReviewRecord[] = [];
    
    for (let level = 1; level <= maxLevel; level++) {
      const review = reviews.find(r => r.level === level);
      if (review) {
        allLevels.push(review);
      } else {
        allLevels.push({
          level,
          reviewerName: '-',
          reviewerRole: LEVEL_LABELS[level]?.role === 'HR會簽' ? 'HR' : 
                        LEVEL_LABELS[level]?.role === '管理員決核' ? 'ADMIN' : 'MANAGER',
          status: 'PENDING'
        });
      }
    }

    return (
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">審核者</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-20">狀態</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">意見</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">時間</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {allLevels.map((record) => {
              const statusStyle = STATUS_STYLES[record.status] || STATUS_STYLES.PENDING;
              const StatusIcon = statusStyle.Icon;
              
              return (
                <tr key={record.level} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-900 font-medium">
                        {record.reviewerName}
                      </span>
                      <span className="text-xs text-gray-500">
                        {record.reviewerDepartment || ''} {ROLE_LABELS[record.reviewerRole] || record.reviewerRole}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {STATUS_LABELS[record.status] || record.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {record.comment || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDateTime(record.reviewedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* 審核進度指示器 */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">審核進度</h4>
        {renderProgressNodes()}
      </div>
      
      {/* 審核歷程表格 */}
      {showHistoryTable && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">審核歷程</h4>
          {renderHistoryTable()}
        </div>
      )}
    </div>
  );
}
