// server.js – Professional Cloaking Bot
// Features: OS/browser/country filters, daily clicks limit, VPN block, white page (URL or AI multi-file), detailed stats, all bot commands
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

// ---------- Database Setup ----------
const db = new sqlite3.Database(path.join(__dirname, 'cloaking.db'));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        telegram_id TEXT UNIQUE,
        plan TEXT DEFAULT 'free',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        name TEXT,
        offer_url TEXT,
        white_type TEXT DEFAULT 'ai',
        white_value TEXT,
        white_zip TEXT,
        allowed_os TEXT,
        allowed_browsers TEXT,
        allowed_countries TEXT,
        clicks_per_day INTEGER DEFAULT 15,
        block_vpn INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT,
        ip TEXT,
        user_agent TEXT,
        decision TEXT,
        country TEXT,
        isp TEXT,
        device TEXT,
        os TEXT,
        browser TEXT,
        referrer TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS temp_sessions (
        telegram_id TEXT PRIMARY KEY,
        step TEXT,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ---------- Express App ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'default', resave: false, saveUninitialized: false }));
app.use(express.static('public'));

// ---------- Helper: AI White Page – generates multi-file zip ----------
async function generateWhitePageHTML(niche) {
    const prompt = `Generate a complete, modern, legitimate-looking multi-page website HTML for the niche: "${niche}". Include inline CSS for a professional look. Add a header, main content, call-to-action button, and footer. Make it look like a real business site. Return ONLY the HTML code (starting with <!DOCTYPE html>).`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        const response = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] });
        let html = response.data.candidates[0].content.parts[0].text;
        html = html.replace(/```html/g, '').replace(/```/g, '');
        return html;
    } catch (err) {
        console.error('AI error:', err.message);
        return `<!DOCTYPE html><html><head><title>${niche}</title><style>body{font-family:Arial;text-align:center;padding:50px}</style></head><body><h1>${niche}</h1><p>Your white page</p></body></html>`;
    }
}

async function generateMultiFileWhitePage(niche) {
    const html = await generateWhitePageHTML(niche);
    const tempDir = path.join(__dirname, 'temp', crypto.randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'index.html'), html);
    // Additional files to look legit
    fs.writeFileSync(path.join(tempDir, 'style.css'), `body { font-family: Arial; margin: 0; padding: 20px; background: #f5f5f5; } .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 8px; } .button { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }`);
    fs.writeFileSync(path.join(tempDir, 'script.js'), `console.log("White page loaded"); document.addEventListener('DOMContentLoaded', function() { document.querySelector('.button')?.addEventListener('click', function(e) { e.preventDefault(); alert('Demo'); }); });`);
    const imgBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    fs.writeFileSync(path.join(tempDir, 'pixel.gif'), Buffer.from(imgBase64, 'base64'));
    fs.writeFileSync(path.join(tempDir, 'about.html'), '<html><body><h1>About Us</h1><p>This is a demo site.</p><a href="index.html">Home</a></body></html>');
    fs.writeFileSync(path.join(tempDir, 'contact.html'), '<html><body><h1>Contact</h1><p>Email: demo@example.com</p><a href="index.html">Home</a></body></html>');
    
    const zipPath = path.join(__dirname, 'white_zips', `${crypto.randomUUID()}.zip`);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();
    fs.rmSync(tempDir, { recursive: true, force: true });
    return zipPath;
}

