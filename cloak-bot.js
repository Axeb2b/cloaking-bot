// cloak-bot.js – Simple working cloaking bot
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const express = require('express');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || 'https://your-bot.onrender.com';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing');
    process.exit(1);
}

// Database
const db = new Database('./cloaks.db');
db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT,
        offer_url TEXT,
        white_url TEXT,
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

function generateId() {
    return crypto.randomBytes(4).toString('hex'); // 8-character random ID
}

function phpEscape(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

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

    let php = `<?php
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
    return php;
}

// Express API
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let bot;

app.post('/api/track', (req, res) => {
    const data = req.body;
    const { campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method } = data;
    if (!campaign_id) return res.sendStatus(400);
    const stmt = db.prepare(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method);
    const campaign = db.prepare(`SELECT group_id, name FROM campaigns WHERE id = ?`).get(campaign_id);
    if (campaign && campaign.group_id && bot) {
        const groupId = campaign.group_id;
        const message = `🔔 *New Click* (${decision === 'main' ? '✅ Main' : '⚪ White'})
*Campaign:* ${campaign.name} (ID: ${campaign_id})
*IP:* ${ip}
*Country:* ${country || '?'}
*Language:* ${language || '?'}
*ISP:* ${isp || '?'}
*Referer:* ${referer || 'direct'}
*Domain:* ${domain}
*Device:* ${device}
*OS:* ${os}
*Browser:* ${browser}
*Time:* ${new Date().toLocaleString()}`;
        bot.telegram.sendMessage(groupId, message, { parse_mode: 'Markdown' }).catch(e => console.error(e));
    }
    res.sendStatus(200);
});

// Telegram bot
bot = new Telegraf(BOT_TOKEN);
const userSession = new Map();

function getSession(userId) {
    if (!userSession.has(userId)) userSession.set(userId, {});
    return userSession.get(userId);
}
function clearSession(userId) {
    userSession.delete(userId);
}

bot.start((ctx) => {
    clearSession(ctx.from.id);
    ctx.replyWithHTML(`🤖 <b>Cloaking Bot</b>

Commands:
/new – Create campaign
/list – List campaigns
/stats &lt;id&gt; – Show stats
/download &lt;id&gt; – Download index.php
/delete &lt;id&gt; – Delete
/testdb – Test database connection
/cancel – Cancel`);
});

bot.command('new', (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (session.step) return ctx.reply('Ongoing. Use /cancel');
    session.step = 'name';
    ctx.reply('Campaign name:');
});

bot.command('cancel', (ctx) => {
    if (userSession.has(ctx.from.id)) {
        clearSession(ctx.from.id);
        ctx.reply('Cancelled.');
    } else {
        ctx.reply('Nothing to cancel.');
    }
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.step) return;
    const text = ctx.message.text.trim();

    try {
        if (session.step === 'name') {
            session.name = text;
            session.step = 'offer_url';
            ctx.reply('Offer URL (real page):');
        }
        else if (session.step === 'offer_url') {
            if (!text.startsWith('http')) return ctx.reply('Valid URL starting with http:// or https://');
            session.offer_url = text;
            session.step = 'white_url';
            ctx.reply('White page URL (fake page):');
        }
        else if (session.step === 'white_url') {
            if (!text.startsWith('http')) return ctx.reply('Valid URL');
            session.white_url = text;
            session.step = 'clicks_per_ip';
            ctx.reply('Max clicks per IP per day (default 15):', Markup.keyboard([['15', '5', '10', '20']]).resize());
        }
        else if (session.step === 'clicks_per_ip') {
            session.clicks_per_ip = parseInt(text) || 15;
            session.step = 'clicks_before_filter';
            ctx.reply('Clicks before filtering (default 5):', Markup.keyboard([['5', '3', '10']]).resize());
        }
        else if (session.step === 'clicks_before_filter') {
            session.clicks_before_filter = parseInt(text) || 5;
            session.step = 'block_vpn';
            ctx.reply('Block VPN/Proxy? (yes/no)');
        }
        else if (session.step === 'block_vpn') {
            session.block_vpn = text.toLowerCase() === 'yes' ? 1 : 0;
            session.step = 'block_ipv6';
            ctx.reply('Block IPv6? (yes/no)');
        }
        else if (session.step === 'block_ipv6') {
            session.block_ipv6 = text.toLowerCase() === 'yes' ? 1 : 0;
            session.step = 'block_no_isp';
            ctx.reply('Block no ISP? (yes/no)');
        }
        else if (session.step === 'block_no_isp') {
            session.block_no_isp = text.toLowerCase() === 'yes' ? 1 : 0;
            session.step = 'block_no_referrer';
            ctx.reply('Block no referrer? (yes/no)');
        }
        else if (session.step === 'block_no_referrer') {
            session.block_no_referrer = text.toLowerCase() === 'yes' ? 1 : 0;
            session.step = 'countries';
            ctx.reply('Allowed country codes (comma, e.g., US,GB,CA). Empty for all:');
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
            ctx.reply('Required GET params (e.g., token=abc). Leave empty:');
        }
        else if (session.step === 'get_params') {
            session.get_params = text || '';
            session.step = 'group_id';
            ctx.reply('Telegram GROUP ID (must add bot to group first):');
        }
        else if (session.step === 'group_id') {
            session.group_id = text.trim();
            session.step = 'active';
            ctx.reply('Activate campaign? (yes/no)');
        }
        else if (session.step === 'active') {
            session.active = text.toLowerCase() === 'yes' ? 1 : 0;
            const id = generateId();
            const stmt = db.prepare(`INSERT INTO campaigns (id, name, offer_url, white_url, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer, countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params, group_id, active, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            stmt.run(
                id, session.name, session.offer_url, session.white_url, session.clicks_per_ip, session.clicks_before_filter,
                session.block_vpn, session.block_ipv6, session.block_no_isp, session.block_no_referrer,
                JSON.stringify(session.countries), JSON.stringify(session.devices), JSON.stringify(session.os), JSON.stringify(session.browsers),
                session.get_params, session.group_id, session.active, ctx.from.id
            );
            ctx.replyWithHTML(`✅ Campaign <b>${session.name}</b> created!
ID: <code>${id}</code>
Group ID: ${session.group_id}
Active: ${session.active ? 'Yes' : 'No'}

Use /download ${id} to get index.php.`);
            clearSession(userId);
        }
    } catch (err) {
        console.error(err);
        ctx.reply('❌ Error. /cancel and try again.');
        clearSession(userId);
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    const rows = db.prepare(`SELECT id, name, active, created_at FROM campaigns WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
    if (!rows.length) return ctx.reply('No campaigns. Use /new');
    let msg = '<b>Your campaigns:</b>\n';
    rows.forEach(r => msg += `🔹 ID: <code>${r.id}</code> – ${r.name} (${r.active ? '✅ Active' : '❌ Inactive'})\n`);
    ctx.replyWithHTML(msg);
});

bot.command('stats', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /stats <id>');
    const id = parts[1];
    const row = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN decision = 'main' THEN 1 ELSE 0 END) as main, SUM(CASE WHEN decision = 'white' THEN 1 ELSE 0 END) as white FROM stats WHERE campaign_id = ?`).get(id);
    if (!row || row.total === 0) return ctx.reply('No stats yet.');
    ctx.replyWithHTML(`📊 <b>Stats for ${id}</b>\nMain: ${row.main}\nWhite: ${row.white}\nTotal: ${row.total}`);
});

bot.command('download', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /download <id>');
    const id = parts[1];
    const userId = ctx.from.id;
    try {
        const row = db.prepare(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`).get(id, userId);
        if (!row) {
            console.log(`Campaign ${id} not found`);
            return ctx.reply('Campaign not found.');
        }
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
    if (parts.length < 2) return ctx.reply('Usage: /delete <id>');
    const id = parts[1];
    const userId = ctx.from.id;
    const result = db.prepare(`DELETE FROM campaigns WHERE id = ? AND user_id = ?`).run(id, userId);
    if (result.changes === 0) return ctx.reply('Campaign not found.');
    ctx.reply(`✅ Deleted ${id}`);
});

bot.command('testdb', (ctx) => {
    const userId = ctx.from.id;
    const count = db.prepare(`SELECT COUNT(*) as c FROM campaigns WHERE user_id = ?`).get(userId);
    ctx.reply(`Database OK. You have ${count.c} campaigns.`);
});

bot.launch();
app.listen(PORT, () => console.log(`API on ${PORT}`));
