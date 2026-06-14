// server.js – with Telegram registration (no website needed)
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
    db.run(`CREATE TABLE IF NOT EXISTS campaigns (... same as before ...)`);
    db.run(`CREATE TABLE IF NOT EXISTS stats (...)`);
    db.run(`CREATE TABLE IF NOT EXISTS temp_sessions (...)`);
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static('public'));

// Helper: AI white page (same as before)
async function generateWhitePage(niche) { /* ... same code ... */ }

// Helper: generateIndexPHP (same as before)
function generateIndexPHP(campaign) { /* ... same fixed code ... */ }

// Auth middleware, API routes (same as before) - omitted for brevity, but include all previous routes

// ---------- Telegram Bot with Registration ----------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function getTempSession(telegramId) { /* same */ }
async function setTempSession(telegramId, step, data = {}) { /* same */ }
async function clearTempSession(telegramId) { /* same */ }
async function getUserIdByTelegram(telegramId) { /* same */ }

// New: Create user from Telegram
async function createUser(email, password, telegramId) {
    const hashed = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO users (email, password, telegram_id) VALUES (?, ?, ?)`, [email, hashed, telegramId], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegram(telegramId);
    if (!userId) {
        // Show registration options
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
        // Main menu (same as before)
        await ctx.reply(`Welcome back!`, Markup.inlineKeyboard([
            [Markup.button.callback('📋 My Campaigns', 'list_campaigns')],
            [Markup.button.callback('➕ New Campaign', 'new_campaign')],
            [Markup.button.callback('📊 Stats', 'stats_menu')],
            [Markup.button.callback('⬇️ Download Script', 'download_menu')]
        ]));
    }
});

// Register new account flow
bot.action('register_new', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    setTempSession(telegramId, 'reg_email', {});
    await ctx.reply('📧 Send your email address:');
});

bot.action('link_existing', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    setTempSession(telegramId, 'link_email', {});
    await ctx.reply('🔗 Send the email address of your existing account:');
});

// Handle all text inputs (registration & linking)
bot.on('text', async (ctx) => {
    const telegramId = ctx.from.id;
    const session = await getTempSession(telegramId);
    const text = ctx.message.text.trim();

    // Registration: step 1 - email
    if (session.step === 'reg_email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
            return ctx.reply('❌ Invalid email. Send again:');
        }
        session.data.email = text;
        setTempSession(telegramId, 'reg_password', session.data);
        await ctx.reply('🔒 Send a password (min 6 characters):');
    }
    // Registration: step 2 - password
    else if (session.step === 'reg_password') {
        if (text.length < 6) {
            return ctx.reply('❌ Password must be at least 6 characters. Send again:');
        }
        session.data.password = text;
        setTempSession(telegramId, 'reg_confirm', session.data);
        await ctx.reply('🔁 Confirm password (type again):');
    }
    // Registration: step 3 - confirm password
    else if (session.step === 'reg_confirm') {
        if (text !== session.data.password) {
            return ctx.reply('❌ Passwords do not match. Start over with /start');
        }
        try {
            const userId = await createUser(session.data.email, session.data.password, telegramId);
            await ctx.reply('✅ Registration successful! You can now use the bot.\nPress /start to continue.');
            clearTempSession(telegramId);
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                await ctx.reply('❌ Email already registered. Use /start and choose "Link Existing Account" or different email.');
            } else {
                await ctx.reply('❌ Error creating account. Try again later.');
            }
            clearTempSession(telegramId);
        }
    }
    // Linking existing account
    else if (session.step === 'link_email') {
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
    }
    // New campaign conversation (as before)
    else if (session.step === 'new_campaign_name') {
        // ... (same as previous)
    }
    // ... other steps
});

// Rest of bot actions (list_campaigns, new_campaign, stats_menu, etc.) same as previous
// ... (copy from previous full server.js)

// Webhook setup
const WEBHOOK_PATH = '/telegram-webhook';
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || process.env.DOMAIN}${WEBHOOK_PATH}`;
bot.telegram.setWebhook(WEBHOOK_URL);
app.use(bot.webhookCallback(WEBHOOK_PATH));

app.listen(process.env.PORT, () => console.log(`Server running`));
