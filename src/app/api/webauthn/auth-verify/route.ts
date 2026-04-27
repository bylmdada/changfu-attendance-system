import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { getActiveAllowedLocations, getGPSSettingsFromDB, isClockLocationPayload, validateGpsClockLocation } from '@/lib/gps-attendance';
import { isMobileClockingDevice, MOBILE_CLOCKING_REQUIRED_MESSAGE } from '@/lib/device-detection';
import {
  buildClockReasonPromptData,
  formatMinutesAsTime,
  parseClockReasonPromptSettings,
  shouldSkipClockReasonPrompt,
} from '@/lib/clock-reason-prompt-settings';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';
import {
  convertSpkiPublicKeyToCose,
  getExpectedWebAuthnOrigins,
  getWebAuthnRequestOrigins,
  normalizeBase64url,
  WEBAUTHN_RP_ID,
} from '@/lib/webauthn';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapAuthenticationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知錯誤';

  if (message.includes('Unexpected authentication response challenge')) {
    return 'Challenge 驗證失敗';
  }

  if (message.includes('Unexpected authentication response type')) {
    return 'Type 驗證失敗';
  }

  if (message.includes('Unexpected authentication response origin')) {
    return '來源驗證失敗';
  }

  if (message.includes('Unexpected RP ID hash')) {
    return 'RP ID 驗證失敗';
  }

  if (
    message.includes('User verification')
    || message.includes('User not present')
  ) {
    return '生物識別驗證失敗';
  }

  if (message.includes('Response counter value')) {
    return '可能的重放攻擊';
  }

  if (
    message.includes('ECDSA')
    || message.includes('ASN1')
    || message.includes('signature')
  ) {
    return '簽名驗證失敗';
  }

  return message;
}