// ---------- Helper: Generate index.php (Full cloaking script) ----------
function generateIndexPHP(campaign) {
    const { id, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn } = campaign;
    const allowedOsArray = allowed_os ? allowed_os.split(',').map(s => s.trim()) : [];
    const allowedBrowsersArray = allowed_browsers ? allowed_browsers.split(',').map(s => s.trim()) : [];
    const allowedCountriesArray = allowed_countries ? allowed_countries.split(',').map(s => s.trim().toUpperCase()) : [];
    
    return `<?php
// Professional Cloaking Script – Campaign: ${id}
$api_url = "https://${process.env.DOMAIN}/api/track";
$campaign_id = "${id}";
$offer_url = "${offer_url}";
$white_type = "${white_type}";
$white_value = str_replace("'", "\\'", "${white_value}");
$white_zip = "${white_zip || ''}";
$clicks_per_day_limit = ${clicks_per_day ?? 15};
$block_vpn = ${block_vpn ? 1 : 0};
$allowed_os = ["${allowedOsArray.join('","')}"];
$allowed_browsers = ["${allowedBrowsersArray.join('","')}"];
$allowed_countries = ["${allowedCountriesArray.join('","')}"];

function getUserIP() {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) return $_SERVER['HTTP_CLIENT_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return $_SERVER['HTTP_X_FORWARDED_FOR'];
    return $_SERVER['REMOTE_ADDR'];
}

function getISPandLocation($ip) {
    $url = "http://ip-api.com/json/{$ip}?fields=status,country,isp,proxy";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 2);
    $response = curl_exec($ch);
    curl_close($ch);
    if ($response) {
        $data = json_decode($response, true);
        if ($data && $data['status'] == 'success') return $data;
    }
    return ['country' => 'Unknown', 'isp' => 'Unknown', 'proxy' => false];
}

function getDeviceInfo($ua) {
    $device = 'Unknown'; $os = 'Unknown'; $browser = 'Unknown';
    if (preg_match('/iPhone|iPad|iPod/i', $ua)) $device = 'iOS';
    elseif (preg_match('/Android/i', $ua)) $device = 'Android';
    elseif (preg_match('/Windows Phone/i', $ua)) $device = 'Windows Phone';
    elseif (preg_match('/Windows/i', $ua)) $device = 'Windows';
    elseif (preg_match('/Mac/i', $ua)) $device = 'Mac';
    elseif (preg_match('/Linux/i', $ua)) $device = 'Linux';
    
    if (preg_match('/Windows NT 10.0/i', $ua)) $os = 'Windows 10';
    elseif (preg_match('/Mac OS X/i', $ua)) $os = 'macOS';
    elseif (preg_match('/Android/i', $ua)) $os = 'Android';
    elseif (preg_match('/iPhone OS/i', $ua)) $os = 'iOS';
    
    if (preg_match('/Edg/i', $ua)) $browser = 'Edge';
    elseif (preg_match('/Chrome/i', $ua)) $browser = 'Chrome';
    elseif (preg_match('/Firefox/i', $ua)) $browser = 'Firefox';
    elseif (preg_match('/Safari/i', $ua)) $browser = 'Safari';
    elseif (preg_match('/Opera/i', $ua)) $browser = 'Opera';
    return ['device' => $device, 'os' => $os, 'browser' => $browser];
}

function getTodayClicks($ip, $campaign_id) {
    $file = sys_get_temp_dir() . "/cloak_{$campaign_id}_{$ip}.json";
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true);
        if ($data && $data['date'] == date('Y-m-d')) return $data['count'];
    }
    return 0;
}

function incrementTodayClicks($ip, $campaign_id) {
    $file = sys_get_temp_dir() . "/cloak_{$campaign_id}_{$ip}.json";
    $count = getTodayClicks($ip, $campaign_id);
    $count++;
    file_put_contents($file, json_encode(['date' => date('Y-m-d'), 'count' => $count]));
}

$ip = getUserIP();
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$referrer = $_SERVER['HTTP_REFERER'] ?? '';

$ip_info = getISPandLocation($ip);
$device_info = getDeviceInfo($ua);
$today_clicks = getTodayClicks($ip, $campaign_id);

$show_offer = true;
if ($today_clicks >= $clicks_per_day_limit) $show_offer = false;
if ($block_vpn && ($ip_info['proxy'] || stripos($ip_info['isp'], 'vpn') !== false)) $show_offer = false;
if (!empty($allowed_os) && !in_array($device_info['os'], $allowed_os)) $show_offer = false;
if (!empty($allowed_browsers) && !in_array($device_info['browser'], $allowed_browsers)) $show_offer = false;
if (!empty($allowed_countries) && !in_array($ip_info['country'], $allowed_countries)) $show_offer = false;

if ($show_offer) incrementTodayClicks($ip, $campaign_id);

$track_data = [
    'campaign_id' => $campaign_id,
    'ip' => $ip,
    'user_agent' => $ua,
    'decision' => $show_offer ? 'main' : 'white',
    'country' => $ip_info['country'],
    'isp' => $ip_info['isp'],
    'device' => $device_info['device'],
    'os' => $device_info['os'],
    'browser' => $device_info['browser'],
    'referrer' => $referrer
];
$ch = curl_init($api_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($track_data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 2);
curl_exec($ch);
curl_close($ch);

if ($show_offer) {
    header("Location: $offer_url");
    exit;
} else {
    if ($white_type == 'url') {
        header("Location: $white_value");
        exit;
    } else {
        if ($white_zip && file_exists($white_zip)) {
            $zip = new ZipArchive();
            if ($zip->open($white_zip) === TRUE) {
                $uri = $_SERVER['REQUEST_URI'];
                if ($uri == '/' || $uri == '/index.html') {
                    header('Content-Type: text/html');
                    echo $zip->getFromName('index.html');
                } elseif ($uri == '/style.css') {
                    header('Content-Type: text/css');
                    echo $zip->getFromName('style.css');
                } elseif ($uri == '/script.js') {
                    header('Content-Type: application/javascript');
                    echo $zip->getFromName('script.js');
                } elseif ($uri == '/about.html') {
                    echo $zip->getFromName('about.html');
                } elseif ($uri == '/contact.html') {
                    echo $zip->getFromName('contact.html');
                } elseif ($uri == '/pixel.gif') {
                    header('Content-Type: image/gif');
                    echo $zip->getFromName('pixel.gif');
                } else {
                    echo $zip->getFromName('index.html');
                }
                $zip->close();
                exit;
            }
        }
        echo $white_value;
    }
}
?>`;
}

