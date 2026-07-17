(function() {
    const isNode = typeof module !== 'undefined' && module.exports;

    if (isNode) {
        // ==========================================
        // 【サーバー側原子】APIエンドポイント定義
        // ==========================================
        const { app, upload, readAccounts, writeAccounts, readMessages, writeMessages, adminVerificationCodes, generateAdminCode } = global.omsConfig;
        
        const path = require('path');
        const fs = require('fs');

        // メッセージ全取得
        app.get('/api/messages', (req, res) => {
            res.json({ success: true, messages: readMessages() });
        });

        // 既読処理（仕様：自分のメッセージは既読対象外）
        app.post('/api/messages/read', (req, res) => {
            if (!req.session.user) return res.status(401).json({ success: false, message: '未ログイン' });
            const { messageIds } = req.body;
            if (!messageIds || !Array.isArray(messageIds)) return res.status(400).json({ success: false, message: '不正な要求' });

            const messages = readMessages();
            const myUsername = req.session.user.username;
            messages.forEach(m => {
                if (messageIds.includes(m.id)) {
                    if (m.username !== myUsername) {
                        if (!m.readBy) m.readBy = [];
                        if (!m.readBy.includes(myUsername)) m.readBy.push(myUsername);
                    }
                }
            });
            writeMessages(messages);
            res.json({ success: true });
        });

        // メッセージ投稿（DM・管理者昇格ロジック＋リプライ機能の統合版）
        app.post('/api/messages', upload.single('image'), (req, res) => {
            if (!req.session.user) return res.status(401).json({ success: false, message: 'ログインが必要です' });
            
            let text = req.body.text || '';
            const { replyToId } = req.body;
            const myUsername = req.session.user.username;
            if (text.trim() === '' && !req.file) return res.status(400).json({ success: false, message: '内容が必要です' });

            const accounts = readAccounts();
            const messages = readMessages();
            const user = accounts.find(a => a.username === myUsername);
            let toUser = null, systemNotice = null, skipSaveMessage = false;

            // 【管理者になる機能】
            if (text.trim() === '/request admin') {
                const newCode = generateAdminCode();
                adminVerificationCodes.set(myUsername, newCode);
                console.log(`\n====================================================\n[ADMIN REQUEST] @${myUsername} 管理者コード: ${newCode}\n====================================================\n`);
                skipSaveMessage = true;
            } else if (text.trim().startsWith('/admin pass ')) {
                const inputCode = text.trim().substring(12).trim();
                const correctCode = adminVerificationCodes.get(myUsername);
                toUser = myUsername;
                if (correctCode && inputCode === correctCode) {
                    const idx = accounts.findIndex(a => a.username === myUsername);
                    if (idx !== -1) { accounts[idx].role = "admin"; writeAccounts(accounts); }
                    adminVerificationCodes.delete(myUsername);
                    text = "🎉 認証に成功しました！管理者権限（admin）が付与されました。";
                } else { text = "❌ コードが正しくないか、有効期限が切れています。"; }
                systemNotice = "admin_result";
            } else {
                // 【DM機能】
                const dmMatch = text.match(/^@([^\s]+)\s([\s\S]*)$/);
                if (dmMatch) {
                    const inputName = dmMatch[1];
                    let target = accounts.find(a => a.username === inputName) || accounts.find(a => a.displayName === inputName);
                    if (target) { toUser = target.username; text = dmMatch[2]; }
                }
            }

            if (skipSaveMessage) return res.json({ success: true, message: { text: "Requested", system: "hidden" } });

            // 【リプライ機能】
            let replyToData = null;
            if (replyToId && !systemNotice) {
                const targetMsg = messages.find(m => String(m.id) === String(replyToId));
                if (targetMsg) {
                    replyToData = {
                        id: targetMsg.id,
                        username: targetMsg.username,
                        displayName: targetMsg.displayName || targetMsg.username,
                        text: targetMsg.text || (targetMsg.image ? '[画像]' : ''),
                        icon: targetMsg.icon || null
                    };
                }
            }

            const now = new Date();
            const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

            const newMessage = {
                id: Date.now().toString() + Math.floor(Math.random() * 1000),
                username: user.username,
                displayName: user.displayName || user.username,
                icon: user.icon || "",
                text: text,
                image: req.file ? '/images/chat/' + req.file.filename : null,
                to: toUser,
                system: systemNotice,
                time: timeStr,
                timestamp: Date.now(),
                readBy: [],
                replyTo: replyToData
            };
            
            messages.push(newMessage);
            writeMessages(messages);
            res.json({ success: true, message: newMessage });
        });

        // 送信取り消し
        app.delete('/api/messages/:id', (req, res) => {
            try {
                if (!req.session.user) return res.status(401).json({ success: false, message: "ログインが必要です" });
                
                const messages = readMessages();
                const msgIndex = messages.findIndex(m => String(m.id) === String(req.params.id));
                if (msgIndex === -1) return res.status(404).json({ success: false, message: "見つかりません" });

                const accounts = readAccounts();
                const me = accounts.find(a => a.username === req.session.user.username);
                if (messages[msgIndex].username !== req.session.user.username && (!me || me.role !== 'admin')) {
                    return res.status(403).json({ success: false, message: "権限がありません" });
                }

                if (messages[msgIndex].image) {
                    const relativePath = messages[msgIndex].image.replace(/^\//, '');
                    const imgP = path.join(__dirname, '..', relativePath); 
                    if (fs.existsSync(imgP)) { 
                        try { fs.unlinkSync(imgP); } catch(e){ console.error("画像削除失敗:", e); } 
                    }
                }

                messages.splice(msgIndex, 1);
                writeMessages(messages);
                return res.json({ success: true });
            } catch (error) {
                console.error("サーバー内部エラー:", error);
                return res.status(500).json({ success: false, message: error.message });
            }
        });

    } else {
        // ==========================================
        // 【ブラウザ側原子】フロントエンド共通API & 制御
        // ==========================================
        window.API = {
            async get(url) {
                try { const r = await fetch(url, { credentials: 'include' }); return await r.json(); }
                catch (e) { return { success: false, message: '通信エラー' }; }
            },
            async post(url, data) {
                try {
                    const r = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data),
                        credentials: 'include'
                    });
                    return await r.json();
                } catch (e) { return { success: false, message: '通信エラー' }; }
            }
        };

        document.addEventListener('DOMContentLoaded', () => {
            const msgText = document.getElementById('msgText');
            const chatForm = document.getElementById('chatForm');
            if (msgText && chatForm) {
                msgText.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
                });
            }
            if (window.initChatCore) window.initChatCore();
        });
    }
})();