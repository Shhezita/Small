const express = require('express');
const cors = require('cors');
const CryptoJS = require("crypto-js");
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN TFG (USER SETTINGS)
// ==========================================
const AUTO_LICENSE_MODE = true; // Default for TFG
// Keys identified by user analysis:
const CLIENT_REQ_KEY = "";      // Client encrypts requests with empty key
const CLIENT_RES_KEY = "sugi";  // Client decrypts responses with "sugi"

// CONSTANTES
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFy";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// TELEGRAM CONFIG
const TELEGRAM_TOKEN = "8478009189:AAHCYK4Dmefy2I8UL8TwWeB-1aYS6LcSCy0";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
// Server-side secret for Stateless Tokens (never shared with client)
const TOKEN_KEY = CryptoJS.SHA256(TELEGRAM_TOKEN + "STATELESS_SECRET");

// Middleware
app.set('etag', false);
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Aggressive Cache Disabling
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});

// Base de datos volátil (In-Memory)
let packs = [];
let telegramUsers = new Map(); // userId -> chatId (Cache only, main source is Stateless Token)
let telegramChats = new Map(); // chatId -> userId
let userPreferences = new Map(); // userId -> prefs

let botStatus = "Initializing...";
let botUsername = "Unknown";

// ==========================================
//  TELEGRAM BOT SETUP
// ==========================================
let bot;

// Helper to notify user (Fallback for local map, primary is Stateless Token)
const notifyUser = (userId, type, message) => {
    const chatId = telegramUsers.get(userId);
    if (!chatId || !bot) return false;

    const prefs = userPreferences.get(userId) || { pm: true, gm: true, bt: true, ge: true };

    if (type === 'PM' && !prefs.pm) return false;
    if (type === 'GM' && !prefs.gm) return false;
    if (type === 'BT' && !prefs.bt) return false;
    if (type === 'GE' && !prefs.ge) return false;

    bot.sendMessage(chatId, message).catch(err => console.error(`[TELEGRAM] Send failed: ${err.message}`));
    return true;
};

// ==========================================
//  STATELESS TOKEN HELPERS
// ==========================================
const generateStatelessToken = (userId, chatId = null) => {
    // Format: "userId|expiry|chatId"
    const expiry = Date.now() + 5184000000; // 60 days
    const rawData = `${userId}|${expiry}|${chatId || ''}`;

    // Encrypt using AES ECB with Server Secret
    const encrypted = CryptoJS.AES.encrypt(rawData, TOKEN_KEY, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });

    return encrypted.toString();
};

const verifyStatelessToken = (tokenString) => {
    try {
        const decrypted = CryptoJS.AES.decrypt(tokenString, TOKEN_KEY, {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7
        });

        const rawData = decrypted.toString(CryptoJS.enc.Utf8);
        if (!rawData) return null;

        const [userId, expiryStr, chatId] = rawData.split('|');
        if (!userId || !expiryStr) return null;

        const expiry = parseInt(expiryStr);
        if (Date.now() > expiry) return null;

        return { userId, chatId: chatId || null };
    } catch (e) {
        // console.error("Token verification failed:", e.message);
        return null;
    }
};

