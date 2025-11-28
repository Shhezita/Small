const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const CryptoJS = require("crypto-js");
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN TFG
// ==========================================
const AUTO_LICENSE_MODE = true;
const ENCRYPTION_KEY = "";

// CONSTANTES
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFy";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// TELEGRAM CONFIG
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8478009189:AAHCYK4Dmefy2I8UL8TwWeB-1aYS6LcSCy0";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

// Middleware
app.set('etag', false); // Disable ETags to prevent 304 responses
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Aggressive Cache Disabling
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});

// Base de datos volátil
let packs = [];
let telegramTokens = new Map();
let telegramUsers = new Map();
let telegramChats = new Map();

// ==========================================
//  TELEGRAM BOT SETUP
// ==========================================
let bot;
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN") {
    try {
        if (VERCEL_URL) {
            bot = new TelegramBot(TELEGRAM_TOKEN);
            bot.setWebHook(`${VERCEL_URL}/telegram/webhook`);
            console.log(`[TELEGRAM] Webhook set to ${VERCEL_URL}/telegram/webhook`);
        } else {
            bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
            console.log(`[TELEGRAM] Polling mode started`);
        }

        bot.onText(/\/start (.+)/, (msg, match) => {
            const chatId = msg.chat.id;
            const token = match[1];

            if (telegramTokens.has(token)) {
                const userId = telegramTokens.get(token);
                telegramUsers.set(userId, chatId);
                telegramChats.set(chatId, userId);
                telegramTokens.delete(token);

                bot.sendMessage(chatId, "✅ Account successfully linked! You will now receive notifications here.");
                console.log(`[TELEGRAM] Linked chat ${chatId} to user ${userId}`);
            } else {
                bot.sendMessage(chatId, "❌ Invalid or expired token. Please generate a new one from the game.");
            }
        });

        bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                const chatId = msg.chat.id;
                const userId = telegramChats.get(chatId);
                if (userId) {
                    bot.sendMessage(chatId, `Received: ${msg.text} (This is a reply placeholder)`);
                }
            }
        });

        console.log("[TELEGRAM] Bot initialized successfully");
    } catch (error) {
        console.error("[TELEGRAM] Error initializing bot:", error.message);
    }
} else {
    console.log("[TELEGRAM] No token provided. Bot disabled.");
}

// ==========================================
//  UTILIDADES
// ==========================================
const encryptResponse = (data) => {
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, "sugi").toString();
    return encrypted;
};

// ==========================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    if (req.path.startsWith('/admin')) {
        const authHeader = req.headers['authorization'];
        if (authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
            return res.status(403).json({ error: "Forbidden: Admin Access Only" });
        }
        return next();
    }

    // Public routes
    if (req.path === '/telegram/webhook' || req.path === '/favicon.ico' || req.path === '/favicon.png') {
        return next();
    }

    const token = req.headers['x-token'];
    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        const bytes = CryptoJS.AES.decrypt(token, ENCRYPTION_KEY);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) throw new Error("Decryption empty");
        req.user = JSON.parse(decryptedString);
    } catch (error) {
        console.error(`[AUTH] Fallo token: ${error.message}`);
        req.user = { userId: 'unknown' };
    }
    next();
};

app.use(verifyXToken);

// ==========================================
//  SISTEMA DE LICENCIAS
// ==========================================
const checkUserLicense = (userId) => {
    if (AUTO_LICENSE_MODE) {
        return { valid: true, days: 999, type: 'TFG_AUTO' };
    }

    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.replace(/['"]/g, '').split(',').map(id => id.trim());
    allowedIds.push("10765579");

    if (allowedIds.includes(userId.toString())) {
        return { valid: true, days: 365, type: 'PRO_MANUAL' };
    }
    return { valid: false, days: 0 };
};

const handleCheckLicense = (req, res) => {
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;
    const finalId = targetId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) {
        return res.status(400).send(encryptResponse({ error: "No Player ID identified" }));
    }

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
    const responseData = {
        valid: true,
        url: "https://small-mu.vercel.app/download",
        version: req.params.version || "9.9.9"
    };
    res.send(encryptResponse(responseData));
};

const handleFreeLicense = (req, res) => {
    const responseData = {
        licence: SAFE_LICENSE,
        days: 1,
        object: {
            valid: true,
            type: "TRIAL",
            q: "activated"
        }
    };
    res.send(encryptResponse(responseData));
};

// Rutas de Licencia
app.all('/check-licence/v2/check/', handleCheckLicense);
app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license'], handleCheckLicense);
app.all(['/check-licence/free', '/check-licence/v2/free', '/api/v2/free'], handleFreeLicense);
app.all(['/check-licence/v2/check-version/*', '/check-version'], handleCheckVersion);

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

// Generate Token
app.post('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) {
        return res.status(401).json({ error: "Unauthorized: No User ID found" });
    }

    const token = Math.random().toString(36).substr(2, 8).toUpperCase();
    telegramTokens.set(token, finalId);
    setTimeout(() => telegramTokens.delete(token), 600000);

    console.log(`[TELEGRAM] Generated token ${token} for user ${finalId}`);
    res.json({ token });
});

// Get Token (Check if linked)
app.get('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).json({ error: "Unauthorized" });

    const chatId = telegramUsers.get(finalId);
    // Explicitly set 200 to override any 304 behavior if ETag disabling fails
    res.status(200).json({ linked: !!chatId, chatId });
});

// Delete Token (Unlink)
app.delete('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).json({ error: "Unauthorized" });

    if (telegramUsers.has(finalId)) {
        const chatId = telegramUsers.get(finalId);
        telegramUsers.delete(finalId);
        telegramChats.delete(chatId);
    }
    res.json({ success: true });
});

// Webhook
app.post('/telegram/webhook', (req, res) => {
    if (bot) bot.processUpdate(req.body);
    res.sendStatus(200);
});
app.get('/telegram/webhook', (req, res) => res.send("Telegram Webhook Active"));

// Notify
app.post('/telegram/notify', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const { message } = req.body;

    if (!userId || userId === 'unknown') return res.status(401).json({ error: "Unauthorized" });

    const chatId = telegramUsers.get(userId);
    if (chatId && bot) {
        bot.sendMessage(chatId, message);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "User not linked or bot inactive" });
    }
});

// ==========================================
//  ASSETS & ADMIN
// ==========================================

// Favicon Redirect to Telegram Logo
app.get('/favicon.png', (req, res) => {
    res.redirect('https://telegram.org/img/t_logo.png');
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/admin/config', (req, res) => {
    res.json({
        server_status: "online",
        auto_license_mode: AUTO_LICENSE_MODE,
        telegramLinks: telegramUsers.size
    });
});

app.get('/', (req, res) => res.send('Hostile Server V7 (No-Cache) Active.'));

// Catch-All 404
app.use((req, res) => {
    console.log(`[404] Missing Endpoint: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "Endpoint not found" });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
    });
}

module.exports = app;
