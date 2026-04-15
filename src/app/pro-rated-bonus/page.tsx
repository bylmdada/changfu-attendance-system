'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calculator, Users, FileText, AlertCircle, CheckCircle, Clock, Download, Settings } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  baseSalary: number;
  hireDate: string;
  isActive: boolean;
}

interface ProRatedBonusResult {
  employeeId: number;
  bonusType: string;
  bonusTypeName: string;
  fullAmount: number;
  serviceMonths: number;
  totalMonths: number;
  proRatedRatio: number;
  proRatedAmount: number;
  isProRated: boolean;
  calculationDetails: {
    hireDate: string;
    calculationDate: string;
    serviceStartDate: string;
    serviceEndDate: string;
    eligibleForBonus: boolean;
    minimumServiceMet: boolean;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface FestivalBonusResult extends ProRatedBonusResult {
  festivalInfo: {
    festivalName: string;
    festivalMonth: number;
    festivalDescription: string;
  };
}

const BONUS_TYPES = [
  { value: 'YEAR_END', label: '年終獎金' },
  { value: 'FESTIVAL', label: '三節獎金' }
];

const FESTIVAL_TYPES = [
  { value: 'spring_festival', label: '春節獎金', month: 2 },
  { value: 'dragon_boat', label: '端午節獎金', month: 6 },
  { value: 'mid_autumn', label: '中秋節獎金', month: 9 }
];

export default function ProRatedBonusPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [calculations, setCalculations] = useState<any>({});
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reportData, setReportData] = useState<any>(null);

  // 設定狀態
  const [settings, setSettings] = useState({
    targetYear: new Date().getFullYear(),
    bonusType: '',
    festivalType: 'spring_festival',
    autoCreateRecords: false
  });

