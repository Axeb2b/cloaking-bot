// cloak-bot.js – Cloaking bot (fixed template string issue)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const express = require('express');

// ---------- ENVIRONMENT CHECKS ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || 'https://your-bot.onrender.com';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN environment variable is missing.');
    process.exit(1);
}
console.log('✅ BOT_TOKEN found. Starting bot...');

// ---------- DATABASE SETUP ----------
let db;
try {
    db = new Database('./cloaks.db');
    db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
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
            campaign_id INTEGER,
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
    console.log('✅ Database ready');
} catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
}

// ---------- HELPER: escape PHP strings ----------
function phpEscape(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------- GENERATE index.php (no template literals, safe) ----------
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

    // Build PHP code using array and join (no backticks inside)
    const lines = [];
    lines.push('<?php');
    lines.push('// Cloaking script for: ' + phpEscape(name) + ' (ID: ' + id + ')');
    lines.push('$offer_url = \'' + phpEscape(offer_url) + '\';');
    lines.push('$white_url = \'' + phpEscape(white_url) + '\';');
    lines.push('$clicks_per_ip = ' + clicks_per_ip + ';');
    lines.push('$clicks_before_filter = ' + clicks_before_filter + ';');
    lines.push('$block_vpn = ' + block_vpn + ';');
    lines.push('$block_ipv6 = ' + block_ipv6 + ';');
    lines.push('$block_no_isp = ' + block_no_isp + ';');
    lines.push('$block_no_referrer = ' + block_no_referrer + ';');
    lines.push('$countries_allowed = ' + json_encode($countries) + ';');
    lines.push('$devices_allowed = ' + json_encode($devices) + ';');
    lines.push('$os_allowed = ' + json_encode($oss) + ';');
    lines.push('$browsers_allowed = ' + json_encode($browsers) + ';');
    lines.push('$get_params = \'' + phpEscape(get_params) + '\';');
    lines.push('$api_url = \'' + API_BASE + '/api/track\';');
    lines.push('');
    lines.push('function getUserIP() {');
    lines.push('    if (!empty($_SERVER[\'HTTP_CF_CONNECTING_IP\'])) return $_SERVER[\'HTTP_CF_CONNECTING_IP\'];');
    lines.push('    if (!empty($_SERVER[\'HTTP_X_FORWARDED_FOR\'])) return explode(\',\', $_SERVER[\'HTTP_X_FORWARDED_FOR\'])[0];');
    lines.push('    return $_SERVER[\'REMOTE_ADDR\'];');
    lines.push('}');
    lines.push('');
    lines.push('function getDeviceOSBrowser($ua) {');
    lines.push('    $device = \'desktop\'; $os = \'unknown\'; $browser = \'other\';');
    lines.push('    if (preg_match(\'/mobile/i\', $ua)) $device = \'mobile\';');
    lines.push('    elseif (preg_match(\'/tablet/i\', $ua)) $device = \'tablet\';');
    lines.push('    if (preg_match(\'/Windows/i\', $ua)) $os = \'Windows\';');
    lines.push('    elseif (preg_match(\'/Mac/i\', $ua)) $os = \'macOS\';');
    lines.push('    elseif (preg_match(\'/Linux/i\', $ua)) $os = \'Linux\';');
    lines.push('    elseif (preg_match(\'/Android/i\', $ua)) $os = \'Android\';');
    lines.push('    elseif (preg_match(\'/iOS|iPhone|iPad/i\', $ua)) $os = \'iOS\';');
    lines.push('    if (preg_match(\'/Edg/i\', $ua)) $browser = \'Edge\';');
    lines.push('    elseif (preg_match(\'/Chrome/i\', $ua) && !preg_match(\'/Edg/i\', $ua)) $browser = \'Chrome\';');
    lines.push('    elseif (preg_match(\'/Firefox/i\', $ua)) $browser = \'Firefox\';');
    lines.push('    elseif (preg_match(\'/Safari/i\', $ua) && !preg_match(\'/Chrome/i\', $ua)) $browser = \'Safari\';');
    lines.push('    elseif (preg_match(\'/Opera|OPR/i\', $ua)) $browser = \'Opera\';');
    lines.push('    return [\'device\' => $device, \'os\' => $os, \'browser\' => $browser];');
    lines.push('}');
    lines.push('');
    lines.push('function getGeoInfo($ip) {');
    lines.push('    $data = @file_get_contents("http://ip-api.com/json/{$ip}?fields=status,countryCode,isp,timezone");');
    lines.push('    if ($data) { $json = json_decode($data, true); if ($json[\'status\'] === \'success\') return [\'country\' => $json[\'countryCode\'], \'isp\' => $json[\'isp\'], \'timezone\' => $json[\'timezone\']]; }');
    lines.push('    return [\'country\' => \'\', \'isp\' => \'\', \'timezone\' => \'\'];');
    lines.push('}');
    lines.push('');
    lines.push('$ip = getUserIP();');
    lines.push('$ua = $_SERVER[\'HTTP_USER_AGENT\'] ?? \'\';');
    lines.push('$referrer = $_SERVER[\'HTTP_REFERER\'] ?? \'\';');
    lines.push('$domain = $_SERVER[\'HTTP_HOST\'] ?? \'\';');
    lines.push('$method = $_SERVER[\'REQUEST_METHOD\'] ?? \'GET\';');
    lines.push('$lang = substr($_SERVER[\'HTTP_ACCEPT_LANGUAGE\'] ?? \'\', 0, 5);');
    lines.push('$geo = getGeoInfo($ip);');
    lines.push('$country = $geo[\'country\']; $isp = $geo[\'isp\']; $timezone = $geo[\'timezone\'];');
    lines.push('$deviceInfo = getDeviceOSBrowser($ua);');
    lines.push('$device = $deviceInfo[\'device\']; $os = $deviceInfo[\'os\']; $browser = $deviceInfo[\'browser\'];');
    lines.push('');
    lines.push('$countFile = sys_get_temp_dir() . "/cloak_' + id + '_" . md5($ip) . ".txt";');
    lines.push('$today = date(\'Y-m-d\');');
    lines.push('$countData = file_exists($countFile) ? json_decode(file_get_contents($countFile), true) : [\'date\'=>$today,\'count\'=>0];');
    lines.push('if ($countData[\'date\'] != $today) $countData = [\'date\'=>$today,\'count\'=>0];');
    lines.push('$countData[\'count\']++;');
    lines.push('file_put_contents($countFile, json_encode($countData));');
    lines.push('');
    lines.push('$isBot = false;');
    lines.push('if ($countData[\'count\'] <= $clicks_before_filter) {');
    lines.push('    $isBot = false;');
    lines.push('} else {');
    lines.push('    $bots = [\'bot\',\'crawl\',\'spider\',\'headless\',\'curl\',\'wget\',\'python\',\'go-http\',\'scrapy\',\'puppet\'];');
    lines.push('    foreach ($bots as $b) if (stripos($ua, $b) !== false) { $isBot = true; break; }');
    lines.push('    if (!$isBot && !empty($countries_allowed)) if (!in_array($country, $countries_allowed)) $isBot = true;');
    lines.push('    if (!$isBot && !empty($devices_allowed)) if (!in_array($device, $devices_allowed)) $isBot = true;');
    lines.push('    if (!$isBot && !empty($os_allowed)) if (!in_array($os, $os_allowed)) $isBot = true;');
    lines.push('    if (!$isBot && !empty($browsers_allowed)) if (!in_array($browser, $browsers_allowed)) $isBot = true;');
    lines.push('    if ($block_no_referrer && empty($referrer)) $isBot = true;');
    lines.push('}');
    lines.push('$decision = $isBot ? \'white\' : \'main\';');
    lines.push('');
    lines.push('$postData = [');
    lines.push('    \'campaign_id\' => ' + id + ',');
    lines.push('    \'ip\' => $ip,');
    lines.push('    \'user_agent\' => $ua,');
    lines.push('    \'decision\' => $decision,');
    lines.push('    \'country\' => $country,');
    lines.push('    \'isp\' => $isp,');
    lines.push('    \'timezone\' => $timezone,');
    lines.push('    \'language\' => $lang,');
    lines.push('    \'referer\' => $referrer,');
    lines.push('    \'domain\' => $domain,');
    lines.push('    \'device\' => $device,');
    lines.push('    \'os\' => $os,');
    lines.push('    \'browser\' => $browser,');
    lines.push('    \'request_method\' => $method');
    lines.push('];');
    lines.push('if (function_exists(\'curl_version\')) {');
    lines.push('    $ch = curl_init($api_url);');
    lines.push('    curl_setopt($ch, CURLOPT_POST, true);');
    lines.push('    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));');
    lines.push('    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);');
    lines.push('    curl_setopt($ch, CURLOPT_TIMEOUT, 1);');
    lines.push('    curl_exec($ch);');
    lines.push('}');
    lines.push('if ($decision === \'main\') {');
    lines.push('    header(\'Location: \' . $offer_url, true, 302);');
    lines.push('} else {');
    lines.push('    header(\'Location: \' . $white_url, true, 302);');
    lines.push('}');
    lines.push('exit;');
    return lines.join('\n');
}

