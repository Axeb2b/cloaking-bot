// server.js – Professional Cloaking Bot with Custom Domains, AI White Pages, Advanced Stats
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
    db.run(`CREATE TABLE IF NOT EXISTS user_domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        domain TEXT UNIQUE,
        verification_token TEXT,
        verified INTEGER DEFAULT 0,
        campaign_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// ---------- Express App ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static('public'));

// ---------- Helper: AI White Page (multi-file zip) ----------
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
        return `<!DOCTYPE html><html><head><title>${niche}</title><style>body{font-family:Arial;text-align:center;padding:50px}</style></head><body><h1>${niche}</h1><p>White page</p></body></html>`;
    }
}

async function generateMultiFileWhitePage(niche) {
    const html = await generateWhitePageHTML(niche);
    const tempDir = path.join(__dirname, 'temp', crypto.randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'index.html'), html);
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

// ---------- Helper: Advanced PHP Cloaking Script ----------
function generateAdvancedPHP(campaign, customDomain = null) {
    const { id, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn } = campaign;
    const domain = customDomain || process.env.DOMAIN;
    return `<?php
// Professional Cloaking Script – Campaign: ${id}
$campaign_id = "${id}";
$offer_url = "${offer_url}";
$white_type = "${white_type}";
$white_zip = "${white_zip}";
$white_url = "${white_value}";
$clicks_per_day_limit = ${clicks_per_day ?? 15};
$block_vpn = ${block_vpn ? 1 : 0};
$allowed_os = [${allowed_os ? '"' . implode('","', explode(',', $allowed_os)) . '"' : ''}];
$allowed_browsers = [${allowed_browsers ? '"' . implode('","', explode(',', $allowed_browsers)) . '"' : ''}];
$allowed_countries = [${allowed_countries ? '"' . implode('","', explode(',', $allowed_countries)) . '"' : ''}];

$db_file = __DIR__ . '/cloak_stats.db';
$db = new SQLite3($db_file);
$db->exec("CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT, ip TEXT, user_agent TEXT, referer TEXT,
    country TEXT, city TEXT, device TEXT, os TEXT, browser TEXT,
    decision TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)");
$db->exec("CREATE TABLE IF NOT EXISTS daily_limits (
    ip TEXT, campaign_id TEXT, date TEXT, clicks INTEGER,
    PRIMARY KEY (ip, campaign_id, date)
)");

function getUserIP() {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_TRUE_CLIENT_IP','HTTP_X_REAL_IP','HTTP_X_FORWARDED_FOR'] as $h) {
        if (!empty($_SERVER[$h])) {
            $ips = explode(',', $_SERVER[$h]);
            foreach ($ips as $ip) {
                $ip = trim($ip);
                $ip = preg_replace('/:\d+$/', '', $ip);
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) return $ip;
            }
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
function getLocation($ip) {
    $ctx = stream_context_create(['http'=>['timeout'=>2]]);
    $resp = @file_get_contents("http://ip-api.com/json/{$ip}?fields=status,country,city,isp,proxy", false, $ctx);
    if ($resp) { $data = json_decode($resp, true); if ($data && $data['status']=='success') return $data; }
    return ['country'=>'Unknown','city'=>'Unknown','isp'=>'Unknown','proxy'=>false];
}
function getDeviceInfo($ua) {
    $ua = strtolower($ua);
    $device = (strpos($ua,'mobile')!==false||strpos($ua,'android')!==false)?'Mobile':((strpos($ua,'tablet')!==false||strpos($ua,'ipad')!==false)?'Tablet':'Desktop');
    $os = 'Unknown';
    if (strpos($ua,'windows')!==false) $os='Windows';
    elseif (strpos($ua,'mac')!==false) $os='macOS';
    elseif (strpos($ua,'linux')!==false) $os='Linux';
    elseif (strpos($ua,'android')!==false) $os='Android';
    elseif (strpos($ua,'iphone')!==false||strpos($ua,'ipad')!==false) $os='iOS';
    $browser = 'Unknown';
    if (strpos($ua,'firefox')!==false) $browser='Firefox';
    elseif (strpos($ua,'chrome')!==false) $browser='Chrome';
    elseif (strpos($ua,'safari')!==false) $browser='Safari';
    elseif (strpos($ua,'edge')!==false) $browser='Edge';
    elseif (strpos($ua,'opera')!==false) $browser='Opera';
    return ['device'=>$device,'os'=>$os,'browser'=>$browser];
}
function getTodayClicks($ip,$cid) {
    global $db;
    $stmt = $db->prepare("SELECT clicks FROM daily_limits WHERE ip=:ip AND campaign_id=:cid AND date=:date");
    $stmt->bindValue(':ip',$ip); $stmt->bindValue(':cid',$cid); $stmt->bindValue(':date',date('Y-m-d'));
    $res = $stmt->execute(); $row = $res->fetchArray(SQLITE3_ASSOC);
    return $row ? $row['clicks'] : 0;
}
function incrementClicks($ip,$cid) {
    global $db;
    $stmt = $db->prepare("INSERT INTO daily_limits (ip,campaign_id,date,clicks) VALUES (:ip,:cid,:date,1) ON CONFLICT(ip,campaign_id,date) DO UPDATE SET clicks=clicks+1");
    $stmt->bindValue(':ip',$ip); $stmt->bindValue(':cid',$cid); $stmt->bindValue(':date',date('Y-m-d'));
    $stmt->execute();
}
$ip = getUserIP(); $ua = $_SERVER['HTTP_USER_AGENT']??''; $ref = $_SERVER['HTTP_REFERER']??'';
$loc = getLocation($ip); $dev = getDeviceInfo($ua); $today = getTodayClicks($ip,$campaign_id);
$showOffer = true;
if ($today >= $clicks_per_day_limit) $showOffer=false;
if ($block_vpn && $loc['proxy']) $showOffer=false;
if (!empty($allowed_os) && !in_array($dev['os'],$allowed_os)) $showOffer=false;
if (!empty($allowed_browsers) && !in_array($dev['browser'],$allowed_browsers)) $showOffer=false;
if (!empty($allowed_countries) && !in_array($loc['country'],$allowed_countries)) $showOffer=false;
if ($showOffer) incrementClicks($ip,$campaign_id);
$decision = $showOffer?'main':'white';
$stmt = $db->prepare("INSERT INTO clicks (campaign_id,ip,user_agent,referer,country,city,device,os,browser,decision) VALUES (?,?,?,?,?,?,?,?,?,?)");
$stmt->bindValue(1,$campaign_id); $stmt->bindValue(2,$ip); $stmt->bindValue(3,$ua); $stmt->bindValue(4,$ref);
$stmt->bindValue(5,$loc['country']); $stmt->bindValue(6,$loc['city']); $stmt->bindValue(7,$dev['device']);
$stmt->bindValue(8,$dev['os']); $stmt->bindValue(9,$dev['browser']); $stmt->bindValue(10,$decision);
$stmt->execute();
$api_url = "https://${domain}/api/track";
$track = ['campaign_id'=>$campaign_id,'ip'=>$ip,'user_agent'=>$ua,'decision'=>$decision,'country'=>$loc['country'],'isp'=>$loc['isp'],'device'=>$dev['device'],'os'=>$dev['os'],'browser'=>$dev['browser'],'referrer'=>$ref];
$ch = curl_init($api_url); curl_setopt($ch,CURLOPT_POST,1); curl_setopt($ch,CURLOPT_POSTFIELDS,json_encode($track)); curl_setopt($ch,CURLOPT_HTTPHEADER,['Content-Type: application/json']); curl_setopt($ch,CURLOPT_RETURNTRANSFER,1); curl_setopt($ch,CURLOPT_TIMEOUT,2); curl_exec($ch); curl_close($ch);
if ($showOffer) { header("Location: $offer_url"); exit; }
else {
    if ($white_type == 'url') { header("Location: $white_url"); exit; }
    else {
        if ($white_zip && file_exists($white_zip)) {
            $zip = new ZipArchive();
            if ($zip->open($white_zip) === TRUE) {
                $uri = $_SERVER['REQUEST_URI'];
                if ($uri=='/'||$uri=='/index.html') { header('Content-Type: text/html'); echo $zip->getFromName('index.html'); }
                elseif ($uri=='/style.css') { header('Content-Type: text/css'); echo $zip->getFromName('style.css'); }
                elseif ($uri=='/script.js') { header('Content-Type: application/javascript'); echo $zip->getFromName('script.js'); }
                elseif ($uri=='/about.html') { echo $zip->getFromName('about.html'); }
                elseif ($uri=='/contact.html') { echo $zip->getFromName('contact.html'); }
                elseif ($uri=='/pixel.gif') { header('Content-Type: image/gif'); echo $zip->getFromName('pixel.gif'); }
                else { echo $zip->getFromName('index.html'); }
                $zip->close(); exit;
            }
        }
        echo "<h1>White Page</h1><p>Content not available.</p>";
    }
}
?>`;
}

// ---------- Cloudflare Verification ----------
async function verifyCloudflareDomain(domain, token) {
    const zoneId = await getZoneId(domain);
    if (!zoneId) return false;
    try {
        await axios.post(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
            type: 'TXT', name: `_cloaking-verify.${domain}`, content: token, ttl: 120
        }, { headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' } });
        await new Promise(resolve => setTimeout(resolve, 5000));
        const check = await axios.get(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=_cloaking-verify.${domain}`, {
            headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
        });
        return check.data.result && check.data.result.length > 0;
    } catch(e) { console.error(e.message); return false; }
}
async function getZoneId(domain) {
    try {
        const res = await axios.get(`https://api.cloudflare.com/client/v4/zones?name=${domain}`, {
            headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
        });
        return res.data.result?.[0]?.id || null;
    } catch(e) { return null; }
}