if (TELEGRAM_TOKEN) {
    try {
        if (VERCEL_URL) {
            bot = new TelegramBot(TELEGRAM_TOKEN);
            bot.setWebHook(`${VERCEL_URL}/telegram/webhook`);
            console.log(`[TELEGRAM] Webhook set to ${VERCEL_URL}/telegram/webhook`);
        } else {
            bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
            console.log(`[TELEGRAM] Polling mode started`);
        }

        bot.getMe().then((me) => {
            botStatus = "Online";
            botUsername = me.username;
            console.log(`[TELEGRAM] Bot Connected! @${me.username}`);

            bot.setMyCommands([
                { command: '/start', description: 'Start or Link Account' },
                { command: '/status', description: 'Check Connection' },
                { command: '/unlink', description: 'Unlink Account' },
                { command: '/help', description: 'Show Help' }
            ]).catch(err => console.error(`[TELEGRAM] Cmd Reg Error: ${err.message}`));
        }).catch(err => {
            botStatus = `Error: ${err.message}`;
            console.error(`[TELEGRAM] Connect Error: ${err.message}`);
        });

        // Command: /start (with or without token)
        bot.onText(/\/start(?: (.+))?/, (msg, match) => {
            const chatId = msg.chat.id;
            const token = match[1];

            if (token) {
                // Verify the token sent from Game (could be initial temporary token or existing)
                // For initial linking, we expect a valid userId.
                // We try to decode it as a stateless token first.
                let userId = null;
                const decoded = verifyStatelessToken(token);
                if (decoded) userId = decoded.userId;

                // If not a stateless token, maybe it's a raw ID? (Less secure, but possible if user types it)
                // We'll stick to requiring a generated token from the game.

                if (userId) {
                    telegramUsers.set(userId, chatId);
                    telegramChats.set(chatId, userId);

                    // Generate NEW Stateless Token WITH ChatID
                    const newToken = generateStatelessToken(userId, chatId);

                    bot.sendMessage(chatId, `✅ *Account Linked!*
                    
⚠️ *IMPORTANT ACTION REQUIRED* ⚠️
Since the server is stateless (Vercel), you MUST update your game settings with this new code to receive notifications:

\`${newToken}\`

1. Copy the code above.
2. Go to Game Settings -> Telegram.
3. Paste it into the "Access Token" field.
`, { parse_mode: 'Markdown' });

                    console.log(`[TELEGRAM] Linked chat ${chatId} to user ${userId}`);
                } else {
                    bot.sendMessage(chatId, "❌ Invalid or expired token. Please generate a new one from the game settings.");
                }
            } else {
                if (telegramChats.has(chatId)) {
                    bot.sendMessage(chatId, "👋 You are already linked! Type /status to check.");
                } else {
                    bot.sendMessage(chatId, "👋 Welcome! To link, click 'Get Access Token' in game settings, then open the bot link.");
                }
            }
        });

        bot.onText(/\/help/, (msg) => {
            bot.sendMessage(msg.chat.id, "Commands:\n/start - Link\n/status - Check\n/unlink - Unlink");
        });

        bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            if (telegramChats.has(chatId)) {
                bot.sendMessage(chatId, `✅ Linked to User ID: \`${telegramChats.get(chatId)}\``, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "❌ Not linked.");
            }
        });

        bot.onText(/\/unlink/, (msg) => {
            const chatId = msg.chat.id;
            if (telegramChats.has(chatId)) {
                const userId = telegramChats.get(chatId);
                telegramUsers.delete(userId);
                telegramChats.delete(chatId);
                bot.sendMessage(chatId, "🔓 Unlinked.");
            } else {
                bot.sendMessage(chatId, "Not linked.");
            }
        });

    } catch (error) {
        console.error("[TELEGRAM] Init Error:", error.message);
    }
}

// ==========================================
//  UTILIDADES
// ==========================================
const encryptResponse = (data) => {
    // Encrypt response with CLIENT_RES_KEY ("sugi")
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, CLIENT_RES_KEY).toString();
    return encrypted;
};

// ==========================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path.startsWith('/telegram')) return next();
    if (req.path === '/favicon.ico' || req.path === '/favicon.png') return next();

    const token = req.headers['x-token'];
    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        // Decrypt request with CLIENT_REQ_KEY ("")
        const bytes = CryptoJS.AES.decrypt(token, CLIENT_REQ_KEY);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) throw new Error("Decryption empty");
        req.user = JSON.parse(decryptedString);
    } catch (error) {
        console.error(`[AUTH] Token Fail: ${error.message}`);
        req.user = { userId: 'unknown' };
    }
    next();
};

app.use(verifyXToken);

// ==========================================
//  SISTEMA DE LICENCIAS
// ==========================================
const checkUserLicense = (userId) => {
    console.log(`[LICENSE] Checking: ${userId}`);
    if (AUTO_LICENSE_MODE) return { valid: true, days: 999, type: 'TFG_AUTO' };

    const allowedIdsString = process.env.ALLOWED_IDS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());
    if (allowedIds.includes(userId.toString())) return { valid: true, days: 365, type: 'PRO_MANUAL' };
    return { valid: false, days: 0 };
};

const handleCheckLicense = (req, res) => {
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;
    const finalId = targetId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(400).send(encryptResponse({ error: "No ID" }));

    const status = checkUserLicense(finalId);
    const responseData = {
        licence: SAFE_LICENSE,
        days: status.days,
        object: {
            valid: status.valid,
            until: "2099-12-31",
            type: status.type,
            q: "activated"
        }
    };
    res.send(encryptResponse(responseData));
};

const handleCheckVersion = (req, res) => {
    res.send(encryptResponse({
        valid: true,
        url: "https://small-mu.vercel.app/download",
        version: req.params.version || "9.9.9"
    }));
};

const handleFreeLicense = (req, res) => {
    res.send(encryptResponse({
        licence: SAFE_LICENSE,
        days: 1,
        object: { valid: true, type: "TRIAL", q: "activated" }
    }));
};

app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license', '/check-licence/v2/check/'], handleCheckLicense);
app.all(['/check-licence/free', '/check-licence/v2/free', '/api/v2/free'], handleFreeLicense);
app.all(['/check-licence/v2/check-version/:version', '/check-version'], handleCheckVersion);

