const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || process.env.port || 3000;

const ACCOUNT_FILE = path.join(__dirname, 'account.json');
const SESSION_FILE = path.join(__dirname, 'SessionID.json');
const MESSAGE_FILE = path.join(__dirname, 'message.json');
const CALENDAR_FILE = path.join(__dirname, 'calendar.json');
const ACTION_PLAN_FILE = path.join(__dirname, 'Action-plan.json'); // 改善案ファイル

const adminVerificationCodes = new Map();
const onlineUsersMap = new Map();

function generateAdminCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) result += '-';
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

const ICON_DIR = path.join(__dirname, 'images', 'icon');
const CHAT_DIR = path.join(__dirname, 'images', 'chat');
if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });
if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'icon') { cb(null, ICON_DIR); } else { cb(null, CHAT_DIR); }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        if (file.fieldname === 'icon') {
            cb(null, req.session.user.username + ext);
        } else {
            cb(null, 'chat-' + uniqueSuffix + ext);
        }
    }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const Store = session.Store;
class FileStore extends Store {
    constructor() { super(); }
    readSessions() {
        if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, JSON.stringify([]));
        try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) { return []; }
    }
    writeSessions(sessions) { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2)); }
    get(sid, callback) {
        const sessions = this.readSessions();
        const sess = sessions.find(s => s.sid === sid);
        if (!sess) return callback(null, null);
        if (sess.expires && new Date(sess.expires) < new Date()) {
            this.destroy(sid, () => callback(null, null));
        } else { callback(null, sess.data); }
    }
    set(sid, sessionData, callback) {
        const sessions = this.readSessions();
        const expires = sessionData.cookie && sessionData.cookie.expires ? sessionData.cookie.expires : null;
        const index = sessions.findIndex(s => s.sid === sid);
        const sessObj = { sid, data: sessionData, expires };
        if (index !== -1) { sessions[index] = sessObj; } else { sessions.push(sessObj); }
        this.writeSessions(sessions);
        callback(null);
    }
    destroy(sid, callback) {
        const sessions = this.readSessions();
        const filtered = sessions.filter(s => s.sid !== sid);
        this.writeSessions(filtered);
        callback(null);
    }
}

app.use(session({
    store: new FileStore(),
    secret: 'oms-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 60 * 1000 }
}));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.mail_user, pass: process.env.app_password }
});

function readAccounts() {
    if (!fs.existsSync(ACCOUNT_FILE)) fs.writeFileSync(ACCOUNT_FILE, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));
}
function writeAccounts(data) { fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(data, null, 2)); }

function readMessages() {
    if (!fs.existsSync(MESSAGE_FILE)) fs.writeFileSync(MESSAGE_FILE, JSON.stringify([]));
    try { return JSON.parse(fs.readFileSync(MESSAGE_FILE, 'utf8')); } catch (e) { return []; }
}
function writeMessages(data) { fs.writeFileSync(MESSAGE_FILE, JSON.stringify(data, null, 2)); }

