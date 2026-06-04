// bot.js – Cloaking House style Telegram bot
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const axios = require('axios');

// ---------- CONFIG ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '';
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Get from Google AI Studio
const API_BASE = process.env.API_BASE || 'https://your-bot.onrender.com'; // Public URL

if (!BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('Missing BOT_TOKEN or GEMINI_API_KEY');
    process.exit(1);
}

// ---------- DATABASE ----------
const db = new sqlite3.Database('./cloaks.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        offer_url TEXT,
        white_niche TEXT,
        white_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        ip TEXT,
        user_agent TEXT,
        decision TEXT, -- 'main' or 'white'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ---------- GEMINI AI WHITE PAGE GENERATION ----------
async function generateWhitePage(niche) {
    const prompt = `Generate a complete, modern, convincing HTML/CSS landing page for the following niche: "${niche}". 
    Make it look legitimate, with a professional design, fake testimonials, and a call to action. 
    Do not include any real links or scripts. Only return the HTML code (including <html>, <head>, <body>). 
    Use inline CSS or <style> tag. Keep file size under 50KB.`;
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        let html = response.data.candidates[0].content.parts[0].text;
        // Cleanup markdown code blocks if any
        html = html.replace(/```html/g, '').replace(/```/g, '');
        return html;
    } catch (err) {
        console.error('Gemini error:', err.response?.data || err.message);
        return `<html><body><h1>White Page</h1><p>Generated for niche: ${niche}</p></body></html>`;
    }
}

// ---------- GENERATE index.php (cloaking script) ----------
function generateIndexPHP(campaign) {
    const whiteHtml = campaign.white_html.replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `<?php
// Cloaking script for campaign: ${campaign.name}
$offer_url = '${campaign.offer_url}';
$white_html = '${whiteHtml}';

// Helper: get real IP
function getUserIP() {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) return $_SERVER['HTTP_CF_CONNECTING_IP'];
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
    return $_SERVER['REMOTE_ADDR'];
}

// Bot detection by user-agent
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$bot_keywords = ['bot', 'crawl', 'spider', 'scrape', 'headless', 'curl', 'wget', 'python', 'go-http'];
$is_bot = false;
foreach ($bot_keywords as $kw) {
    if (stripos($ua, $kw) !== false) { $is_bot = true; break; }
}

// Optional: country detection via ipapi.co
$ip = getUserIP();
$country = '';
if (!$is_bot) {
    $geo = @file_get_contents("http://ip-api.com/json/{$ip}?fields=countryCode");
    if ($geo) {
        $data = json_decode($geo, true);
        $country = $data['countryCode'] ?? '';
        // Block certain countries (customize)
        $blocked = ['RU', 'CN', 'KP', 'IR'];
        if (in_array($country, $blocked)) $is_bot = true;
    }
}

// Decision
if ($is_bot) {
    // Show white page
    echo $white_html;
} else {
    // Show offer page (real)
    header('Location: ' . $offer_url, true, 302);
    exit;
}

// Optional: send stats to your API
if (function_exists('curl_version')) {
    $ch = curl_init('${API_BASE}/api/track');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'campaign_id' => ${campaign.id},
        'ip' => $ip,
        'user_agent' => $ua,
        'decision' => $is_bot ? 'white' : 'main'
    ]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_exec($ch);
}
?>`;
}

// ---------- EXPRESS API (for tracking) ----------
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

bot.start((ctx) => {
    ctx.reply(`🤖 *Cloaking Bot* – Create cloaking campaigns like cloaking.house.

Commands:
/create – Create a new cloak campaign
/list – List your campaigns
/stats <campaign_id> – Show stats
/download <campaign_id> – Download index.php

Use inline buttons to choose niche.`, { parse_mode: 'Markdown' });
});

// Step-by-step campaign creation
const niches = ['Crypto', 'Dating', 'Finance', 'News', 'Gaming', 'E-commerce', 'Health', 'Travel'];
const nicheKeyboard = Markup.inlineKeyboard(niches.map(n => [Markup.button.callback(n, `niche_${n}`)]));

bot.command('create', (ctx) => {
    ctx.session = { step: 'awaiting_name' };
    ctx.reply('Enter a name for this campaign (e.g., "Crypto Airdrop"):');
});

bot.on('text', async (ctx) => {
    const session = ctx.session;
    if (!session) return;

    if (session.step === 'awaiting_name') {
        session.name = ctx.message.text;
        session.step = 'awaiting_offer';
        ctx.reply('Send the OFFER URL (real page, where real users go):');
    } else if (session.step === 'awaiting_offer') {
        session.offer_url = ctx.message.text;
        session.step = 'awaiting_niche';
        ctx.reply('Select white page niche:', nicheKeyboard);
    }
});

bot.action(/niche_(.+)/, async (ctx) => {
    const niche = ctx.match[1];
    const session = ctx.session;
    if (!session || session.step !== 'awaiting_niche') {
        return ctx.reply('Please start with /create first.');
    }
    session.white_niche = niche;
    await ctx.reply(`Generating white page for niche: ${niche}... (takes a few seconds)`);
    const whiteHtml = await generateWhitePage(niche);
    if (!whiteHtml) {
        return ctx.reply('❌ Failed to generate white page. Try again later.');
    }
    // Save to database
    const userId = ctx.from.id;
    db.run(`INSERT INTO campaigns (name, offer_url, white_niche, white_html, user_id) VALUES (?, ?, ?, ?, ?)`,
        [session.name, session.offer_url, niche, whiteHtml, userId], function(err) {
            if (err) {
                console.error(err);
                return ctx.reply('❌ Database error.');
            }
            const campaignId = this.lastID;
            delete ctx.session;
            ctx.reply(`✅ Campaign *${session.name}* created successfully!
ID: \`${campaignId}\`
Offer URL: ${session.offer_url}
White niche: ${niche}

Use /download ${campaignId} to get the index.php file.
Use /stats ${campaignId} to see stats.`, { parse_mode: 'Markdown' });
        });
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    db.all(`SELECT id, name, created_at FROM campaigns WHERE user_id = ? ORDER BY id DESC`, [userId], (err, rows) => {
        if (err || !rows.length) return ctx.reply('No campaigns yet. Use /create');
        let msg = '*Your campaigns:*\n';
        rows.forEach(r => msg += `${r.id}. ${r.name} (${r.created_at})\n`);
        ctx.reply(msg, { parse_mode: 'Markdown' });
    });
});

bot.command('stats', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /stats <campaign_id>');
    const id = args[1];
    db.get(`SELECT COUNT(CASE WHEN decision = 'main' THEN 1 END) as main, COUNT(CASE WHEN decision = 'white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [id], (err, row) => {
        if (err || (!row.main && !row.white)) return ctx.reply('No stats yet.');
        ctx.reply(`📊 *Stats for campaign ${id}*\nMain page (real users): ${row.main || 0}\nWhite page (bots): ${row.white || 0}\nTotal: ${(row.main||0)+(row.white||0)}`, { parse_mode: 'Markdown' });
    });
});

bot.command('download', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /download <campaign_id>');
    const id = args[1];
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [id, ctx.from.id], (err, row) => {
        if (err || !row) return ctx.reply('Campaign not found.');
        const phpCode = generateIndexPHP(row);
        ctx.replyWithDocument({ source: Buffer.from(phpCode), filename: `cloak_${id}.php` }, { caption: `index.php for campaign ${row.name}` });
    });
});

bot.launch();
console.log('Bot started');

app.listen(PORT, () => console.log(`Stats API on port ${PORT}`));
