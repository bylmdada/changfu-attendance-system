const CACHE_NAME = 'changfu-attendance-v3';
const OFFLINE_URL = '/offline.html';

// 需要快取的靜態資源（只快取確定存在的檔案）
const STATIC_CACHE = [
  '/manifest.json',
  OFFLINE_URL
];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('快取靜態資源');
        // 逐個快取，忽略失敗的項目
        return Promise.allSettled(
          STATIC_CACHE.map(url => 
            cache.add(url).catch(err => console.warn('快取失敗:', url, err))
          )
        );
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// 啟用事件 - 清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 攔截請求
self.addEventListener('fetch', (event) => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Only explicitly public static assets are cached. Pages and APIs always use the network.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (!STATIC_CACHE.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));

});

// 推播通知處理
self.addEventListener('push', (event) => {
  if (event.data) {
    let data;
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: '長福會考勤系統',
        body: event.data.text()
      };
    }
    
    // 根據通知類型設定不同的操作按鈕
    let actions = [];
    const notificationType = data.data?.type || 'GENERAL';
    
    switch (notificationType) {
      case 'ATTENDANCE_REMINDER':
      case 'MISSED_CLOCK':
        actions = [
          { action: 'clock', title: '立即打卡', icon: '/icons/clock.png' },
          { action: 'dismiss', title: '稍後', icon: '/icons/dismiss.png' }
        ];
        break;
      case 'OVERTIME_WARNING':
        actions = [
          { action: 'view', title: '查看詳情', icon: '/icons/view.png' }
        ];
        break;
      case 'LEAVE_APPROVED':
      case 'LEAVE_REJECTED':
        actions = [
          { action: 'view', title: '查看', icon: '/icons/view.png' }
        ];
        break;
      default:
        actions = [];
    }

    const options = {
      body: data.body,
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: data.data || {},
      tag: data.tag || notificationType,
      renotify: true,
      actions
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// 通知點擊處理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data || {};
  let targetUrl = '/';
  
  // 根據操作決定導向
  if (action === 'clock') {
    targetUrl = '/attendance';
  } else if (action === 'view' || action === '') {
    targetUrl = data.url || '/';
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 如果已有開啟的視窗，聚焦並導航
        for (const client of clientList) {
          if ('focus' in client && 'navigate' in client) {
            return client.focus().then(() => client.navigate(targetUrl));
          }
        }
        // 否則開新視窗
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