// ---------- Auth Middleware ----------
const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token && !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default');
            req.userId = decoded.id;
        } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
    } else {
        req.userId = req.session.userId;
    }
    next();
};

// ---------- API Routes ----------
app.post('/api/register', async (req, res) => {
    const { email, password, telegram_id } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const hashed = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, telegram_id) VALUES (?, ?, ?)`, [email, hashed, telegram_id || null], function(err) {
        if (err) return res.status(400).json({ error: 'Email/Telegram exists' });
        res.json({ success: true });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid' });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'default');
        req.session.userId = user.id;
        res.json({ token, user: { id: user.id, email: user.email, telegram_id: user.telegram_id } });
    });
});

app.post('/api/campaigns', auth, async (req, res) => {
    const { name, offer_url, white_type, white_value, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn } = req.body;
    if (!name || !offer_url) return res.status(400).json({ error: 'Missing name/offer' });
    const id = crypto.randomUUID();
    let whiteZip = null;
    let finalWhiteValue = white_value;
    if (white_type === 'ai') {
        whiteZip = await generateMultiFileWhitePage(white_value);
        finalWhiteValue = ''; // stored separately
    }
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, offer_url, white_type, finalWhiteValue, whiteZip, allowed_os || null, allowed_browsers || null, allowed_countries || null, clicks_per_day || 15, block_vpn ? 1 : 0], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
    });
});

app.get('/api/campaigns', auth, (req, res) => {
    db.all(`SELECT id, name, offer_url, white_type, created_at FROM campaigns WHERE user_id = ?`, [req.userId], (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/campaigns/:id/stats', auth, (req, res) => {
    const campaignId = req.params.id;
    db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [campaignId], (err, row) => {
        res.json(row || { main: 0, white: 0 });
    });
});

app.get('/api/campaigns/:id/detailed_stats', auth, (req, res) => {
    const campaignId = req.params.id;
    db.all(`SELECT decision, country, device, os, browser FROM stats WHERE campaign_id = ?`, [campaignId], (err, rows) => {
        if (err) return res.json({ error: err.message });
        const stats = { main: 0, white: 0, by_country: {}, by_device: {}, by_os: {}, by_browser: {} };
        rows.forEach(row => {
            if (row.decision === 'main') stats.main++; else stats.white++;
            if (row.country) stats.by_country[row.country] = (stats.by_country[row.country] || 0) + 1;
            if (row.device) stats.by_device[row.device] = (stats.by_device[row.device] || 0) + 1;
            if (row.os) stats.by_os[row.os] = (stats.by_os[row.os] || 0) + 1;
            if (row.browser) stats.by_browser[row.browser] = (stats.by_browser[row.browser] || 0) + 1;
        });
        res.json(stats);
    });
});

app.get('/api/campaigns/:id/download', auth, (req, res) => {
    const campaignId = req.params.id;
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [campaignId, req.userId], (err, campaign) => {
        if (!campaign) return res.status(404).json({ error: 'Not found' });
        const phpCode = generateIndexPHP(campaign);
        res.setHeader('Content-Disposition', `attachment; filename="cloak_${campaignId}.php"`);
        res.setHeader('Content-Type', 'application/x-httpd-php');
        res.send(phpCode);
    });
});

app.post('/api/track', (req, res) => {
    const { campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer } = req.body;
    db.run(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer], (err) => {
        res.json({ ok: true });
    });
});

// ---------- Telegram Bot ----------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Helper functions for bot
async function getTempSession(telegramId) {
    return new Promise((resolve) => {
        db.get(`SELECT step, data FROM temp_sessions WHERE telegram_id = ?`, [telegramId], (err, row) => {
            if (row) resolve({ step: row.step, data: row.data ? JSON.parse(row.data) : {} });
            else resolve({ step: null, data: {} });
        });
    });
}
async function setTempSession(telegramId, step, data = {}) {
    db.run(`INSERT OR REPLACE INTO temp_sessions (telegram_id, step, data) VALUES (?, ?, ?)`, [telegramId, step, JSON.stringify(data)]);
}
async function clearTempSession(telegramId) {
    db.run(`DELETE FROM temp_sessions WHERE telegram_id = ?`, [telegramId]);
}
async function getUserIdByTelegram(telegramId) {
    return new Promise((resolve) => {
        db.get(`SELECT id FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => resolve(row ? row.id : null));
    });
}
async function createUser(email, password, telegramId) {
    const hashed = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO users (email, password, telegram_id) VALUES (?, ?, ?)`, [email, hashed, telegramId], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

// Command: /download <id>
bot.command('download', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /download <campaign_id>');
    const campaignId = args[1];
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('❌ Not linked. /start');
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [campaignId, userId], (err, campaign) => {
        if (!campaign) return ctx.reply('❌ Campaign not found.');
        const phpCode = generateIndexPHP(campaign);
        const buffer = Buffer.from(phpCode, 'utf-8');
        ctx.replyWithDocument({ source: buffer, filename: `cloak_${campaignId}.php` });
    });
});

// Command: /detailed_stats
bot.command('detailed_stats', async (ctx) => {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows.length) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `dstats_${c.id}`)]);
        ctx.reply('Select campaign for detailed stats:', Markup.inlineKeyboard(buttons));
    });
});

// Start command with professional menu
bot.start(async (ctx) => {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) {
        await ctx.replyWithMarkdown(
            "🎯 *Professional Cloaking Bot*\n\nWelcome! Please register or link your account.",
            Markup.inlineKeyboard([
                [Markup.button.callback('📝 Register', 'reg_new')],
                [Markup.button.callback('🔗 Link Account', 'link_existing')]
            ])
        );
    } else {
        await ctx.replyWithMarkdown(
            "🎯 *Main Menu*",
            Markup.inlineKeyboard([
                [Markup.button.callback('📋 My Campaigns', 'list_campaigns')],
                [Markup.button.callback('➕ New Campaign', 'new_campaign')],
                [Markup.button.callback('📊 Quick Stats', 'stats_menu')],
                [Markup.button.callback('📈 Detailed Stats', 'detailed_stats_menu')],
                [Markup.button.callback('⬇️ Download Script', 'download_menu')]
            ])
        );
    }
});

// Registration & linking actions
bot.action('reg_new', async (ctx) => {
    await ctx.answerCbQuery();
    setTempSession(ctx.from.id, 'reg_email', {});
    await ctx.reply('📧 Send your email address:');
});
bot.action('link_existing', async (ctx) => {
    await ctx.answerCbQuery();
    setTempSession(ctx.from.id, 'link_email', {});
    await ctx.reply('🔗 Send your registered email:');
});

// New campaign action – start the 8-step process
bot.action('new_campaign', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('❌ Not linked. /start');
    setTempSession(ctx.from.id, 'campaign_name', {});
    await ctx.reply("📌 *Step 1/8:* Send a name for your campaign.\nExample: `My Campaign`", { parse_mode: 'Markdown' });
});

// Action handlers for white type
bot.action('white_ai', async (ctx) => {
    await ctx.answerCbQuery();
    const session = await getTempSession(ctx.from.id);
    if (session && session.step === 'white_type') {
        session.data.white_type = 'ai';
        setTempSession(ctx.from.id, 'white_niche', session.data);
        await ctx.reply("🧠 *Step 3b:* Send a niche for AI white page.\nExample: `iPhone 15 Giveaway`", { parse_mode: 'Markdown' });
    }
});
bot.action('white_url', async (ctx) => {
    await ctx.answerCbQuery();
    const session = await getTempSession(ctx.from.id);
    if (session && session.step === 'white_type') {
        session.data.white_type = 'url';
        setTempSession(ctx.from.id, 'white_url', session.data);
        await ctx.reply("🔗 *Step 3b:* Send the full URL of your white page.\nExample: `https://example.com/white`", { parse_mode: 'Markdown' });
    }
});