function readEvents() {
    if (!fs.existsSync(CALENDAR_FILE)) fs.writeFileSync(CALENDAR_FILE, JSON.stringify([]));
    try { return JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8')); } catch (e) { return []; }
}
function writeEvents(data) { fs.writeFileSync(CALENDAR_FILE, JSON.stringify(data, null, 2)); }

// 改善案データファイル入出力関数
function readActionPlans() {
    if (!fs.existsSync(ACTION_PLAN_FILE)) fs.writeFileSync(ACTION_PLAN_FILE, JSON.stringify([]));
    try { return JSON.parse(fs.readFileSync(ACTION_PLAN_FILE, 'utf8')); } catch (e) { return []; }
}
function writeActionPlans(data) { fs.writeFileSync(ACTION_PLAN_FILE, JSON.stringify(data, null, 2)); }

global.omsConfig = {
    app, upload, transporter, readAccounts, writeAccounts, readMessages, writeMessages,
    adminVerificationCodes, generateAdminCode, loginRegex: /^[a-zA-Z0-9-]+$/
};

require('./js/login.js');
require('./js/chat.js');

function sendHtmlWithBeacon(res, filePath) {
    fs.readFile(filePath, 'utf8', (err, html) => {
        if (err) {
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            return res.status(404).send('Not Found');
        }
        const headRegex = /(<\/head>)/i;
        if (headRegex.test(html)) {
            html = html.replace(headRegex, '<script src="/js/check.js"></script></head>');
        } else {
            html = html.replace(/(<body[^>]*>)/i, '$1<script src="/js/check.js"></script>');
        }
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.send(html);
    });
}

// カレンダーAPI
app.get('/api/calendar/events', (req, res) => {
    res.json(readEvents());
});

app.post('/api/calendar/events', (req, res) => {
    const { date, title } = req.body;
    if (!date || !title) return res.sendStatus(400);
    const events = readEvents();
    events.push({ id: Date.now().toString(), date, title });
    writeEvents(events);
    res.sendStatus(201);
});

// オンラインチェックAPI
app.post('/api/online-check', (req, res) => {
    if (req.session && req.session.user) {
        const username = req.session.user.username || req.session.user.name;
        const pageTitle = req.body.pageTitle || '';
        const status = req.body.status || 'active';

        if (username) {
            const userKey = username.toLowerCase();
            if (status === 'close') {
                onlineUsersMap.delete(userKey);
            } else {
                onlineUsersMap.set(userKey, {
                    timestamp: Date.now(),
                    currentPage: pageTitle
                });
            }
        }
    }
    res.sendStatus(200);
});

// 新着メッセージ確認API (check.js から呼び出し)
app.get('/api/messages/check-new', (req, res) => {
    const lastId = req.query.lastId;
    const messages = readMessages();
    
    if (messages.length === 0) {
        return res.json({ success: true, lastId: '', newMessages: [] });
    }
    
    const latestId = messages[messages.length - 1].id;
    
    if (!lastId) {
        return res.json({ success: true, lastId: latestId, newMessages: [] });
    }
    
    const index = messages.findIndex(m => m.id === lastId);
    let newMsgs = [];
    
    if (index !== -1) {
        newMsgs = messages.slice(index + 1);
    } else {
        newMsgs = messages;
    }
    
    const myUsername = req.session?.user?.username;
    const filteredNewMsgs = newMsgs.filter(m => {
        if (myUsername && m.username === myUsername) return false;
        if (m.system === 'hidden') return false;
        if (m.to && m.to !== myUsername) return false;
        return true;
    });
    
    res.json({
        success: true,
        lastId: latestId,
        newMessages: filteredNewMsgs
    });
});

app.get('/api/online-users', (req, res) => {
    const now = Date.now();
    const accounts = readAccounts();
    
    const userStatusList = accounts.map(acc => {
        const sessionData = onlineUsersMap.get(acc.username.toLowerCase());
        const isOnline = sessionData !== undefined && (now - sessionData.timestamp < 15000);
        
        return {
            username: acc.username,
            displayName: acc.displayName,
            icon: acc.icon,
            role: acc.role,
            status: isOnline ? 'online' : 'offline',
            currentPage: isOnline ? sessionData.currentPage : ''
        };
    });
    
    res.json(userStatusList);
});

// ==========================================
// 改善案 (Action Plan) 関連API
// ==========================================

// 改善案送信 (一般ユーザー & 管理者可能)
app.post('/api/action-plan', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'ログインが必要です' });
    }
    
    const { requestText } = req.body;
    if (!requestText || requestText.trim() === '') {
        return res.status(400).json({ success: false, message: '要望内容を入力してください' });
    }

    const username = req.session.user.username;
    const plans = readActionPlans();

    // 改善案オブジェクトを作成して追加
    const newPlan = {
        id: Date.now().toString(),
        username: username,
        time: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        request: requestText.trim()
    };

    plans.push(newPlan);
    writeActionPlans(plans);

    res.json({ success: true, message: '改善案が送信されました。ありがとうございます！' });
});

// 改善案取得 (管理者専用)
app.get('/api/action-plan', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: '未ログイン' });
    }

    const accounts = readAccounts();
    const me = accounts.find(a => a.username.toLowerCase() === req.session.user.username.toLowerCase());
    
    if (!me || me.role !== 'admin') {
        return res.status(403).json({ success: false, message: '閲覧権限がありません' });
    }

    res.json({ success: true, plans: readActionPlans() });
});


// ==========================================
// 中継プロキシ設定 (js/proxy.js の呼び出し)
// ==========================================
const { proxyHandler } = require('./js/proxy.js');

// プロキシエンドポイント
app.get('/proxy', proxyHandler);


function isAdmin(req, res, next) {
    let currentRole = req.session?.user?.role;

    if (req.session && req.session.user) {
        const sessionUsername = req.session.user.username || req.session.user.name;
        if (sessionUsername) {
            const accounts = readAccounts();
            const currentAccount = accounts.find(a => a.username.toLowerCase() === sessionUsername.toLowerCase());
            if (currentAccount) {
                currentRole = currentAccount.role;
                req.session.user.role = currentAccount.role;
                req.session.user.username = currentAccount.username;
            }
        }
    }

    if (currentRole === 'admin') {
        return next();
    }
    sendHtmlWithBeacon(res.status(404), path.join(__dirname, 'public', '404.html'));
}

app.use((req, res, next) => {
    const ext = path.extname(req.path);
    const isHtmlRoute = !ext || req.path.endsWith('.html');
    
    if (req.method === 'GET' && isHtmlRoute) {
        let targetPath = '';
        
        if (req.path.startsWith('/admin')) {
            return isAdmin(req, res, () => {
                let subPath = req.path;
                if (subPath.endsWith('/') || !path.extname(subPath)) {
                    subPath = path.join(subPath, 'index.html');
                }
                targetPath = path.join(__dirname, 'public', subPath);
                
                fs.access(targetPath, fs.constants.F_OK, (err) => {
                    if (!err) {
                        sendHtmlWithBeacon(res, targetPath);
                    } else {
                        next();
                    }
                });
            });
        }
        
        let subPath = req.path;
        if (subPath === '/' || subPath === '') subPath = '/index.html';
        targetPath = path.join(__dirname, 'public', subPath);
        if (!path.extname(targetPath)) targetPath = path.join(targetPath, 'index.html');
        
        fs.access(targetPath, fs.constants.F_OK, (err) => {
            if (!err) {
                sendHtmlWithBeacon(res, targetPath);
            } else {
                next();
            }
        });
    } else {
        next();
    }
});

app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/js', express.static(path.join(__dirname, 'js')));

app.use((req, res) => {
    sendHtmlWithBeacon(res.status(404), path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));