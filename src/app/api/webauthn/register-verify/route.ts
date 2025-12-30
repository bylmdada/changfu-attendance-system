import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';

// Base64URL 解碼
function base64urlToBuffer(base64url: string): Buffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padLen), 'base64');
}

// 解析 COSE 公鑰（簡化版，僅支援 ES256）
function parseCOSEPublicKey(coseKey: Buffer): string {
  // 直接儲存 COSE 格式的公鑰
  return coseKey.toString('base64url');
}

// 解析 attestationObject（簡化版）
function parseAttestationObject(attestationObject: Buffer): { authData: Buffer } {
  // CBOR 解碼簡化：attestationObject 結構固定
  // 找到 authData 的起始位置
  const authDataStart = attestationObject.indexOf(Buffer.from([0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61]));
  if (authDataStart === -1) {
    throw new Error('無法解析 attestationObject');
  }
  
  // authData 長度標記後的數據
  const lengthByte = attestationObject[authDataStart + 9];
  let authDataLength: number;
  let dataStart: number;
  
  if (lengthByte < 0x58) {
    // 短格式
    authDataLength = lengthByte - 0x40;
    dataStart = authDataStart + 10;
  } else if (lengthByte === 0x58) {
    // 1 字節長度
    authDataLength = attestationObject[authDataStart + 10];
    dataStart = authDataStart + 11;
  } else if (lengthByte === 0x59) {
    // 2 字節長度
    authDataLength = attestationObject.readUInt16BE(authDataStart + 10);
    dataStart = authDataStart + 12;
  } else {
    throw new Error('不支援的 authData 長度格式');
  }
  
  const authData = attestationObject.subarray(dataStart, dataStart + authDataLength);
  return { authData };
}

// 從 authData 提取憑證資訊
function parseAuthData(authData: Buffer): { credentialId: Buffer; publicKey: Buffer; counter: number } {
  // authData 結構：
  // rpIdHash (32) + flags (1) + counter (4) + attestedCredentialData (variable)
  const credentialIdLength = authData.readUInt16BE(53);
  const credentialId = authData.subarray(55, 55 + credentialIdLength);
  const publicKey = authData.subarray(55 + credentialIdLength);
  const counter = authData.readUInt32BE(33);
  
  return { credentialId, publicKey, counter };
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('webauthn_challenge');
    const userIdCookie = cookieStore.get('webauthn_user_id');

    if (!challengeCookie || !userIdCookie) {
      return NextResponse.json({ error: '註冊會話已過期，請重新開始' }, { status: 400 });
    }

    const expectedChallenge = challengeCookie.value;
    const userId = parseInt(userIdCookie.value);

    const { credential, deviceName } = await request.json();

    if (!credential || !credential.id || !credential.response) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    // 解析 clientDataJSON
    const clientDataJSON = base64urlToBuffer(credential.response.clientDataJSON);
    const clientData = JSON.parse(clientDataJSON.toString('utf-8'));

    // 驗證 challenge
    if (clientData.challenge !== expectedChallenge) {
      return NextResponse.json({ error: 'Challenge 驗證失敗' }, { status: 400 });
    }

    // 驗證 origin（開發環境允許 localhost）
    const allowedOrigins = [
      'https://localhost:3001',
      'https://127.0.0.1:3001',
      `https://${process.env.WEBAUTHN_RP_ID || 'localhost'}:3001`
    ];
    
    // 也允許本地 IP
    if (!allowedOrigins.some(origin => clientData.origin.startsWith(origin.replace(':3001', '')))) {
      console.warn('Origin 不匹配:', clientData.origin);
      // 開發環境放寬限制
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Origin 驗證失敗' }, { status: 400 });
      }
    }

    // 驗證 type
    if (clientData.type !== 'webauthn.create') {
      return NextResponse.json({ error: 'Type 驗證失敗' }, { status: 400 });
    }

    // 解析 attestationObject
    const attestationObject = base64urlToBuffer(credential.response.attestationObject);
    const { authData } = parseAttestationObject(attestationObject);
    const { credentialId, publicKey, counter } = parseAuthData(authData);

    // 儲存憑證
    await prisma.webAuthnCredential.create({
      data: {
        credentialId: credential.id, // 使用原始的 base64url ID
        publicKey: parseCOSEPublicKey(publicKey),
        counter,
        deviceName: deviceName || '未命名裝置',
        transports: credential.response.transports ? JSON.stringify(credential.response.transports) : null,
        userId
      }
    });

    // 清除 cookies
    const response = NextResponse.json({ 
      success: true, 
      message: 'Face ID / 指紋註冊成功！'
    });
    response.cookies.delete('webauthn_challenge');
    response.cookies.delete('webauthn_user_id');

    return response;
  } catch (error) {
    console.error('WebAuthn 註冊驗證錯誤:', error);
    return NextResponse.json({ 
      error: '註冊失敗：' + (error instanceof Error ? error.message : '未知錯誤')
    }, { status: 500 });
  }
}
