#!/bin/bash
# 🔒 HTTPS 證書生成和配置腳本

echo "🔒 設置 HTTPS 開發環境..."

# 創建證書目錄
mkdir -p certs
cd certs

# 檢查是否需要重新生成證書
if [ ! -f "server.key" ] || [ ! -f "server.crt" ]; then
    echo "📜 生成新的 SSL 證書..."
    
    # 生成私鑰
    openssl genrsa -out server.key 2048
    
    # 生成證書簽名請求和證書
    openssl req -new -x509 -key server.key -out server.crt -days 365 -config localhost.conf -extensions v3_req
    
    echo "✅ SSL 證書生成完成"
else
    echo "✅ SSL 證書已存在"
fi

# 檢查證書有效性
echo "📋 驗證證書配置..."
openssl x509 -in server.crt -text -noout | grep -A 10 "Subject Alternative Name" || echo "⚠️ 證書可能需要更新"

cd ..
echo "🎉 HTTPS 環境配置完成！"
echo ""
echo "📱 使用方式："
echo "   npm run dev:https-network"
echo ""
echo "🌐 訪問地址："
echo "   https://localhost:3001"
echo "   https://192.168.1.149:3001 (手機訪問)"