// ---------- Auth Middleware ----------
const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token && !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (token) {
        try { req.userId = jwt.verify(token, process.env.JWT_SECRET).id; }
        catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
    } else { req.userId = req.session.userId; }
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
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET);
        req.session.userId = user.id;
        res.json({ token, user: { id: user.id, email: user.email, telegram_id: user.telegram_id } });
    });
});
app.post('/api/campaigns', auth, async (req, res) => {
    const { name, offer_url, white_type, white_value, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn } = req.body;
    if (!name || !offer_url) return res.status(400).json({ error: 'Missing name/offer' });
    const id = crypto.randomUUID();
    let whiteZip = null, finalWhiteValue = white_value;
    if (white_type === 'ai') { whiteZip = await generateMultiFileWhitePage(white_value); finalWhiteValue = ''; }
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, offer_url, white_type, finalWhiteValue, whiteZip, allowed_os||null, allowed_browsers||null, allowed_countries||null, clicks_per_day||15, block_vpn?1:0], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
    });
});
app.get('/api/campaigns', auth, (req, res) => {
    db.all(`SELECT id, name, offer_url, white_type, created_at FROM campaigns WHERE user_id = ?`, [req.userId], (err, rows) => { res.json(rows||[]); });
});
app.get('/api/campaigns/:id/stats', auth, (req, res) => {
    db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [req.params.id], (err, row) => { res.json(row||{main:0,white:0}); });
});
app.get('/api/campaigns/:id/detailed_stats', auth, (req, res) => {
    db.all(`SELECT decision, country, device, os, browser FROM stats WHERE campaign_id = ?`, [req.params.id], (err, rows) => {
        if (err) return res.json({ error: err.message });
        const stats = { main:0, white:0, by_country:{}, by_device:{}, by_os:{}, by_browser:{} };
        rows.forEach(r => {
            if (r.decision==='main') stats.main++; else stats.white++;
            if (r.country) stats.by_country[r.country] = (stats.by_country[r.country]||0)+1;
            if (r.device) stats.by_device[r.device] = (stats.by_device[r.device]||0)+1;
            if (r.os) stats.by_os[r.os] = (stats.by_os[r.os]||0)+1;
            if (r.browser) stats.by_browser[r.browser] = (stats.by_browser[r.browser]||0)+1;
        });
        res.json(stats);
    });
});
app.get('/api/campaigns/:id/download', auth, (req, res) => {
    db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err, camp) => {
        if (!camp) return res.status(404).json({ error: 'Not found' });
        const php = generateAdvancedPHP(camp);
        res.setHeader('Content-Disposition', `attachment; filename="cloak_${camp.id}.php"`);
        res.setHeader('Content-Type', 'application/x-httpd-php');
        res.send(php);
    });
});
app.post('/api/track', (req, res) => {
    const { campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer } = req.body;
    db.run(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer], () => { res.json({ok:true}); });
});
app.post('/api/domains/add', auth, async (req, res) => {
    const { domain, campaign_id } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });
    const token = crypto.randomBytes(16).toString('hex');
    db.run(`INSERT INTO user_domains (user_id, domain, verification_token, campaign_id) VALUES (?, ?, ?, ?)`, [req.userId, domain, token, campaign_id||null], (err) => {
        if (err) return res.status(400).json({ error: 'Domain exists' });
        res.json({ success: true, verification_token: token, message: `Add TXT record: _cloaking-verify.${domain} TXT "${token}"` });
    });
});
app.post('/api/domains/verify', auth, async (req, res) => {
    const { domain } = req.body;
    db.get(`SELECT verification_token, campaign_id FROM user_domains WHERE domain = ? AND user_id = ?`, [domain, req.userId], async (err, row) => {
        if (!row) return res.status(404).json({ error: 'Domain not found' });
        const verified = await verifyCloudflareDomain(domain, row.verification_token);
        if (verified) {
            db.run(`UPDATE user_domains SET verified = 1 WHERE domain = ?`, [domain]);
            let campaign = null;
            if (row.campaign_id) {
                campaign = await new Promise((resolve) => db.get(`SELECT * FROM campaigns WHERE id = ?`, [row.campaign_id], (err, c) => resolve(c)));
            } else {
                campaign = await new Promise((resolve) => db.get(`SELECT * FROM campaigns WHERE user_id = ? LIMIT 1`, [req.userId], (err, c) => resolve(c)));
            }
            if (campaign) {
                const phpCode = generateAdvancedPHP(campaign, domain);
                const domainFolder = path.join(__dirname, 'domains', domain);
                fs.mkdirSync(domainFolder, { recursive: true });
                fs.writeFileSync(path.join(domainFolder, 'index.php'), phpCode);
                if (campaign.white_zip && fs.existsSync(campaign.white_zip)) {
                    fs.copyFileSync(campaign.white_zip, path.join(domainFolder, 'white.zip'));
                }
                res.json({ success: true, message: 'Domain verified. PHP script generated at domains/'+domain+'/index.php' });
            } else {
                res.json({ success: true, message: 'Domain verified but no campaign assigned. Use /domains to assign.' });
            }
        } else {
            res.status(400).json({ error: 'Verification failed. Check TXT record.' });
        }
    });
});

