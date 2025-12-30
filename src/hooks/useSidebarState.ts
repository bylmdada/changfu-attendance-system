'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'sidebarCollapsed';

/**
 * 管理側邊欄收折狀態的自訂 Hook
 * 使用 localStorage 記憶用戶偏好
 */
export function useSidebarState() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 從 localStorage 讀取狀態
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      setIsCollapsed(JSON.parse(saved));
    }
    setIsInitialized(true);
  }, []);

  // 切換收折狀態
  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newValue));
      return newValue;
    });
  }, []);

  // 設定收折狀態
  const setCollapsed = useCallback((value: boolean) => {
    setIsCollapsed(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, []);

  return {
    isCollapsed,
    isInitialized,
    toggleCollapsed,
    setCollapsed
  };
}

export default useSidebarState;