// ==========================================
//  SISTEMA DE PAQUETES
// ==========================================
app.post('/pack/request', (req, res) => {
    if (packs.length > 500) packs = packs.slice(-200);
    const clientId = req.user.userId !== 'unknown' ? req.user.userId : req.body.clientId;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });

    const newPack = {
        _id: Math.random().toString(36).substr(2, 9),
        clientId: clientId.toString(),
        bankId: req.body.bankId ? req.body.bankId.toString() : "0",
        goldAmount: parseInt(req.body.goldAmount || 0),
        duration: parseInt(req.body.duration || 0),
        state: 'pending',
        createdAt: Date.now(),
        metaData: { basis: "14-1", quality: 0, level: 1, soulboundTo: null }
    };
    packs.push(newPack);
    console.log(`[PACK] Created ${newPack._id} for ${clientId}`);
    res.json(newPack);
});

const handleGetPending = (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId) return res.status(400).json({ error: "ID missing" });
    res.json(packs.filter(p => p.bankId === playerId.toString() && p.state === 'pending'));
};

const handleGetReady = (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId) return res.status(400).json({ error: "ID missing" });
    res.json(packs.filter(p => p.clientId === playerId.toString() && p.state === 'ready'));
};

app.get(['/pack/pending/:playerId', '/pack/pending'], handleGetPending);
app.get(['/pack/ready/:playerId', '/pack/ready'], handleGetReady);

app.patch('/pack/state', (req, res) => {
    const { packId, state } = req.body;
    const packIndex = packs.findIndex(p => p._id === packId);
    if (packIndex !== -1) {
        packs[packIndex].state = state;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Pack not found" });
    }
});

app.delete('/pack/:id', (req, res) => {
    packs = packs.filter(p => p._id !== req.params.id);
    res.json({ success: true });
});

// ==========================================
//  RUTAS DE TELEGRAM
// ==========================================

// 1. Generate Initial Token (for linking)
app.post('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).json({ error: "Unauthorized" });

    // Generate a temporary stateless token for linking (no ChatID yet)
    const token = generateStatelessToken(finalId);
    const expiresAt = Date.now() + 5184000000; // 60 days

    console.log(`[TELEGRAM] Generated token for ${finalId}`);
    res.json({
        access_token: token,
        expires: expiresAt,
        botName: botUsername
    });
});

app.get('/telegram/token', (req, res) => {
    // Same as POST for convenience
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).json({ error: "Unauthorized" });

    const token = generateStatelessToken(finalId);
    res.json({ access_token: token, botName: botUsername });
});

// 2. Webhook
app.post('/telegram/webhook', (req, res) => {
    if (bot) bot.processUpdate(req.body);
    res.sendStatus(200);
});
app.get('/telegram/webhook', (req, res) => res.send("Telegram Webhook Active"));

// 3. Notify (The core function)
app.post('/telegram/notify', (req, res) => {
    console.log(`[TELEGRAM] Notify: ${JSON.stringify(req.body)}`);
    let userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const { message, type } = req.body;

    let explicitChatId = null;

    // Verify Token
    if (userId) {
        const decoded = verifyStatelessToken(userId);
        if (decoded && decoded.userId) {
            userId = decoded.userId;
            explicitChatId = decoded.chatId;
            console.log(`[TELEGRAM] Token Verified. User: ${userId}, Chat: ${explicitChatId}`);
        } else {
            console.log("[TELEGRAM] Invalid Token");
            return res.status(401).send(encryptResponse({ error: "Invalid Token" }));
        }
    }

    if (!userId) return res.status(401).send(encryptResponse({ error: "Unauthorized" }));

    let sent = false;
    if (explicitChatId && bot) {
        // Stateless Send
        bot.sendMessage(explicitChatId, message).catch(err => console.error(`[TELEGRAM] Send Error: ${err.message}`));
        sent = true;
    } else {
        // Fallback to local map (unlikely to work on Vercel, but good for local dev)
        sent = notifyUser(userId, type || 'PM', message);
    }

    if (sent) {
        res.send(encryptResponse({ success: true }));
    } else {
        res.status(200).send(encryptResponse({ success: false, reason: "Not linked" }));
    }
});

// ==========================================
//  ADMIN & STATUS
// ==========================================
app.get('/admin/config', (req, res) => {
    res.json({
        status: "online",
        auto_license: AUTO_LICENSE_MODE,
        bot: botStatus
    });
});

app.get('/favicon.png', (req, res) => res.status(204).end());
app.get('/', (req, res) => res.send('Hostile Server V5 (Integrated).'));

// Error Handler
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${err.message}`);
    res.status(500).json({ error: "Internal Error" });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on ${PORT}`);
    });
}

module.exports = app;
