'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Save, Loader2, Upload } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import fetchWithCSRF from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import { STATUS_UI, fmtDate, type DisplayStatus } from '@/lib/property-status-ui';

interface Rec {
  recordId: string;
  assetCode: string;
  status: string;
  displayStatus?: DisplayStatus;
  dueDate: string | null;
  completedDate: string | null;
  auditStatus: string | null;
  maintainerRaw: string | null;
  inventoryResult: string | null;
  assetCondition: string | null;
  maintenanceItem: string | null;
  otherNote: string | null;
  note: string | null;
  rejectReason: string | null;
  photoPath: string | null;
  signaturePath: string | null;
  asset?: { name: string; location: string | null };
}

const STATUS_OPTS = ['已完成', '異常'];
const INVENTORY_OPTS = ['帳物相符', '帳物不符', '待確認'];
const CONDITION_OPTS = ['良好', '待維修', '報廢', '遺失'];
const ITEM_OPTS = ['清潔', '功能檢查', '校正', '零件更換', '其他'];

export default function MyRecordsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [tab, setTab] = useState<'mine' | 'pending' | 'done'>('pending');
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Rec | null>(null);
  const [saving, setSaving] = useState(false);
  const [canMaintainProperty, setCanMaintainProperty] = useState(false);
  const [form, setForm] = useState({
    status: '已完成',
    inventoryResult: '帳物相符',
    assetCondition: '良好',
    maintenanceItem: '清潔',
    otherNote: '',
    note: '',
    photoPath: '',
    signaturePath: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs =
        tab === 'mine' ? 'mine=1' : tab === 'pending' ? 'status=PENDING' : 'status=DONE';
      const res = await fetch(`/api/property-maintenance/records?${qs}&pageSize=200`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok) setRows(json.data.items);
      else showToast('error', json.error || '載入失敗');
    } catch {
      showToast('error', '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [tab, showToast]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (res.ok) setCanMaintainProperty(!!(json.user || json).canMaintainProperty);
      } catch {
        setCanMaintainProperty(false);
      }
    };
    void Promise.all([load(), loadUser()]);
  }, [load]);

  // ?focus=recordId → 自動開啟維護表單
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus) return;
    (async () => {
      const res = await fetch(
        `/api/property-maintenance/records/${encodeURIComponent(focus)}`,
        { credentials: 'include' }
      );
      const json = await res.json();
      if (res.ok) openEdit(json.data);
      else showToast('error', json.error || '找不到紀錄');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (r: Rec) => {
    setEditing(r);
    setForm({
      status: '已完成',
      inventoryResult: r.inventoryResult || '帳物相符',
      assetCondition: r.assetCondition || '良好',
      maintenanceItem: r.maintenanceItem || '清潔',
      otherNote: r.otherNote || '',
      note: r.note || '',
      photoPath: r.photoPath || '',
      signaturePath: r.signaturePath || '',
    });
  };

  const uploadFile = async (file: File, field: 'photo' | 'signature') => {
    if (!editing || !canMaintainProperty) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('field', field);
    try {
      const res = await fetchWithCSRF(
        `/api/property-maintenance/records/${encodeURIComponent(editing.recordId)}/attachment`,
        { method: 'POST', body: fd }
      );
      const json = await res.json();
      if (res.ok) {
        setForm((f) => ({
          ...f,
          [field === 'photo' ? 'photoPath' : 'signaturePath']: json.data.path,
        }));
        showToast('success', '已上傳');
      } else {
        showToast('error', json.error || '上傳失敗');
      }
    } catch {
      showToast('error', '上傳失敗');
    }
  };

  const submit = async () => {
    if (!editing || !canMaintainProperty) return;
    setSaving(true);
    try {
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/records/${encodeURIComponent(editing.recordId)}`,
        { method: 'PUT', body: form }
      );
      const json = await res.json();
      if (res.ok) {
        showToast('success', json.message || '已提交，待主管稽核');
        setEditing(null);
        load();
      } else {
        showToast('error', json.error || '提交失敗');
      }
    } catch {
      showToast('error', '提交失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">維護紀錄</h1>
        {!canMaintainProperty && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
            一般員工為唯讀權限，可查詢與檢視財產維護紀錄；提交維護、上傳附件與修改申請限維護人員使用。
          </div>
        )}

        <div className="flex gap-2 mb-4">
          {[
            ...(canMaintainProperty ? [{ k: 'mine', t: '我的紀錄' }] : []),
            { k: 'pending', t: '待執行' },
            { k: 'done', t: '已完成' },
          ].map((x) => (
            <button
              key={x.k}
              onClick={() => setTab(x.k as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                tab === x.k ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              {x.t}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          {loading ? (
            <div className="p-8 text-center text-gray-600">載入中…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-600">沒有紀錄</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const ds = (r.displayStatus || (r.status as DisplayStatus)) as DisplayStatus;
                const s = STATUS_UI[ds] ?? STATUS_UI.PENDING;
                return (
                  <li key={r.recordId} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {r.assetCode}　{r.asset?.name}
                      </p>
                      <p className="text-xs text-gray-600">
                        應維護 {fmtDate(r.dueDate)}・完成 {fmtDate(r.completedDate)}・稽核{' '}
                        {r.auditStatus || '—'}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${s.badge}`}>{s.label}</span>
                    <button
                      onClick={() => openEdit(r)}
                      className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {canMaintainProperty && r.status === 'PENDING' ? '維護' : '檢視'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="font-bold text-gray-900">
                維護紀錄　{editing.assetCode} {editing.asset?.name}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="關閉維護紀錄視窗" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {editing.rejectReason && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  主管退回補正：{editing.rejectReason}
                </div>
              )}
              {editing.status !== 'PENDING' || !canMaintainProperty ? (
                <div className="text-sm text-gray-700 space-y-1">
                  <p>維護狀態：{editing.status}</p>
                  <p>盤點結果：{editing.inventoryResult || '—'}</p>
                  <p>財產狀態：{editing.assetCondition || '—'}</p>
                  <p>維護項目：{editing.maintenanceItem || '—'}</p>
                  <p>說明：{editing.otherNote || '—'}</p>
                  <p>完成日期：{fmtDate(editing.completedDate)}</p>
                  <p>稽核狀態：{editing.auditStatus || '—'}</p>
                  {editing.status === 'PENDING' && !canMaintainProperty && (
                    <p className="text-amber-700">此紀錄尚待維護；您目前為唯讀權限。</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="維護狀態" value={form.status} opts={STATUS_OPTS}
                      onChange={(v) => setForm({ ...form, status: v })} />
                    <Select label="盤點結果" value={form.inventoryResult} opts={INVENTORY_OPTS}
                      onChange={(v) => setForm({ ...form, inventoryResult: v })} />
                    <Select label="財產狀態" value={form.assetCondition} opts={CONDITION_OPTS}
                      onChange={(v) => setForm({ ...form, assetCondition: v })} />
                    <Select label="維護項目" value={form.maintenanceItem} opts={ITEM_OPTS}
                      onChange={(v) => setForm({ ...form, maintenanceItem: v })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      異常／處理說明
                    </label>
                    <textarea
                      value={form.otherNote}
                      onChange={(e) => setForm({ ...form, otherNote: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FileBtn label="維護照片" done={!!form.photoPath}
                      onPick={(f) => uploadFile(f, 'photo')} />
                    <FileBtn label="維護人簽章" done={!!form.signaturePath}
                      onPick={(f) => uploadFile(f, 'signature')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                    <input
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    />
                  </div>
                  <button
                    onClick={submit}
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    提交（待主管稽核）
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}

function Select({
  label,
  value,
  opts,
  onChange,
}: {
  label: string;
  value: string;
  opts: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function FileBtn({
  label,
  done,
  onPick,
}: {
  label: string;
  done: boolean;
  onPick: (f: File) => void;
}) {
  return (
    <label
      className={`flex items-center justify-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm ${
        done ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 text-gray-600'
      }`}
    >
      <Upload className="w-4 h-4" />
      {done ? `${label} ✓` : label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  );
}