export async function POST(request: Request) {
  try {
    if (!isMobileClockingDevice(request.headers.get('user-agent'))) {
      return NextResponse.json({ error: MOBILE_CLOCKING_REQUIRED_MESSAGE }, { status: 403 });
    }

    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('webauthn_auth_challenge');
    const usernameCookie = cookieStore.get('webauthn_auth_username');

    if (!challengeCookie || !usernameCookie) {
      return NextResponse.json({ error: '驗證會話已過期，請重新開始' }, { status: 400 });
    }

    const expectedChallenge = challengeCookie.value;
    const username = usernameCookie.value;
    const expectedOrigins = getExpectedWebAuthnOrigins(getWebAuthnRequestOrigins(request));

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;

    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    const credential = isPlainObject(body.credential) ? body.credential : null;
    const credentialResponse = credential && isPlainObject(credential.response)
      ? credential.response
      : null;
    const clockType = body.clockType === 'in' || body.clockType === 'out'
      ? body.clockType
      : undefined;

    if (body.location !== undefined && body.location !== null && !isClockLocationPayload(body.location)) {
      return NextResponse.json({ error: 'GPS定位資料格式錯誤' }, { status: 400 });
    }

    const location = body.location === undefined || body.location === null
      ? undefined
      : body.location;
    const credentialId = typeof credential?.id === 'string' ? credential.id : '';
    const credentialRawId = typeof credential?.rawId === 'string' ? credential.rawId : undefined;
    const credentialType = typeof credential?.type === 'string' ? credential.type : undefined;
    const clientExtensionResults = isPlainObject(credential?.clientExtensionResults)
      ? credential.clientExtensionResults
      : {};
    const clientDataJSON = typeof credentialResponse?.clientDataJSON === 'string'
      ? credentialResponse.clientDataJSON
      : '';
    const authenticatorData = typeof credentialResponse?.authenticatorData === 'string'
      ? credentialResponse.authenticatorData
      : '';
    const signature = typeof credentialResponse?.signature === 'string'
      ? credentialResponse.signature
      : '';

    const normalizedCredentialId = normalizeBase64url(credentialId || credentialRawId || '');
    const normalizedRawId = credentialRawId ? normalizeBase64url(credentialRawId) : undefined;
    const normalizedClientDataJSON = normalizeBase64url(clientDataJSON);
    const normalizedAuthenticatorData = normalizeBase64url(authenticatorData);
    const normalizedSignature = normalizeBase64url(signature);

    if (!credential || !normalizedCredentialId || !credentialResponse) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    if (credentialType && credentialType !== 'public-key') {
      return NextResponse.json({ error: '無效的憑證類型' }, { status: 400 });
    }

    if (credentialId && normalizedRawId && normalizedCredentialId !== normalizedRawId) {
      return NextResponse.json({ error: '憑證 ID 不一致' }, { status: 400 });
    }

    // 查詢憑證
    const storedCredential = await prisma.webAuthnCredential.findUnique({
      where: { credentialId: normalizedCredentialId },
      include: {
        user: {
          include: {
            employee: true
          }
        }
      }
    });

    if (!storedCredential) {
      return NextResponse.json({ error: '憑證不存在' }, { status: 404 });
    }

    if (!storedCredential.user.isActive || !storedCredential.user.employee) {
      return NextResponse.json({ error: '帳號已停用，請聯繫管理員' }, { status: 401 });
    }

    // 確認是同一用戶
    if (storedCredential.user.username !== username) {
      return NextResponse.json({ error: '憑證與用戶不匹配' }, { status: 403 });
    }

    let credentialPublicKey: Uint8Array;

    try {
      credentialPublicKey = convertSpkiPublicKeyToCose(storedCredential.publicKey);
    } catch (error) {
      console.error('WebAuthn 公鑰轉換錯誤:', error);
      return NextResponse.json({ error: '驗證設定錯誤' }, { status: 500 });
    }

    const authenticationResponse: AuthenticationResponseJSON = {
      id: normalizedCredentialId,
      rawId: normalizedRawId || normalizedCredentialId,
      type: 'public-key',
      clientExtensionResults,
      response: {
        clientDataJSON: normalizedClientDataJSON,
        authenticatorData: normalizedAuthenticatorData,
        signature: normalizedSignature,
      },
    };

    let verification;

    try {
      verification = await verifyAuthenticationResponse({
        response: authenticationResponse,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: WEBAUTHN_RP_ID,
        requireUserVerification: true,
        credential: {
          id: storedCredential.credentialId,
          publicKey: new Uint8Array(credentialPublicKey),
          counter: storedCredential.counter || 0,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: mapAuthenticationErrorMessage(error) },
        { status: 400 }
      );
    }

    if (!verification.verified) {
      return NextResponse.json({ error: '簽名驗證失敗' }, { status: 400 });
    }

    // 更新計數器和最後使用時間
    await prisma.webAuthnCredential.update({
      where: { id: storedCredential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date()
      }
    });

    // 如果需要打卡
    if (clockType === 'in' || clockType === 'out') {
      const gpsSettings = await getGPSSettingsFromDB();
      const allowedLocations = gpsSettings.enabled ? await getActiveAllowedLocations() : [];
      const gpsValidation = validateGpsClockLocation({
        gpsSettings,
        location,
        allowedLocations,
      });

      if (!gpsValidation.ok) {
        return NextResponse.json(
          {
            error: gpsValidation.error,
            code: gpsValidation.code,
          },
          { status: 400 }
        );
      }

      const today = new Date();
      const employeeId = storedCredential.user.employeeId;
      const todayStart = getTaiwanTodayStart(today);
      const todayEnd = getTaiwanTodayEnd(today);
      const todaySchedule = await prisma.schedule.findFirst({
        where: {
          employeeId,
          workDate: toTaiwanDateStr(today),
        },
      });
      const reasonPromptSetting = await prisma.systemSettings.findUnique({
        where: { key: 'clock_reason_prompt' },
      });
      const reasonPromptSettings = parseClockReasonPromptSettings(reasonPromptSetting?.value);
      const taiwanNow = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const currentTaiwanTime = formatMinutesAsTime(taiwanNow.getHours() * 60 + taiwanNow.getMinutes());
      let isHoliday = false;
      let hasApprovedOvertime = false;

      if (reasonPromptSettings.enabled && reasonPromptSettings.excludeHolidays) {
        const holiday = await prisma.holiday.findFirst({
          where: {
            date: {
              gte: todayStart,
              lt: todayEnd,
            },
            isActive: true,
          },
        });
        isHoliday = Boolean(holiday);
      }

      if (reasonPromptSettings.enabled && reasonPromptSettings.excludeApprovedOvertime) {
        const approvedOvertime = await prisma.overtimeRequest.findFirst({
          where: {
            employeeId,
            overtimeDate: {
              gte: todayStart,
              lt: todayEnd,
            },
            status: 'APPROVED',
          },
        });
        hasApprovedOvertime = Boolean(approvedOvertime);
      }

      const skipReasonPrompt = shouldSkipClockReasonPrompt({
        settings: reasonPromptSettings,
        isHoliday,
        isRestDay: todaySchedule?.shiftType === 'OFF',
        hasApprovedOvertime,
      });
      const clockInLocationData = location ? {
        clockInLatitude: location.latitude,
        clockInLongitude: location.longitude,
        clockInAccuracy: location.accuracy,
        clockInAddress: location.address || null
      } : {};
      const clockOutLocationData = location ? {
        clockOutLatitude: location.latitude,
        clockOutLongitude: location.longitude,
        clockOutAccuracy: location.accuracy,
        clockOutAddress: location.address || null
      } : {};

      // 查詢今日打卡記錄
      let attendance = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId,
          workDate: {
            gte: todayStart,
            lt: todayEnd,
          },
        }
      });
      let reasonPromptData = null;

      if (clockType === 'in') {
        if (attendance?.clockInTime) {
          return NextResponse.json({ 
            error: '今日已上班打卡',
            clockInTime: attendance.clockInTime
          }, { status: 400 });
        }

        if (attendance) {
          attendance = await prisma.attendanceRecord.update({
            where: { id: attendance.id },
            data: {
              clockInTime: today,
              ...clockInLocationData
            }
          });
        } else {
          attendance = await prisma.attendanceRecord.create({
            data: {
              employeeId,
              workDate: todayStart,
              clockInTime: today,
              status: 'INCOMPLETE',
              ...clockInLocationData
            }
          });
        }

        reasonPromptData = skipReasonPrompt || !todaySchedule?.startTime
          ? null
          : buildClockReasonPromptData({
              settings: reasonPromptSettings,
              type: 'EARLY_IN',
              scheduledTime: todaySchedule.startTime,
              actualTime: currentTaiwanTime,
              recordId: attendance.id,
            });
      } else {
        if (!attendance) {
          return NextResponse.json({ error: '請先上班打卡' }, { status: 400 });
        }

        if (attendance.clockOutTime) {
          return NextResponse.json({ 
            error: '今日已下班打卡',
            clockOutTime: attendance.clockOutTime
          }, { status: 400 });
        }

        attendance = await prisma.attendanceRecord.update({
          where: { id: attendance.id },
          data: { 
            clockOutTime: today,
            status: 'COMPLETE',
            ...clockOutLocationData
          }
        });

        reasonPromptData = skipReasonPrompt || !todaySchedule?.endTime
          ? null
          : buildClockReasonPromptData({
              settings: reasonPromptSettings,
              type: 'LATE_OUT',
              scheduledTime: todaySchedule.endTime,
              actualTime: currentTaiwanTime,
              recordId: attendance.id,
            });
      }

      // 清除 cookies
      const response = NextResponse.json({
        success: true,
        message: `${clockType === 'in' ? '上班' : '下班'}打卡成功！`,
        employee: storedCredential.user.employee?.name,
        clockInTime: attendance.clockInTime,
        clockOutTime: attendance.clockOutTime,
        requiresReason: Boolean(reasonPromptData),
        reasonPrompt: reasonPromptData,
      });
      response.cookies.delete('webauthn_auth_challenge');
      response.cookies.delete('webauthn_auth_username');
      return response;
    }

    // 單純驗證（不打卡）
    const response = NextResponse.json({
      success: true,
      verified: true,
      user: {
        id: storedCredential.user.id,
        username: storedCredential.user.username,
        employeeId: storedCredential.user.employeeId,
        name: storedCredential.user.employee?.name
      }
    });
    response.cookies.delete('webauthn_auth_challenge');
    response.cookies.delete('webauthn_auth_username');
    return response;
  } catch (error) {
    console.error('WebAuthn 驗證錯誤:', error);
    return NextResponse.json({ 
      error: '驗證失敗：' + (error instanceof Error ? error.message : '未知錯誤')
    }, { status: 500 });
  }
}