// ---------- EXPRESS API ----------
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let bot; // will be initialized after Telegraf

app.post('/api/track', (req, res) => {
    try {
        const data = req.body;
        const { campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method } = data;
        if (!campaign_id) return res.sendStatus(400);
        const stmt = db.prepare(`INSERT INTO stats 
            (campaign_id, ip, user_agent, decision, country, isp, timezone, language, referer, domain, device, os, browser, request_method) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
*User Agent:* ${(user_agent || '').substring(0, 100)}
*Device:* ${device}
*OS:* ${os}
*Browser:* ${browser}
*Timezone:* ${timezone || '?'}
*Request Method:* ${request_method}
*Time:* ${new Date().toLocaleString()}`;
            bot.telegram.sendMessage(groupId, message, { parse_mode: 'Markdown' }).catch(err => console.error('Failed to send to group:', err.message));
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('API error:', err);
        res.sendStatus(500);
    }
});

// ---------- TELEGRAM BOT ----------
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

<b>Commands:</b>
/new – Create new campaign
/list – List campaigns
/stats &lt;id&gt; – Show stats
/download &lt;id&gt; – Download index.php
/delete &lt;id&gt; – Delete campaign
/cancel – Cancel operation`);
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
            session.step = 'white_url';
            ctx.reply('Enter WHITE PAGE URL (fake page for bots):');
        }
        else if (session.step === 'white_url') {
            if (!text.startsWith('http')) return ctx.reply('Valid URL please.');
            session.white_url = text;
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
            const userIdNum = ctx.from.id;
            const stmt = db.prepare(`INSERT INTO campaigns 
                (name, offer_url, white_url, clicks_per_ip, clicks_before_filter, block_vpn, block_ipv6, block_no_isp, block_no_referrer,
                 countries_allowed, devices_allowed, os_allowed, browsers_allowed, get_params, group_id, active, user_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            const info = stmt.run(
                session.name, session.offer_url, session.white_url, session.clicks_per_ip, session.clicks_before_filter,
                session.block_vpn, session.block_ipv6, session.block_no_isp, session.block_no_referrer,
                JSON.stringify(session.countries), JSON.stringify(session.devices), JSON.stringify(session.os), JSON.stringify(session.browsers),
                session.get_params, session.group_id, session.active, userIdNum
            );
            const campaignId = info.lastInsertRowid;
            ctx.replyWithHTML(`✅ Campaign <b>${session.name}</b> created!
ID: <code>${campaignId}</code>
Group ID: ${session.group_id}
Active: ${session.active ? 'Yes' : 'No'}

Use /download ${campaignId} to get index.php.
Use /stats ${campaignId} to see stats.`);
            clearSession(userId);
        }
    } catch (err) {
        console.error('Error in conversation:', err);
        ctx.reply('❌ Error. Try /new again.');
        clearSession(userId);
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    try {
        const rows = db.prepare(`SELECT id, name, active, created_at FROM campaigns WHERE user_id = ? ORDER BY id DESC`).all(userId);
        if (!rows.length) return ctx.reply('No campaigns. Use /new to create.');
        let msg = '<b>Your campaigns:</b>\n';
        rows.forEach(r => {
            msg += `${r.id}. ${r.name} – ${r.active ? '✅ Active' : '❌ Inactive'} (${r.created_at})\n`;
        });
        ctx.replyWithHTML(msg);
    } catch (err) {
        ctx.reply('Database error.');
    }
});

