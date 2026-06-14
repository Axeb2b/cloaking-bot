// server.js – Main entry point
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static('public'));

// ---------- Helper: AI White Page Generator ----------
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

// ---------- Helper: Generate index.php for a campaign ----------
function generateIndexPHP(campaign) {
    const { id, offer_url, white_html, clicks_per_ip, clicks_before_filter,
            block_vpn, block_ipv6, block_no_isp, block_no_referrer,
            countries_allowed, devices_allowed, os_allowed, browsers_allowed } = campaign;
    // ... (same as earlier index.php generator)
    return `<?php ... ?>`;
}

// ---------- User Routes ----------
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, plan) VALUES (?, ?, 'free')`, [email, hashed], function(err) {
        if (err) return res.status(400).json({ error: 'Email already exists' });
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
        res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
    });
});

// ---------- Campaign Routes (require auth middleware) ----------
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

app.post('/api/campaigns', auth, async (req, res) => {
    const { name, offer_url, white_niche, clicks_per_ip, clicks_before_filter,
            block_vpn, block_ipv6, block_no_isp, block_no_referrer } = req.body;
    const id = crypto.randomUUID();
    // Generate white page using AI
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

// ---------- Cloaking Endpoint (for index.php to call) ----------
app.post('/api/track', (req, res) => {
    const { campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer } = req.body;
    db.run(`INSERT INTO stats (campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [campaign_id, ip, user_agent, decision, country, isp, device, os, browser, referrer], (err) => {
        res.json({ ok: true });
    });
});

// ---------- Subscription Plans ----------
const plans = {
    free: { price: 0, campaigns: 1, clicks: 1000 },
    pro: { price: 49, campaigns: 10, clicks: 50000 },
    business: { price: 199, campaigns: 100, clicks: 1000000 }
};

app.post('/api/create-checkout-session', auth, async (req, res) => {
    const { plan } = req.body;
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price_data: { currency: 'usd', product_data: { name: `${plan.toUpperCase()} Plan` }, unit_amount: plans[plan].price * 100 }, quantity: 1 }],
        mode: 'payment',
        success_url: `${req.headers.origin}/dashboard?success=1`,
        cancel_url: `${req.headers.origin}/pricing?canceled=1`,
        metadata: { userId: req.userId, plan }
    });
    res.json({ id: session.id });
});

// Webhook for Stripe
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

// ---------- Telegram Bot ----------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.start((ctx) => ctx.reply('Welcome to Cloaking Bot! Use /new to create campaign, /list, /stats, /download'));
// ... add bot commands similar to earlier bot code (campaign creation, list, download)
bot.launch();

// ---------- Frontend Dashboard (HTML) ----------
app.get('/', (req, res) => res.sendFile(__dirname + '/views/index.html'));
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/views/dashboard.html'));
app.get('/admin', (req, res) => {
    // simple admin check (email from env)
    res.sendFile(__dirname + '/views/admin.html');
});

app.listen(process.env.PORT, () => console.log(`Server on port ${process.env.PORT}`));
