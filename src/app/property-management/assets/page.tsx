'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Download,
  Edit2,
  Loader2,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ConfirmDialog from '@/components/ConfirmDialog';
import fetchWithCSRF, { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import { fmtDate, taiwanDateInputValue } from '@/lib/property-status-ui';

interface Site {
  id: number;
  name: string;
}

interface CurrentUser {
  role?: string;
}

interface Asset {
  id: number;
  assetCode: string;
  name: string;
  photoPath: string | null;
  location: string | null;
  managerName: string | null;
  maintenanceFrequency: string | null;
  acquiredDate: string | null;
  nextMaintenanceDate: string | null;
  site?: { id: number; name: string };
}

interface AssetForm {
  id: number | null;
  siteId: string;
  assetCode: string;
  name: string;
  photoPath: string;
  location: string;
  managerName: string;
  maintenanceFrequency: string;
  acquiredDate: string;
  nextMaintenanceDate: string;
}

interface ImportResponse {
  message: string;
  results: {
    assets: {
      created: number;
      updated: number;
      skippedNoCode: number;
      duplicateInFile: number;
    };
  };
  preview?: {
    assets: {
      newSamples: string[];
      updateSamples: string[];
      duplicateSamples: string[];
    };
  };
  unresolvedMaintainers: { value: string; count: number }[];
  errors: string[];
}

const EMPTY_FORM: AssetForm = {
  id: null,
  siteId: '',
  assetCode: '',
  name: '',
  photoPath: '',
  location: '',
  managerName: '',
  maintenanceFrequency: '每月一次',
  acquiredDate: '',
  nextMaintenanceDate: '',
};

const FREQUENCY_OPTIONS = ['每週一次', '兩週一次', '每月一次', '每季一次', '每半年一次', '每年一次'];

export default function AssetsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [items, setItems] = useState<Asset[]>([]);
  const [readableSites, setReadableSites] = useState<Site[]>([]);
  const [manageableSites, setManageableSites] = useState<Site[]>([]);
  const [isGlobalPropertyAdmin, setIsGlobalPropertyAdmin] = useState(false);
  const [siteFilter, setSiteFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assetDeleteConfirm, setAssetDeleteConfirm] = useState<Asset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportResponse | null>(null);
  const [importResult, setImportResult] = useState('');
  const [qrByAssetId, setQrByAssetId] = useState<Record<number, { loading: boolean; dataUrl?: string; error?: string }>>({});
  const pageSize = 50;
  const canManageAssets = isGlobalPropertyAdmin || manageableSites.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (siteFilter) params.set('siteId', siteFilter);
      const res = await fetch(`/api/property-maintenance/assets?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok) {
        setItems(json.data.items);
        setTotal(json.data.total);
        setError('');
      } else {
        setError(json.error || '載入失敗');
      }
    } catch {
      setError('載入失敗');
    } finally {
      setLoading(false);
    }
  }, [query, page, siteFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const loadManageableSites = useCallback(async () => {
    try {
      const [readRes, manageRes] = await Promise.all([
        fetch('/api/property-maintenance/sites', { credentials: 'include' }),
        fetch('/api/property-maintenance/sites?manage=1', { credentials: 'include' }),
      ]);
      const [readJson, manageJson] = await Promise.all([
        readRes.json().catch(() => ({})),
        manageRes.json().catch(() => ({})),
      ]);
      setReadableSites(readRes.ok ? readJson.data : []);
      if (manageRes.ok) {
        setManageableSites(manageJson.data);
      } else {
        setManageableSites([]);
      }
    } catch {
      setReadableSites([]);
      setManageableSites([]);
    }
  }, []);

  const loadCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const user = (json.user || json) as CurrentUser;
        setIsGlobalPropertyAdmin(['ADMIN', 'HR'].includes(String(user.role || '').toUpperCase()));
      } else {
        setIsGlobalPropertyAdmin(false);
      }
    } catch {
      setIsGlobalPropertyAdmin(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadManageableSites(), loadCurrentUser()]);
  }, [loadManageableSites, loadCurrentUser]);

  const printLabels = async () => {
    if (items.length === 0) return;
    const res = await fetchWithCSRF('/api/property-maintenance/assets/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds: items.map((i) => i.id) }),
    });
    if (!res.ok) {
      setError((await res.text()) || '列印標籤失敗');
      return;
    }
    const html = await res.text();
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const toggleQr = async (asset: Asset) => {
    const current = qrByAssetId[asset.id];
    if (current?.loading) return;
    if (current?.dataUrl) {
      setQrByAssetId((prev) => {
        const next = { ...prev };
        delete next[asset.id];
        return next;
      });
      return;
    }
    setQrByAssetId((prev) => ({ ...prev, [asset.id]: { loading: true } }));
    try {
      const res = await fetch(`/api/property-maintenance/assets/${asset.id}/qr`, {
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setQrByAssetId((prev) => ({
          ...prev,
          [asset.id]: { loading: false, dataUrl: json.data.dataUrl },
        }));
      } else {
        setQrByAssetId((prev) => ({
          ...prev,
          [asset.id]: { loading: false, error: json.error || 'QR 載入失敗' },
        }));
      }
    } catch {
      setQrByAssetId((prev) => ({
        ...prev,
        [asset.id]: { loading: false, error: 'QR 載入失敗' },
      }));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const applySearch = () => {
    setPage(1);
    setQuery(searchText.trim());
  };

  const allHistoryExportHref = (format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ format });
    if (siteFilter) params.set('siteId', siteFilter);
    return `/api/property-maintenance/reports/history?${params.toString()}`;
  };

  const openCreateForm = () => {
    const selectedManageableSite = manageableSites.some((site) => String(site.id) === siteFilter)
      ? siteFilter
      : '';
    setForm({
      ...EMPTY_FORM,
      siteId: selectedManageableSite || String(manageableSites[0]?.id ?? ''),
    });
    setShowForm(true);
  };

  const openEditForm = (asset: Asset) => {
    setForm({
      id: asset.id,
      siteId: String(asset.site?.id ?? ''),
      assetCode: asset.assetCode,
      name: asset.name,
      photoPath: asset.photoPath || '',
      location: asset.location || '',
      managerName: asset.managerName || '',
      maintenanceFrequency: asset.maintenanceFrequency || '每月一次',
      acquiredDate: taiwanDateInputValue(asset.acquiredDate),
      nextMaintenanceDate: taiwanDateInputValue(asset.nextMaintenanceDate),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const saveAsset = async () => {
    const assetCode = form.assetCode.trim();
    const name = form.name.trim();
    if (!name || !assetCode || (!form.id && !form.siteId && !isGlobalPropertyAdmin)) {
      showToast('error', '請填寫據點、財產編號與財產名稱');
      return;
    }
    setSaving(true);
    try {
      const payload: {
        siteId?: number;
        assetCode: string;
        name: string;
        photoPath: string;
        location: string;
        managerName: string;
        maintenanceFrequency: string;
        acquiredDate: string;
        nextMaintenanceDate: string;
      } = {
        assetCode,
        name,
        photoPath: form.photoPath.trim(),
        location: form.location.trim(),
        managerName: form.managerName.trim(),
        maintenanceFrequency: form.maintenanceFrequency.trim(),
        acquiredDate: form.acquiredDate,
        nextMaintenanceDate: form.nextMaintenanceDate,
      };
      if (form.siteId) payload.siteId = Number(form.siteId);
      const res = await fetchJSONWithCSRF(
        form.id ? `/api/property-maintenance/assets/${form.id}` : '/api/property-maintenance/assets',
        {
          method: form.id ? 'PUT' : 'POST',
          body: payload,
        }
      );
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json.error || '儲存失敗');
        return;
      }
      showToast('success', form.id ? '已更新財產' : '已新增財產');
      closeForm();
      await Promise.all([loadManageableSites(), load()]);
    } catch {
      showToast('error', '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const deleteAsset = async (asset: Asset) => {
    setAssetDeleteConfirm(asset);
  };

  const performDeleteAsset = async () => {
    if (!assetDeleteConfirm) return;
    const asset = assetDeleteConfirm;
    setDeletingId(asset.id);
    try {
      const res = await fetchWithCSRF(`/api/property-maintenance/assets/${asset.id}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', json.error || '停用失敗');
        return;
      }
      showToast('success', '已停用財產');
      setAssetDeleteConfirm(null);
      await load();
    } catch {
      showToast('error', '停用失敗');
    } finally {
      setDeletingId(null);
    }
  };

  const buildImportFormData = (file: File, mode?: 'preview') => {
    const fd = new FormData();
    fd.append('file', file);
    if (mode) fd.append('mode', mode);
    if (siteFilter || manageableSites[0]?.id) {
      fd.append('siteId', siteFilter || String(manageableSites[0].id));
    }
    return fd;
  };

  const formatImportResult = (result: ImportResponse) =>
    `${result.message}\n財產主檔：新增 ${result.results.assets.created}、更新 ${result.results.assets.updated}、檔內重複 ${result.results.assets.duplicateInFile}、略過空白編號 ${result.results.assets.skippedNoCode}\n未解析維護人員：${
      result.unresolvedMaintainers
        .map((item: { value: string; count: number }) => `${item.value}(${item.count})`)
        .join('、') || '無'
    }`;

  const previewImportWorkbook = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('error', '僅支援 .xlsx 檔案');
      return;
    }
    setImporting(true);
    setImportResult('');
    setImportPreview(null);
    setSelectedImportFile(file);
    try {
      const res = await fetchWithCSRF('/api/property-maintenance/import', {
        method: 'POST',
        body: buildImportFormData(file, 'preview'),
      });
      const json = await res.json();
      if (!res.ok) {
        setSelectedImportFile(null);
        showToast('error', json.error || '檢測失敗');
        return;
      }
      const result = json.data;
      setImportPreview(result);
      showToast('success', '檢測完成，確認後請按「儲存匯入」');
    } catch {
      setSelectedImportFile(null);
      showToast('error', '檢測失敗');
    } finally {
      setImporting(false);
    }
  };

  const saveImportWorkbook = async () => {
    if (!selectedImportFile) return;
    setSavingImport(true);
    setImportResult('');
    try {
      const res = await fetchWithCSRF('/api/property-maintenance/import', {
        method: 'POST',
        body: buildImportFormData(selectedImportFile),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json.error || '儲存匯入失敗');
        return;
      }
      const result = json.data as ImportResponse;
      setImportResult(formatImportResult(result));
      setImportPreview(null);
      setSelectedImportFile(null);
      showToast('success', '已儲存匯入結果');
      await Promise.all([loadManageableSites(), load()]);
    } catch {
      showToast('error', '儲存匯入失敗');
    } finally {
      setSavingImport(false);
    }
  };

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">資產清冊／財產主檔管理</h1>
            <p className="text-sm text-gray-600 mt-1">
              一般員工可查詢財產資料；管理員可新增、編輯、停用，或批量匯入「財產主檔」工作表。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={allHistoryExportHref('xlsx')}
              className="inline-flex items-center gap-2 px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium"
            >
              <Download className="w-4 h-4" /> 匯出所有維護歷程 .xlsx
            </a>
            <a
              href={allHistoryExportHref('csv')}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white text-gray-900 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              <Download className="w-4 h-4" /> 匯出所有維護歷程 .csv
            </a>
            {canManageAssets && (
              <>
                <button
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  <Plus className="w-4 h-4" /> 新增財產
                </button>
                <label className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm cursor-pointer">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  匯入 .xlsx 財產主檔
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    disabled={importing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (file) previewImportWorkbook(file);
                    }}
                  />
                </label>
              </>
            )}
            {canManageAssets && (
              <button
                onClick={printLabels}
                disabled={items.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                <Printer className="w-4 h-4" /> 列印本頁 CODE_128 條碼
              </button>
            )}
          </div>
        </div>

        {canManageAssets && manageableSites.length === 0 && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            目前尚未建立財產據點；全域管理員可先新增單筆財產或匯入 .xlsx，系統會自動建立預設據點「溪北輔具中心」。
          </div>
        )}

        <div className="flex flex-col gap-2 md:flex-row mb-4">
          <select
            value={siteFilter}
            onChange={(e) => {
              setPage(1);
              setSiteFilter(e.target.value);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
          >
            <option value="">全部據點</option>
            {readableSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="搜尋財產編號／名稱／管理人"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={applySearch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            搜尋
          </button>
        </div>

        {showForm && (
          <div className="mb-4 bg-white rounded-xl border border-blue-200 shadow-sm">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {form.id ? '編輯財產資料' : '新增財產資料'}
              </h2>
              <button onClick={closeForm} aria-label="關閉表單" className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">據點</label>
                <select
                  value={form.siteId}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, siteId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 disabled:bg-gray-100"
                >
                  <option value="">
                    {isGlobalPropertyAdmin ? '未選擇時使用預設據點' : '請選擇據點'}
                  </option>
                  {manageableSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">財產編號</label>
                <input
                  value={form.assetCode}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100"
                  placeholder="例如 0112030601-0023"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">財產名稱</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">財產照片路徑</label>
                <input
                  value={form.photoPath}
                  onChange={(e) => setForm({ ...form, photoPath: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="可留空；匯入附件時由系統帶入"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">放置地點</label>
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">財產管理人</label>
                <input
                  value={form.managerName}
                  onChange={(e) => setForm({ ...form, managerName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">應維護頻率</label>
                <select
                  value={form.maintenanceFrequency}
                  onChange={(e) => setForm({ ...form, maintenanceFrequency: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">取得日期</label>
                <input
                  type="date"
                  value={form.acquiredDate}
                  onChange={(e) => setForm({ ...form, acquiredDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">應維護日期</label>
                <input
                  type="date"
                  value={form.nextMaintenanceDate}
                  onChange={(e) => setForm({ ...form, nextMaintenanceDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={saveAsset}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                儲存
              </button>
              <button
                onClick={closeForm}
                className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-black font-medium hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {importPreview && (
          <div className="mb-4 p-4 bg-white border border-emerald-200 rounded-xl text-sm text-gray-900 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">匯入檢測結果</h2>
                <p className="mt-1 text-gray-800">
                  新增 <span className="font-semibold text-green-700">{importPreview.results.assets.created}</span>、
                  更新 <span className="font-semibold text-amber-700">{importPreview.results.assets.updated}</span>、
                  檔內重複 <span className="font-semibold text-red-700">{importPreview.results.assets.duplicateInFile}</span>、
                  略過空白編號 <span className="font-semibold text-gray-900">{importPreview.results.assets.skippedNoCode}</span>
                </p>
                <p className="mt-1 text-gray-700">檔案：{selectedImportFile?.name}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveImportWorkbook}
                  disabled={savingImport}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingImport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  儲存匯入
                </button>
                <button
                  onClick={() => {
                    setImportPreview(null);
                    setSelectedImportFile(null);
                  }}
                  disabled={savingImport}
                  className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-black font-medium hover:bg-gray-50 disabled:opacity-50 disabled:text-gray-500"
                >
                  取消
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <ImportSample title="將新增" items={importPreview.preview?.assets.newSamples ?? []} />
              <ImportSample title="將更新" items={importPreview.preview?.assets.updateSamples ?? []} />
              <ImportSample title="檔內重複" items={importPreview.preview?.assets.duplicateSamples ?? []} />
            </div>
            {importPreview.errors.length > 0 && (
              <pre className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 whitespace-pre-wrap">
                {importPreview.errors.join('\n')}
              </pre>
            )}
          </div>
        )}

        {importResult && (
          <pre className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 whitespace-pre-wrap">
            {importResult}
          </pre>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-sm text-gray-900">
            <thead className="bg-gray-50 text-gray-900">
              <tr>
                <th className="px-3 py-2 text-left">財產編號</th>
                <th className="px-3 py-2 text-left">名稱</th>
                <th className="px-3 py-2 text-left">放置地點</th>
                <th className="px-3 py-2 text-left">管理人</th>
                <th className="px-3 py-2 text-left">頻率</th>
                <th className="px-3 py-2 text-left">下次應維護</th>
                {canManageAssets && <th className="px-3 py-2 text-right">管理</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {loading ? (
                <tr>
                  <td colSpan={canManageAssets ? 7 : 6} className="px-3 py-8 text-center text-gray-900">
                    載入中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canManageAssets ? 7 : 6} className="px-3 py-8 text-center text-gray-900">
                    查無資產
                  </td>
                </tr>
              ) : (
                items.map((a) => {
                  const canManageThisAsset =
                    isGlobalPropertyAdmin || manageableSites.some((site) => site.id === a.site?.id);
                  const qr = qrByAssetId[a.id];
                  return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900 min-w-48">
                      <div className="space-y-1">
                        <Link
                          href={`/property-management/assets/${a.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {a.assetCode}
                        </Link>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/property-maintenance/assets/${a.id}/barcode`}
                          alt={`CODE_128 財產條碼 ${a.assetCode}`}
                          className="h-10 w-44 object-contain rounded border border-gray-200 bg-white"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => toggleQr(a)}
                          disabled={qr?.loading}
                          className="text-xs font-medium text-gray-900 underline underline-offset-2 hover:text-blue-700 disabled:no-underline disabled:opacity-70"
                        >
                          {qr?.loading ? 'QR Code 載入中' : qr?.dataUrl ? '隱藏 QR Code' : '顯示 QR Code'}
                        </button>
                        {qr?.loading && <div className="text-xs text-gray-900">QR 載入中…</div>}
                        {qr?.error && <div className="text-xs text-red-700">{qr.error}</div>}
                        {qr?.dataUrl && (
                          <div className="inline-block rounded border border-gray-200 bg-white p-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={qr.dataUrl}
                              alt={`QR Code ${a.assetCode}`}
                              className="h-20 w-20"
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-900">{a.name}</td>
                    <td className="px-3 py-2 text-gray-900">{a.location || '—'}</td>
                    <td className="px-3 py-2 text-gray-900">{a.managerName || '—'}</td>
                    <td className="px-3 py-2 text-gray-900">{a.maintenanceFrequency || '—'}</td>
                    <td className="px-3 py-2 text-gray-900">{fmtDate(a.nextMaintenanceDate)}</td>
                    {canManageAssets && (
                      <td className="px-3 py-2 text-right">
                        {canManageThisAsset ? (
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() => openEditForm(a)}
                              aria-label={`編輯財產 ${a.assetCode}`}
                              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                              title="編輯"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteAsset(a)}
                              disabled={deletingId === a.id}
                              aria-label={`停用財產 ${a.assetCode}`}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title="停用"
                            >
                              {deletingId === a.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>共 {total} 筆</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-900 disabled:opacity-40"
            >
              上一頁
            </button>
            <span className="px-2 py-1.5">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-900 disabled:opacity-40"
            >
              下一頁
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(assetDeleteConfirm)}
        title="停用財產"
        message={assetDeleteConfirm ? `確定停用財產 ${assetDeleteConfirm.assetCode}？\n\n既有維護紀錄會保留，但此財產將不再列為啟用。` : ''}
        tone="danger"
        confirmLabel="停用財產"
        loading={deletingId === assetDeleteConfirm?.id}
        onCancel={() => {
          if (!deletingId) setAssetDeleteConfirm(null);
        }}
        onConfirm={performDeleteAsset}
      />
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}

function ImportSample({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {items.length > 0 ? (
        <p className="mt-1 text-gray-800 break-words">{items.join('、')}</p>
      ) : (
        <p className="mt-1 text-gray-600">無</p>
      )}
    </div>
  );
}
