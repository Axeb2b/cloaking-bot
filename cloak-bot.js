// cloak-bot.js – Complete cloaking bot (HTML parse_mode, all features)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

// ---------- ENVIRONMENT ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || `https://your-bot.onrender.com`;

if (!BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('❌ Missing BOT_TOKEN or GEMINI_API_KEY');
    process.exit(1);
}

// ---------- DATABASE (better-sqlite3) ----------
const db = new Database('./cloaks.db');
db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT,
        offer_url TEXT,
        white_url TEXT,
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
        get_params TEXT,
        active INTEGER DEFAULT 1,
        group_id TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS white_pages (
        id TEXT PRIMARY KEY,
        name TEXT,
        vertical TEXT,
        theme TEXT,
        language TEXT,
        domain TEXT,
        company TEXT,
        phone TEXT,
        email TEXT,
        keywords TEXT,
        html TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS filter_lists (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT, -- country, device, os, browser, ip, ua_keyword
        items TEXT, -- JSON array
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        domain TEXT,
        campaign_id TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT,
        ip TEXT,
        user_agent TEXT,
        decision TEXT,
        country TEXT,
        isp TEXT,
        timezone TEXT,
        language TEXT,
        referer TEXT,
        domain TEXT,
        device TEXT,
        os TEXT,
        browser TEXT,
        request_method TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS short_links (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE,
        url TEXT,
        campaign_id TEXT,
        clicks INTEGER DEFAULT 0,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ---------- HELPERS ----------
function generateId() {
    return crypto.randomBytes(6).toString('hex'); // 12-character random ID
}

function phpEscape(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// AI White Page Generator (Gemini)
async function generateWhitePage(params) {
    const prompt = `Generate a complete, modern, legitimate-looking HTML/CSS landing page for the following niche: "${params.vertical}". 
    Company name: ${params.company || 'Company'}. Phone: ${params.phone || ''}. Email: ${params.email || ''}. 
    Theme: ${params.theme || 'default'}, Language: ${params.language || 'English'}. 
    Make it look professional, with a call to action, fake testimonials, and a convincing design. 
    Use inline CSS or <style> tag. Do not include any real links or scripts. 
    Return only the HTML code (including <html>, <head>, <body>). Keep file size under 60KB.`;
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        let html = response.data.candidates[0].content.parts[0].text;
        html = html.replace(/```html/g, '').replace(/```/g, '');
        return html;
    } catch (err) {
        console.error('Gemini error:', err.response?.data || err.message);
        return `<html><body><h1>White Page</h1><p>Generated for ${params.vertical}</p></body></html>`;
    }
}

// Generate index.php for a campaign
function generateIndexPHP(campaign) {
    const {
        id, name, offer_url, white_url, clicks_per_ip, clicks_before_filter,
        block_vpn, block_ipv6, block_no_isp, block_no_referrer,
        countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params
    } = campaign;
    const countries = JSON.parse(countries_allowed || '[]');
    const devices = JSON.parse(devices_allowed || '[]');
    const oss = JSON.parse(os_allowed || '[]');
    const browsers = JSON.parse(browsers_allowed || '[]');

    return `<?php
// Cloaking script for: ${phpEscape(name)} (ID: ${id})
$offer_url = '${phpEscape(offer_url)}';
$white_url = '${phpEscape(white_url)}';
$clicks_per_ip = ${clicks_per_ip};
$clicks_before_filter = ${clicks_before_filter};
$block_vpn = ${block_vpn};
$block_ipv6 = ${block_ipv6};
$block_no_isp = ${block_no_isp};
$block_no_referrer = ${block_no_referrer};
$countries_allowed = ` . json_encode($countries) . `;
$devices_allowed = ` . json_encode($devices) . `;
$os_allowed = ` . json_encode($oss) . `;
$browsers_allowed = ` . json_encode($browsers) . `;
$get_params = '${phpEscape(get_params)}';
$api_url = '${API_BASE}/api/track';

function getUserIP() {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) return $_SERVER['HTTP_CF_CONNECTING_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
    return $_SERVER['REMOTE_ADDR'];
}

function getDeviceOSBrowser($ua) {
    $device = 'desktop'; $os = 'unknown'; $browser = 'other';
    if (preg_match('/mobile/i', $ua)) $device = 'mobile';
    elseif (preg_match('/tablet/i', $ua)) $device = 'tablet';
    if (preg_match('/Windows/i', $ua)) $os = 'Windows';
    elseif (preg_match('/Mac/i', $ua)) $os = 'macOS';
    elseif (preg_match('/Linux/i', $ua)) $os = 'Linux';
    elseif (preg_match('/Android/i', $ua)) $os = 'Android';
    elseif (preg_match('/iOS|iPhone|iPad/i', $ua)) $os = 'iOS';
    if (preg_match('/Edg/i', $ua)) $browser = 'Edge';
    elseif (preg_match('/Chrome/i', $ua) && !preg_match('/Edg/i', $ua)) $browser = 'Chrome';
    elseif (preg_match('/Firefox/i', $ua)) $browser = 'Firefox';
    elseif (preg_match('/Safari/i', $ua) && !preg_match('/Chrome/i', $ua)) $browser = 'Safari';
    elseif (preg_match('/Opera|OPR/i', $ua)) $browser = 'Opera';
    return ['device' => $device, 'os' => $os, 'browser' => $browser];
}

function getGeoInfo($ip) {
    $data = @file_get_contents("http://ip-api.com/json/{$ip}?fields=status,countryCode,isp,timezone");
    if ($data) {
        $json = json_decode($data, true);
        if ($json['status'] === 'success') return ['country' => $json['countryCode'], 'isp' => $json['isp'], 'timezone' => $json['timezone']];
    }
    return ['country' => '', 'isp' => '', 'timezone' => ''];
}

$ip = getUserIP();
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$referrer = $_SERVER['HTTP_REFERER'] ?? '';
$domain = $_SERVER['HTTP_HOST'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$lang = substr($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '', 0, 5);
$geo = getGeoInfo($ip);
$country = $geo['country']; $isp = $geo['isp']; $timezone = $geo['timezone'];
$deviceInfo = getDeviceOSBrowser($ua);
$device = $deviceInfo['device']; $os = $deviceInfo['os']; $browser = $deviceInfo['browser'];

$countFile = sys_get_temp_dir() . "/cloak_{$id}_" . md5($ip) . ".txt";
$today = date('Y-m-d');
$countData = file_exists($countFile) ? json_decode(file_get_contents($countFile), true) : ['date'=>$today,'count'=>0];
if ($countData['date'] != $today) $countData = ['date'=>$today,'count'=>0];
$countData['count']++;
file_put_contents($countFile, json_encode($countData));
$isBot = false;
if ($countData['count'] <= $clicks_before_filter) {
    $isBot = false;
} else {
    $bots = ['bot','crawl','spider','headless','curl','wget','python','go-http','scrapy','puppet'];
    foreach ($bots as $b) if (stripos($ua, $b) !== false) { $isBot = true; break; }
    if (!$isBot && !empty($countries_allowed)) if (!in_array($country, $countries_allowed)) $isBot = true;
    if (!$isBot && !empty($devices_allowed)) if (!in_array($device, $devices_allowed)) $isBot = true;
    if (!$isBot && !empty($os_allowed)) if (!in_array($os, $os_allowed)) $isBot = true;
    if (!$isBot && !empty($browsers_allowed)) if (!in_array($browser, $browsers_allowed)) $isBot = true;
    if ($block_no_referrer && empty($referrer)) $isBot = true;
}
$decision = $isBot ? 'white' : 'main';

$postData = [
    'campaign_id' => '${id}',
    'ip' => $ip,
    'user_agent' => $ua,
    'decision' => $decision,
    'country' => $country,
    'isp' => $isp,
    'timezone' => $timezone,
    'language' => $lang,
    'referer' => $referrer,
    'domain' => $domain,
    'device' => $device,
    'os' => $os,
    'browser' => $browser,
    'request_method' => $method
];
if (function_exists('curl_version')) {
    $ch = curl_init($api_url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 1);
    curl_exec($ch);
}
if ($decision === 'main') {
    header('Location: ' . $offer_url, true, 302);
} else {
    header('Location: ' . $white_url, true, 302);
}
exit;
`;
}

// ---------- EXPRESS API (for tracking) ----------
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let bot; // will be set after bot initialization

app.post('/api/track', (req, res) => {
    const data = req.body;
    const { campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method } = data;
    if (!campaign_id) return res.sendStatus(400);
    const stmt = db.prepare(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method);
    const campaign = db.prepare(`SELECT group_id, name FROM campaigns WHERE id = ?`).get(campaign_id);
    if (campaign && campaign.group_id && bot) {
        const groupId = campaign.group_id;
        const message = `🔔 <b>New Click</b> (${decision === 'main' ? '✅ Main' : '⚪ White'})
<b>Campaign:</b> ${campaign.name} (ID: ${campaign_id})
<b>IP:</b> ${ip}
<b>Country:</b> ${country || '?'}
<b>Language:</b> ${language || '?'}
<b>ISP:</b> ${isp || '?'}
<b>Referer:</b> ${referer || 'direct'}
<b>Domain:</b> ${domain}
<b>Device:</b> ${device}
<b>OS:</b> ${os}
<b>Browser:</b> ${browser}
<b>Time:</b> ${new Date().toLocaleString()}`;
        bot.telegram.sendMessage(groupId, message, { parse_mode: 'HTML' }).catch(e => console.error('Group send error:', e.message));
    }
    res.sendStatus(200);
});

// ---------- TELEGRAM BOT (HTML parse_mode) ----------
bot = new Telegraf(BOT_TOKEN);
const userSession = new Map();

function getSession(userId) {
    if (!userSession.has(userId)) userSession.set(userId, {});
    return userSession.get(userId);
}
function clearSession(userId) {
    userSession.delete(userId);
}

// Helper to send HTML messages
function sendHTML(ctx, text) {
    return ctx.replyWithHTML(text);
}

bot.start((ctx) => {
    clearSession(ctx.from.id);
    sendHTML(ctx, `🤖 <b>Cloaking Bot</b> – Create and manage cloaking campaigns.

<b>Commands:</b>
/new – Create new campaign (flow)
/list – List your campaigns
/stats &lt;id&gt; – Show stats
/download &lt;id&gt; – Download index.php
/delete &lt;id&gt; – Delete campaign
/white – Manage AI white pages
/filter – Manage filter lists
/domain – Manage domains
/short – Create short link
/cancel – Cancel current operation`);
});

bot.command('new', (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (session.step) return ctx.reply('Ongoing. Use /cancel.');
    session.step = 'name';
    ctx.reply('Enter campaign name:');
});

bot.command('cancel', (ctx) => {
    if (userSession.has(ctx.from.id)) {
        clearSession(ctx.from.id);
        ctx.reply('Cancelled.');
    } else {
        ctx.reply('Nothing to cancel.');
    }
});

// Main conversation handler
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.step) return;
    const text = ctx.message.text.trim();

    try {
        if (session.step === 'name') {
            session.name = text;
            session.step = 'offer_url';
            ctx.reply('Enter OFFER URL (real page):');
        }
        else if (session.step === 'offer_url') {
            if (!text.startsWith('http')) return ctx.reply('Valid URL starting with http:// or https://');
            session.offer_url = text;
            session.step = 'white_niche';
            ctx.reply('Enter WHITE PAGE NICHE (e.g., Crypto, Dating, Finance, News):');
        }
        else if (session.step === 'white_niche') {
            session.white_niche = text;
            session.step = 'clicks_per_ip';
            ctx.reply('Max clicks per IP per day? (default 15):', Markup.keyboard([['15', '5', '10', '20']]).resize());
        }
        else if (session.step === 'clicks_per_ip') {
            session.clicks_per_ip = parseInt(text) || 15;
            session.step = 'clicks_before_filter';
            ctx.reply('Clicks before filtering (test mode, default 5):', Markup.keyboard([['5', '3', '10']]).resize());
        }
        else if (session.step === 'clicks_before_filter') {
            session.clicks_before_filter = parseInt(text) || 5;
            session.step = 'block_vpn';
            ctx.reply('Block VPN/Proxy? (yes/no)');
        }
        else if (session.step === 'block_vpn') {
            session.block_vpn = (text.toLowerCase() === 'yes') ? 1 : 0;
            session.step = 'block_ipv6';
            ctx.reply('Block IPv6? (yes/no)');
        }
        else if (session.step === 'block_ipv6') {
            session.block_ipv6 = (text.toLowerCase() === 'yes') ? 1 : 0;
            session.step = 'block_no_isp';
            ctx.reply('Block requests without ISP info? (yes/no)');
        }
        else if (session.step === 'block_no_isp') {
            session.block_no_isp = (text.toLowerCase() === 'yes') ? 1 : 0;
            session.step = 'block_no_referrer';
            ctx.reply('Block requests without referrer? (yes/no)');
        }
        else if (session.step === 'block_no_referrer') {
            session.block_no_referrer = (text.toLowerCase() === 'yes') ? 1 : 0;
            session.step = 'countries';
            ctx.reply('Allowed country codes (comma, e.g., US,GB,CA). Leave empty for all:');
        }
        else if (session.step === 'countries') {
            session.countries = text ? text.split(',').map(c => c.trim().toUpperCase()) : [];
            session.step = 'devices';
            ctx.reply('Allowed devices (comma: desktop,mobile,tablet). Empty for all:');
        }
        else if (session.step === 'devices') {
            session.devices = text ? text.split(',').map(d => d.trim().toLowerCase()) : [];
            session.step = 'os';
            ctx.reply('Allowed OS (comma: Windows, macOS, Linux, Android, iOS). Empty for all:');
        }
        else if (session.step === 'os') {
            session.os = text ? text.split(',').map(o => o.trim()) : [];
            session.step = 'browsers';
            ctx.reply('Allowed browsers (comma: Chrome, Firefox, Safari, Edge, Opera). Empty for all:');
        }
        else if (session.step === 'browsers') {
            session.browsers = text ? text.split(',').map(b => b.trim()) : [];
            session.step = 'get_params';
            ctx.reply('Required GET parameters (e.g., token=abc). Leave empty:');
        }
        else if (session.step === 'get_params') {
            session.get_params = text || '';
            session.step = 'group_id';
            ctx.reply('Send Telegram GROUP ID where stats should be posted (must add bot to group first). To get group ID, add @userinfobot to your group and send /id.');
        }
        else if (session.step === 'group_id') {
            session.group_id = text.trim();
            session.step = 'active';
            ctx.reply('Activate campaign now? (yes/no)');
        }
        else if (session.step === 'active') {
            session.active = (text.toLowerCase() === 'yes') ? 1 : 0;
            // Generate AI white page
            await ctx.reply(`⏳ Generating white page for niche: ${session.white_niche}... (may take 10-15 seconds)`);
            const whiteHtml = await generateWhitePage({
                vertical: session.white_niche,
                company: '',
                phone: '',
                email: '',
                theme: 'default',
                language: 'English'
            });
            // Save campaign with generated white page URL (store HTML directly)
            const campaignId = generateId();
            const stmt = db.prepare(`INSERT INTO campaigns 
                (id, name, offer_url, white_url, white_html, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer,
                 countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params, group_id, active, user_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            stmt.run(
                campaignId, session.name, session.offer_url, '', whiteHtml, session.clicks_per_ip, session.clicks_before_filter,
                session.block_vpn, session.block_ipv6, session.block_no_isp, session.block_no_referrer,
                JSON.stringify(session.countries), JSON.stringify(session.devices), JSON.stringify(session.os), JSON.stringify(session.browsers),
                session.get_params, session.group_id, session.active, ctx.from.id
            );
            sendHTML(ctx, `✅ <b>Campaign created successfully!</b>
ID: <code>${campaignId}</code>
Name: ${session.name}
Active: ${session.active ? 'Yes' : 'No'}
Group ID: ${session.group_id}

Use /download ${campaignId} to get index.php.
Use /white list to see generated white page.`);
            clearSession(userId);
        }
    } catch (err) {
        console.error('Conversation error:', err);
        ctx.reply('❌ An error occurred. Please try again with /new');
        clearSession(userId);
    }
});

// -------------------- COMMANDS --------------------
bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    const rows = db.prepare(`SELECT id, name, active, created_at FROM campaigns WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
    if (!rows.length) return ctx.reply('No campaigns. Use /new to create.');
    let msg = '<b>Your campaigns:</b>\n';
    rows.forEach(r => msg += `🔹 ID: <code>${r.id}</code> – ${r.name} (${r.active ? '✅ Active' : '❌ Inactive'})\n`);
    sendHTML(ctx, msg);
});

bot.command('stats', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /stats <campaign_id>');
    const id = parts[1];
    const row = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN decision = 'main' THEN 1 ELSE 0 END) as main, SUM(CASE WHEN decision = 'white' THEN 1 ELSE 0 END) as white FROM stats WHERE campaign_id = ?`).get(id);
    if (!row || row.total === 0) return ctx.reply('No stats yet.');
    sendHTML(ctx, `📊 <b>Stats for campaign ${id}</b>\nMain: ${row.main}\nWhite: ${row.white}\nTotal: ${row.total}`);
});

bot.command('download', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /download <campaign_id>');
    const id = parts[1];
    const userId = ctx.from.id;
    try {
        const row = db.prepare(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`).get(id, userId);
        if (!row) return ctx.reply('Campaign not found.');
        const phpCode = generateIndexPHP(row);
        await ctx.replyWithDocument({
            source: Buffer.from(phpCode, 'utf8'),
            filename: `cloak_${id}.php`
        }, { caption: `index.php for campaign ${row.name}` });
    } catch (err) {
        console.error('Download error:', err);
        ctx.reply('❌ Failed to generate file. Check logs.');
    }
});

