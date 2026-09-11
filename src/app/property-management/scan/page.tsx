'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Search, X } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { STATUS_UI, fmtDate, taiwanDateInputValue, type DisplayStatus } from '@/lib/property-status-ui';
import fetchWithCSRF, { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  ABNORMAL_CONDITION_OPTIONS,
  CONDITION_ASSESSMENT_STATUS,
  DEFAULT_NORMAL_CONDITION_ITEMS,
  NORMAL_CONDITION_OPTIONS,
  parseJsonStringArray,
  type ConditionAssessmentStatus,
} from '@/lib/property-condition-assessment';
import {
  PROPERTY_ASSESSMENT_MAX_FILES,
  PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE,
} from '@/lib/property-maintenance-attachment-constants';
import {
  getPropertyAssessmentClientFileError,
  PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE,
} from '@/lib/property-assessment-file-validation';

interface LookupResult {
  asset: {
    id: number;
    siteId: number;
    assetCode: string;
    name: string;
    photoPath: string | null;
    location: string | null;
    managerName: string | null;
    maintenanceFrequency: string | null;
    acquiredDate: string | null;
    nextMaintenanceDate: string | null;
    siteName: string;
  };
  needsMaintenance: boolean;
  canMaintain: boolean;
  displayStatus: DisplayStatus;
  openTask: { recordId: string; dueDate: string | null; status: string } | null;
  lastCompletedDate: string | null;
}

interface AssessmentAttachment {
  id: number;
  originalName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

interface MaintenanceRecordDetail {
  recordId: string;
  status: string;
  conditionAssessmentStatus: ConditionAssessmentStatus | null;
  normalConditionItems: string | null;
  abnormalConditionItems: string | null;
  abnormalDescription: string | null;
  note: string | null;
  attachments: AssessmentAttachment[];
}

interface AssetEditForm {
  name: string;
  location: string;
  managerName: string;
  maintenanceFrequency: string;
  acquiredDate: string;
  nextMaintenanceDate: string;
}

interface AssessmentForm {
  status: ConditionAssessmentStatus;
  normalConditionItems: string[];
  abnormalConditionItems: string[];
  abnormalDescription: string;
  note: string;
}

const FREQUENCY_OPTIONS = ['每週一次', '兩週一次', '每月一次', '每季一次', '每半年一次', '每年一次'];
const ASSESSMENT_DIRECT_UPLOAD_LIMIT_BYTES = 700 * 1024;
const ASSESSMENT_UPLOAD_TIMEOUT_MS = 180_000;
const SCAN_FAILURE_HINT_INTERVAL_MS = 5000;
const SCANNER_VIDEO_READY_TIMEOUT_MS = 4000;
const SCANNER_RETRY_DELAY_MS = 300;
const SCANNER_ZOOM_LEVELS = [2, 2.5, 3] as const;
const DEFAULT_SCANNER_ZOOM_PRESET = 'optical-2';

type ScannerMode = 'code128' | 'qr';

interface ScannerConfig {
  fps: number;
  disableFlip: boolean;
  experimentalFeatures: { useBarCodeDetectorIfSupported: boolean };
  qrbox: (vw: number, vh: number) => { width: number; height: number };
  aspectRatio: number;
}

type CameraStartSelector =
  | string
  | { facingMode: 'environment' | 'user' | { exact: 'environment' | 'user' } }
  | { deviceId: string | { exact: string } };

type ScannerZoomPreset = 'none' | 'optical-2' | 'optical-2.5' | 'optical-3' | 'digital-2' | 'digital-2.5' | 'digital-3';

type ZoomMode = 'optical' | 'digital';

interface ParsedZoomPreset {
  mode: ZoomMode;
  level: number;
}

interface ZoomRange {
  min: number;
  max: number;
  step?: number;
}

const SCANNER_MODE_OPTIONS: Array<{ value: ScannerMode; label: string; description: string }> = [
  { value: 'code128', label: 'Code 128 條碼', description: '預設模式，優先掃描現場財產條碼' },
  { value: 'qr', label: 'QR Code', description: '適合掃描方形 QR Code 標籤或連結' },
];

interface Html5QrcodeInstance {
  isScanning?: boolean;
  start: (
    cameraConfigOrDeviceId: CameraStartSelector,
    configuration: ScannerConfig,
    qrCodeSuccessCallback: (decodedText: string) => void | Promise<void>,
    qrCodeErrorCallback?: () => void
  ) => Promise<void | null>;
  stop: () => Promise<void>;
  clear: () => void | Promise<void>;
}

interface Html5QrcodeConstructor {
  getCameras: () => Promise<Array<{ id: string; label: string }>>;
}

type CameraConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: string;
  focusMode?: string;
  torch?: boolean;
  zoom?: number;
};

function toMediaTrackConstraintSets(constraints: CameraConstraintSet[]): MediaTrackConstraintSet[] {
  return constraints as unknown as MediaTrackConstraintSet[];
}

function createDefaultAssessmentForm(): AssessmentForm {
  return {
    status: CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY,
    normalConditionItems: DEFAULT_NORMAL_CONDITION_ITEMS,
    abnormalConditionItems: [],
    abnormalDescription: '',
    note: '',
  };
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

async function readApiPayload(response: Response): Promise<{ error?: string; data?: unknown }> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => '');
  return {
    error: text.trim()
      ? `伺服器回應格式異常（HTTP ${response.status}）`
      : `伺服器無回應內容（HTTP ${response.status}）`,
  };
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '附件上傳逾時，請確認手機網路穩定後重新上傳';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '附件上傳失敗，請重新上傳';
}

function getDefaultZoomPreset(mode: ScannerMode): ScannerZoomPreset {
  return mode === 'qr' ? 'none' : DEFAULT_SCANNER_ZOOM_PRESET;
}

function getScannerStartHint(mode: ScannerMode) {
  return mode === 'qr'
    ? '正在啟用相機（QR Code 模式），若瀏覽器詢問權限請點選允許。'
    : '正在啟用相機（Code 128 條碼模式），若瀏覽器詢問權限請點選允許。';
}

