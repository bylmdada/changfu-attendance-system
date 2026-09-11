'use client';

import { useEffect, useMemo, useState } from 'react';

export interface EmployeeListOption {
  id: number;
  employeeId: string;
  name: string;
  department?: string | null;
  position?: string | null;
  isActive?: boolean;
}

type EmployeeValueField = 'employeeId' | 'id';

interface EmployeeListSelectProps {
  value: string;
  onChange: (value: string, employee: EmployeeListOption | null) => void;
  label?: string;
  emptyLabel?: string;
  className?: string;
  selectClassName?: string;
  disabled?: boolean;
  valueField?: EmployeeValueField;
  includeInactive?: boolean;
  departmentFilter?: string;
}

export async function loadEmployeeOptions(includeInactive = false) {
  const params = new URLSearchParams({ limit: '1000' });
  if (!includeInactive) params.set('status', 'active');
  const response = await fetch(`/api/employees?${params}`, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('載入員工清單失敗');
  const data = await response.json();
  return (data.employees || []) as EmployeeListOption[];
}

export function useActiveEmployeeDepartments() {
  const [employees, setEmployees] = useState<EmployeeListOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadEmployeeOptions(false)
      .then((items) => {
        if (!mounted) return;
        setEmployees(items);
        setError('');
      })
      .catch((loadError) => {
        if (!mounted) return;
        console.error('載入員工部門清單失敗:', loadError);
        setError('部門清單載入失敗');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          employees
            .map((employee) => employee.department?.trim())
            .filter((department): department is string => Boolean(department))
        )
      ).sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [employees]
  );

  return { departments, loading, error };
}

export default function EmployeeListSelect({
  value,
  onChange,
  label,
  emptyLabel = '全部員工',
  className = '',
  selectClassName = '',
  disabled = false,
  valueField = 'employeeId',
  includeInactive = false,
  departmentFilter = '',
}: EmployeeListSelectProps) {
  const [employees, setEmployees] = useState<EmployeeListOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadEmployeeOptions(includeInactive)
      .then((items) => {
        if (!mounted) return;
        setEmployees(items);
        setError('');
      })
      .catch((loadError) => {
        if (!mounted) return;
        console.error('載入員工清單失敗:', loadError);
        setError('員工清單載入失敗');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [includeInactive]);

  const sortedEmployees = useMemo(
    () =>
      employees
        .filter((employee) => !departmentFilter || employee.department === departmentFilter)
        .sort((a, b) => {
        const departmentCompare = (a.department || '').localeCompare(b.department || '', 'zh-TW');
        if (departmentCompare !== 0) return departmentCompare;
        return a.employeeId.localeCompare(b.employeeId, 'zh-TW', { numeric: true });
      }),
    [employees, departmentFilter]
  );

  const getOptionValue = (employee: EmployeeListOption) =>
    valueField === 'id' ? String(employee.id) : employee.employeeId;

  const handleChange = (nextValue: string) => {
    const selectedEmployee =
      sortedEmployees.find((employee) => getOptionValue(employee) === nextValue) || null;
    onChange(nextValue, selectedEmployee);
  };

  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <select
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        disabled={disabled || loading}
        className={
          selectClassName ||
          'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500'
        }
      >
        <option value="">{loading ? '載入員工清單中...' : emptyLabel}</option>
        {sortedEmployees.map((employee) => (
          <option key={employee.id} value={getOptionValue(employee)}>
            {employee.name}（{employee.employeeId}）
            {employee.department ? `｜${employee.department}` : ''}
            {employee.position ? `｜${employee.position}` : ''}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
