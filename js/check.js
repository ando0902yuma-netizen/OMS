// js/check.js
(function() {
    // 1. オンライン状況ビーコン送信と新着メッセージ確認の定期実行
    let lastCheckedMessageId = null;
    const isChatPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html') || !!document.getElementById('msgContainer');

    // トースト通知用のCSSスタイルを動的に注入
    const style = document.createElement('style');
    style.innerHTML = `
        .oms-toast-notification {
            position: fixed;
            top: 20px;
            right: -350px;
            width: 320px;
            background: #ffffff;
            border-left: 5px solid #0284c7;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
            border-radius: 8px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 999999;
            transition: right 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            cursor: pointer;
            font-family: sans-serif;
        }
        .oms-toast-notification.show {
            right: 20px;
        }
        .oms-toast-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            background: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: #475569;
            flex-shrink: 0;
        }
        .oms-toast-body {
            flex: 1;
            overflow: hidden;
        }
        .oms-toast-title {
            font-size: 13px;
            font-weight: bold;
            color: #1e293b;
            margin: 0 0 2px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .oms-toast-text {
            font-size: 12px;
            color: #64748b;
            margin: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    `;
    document.head.appendChild(style);

    // 通知ポップアップを表示する関数
    function showNotification(msg) {
        // すでにチャットルームを開いている場合は通知を表示しない
        if (isChatPage) return;

        const toast = document.createElement('div');
        toast.className = 'oms-toast-notification';
        
        let iconHtml = '';
        if (msg.icon) {
            iconHtml = `<img src="${msg.icon}" class="oms-toast-icon" alt="">`;
        } else {
            iconHtml = `<div class="oms-toast-icon">${(msg.displayName || msg.username || '?').charAt(0).toUpperCase()}</div>`;
        }

        toast.innerHTML = `
            ${iconHtml}
            <div class="oms-toast-body">
                <p class="oms-toast-title">${msg.displayName || msg.username} からのメッセージ</p>
                <p class="oms-toast-text">${msg.text || (msg.image ? '📷 画像が送信されました' : '')}</p>
            </div>
        `;

        // クリックしたらチャットのメイン画面へ遷移
        toast.addEventListener('click', () => {
            window.location.href = '/index.html';
        });

        document.body.appendChild(toast);

        // スライドイン表示
        setTimeout(() => toast.classList.add('show'), 100);

        // 5秒後にスライドアウトして消滅
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    }

    // サーバーへの状況報告＆新着チャット取得ポーリング
    async function sendBeaconAndCheckMessages() {
        const pageTitle = document.title || 'OMS Page';
        try {
            // オンライン状況の報告
            await fetch('/api/online-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageTitle: pageTitle, status: 'active' })
            });

            // 新着メッセージのチェック
            const res = await fetch(`/api/messages/check-new?lastId=${lastCheckedMessageId || ''}`);
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    // 初回実行時はメッセージIDの基準値として登録するのみにする（ページを開いた瞬間に過去の通知が大量に出るのを防ぐ）
                    if (lastCheckedMessageId === null) {
                        lastCheckedMessageId = data.lastId;
                    } else if (data.newMessages && data.newMessages.length > 0) {
                        lastCheckedMessageId = data.lastId;
                        // 新しいメッセージを順次通知
                        data.newMessages.forEach(msg => {
                            showNotification(msg);
                        });
                    }
                }
            }
        } catch (e) {
            console.error('OMS beacon / check error:', e);
        }
    }

    // 初回実行と3秒間隔での定期ポーリング
    sendBeaconAndCheckMessages();
    setInterval(sendBeaconAndCheckMessages, 3000);

    // ページを閉じるときにオンライン状況をクローズする
    window.addEventListener('beforeunload', () => {
        const pageTitle = document.title || 'OMS Page';
        const data = JSON.stringify({ pageTitle: pageTitle, status: 'close' });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/online-check', data);
        } else {
            fetch('/api/online-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: data,
                keepalive: true
            });
        }
    });
})();