function getScannerActiveHint(mode: ScannerMode) {
  return mode === 'qr'
    ? '掃描中：請讓 QR Code 完整落在方框內並保持正面；若太小可先靠近鏡頭再微調距離。'
    : '掃描中：請將條碼橫向置中並填滿框線；條碼太小時可切換下方變焦模式。';
}

function getScannerFailureHint(mode: ScannerMode) {
  return mode === 'qr'
    ? '請讓 QR Code 完整落在方框內、保持正面並避免反光；若太近或太遠都可能影響辨識。'
    : '請讓條碼橫向填滿掃描框、保持 15–25 公分距離；條碼太小時可切換 2x、2.5x 或 3x 變焦。';
}

function getScannerAdvice(mode: ScannerMode) {
  return mode === 'qr'
    ? 'QR Code 建議完整置中、保持方形不裁切；若標籤反光或太暗，請開啟補光、稍微後退或改用手動輸入。'
    : '條碼建議保持水平並填滿掃描框，鏡頭距離條碼約 15–25 公分；若反光或太暗，請開啟補光或改用手動輸入。';
}

function normalizeScannedCode(decoded: string) {
  const trimmed = decoded.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const codeFromQuery = url.searchParams.get('code') || url.searchParams.get('assetCode');
    if (codeFromQuery?.trim()) {
      return codeFromQuery.trim();
    }

    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
    if (lastSegment?.trim()) {
      return lastSegment.trim();
    }
  } catch {
    // 非 URL 內容直接使用原始掃描值
  }

  return trimmed;
}

function buildScannerConfig(mode: ScannerMode) {
  if (mode === 'qr') {
    return {
      fps: 12,
      disableFlip: true,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
      },
      qrbox: (vw: number, vh: number) => {
        const size = Math.floor(Math.max(180, Math.min(vw * 0.72, vh * 0.72, 300)));
        return { width: size, height: size };
      },
      aspectRatio: 1,
    } satisfies ScannerConfig;
  }

  return {
    fps: 15,
    disableFlip: true,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true,
    },
    qrbox: (vw: number, vh: number) => ({
      width: Math.floor(Math.min(vw * 0.94, 520)),
      height: Math.floor(Math.max(96, Math.min(vh * 0.32, 170))),
    }),
    aspectRatio: 16 / 9,
  } satisfies ScannerConfig;
}

