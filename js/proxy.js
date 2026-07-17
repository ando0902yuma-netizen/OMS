// js/proxy.js
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

// 安全のためのホワイトリスト設定
const ALLOWED_DOMAINS = [];

function isValidTarget(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.startsWith('192.168.')) {
            return false;
        }
        if (ALLOWED_DOMAINS.length > 0) {
            return ALLOWED_DOMAINS.includes(parsed.hostname);
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 拡張子やURLパスから適切なMIMEタイプを判別・強制補正 (.gz や .br 等の圧縮アセットも補正)
 */
function getMimeType(urlStr, defaultType) {
    try {
        const urlObj = new URL(urlStr);
        const pathname = urlObj.pathname.toLowerCase();

        if (pathname.endsWith('.wasm') || pathname.endsWith('.wasm.gz') || pathname.endsWith('.wasm.br')) {
            return 'application/wasm';
        }
        if (pathname.endsWith('.data') || pathname.endsWith('.data.gz') || pathname.endsWith('.data.br') || pathname.endsWith('.unityweb')) {
            return 'application/octet-stream';
        }
        if (pathname.endsWith('.js') || pathname.endsWith('.js.gz') || pathname.endsWith('.js.br') || pathname.endsWith('.loader.js') || pathname.endsWith('.framework.js.gz')) {
            return 'application/javascript';
        }
        if (pathname.endsWith('.json')) return 'application/json';
        if (pathname.endsWith('.css')) return 'text/css';
        if (pathname.endsWith('.ico')) return 'image/x-icon';

        if (pathname.includes('/js/') || pathname.endsWith('cc.php')) {
            return 'application/javascript';
        }
    } catch (e) {}
    return defaultType;
}

async function proxyHandler(req, res) {
    const { l, m } = req.query;
    const mode = m ? parseInt(m, 10) : 0;

    if (!l) {
        return res.status(400).send('Missing target URL (l parameter)');
    }

    let targetUrl;
    try {
        targetUrl = Buffer.from(l, 'base64').toString('utf-8');
    } catch (err) {
        console.error(`\x1b[31m[Proxy] Base64デコード失敗: ${l}\x1b[0m`);
        return res.status(400).send('Invalid Base64 encoding');
    }

    // 1. 通信開始ログ
    console.log(`\x1b[36m[Proxy] 通信開始: ${targetUrl} (Mode: ${mode})\x1b[0m`);

    // 広告や分析スクリプトはクライアント到達前に即座にブロック
    if (targetUrl.includes('googlesyndication.com') || targetUrl.includes('doubleclick.net') || targetUrl.includes('google-analytics.com')) {
        console.log(`\x1b[33m[Proxy] 広告/分析ブロック (空データを返却): ${targetUrl}\x1b[0m`);
        res.set('Content-Type', 'application/javascript');
        return res.send('// Blocked by Proxy');
    }

    if (!isValidTarget(targetUrl)) {
        console.warn(`\x1b[31m[Proxy] 接続不許可 (プライベートIP等): ${targetUrl}\x1b[0m`);
        return res.status(403).send('Forbidden: Target URL is not allowed');
    }

    try {
        const parsedUrl = new URL(targetUrl);
        const pathname = parsedUrl.pathname.toLowerCase();

        // 100%書き換えの必要がない静的バイナリ・Unity圧縮ファイル群 (ストリーム転送)
        const isStaticAsset = pathname.endsWith('.wasm') || pathname.endsWith('.wasm.gz') || pathname.endsWith('.wasm.br') ||
                              pathname.endsWith('.data') || pathname.endsWith('.data.gz') || pathname.endsWith('.data.br') ||
                              pathname.endsWith('.js.gz') || pathname.endsWith('.js.br') || pathname.endsWith('.unityweb') ||
                              pathname.endsWith('.loader.js') || pathname.endsWith('.framework.js.gz') ||
                              pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || 
                              pathname.endsWith('.gif') || pathname.endsWith('.mp3') || pathname.endsWith('.wav') || 
                              pathname.endsWith('.ogg') || pathname.endsWith('.ico');

        if (isStaticAsset) {
            console.log(`\x1b[35m[Proxy] 静的ファイル・ストリーム転送開始: ${targetUrl}\x1b[0m`);
            
            const responseStream = await axios({
                method: 'get',
                url: targetUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                    'Accept-Encoding': req.headers['accept-encoding'] || 'gzip, deflate, br'
                },
                decompress: false, // バイナリのまま中継するため自動解凍は無効化
                validateStatus: () => true
            });

            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.set('Access-Control-Allow-Headers', '*');
            
            let contentType = responseStream.headers['content-type'] || '';
            contentType = getMimeType(targetUrl, contentType);
            res.set('Content-Type', contentType);

            // 元の圧縮状態をそのままブラウザに伝える
            if (responseStream.headers['content-encoding']) {
                res.set('Content-Encoding', responseStream.headers['content-encoding']);
            } else if (pathname.endsWith('.gz')) {
                res.set('Content-Encoding', 'gzip');
            } else if (pathname.endsWith('.br')) {
                res.set('Content-Encoding', 'br');
            }

            if (responseStream.headers['content-length']) {
                res.set('Content-Length', responseStream.headers['content-length']);
            }

            responseStream.data.pipe(res);

            responseStream.data.on('end', () => {
                console.log(`\x1b[32m[Proxy] ストリーム転送完了: ${targetUrl}\x1b[0m`);
            });

            responseStream.data.on('error', (err) => {
                console.error(`\x1b[31m[Proxy] ストリーム転送中にエラー: ${targetUrl} -> ${err.message}\x1b[0m`);
            });
            return;
        }

        // --- HTML / CSS / JS などのテキスト書き換え対象のロード ---
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                'Accept-Encoding': req.headers['accept-encoding'] || 'gzip, deflate, br'
            },
            decompress: true, // 重要: 解析・書き換えのためにプロキシサーバー側で完全に解凍する
            validateStatus: () => true
        });

        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.set('Access-Control-Allow-Headers', '*');

        let contentType = response.headers['content-type'] || '';
        contentType = getMimeType(targetUrl, contentType);
        res.set('Content-Type', contentType);

        // ※ サーバー側で自動解凍（decompress: true）しているため、
        // レンスポンスヘッダーからは「Content-Encoding」を削除し、ブラウザでの重複解凍エラーを防ぎます。
        res.removeHeader('Content-Encoding');

        const responseData = Buffer.from(response.data);
        const rawText = responseData.toString('utf-8').trim();

        // --- CSSファイルのインライン URL 書き換え ---
        if (contentType.includes('text/css')) {
            console.log(`\x1b[34m[Proxy] CSS解析・書き換え開始: ${targetUrl}\x1b[0m`);
            let cssText = rawText;
            cssText = cssText.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, pathVal) => {
                if (pathVal.startsWith('data:')) return match;
                try {
                    const absolute = new URL(pathVal, targetUrl).href;
                    const b64 = Buffer.from(absolute).toString('base64');
                    return `url("/proxy?l=${b64}&m=${mode}")`;
                } catch (e) {
                    return match;
                }
            });
            console.log(`\x1b[32m[Proxy] CSS書き換え完了・送信: ${targetUrl} (${cssText.length} bytes)\x1b[0m`);
            return res.send(cssText);
        }

        // --- HTMLファイルの書き換え ---
        const isActuallyHtml = rawText.startsWith('<') || rawText.toLowerCase().startsWith('<!doctype');
        if (contentType.includes('text/html') && isActuallyHtml) {
            console.log(`\x1b[34m[Proxy] HTML解析・書き換え開始: ${targetUrl}\x1b[0m`);
            const $ = cheerio.load(rawText);

            const makeProxyUrl = (originalPath, currentMode) => {
                try {
                    const absoluteUrl = new URL(originalPath, targetUrl).href;
                    const base64Url = Buffer.from(absoluteUrl).toString('base64');
                    return `/proxy?l=${base64Url}&m=${currentMode}`;
                } catch (e) {
                    return originalPath;
                }
            };

            $('base').remove();

            if (mode === 1) {
                $('a').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href) {
                        try { $(el).attr('href', new URL(href, targetUrl).href); } catch (e) {}
                    }
                });
            } else {
                $('a').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href) $(el).attr('href', makeProxyUrl(href, 0));
                });
            }

            const targetMode = mode === 1 ? 1 : 0;
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src) $(el).attr('src', makeProxyUrl(src, targetMode));
            });
            $('link[rel="stylesheet"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href) $(el).attr('href', makeProxyUrl(href, targetMode));
            });
            $('script').each((i, el) => {
                const src = $(el).attr('src');
                if (src) $(el).attr('src', makeProxyUrl(src, targetMode));
            });

            $('link[rel*="icon"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href) $(el).attr('href', makeProxyUrl(href, targetMode));
            });

            // フロントエンド用オートプレイ解決・自動再開＆リソースプロキシスクリプト
            const injection = `
                <script>
                (function() {
                    const targetUrlBase = "${targetUrl}";
                    const mode = ${targetMode};

                    function toProxyUrl(inputUrl) {
                        if (!inputUrl) return inputUrl;
                        try {
                            const urlStr = String(inputUrl).trim();
                            // すでにプロキシを通っているもの、ローカルデータ(blob:, data:)、Unityの内部アセット生成(unity3d等)は一切書き換えない
                            if (urlStr.startsWith('/proxy') || 
                                urlStr.includes(window.location.host + '/proxy') || 
                                urlStr.startsWith('blob:') || 
                                urlStr.startsWith('data:') ||
                                urlStr.endsWith('.unity3d') ||
                                urlStr.includes('blob')
                            ) {
                                return inputUrl;
                            }
                            
                            if (urlStr.includes('googlesyndication.com') || urlStr.includes('doubleclick.net')) {
                                return 'data:text/javascript;base64,Ly8=';
                            }
                            
                            const absolute = new URL(urlStr, targetUrlBase).href;
                            const b64 = btoa(unescape(encodeURIComponent(absolute)));
                            return "/proxy?l=" + b64 + "&m=" + mode;
                        } catch(e) {
                            return inputUrl;
                        }
                    }

                    // 1. Fetch API
                    const originalFetch = window.fetch;
                    window.fetch = function(input, init) {
                        if (typeof input === 'string') {
                            input = toProxyUrl(input);
                        } else if (input && typeof input.url === 'string') {
                            input = new Request(toProxyUrl(input.url), input);
                        }
                        return originalFetch(input, init);
                    };

                    // 2. XHR
                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...args) {
                        if (typeof url === 'string') {
                            url = toProxyUrl(url);
                        }
                        return originalOpen.call(this, method, url, ...args);
                    };

                    // 3. document.write
                    const originalWrite = document.write;
                    document.write = function(content) {
                        if (typeof content === 'string') {
                            content = content.replace(/(src|href)=["']([^"']+)["']/g, function(match, attr, val) {
                                return attr + '="' + toProxyUrl(val) + '"';
                            });
                        }
                        return originalWrite.call(document, content);
                    };

                    // 4. createElement
                    const originalCreateElement = document.createElement;
                    document.createElement = function(tagName, ...args) {
                        const el = originalCreateElement.call(document, tagName, ...args);
                        const tag = tagName.toLowerCase();
                        if (tag === 'script' || tag === 'link' || tag === 'img') {
                            const originalSetAttribute = el.setAttribute;
                            el.setAttribute = function(name, value) {
                                if ((name === 'src' || name === 'href') && value) {
                                    value = toProxyUrl(value);
                                }
                                return originalSetAttribute.call(this, name, value);
                            };
                            Object.defineProperty(el, 'src', {
                                get: function() { return el.getAttribute('src'); },
                                set: function(val) { el.setAttribute('src', val); }
                            });
                            Object.defineProperty(el, 'href', {
                                get: function() { return el.getAttribute('href'); },
                                set: function(val) { el.setAttribute('href', val); }
                            });
                        }
                        return el;
                    };

                    // 5. AudioContextの自動解決
                    const activeContexts = [];
                    const RawAudioContext = window.AudioContext || window.webkitAudioContext;
                    if (RawAudioContext) {
                        const HookedAudioContext = function(...args) {
                            const ctx = new RawAudioContext(...args);
                            activeContexts.push(ctx);
                            
                            return ctx;
                        };
                        HookedAudioContext.prototype = RawAudioContext.prototype;
                        if (window.AudioContext) window.AudioContext = HookedAudioContext;
                        if (window.webkitAudioContext) window.webkitAudioContext = HookedAudioContext;
                    }

                    function unlockAudio() {
                        const resumeAll = () => {
                            activeContexts.forEach(ctx => {
                                if (ctx && ctx.state === 'suspended') {
                                    ctx.resume().catch(() => {});
                                }
                            });
                        };
                        window.addEventListener('click', resumeAll, { once: true });
                        window.addEventListener('touchend', resumeAll, { once: true });
                        window.addEventListener('keydown', resumeAll, { once: true });
                        resumeAll();
                    }

                    document.addEventListener('DOMContentLoaded', unlockAudio);
                })();
                </script>
            `;

            const head = $('head');
            if (head.length > 0) {
                head.prepend(injection);
            } else {
                $('html').prepend(injection);
            }

            const htmlOutput = $.html();
            console.log(`\x1b[32m[Proxy] HTML書き換え完了・送信: ${targetUrl} (${htmlOutput.length} bytes)\x1b[0m`);
            return res.send(htmlOutput);
        }

        console.log(`\x1b[32m[Proxy] 生データ（書き換えなし）送信: ${targetUrl} (Type: ${contentType}, Size: ${responseData.length} bytes)\x1b[0m`);
        return res.send(responseData);

    } catch (error) {
        console.error(`\x1b[31m[Proxy] エラー発生: ${targetUrl} -> ${error.message}\x1b[0m`);
        return res.status(500).send('Proxy error occurred');
    }
}

module.exports = { proxyHandler };