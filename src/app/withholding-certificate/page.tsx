'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Printer, Calendar, TrendingUp, DollarSign } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface CertificateData {
  employee: {
    employeeId: string;
    name: string;
    department: string | null;
  };
  year: number;
  monthsWorked: number;
  totals: {
    grossPay: number;
    basePay: number;
    overtimePay: number;
    laborInsurance: number;
    healthInsurance: number;
    laborPensionSelf: number;
    incomeTax: number;
    netPay: number;
    exemptOvertimePay: number;
    taxableIncome: number;
  };
}

export default function WithholdingCertificatePage() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 可選年份 (近5年)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const fetchData = async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/withholding-certificate?year=${year}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        setData(result.certificate);
      } else {
        const err = await response.json();
        setError(err.error || '無法載入資料');
        setData(null);
      }
    } catch (err) {
      console.error('載入扣繳憑單失敗:', err);
      setError('載入失敗，請稍後再試');
      setData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData(selectedYear);
  }, [selectedYear]);

  const handleDownload = async () => {
    window.open(`/api/reports/withholding-certificate?year=${selectedYear}&format=html`, '_blank');
  };

  const handlePrint = async () => {
    window.open(`/api/reports/withholding-certificate?year=${selectedYear}&format=pdf`, '_blank');
  };

  return (
    <AuthenticatedLayout>
      <div className="p-6 max-w-4xl mx-auto">
        {/* 頁面標題 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-blue-600" />
            所得稅扣繳憑單
          </h1>
          <p className="text-gray-500 mt-1">查詢年度所得稅扣繳資料，供報稅使用</p>
        </div>

        {/* 年度選擇 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-gray-400" />
              <span className="text-gray-600">選擇年度：</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}年 (民國{year - 1911}年)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDownload}
                disabled={!data || loading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="w-4 h-4" />
                下載 HTML
              </button>
              <button
                onClick={handlePrint}
                disabled={!data || loading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Printer className="w-4 h-4" />
                列印
              </button>
            </div>
          </div>
        </div>

        {/* 載入中 */}
        {loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">載入中...</p>
          </div>
        )}

        {/* 錯誤訊息 */}
        {error && !loading && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
            <p className="text-yellow-800">{error}</p>
            <p className="text-yellow-600 text-sm mt-2">{selectedYear}年度可能尚無薪資記錄</p>
          </div>
        )}

        {/* 資料顯示 */}
        {data && !loading && (
          <div className="space-y-6">
            {/* 摘要卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-xl p-5">
                <div className="flex items-center gap-2 text-green-600 mb-2">
                  <DollarSign className="w-5 h-5" />
                  <span className="text-sm font-medium">給付總額</span>
                </div>
                <div className="text-2xl font-bold text-green-700">
                  NT$ {data.totals.grossPay.toLocaleString()}
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-red-200 rounded-xl p-5">
                <div className="flex items-center gap-2 text-red-600 mb-2">
                  <TrendingUp className="w-5 h-5" />
                  <span className="text-sm font-medium">扣繳稅額</span>
                </div>
                <div className="text-2xl font-bold text-red-700">
                  NT$ {data.totals.incomeTax.toLocaleString()}
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-5">
                <div className="flex items-center gap-2 text-blue-600 mb-2">
                  <FileText className="w-5 h-5" />
                  <span className="text-sm font-medium">應稅所得</span>
                </div>
                <div className="text-2xl font-bold text-blue-700">
                  NT$ {data.totals.taxableIncome.toLocaleString()}
                </div>
              </div>
            </div>

            {/* 詳細資訊 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">
                  {selectedYear}年度 扣繳憑單明細
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  服務月數：{data.monthsWorked} 個月 | 所得代碼：50 - 薪資所得
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">薪資所得</span>
                  <span className="font-medium">NT$ {data.totals.basePay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">加班費</span>
                  <span className="font-medium">NT$ {data.totals.overtimePay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3 bg-blue-50">
                  <span className="text-blue-700 font-medium">給付總額</span>
                  <span className="text-blue-700 font-bold">NT$ {data.totals.grossPay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">勞保費 (自付)</span>
                  <span className="font-medium text-gray-500">- NT$ {data.totals.laborInsurance.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">健保費 (自付)</span>
                  <span className="font-medium text-gray-500">- NT$ {data.totals.healthInsurance.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">勞退自提</span>
                  <span className="font-medium text-gray-500">- NT$ {data.totals.laborPensionSelf.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3">
                  <span className="text-gray-600">免稅加班費</span>
                  <span className="font-medium text-gray-500">- NT$ {data.totals.exemptOvertimePay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-3 bg-yellow-50">
                  <span className="text-yellow-700 font-medium">應稅所得淨額</span>
                  <span className="text-yellow-700 font-bold">NT$ {data.totals.taxableIncome.toLocaleString()}</span>
                </div>
                <div className="flex justify-between px-6 py-4 bg-red-50">
                  <span className="text-red-700 font-medium">已扣繳稅額</span>
                  <span className="text-red-700 font-bold text-lg">NT$ {data.totals.incomeTax.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* 說明區 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <h4 className="font-semibold text-amber-800 mb-2">📋 報稅注意事項</h4>
              <ul className="text-sm text-amber-700 space-y-1">
                <li>• 本資料依據所得稅法規定製作，請妥善保存以供報稅使用</li>
                <li>• 勞保費、健保費、勞退自提為免稅項目，可全額列為扣除額</li>
                <li>• 每月46小時以內加班費依法免稅</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