function buildCameraStartSelectors(): CameraStartSelector[] {
  return [
    { facingMode: 'environment' },
    { facingMode: { exact: 'environment' } },
    { facingMode: 'user' },
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseZoomPreset(preset: ScannerZoomPreset): ParsedZoomPreset | null {
  if (preset === 'none') return null;
  const [mode, rawLevel] = preset.split('-') as [ZoomMode, string];
  const level = Number(rawLevel);
  return Number.isFinite(level) ? { mode, level } : null;
}

function formatZoomLevel(level: number) {
  return Number.isInteger(level) ? `${level}x` : `${level.toFixed(1)}x`;
}

function formatZoomPresetLabel(preset: ScannerZoomPreset) {
  const parsed = parseZoomPreset(preset);
  if (!parsed) return '原始 1x';
  return `${parsed.mode === 'optical' ? '光學' : '數位'} ${formatZoomLevel(parsed.level)}`;
}

function normalizeZoomRange(range?: { min?: number; max?: number; step?: number }): ZoomRange | null {
  if (!range?.max || range.max <= 1) return null;
  return {
    min: range.min ?? 1,
    max: range.max,
    step: range.step,
  };
}

function getScannerVideoElement() {
  return document.querySelector<HTMLVideoElement>('#qr-reader video');
}

function applyDigitalZoomToVideo(level: number) {
  const video = getScannerVideoElement();
  if (!video) return;
  video.style.transform = level > 1 ? `scale(${level})` : '';
  video.style.transformOrigin = 'center center';
}

async function clearScanner(scanner: Html5QrcodeInstance | null) {
  if (!scanner) return;
  try {
    await Promise.resolve(scanner.clear());
  } catch (error) {
    console.warn('掃描器畫面清理失敗:', error);
  }
}

function releaseQrReaderVideoStream() {
  const video = getScannerVideoElement();
  const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
  stream?.getTracks().forEach((track) => track.stop());
  if (video) {
    video.style.transform = '';
    video.srcObject = null;
  }
}

async function stopScannerInstance(scanner: Html5QrcodeInstance | null) {
  if (!scanner) return;
  try {
    await scanner.stop();
  } catch (error) {
    console.warn('掃描器停止失敗:', error);
  } finally {
    await clearScanner(scanner);
  }
}

function hasCameraApiSupport() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function hasSecureCameraContext() {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function isMediaRemovedAbort(error: unknown) {
  if (!(error instanceof PromiseRejectionEvent)) return false;
  return isMediaRemovedAbortLike(error.reason);
}

async function getPreferredCameraSelector(
  Html5Qrcode: Html5QrcodeConstructor
): Promise<CameraStartSelector> {
  try {
    const cameras = await Html5Qrcode.getCameras();
    const rearCamera = cameras.find((camera) => /back|rear|environment|後|背|環境/i.test(camera.label));
    const cameraId = rearCamera?.id ?? cameras[0]?.id;
    if (cameraId) return cameraId;
  } catch (error) {
    console.debug('相機裝置清單讀取失敗，改用環境鏡頭:', error);
  }
  return { facingMode: 'environment' };
}

function styleScannerVideo(video: HTMLVideoElement) {
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.minHeight = '12rem';
  video.style.objectFit = 'cover';
  video.style.borderRadius = '0.5rem';
  video.style.display = 'block';
  video.style.transformOrigin = 'center center';
}

async function waitForScannerVideo() {
  const expiresAt = Date.now() + SCANNER_VIDEO_READY_TIMEOUT_MS;
  while (Date.now() < expiresAt) {
    const video = getScannerVideoElement();
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    const track = stream?.getVideoTracks()[0];
    if (video && track?.readyState === 'live') {
      styleScannerVideo(video);
      await video.play().catch((error) => {
        if (!isMediaRemovedAbortLike(error)) {
          console.warn('相機影像播放等待失敗:', error);
        }
      });
      if (
        video.readyState >= HTMLMediaElement.HAVE_METADATA ||
        video.videoWidth > 0 ||
        !video.paused
      ) {
        return track;
      }
    }
    await sleep(100);
  }
  return null;
}

function isMediaRemovedAbortLike(error: unknown) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return name === 'AbortError' && message.includes('media was removed from the document');
}

async function cleanupFailedScannerStart(scanner: Html5QrcodeInstance) {
  if (scanner.isScanning) {
    await stopScannerInstance(scanner);
  } else {
    releaseQrReaderVideoStream();
    await clearScanner(scanner);
  }
  await sleep(SCANNER_RETRY_DELAY_MS);
}

export default function ScanPage() {
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [canMaintainProperty, setCanMaintainProperty] = useState(false);
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetForm, setAssetForm] = useState<AssetEditForm>({
    name: '',
    location: '',
    managerName: '',
    maintenanceFrequency: '',
    acquiredDate: '',
    nextMaintenanceDate: '',
  });
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentUploading, setAssessmentUploading] = useState(false);
  const [assessmentUploadMessage, setAssessmentUploadMessage] = useState('');
  const [assessmentRecord, setAssessmentRecord] = useState<MaintenanceRecordDetail | null>(null);
  const [assessmentForm, setAssessmentForm] = useState<AssessmentForm>(createDefaultAssessmentForm);
  const [scanHint, setScanHint] = useState('');
  const [scannerMode, setScannerMode] = useState<ScannerMode>('code128');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomPreset, setZoomPreset] = useState<ScannerZoomPreset>(DEFAULT_SCANNER_ZOOM_PRESET);
  const [opticalZoomRange, setOpticalZoomRange] = useState<ZoomRange | null>(null);
  const [opticalZoomSupported, setOpticalZoomSupported] = useState<boolean | null>(null);
  const [appliedZoomLabel, setAppliedZoomLabel] = useState(formatZoomPresetLabel(DEFAULT_SCANNER_ZOOM_PRESET));
  const [scannerStarting, setScannerStarting] = useState(false);
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const scannerModulePromiseRef = useRef<Promise<typeof import('html5-qrcode')> | null>(null);
  const scannerStartingRef = useRef(false);
  const scannerModeRef = useRef<ScannerMode>('code128');
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const lastScanFailureHintAtRef = useRef(0);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const loadScannerModule = useCallback(() => {
    scannerModulePromiseRef.current ??= import('html5-qrcode');
    return scannerModulePromiseRef.current;
  }, []);

  const lookup = async (code: string) => {
    setError('');
    setResult(null);
    if (!code.trim()) return null;
    try {
      const res = await fetch(
        `/api/property-maintenance/assets/lookup?code=${encodeURIComponent(code.trim())}`,
        { credentials: 'include' }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '查無資料');
        return null;
      }
      setResult(json.data);
      return json.data as LookupResult;
    } catch {
      setError('查詢失敗');
      return null;
    }
  };

  const stopScanner = useCallback(async () => {
    scannerStartingRef.current = false;
    setScannerStarting(false);
    await stopScannerInstance(scannerRef.current);
    scannerRef.current = null;
    videoTrackRef.current = null;
    applyDigitalZoomToVideo(1);
    setScanning(false);
    setTorchSupported(false);
    setTorchOn(false);
    setOpticalZoomRange(null);
    setOpticalZoomSupported(null);
    setAppliedZoomLabel(formatZoomPresetLabel(getDefaultZoomPreset(scannerModeRef.current)));
    setScanHint('');
  }, []);

  const applyZoomPreset = async (
    preset: ScannerZoomPreset,
    options: { showUnsupportedMessage?: boolean } = {}
  ) => {
    const track = videoTrackRef.current;
    const parsed = parseZoomPreset(preset);

    if (!parsed) {
      applyDigitalZoomToVideo(1);
      const capabilities = track?.getCapabilities?.() as ({ zoom?: { min?: number } } | undefined);
      const minZoom = capabilities?.zoom?.min ?? 1;
      if (track) {
        await track.applyConstraints({ advanced: toMediaTrackConstraintSets([{ zoom: minZoom }]) }).catch(() => undefined);
      }
      setAppliedZoomLabel('原始 1x');
      return;
    }

    if (parsed.mode === 'digital') {
      applyDigitalZoomToVideo(parsed.level);
      const capabilities = track?.getCapabilities?.() as ({ zoom?: { min?: number } } | undefined);
      const minZoom = capabilities?.zoom?.min ?? 1;
      if (track) {
        await track.applyConstraints({ advanced: toMediaTrackConstraintSets([{ zoom: minZoom }]) }).catch(() => undefined);
      }
      setAppliedZoomLabel(`數位 ${formatZoomLevel(parsed.level)}`);
      return;
    }

    if (!track) return;

    const capabilities = track.getCapabilities?.() as ({ zoom?: { min?: number; max?: number; step?: number } } | undefined);
    const zoomRange = normalizeZoomRange(capabilities?.zoom);
    if (!zoomRange) {
      applyDigitalZoomToVideo(1);
      setOpticalZoomSupported(false);
      setOpticalZoomRange(null);
      setAppliedZoomLabel('原始 1x');
      if (options.showUnsupportedMessage) {
        setError('此裝置或瀏覽器不支援光學變焦，可改用數位變焦或手動輸入');
      }
      return;
    }

    const targetZoom = Math.min(zoomRange.max, Math.max(zoomRange.min, parsed.level));
    try {
      applyDigitalZoomToVideo(1);
      await track.applyConstraints({ advanced: toMediaTrackConstraintSets([{ zoom: targetZoom }]) });
      setOpticalZoomSupported(true);
      setOpticalZoomRange(zoomRange);
      setAppliedZoomLabel(`光學 ${formatZoomLevel(targetZoom)}`);
      if (targetZoom < parsed.level && options.showUnsupportedMessage) {
        setError(`此相機最高支援光學 ${formatZoomLevel(zoomRange.max)}，已套用可用的最大變焦`);
      }
    } catch {
      applyDigitalZoomToVideo(1);
      setOpticalZoomSupported(false);
      setOpticalZoomRange(null);
      setAppliedZoomLabel('原始 1x');
      if (options.showUnsupportedMessage) {
        setError('此裝置無法套用光學變焦，可改用數位變焦或手動輸入');
      }
    }
  };

  const applyCameraTrackOptimizations = async (targetZoomPreset: ScannerZoomPreset) => {
    const video = getScannerVideoElement();
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;

    videoTrackRef.current = track;
    const capabilities = track.getCapabilities?.() as (
      MediaTrackCapabilities & {
        focusMode?: string[];
        torch?: boolean;
        zoom?: { min?: number; max?: number; step?: number };
      }
    ) | undefined;

    const zoomRange = normalizeZoomRange(capabilities?.zoom);
    setOpticalZoomSupported(Boolean(zoomRange));
    setOpticalZoomRange(zoomRange);

    const advanced: CameraConstraintSet[] = [];
    if (capabilities?.focusMode?.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }

    setTorchSupported(Boolean(capabilities?.torch));
    if (advanced.length > 0) {
      await track.applyConstraints({ advanced: toMediaTrackConstraintSets(advanced) }).catch(() => undefined);
    }
    await applyZoomPreset(targetZoomPreset);
  };

  const changeZoomPreset = async (nextPreset: ScannerZoomPreset) => {
    setZoomPreset(nextPreset);
    setError('');
    if (!scanning) {
      setAppliedZoomLabel(formatZoomPresetLabel(nextPreset));
      return;
    }
    await applyZoomPreset(nextPreset, { showUnsupportedMessage: true });
  };

  const isZoomPresetDisabled = (preset: ScannerZoomPreset) => {
    const parsed = parseZoomPreset(preset);
    if (!parsed || parsed.mode === 'digital' || !scanning) return false;
    if (opticalZoomSupported === false) return true;
    return opticalZoomRange ? parsed.level > opticalZoomRange.max : false;
  };

  const toggleTorch = async () => {
    const track = videoTrackRef.current;
    if (!track || !torchSupported) return;
    const nextTorchState = !torchOn;
    try {
      await track.applyConstraints({
        advanced: toMediaTrackConstraintSets([{ torch: nextTorchState }]),
      });
      setTorchOn(nextTorchState);
    } catch {
      setTorchSupported(false);
      setError('此裝置無法切換補光燈，請移到光線較亮處或改用手動輸入');
    }
  };

  const changeScannerMode = async (nextMode: ScannerMode) => {
    if (scannerMode === nextMode && !scanning) return;

    const nextZoomPreset = getDefaultZoomPreset(nextMode);
    scannerModeRef.current = nextMode;
    setScannerMode(nextMode);
    setZoomPreset(nextZoomPreset);
    setAppliedZoomLabel(formatZoomPresetLabel(nextZoomPreset));
    setError('');
    setScanHint('');

    if (scanning || scannerRef.current) {
      await stopScanner();
      await startScanner(nextMode, nextZoomPreset);
    }
  };

  const startScanner = async (
    modeOverride?: ScannerMode,
    zoomPresetOverride?: ScannerZoomPreset
  ) => {
    if (scannerStartingRef.current || scannerRef.current) return;
    const activeMode = modeOverride ?? scannerMode;
    const activeZoomPreset = zoomPresetOverride ?? zoomPreset;
    scannerStartingRef.current = true;
    setScannerStarting(true);
    setError('');
    setScanHint(getScannerStartHint(activeMode));
    setTorchSupported(false);
    setTorchOn(false);
    if (!hasSecureCameraContext()) {
      scannerStartingRef.current = false;
      setScannerStarting(false);
      setScanHint('');
      setError('相機掃描需使用 HTTPS 安全連線，請改用正式網址或手動輸入');
      return;
    }
    if (!hasCameraApiSupport()) {
      scannerStartingRef.current = false;
      setScannerStarting(false);
      setScanHint('');
      setError('此瀏覽器不支援相機掃描，請改用 Safari/Chrome 或手動輸入');
      return;
    }
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadScannerModule();
      const el = document.getElementById('qr-reader');
      if (!el) throw new Error('SCANNER_ELEMENT_NOT_FOUND');

      const createScanner = () => new Html5Qrcode('qr-reader', {
        formatsToSupport: [
          ...(activeMode === 'qr'
            ? [
              Html5QrcodeSupportedFormats.QR_CODE,
            ]
            : [
              Html5QrcodeSupportedFormats.CODE_128, // 預設優先掃描現場財產條碼
              Html5QrcodeSupportedFormats.CODE_39, // 容錯：少數舊標籤可能為 Code 39
            ]),
        ],
        verbose: false,
      });

      const onScanSuccess = async (decoded: string) => {
        await stopScanner();
        const code = normalizeScannedCode(decoded);
        setManual(code);
        lookup(code);
      };
      const onScanFailure = () => {
        const now = Date.now();
        if (now - lastScanFailureHintAtRef.current > SCAN_FAILURE_HINT_INTERVAL_MS) {
          lastScanFailureHintAtRef.current = now;
          setScanHint(getScannerFailureHint(activeMode));
        }
      };

      const startAttempt = async (selector: CameraStartSelector) => {
        const scanner = createScanner();
        try {
          await scanner.start(selector, buildScannerConfig(activeMode), onScanSuccess, onScanFailure);
          scannerRef.current = scanner;
          const track = await waitForScannerVideo();
          if (!track) throw new Error('CAMERA_VIDEO_NOT_READY');
          videoTrackRef.current = track;
          return true;
        } catch (error) {
          if (scannerRef.current === scanner) scannerRef.current = null;
          await cleanupFailedScannerStart(scanner);
          throw error;
        }
      };

      let started = false;
      let lastStartError: unknown = null;
      for (const selector of buildCameraStartSelectors()) {
        try {
          started = await startAttempt(selector);
          break;
        } catch (error) {
          lastStartError = error;
        }
      }

      if (!started) {
        try {
          started = await startAttempt(await getPreferredCameraSelector(Html5Qrcode));
        } catch (error) {
          lastStartError = error;
        }
      }

      if (!started) throw lastStartError ?? new Error('CAMERA_START_FAILED');

      scannerStartingRef.current = false;
      setScannerStarting(false);
      setScanning(true);
      await applyCameraTrackOptimizations(activeZoomPreset);
      setScanHint(getScannerActiveHint(activeMode));
    } catch {
      scannerStartingRef.current = false;
      setScannerStarting(false);
      setScanning(false);
      setTorchSupported(false);
      setTorchOn(false);
      setScanHint('');
      releaseQrReaderVideoStream();
      if (scannerRef.current) {
        await clearScanner(scannerRef.current);
        scannerRef.current = null;
      }
      setError('無法啟用相機，請允許相機權限或改用手動輸入');
    }
  };

  useEffect(() => {
    const suppressKnownCameraAbort = (event: PromiseRejectionEvent) => {
      // html5-qrcode 2.3.8 does not catch the internal video.play() promise.
      if (isMediaRemovedAbort(event)) event.preventDefault();
    };
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (res.ok) setCanMaintainProperty(!!(json.user || json).canMaintainProperty);
      } catch {
        setCanMaintainProperty(false);
      }
    };
    window.addEventListener('unhandledrejection', suppressKnownCameraAbort);
    void loadUser();
    void loadScannerModule();
    return () => {
      window.removeEventListener('unhandledrejection', suppressKnownCameraAbort);
      void stopScanner();
    };
  }, [loadScannerModule, stopScanner]);

  const s = result ? STATUS_UI[result.displayStatus] : null;
  const canMaintainCurrentAsset = !!result?.canMaintain;

  const openAssetEditor = () => {
    if (!result || !canMaintainCurrentAsset) return;
    setAssetForm({
      name: result.asset.name,
      location: result.asset.location || '',
      managerName: result.asset.managerName || '',
      maintenanceFrequency: result.asset.maintenanceFrequency || '每月一次',
      acquiredDate: taiwanDateInputValue(result.asset.acquiredDate),
      nextMaintenanceDate: taiwanDateInputValue(result.asset.nextMaintenanceDate),
    });
    setAssetEditorOpen(true);
  };

  const saveAsset = async () => {
    if (!result || !canMaintainCurrentAsset) return;
    setAssetSaving(true);
    try {
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/assets/${result.asset.id}`,
        { method: 'PUT', body: assetForm }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '財產資料儲存失敗');
        return;
      }
      setResult((prev) => prev
        ? {
            ...prev,
            asset: {
              ...prev.asset,
              name: json.data.name,
              location: json.data.location,
              managerName: json.data.managerName,
              maintenanceFrequency: json.data.maintenanceFrequency,
              acquiredDate: json.data.acquiredDate,
              nextMaintenanceDate: json.data.nextMaintenanceDate,
            },
          }
        : prev);
      setAssetEditorOpen(false);
      setError('');
    } catch {
      setError('財產資料儲存失敗');
    } finally {
      setAssetSaving(false);
    }
  };

  const loadAssessmentRecord = async (recordId: string) => {
    const res = await fetch(
      `/api/property-maintenance/records/${encodeURIComponent(recordId)}`,
      { credentials: 'include' }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '維護紀錄載入失敗');
    return json.data as MaintenanceRecordDetail;
  };

  const openAssessmentEditor = async (
    recordId = result?.openTask?.recordId,
    lookupResult = result
  ) => {
    if (!recordId || !lookupResult?.canMaintain) return;
    setAssessmentLoading(true);
    setError('');
    try {
      const record = await loadAssessmentRecord(recordId);
      setAssessmentRecord(record);
      setAssessmentForm({
        status: record.conditionAssessmentStatus || CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY,
        normalConditionItems: record.conditionAssessmentStatus === CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY
          ? parseJsonStringArray(record.normalConditionItems)
          : DEFAULT_NORMAL_CONDITION_ITEMS,
        abnormalConditionItems: parseJsonStringArray(record.abnormalConditionItems),
        abnormalDescription: record.abnormalDescription || '',
        note: record.note || '',
      });
      setAssessmentOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '維護紀錄載入失敗');
    } finally {
      setAssessmentLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code')?.trim();
    const recordId = params.get('recordId')?.trim();
    const shouldOpenAssessment = params.get('assessment') === '1';
    if (!code) return;

    let cancelled = false;
    (async () => {
      setManual(code);
      const lookupResult = await lookup(code);
      if (cancelled || !lookupResult || !shouldOpenAssessment) return;

      const targetRecordId = recordId || lookupResult.openTask?.recordId;
      if (!targetRecordId) {
        setError('此財產目前沒有待維護任務');
        return;
      }
      if (!lookupResult.canMaintain) {
        setError('您沒有此財產的維護權限');
        return;
      }
      await openAssessmentEditor(targetRecordId, lookupResult);
    })();

    return () => {
      cancelled = true;
    };
    // URL query should only be consumed on initial page entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAssessmentItem = (field: 'normalConditionItems' | 'abnormalConditionItems', item: string) => {
    setAssessmentForm((prev) => {
      const currentItems = prev[field];
      const nextItems = currentItems.includes(item)
        ? currentItems.filter((value) => value !== item)
        : [...currentItems, item];
      return { ...prev, [field]: nextItems };
    });
  };

  const saveAssessment = async () => {
    if (!assessmentRecord || !canMaintainCurrentAsset) return;
    setAssessmentSaving(true);
    try {
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/records/${encodeURIComponent(assessmentRecord.recordId)}`,
        {
          method: 'PUT',
          body: {
            conditionAssessment: {
              status: assessmentForm.status,
              normalConditionItems: assessmentForm.normalConditionItems,
              abnormalConditionItems: assessmentForm.abnormalConditionItems,
              abnormalDescription: assessmentForm.abnormalDescription,
            },
            note: assessmentForm.note,
          },
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '狀態評量儲存失敗');
        return;
      }
      setAssessmentOpen(false);
      setAssessmentRecord(null);
      setError('');
      if (manual) await lookup(manual);
    } catch {
      setError('狀態評量儲存失敗');
    } finally {
      setAssessmentSaving(false);
    }
  };

  const clearManualInput = () => {
    setManual('');
    manualInputRef.current?.focus();
  };

  const uploadAssessmentFormData = async (formData: FormData, signal: AbortSignal): Promise<{ error?: string; data?: unknown }> => {
    if (!assessmentRecord || !canMaintainCurrentAsset) {
      throw new Error('目前無法上傳附件，請重新查詢財產後再試');
    }
    const res = await fetchWithCSRF(
      `/api/property-maintenance/records/${encodeURIComponent(assessmentRecord.recordId)}/attachments`,
      { method: 'POST', body: formData, signal }
    );
    const json = await readApiPayload(res);
    if (!res.ok) {
      throw new Error(json.error || '附件上傳失敗');
    }

    return json;
  };

  const uploadAssessmentFile = async (
    file: File,
    signal: AbortSignal,
    onProgress: (message: string) => void
  ): Promise<AssessmentAttachment> => {
    if (!assessmentRecord || !canMaintainCurrentAsset) {
      throw new Error('目前無法上傳附件，請重新查詢財產後再試');
    }
    if (assessmentRecord.attachments.length >= PROPERTY_ASSESSMENT_MAX_FILES) {
      throw new Error(`評量附件最多 ${PROPERTY_ASSESSMENT_MAX_FILES} 個`);
    }

    let json: { error?: string; data?: unknown } | undefined;
    if (file.size > ASSESSMENT_DIRECT_UPLOAD_LIMIT_BYTES) {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE);
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE;
        const chunk = file.slice(start, Math.min(file.size, start + PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE), file.type || 'application/octet-stream');
        const fd = new FormData();
        fd.append('file', chunk, file.name);
        fd.append('uploadId', uploadId);
        fd.append('chunkIndex', String(chunkIndex));
        fd.append('chunkTotal', String(totalChunks));
        fd.append('fileName', file.name);
        fd.append('fileSize', String(file.size));
        onProgress(`正在上傳：${file.name}（${chunkIndex + 1}/${totalChunks}）`);
        json = await uploadAssessmentFormData(fd, signal);
      }
    } else {
      const fd = new FormData();
      fd.append('file', file);
      json = await uploadAssessmentFormData(fd, signal);
    }

    const uploaded = json?.data as AssessmentAttachment | undefined;
    if (!uploaded?.id) {
      throw new Error('附件上傳後未取得檔案資訊，請重新整理後確認');
    }

    setAssessmentRecord((prev) => prev
      ? { ...prev, attachments: [...prev.attachments, uploaded] }
      : prev);
    return uploaded;
  };

  const uploadAssessmentFiles = async (files: File[]) => {
    if (!assessmentRecord || !canMaintainCurrentAsset || files.length === 0) return;

    const availableSlots = PROPERTY_ASSESSMENT_MAX_FILES - assessmentRecord.attachments.length;
    if (availableSlots <= 0) {
      setError(`評量附件最多 ${PROPERTY_ASSESSMENT_MAX_FILES} 個`);
      return;
    }

    const filesToUpload = files.slice(0, availableSlots);
    const hasSkippedFiles = files.length > filesToUpload.length;
    const validationError = filesToUpload
      .map((file) => getPropertyAssessmentClientFileError(file))
      .find((message): message is string => Boolean(message));
    if (validationError) {
      setError(validationError);
      return;
    }

    setAssessmentUploading(true);
    setAssessmentUploadMessage('');
    setError('');
    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        const controller = new AbortController();
        let timeoutId: number | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            controller.abort();
            reject(new DOMException('Upload timeout', 'AbortError'));
          }, ASSESSMENT_UPLOAD_TIMEOUT_MS);
        });
        setAssessmentUploadMessage(`正在上傳 ${index + 1}/${filesToUpload.length}：${file.name}`);
        try {
          await Promise.race([
            uploadAssessmentFile(file, controller.signal, (message) => {
              setAssessmentUploadMessage(`${index + 1}/${filesToUpload.length} ${message}`);
            }),
            timeoutPromise,
          ]);
        } finally {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
        }
      }
      if (hasSkippedFiles) {
        setError(`評量附件最多 ${PROPERTY_ASSESSMENT_MAX_FILES} 個，已上傳前 ${filesToUpload.length} 個檔案`);
      }
    } catch (uploadError) {
      setError(getUploadErrorMessage(uploadError));
    } finally {
      setAssessmentUploading(false);
      setAssessmentUploadMessage('');
    }
  };

  const deleteAssessmentFile = async (attachmentId: number) => {
    if (!assessmentRecord || !canMaintainCurrentAsset) return;
    try {
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/records/${encodeURIComponent(assessmentRecord.recordId)}/attachments?id=${attachmentId}`,
        { method: 'DELETE' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || '附件刪除失敗');
        return;
      }
      setAssessmentRecord((prev) => prev
        ? { ...prev, attachments: prev.attachments.filter((item) => item.id !== attachmentId) }
        : prev);
    } catch {
      setError('附件刪除失敗');
    }
  };

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          {canMaintainProperty ? '掃碼維護' : '掃碼查詢'}
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="relative w-full min-h-48 rounded-lg overflow-hidden bg-gray-100">
            <div
              id="qr-reader"
              className={`w-full min-h-48 rounded-lg overflow-hidden ${scanning ? 'bg-black' : 'bg-gray-100'}`}
            />
            {!scanning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-600">
                {scannerStarting ? '相機啟用中...' : '相機未啟用'}
              </div>
            )}
          </div>
          {scanHint && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {scanHint}
            </div>
          )}
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-800">掃描模式</div>
                <div className="text-xs text-gray-500">預設為 Code 128 條碼；需要掃 QR Code 時可切換模式。</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SCANNER_MODE_OPTIONS.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => void changeScannerMode(mode.value)}
                  disabled={scannerStarting}
                  aria-pressed={scannerMode === mode.value}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    scannerMode === mode.value
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                  title={mode.description}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs leading-5 text-gray-500">
              {scannerMode === 'qr'
                ? 'QR Code 模式會改用方形掃描框，較適合掃描方形標籤或含網址的 QR 內容。'
                : 'Code 128 條碼模式會使用橫向掃描框與條碼優先解碼，較適合財產條碼標籤。'}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-800">變焦模式</div>
                <div className="text-xs text-gray-500">
                  預設 {formatZoomPresetLabel(getDefaultZoomPreset(scannerMode))}；目前 {appliedZoomLabel}
                </div>
              </div>
              {scanning && opticalZoomSupported === false && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                  光學不支援
                </span>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void changeZoomPreset('none')}
                  aria-pressed={zoomPreset === 'none'}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    zoomPreset === 'none'
                      ? 'bg-gray-700 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  原始 1x
                </button>
                {SCANNER_ZOOM_LEVELS.map((level) => {
                  const preset = `optical-${level}` as ScannerZoomPreset;
                  const disabled = isZoomPresetDisabled(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void changeZoomPreset(preset)}
                      disabled={disabled}
                      aria-pressed={zoomPreset === preset}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        zoomPreset === preset
                          ? 'bg-blue-600 text-white'
                          : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                      }`}
                      title={disabled ? '此相機不支援這個光學倍率' : undefined}
                    >
                      光學 {formatZoomLevel(level)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {SCANNER_ZOOM_LEVELS.map((level) => {
                  const preset = `digital-${level}` as ScannerZoomPreset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void changeZoomPreset(preset)}
                      aria-pressed={zoomPreset === preset}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        zoomPreset === preset
                          ? 'bg-purple-600 text-white'
                          : 'border border-purple-200 bg-white text-purple-700 hover:bg-purple-50'
                      }`}
                    >
                      數位 {formatZoomLevel(level)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 text-xs leading-5 text-gray-500">
              {scannerMode === 'qr'
                ? 'QR Code 通常以原始 1x 最穩定；若標籤偏小可再切換光學或數位變焦輔助對準。'
                : '光學變焦會優先使用相機硬體倍率，較適合小條碼；數位變焦主要放大畫面協助對準，若仍難辨識請靠近條碼或改用手動輸入。'}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {!scanning ? (
              <button
                onClick={() => void startScanner()}
                disabled={scannerStarting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                <Camera className="w-5 h-5" /> {scannerStarting ? '相機啟用中...' : '啟用相機掃描'}
              </button>
            ) : (
              <>
                <button
                  onClick={stopScanner}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  <CameraOff className="w-5 h-5" /> 停止掃描
                </button>
                {torchSupported && (
                  <button
                    onClick={toggleTorch}
                    className={`px-4 py-2.5 rounded-lg font-medium ${
                      torchOn
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    {torchOn ? '關閉補光' : '開啟補光'}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="mt-3 text-xs leading-5 text-gray-600">
            掃描建議：{getScannerAdvice(scannerMode)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">手動輸入財產編號</label>
          <div className="flex gap-2">
            <input
              ref={manualInputRef}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(manual)}
              placeholder="例如 0112030601-0023"
              className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              onClick={() => lookup(manual)}
              className="inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Search className="w-4 h-4" /> 查詢
            </button>
            <button
              type="button"
              onClick={clearManualInput}
              disabled={!manual}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:bg-gray-100"
              aria-label="清除手動輸入財產編號"
            >
              <X className="w-4 h-4" /> 清除
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">{error}</div>
        )}

        {result && s && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className={`px-4 py-3 ${s.row} flex items-center justify-between`}>
              <div>
                <p className="font-bold text-gray-900">
                  {result.asset.assetCode}　{result.asset.name}
                </p>
                <p className="text-xs text-gray-600">{result.asset.siteName}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${s.badge}`}>{s.label}</span>
            </div>
            <div className="p-4 text-sm text-gray-700 space-y-1">
              <p>放置地點：{result.asset.location || '—'}</p>
              <p>管理人：{result.asset.managerName || '—'}</p>
              <p>維護頻率：{result.asset.maintenanceFrequency || '—'}</p>
              <p>下次應維護：{fmtDate(result.asset.nextMaintenanceDate)}</p>
              <p>最近完成：{fmtDate(result.lastCompletedDate)}</p>
            </div>
            {canMaintainCurrentAsset && (
              <div className="px-4 pb-3">
                <button
                  onClick={openAssetEditor}
                  className="w-full px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100"
                >
                  編輯財產資料
                </button>
              </div>
            )}
            <div className="px-4 pb-4">
              {result.needsMaintenance && result.openTask && canMaintainCurrentAsset ? (
                <button
                  onClick={() => openAssessmentEditor()}
                  disabled={assessmentLoading}
                  className="w-full text-center px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assessmentLoading
                    ? '載入中…'
                    : `開始維護與狀態評量（應維護 ${fmtDate(result.openTask.dueDate)}）`}
                </button>
              ) : result.needsMaintenance && result.openTask ? (
                <p className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-2">
                  此財產目前需維護；一般員工僅可檢視，請通知維護人員處理。
                </p>
              ) : (
                <p className="text-center text-sm text-gray-600 py-2">
                  目前免維護，下次應維護日：{fmtDate(result.asset.nextMaintenanceDate)}
                </p>
              )}
            </div>
          </div>
        )}

        {assetEditorOpen && result && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-bold text-gray-900">編輯財產資料</h2>
                <button
                  onClick={() => setAssetEditorOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  關閉
                </button>
              </div>
              <div className="p-5 space-y-4 text-gray-900">
                <TextField label="財產名稱" value={assetForm.name}
                  onChange={(v) => setAssetForm({ ...assetForm, name: v })} />
                <TextField label="放置地點" value={assetForm.location}
                  onChange={(v) => setAssetForm({ ...assetForm, location: v })} />
                <TextField label="管理人" value={assetForm.managerName}
                  onChange={(v) => setAssetForm({ ...assetForm, managerName: v })} />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">維護頻率</label>
                  <select
                    value={assetForm.maintenanceFrequency}
                    onChange={(e) => setAssetForm({ ...assetForm, maintenanceFrequency: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                  >
                    {FREQUENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DateField label="取得日期" value={assetForm.acquiredDate}
                    onChange={(v) => setAssetForm({ ...assetForm, acquiredDate: v })} />
                  <DateField label="下次應維護" value={assetForm.nextMaintenanceDate}
                    onChange={(v) => setAssetForm({ ...assetForm, nextMaintenanceDate: v })} />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setAssetEditorOpen(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveAsset}
                    disabled={assetSaving || !assetForm.name.trim()}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assetSaving ? '儲存中…' : '儲存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {assessmentOpen && assessmentRecord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-bold text-gray-900">財產現況狀態評量</h2>
                <button
                  onClick={() => setAssessmentOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  關閉
                </button>
              </div>
              <div className="p-5 space-y-5 text-gray-900">
                <fieldset>
                  <legend className="text-sm font-semibold text-gray-900 mb-2">財產維護狀態</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <RadioCard
                      label="無異常"
                      checked={assessmentForm.status === CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY}
                      onChange={() => setAssessmentForm({
                        ...assessmentForm,
                        status: CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY,
                        normalConditionItems: assessmentForm.normalConditionItems.length
                          ? assessmentForm.normalConditionItems
                          : DEFAULT_NORMAL_CONDITION_ITEMS,
                        abnormalConditionItems: [],
                        abnormalDescription: '',
                      })}
                    />
                    <RadioCard
                      label="有異常"
                      checked={assessmentForm.status === CONDITION_ASSESSMENT_STATUS.ABNORMAL}
                      onChange={() => setAssessmentForm({
                        ...assessmentForm,
                        status: CONDITION_ASSESSMENT_STATUS.ABNORMAL,
                        normalConditionItems: [],
                      })}
                    />
                  </div>
                </fieldset>

                {assessmentForm.status === CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY ? (
                  <Checklist
                    title="無異常時的財產狀態（可複選）"
                    options={NORMAL_CONDITION_OPTIONS}
                    selected={assessmentForm.normalConditionItems}
                    onToggle={(item) => toggleAssessmentItem('normalConditionItems', item)}
                  />
                ) : (
                  <>
                    <Checklist
                      title="財產異常狀態（可複選）"
                      options={ABNORMAL_CONDITION_OPTIONS}
                      selected={assessmentForm.abnormalConditionItems}
                      onToggle={(item) => toggleAssessmentItem('abnormalConditionItems', item)}
                    />
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">
                        財產異常處詳細說明
                      </label>
                      <textarea
                        value={assessmentForm.abnormalDescription}
                        onChange={(e) => setAssessmentForm({
                          ...assessmentForm,
                          abnormalDescription: e.target.value,
                        })}
                        rows={4}
                        className="w-full px-3 py-2 border border-red-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:outline-none"
                        placeholder="請描述異常位置、狀況與處理建議"
                      />
                    </div>
                  </>
                )}

                {assessmentForm.status === CONDITION_ASSESSMENT_STATUS.ABNORMAL && (
                  <>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <p>
                        有異常時，如下圖所示，請先用紅框圈出損壞或異常處後再上傳照片；最多 5 個檔案，
                        支援 PDF、Word、PNG、JPG、JPEG，每個檔案上限 10MB。PNG 圖片會以保留原始品質方式最佳化上傳。
                      </p>
                      <Image
                        src="/property-management/condition-assessment-example.png"
                        alt="以紅框圈出輪椅腳踏板異常處的範例"
                        width={205}
                        height={222}
                        className="mt-3 h-auto w-48 rounded border border-red-100 bg-white object-contain sm:w-56"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">異常佐證附件</h3>
                        <label className={`px-3 py-2 rounded-lg text-sm font-medium cursor-pointer ${
                          assessmentRecord.attachments.length >= PROPERTY_ASSESSMENT_MAX_FILES || assessmentUploading
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}>
                          {assessmentUploading ? '上傳中…' : '上傳檔案'}
                          <input
                            type="file"
                            multiple
                            accept={PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE}
                            disabled={assessmentRecord.attachments.length >= PROPERTY_ASSESSMENT_MAX_FILES || assessmentUploading}
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.currentTarget.files ?? []);
                              e.currentTarget.value = '';
                              void uploadAssessmentFiles(files);
                            }}
                          />
                        </label>
                      </div>
                      {assessmentUploading && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                          {assessmentUploadMessage || '附件上傳中，請勿關閉此頁面'}
                        </div>
                      )}
                      {assessmentRecord.attachments.length === 0 ? (
                        <p className="text-sm text-gray-600">尚未上傳附件</p>
                      ) : (
                        <ul className="space-y-2">
                          {assessmentRecord.attachments.map((attachment) => (
                            <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                              <a
                                href={`/api/property-maintenance/records/${encodeURIComponent(assessmentRecord.recordId)}/attachments?id=${attachment.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 flex-1 truncate text-blue-700 hover:underline"
                              >
                                {attachment.originalName}
                              </a>
                              <span className="text-gray-500">{formatFileSize(attachment.fileSize)}</span>
                              <button
                                onClick={() => deleteAssessmentFile(attachment.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                刪除
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                  <input
                    value={assessmentForm.note}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, note: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setAssessmentOpen(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveAssessment}
                    disabled={assessmentSaving}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assessmentSaving ? '儲存中…' : '儲存評量'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
      />
    </div>
  );
}

function RadioCard({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
      checked ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-300 text-gray-900'
    }`}>
      <input type="radio" checked={checked} onChange={onChange} className="h-4 w-4 text-blue-600" />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

function Checklist({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (item: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-gray-900 mb-2">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => onToggle(option)}
              className="h-4 w-4 text-blue-600 rounded"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
