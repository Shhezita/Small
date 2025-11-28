const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const CryptoJS = require("crypto-js");
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN TFG (FROM WORKING LICENSE)
// ==========================================
const AUTO_LICENSE_MODE = true; // ¡ACTIVADO POR DEFECTO PARA TFG!
const ENCRYPTION_KEY = ""; // Clave vacía detectada en el cliente (para desencriptar REQUEST)

// CONSTANTES
// 120 chars Base64 string WITHOUT padding
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFy";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// TELEGRAM CONFIG
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8478009189:AAHCYK4Dmefy2I8UL8TwWeB-1aYS6LcSCy0";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

// Middleware
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Base de datos volátil
let packs = [];
let telegramTokens = new Map(); // token -> userId
let telegramUsers = new Map(); // userId -> chatId
let telegramChats = new Map(); // chatId -> userId

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
//  UTILIDADES (FROM WORKING LICENSE)
// ==========================================
const encryptResponse = (data) => {
    // CRITICAL FIX: El cliente desencripta la RESPUESTA usando la clave "sugi"
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

    // Public Telegram Webhook & Favicon
    if (req.path === '/telegram/webhook' || req.path === '/favicon.ico') {
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
//  SISTEMA DE LICENCIAS (FROM WORKING LICENSE)
// ==========================================
const checkUserLicense = (userId) => {
    console.log(`[TFG DEBUG] Verificando licencia para Player ID: ${userId}`);

    if (AUTO_LICENSE_MODE) {
        console.log(`[TFG DEBUG] AUTO_LICENSE_MODE activo. Acceso CONCEDIDO.`);
        return { valid: true, days: 999, type: 'TFG_AUTO' };
    }

    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.replace(/['"]/g, '').split(',').map(id => id.trim());

    // Hardcoded fallback
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
            q: "activated" // CRITICAL FIX: UI requires this property
        }
    };

    // IMPORTANTE: Enviamos texto plano (que es el ciphertext)
    const encryptedResponse = encryptResponse(responseData);
    res.send(encryptedResponse);
};

const handleCheckVersion = (req, res) => {
    console.log(`[VERSION] Check version requested: ${req.params.version || "unknown"}`);
    const responseData = {
        valid: true,
        url: "https://small-mu.vercel.app/download",
        version: req.params.version || "9.9.9"
    };
    res.send(encryptResponse(responseData));
};

const handleFreeLicense = (req, res) => {
    console.log(`[TRIAL] Trial solicitado`);
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
app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license', '/check-licence/v2/check/'], handleCheckLicense);
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
    console.log(`[PACK] Nuevo pack creado: ${newPack._id} para ${clientId}`);
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
    // Fallback: Use userId from token OR from body (if token fails/missing)
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);

    // In AUTO_LICENSE_MODE, allow guest tokens if no ID
    const finalId = userId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) {
        console.log("[TELEGRAM] Token generation failed: No User ID found");
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
    // Return 200 OK with status, not 304
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
        console.log(`[TELEGRAM] Unlinked user ${finalId}`);
    }
    res.json({ success: true });
});

// Webhook Endpoint (POST is standard, GET added for browser check)
app.post('/telegram/webhook', (req, res) => {
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});
app.get('/telegram/webhook', (req, res) => {
    res.send("Telegram Webhook Active");
});

// Notify Endpoint
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
//  ADMIN & ROOT
// ==========================================
app.get('/admin/config', (req, res) => {
    res.json({
        server_status: "online",
        auto_license_mode: AUTO_LICENSE_MODE,
        memory_packs_count: packs.length,
        telegramLinks: telegramUsers.size
    });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/', (req, res) => res.send('Hostile Server V5 (Merged & Fixed) Active.'));

// Catch-All 404
app.use((req, res) => {
    console.log(`[404] Missing Endpoint: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "Endpoint not found" });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
        console.log(`[SERVER] AUTO_LICENSE_MODE: ${AUTO_LICENSE_MODE}`);
    });
}

module.exports = app;
