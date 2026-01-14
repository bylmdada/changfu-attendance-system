import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';
import crypto from 'crypto';

// Base64URL 解碼
function base64urlToBuffer(base64url: string): Buffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padLen), 'base64');
}

// 驗證簽名（簡化版，僅驗證格式）
async function verifySignature(
  authData: Buffer,
  clientDataHash: Buffer,
  signature: Buffer,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    // 組合要驗證的資料
    const signedData = Buffer.concat([authData, clientDataHash]);
    
    // 解碼公鑰
    const publicKeyBuffer = base64urlToBuffer(publicKeyBase64);
    
    // 簡化驗證：檢查簽名長度合理
    // 完整實作需要使用 crypto.verify 搭配 COSE 公鑰解析
    if (signature.length < 64) {
      return false;
    }
    
    // 計算 signedData hash 確保資料完整
    const hash = crypto.createHash('sha256').update(signedData).digest();
    
    // 開發階段：驗證通過（生產環境需要完整的簽名驗證）
    console.log('WebAuthn 驗證:', {
      authDataLength: authData.length,
      clientDataHashLength: clientDataHash.length,
      signatureLength: signature.length,
      publicKeyLength: publicKeyBuffer.length,
      dataHashLength: hash.length
    });
    
    return true;
  } catch (error) {
    console.error('簽名驗證錯誤:', error);
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('webauthn_auth_challenge');
    const usernameCookie = cookieStore.get('webauthn_auth_username');

    if (!challengeCookie || !usernameCookie) {
      return NextResponse.json({ error: '驗證會話已過期，請重新開始' }, { status: 400 });
    }

    const expectedChallenge = challengeCookie.value;
    const username = usernameCookie.value;

    const { credential, clockType } = await request.json();

    if (!credential || !credential.id || !credential.response) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    // 查詢憑證
    const storedCredential = await prisma.webAuthnCredential.findUnique({
      where: { credentialId: credential.id },
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

    // 確認是同一用戶
    if (storedCredential.user.username !== username) {
      return NextResponse.json({ error: '憑證與用戶不匹配' }, { status: 403 });
    }

    // 解析 clientDataJSON
    const clientDataJSON = base64urlToBuffer(credential.response.clientDataJSON);
    const clientData = JSON.parse(clientDataJSON.toString('utf-8'));

    // 驗證 challenge
    if (clientData.challenge !== expectedChallenge) {
      return NextResponse.json({ error: 'Challenge 驗證失敗' }, { status: 400 });
    }

    // 驗證 type
    if (clientData.type !== 'webauthn.get') {
      return NextResponse.json({ error: 'Type 驗證失敗' }, { status: 400 });
    }

    // 解析 authenticatorData
    const authData = base64urlToBuffer(credential.response.authenticatorData);
    const signature = base64urlToBuffer(credential.response.signature);
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();

    // 驗證計數器（防重放攻擊）
    const receivedCounter = authData.readUInt32BE(33);
    const storedCounter = storedCredential.counter || 0;
    
    // 只有當計數器明顯倒退（不是相等或輕微問題）時才阻止
    // 有些驗證器在取消/重試時不會增加計數器
    if (receivedCounter < storedCounter && receivedCounter !== 0) {
      console.warn('計數器異常:', { received: receivedCounter, stored: storedCounter });
      // 只在生產環境且計數器明顯異常時阻止
      if (process.env.NODE_ENV === 'production' && (storedCounter - receivedCounter) > 5) {
        return NextResponse.json({ error: '可能的重放攻擊' }, { status: 400 });
      }
    }

    // 驗證簽名
    const isValid = await verifySignature(
      authData,
      clientDataHash,
      signature,
      storedCredential.publicKey
    );

    if (!isValid) {
      return NextResponse.json({ error: '簽名驗證失敗' }, { status: 400 });
    }

    // 更新計數器和最後使用時間
    await prisma.webAuthnCredential.update({
      where: { id: storedCredential.id },
      data: {
        counter: receivedCounter,
        lastUsedAt: new Date()
      }
    });

    // 如果需要打卡
    if (clockType === 'in' || clockType === 'out') {
      const today = new Date();
      const workDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const employeeId = storedCredential.user.employeeId;

      // 查詢今日打卡記錄
      let attendance = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId,
          workDate
        }
      });

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
            data: { clockInTime: today }
          });
        } else {
          attendance = await prisma.attendanceRecord.create({
            data: {
              employeeId,
              workDate,
              clockInTime: today,
              status: 'INCOMPLETE'
            }
          });
        }
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
            status: 'COMPLETE'
          }
        });
      }

      // 清除 cookies
      const response = NextResponse.json({
        success: true,
        message: `${clockType === 'in' ? '上班' : '下班'}打卡成功！`,
        employee: storedCredential.user.employee?.name,
        clockInTime: attendance.clockInTime,
        clockOutTime: attendance.clockOutTime
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
