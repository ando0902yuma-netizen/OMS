(function() {
    const isNode = typeof module !== 'undefined' && module.exports;

    if (isNode) {
        // ==========================================
        // 【サーバー側原子】APIエンドポイント定義
        // ==========================================
        const { app, upload, transporter, readAccounts, writeAccounts, loginRegex } = global.omsConfig;

        // 共通セッションAPI
        app.get('/api/me', (req, res) => {
            if (!req.session.user) return res.status(401).json({ success: false, message: '未ログイン' });
            const accounts = readAccounts();
            const user = accounts.find(a => a.username === req.session.user.username);
            if (!user) return res.status(401).json({ success: false, message: 'ユーザーが存在しません' });
            res.json({ 
                success: true, 
                user: { 
                    username: user.username, 
                    email: user.email, 
                    displayName: user.displayName || user.username,
                    icon: user.icon || "",
                    role: user.role || "user"
                } 
            });
        });

        // ログアウト
        app.post('/api/logout', (req, res) => {
            req.session.destroy(() => res.json({ success: true }));
        });

        // メール送信付きアカウント仮作成
        app.post('/api/signup/verify', async (req, res) => {
            const { username, email, password } = req.body;
            if (!username || !email || !password) return res.status(400).json({ success: false, message: '入力が足りません' });
            if (!loginRegex.test(username) || !loginRegex.test(password)) return res.status(400).json({ success: false, message: '英数字とハイフンのみ' });
            
            const accounts = readAccounts();
            if (accounts.find(a => a.username === username || a.email === email)) return res.status(400).json({ success: false, message: '既に使用されています' });

            const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
            req.session.tempUser = { username, email, password, verifyCode };

            const emailHtml = `
            <div style="background-color: #0f172a; padding: 40px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; text-align: center; color: #f1f5f9;">
                <div style="max-width: 500px; margin: 0 auto; background-color: #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); border: 1px solid #334155;">
                    <div style="margin-bottom: 24px;">
                        <span style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; padding: 8px 24px; border-radius: 9999px; font-size: 22px; font-weight: 800; letter-spacing: 2px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">OMS SERVICE</span>
                    </div>
                    <div style="height: 1px; background: linear-gradient(90deg, transparent, #475569, transparent); margin-bottom: 24px;"></div>
                    <p style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin: 0 0 16px 0;">アカウント作成のリクエストを受け付けました。<br>登録を完了するには、下記の認証コードを入力してください。</p>
                    <div style="margin: 32px 0; padding: 20px; background-color: #0f172a; border-radius: 12px; border: 1px solid #475569; letter-spacing: 6px;">
                        <span style="font-size: 36px; font-weight: 700; color: #3b82f6; font-family: 'Courier New', Courier, monospace;">${verifyCode}</span>
                    </div>
                    <p style="font-size: 12px; color: #64748b; margin: 24px 0 0 0; line-height: 1.5;">※このコードの有効期限は30分間です。<br>心当たりがない場合は、このメールを破棄してください。</p>
                </div>
                <div style="margin-top: 24px; font-size: 11px; color: #475569;">&copy; 2026 OMS Service. All rights reserved.</div>
            </div>`;

            try {
                await transporter.sendMail({
                    from: `"OMS Service" <${process.env.mail_user}>`,
                    to: email,
                    subject: '【OMS】アカウント認証コード',
                    html: emailHtml
                });
                res.json({ success: true, message: '認証コードを送信しました。' });
            } catch (error) { res.status(500).json({ success: false, message: 'メール送信失敗' }); }
        });

        // 認証コード確認・アカウント本登録
        app.post('/api/signup/confirm', (req, res) => {
            const { code } = req.body;
            const temp = req.session.tempUser;
            if (!temp || temp.verifyCode !== code) return res.status(400).json({ success: false, message: '無効なコードです' });

            const accounts = readAccounts();
            accounts.push({ 
                username: temp.username, 
                email: temp.email, 
                password: temp.password,
                displayName: temp.username,
                icon: "",
                role: "user" 
            });
            writeAccounts(accounts);
            delete req.session.tempUser;
            res.json({ success: true, message: '登録完了！' });
        });

        // ログイン
        app.post('/api/login', (req, res) => {
            const { loginId, password } = req.body;
            const accounts = readAccounts();
            const user = accounts.find(a => (a.username === loginId || a.email === loginId) && a.password === password);
            if (!user) return res.status(401).json({ success: false, message: '認証失敗' });

            req.session.user = { username: user.username, email: user.email };
            res.json({ success: true });
        });

        // 表示名更新
        app.post('/api/user/update', (req, res) => {
            if (!req.session.user) return res.status(401).json({ success: false, message: '未ログイン' });
            const { displayName } = req.body;
            if (!displayName || !displayName.trim()) return res.status(400).json({ success: false, message: '表示名が空です' });

            const accounts = readAccounts();
            const index = accounts.findIndex(a => a.username === req.session.user.username);
            if (index === -1) return res.status(404).json({ success: false, message: 'ユーザーが見つかりません' });

            accounts[index].displayName = displayName;
            writeAccounts(accounts);
            res.json({ success: true, message: 'プロフィールを更新しました' });
        });

        // アイコン変更
        app.post('/api/user/icon', upload.single('icon'), (req, res) => {
            if (!req.session.user) return res.status(401).json({ success: false, message: '未ログイン' });
            if (!req.file) return res.status(400).json({ success: false, message: 'ファイルがありません' });

            const accounts = readAccounts();
            const index = accounts.findIndex(a => a.username === req.session.user.username);
            
            const iconPath = '/images/icon/' + req.file.filename;
            accounts[index].icon = iconPath;
            writeAccounts(accounts);

            res.json({ success: true, icon: iconPath });
        });

    } else {
        // ==========================================
        // 【ブラウザ側原子】フロントエンド画面制御
        // ==========================================
        document.addEventListener('DOMContentLoaded', async () => {
            // ログイン画面
            const loginForm = document.getElementById('loginForm');
            if (loginForm) {
                loginForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const loginId = document.getElementById('loginId').value;
                    const password = document.getElementById('password').value;
                    const res = await window.API.post('/api/login', { loginId, password });
                    if (res.success) { window.location.href = '/index.html'; } else { alert(res.message || 'ログインに失敗しました'); }
                });
            }

            // アカウント作成・コード認証
            const registerForm = document.getElementById('registerForm');
            const verifyForm = document.getElementById('verifyForm');
            if (registerForm) {
                registerForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const username = document.getElementById('username').value;
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    const res = await window.API.post('/api/signup/verify', { username, email, password });
                    if (res.success) {
                        alert(res.message);
                        registerForm.style.display = 'none';
                        if (verifyForm) verifyForm.style.display = 'flex';
                    } else { alert(res.message || '認証コードの送信に失敗しました'); }
                });
            }
            if (verifyForm) {
                verifyForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const code = document.getElementById('verifyCode').value;
                    const res = await window.API.post('/api/signup/confirm', { code });
                    if (res.success) { alert(res.message); window.location.href = '/account/login.html'; } else { alert(res.message || '認証に失敗しました'); }
                });
            }

            // マイデータ
            const myDataContainer = document.getElementById('myDataContainer');
            if (myDataContainer) {
                const res = await window.API.get('/api/me');
                if (res.success) {
                    const myAvatarArea = document.getElementById('myAvatarArea');
                    const myUsernameEl = document.getElementById('myUsername');
                    const myEmailEl = document.getElementById('myEmail');
                    const displayNameInput = document.getElementById('displayName');

                    if (myAvatarArea) {
                        if (res.user.icon) { myAvatarArea.innerHTML = `<img src="${res.user.icon}?t=${Date.now()}" class="icon-img" alt="Avatar">`; }
                        else { myAvatarArea.innerHTML = `<div class="icon-circle">${res.user.username.charAt(0).toUpperCase()}</div>`; }
                    }
                    if (myUsernameEl) myUsernameEl.innerText = res.user.username;
                    if (myEmailEl) myEmailEl.innerText = res.user.email;
                    if (displayNameInput) displayNameInput.value = res.user.displayName;
                } else { window.location.href = '/account/login.html'; }

                document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const displayName = document.getElementById('displayName').value;
                    const r = await window.API.post('/api/user/update', { displayName });
                    alert(r.message); if (r.success) window.location.reload();
                });

                document.getElementById('iconInput')?.addEventListener('change', async (e) => {
                    const file = e.target.files[0]; if (!file) return;
                    const formData = new FormData(); formData.append('icon', file);
                    try {
                        const response = await fetch('/api/user/icon', { method: 'POST', body: formData, credentials: 'include' });
                        const result = await response.json();
                        if (result.success) { alert('アイコンを変更しました'); window.location.reload(); } else { alert(result.message); }
                    } catch (err) { alert('通信エラー'); }
                });

                document.getElementById('btnLogout')?.addEventListener('click', async () => {
                    const r = await window.API.post('/api/logout'); if (r.success) window.location.href = '/account/login.html';
                });
            }
        });
    }
})();