  // 載入員工列表
  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('載入員工列表失敗:', error);
    }
  };

  // 批量計算按比例獎金
  const handleBatchCalculate = async () => {
    if (!settings.bonusType) {
      alert('請選擇獎金類型');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'calculate-batch',
        year: settings.targetYear.toString(),
        bonusType: settings.bonusType
      });

      const response = await fetch(`/api/pro-rated-bonuses?${params}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setCalculations(data.data.calculations);
      } else {
        const error = await response.json();
        alert(`計算失敗: ${error.error}`);
      }
    } catch (error) {
      console.error('批量計算失敗:', error);
      alert('計算失敗，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  // 產生報表
  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'generate-report',
        year: settings.targetYear.toString()
      });

      const response = await fetch(`/api/pro-rated-bonuses?${params}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setReportData(data.data);
      } else {
        const error = await response.json();
        alert(`報表生成失敗: ${error.error}`);
      }
    } catch (error) {
      console.error('報表生成失敗:', error);
      alert('報表生成失敗，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  // 批量創建獎金記錄
  const handleBatchCreateRecords = async () => {
    if (selectedEmployees.length === 0) {
      alert('請選擇要發放獎金的員工');
      return;
    }

    if (!confirm(`確定要為 ${selectedEmployees.length} 位員工創建${settings.bonusType === 'YEAR_END' ? '年終' : '三節'}獎金記錄嗎？`)) {
      return;
    }

    setLoading(true);
    try {
      const requestedEmployeeIds = [...selectedEmployees];
      const response = await fetchJSONWithCSRF('/api/pro-rated-bonuses', {
        method: 'POST',
        body: {
          action: 'batch-calculate-and-create',
          employeeIds: selectedEmployees,
          bonusType: settings.bonusType,
          festivalType: settings.bonusType === 'FESTIVAL' ? settings.festivalType : undefined,
          year: settings.targetYear,
          autoCreateRecords: true
        }
      });

      if (response.ok) {
        const data = await response.json();
        const createdRecordsCount = typeof data?.data?.createdRecordsCount === 'number'
          ? data.data.createdRecordsCount
          : 0;
        const failedEmployeeIds = Array.isArray(data?.data?.failedEmployeeIds)
          ? data.data.failedEmployeeIds.filter((id: unknown): id is number => typeof id === 'number')
          : [];
        const successfulEmployeeIds = requestedEmployeeIds.filter(id => !failedEmployeeIds.includes(id));

        if (createdRecordsCount === 0 || successfulEmployeeIds.length === 0) {
          alert('創建記錄失敗：沒有任何獎金記錄建立成功');
          return;
        }

        if (failedEmployeeIds.length > 0) {
          alert(`成功創建 ${createdRecordsCount} 筆獎金記錄，${failedEmployeeIds.length} 位員工建立失敗`);
          setSelectedEmployees(failedEmployeeIds);
        } else {
          alert(`成功創建 ${createdRecordsCount} 筆獎金記錄`);
          setSelectedEmployees([]);
        }
        // 重新載入計算結果
        handleBatchCalculate();
      } else {
        const error = await response.json();
        alert(`創建記錄失敗: ${error.error}`);
      }
    } catch (error) {
      console.error('創建記錄失敗:', error);
      alert('創建記錄失敗，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  // 切換員工選擇
  const toggleEmployeeSelection = (employeeId: number) => {
    setSelectedEmployees(prev => 
      prev.includes(employeeId) 
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedEmployees.length === employees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(employees.map(emp => emp.id));
    }
  };

  // 取得計算結果顯示數據
  const getCalculationResults = () => {
    if (!calculations) return [];

    if (settings.bonusType === 'YEAR_END') {
      return calculations.yearEndBonus || [];
    } else if (settings.bonusType === 'FESTIVAL') {
      // 根據選擇的節慶類型返回對應結果
      const festivalResults = calculations.festivalBonus || {};
      return festivalResults[settings.festivalType] || [];
    }

    return [];
  };

  const calculationResults = getCalculationResults();

  // 計算統計資訊
  const statistics = {
    totalEmployees: employees.length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eligibleEmployees: calculationResults.filter((r: any) => r.calculationDetails.eligibleForBonus).length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proRatedEmployees: calculationResults.filter((r: any) => r.isProRated).length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    totalBonusAmount: calculationResults.reduce((sum: number, r: any) => sum + r.proRatedAmount, 0),
    averageBonusAmount: 0
  };

  if (statistics.eligibleEmployees > 0) {
    statistics.averageBonusAmount = Math.round(statistics.totalBonusAmount / statistics.eligibleEmployees);
  }

  // 匯出 CSV 功能
  const handleExportCSV = () => {
    if (calculationResults.length === 0) {
      alert('請先計算獎金後再匯出');
      return;
    }

    const headers = ['員工編號', '姓名', '部門', '到職日期', '服務月數', '基本薪資', '滿額獎金', '比例係數', '實發金額', '資格狀態'];
    const rows: string[][] = [];

    calculationResults.forEach((result: ProRatedBonusResult) => {
      const employee = employees.find(emp => emp.id === result.employeeId);
      if (!employee) return;

      rows.push([
        employee.employeeId,
        employee.name,
        employee.department,
        new Date(employee.hireDate).toLocaleDateString('zh-TW'),
        result.serviceMonths.toFixed(1),
        employee.baseSalary.toString(),
        result.fullAmount.toString(),
        (result.proRatedRatio * 100).toFixed(1) + '%',
        result.proRatedAmount.toString(),
        result.calculationDetails.eligibleForBonus ? '符合資格' : '不符資格'
      ]);
    });

    const BOM = '\uFEFF';
    const csvContent = BOM + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `按比例獎金計算結果_${settings.targetYear}_${settings.bonusType}.csv`;
    link.click();
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題和操作按鈕 */}
        <div className="mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Calculator className="w-8 h-8 text-purple-600 mr-3" />
                按比例獎金計算
              </h1>
              <p className="text-gray-600 mt-1">計算員工按比例發放的年終獎金與三節獎金</p>
            </div>
            <div className="flex gap-2">
              <a href="/system-settings/bonus-config">
                <Button variant="outline" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  配置設定
                </Button>
              </a>
              <Button 
                onClick={handleBatchCalculate}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <Calculator className="h-4 w-4" />
                {loading ? '計算中...' : '計算獎金'}
              </Button>
              <Button 
                onClick={handleExportCSV}
                disabled={calculationResults.length === 0}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                匯出 CSV
              </Button>
              <Button 
                onClick={handleGenerateReport}
                disabled={loading}
                variant="outline"
                className="flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                產生報表
              </Button>
            </div>
          </div>
        </div>

      {/* 設定區域 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-gray-900">計算設定</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">目標年度</label>
              <Input
                type="number"
                value={settings.targetYear}
                onChange={(e) => setSettings({...settings, targetYear: parseInt(e.target.value)})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">獎金類型</label>
              <Select 
                value={settings.bonusType} 
                onValueChange={(value) => setSettings({...settings, bonusType: value})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇獎金類型" />
                </SelectTrigger>
                <SelectContent>
                  {BONUS_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {settings.bonusType === 'FESTIVAL' && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">節慶類型</label>
                <Select 
                  value={settings.festivalType} 
                  onValueChange={(value) => setSettings({...settings, festivalType: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選擇節慶" />
                  </SelectTrigger>
                  <SelectContent>
                    {FESTIVAL_TYPES.map(festival => (
                      <SelectItem key={festival.value} value={festival.value}>
                        {festival.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center space-x-2 pt-6">
              <Checkbox
                id="autoCreate"
                checked={settings.autoCreateRecords}
                onCheckedChange={(checked) => setSettings({...settings, autoCreateRecords: !!checked})}
              />
              <label
                htmlFor="autoCreate"
                className="text-sm font-medium text-gray-900 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                自動創建記錄
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 統計資訊 */}
      {calculationResults.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-gray-900">統計資訊</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {statistics.totalEmployees}
                </div>
                <div className="text-sm text-gray-800">總員工數</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {statistics.eligibleEmployees}
                </div>
                <div className="text-sm text-gray-800">符合資格</div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  {statistics.proRatedEmployees}
                </div>
                <div className="text-sm text-gray-800">按比例發放</div>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  NT$ {statistics.totalBonusAmount.toLocaleString()}
                </div>
                <div className="text-sm text-gray-800">獎金總額</div>
              </div>
              <div className="text-center p-4 bg-indigo-50 rounded-lg">
                <div className="text-2xl font-bold text-indigo-600">
                  NT$ {statistics.averageBonusAmount.toLocaleString()}
                </div>
                <div className="text-sm text-gray-800">平均獎金</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 計算結果表格 */}
      {calculationResults.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-gray-900">計算結果</CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={toggleSelectAll}
                  variant="outline"
                  size="sm"
                >
                  {selectedEmployees.length === employees.length ? '取消全選' : '全選'}
                </Button>
                {selectedEmployees.length > 0 && (
                  <Button
                    onClick={handleBatchCreateRecords}
                    disabled={loading}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Users className="h-4 w-4" />
                    發放獎金 ({selectedEmployees.length})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedEmployees.length === employees.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-gray-900">員工</TableHead>
                  <TableHead className="text-gray-900">到職日期</TableHead>
                  <TableHead className="text-gray-900">服務月數</TableHead>
                  <TableHead className="text-gray-900">基本薪資</TableHead>
                  <TableHead className="text-gray-900">滿額獎金</TableHead>
                  <TableHead className="text-gray-900">比例係數</TableHead>
                  <TableHead className="text-gray-900">實發金額</TableHead>
                  <TableHead className="text-gray-900">狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculationResults.map((result: ProRatedBonusResult) => {
                  const employee = employees.find(emp => emp.id === result.employeeId);
                  if (!employee) return null;

                  return (
                    <TableRow key={result.employeeId}>
                      <TableCell>
                        <Checkbox
                          checked={selectedEmployees.includes(result.employeeId)}
                          onCheckedChange={() => toggleEmployeeSelection(result.employeeId)}
                          disabled={!result.calculationDetails.eligibleForBonus || result.proRatedAmount === 0}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-gray-900">{employee.name}</div>
                          <div className="text-sm text-gray-600">
                            {employee.employeeId} - {employee.department}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-900">
                        {new Date(employee.hireDate).toLocaleDateString('zh-TW')}
                      </TableCell>
                      <TableCell>
                        <div className="text-center">
                          <div className="font-medium text-gray-900">{result.serviceMonths.toFixed(1)} 個月</div>
                          {result.isProRated && (
                            <Badge variant="outline" className="mt-1">
                              <Clock className="h-3 w-3 mr-1" />
                              按比例
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-900">
                        NT$ {employee.baseSalary.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-gray-900">
                        NT$ {result.fullAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="text-center">
                          <div className="font-medium text-gray-900">
                            {(result.proRatedRatio * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-600">
                            ({result.serviceMonths.toFixed(1)}/{result.totalMonths})
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">
                        NT$ {result.proRatedAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {result.calculationDetails.eligibleForBonus ? (
                          result.proRatedAmount > 0 ? (
                            <Badge variant="default" className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              符合資格
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              免發放
                            </Badge>
                          )
                        ) : (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            不符資格
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 報表資訊 */}
      {reportData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900">{reportData.targetYear}年度綜合獎金報表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 年終獎金統計 */}
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-lg text-gray-900 mb-3">年終獎金</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-gray-900">
                      <span>符合資格人數:</span>
                      <span className="font-medium">{reportData.statistics.yearEndBonus.eligibleCount}人</span>
                    </div>
                    <div className="flex justify-between text-gray-900">
                      <span>按比例發放:</span>
                      <span className="font-medium">{reportData.statistics.yearEndBonus.proRatedCount}人</span>
                    </div>
                    <div className="flex justify-between text-gray-900">
                      <span>獎金總額:</span>
                      <span className="font-medium">NT$ {reportData.statistics.yearEndBonus.totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-gray-900">
                      <span>平均金額:</span>
                      <span className="font-medium">NT$ {reportData.statistics.yearEndBonus.averageAmount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* 三節獎金統計 */}
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-lg text-gray-900 mb-3">三節獎金</h3>
                  <div className="space-y-3">
                    {['spring', 'dragonBoat', 'midAutumn'].map(festival => {
                      const festivalNames = {
                        spring: '春節',
                        dragonBoat: '端午',
                        midAutumn: '中秋'
                      };
                      const festivalData = reportData.statistics.festivalBonus[festival];
                      
                      return (
                        <div key={festival} className="border-l-2 border-green-300 pl-3">
                          <div className="font-medium text-sm text-gray-900">{festivalNames[festival as keyof typeof festivalNames]}獎金</div>
                          <div className="text-xs text-gray-600">
                            符合資格: {festivalData.eligibleCount}人 | 
                            按比例: {festivalData.proRatedCount}人 | 
                            總額: NT$ {festivalData.totalAmount.toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </AuthenticatedLayout>
  );
}
