'use client';

import { useCallback, useEffect, useState } from 'react';
import { Save, Trash2, Upload, Plus, Loader2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import fetchWithCSRF from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import SystemNavbar from '@/components/SystemNavbar';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId?: string;
    name: string;
    department?: string;
    position?: string;
  };
}
interface Site {
  id: number;
  name: string;
  code: string;
  institutionTitle: string;
  _count?: { assets: number };
}
interface Assignment {
  id: number;
  userId: number;
  maintenanceRole: string;
  employeeId?: string;
  employeeName?: string;
  username?: string;
  email?: string;
  department?: string;
  position?: string;
}
interface EmployeeCandidate {
  id: number;
  employeeId: string;
  name: string;
  email?: string | null;
  department?: string | null;
  position?: string | null;
  userId: number;
  username: string;
  role: string;
}
interface SettingsForm {
  emailEnabled: boolean;
  reminderDays: number;
  maintenanceWeekday: number;
  reviewWeekday: number;
  supervisorEmail: string;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function PropertyMgmtSettingsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [settings, setSettings] = useState<SettingsForm>({
    emailEnabled: true,
    reminderDays: 3,
    maintenanceWeekday: 3,
    reviewWeekday: 4,
    supervisorEmail: '',
  });
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [newUser, setNewUser] = useState({ userId: '', username: '', maintenanceRole: 'MAINTAINER' });
  const [employeeCandidates, setEmployeeCandidates] = useState<EmployeeCandidate[]>([]);
  const [employeeFilterOptions, setEmployeeFilterOptions] = useState({
    departments: [] as string[],
    positions: [] as string[],
  });
  const [employeeFilters, setEmployeeFilters] = useState({ q: '', department: '', position: '' });
  const [employeeFilterDraft, setEmployeeFilterDraft] = useState({ q: '', department: '', position: '' });
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingSiteData, setLoadingSiteData] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>('');

  const loadSites = useCallback(async () => {
    setLoadingSites(true);
    try {
      const res = await fetch('/api/property-maintenance/sites?manage=1', { credentials: 'include' });
      const json = await res.json();
      if (res.ok) {
        const nextSites = json.data as Site[];
        setSites(nextSites);
        setSiteId((current) =>
          current !== null && nextSites.some((site) => site.id === current)
            ? current
            : nextSites[0]?.id ?? null
        );
      } else {
        setSites([]);
        setSiteId(null);
        showToast('error', json.error || '載入據點失敗');
      }
    } catch {
      setSites([]);
      setSiteId(null);
      showToast('error', '載入據點失敗');
    } finally {
      setLoadingSites(false);
    }
  }, [showToast]);

  const loadSiteData = useCallback(async (sid: number) => {
    setLoadingSiteData(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/property-maintenance/settings?siteId=${sid}`, { credentials: 'include' }),
        fetch(`/api/property-maintenance/sites/${sid}/assignments`, { credentials: 'include' }),
      ]);
      const [settingsJson, assignmentsJson] = await Promise.all([
        sRes.json().catch(() => ({})),
        aRes.json().catch(() => ({})),
      ]);
      if (sRes.ok) {
        const r = settingsJson.data.resolved;
        setSettings({
          emailEnabled: r.emailEnabled,
          reminderDays: r.reminderDays,
          maintenanceWeekday: r.maintenanceWeekday,
          reviewWeekday: r.reviewWeekday,
          supervisorEmail: (r.supervisorEmail || []).join(', '),
        });
      } else {
        showToast('error', settingsJson.error || '載入設定失敗');
      }
      if (aRes.ok) {
        setAssignments(assignmentsJson.data);
      } else {
        setAssignments([]);
        showToast('error', assignmentsJson.error || '載入人員指派失敗');
      }
    } catch {
      setAssignments([]);
      showToast('error', '載入據點資料失敗');
    } finally {
      setLoadingSiteData(false);
    }
  }, [showToast]);

  const loadEmployeeCandidates = useCallback(async (
    sid: number,
    filters: { q: string; department: string; position: string }
  ) => {
    setLoadingCandidates(true);
    try {
      const params = new URLSearchParams({ candidates: '1' });
      if (filters.q.trim()) params.set('q', filters.q.trim());
      if (filters.department) params.set('department', filters.department);
      if (filters.position) params.set('position', filters.position);
      const res = await fetch(`/api/property-maintenance/sites/${sid}/assignments?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmployeeCandidates(json.data.employees || []);
        setEmployeeFilterOptions({
          departments: json.data.filters?.departments || [],
          positions: json.data.filters?.positions || [],
        });
      } else {
        setEmployeeCandidates([]);
        showToast('error', json.error || '載入員工清單失敗');
      }
    } catch {
      setEmployeeCandidates([]);
      showToast('error', '載入員工清單失敗');
    } finally {
      setLoadingCandidates(false);
    }
  }, [showToast]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          setUser(json.user || json);
        }
      } catch {
        showToast('error', '載入使用者資訊失敗');
      }
    };

    loadUser();
    loadSites();
  }, [loadSites, showToast]);
  useEffect(() => {
    if (siteId !== null) loadSiteData(siteId);
  }, [siteId, loadSiteData]);
  useEffect(() => {
    if (siteId !== null) loadEmployeeCandidates(siteId, employeeFilters);
  }, [siteId, employeeFilters, loadEmployeeCandidates]);

  const saveSettings = async () => {
    if (siteId === null) return;
    setSavingSettings(true);
    const payload = {
      siteId,
      settings: {
        emailEnabled: settings.emailEnabled,
        reminderDays: Number(settings.reminderDays),
        maintenanceWeekday: Number(settings.maintenanceWeekday),
        reviewWeekday: Number(settings.reviewWeekday),
        supervisorEmail: settings.supervisorEmail
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
    try {
      const res = await fetchJSONWithCSRF('/api/property-maintenance/settings', {
        method: 'PUT',
        body: payload,
      });
      const json = await res.json();
      showToast(res.ok ? 'success' : 'error', res.ok ? '已儲存設定' : json.error || '儲存失敗');
    } catch {
      showToast('error', '儲存失敗');
    } finally {
      setSavingSettings(false);
    }
  };

  const addAssignment = async () => {
    if (siteId === null || (!newUser.userId && !newUser.username.trim())) return;
    setSavingAssignment(true);
    try {
      const userId = newUser.userId ? Number(newUser.userId) : undefined;
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/sites/${siteId}/assignments`,
        {
          method: 'POST',
          body: {
            maintenanceRole: newUser.maintenanceRole,
            ...(userId ? { userId } : { username: newUser.username.trim() }),
          },
        }
      );
      const json = await res.json();
      if (res.ok) {
        showToast('success', '已新增指派');
        setNewUser({ userId: '', username: '', maintenanceRole: 'MAINTAINER' });
        loadSiteData(siteId);
      } else {
        showToast('error', json.error || '新增失敗');
      }
    } catch {
      showToast('error', '新增失敗');
    } finally {
      setSavingAssignment(false);
    }
  };

  const selectCandidate = (candidate: EmployeeCandidate) => {
    setNewUser((current) => ({
      ...current,
      userId: String(candidate.userId),
      username: candidate.username,
    }));
  };

  const applyEmployeeFilters = () => {
    setEmployeeFilters({
      q: employeeFilterDraft.q.trim(),
      department: employeeFilterDraft.department,
      position: employeeFilterDraft.position,
    });
  };

  const removeAssignment = async (userId: number) => {
    if (siteId === null) return;
    setRemovingUserId(userId);
    try {
      const res = await fetchWithCSRF(
        `/api/property-maintenance/sites/${siteId}/assignments?userId=${userId}`,
        { method: 'DELETE' }
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('success', '已移除');
        loadSiteData(siteId);
      } else {
        showToast('error', json.error || '移除失敗');
      }
    } catch {
      showToast('error', '移除失敗');
    } finally {
      setRemovingUserId(null);
    }
  };

  const doImport = async (file: File) => {
    if (siteId === null) return;
    setImporting(true);
    setImportResult('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('siteId', String(siteId));
      const res = await fetchWithCSRF('/api/property-maintenance/import', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (res.ok) {
        const r = json.data;
        setImportResult(
          `${r.message}\n未解析維護人員：${r.unresolvedMaintainers
            .map((u: { value: string; count: number }) => `${u.value}(${u.count})`)
            .join('、') || '無'}`
        );
        showToast('success', '匯入完成');
        loadSites();
      } else {
        showToast('error', json.error || '匯入失敗');
      }
    } catch {
      showToast('error', '匯入失敗');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">財產管理設定</h1>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <label className="block text-sm font-medium text-gray-900 mb-1">選擇據點</label>
          <select
            value={siteId ?? ''}
            disabled={loadingSites || sites.length === 0}
            onChange={(e) => setSiteId(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 disabled:bg-gray-100"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s._count?.assets ?? 0} 筆資產）
              </option>
            ))}
          </select>
          {loadingSites ? (
            <p className="text-sm text-gray-900 mt-2">載入據點中…</p>
          ) : sites.length === 0 ? (
            <p className="text-sm text-orange-600 mt-2">目前沒有可管理的財產據點。</p>
          ) : null}
        </div>

        {siteId !== null && (
          <>
            {loadingSiteData && (
              <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
                載入據點設定中…
              </div>
            )}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-4">
            <h2 className="font-semibold text-gray-900">通知與排程設定</h2>
             <label className="flex items-center gap-2 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={settings.emailEnabled}
                onChange={(e) => setSettings({ ...settings, emailEnabled: e.target.checked })}
                className="h-4 w-4"
              />
              開啟 Email 通知（關閉則僅站內通知）
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  到期前提醒天數
                </label>
                <input
                  type="number"
                  min={0}
                  value={settings.reminderDays}
                  onChange={(e) =>
                    setSettings({ ...settings, reminderDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                 <label className="block text-sm font-medium text-gray-900 mb-1">主管 Email</label>
                <input
                  value={settings.supervisorEmail}
                  onChange={(e) =>
                    setSettings({ ...settings, supervisorEmail: e.target.value })
                  }
                  placeholder="多筆以逗號分隔"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                 <label className="block text-sm font-medium text-gray-900 mb-1">維護日</label>
                <select
                  value={settings.maintenanceWeekday}
                  onChange={(e) =>
                    setSettings({ ...settings, maintenanceWeekday: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={i} value={i}>
                      週{d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                 <label className="block text-sm font-medium text-gray-900 mb-1">審查日</label>
                <select
                  value={settings.reviewWeekday}
                  onChange={(e) =>
                    setSettings({ ...settings, reviewWeekday: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={i} value={i}>
                      週{d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-800">
              註：維護日/審查日為設定記錄；實際排程由伺服器 cron（週三產生任務、週四彙整、每日提醒）執行。
            </p>
            <button
              onClick={saveSettings}
              disabled={savingSettings || loadingSiteData}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              儲存設定
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h2 className="font-semibold text-gray-900 mb-3">維護／審核人員指派</h2>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-3">
              <input
                value={employeeFilterDraft.q}
                onChange={(e) => setEmployeeFilterDraft({ ...employeeFilterDraft, q: e.target.value })}
                placeholder="搜尋姓名／員工編號"
                className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
              <select
                value={employeeFilterDraft.department}
                onChange={(e) => setEmployeeFilterDraft({ ...employeeFilterDraft, department: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              >
                <option value="">全部部門</option>
                {employeeFilterOptions.departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
              <select
                value={employeeFilterDraft.position}
                onChange={(e) => setEmployeeFilterDraft({ ...employeeFilterDraft, position: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              >
                <option value="">全部職位</option>
                {employeeFilterOptions.positions.map((position) => (
                  <option key={position} value={position}>{position}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyEmployeeFilters}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                套用篩選
              </button>
            </div>
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50">
              <div className="px-3 py-2 text-sm font-medium text-gray-900 border-b border-gray-200">
                員工清單（{loadingCandidates ? '載入中…' : `${employeeCandidates.length} 筆`}）
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-gray-200">
                {employeeCandidates.map((candidate) => (
                  <button
                    key={candidate.userId}
                    type="button"
                    onClick={() => selectCandidate(candidate)}
                    className={`w-full text-left px-3 py-2 hover:bg-blue-50 ${
                      newUser.userId === String(candidate.userId) ? 'bg-blue-50' : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm text-gray-900">
                      <span className="font-medium">
                        {candidate.name}（{candidate.employeeId}）
                      </span>
                      <span className="text-gray-800">
                        {candidate.department || '未填部門'}／{candidate.position || '未填職位'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-800">
                      帳號：{candidate.username}　Email：{candidate.email || '無'}
                    </div>
                  </button>
                ))}
                {!loadingCandidates && employeeCandidates.length === 0 && (
                  <div className="px-3 py-4 text-sm text-gray-900">查無可指派員工</div>
                )}
              </div>
            </div>
            <div className="flex flex-col md:flex-row gap-2 mb-3">
              <input
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, userId: '', username: e.target.value })}
                placeholder="可由上方員工清單帶入，或手動輸入使用者帳號"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
              <select
                value={newUser.maintenanceRole}
                onChange={(e) => setNewUser({ ...newUser, maintenanceRole: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              >
                <option value="MAINTAINER">維護人員</option>
                <option value="SUPERVISOR">主管/稽核</option>
                <option value="ADMIN">據點管理員</option>
              </select>
              <button
                onClick={addAssignment}
                disabled={savingAssignment || (!newUser.userId && !newUser.username.trim())}
                className="inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingAssignment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                新增
              </button>
            </div>
            <ul className="divide-y divide-gray-100 text-gray-900">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">
                      {a.employeeName || `User#${a.userId}`}（{a.employeeId || a.username || '無員工編號'}）
                    </p>
                    <p className="text-xs text-gray-800">
                      {a.department || '未填部門'}／{a.position || '未填職位'}・{a.email || '無 email'}・
                      {a.maintenanceRole === 'SUPERVISOR'
                        ? '主管/稽核'
                        : a.maintenanceRole === 'ADMIN'
                          ? '據點管理員'
                          : '維護人員'}
                    </p>
                  </div>
                  <button
                    onClick={() => removeAssignment(a.userId)}
                    disabled={removingUserId === a.userId}
                    className="text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {removingUserId === a.userId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </li>
              ))}
              {assignments.length === 0 && (
                <li className="py-3 text-sm text-gray-900">尚無指派人員</li>
              )}
            </ul>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-2">資料匯入（財產盤點 .xlsx）</h2>
            <p className="text-xs text-gray-800 mb-3">
              匯入財產主檔、維護執行紀錄、人員名冊。可重複執行，依唯一鍵更新不重複。
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-900">
              <Upload className="w-4 h-4" />
              {importing ? '匯入中…' : '選擇 .xlsx 檔'}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={importing}
                onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
              />
            </label>
            {importResult && (
              <pre className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-900 whitespace-pre-wrap">
                {importResult}
              </pre>
            )}
          </div>
        </>
      )}
      </main>
      <SimpleToast toast={toast} onClose={clearToast} />
    </div>
  );
}