// VPN block actions
bot.action('block_vpn_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const session = await getTempSession(ctx.from.id);
    if (session && session.step === 'block_vpn') {
        session.data.block_vpn = true;
        await finishCampaignCreation(ctx, session.data);
    }
});
bot.action('block_vpn_no', async (ctx) => {
    await ctx.answerCbQuery();
    const session = await getTempSession(ctx.from.id);
    if (session && session.step === 'block_vpn') {
        session.data.block_vpn = false;
        await finishCampaignCreation(ctx, session.data);
    }
});

// Text handler for all steps
bot.on('text', async (ctx) => {
    const telegramId = ctx.from.id;
    const session = await getTempSession(telegramId);
    const text = ctx.message.text.trim();
    if (!session.step) return;

    // Registration steps
    if (session.step === 'reg_email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply('❌ Invalid email. Try again.');
        session.data.email = text;
        setTempSession(telegramId, 'reg_password', session.data);
        return ctx.reply('🔒 Send a password (min 6 chars):');
    }
    if (session.step === 'reg_password') {
        if (text.length < 6) return ctx.reply('❌ Min 6 chars.');
        session.data.password = text;
        setTempSession(telegramId, 'reg_confirm', session.data);
        return ctx.reply('🔁 Confirm password:');
    }
    if (session.step === 'reg_confirm') {
        if (text !== session.data.password) return ctx.reply('❌ Passwords do not match. Start over with /start');
        try {
            await createUser(session.data.email, session.data.password, telegramId);
            await ctx.reply('✅ Registration successful! Press /start to continue.');
            clearTempSession(telegramId);
        } catch (err) {
            ctx.reply('❌ Email already exists. Use /start → Link Account');
            clearTempSession(telegramId);
        }
        return;
    }
    // Link existing account
    if (session.step === 'link_email') {
        db.get(`SELECT id FROM users WHERE email = ?`, [text], async (err, user) => {
            if (!user) return ctx.reply('❌ No account. Register first.');
            db.run(`UPDATE users SET telegram_id = ? WHERE id = ?`, [telegramId, user.id], (err) => {
                if (err) ctx.reply('Error linking.');
                else ctx.reply('✅ Linked! Use /start');
                clearTempSession(telegramId);
            });
        });
        return;
    }
    // Campaign creation steps
    if (session.step === 'campaign_name') {
        session.data.name = text;
        setTempSession(telegramId, 'offer_url', session.data);
        return ctx.reply("🔗 *Step 2/8:* Send the offer URL (where real visitors go).\nExample: `https://your-offer.com`", { parse_mode: 'Markdown' });
    }
    if (session.step === 'offer_url') {
        if (!text.startsWith('http')) return ctx.reply('❌ Valid URL starting with http:// or https://');
        session.data.offer_url = text;
        setTempSession(telegramId, 'white_type', session.data);
        return ctx.replyWithMarkdown("🎨 *Step 3/8:* White page source?\n\nChoose:", Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Generate (multi-file)', 'white_ai')],
            [Markup.button.callback('🌐 External URL', 'white_url')]
        ]));
    }
    if (session.step === 'white_url') {
        if (!text.startsWith('http')) return ctx.reply('❌ Valid URL');
        session.data.white_value = text;
        setTempSession(telegramId, 'allowed_os', session.data);
        return ctx.replyWithMarkdown("💻 *Step 4/8:* Allowed OS (comma).\nExample: `Windows, macOS, Android`\nOr send `skip` for all.");
    }
    if (session.step === 'white_niche') {
        session.data.white_value = text;
        setTempSession(telegramId, 'allowed_os', session.data);
        return ctx.replyWithMarkdown("💻 *Step 4/8:* Allowed OS (comma).\nExample: `Windows, macOS, Android`\nOr `skip`.");
    }
    if (session.step === 'allowed_os') {
        session.data.allowed_os = text.toLowerCase() === 'skip' ? '' : text;
        setTempSession(telegramId, 'allowed_browsers', session.data);
        return ctx.replyWithMarkdown("🌐 *Step 5/8:* Allowed browsers (comma).\nExample: `Chrome, Firefox, Safari`\nOr `skip`.");
    }
    if (session.step === 'allowed_browsers') {
        session.data.allowed_browsers = text.toLowerCase() === 'skip' ? '' : text;
        setTempSession(telegramId, 'allowed_countries', session.data);
        return ctx.replyWithMarkdown("🌍 *Step 6/8:* Allowed countries (2-letter codes, comma).\nExample: `US, GB, CA`\nOr `skip`.");
    }
    if (session.step === 'allowed_countries') {
        session.data.allowed_countries = text.toLowerCase() === 'skip' ? '' : text.toUpperCase();
        setTempSession(telegramId, 'clicks_per_day', session.data);
        return ctx.reply("🔢 *Step 7/8:* Max clicks per IP per day? (default 15)\nSend a number or `skip`.", { parse_mode: 'Markdown' });
    }
    if (session.step === 'clicks_per_day') {
        let clicks = 15;
        if (text.toLowerCase() !== 'skip') {
            const num = parseInt(text);
            if (isNaN(num) || num <= 0) return ctx.reply('❌ Send a positive number or `skip`');
            clicks = num;
        }
        session.data.clicks_per_day = clicks;
        setTempSession(telegramId, 'block_vpn', session.data);
        return ctx.replyWithMarkdown("🛡️ *Step 8/8:* Block VPN/Proxy?\n\nChoose:", Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes', 'block_vpn_yes')],
            [Markup.button.callback('❌ No', 'block_vpn_no')]
        ]));
    }
});