bot.command('stats', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /stats <campaign_id>');
    const id = parts[1];
    try {
        const row = db.prepare(`SELECT COUNT(CASE WHEN decision = 'main' THEN 1 END) as main, COUNT(CASE WHEN decision = 'white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`).get(id);
        if (!row || (row.main === 0 && row.white === 0)) return ctx.reply('No stats yet.');
        ctx.replyWithHTML(`📊 <b>Stats for campaign ${id}</b>\nMain: ${row.main}\nWhite: ${row.white}\nTotal: ${row.main + row.white}`);
    } catch (err) {
        ctx.reply('Error fetching stats.');
    }
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
        console.error('Download error:', err);
        ctx.reply('❌ Failed to generate file. Check logs.');
    }
});

bot.command('delete', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /delete <campaign_id>');
    const id = parts[1];
    const userId = ctx.from.id;
    try {
        const result = db.prepare(`DELETE FROM campaigns WHERE id = ? AND user_id = ?`).run(id, userId);
        if (result.changes === 0) return ctx.reply('Campaign not found.');
        ctx.reply(`✅ Campaign ${id} deleted.`);
    } catch (err) {
        ctx.reply('Error deleting campaign.');
    }
});

bot.launch().then(() => console.log('🤖 Bot started polling')).catch(err => console.error('Bot launch error:', err));

app.listen(PORT, () => console.log(`🌐 Stats API listening on port ${PORT}`));
