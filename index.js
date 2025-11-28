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
// HARDCODED TOKEN
const TELEGRAM_TOKEN = "8478009189:AAHCYK4Dmefy2I8UL8TwWeB-1aYS6LcSCy0";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

// Middleware
app.set('etag', false);
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
let telegramTokens = new Map(); // token -> userId
let userTokens = new Map(); // userId -> { token, expiresAt }
let telegramUsers = new Map(); // userId -> chatId
let telegramChats = new Map(); // chatId -> userId
let userPreferences = new Map(); // userId -> { pm: bool, gm: bool, bt: bool, ge: bool }
let botStatus = "Initializing...";
let botUsername = "Unknown";

// ==========================================
//  TELEGRAM BOT SETUP
// ==========================================
let bot;

// Helper to notify user based on preferences
const notifyUser = (userId, type, message) => {
    const chatId = telegramUsers.get(userId);
    if (!chatId || !bot) return false;

    const prefs = userPreferences.get(userId) || { pm: true, gm: true, bt: true, ge: true };

    // Check preferences
    if (type === 'PM' && !prefs.pm) return false;
    if (type === 'GM' && !prefs.gm) return false;
    if (type === 'BT' && !prefs.bt) return false;
    if (type === 'GE' && !prefs.ge) return false;

    bot.sendMessage(chatId, message).catch(err => console.error(`[TELEGRAM] Send failed: ${err.message}`));
    return true;
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

        // VERIFY CONNECTION
        bot.getMe().then((me) => {
            botStatus = "Online";
            botUsername = me.username;
            console.log(`[TELEGRAM] Bot Connected! Name: ${me.first_name}, Username: @${me.username}`);
        }).catch((err) => {
            botStatus = `Error: ${err.message}`;
            console.error(`[TELEGRAM] Failed to connect: ${err.message}`);
        });

        // Command: /start (with or without token)
        bot.onText(/\/start(?: (.+))?/, (msg, match) => {
            const chatId = msg.chat.id;
            const token = match[1]; // Capture group 1 is the token if present

            if (token) {
                // Linking logic
                if (telegramTokens.has(token)) {
                    const userId = telegramTokens.get(token);
                    telegramUsers.set(userId, chatId);
                    telegramChats.set(chatId, userId);
                    telegramTokens.delete(token);

                    // Set default prefs if not set
                    if (!userPreferences.has(userId)) {
                        userPreferences.set(userId, { pm: true, gm: true, bt: true, ge: true });
                    }

                    bot.sendMessage(chatId, "✅ Account successfully linked! You will now receive notifications here.\n\nType /help to see available commands.");
                    console.log(`[TELEGRAM] Linked chat ${chatId} to user ${userId}`);
                } else {
                    bot.sendMessage(chatId, "❌ Invalid or expired token. Please generate a new one from the game settings.");
                }
            } else {
                // Just /start without token
                if (telegramChats.has(chatId)) {
                    bot.sendMessage(chatId, "👋 You are already linked! Type /status to check your connection or /help for commands.");
                } else {
                    bot.sendMessage(chatId, "👋 Welcome! To link your account, please go to the game settings, click 'Get Access Token', and then click the 'Open Telegram Bot' link.");
                }
            }
        });

        // Command: /help
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            const helpText = `
🤖 *Bot Commands:*

/start - Start the bot or link account
/status - Check connection status
/unlink - Unlink your account
/help - Show this help message
            `;
            bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
        });

        // Command: /status
        bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            if (telegramChats.has(chatId)) {
                const userId = telegramChats.get(chatId);
                const prefs = userPreferences.get(userId);
                let prefText = "Unknown";
                if (prefs) {
                    prefText = `
- Private Messages: ${prefs.pm ? '✅' : '❌'}
- Guild Messages: ${prefs.gm ? '✅' : '❌'}
- Bot Errors: ${prefs.bt ? '✅' : '❌'}
- Gold Expire: ${prefs.ge ? '✅' : '❌'}
                    `;
                }
                bot.sendMessage(chatId, `✅ *Linked*\nUser ID: \`${userId}\`\n\n*Preferences:*${prefText}`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "❌ Not linked. Please link your account from the game settings.");
            }
        });

        // Command: /unlink
        bot.onText(/\/unlink/, (msg) => {
            const chatId = msg.chat.id;
            if (telegramChats.has(chatId)) {
                const userId = telegramChats.get(chatId);
                telegramUsers.delete(userId);
                telegramChats.delete(chatId);
                userPreferences.delete(userId); // Optional: clear prefs on unlink
                bot.sendMessage(chatId, "🔓 Account unlinked. You will no longer receive notifications.");
                console.log(`[TELEGRAM] Unlinked chat ${chatId} (User ${userId})`);
            } else {
                bot.sendMessage(chatId, "You are not linked to any account.");
            }
        });

        bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                const chatId = msg.chat.id;
                const userId = telegramChats.get(chatId);
                if (userId) {
                    // Echo or handle command
                    console.log(`[TELEGRAM] Msg from ${userId}: ${msg.text}`);
                }
            }
        });

    } catch (error) {
        botStatus = `Init Error: ${error.message}`;
        console.error("[TELEGRAM] Error initializing bot:", error.message);
    }
} else {
    botStatus = "Disabled (No Token)";
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
    if (req.path.startsWith('/admin') || req.path.startsWith('/telegram/status')) {
        return next();
    }

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

// Generate Token & Update Settings
app.post('/telegram/token', (req, res) => {
    console.log("[TELEGRAM] POST /telegram/token called");

    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) {
        console.log("[TELEGRAM] Token gen failed: No ID");
        return res.status(401).send(encryptResponse({ error: "Unauthorized" }));
    }

    // Update Preferences if provided
    const { pm, gm, bt, ge } = req.body;
    if (pm !== undefined || gm !== undefined || bt !== undefined || ge !== undefined) {
        const currentPrefs = userPreferences.get(finalId) || { pm: true, gm: true, bt: true, ge: true };
        userPreferences.set(finalId, {
            pm: pm !== undefined ? pm : currentPrefs.pm,
            gm: gm !== undefined ? gm : currentPrefs.gm,
            bt: bt !== undefined ? bt : currentPrefs.bt,
            ge: ge !== undefined ? ge : currentPrefs.ge
        });
        console.log(`[TELEGRAM] Updated prefs for ${finalId}:`, userPreferences.get(finalId));
    }

    const prefs = userPreferences.get(finalId) || { pm: true, gm: true, bt: true, ge: true };

    // Check if valid token exists
    if (userTokens.has(finalId)) {
        const existing = userTokens.get(finalId);
        if (existing.expiresAt > Date.now()) {
            console.log(`[TELEGRAM] Returning existing token ${existing.token} for user ${finalId}`);
            return res.send(encryptResponse({
                token: existing.token,
                expires: existing.expiresAt,
                settings: prefs,
                botName: botUsername
            }));
        }
    }

    const token = Math.random().toString(36).substr(2, 8).toUpperCase();
    const expiresAt = Date.now() + 300000; // 5 min

    telegramTokens.set(token, finalId);
    userTokens.set(finalId, { token, expiresAt });

    setTimeout(() => {
        telegramTokens.delete(token);
        if (userTokens.get(finalId)?.token === token) {
            userTokens.delete(finalId);
        }
    }, 300000);

    console.log(`[TELEGRAM] Generated token ${token} for user ${finalId}`);
    res.send(encryptResponse({
        token,
        expires: expiresAt,
        settings: prefs,
        botName: botUsername
    }));
});

