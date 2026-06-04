// cloak-bot.js – Telegram bot for cloaking (like cloaking.house)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '';
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || 'https://your-bot.onrender.com';

if (!BOT_TOKEN) {
    console.error('Missing BOT_TOKEN');
    process.exit(1);
}

// ---------- DATABASE ----------
const db = new sqlite3.Database('./cloaks.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        offer_url TEXT,
        white_url TEXT,
        clicks_per_ip INTEGER DEFAULT 15,
        clicks_before_filter INTEGER DEFAULT 5,
        block_vpn INTEGER DEFAULT 0,
        block_ipv6 INTEGER DEFAULT 0,
        block_no_isp INTEGER DEFAULT 0,
        block_no_referrer INTEGER DEFAULT 0,
        countries_allowed TEXT,      -- JSON array
        devices_allowed TEXT,
        os_allowed TEXT,
        browsers_allowed TEXT,
        get_params TEXT,
        active INTEGER DEFAULT 1,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        ip TEXT,
        user_agent TEXT,
        decision TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ---------- HELPER: Generate index.php content ----------
function generateIndexPHP(campaign) {
    const {
        id, offer_url, white_url, clicks_per_ip, clicks_before_filter,
        block_vpn, block_ipv6, block_no_isp, block_no_referrer,
        countries_allowed, devices_allowed, os_allowed, browsers_allowed,
        get_params
    } = campaign;

    const countries = JSON.parse(countries_allowed || '[]');
    const devices = JSON.parse(devices_allowed || '[]');
    const oss = JSON.parse(os_allowed || '[]');
    const browsers = JSON.parse(browsers_allowed || '[]');

    return `<?php
// Cloaking script for campaign: ${campaign.name} (ID: ${id})
$offer_url = '${addslashes(offer_url)}';
$white_url = '${addslashes(white_url)}';
$clicks_per_ip = ${clicks_per_ip};
$clicks_before_filter = ${clicks_before_filter};
$block_vpn = ${block_vpn};
$block_ipv6 = ${block_ipv6};
$block_no_isp = ${block_no_isp};
$block_no_referrer = ${block_no_referrer};
$countries_allowed = ${json_encode($countries)};
$devices_allowed = ${json_encode($devices)};
$os_allowed = ${json_encode($oss)};
$browsers_allowed = ${json_encode($browsers)};
$get_params = '${addslashes(get_params)}';
$api_url = '${API_BASE}/api/track';

function getUserIP() {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) return $_SERVER['HTTP_CF_CONNECTING_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
    return $_SERVER['REMOTE_ADDR'];
}

function isBot($ua) {
    $bots = ['bot','crawl','spider','headless','curl','wget','python','go-http','scrapy','puppet'];
    foreach ($bots as $b) if (stripos($ua, $b) !== false) return true;
    return false;
}

$ip = getUserIP();
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$referrer = $_SERVER['HTTP_REFERER'] ?? '';
$accept_lang = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '';

// Rate limiting per IP per day
$countFile = sys_get_temp_dir() . "/cloak_{$id}_" . md5($ip) . ".txt";
$today = date('Y-m-d');
$countData = file_exists($countFile) ? json_decode(file_get_contents($countFile), true) : ['date'=>$today,'count'=>0];
if ($countData['date'] != $today) $countData = ['date'=>$today,'count'=>0];
$countData['count']++;
file_put_contents($countFile, json_encode($countData));

$isBot = false;
if ($countData['count'] <= $clicks_before_filter) {
    $isBot = false; // test mode: treat as human for first few clicks
} else {
    $isBot = isBot($ua);
    
    // VPN/proxy detection (simplified: check cloudflare header or ipapi – here just placeholder)
    // You can integrate ipapi.co or ipqualityscore.com for more accuracy.
    
    // Country detection (free ip-api.com)
    if (!$isBot && !empty($countries_allowed)) {
        $geo = @file_get_contents("http://ip-api.com/json/{$ip}?fields=countryCode");
        if ($geo) {
            $data = json_decode($geo, true);
            $country = $data['countryCode'] ?? '';
            if (!in_array($country, $countries_allowed)) $isBot = true;
        }
    }
    
    // Device detection (simple from user agent)
    if (!$isBot && !empty($devices_allowed)) {
        $device = preg_match('/mobile/i', $ua) ? 'mobile' : (preg_match('/tablet/i', $ua) ? 'tablet' : 'desktop');
        if (!in_array($device, $devices_allowed)) $isBot = true;
    }
    
    // OS detection
    if (!$isBot && !empty($os_allowed)) {
        $os = 'unknown';
        if (preg_match('/Windows/i', $ua)) $os = 'Windows';
        elseif (preg_match('/Mac/i', $ua)) $os = 'macOS';
        elseif (preg_match('/Linux/i', $ua)) $os = 'Linux';
        elseif (preg_match('/Android/i', $ua)) $os = 'Android';
        elseif (preg_match('/iOS|iPhone|iPad/i', $ua)) $os = 'iOS';
        if (!in_array($os, $os_allowed)) $isBot = true;
    }
    
    // Browser detection
    if (!$isBot && !empty($browsers_allowed)) {
        $browser = 'other';
        if (preg_match('/Edg/i', $ua)) $browser = 'Edge';
        elseif (preg_match('/Chrome/i', $ua) && !preg_match('/Edg/i', $ua)) $browser = 'Chrome';
        elseif (preg_match('/Firefox/i', $ua)) $browser = 'Firefox';
        elseif (preg_match('/Safari/i', $ua) && !preg_match('/Chrome/i', $ua)) $browser = 'Safari';
        elseif (preg_match('/Opera|OPR/i', $ua)) $browser = 'Opera';
        if (!in_array($browser, $browsers_allowed)) $isBot = true;
    }
    
    // Optional: block no referrer
    if ($block_no_referrer && empty($referrer)) $isBot = true;
    
    // Optional: VPN detection (would require external API)
    // For simplicity, we skip actual VPN check but keep flag.
}

$decision = $isBot ? 'white' : 'main';

// Send stats to API
if (function_exists('curl_version')) {
    $ch = curl_init($api_url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'campaign_id' => ${id},
        'ip' => $ip,
        'user_agent' => $ua,
        'decision' => $decision
    ]));
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

// ---------- EXPRESS API (for tracking stats) ----------
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/api/track', (req, res) => {
    const { campaign_id, ip, user_agent, decision } = req.body;
    if (!campaign_id) return res.sendStatus(400);
    db.run(`INSERT INTO stats (campaign_id, ip, user_agent, decision) VALUES (?, ?, ?, ?)`,
        [campaign_id, ip, user_agent, decision], (err) => {
            if (err) console.error(err);
            res.sendStatus(200);
        });
});

// ---------- TELEGRAM BOT ----------
const bot = new Telegraf(BOT_TOKEN);

// Session state management (simple in-memory)
const userSession = new Map(); // userId -> { step, data }

function getSession(userId) {
    if (!userSession.has(userId)) userSession.set(userId, {});
    return userSession.get(userId);
}
function clearSession(userId) {
    userSession.delete(userId);
}

bot.start((ctx) => {
    clearSession(ctx.from.id);
    ctx.reply(`🤖 *Cloaking Bot* – Create cloaking campaigns like cloaking.house.

Commands:
/new – Create a new cloak campaign
/list – List your campaigns
/stats <campaign_id> – Show stats
/download <campaign_id> – Download index.php
/delete <campaign_id> – Delete campaign
/cancel – Cancel current operation

You will be guided step by step.`, { parse_mode: 'Markdown' });
});

bot.command('new', (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (session.step) {
        return ctx.reply('You already have an ongoing creation. Use /cancel to reset.');
    }
    session.step = 'name';
    ctx.reply('Enter a name for this campaign (e.g., "Crypto Airdrop"):');
});

bot.command('cancel', (ctx) => {
    const userId = ctx.from.id;
    if (userSession.has(userId)) {
        clearSession(userId);
        ctx.reply('✅ Current operation cancelled.');
    } else {
        ctx.reply('Nothing to cancel.');
    }
});

// Conversation handler
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.step) return;

    const text = ctx.message.text.trim();

    if (session.step === 'name') {
        session.name = text;
        session.step = 'offer_url';
        ctx.reply('Send the OFFER URL (real page for real users):');
    } 
    else if (session.step === 'offer_url') {
        if (!text.startsWith('http')) return ctx.reply('Please enter a valid URL (start with http:// or https://)');
        session.offer_url = text;
        session.step = 'white_url';
        ctx.reply('Send the WHITE PAGE URL (for bots / fake visitors):');
    }
    else if (session.step === 'white_url') {
        if (!text.startsWith('http')) return ctx.reply('Valid URL please.');
        session.white_url = text;
        session.step = 'clicks_per_ip';
        ctx.reply('Maximum clicks per IP per day? (default 15):', Markup.keyboard([['15', '5', '10', '20']]).resize());
    }
    else if (session.step === 'clicks_per_ip') {
        session.clicks_per_ip = parseInt(text) || 15;
        session.step = 'clicks_before_filter';
        ctx.reply('Number of clicks before filtering (test mode, default 5):', Markup.keyboard([['5', '3', '10']]).resize());
    }
    else if (session.step === 'clicks_before_filter') {
        session.clicks_before_filter = parseInt(text) || 5;
        session.step = 'block_vpn';
        ctx.reply('Block VPN/Proxy? (yes/no)', Markup.keyboard([['yes', 'no']]).resize());
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
        ctx.reply('Enter allowed country codes (comma separated, e.g., US,GB,CA). Leave empty to allow all:');
    }
    else if (session.step === 'countries') {
        session.countries = text ? text.split(',').map(c => c.trim().toUpperCase()) : [];
        session.step = 'devices';
        ctx.reply('Allowed devices (comma: desktop,mobile,tablet). Leave empty for all:', Markup.keyboard([['desktop,mobile,tablet', 'desktop', 'mobile', '']]).resize());
    }
    else if (session.step === 'devices') {
        session.devices = text ? text.split(',').map(d => d.trim().toLowerCase()) : [];
        session.step = 'os';
        ctx.reply('Allowed operating systems (comma: Windows, macOS, Linux, Android, iOS). Leave empty for all:');
    }
    else if (session.step === 'os') {
        session.os = text ? text.split(',').map(o => o.trim()) : [];
        session.step = 'browsers';
        ctx.reply('Allowed browsers (comma: Chrome, Firefox, Safari, Edge, Opera). Leave empty for all:');
    }
    else if (session.step === 'browsers') {
        session.browsers = text ? text.split(',').map(b => b.trim()) : [];
        session.step = 'get_params';
        ctx.reply('Required GET parameters (e.g., token=abc). Leave empty to ignore:');
    }
    else if (session.step === 'get_params') {
        session.get_params = text || '';
        session.step = 'active';
        ctx.reply('Is this campaign active? (yes/no)', Markup.keyboard([['yes', 'no']]).resize());
    }
    else if (session.step === 'active') {
        session.active = (text.toLowerCase() === 'yes') ? 1 : 0;
        // Save to database
        const userIdNum = ctx.from.id;
        const sql = `INSERT INTO campaigns 
            (name, offer_url, white_url, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer, 
             countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params, active, user_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        const params = [
            session.name, session.offer_url, session.white_url, session.clicks_per_ip, session.clicks_before_filter,
            session.block_vpn, session.block_ipv6, session.block_no_isp, session.block_no_referrer,
            JSON.stringify(session.countries), JSON.stringify(session.devices), JSON.stringify(session.os), JSON.stringify(session.browsers),
            session.get_params, session.active, userIdNum
        ];
        db.run(sql, params, function(err) {
            if (err) {
                console.error(err);
                ctx.reply('❌ Failed to save campaign. Try again.');
            } else {
                const campaignId = this.lastID;
                ctx.reply(`✅ Campaign *${session.name}* created successfully!
ID: \`${campaignId}\`
Offer: ${session.offer_url}
White: ${session.white_url}
Active: ${session.active ? 'Yes' : 'No'}

Use /download ${campaignId} to get index.php.
Use /stats ${campaignId} to see stats.`, { parse_mode: 'Markdown' });
            }
            clearSession(userId);
        });
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    db.all(`SELECT id, name, active, created_at FROM campaigns WHERE user_id = ? ORDER BY id DESC`, [userId], (err, rows) => {
        if (err || !rows.length) return ctx.reply('No campaigns. Use /new to create.');
        let msg = '*Your campaigns:*\n';
        rows.forEach(r => {
            msg += `${r.id}. ${r.name} – ${r.active ? '✅ Active' : '❌ Inactive'} (${r.created_at})\n`;
        });
        ctx.reply(msg, { parse_mode: 'Markdown' });
    });
});

bot.command('stats', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /stats <campaign_id>');
    const id = parts[1];
    db.get(`SELECT COUNT(CASE WHEN decision = 'main' THEN 1 END) as main, COUNT(CASE WHEN decision = 'white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [id], (err, row) => {
        if (err || (!row.main && !row.white)) return ctx.reply('No stats yet.');
        ctx.reply(`📊 *Stats for campaign ${id}*\nMain (real users): ${row.main || 0}\nWhite (bots): ${row.white || 0}\nTotal: ${(row.main||0)+(row.white||0)}`, { parse_mode: 'Markdown' });
    });
});

bot.command('download', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /download <campaign_id>');
    const id = parts[1];
    const userId = ctx.from.id;
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [id, userId], (err, row) => {
        if (err || !row) return ctx.reply('Campaign not found.');
        const phpContent = generateIndexPHP(row);
        ctx.replyWithDocument({ source: Buffer.from(phpContent), filename: `index_${id}.php` }, { caption: `index.php for campaign ${row.name}` });
    });
});

bot.command('delete', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /delete <campaign_id>');
    const id = parts[1];
    const userId = ctx.from.id;
    db.run(`DELETE FROM campaigns WHERE id = ? AND user_id = ?`, [id, userId], function(err) {
        if (err || this.changes === 0) return ctx.reply('Campaign not found or could not delete.');
        ctx.reply(`✅ Campaign ${id} deleted.`);
    });
});

bot.launch();
console.log('🤖 Cloaking Bot started');
app.listen(PORT, () => console.log(`🌐 Stats API on port ${PORT}`));