// ---------- Telegram Bot ----------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
async function getTempSession(tid) { return new Promise((resolve) => db.get(`SELECT step, data FROM temp_sessions WHERE telegram_id = ?`, [tid], (err, row) => resolve(row ? { step: row.step, data: row.data ? JSON.parse(row.data) : {} } : { step: null, data: {} }))); }
async function setTempSession(tid, step, data={}) { db.run(`INSERT OR REPLACE INTO temp_sessions (telegram_id, step, data) VALUES (?, ?, ?)`, [tid, step, JSON.stringify(data)]); }
async function clearTempSession(tid) { db.run(`DELETE FROM temp_sessions WHERE telegram_id = ?`, [tid]); }
async function getUserIdByTelegram(tid) { return new Promise((resolve) => db.get(`SELECT id FROM users WHERE telegram_id = ?`, [tid], (err, row) => resolve(row ? row.id : null))); }
async function createUser(email, password, tid) { const hashed = await bcrypt.hash(password, 10); return new Promise((resolve, reject) => { db.run(`INSERT INTO users (email, password, telegram_id) VALUES (?, ?, ?)`, [email, hashed, tid], function(err) { if (err) reject(err); else resolve(this.lastID); }); }); }

bot.start(async (ctx) => {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) {
        await ctx.replyWithMarkdown("🎯 *Professional Cloaking Bot*\n\nWelcome! Please register or link your account.", Markup.inlineKeyboard([[Markup.button.callback('📝 Register', 'reg_new')], [Markup.button.callback('🔗 Link Existing', 'link_existing')]]));
    } else {
        await ctx.replyWithMarkdown("🎯 *Main Menu*", Markup.inlineKeyboard([
            [Markup.button.callback('📋 My Campaigns', 'list_campaigns')],
            [Markup.button.callback('➕ New Campaign', 'new_campaign')],
            [Markup.button.callback('📊 Quick Stats', 'stats_menu')],
            [Markup.button.callback('📈 Detailed Stats', 'detailed_stats_menu')],
            [Markup.button.callback('⬇️ Download Script', 'download_menu')],
            [Markup.button.callback('🌐 Custom Domains', 'custom_domains')]
        ]));
    }
});
bot.action('reg_new', async (ctx) => { await ctx.answerCbQuery(); setTempSession(ctx.from.id, 'reg_email', {}); await ctx.reply('📧 Send your email address:'); });
bot.action('link_existing', async (ctx) => { await ctx.answerCbQuery(); setTempSession(ctx.from.id, 'link_email', {}); await ctx.reply('🔗 Send your registered email:'); });
bot.action('custom_domains', async (ctx) => {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    db.all(`SELECT domain, verified, campaign_id FROM user_domains WHERE user_id = ?`, [userId], (err, rows) => {
        let msg = '🌐 *Your Custom Domains:*\n';
        if (!rows.length) msg += 'No domains added.';
        else rows.forEach(d => { msg += `\n• ${d.domain} – ${d.verified ? '✅ Verified' : '❌ Pending'}\n`; });
        ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([[Markup.button.callback('➕ Add Domain', 'add_domain')]]));
    });
});
bot.action('add_domain', async (ctx) => { await ctx.answerCbQuery(); setTempSession(ctx.from.id, 'add_domain', {}); await ctx.reply('Send your custom domain (e.g., `tracker.yoursite.com`):', { parse_mode: 'Markdown' }); });

