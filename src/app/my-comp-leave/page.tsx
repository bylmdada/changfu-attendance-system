'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Timer, ArrowUp, ArrowDown, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';

interface CompLeaveBalance {
  id: number;
  employeeId: number;
  confirmedBalance: number;
  pendingEarn: number;
  pendingUse: number;
  pendingBalance: number;
  availableBalance: number;
  totalEarned: number;
  totalUsed: number;
  updatedAt: string;
}

interface Transaction {
  id: number;
  transactionType: string;
  hours: number;
  isFrozen: boolean;
  referenceType?: string | null;
  referenceId?: number;
  description?: string | null;
  yearMonth: string;
  createdAt: string;
}

interface User {
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
}

export default function MyCompLeavePage() {
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<CompLeaveBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user || data);
      } else {
        window.location.href = '/login';
      }
    } catch {
      window.location.href = '/login';
    }
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const response = await fetch('/api/comp-leave/balance', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setBalance(data.balance);
          setTransactions(data.recentTransactions || []);
        }
      }
    } catch (error) {
      console.error('載入補休餘額失敗:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = '補休查詢 - 長福會考勤系統';
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user) {
      loadBalance();
    }
  }, [user, loadBalance]);

  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 0) return `${h} 小時`;
    return `${h} 小時 ${m} 分`;
  };

  const getTransactionTypeLabel = (type: string) => {
    switch (type) {
      case 'EARN': return '獲得';
      case 'USE': return '使用';
      case 'SETTLE': return '結算';
      case 'EXPIRE': return '到期';
      default: return type;
    }
  };

  const getTransactionTypeColor = (type: string) => {
    switch (type) {
      case 'EARN': return 'text-green-600 bg-green-100';
      case 'USE': return 'text-red-600 bg-red-100';
      case 'SETTLE': return 'text-orange-600 bg-orange-100';
      case 'EXPIRE': return 'text-gray-600 bg-gray-200';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getTransactionDescription = (tx: Transaction) => {
    if (tx.description) {
      return tx.description;
    }

    switch (tx.referenceType) {
      case 'OVERTIME':
        return '加班補休';
      case 'LEAVE':
        return '補休請假';
      case 'IMPORT':
        return '餘額匯入';
      case 'ADJUSTMENT':
        return '手動調整';
      case 'RESIGNATION':
        return '離職結算';
      default:
        return '補休異動';
    }
  };

  const isDecrementTransaction = (type: string) => type === 'USE' || type === 'SETTLE' || type === 'EXPIRE';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {user && <ResponsiveSidebar user={user} />}
      
      <div className="lg:pl-64">
        <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">補休查詢</h1>
            <p className="mt-1 text-sm text-gray-600">
              查看您的補休時數餘額與異動紀錄
            </p>
          </div>

          {/* 餘額卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* 可用餘額 */}
            <div className="bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-xl p-5 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-cyan-100 text-sm">可用補休時數</p>
                  <p className="text-3xl font-bold mt-1">
                    {balance ? formatHours(balance.availableBalance) : '--'}
                  </p>
                </div>
                <Timer className="w-12 h-12 text-cyan-200 opacity-80" />
              </div>
            </div>

            {/* 待確認獲得 */}
            <div className="bg-white rounded-xl p-5 shadow border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-500 text-sm flex items-center gap-1">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    待確認獲得
                  </p>
                  <p className="text-2xl font-bold text-green-600 mt-1">
                    +{balance ? formatHours(balance.pendingEarn) : '--'}
                  </p>
                </div>
                <ArrowUp className="w-10 h-10 text-green-200" />
              </div>
            </div>

            {/* 待確認使用 */}
            <div className="bg-white rounded-xl p-5 shadow border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-500 text-sm flex items-center gap-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    待確認使用
                  </p>
                  <p className="text-2xl font-bold text-red-600 mt-1">
                    -{balance ? formatHours(balance.pendingUse) : '--'}
                  </p>
                </div>
                <ArrowDown className="w-10 h-10 text-red-200" />
              </div>
            </div>
          </div>

          {/* 累計統計 */}
          <div className="bg-white rounded-xl p-5 shadow border border-gray-100 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gray-600" />
              累計統計
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600">累計獲得</p>
                <p className="text-xl font-bold text-green-700">
                  {balance ? formatHours(balance.totalEarned) : '--'}
                </p>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <p className="text-sm text-red-600">累計使用</p>
                <p className="text-xl font-bold text-red-700">
                  {balance ? formatHours(balance.totalUsed) : '--'}
                </p>
              </div>
            </div>
          </div>

          {/* 異動紀錄 */}
          <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-600" />
                最近異動紀錄
              </h2>
            </div>
            <div className="divide-y divide-gray-100">
              {transactions.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  目前沒有補休異動紀錄
                </div>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className="px-5 py-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTransactionTypeColor(tx.transactionType)}`}>
                        {getTransactionTypeLabel(tx.transactionType)}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {getTransactionDescription(tx)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(tx.createdAt).toLocaleDateString('zh-TW')} {tx.yearMonth && `(${tx.yearMonth})`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${isDecrementTransaction(tx.transactionType) ? 'text-red-600' : 'text-green-600'}`}>
                        {isDecrementTransaction(tx.transactionType) ? '-' : '+'}{formatHours(tx.hours)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {tx.isFrozen ? '✓ 已確認' : '⏳ 待確認'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 說明 */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h3 className="text-sm font-medium text-blue-800 mb-2">💡 補休說明</h3>
            <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>加班產生的補休時數會顯示在「待確認獲得」</li>
              <li>請假使用補休會顯示在「待確認使用」</li>
              <li>每月凍結後，待確認時數會轉為可用餘額</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
