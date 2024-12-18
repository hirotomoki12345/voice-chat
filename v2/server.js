const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Expressアプリケーションを作成
const app = express();
const server = http.createServer(app);

// WebSocketサーバーをwssで設定
const wss = new WebSocket.Server({ server });

// クライアントIDとWebSocketをマッピングするためのマップ
const clients = new Map();
const activeCalls = new Map(); // 通話中のクライアントペアを追跡

// 10桁のランダムな数値IDを生成する関数
function generateId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

wss.on('connection', (ws) => {
    // 一意の10桁のIDを生成
    let clientId;
    do {
        clientId = generateId();
    } while (clients.has(clientId)); // 既存のIDと重複しないようにする

    clients.set(clientId, ws);

    // クライアントに自身のIDを送信
    ws.send(JSON.stringify({ type: 'id', id: clientId }));

    console.log(`Client connected: ${clientId}`);

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'request') {
            // 通話リクエストを送信
            const target = clients.get(data.targetId);
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(JSON.stringify({ type: 'request', from: clientId }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Target not available' }));
            }
        }

        if (data.type === 'response') {
            // 通話リクエストへの応答（承諾または拒否）
            const target = clients.get(data.targetId);
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(
                    JSON.stringify({ type: 'response', from: clientId, accepted: data.accepted })
                );

                // 通話が承諾された場合、ペアを登録
                if (data.accepted) {
                    activeCalls.set(clientId, data.targetId);
                    activeCalls.set(data.targetId, clientId);
                }
            }
        }

        if (data.type === 'offer' || data.type === 'answer' || data.type === 'candidate') {
            // WebRTCシグナリングメッセージを転送
            const target = clients.get(data.targetId);
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(
                    JSON.stringify({
                        type: data.type,
                        from: clientId,
                        [data.type]: data[data.type],
                    })
                );
            }
        }

        if (data.type === 'disconnect') {
            // 通話を切断する
            const targetId = activeCalls.get(clientId);
            if (targetId) {
                const target = clients.get(targetId);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(
                        JSON.stringify({ type: 'disconnect', from: clientId })
                    );
                }
                activeCalls.delete(clientId);
                activeCalls.delete(targetId);
            }
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);

        // 通話中なら相手に通知
        const targetId = activeCalls.get(clientId);
        if (targetId) {
            const target = clients.get(targetId);
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(
                    JSON.stringify({ type: 'disconnect', from: clientId, reason: 'connection lost' })
                );
            }
            activeCalls.delete(clientId);
            activeCalls.delete(targetId);
        }

        // クライアントリストから削除
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);

        // 通話中なら相手に通知
        const targetId = activeCalls.get(clientId);
        if (targetId) {
            const target = clients.get(targetId);
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(
                    JSON.stringify({ type: 'disconnect', from: clientId, reason: 'connection error' })
                );
            }
            activeCalls.delete(clientId);
            activeCalls.delete(targetId);
        }

        // クライアントリストから削除
        clients.delete(clientId);
    });
});

// 静的ファイルを提供
app.use(express.static(path.join(__dirname, 'public')));

// サーバーを起動
const PORT = 3198;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
