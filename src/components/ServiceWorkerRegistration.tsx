'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    const registerSW = async () => {
      // 只在生產環境或有正確 SSL 時註冊 Service Worker
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });
        console.log('✅ Service Worker 註冊成功:', registration.scope);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('🔄 新版本 Service Worker 已就緒');
              }
            });
          }
        });
      } catch {
        // 在開發環境中（SSL 憑證問題）靜默忽略，正式環境會正常運作
        // 不顯示錯誤訊息，避免干擾使用者
      }
    };

    registerSW();
  }, []);

  return null;
}