// Get Token (Check if linked or get pending token)
app.get('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).send(encryptResponse({ error: "Unauthorized" }));

    const chatId = telegramUsers.get(finalId);
    const prefs = userPreferences.get(finalId) || { pm: true, gm: true, bt: true, ge: true };

    let response = {
        linked: !!chatId,
        chatId,
        settings: prefs,
        botName: botUsername
    };

    // If not linked, check for pending token
    if (!chatId && userTokens.has(finalId)) {
        const existing = userTokens.get(finalId);
        if (existing.expiresAt > Date.now()) {
            response.token = existing.token;
            response.expires = existing.expiresAt;
        }
    }

    res.status(200).send(encryptResponse(response));
});

// Delete Token (Unlink)
app.delete('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) return res.status(401).send(encryptResponse({ error: "Unauthorized" }));

    if (telegramUsers.has(finalId)) {
        const chatId = telegramUsers.get(finalId);
        telegramUsers.delete(finalId);
        telegramChats.delete(chatId);
    }
    if (userTokens.has(finalId)) {
        const { token } = userTokens.get(finalId);
        telegramTokens.delete(token);
        userTokens.delete(finalId);
    }

    res.send(encryptResponse({ success: true }));
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
    const { message, type } = req.body; // Expect 'type' (PM, GM, BT, GE)

    if (!userId || userId === 'unknown') return res.status(401).send(encryptResponse({ error: "Unauthorized" }));

    // Use default type 'PM' if not specified
    const msgType = type || 'PM';
    const sent = notifyUser(userId, msgType, message);

    if (sent) {
        res.send(encryptResponse({ success: true }));
    } else {
        res.status(200).send(encryptResponse({ success: false, reason: "Not linked or disabled" }));
    }
});

// ==========================================
//  ASSETS & ADMIN
// ==========================================

// Real 1x1 PNG for Favicon
const faviconBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
app.get('/favicon.png', (req, res) => {
    res.type('png').send(faviconBuffer);
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/admin/config', (req, res) => {
    res.json({
        server_status: "online",
        auto_license_mode: AUTO_LICENSE_MODE,
        telegramLinks: telegramUsers.size,
        bot_status: botStatus,
        bot_username: botUsername
    });
});

// Public Status Endpoint
app.get('/telegram/status', (req, res) => {
    res.json({
        status: botStatus,
        username: botUsername,
        token_configured: !!TELEGRAM_TOKEN
    });
});

app.get('/', (req, res) => res.send('Hostile Server V9 (Bot Verify) Active.'));

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
