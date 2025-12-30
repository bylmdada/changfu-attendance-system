'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  baseSalary: number;
}

interface BonusRecord {
  id: number;
  employeeId: number;
  bonusType: string;
  bonusTypeName: string;
  amount: number;
  payrollYear: number;
  payrollMonth: number;
  insuredAmount: number;
  exemptThreshold: number;
  cumulativeBonusBefore: number;
  cumulativeBonusAfter: number;
  calculationBase: number;
  supplementaryPremium: number;
  premiumRate: number;
  isAdjustment: boolean;
  adjustmentReason?: string;
  createdAt: string;
  employee: Employee;
}

interface AnnualSummary {
  totalBonusAmount: number;
  supplementaryPremium: number;
}

interface BonusFormData {
  employeeId: string;
  bonusType: string;
  bonusTypeName: string;
  amount: string;
  payrollYear: string;
  payrollMonth: string;
}

const BONUS_TYPES = [
  { value: 'YEAR_END', label: '年終獎金' },
  { value: 'FESTIVAL', label: '三節獎金' },
  { value: 'PERFORMANCE', label: '績效獎金' },
  { value: 'OTHER', label: '其他獎金' }
];

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: (i + 1).toString(),
  label: `${i + 1}月`
}));

interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

export default function BonusManagementPage() {
  const [bonusRecords, setBonusRecords] = useState<BonusRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BonusRecord | null>(null);
  const [annualSummary, setAnnualSummary] = useState<AnnualSummary | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  // 獲取認證 headers
  const getAuthHeaders = (): HeadersInit => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  // 獲取當前用戶
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data.user);
        }
      } catch (error) {
        console.error('獲取當前用戶失敗:', error);
      }
    };
    fetchCurrentUser();
  }, []);
  
  // 篩選狀態
  const [filters, setFilters] = useState({
    employeeId: '',
    year: new Date().getFullYear().toString(),
    month: '',
    bonusType: ''
  });

  // 表單狀態
  const [formData, setFormData] = useState<BonusFormData>({
    employeeId: '',
    bonusType: '',
    bonusTypeName: '',
    amount: '',
    payrollYear: new Date().getFullYear().toString(),
    payrollMonth: new Date().getMonth() + 1 + ''
  });

  // 載入員工列表
  useEffect(() => {
    fetchEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 載入獎金記錄
  useEffect(() => {
    fetchBonusRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees', {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('載入員工列表失敗:', error);
    }
  };

  const fetchBonusRecords = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      if (filters.employeeId) params.append('employeeId', filters.employeeId);
      if (filters.year) params.append('year', filters.year);
      if (filters.month) params.append('month', filters.month);

      const response = await fetch(`/api/bonuses?${params}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setBonusRecords(data.data.records || []);
        setAnnualSummary(data.data.annualSummary);
      }
    } catch (error) {
      console.error('載入獎金記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.employeeId || !formData.amount || !formData.bonusType) {
      alert('請填寫必要欄位');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _selectedEmployee = employees.find(emp => emp.id.toString() === formData.employeeId);
      const payload = {
        ...formData,
        employeeId: parseInt(formData.employeeId),
        amount: parseFloat(formData.amount),
        payrollYear: parseInt(formData.payrollYear),
        payrollMonth: parseInt(formData.payrollMonth),
        bonusTypeName: formData.bonusTypeName || BONUS_TYPES.find(t => t.value === formData.bonusType)?.label || formData.bonusType,
        createdBy: currentUser?.id || 1
      };

      let response;
      if (editingRecord) {
        response = await fetchJSONWithCSRF('/api/bonuses', {
          method: 'PUT',
          body: {
            ...payload,
            id: editingRecord.id
          }
        });
      } else {
        response = await fetchJSONWithCSRF('/api/bonuses', {
          method: 'POST',
          body: payload
        });
      }

      if (response.ok) {
        const result = await response.json();
        console.log('獎金處理成功:', result);
        
        // 重置表單
        resetForm();
        fetchBonusRecords();
      } else {
        const error = await response.json();
        alert(`操作失敗: ${error.error}`);
      }
    } catch (error) {
      console.error('提交失敗:', error);
      alert('操作失敗，請稍後重試');
    }
  };

  const handleEdit = (record: BonusRecord) => {
    setEditingRecord(record);
    setFormData({
      employeeId: record.employeeId.toString(),
      bonusType: record.bonusType,
      bonusTypeName: record.bonusTypeName,
      amount: record.amount.toString(),
      payrollYear: record.payrollYear.toString(),
      payrollMonth: record.payrollMonth.toString()
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定要刪除這筆獎金記錄嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/bonuses?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        fetchBonusRecords();
      } else {
        const error = await response.json();
        alert(`刪除失敗: ${error.error}`);
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      alert('刪除失敗，請稍後重試');
    }
  };

  const resetForm = () => {
    setFormData({
      employeeId: '',
      bonusType: '',
      bonusTypeName: '',
      amount: '',
      payrollYear: new Date().getFullYear().toString(),
      payrollMonth: (new Date().getMonth() + 1).toString()
    });
    setEditingRecord(null);
    setShowForm(false);
  };

  const calculateSupplementaryPremium = (record: BonusRecord) => {
    if (record.supplementaryPremium > 0) {
      return (
        <div className="text-sm space-y-1">
          <div>計費基數: NT$ {record.calculationBase.toLocaleString()}</div>
          <div>費率: {(record.premiumRate * 100).toFixed(2)}%</div>
          <div className="font-semibold text-red-600">
            補充保費: NT$ {record.supplementaryPremium.toLocaleString()}
          </div>
        </div>
      );
    }
    return <span className="text-gray-500">免扣</span>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">獎金管理</h1>
        <Button 
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          新增獎金
        </Button>
      </div>

      {/* 年度統計卡片 */}
      {annualSummary && (
        <Card>
          <CardHeader>
            <CardTitle>年度獎金統計 ({filters.year}年)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  NT$ {annualSummary.totalBonusAmount.toLocaleString()}
                </div>
                <div className="text-sm text-gray-600">累計獎金總額</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  NT$ {annualSummary.supplementaryPremium.toLocaleString()}
                </div>
                <div className="text-sm text-gray-600">累計補充保費</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 篩選器 */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Select value={filters.employeeId} onValueChange={(value) => setFilters({...filters, employeeId: value})}>
              <SelectTrigger>
                <SelectValue placeholder="選擇員工" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部員工</SelectItem>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id.toString()}>
                    {emp.name} ({emp.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="number"
              placeholder="年份"
              value={filters.year}
              onChange={(e) => setFilters({...filters, year: e.target.value})}
            />

            <Select value={filters.month} onValueChange={(value) => setFilters({...filters, month: value})}>
              <SelectTrigger>
                <SelectValue placeholder="選擇月份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部月份</SelectItem>
                {MONTHS.map(month => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.bonusType} onValueChange={(value) => setFilters({...filters, bonusType: value})}>
              <SelectTrigger>
                <SelectValue placeholder="獎金類型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部類型</SelectItem>
                {BONUS_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 獎金記錄列表 */}
      <Card>
        <CardHeader>
          <CardTitle>獎金記錄</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">載入中...</div>
          ) : bonusRecords.length === 0 ? (
            <div className="text-center py-8 text-gray-500">沒有找到獎金記錄</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>員工</TableHead>
                  <TableHead>獎金類型</TableHead>
                  <TableHead>發放年月</TableHead>
                  <TableHead>獎金金額</TableHead>
                  <TableHead>投保金額</TableHead>
                  <TableHead>累計獎金</TableHead>
                  <TableHead>補充保費</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonusRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{record.employee.name}</div>
                        <div className="text-sm text-gray-500">
                          {record.employee.employeeId} - {record.employee.department}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{record.bonusTypeName}</Badge>
                    </TableCell>
                    <TableCell>
                      {record.payrollYear}/{record.payrollMonth.toString().padStart(2, '0')}
                    </TableCell>
                    <TableCell className="font-medium">
                      NT$ {record.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      NT$ {record.insuredAmount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-gray-900">
                        <div>發放前: NT$ {record.cumulativeBonusBefore.toLocaleString()}</div>
                        <div>發放後: NT$ {record.cumulativeBonusAfter.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">
                          免扣門檻: NT$ {record.exemptThreshold.toLocaleString()}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {calculateSupplementaryPremium(record)}
                    </TableCell>
                    <TableCell>
                      {record.isAdjustment && (
                        <Badge variant="secondary">調整</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(record)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(record.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 新增/編輯獎金表單 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingRecord ? '編輯獎金' : '新增獎金'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">員工</label>
                  <Select 
                    value={formData.employeeId} 
                    onValueChange={(value) => setFormData({...formData, employeeId: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇員工" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => (
                        <SelectItem key={emp.id} value={emp.id.toString()}>
                          {emp.name} ({emp.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">獎金類型</label>
                  <Select 
                    value={formData.bonusType} 
                    onValueChange={(value) => setFormData({...formData, bonusType: value})}
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">獎金金額</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    placeholder="請輸入獎金金額"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">年份</label>
                  <Input
                    type="number"
                    value={formData.payrollYear}
                    onChange={(e) => setFormData({...formData, payrollYear: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">月份</label>
                  <Select 
                    value={formData.payrollMonth} 
                    onValueChange={(value) => setFormData({...formData, payrollMonth: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇月份" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map(month => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">獎金名稱 (可選)</label>
                  <Input
                    value={formData.bonusTypeName}
                    onChange={(e) => setFormData({...formData, bonusTypeName: e.target.value})}
                    placeholder="自訂獎金名稱"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingRecord ? '更新' : '新增'}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
