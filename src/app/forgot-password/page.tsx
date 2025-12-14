'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, Phone, User, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 載入系統設定
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/system-settings/password-reset');
        if (response.ok) {
          const data = await response.json();
          setEmailEnabled(data.emailResetEnabled || false);
        }
      } catch (error) {
        console.error('載入設定失敗:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleEmailReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !email) {
      setMessage({ type: 'error', text: '請填寫員編和 Email' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, email })
      });

      const data = await response.json();
      
      if (response.ok) {
        setMessage({ type: 'success', text: '重設連結已發送至您的 Email，請查收。' });
        setEmployeeId('');
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data.error || '發送失敗，請稍後再試' });
      }
    } catch (error) {
      console.error('發送失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤，請稍後再試' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 頂部裝飾條 */}
      <div className="h-1.5 bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600" />
      
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
          {/* 返回按鈕 */}
          <button
            onClick={() => router.push('/login')}
            className="flex items-center text-gray-500 hover:text-gray-700 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            返回登入
          </button>

          {/* Logo */}
          <div className="text-center mb-6">
            <Image
              src="/logo.png"
              alt="長福會"
              width={60}
              height={60}
              className="mx-auto mb-3"
              priority
            />
            <h1 className="text-xl font-bold text-gray-800">忘記密碼</h1>
          </div>

          {/* 訊息提示 */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
              message.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-700' 
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {message.type === 'success' 
                ? <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              }
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {emailEnabled ? (
            /* Email 重設模式 */
            <form onSubmit={handleEmailReset} className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                請輸入您的員編和登記的 Email，系統將發送密碼重設連結。
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">員編</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
                    placeholder="請輸入員編"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
                    placeholder="請輸入 Email"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    發送中...
                  </>
                ) : (
                  <>
                    <Mail className="w-5 h-5" />
                    發送重設連結
                  </>
                )}
              </button>
            </form>
          ) : (
            /* 聯繫管理員模式 */
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <Phone className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold text-blue-800 mb-2">請聯繫管理員</h3>
                    <p className="text-sm text-blue-700 mb-4">
                      若您忘記密碼，請聯繫系統管理員協助重設。
                    </p>
                    <div className="space-y-2 text-sm text-blue-800">
                      <p>• 請提供您的員編以便確認身份</p>
                      <p>• 管理員將為您重設密碼</p>
                      <p>• 重設後請立即修改為新密碼</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 忘打卡申請提醒 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold text-yellow-800 mb-2 text-base">因忘記密碼無法打卡？</h3>
                    <p className="text-base text-yellow-700 mb-3">
                      請在密碼重設後，填寫<strong>「申請補打卡」</strong>，補登紀錄。
                    </p>
                    <p className="text-sm text-yellow-600">
                      申請理由可選擇：「忘記密碼」
                    </p>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <button
                  onClick={() => router.push('/login')}
                  className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  返回登入頁面
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 版權 */}
      <div className="p-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} 長福會考勤系統
      </div>
    </div>
  );
}