// Text handler for all conversations
bot.on('text', async (ctx) => {
    const tid = ctx.from.id, text = ctx.message.text.trim();
    const session = await getTempSession(tid);
    if (!session.step) return;
    // Registration
    if (session.step === 'reg_email') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply('❌ Invalid email.'); session.data.email = text; setTempSession(tid, 'reg_password', session.data); return ctx.reply('🔒 Send password (min 6 chars):'); }
    if (session.step === 'reg_password') { if (text.length<6) return ctx.reply('❌ Min 6 chars.'); session.data.password = text; setTempSession(tid, 'reg_confirm', session.data); return ctx.reply('🔁 Confirm password:'); }
    if (session.step === 'reg_confirm') { if (text !== session.data.password) return ctx.reply('❌ Passwords do not match.'); try { await createUser(session.data.email, session.data.password, tid); await ctx.reply('✅ Registration successful! Press /start.'); clearTempSession(tid); } catch(e) { ctx.reply('❌ Email exists. Use /start → Link.'); clearTempSession(tid); } return; }
    // Link existing
    if (session.step === 'link_email') { db.get(`SELECT id FROM users WHERE email = ?`, [text], async (err, user) => { if (!user) return ctx.reply('❌ No account.'); db.run(`UPDATE users SET telegram_id = ? WHERE id = ?`, [tid, user.id], (err) => { if (err) ctx.reply('Error linking.'); else ctx.reply('✅ Linked! Use /start'); clearTempSession(tid); }); }); return; }
    // Add domain
    if (session.step === 'add_domain') { if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(text)) return ctx.reply('❌ Invalid domain.'); session.data.domain = text; setTempSession(tid, 'assign_campaign', session.data); const userId = await getUserIdByTelegram(tid); db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) { ctx.reply('No campaigns. Create one first.'); clearTempSession(tid); return; } const buttons = rows.map(c => [Markup.button.callback(c.name, `assign_camp_${c.id}`)]); buttons.push([Markup.button.callback('⏭️ Skip', 'assign_skip')]); ctx.reply('Select campaign for this domain:', Markup.inlineKeyboard(buttons)); }); return; }
    // Campaign creation steps
    if (session.step === 'campaign_name') { session.data.name = text; setTempSession(tid, 'offer_url', session.data); return ctx.reply("🔗 *Step 2/8:* Send offer URL (https://...)", { parse_mode: 'Markdown' }); }
    if (session.step === 'offer_url') { if (!text.startsWith('http')) return ctx.reply('❌ Valid URL'); session.data.offer_url = text; setTempSession(tid, 'white_type', session.data); return ctx.replyWithMarkdown("🎨 *Step 3/8:* White page source?", Markup.inlineKeyboard([[Markup.button.callback('🤖 AI Generate', 'white_ai')], [Markup.button.callback('🌐 External URL', 'white_url')]])); }
    if (session.step === 'white_url') { if (!text.startsWith('http')) return ctx.reply('❌ Valid URL'); session.data.white_value = text; setTempSession(tid, 'allowed_os', session.data); return ctx.replyWithMarkdown("💻 *Step 4/8:* Allowed OS (comma, e.g., Windows, macOS, Android) or `skip`", { parse_mode: 'Markdown' }); }
    if (session.step === 'white_niche') { session.data.white_value = text; setTempSession(tid, 'allowed_os', session.data); return ctx.replyWithMarkdown("💻 *Step 4/8:* Allowed OS (comma) or `skip`", { parse_mode: 'Markdown' }); }
    if (session.step === 'allowed_os') { session.data.allowed_os = text.toLowerCase()==='skip'?'':text; setTempSession(tid, 'allowed_browsers', session.data); return ctx.replyWithMarkdown("🌐 *Step 5/8:* Allowed browsers (comma, e.g., Chrome, Firefox, Safari) or `skip`", { parse_mode: 'Markdown' }); }
    if (session.step === 'allowed_browsers') { session.data.allowed_browsers = text.toLowerCase()==='skip'?'':text; setTempSession(tid, 'allowed_countries', session.data); return ctx.replyWithMarkdown("🌍 *Step 6/8:* Allowed countries (2-letter codes, comma, e.g., US,GB,CA) or `skip`", { parse_mode: 'Markdown' }); }
    if (session.step === 'allowed_countries') { session.data.allowed_countries = text.toLowerCase()==='skip'?'':text.toUpperCase(); setTempSession(tid, 'clicks_per_day', session.data); return ctx.reply("🔢 *Step 7/8:* Max clicks per IP per day? (default 15)\nSend number or `skip`", { parse_mode: 'Markdown' }); }
    if (session.step === 'clicks_per_day') { let clicks = 15; if (text.toLowerCase()!=='skip') { let n = parseInt(text); if (isNaN(n)||n<=0) return ctx.reply('❌ Send a positive number.'); clicks=n; } session.data.clicks_per_day = clicks; setTempSession(tid, 'block_vpn', session.data); return ctx.replyWithMarkdown("🛡️ *Step 8/8:* Block VPN/Proxy?", Markup.inlineKeyboard([[Markup.button.callback('✅ Yes', 'block_vpn_yes')], [Markup.button.callback('❌ No', 'block_vpn_no')]])); }
});
bot.action('white_ai', async (ctx) => { await ctx.answerCbQuery(); const session = await getTempSession(ctx.from.id); if (session && session.step==='white_type') { session.data.white_type='ai'; setTempSession(ctx.from.id, 'white_niche', session.data); await ctx.reply("🧠 Send niche for AI white page (e.g., 'iPhone 15 Giveaway')"); } });
bot.action('white_url', async (ctx) => { await ctx.answerCbQuery(); const session = await getTempSession(ctx.from.id); if (session && session.step==='white_type') { session.data.white_type='url'; setTempSession(ctx.from.id, 'white_url', session.data); await ctx.reply("🔗 Send the white page URL (https://...)"); } });
bot.action('block_vpn_yes', async (ctx) => { await ctx.answerCbQuery(); const session = await getTempSession(ctx.from.id); if (session && session.step==='block_vpn') { session.data.block_vpn=true; await finishCampaignCreation(ctx, session.data); } });
bot.action('block_vpn_no', async (ctx) => { await ctx.answerCbQuery(); const session = await getTempSession(ctx.from.id); if (session && session.step==='block_vpn') { session.data.block_vpn=false; await finishCampaignCreation(ctx, session.data); } });
async function finishCampaignCreation(ctx, data) {
    const userId = await getUserIdByTelegram(ctx.from.id);
    if (!userId) return ctx.reply('Not linked.');
    await ctx.reply('⏳ Creating campaign...');
    const id = crypto.randomUUID();
    let whiteZip = null, whiteValue = data.white_value;
    if (data.white_type === 'ai') { whiteZip = await generateMultiFileWhitePage(data.white_value); whiteValue = ''; }
    db.run(`INSERT INTO campaigns (id, user_id, name, offer_url, white_type, white_value, white_zip, allowed_os, allowed_browsers, allowed_countries, clicks_per_day, block_vpn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, data.name, data.offer_url, data.white_type, whiteValue, whiteZip, data.allowed_os||null, data.allowed_browsers||null, data.allowed_countries||null, data.clicks_per_day||15, data.block_vpn?1:0], (err) => {
        if (err) ctx.reply('❌ Error: '+err.message);
        else ctx.replyWithMarkdown(`✅ *Campaign Created!*\n\nName: ${data.name}\nID: \`${id}\`\nUse /download ${id} to get the cloaking script.`);
        clearTempSession(ctx.from.id);
    });
}
bot.action('list_campaigns', async (ctx) => { await ctx.answerCbQuery(); const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.all(`SELECT id, name, offer_url FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) return ctx.reply('No campaigns.'); let msg = '📋 *Your Campaigns:*\n'; rows.forEach(c => { msg += `\n🔹 *${c.name}*\n   ID: \`${c.id}\`\n   Offer: ${c.offer_url}\n`; }); ctx.replyWithMarkdown(msg); }); });
bot.action('stats_menu', async (ctx) => { await ctx.answerCbQuery(); const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) return ctx.reply('No campaigns.'); const btns = rows.map(c => [Markup.button.callback(c.name, `stats_${c.id}`)]); ctx.reply('Select campaign for quick stats:', Markup.inlineKeyboard(btns)); }); });
bot.action(/stats_(.+)/, async (ctx) => { await ctx.answerCbQuery(); const cid=ctx.match[1]; db.get(`SELECT COUNT(CASE WHEN decision='main' THEN 1 END) as main, COUNT(CASE WHEN decision='white' THEN 1 END) as white FROM stats WHERE campaign_id = ?`, [cid], (err,row) => { ctx.replyWithMarkdown(`📊 *Quick Stats*\n✅ Main: ${row?.main||0}\n❌ White: ${row?.white||0}`); }); });
bot.action('detailed_stats_menu', async (ctx) => { await ctx.answerCbQuery(); const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) return ctx.reply('No campaigns.'); const btns = rows.map(c => [Markup.button.callback(c.name, `dstats_${c.id}`)]); ctx.reply('Select campaign for detailed stats:', Markup.inlineKeyboard(btns)); }); });
bot.action(/dstats_(.+)/, async (ctx) => { await ctx.answerCbQuery(); const cid=ctx.match[1]; const userId = await getUserIdByTelegram(ctx.from.id); const token = jwt.sign({ id: userId }, process.env.JWT_SECRET); try { const res = await axios.get(`${process.env.RENDER_EXTERNAL_URL}/api/campaigns/${cid}/detailed_stats`, { headers: { Authorization: `Bearer ${token}` } }); const s = res.data; let msg = `📊 *Detailed Stats*\n✅ Main: ${s.main}\n❌ White: ${s.white}\n\n*By Country:*\n`; for (let [k,v] of Object.entries(s.by_country)) msg += `${k}: ${v}\n`; msg += `\n*By Device:*\n`; for (let [k,v] of Object.entries(s.by_device)) msg += `${k}: ${v}\n`; msg += `\n*By OS:*\n`; for (let [k,v] of Object.entries(s.by_os)) msg += `${k}: ${v}\n`; msg += `\n*By Browser:*\n`; for (let [k,v] of Object.entries(s.by_browser)) msg += `${k}: ${v}\n`; ctx.replyWithMarkdown(msg); } catch(e) { ctx.reply('Error fetching stats.'); } });
bot.action('download_menu', async (ctx) => { await ctx.answerCbQuery(); const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) return ctx.reply('No campaigns.'); const btns = rows.map(c => [Markup.button.callback(c.name, `download_${c.id}`)]); ctx.reply('Select campaign to download script:', Markup.inlineKeyboard(btns)); }); });
bot.action(/download_(.+)/, async (ctx) => { await ctx.answerCbQuery(); const cid=ctx.match[1]; const userId = await getUserIdByTelegram(ctx.from.id); db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [cid, userId], (err, camp) => { if (!camp) return ctx.reply('Not found.'); const php = generateAdvancedPHP(camp); ctx.replyWithDocument({ source: Buffer.from(php,'utf-8'), filename: `cloak_${cid}.php` }); }); });
// Handle campaign assignment from domain add
bot.action(/assign_camp_(.+)/, async (ctx) => { await ctx.answerCbQuery(); const campId = ctx.match[1]; const session = await getTempSession(ctx.from.id); const domain = session.data?.domain; if (!domain) return ctx.reply('Session expired.'); const userId = await getUserIdByTelegram(ctx.from.id); const token = crypto.randomBytes(16).toString('hex'); db.run(`INSERT INTO user_domains (user_id, domain, verification_token, campaign_id) VALUES (?, ?, ?, ?)`, [userId, domain, token, campId], (err) => { if (err) return ctx.reply('Domain already exists.'); ctx.replyWithMarkdown(`✅ Domain added.\n\nAdd this TXT record:\n\`_cloaking-verify.${domain} TXT "${token}"\`\nThen click "Custom Domains" → Verify.`); clearTempSession(ctx.from.id); }); });
bot.action('assign_skip', async (ctx) => { await ctx.answerCbQuery(); const session = await getTempSession(ctx.from.id); const domain = session.data?.domain; if (!domain) return ctx.reply('Session expired.'); const userId = await getUserIdByTelegram(ctx.from.id); const token = crypto.randomBytes(16).toString('hex'); db.run(`INSERT INTO user_domains (user_id, domain, verification_token) VALUES (?, ?, ?)`, [userId, domain, token], (err) => { if (err) return ctx.reply('Domain exists.'); ctx.replyWithMarkdown(`✅ Domain added without campaign.\n\nTXT record:\n\`_cloaking-verify.${domain} TXT "${token}"\`\nThen verify.`); clearTempSession(ctx.from.id); }); });
bot.command('download', async (ctx) => { const args = ctx.message.text.split(' '); if (args.length<2) return ctx.reply('Usage: /download <campaign_id>'); const cid = args[1]; const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.get(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`, [cid, userId], (err, camp) => { if (!camp) return ctx.reply('Not found.'); const php = generateAdvancedPHP(camp); ctx.replyWithDocument({ source: Buffer.from(php,'utf-8'), filename: `cloak_${cid}.php` }); }); });
bot.command('detailed_stats', async (ctx) => { const userId = await getUserIdByTelegram(ctx.from.id); if (!userId) return ctx.reply('Not linked.'); db.all(`SELECT id, name FROM campaigns WHERE user_id = ?`, [userId], (err, rows) => { if (!rows.length) return ctx.reply('No campaigns.'); const btns = rows.map(c => [Markup.button.callback(c.name, `dstats_${c.id}`)]); ctx.reply('Select campaign:', Markup.inlineKeyboard(btns)); }); });

// Webhook setup
const WEBHOOK_PATH = '/telegram-webhook';
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || process.env.DOMAIN}${WEBHOOK_PATH}`;
bot.telegram.setWebhook(WEBHOOK_URL).catch(e => console.error(e));
app.use(bot.webhookCallback(WEBHOOK_PATH));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
