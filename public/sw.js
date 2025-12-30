const CACHE_NAME = 'changfu-attendance-v1';
const OFFLINE_URL = '/offline.html';

// 需要快取的靜態資源
const STATIC_CACHE = [
  '/',
  '/login',
  '/quick-clock',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('快取靜態資源');
        return cache.addAll(STATIC_CACHE);
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

  // API 請求使用 Network First 策略
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: '離線模式，無法連接伺服器' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // 其他請求使用 Cache First 策略
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        
        return fetch(event.request)
          .then((response) => {
            // 不快取非成功響應
            if (!response || response.status !== 200) {
              return response;
            }

            // 快取新資源
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // 離線時返回快取的離線頁面
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }
          });
      })
  );
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