async function finishCampaignCreation(ctx, data) {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    await ctx.reply('⏳ Creating campaign...');
    const campaignId = crypto.randomUUID();
    let whiteZip = null;
    let whiteValue = data.white_value;
    if (data.white_type === 'ai') {
        whiteZip = await generateMultiFileWhitePage(data.white_value);
        whiteValue = '';
    }
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [campaignId, userId, data.name, data.offer_url, data.white_type, whiteValue, whiteZip,
             data.allowed_os || null, data.allowed_browsers || null, data.allowed_countries || null,
             data.clicks_per_day || 15, data.block_vpn ? 1 : 0], (err) => {
        if (err) ctx.reply('❌ Error: ' + err.message);
        else ctx.replyWithMarkdown(`✅ *Campaign Created!*\n\nName: ${data.name}\nID: \`${campaignId}\`\n\nUse /download ${campaignId} to get the cloaking script.`);
        clearTempSession(ctx.from.id);
    });
}

// Action: My Campaigns
bot.action('list_campaigns', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT id, name, offer_url FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows.length) return ctx.reply('No campaigns. Use "New Campaign".');
        let msg = '📋 *Your Campaigns:*\n';
        rows.forEach(c => { msg += `\n🔹 *${c.name}*\n   ID: \`${c.id}\`\n   Offer: ${c.offer_url}\n`; });
        ctx.replyWithMarkdown(msg);
    });
});