bot.command('delete', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /delete <campaign_id>');
    const id = parts[1];
    const userId = ctx.from.id;
    const result = db.prepare(`DELETE FROM campaigns WHERE id = ? AND user_id = ?`).run(id, userId);
    if (result.changes === 0) return ctx.reply('Campaign not found.');
    ctx.reply(`✅ Campaign ${id} deleted.`);
});

bot.command('white', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const sub = args[1];
    if (sub === 'list') {
        const userId = ctx.from.id;
        const rows = db.prepare(`SELECT id, name, vertical, created_at FROM white_pages WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
        if (!rows.length) return ctx.reply('No white pages. Use /new to create campaign (auto generates white page).');
        let msg = '<b>Your white pages:</b>\n';
        rows.forEach(r => msg += `📄 ID: <code>${r.id}</code> – ${r.name} (${r.vertical})\n`);
        sendHTML(ctx, msg);
    } else if (sub === 'download') {
        const id = args[2];
        if (!id) return ctx.reply('Usage: /white download <white_page_id>');
        const row = db.prepare(`SELECT html, name FROM white_pages WHERE id = ? AND user_id = ?`).get(id, ctx.from.id);
        if (!row) return ctx.reply('White page not found.');
        await ctx.replyWithDocument({
            source: Buffer.from(row.html, 'utf8'),
            filename: `white_${id}.html`
        }, { caption: `White page: ${row.name}` });
    } else {
        ctx.reply('Subcommands: list, download <id>');
    }
});

bot.command('filter', (ctx) => {
    ctx.reply('Filter lists coming soon. Use /new to set filters during campaign creation.');
});

bot.command('domain', (ctx) => {
    ctx.reply('Domain management coming soon. Use /new to create campaigns.');
});

bot.command('short', (ctx) => {
    ctx.reply('Short link generation coming soon.');
});

bot.launch().then(() => console.log('🤖 Bot started')).catch(err => console.error('Bot launch error:', err));
app.listen(PORT, () => console.log(`🌐 Stats API on port ${PORT}`));
