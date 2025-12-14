'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';

// 導覽步驟介面
export interface TourStep {
  target: string; // CSS 選擇器
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

// 導覽 Context
interface TourContextType {
  isActive: boolean;
  currentStep: number;
  steps: TourStep[];
  startTour: (steps: TourStep[]) => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  setCompleted: (tourId: string) => void;
  isCompleted: (tourId: string) => boolean;
}

const TourContext = createContext<TourContextType | null>(null);

// 導覽 Provider
export function TourProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [completedTours, setCompletedTours] = useState<Set<string>>(new Set());

  // 從 localStorage 載入已完成的導覽
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('completed_tours');
      if (saved) {
        setCompletedTours(new Set(JSON.parse(saved)));
      }
    }
  }, []);

  const startTour = useCallback((tourSteps: TourStep[]) => {
    setSteps(tourSteps);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const endTour = useCallback(() => {
    setIsActive(false);
    setSteps([]);
    setCurrentStep(0);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      endTour();
    }
  }, [currentStep, steps.length, endTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const setCompleted = useCallback((tourId: string) => {
    setCompletedTours(prev => {
      const newSet = new Set(prev);
      newSet.add(tourId);
      if (typeof window !== 'undefined') {
        localStorage.setItem('completed_tours', JSON.stringify([...newSet]));
      }
      return newSet;
    });
  }, []);

  const isCompleted = useCallback((tourId: string) => {
    return completedTours.has(tourId);
  }, [completedTours]);

  return (
    <TourContext.Provider value={{
      isActive,
      currentStep,
      steps,
      startTour,
      endTour,
      nextStep,
      prevStep,
      setCompleted,
      isCompleted
    }}>
      {children}
      {isActive && <TourOverlay />}
    </TourContext.Provider>
  );
}

// 使用 Hook
export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return context;
}

// 導覽遮罩組件
function TourOverlay() {
  const { currentStep, steps, nextStep, prevStep, endTour } = useTour();
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  const step = steps[currentStep];

  useEffect(() => {
    if (!step) return;

    const target = document.querySelector(step.target);
    if (target) {
      const rect = target.getBoundingClientRect();
      const padding = 8;
      
      setPosition({
        top: rect.top - padding + window.scrollY,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2
      });

      // 計算 tooltip 位置
      const tooltipWidth = 320;
      const tooltipHeight = 150;
      let tooltipTop = 0;
      let tooltipLeft = 0;

      switch (step.placement || 'bottom') {
        case 'top':
          tooltipTop = rect.top - tooltipHeight - 20 + window.scrollY;
          tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case 'bottom':
          tooltipTop = rect.bottom + 20 + window.scrollY;
          tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case 'left':
          tooltipTop = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
          tooltipLeft = rect.left - tooltipWidth - 20;
          break;
        case 'right':
          tooltipTop = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
          tooltipLeft = rect.right + 20;
          break;
      }

      // 確保不超出螢幕
      tooltipLeft = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, tooltipLeft));
      tooltipTop = Math.max(10, tooltipTop);

      setTooltipPosition({ top: tooltipTop, left: tooltipLeft });

      // 滾動到目標位置
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [step, currentStep]);

  if (!step) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div 
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={endTour}
      />

      {/* 高亮區域 */}
      <div
        className="fixed z-[9999] bg-transparent rounded-lg ring-4 ring-blue-500 ring-opacity-70"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          height: position.height,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
        }}
      />

      {/* 提示框 */}
      <div
        className="fixed z-[10000] w-80 bg-white rounded-xl shadow-2xl p-4"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left
        }}
      >
        {/* 關閉按鈕 */}
        <button
          onClick={endTour}
          className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 rounded"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 標題 */}
        <h3 className="text-lg font-semibold text-gray-900 mb-2 pr-6">
          {step.title}
        </h3>

        {/* 內容 */}
        <p className="text-sm text-gray-600 mb-4">
          {step.content}
        </p>

        {/* 進度和按鈕 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">
            {currentStep + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                onClick={prevStep}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
                上一步
              </button>
            )}
            <button
              onClick={nextStep}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg"
            >
              {currentStep === steps.length - 1 ? '完成' : '下一步'}
              {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 說明按鈕組件
export function HelpButton({ tourSteps, tourId }: { tourSteps: TourStep[]; tourId: string }) {
  const { startTour, setCompleted } = useTour();

  const handleClick = () => {
    startTour(tourSteps);
    setCompleted(tourId);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border"
      title="查看操作說明"
    >
      <HelpCircle className="w-4 h-4" />
      操作說明
    </button>
  );
}

// 預設導覽步驟
export const DASHBOARD_TOUR: TourStep[] = [
  {
    target: '[data-tour="quick-clock"]',
    title: '快速打卡',
    content: '點擊此處可以快速完成上班或下班打卡。系統會自動偵測您的 GPS 位置。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="attendance-status"]',
    title: '今日出勤狀態',
    content: '這裡顯示您今天的打卡記錄和工作時數。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="menu"]',
    title: '功能選單',
    content: '點擊這裡可以存取所有系統功能，包括請假、加班申請等。',
    placement: 'right'
  }
];

export const LEAVE_REQUEST_TOUR: TourStep[] = [
  {
    target: '[data-tour="leave-type"]',
    title: '選擇請假類型',
    content: '請選擇您要申請的假別，如特休、病假、事假等。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="leave-dates"]',
    title: '選擇請假日期',
    content: '選擇請假的開始和結束日期，系統會自動計算天數。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="leave-reason"]',
    title: '填寫請假事由',
    content: '請簡要說明請假原因，以利主管審核。',
    placement: 'top'
  },
  {
    target: '[data-tour="submit-btn"]',
    title: '送出申請',
    content: '確認資料無誤後，點擊此按鈕送出申請。',
    placement: 'top'
  }
];

export const ADMIN_TOUR: TourStep[] = [
  {
    target: '[data-tour="dashboard-stats"]',
    title: '管理儀表板',
    content: '這裡顯示今日出勤概況、待審核項目等重要資訊。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="pending-approvals"]',
    title: '待審核項目',
    content: '顯示所有待您審核的請假和加班申請。',
    placement: 'bottom'
  },
  {
    target: '[data-tour="system-settings"]',
    title: '系統設定',
    content: '點擊這裡可以設定打卡地點、時間限制等系統參數。',
    placement: 'left'
  }
];