// Action: Quick Stats menu
bot.action('stats_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows.length) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `stats_${c.id}`)]);
        ctx.reply('Select campaign for quick stats:', Markup.inlineKeyboard(buttons));
    });
});
bot.action(/stats_(.+)/, async (ctx) => {
    const campaignId = ctx.match[1];
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [campaignId], (err, row) => {
        const main = row?.main || 0;
        const white = row?.white || 0;
        ctx.replyWithMarkdown(`📊 *Quick Stats*\n✅ Main clicks: ${main}\n❌ White views: ${white}`);
    });
});

// Action: Detailed Stats menu
bot.action('detailed_stats_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows.length) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `dstats_${c.id}`)]);
        ctx.reply('Select campaign for detailed stats:', Markup.inlineKeyboard(buttons));
    });
});
bot.action(/dstats_(.+)/, async (ctx) => {
    const campaignId = ctx.match[1];
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    // Fetch detailed stats from API
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'default');
    const response = await axios.get(`${process.env.RENDER_EXTERNAL_URL}/api/campaigns/${campaignId}/detailed_stats`, {
        headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null);
    if (!response || !response.data) return ctx.reply('Error fetching stats.');
    const stats = response.data;
    let msg = `📊 *Detailed Stats*\n✅ Main: ${stats.main}\n❌ White: ${stats.white}\n\n*By Country:*\n`;
    for (let [c, cnt] of Object.entries(stats.by_country)) msg += `${c}: ${cnt}\n`;
    msg += `\n*By Device:*\n`;
    for (let [d, cnt] of Object.entries(stats.by_device)) msg += `${d}: ${cnt}\n`;
    msg += `\n*By OS:*\n`;
    for (let [os, cnt] of Object.entries(stats.by_os)) msg += `${os}: ${cnt}\n`;
    msg += `\n*By Browser:*\n`;
    for (let [b, cnt] of Object.entries(stats.by_browser)) msg += `${b}: ${cnt}\n`;
    ctx.replyWithMarkdown(msg);
});

// Action: Download menu
bot.action('download_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows.length) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `download_${c.id}`)]);
        ctx.reply('Select campaign to download script:', Markup.inlineKeyboard(buttons));
    });
});
bot.action(/download_(.+)/, async (ctx) => {
    const campaignId = ctx.match[1];
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [campaignId, userId], (err, campaign) => {
        if (!campaign) return ctx.reply('Campaign not found.');
        const phpCode = generateIndexPHP(campaign);
        const buffer = Buffer.from(phpCode, 'utf-8');
        ctx.replyWithDocument({ source: buffer, filename: `cloak_${campaignId}.php` });
    });
});

// Webhook setup
const WEBHOOK_PATH = '/telegram-webhook';
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || process.env.DOMAIN}${WEBHOOK_PATH}`;
bot.telegram.setWebhook(WEBHOOK_URL).catch(e => console.error('Webhook error:', e));
app.use(bot.webhookCallback(WEBHOOK_PATH));

// ---------- Frontend ----------
app.get('/', (req, res) => res.send('<h1>Cloaking SaaS API</h1><p>Bot is running.</p>'));

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
