(function() {
    // スタイルの自動注入 (Apple風デザイン)
    const styleId = 'apple-notification-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .apple-notification-container {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(-150%);
                width: 90%;
                max-width: 400px;
                background: rgba(255, 255, 255, 0.85);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.4);
                border-radius: 14px;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05);
                padding: 14px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                z-index: 999999;
                transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
                opacity: 0;
                user-select: none;
                cursor: pointer;
            }
            .apple-notification-container.show {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            .apple-notification-icon {
                width: 38px;
                height: 38px;
                background: #2563eb;
                border-radius: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(37, 99, 235, 0.2);
                flex-shrink: 0;
            }
            .apple-notification-icon img {
                width: 22px;
                height: 22px;
                object-fit: contain;
            }
            .apple-notification-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 2px;
                overflow: hidden;
            }
            .apple-notification-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .apple-notification-appname {
                font-size: 11px;
                font-weight: 600;
                color: #64748b;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .apple-notification-time {
                font-size: 11px;
                color: #94a3b8;
            }
            .apple-notification-title {
                font-size: 14px;
                font-weight: 600;
                color: #0f172a;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .apple-notification-body {
                font-size: 13px;
                color: #475569;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
        `;
        document.head.appendChild(style);
    }

    // 通知を表示するメイン関数
    window.showAppleNotification = function({ title, body, iconUrl, appName = "MAIL", onClick }) {
        // 既存の通知があれば消す
        const oldNotify = document.querySelector('.apple-notification-container');
        if (oldNotify) oldNotify.remove();

        // エレメント作成
        const container = document.createElement('div');
        container.className = 'apple-notification-container';

        // アイコン構造 (指定がなければデフォルト画像)
        const finalIcon = iconUrl ? `<img src="${iconUrl}">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;

        container.innerHTML = `
            <div class="apple-notification-icon">${finalIcon}</div>
            <div class="apple-notification-content">
                <div class="apple-notification-header">
                    <span class="apple-notification-appname">${appName}</span>
                    <span class="apple-notification-time">今</span>
                </div>
                <div class="apple-notification-title">${title}</div>
                <div class="apple-notification-body">${body}</div>
            </div>
        `;

        document.body.appendChild(container);

        // リフローを起こしてアニメーションを有効にする
        container.getBoundingClientRect();
        container.classList.add('show');

        // クリックイベント
        container.addEventListener('click', () => {
            if (typeof onClick === 'function') onClick();
            hideNotification(container);
        });

        // 5秒後に自動的に隠す
        let autoHideTimer = setTimeout(() => {
            hideNotification(container);
        }, 5000);

        function hideNotification(el) {
            if (!el.parentNode) return;
            el.classList.remove('show');
            // アニメーション完了後にDOMから完全に削除
            setTimeout(() => {
                if (el.parentNode) el.parentNode.remove();
            }, 4000);
        }
    };

    // テスト・運用用のシミュレータ (バックエンドとポーリングやWebsocketで連携する場合はここを書き換えてください)
    // 例: 新しいメールが届いた時、以下のように呼び出すだけで動作します
    // window.showAppleNotification({
    //     title: "新着メール: 櫻 涼介",
    //     body: "先ほど修正したchat.jsとindex.htmlの件について...",
    //     onClick: () => { location.href = '/chat/'; }
    // });
})();