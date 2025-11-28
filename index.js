const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const CryptoJS = require("crypto-js");
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==========================================
//  BASE DE DATOS (IN-MEMORY)
// ==========================================
let packs = [];
let telegramTokens = new Map(); // token -> userId
let telegramUsers = new Map(); // userId -> chatId
let telegramChats = new Map(); // chatId -> userId

// CONSTANTES
const SAFE_LICENSE = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

// ==========================================
//  TELEGRAM BOT SETUP
// ==========================================
let bot;
if (TELEGRAM_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN") {
    try {
        if (VERCEL_URL) {
            // Webhook mode for Vercel
            bot = new TelegramBot(TELEGRAM_TOKEN);
            bot.setWebHook(`${VERCEL_URL}/telegram/webhook`);
            console.log(`[TELEGRAM] Webhook set to ${VERCEL_URL}/telegram/webhook`);
        } else {
            // Polling mode for local development
            bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
            console.log(`[TELEGRAM] Polling mode started`);
        }

        // Handle /start <token>
        bot.onText(/\/start (.+)/, (msg, match) => {
            const chatId = msg.chat.id;
            const token = match[1];

            if (telegramTokens.has(token)) {
                const userId = telegramTokens.get(token);
                telegramUsers.set(userId, chatId);
                telegramChats.set(chatId, userId);
                telegramTokens.delete(token); // One-time use

                bot.sendMessage(chatId, "✅ Account successfully linked! You will now receive notifications here.");
                console.log(`[TELEGRAM] Linked chat ${chatId} to user ${userId}`);
            } else {
                bot.sendMessage(chatId, "❌ Invalid or expired token. Please generate a new one from the game.");
            }
        });

        // Handle other messages
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
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    // Verificar contraseña para rutas de admin
    if (req.path.startsWith('/admin')) {
        const authHeader = req.headers['authorization'];
        if (authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
            return res.status(403).json({ error: "Forbidden: Admin Access Only" });
        }
        return next();
    }

    // Public Telegram Webhook
    if (req.path === '/telegram/webhook') {
        return next();
    }

    // Intentar obtener token del header (case-insensitive en Express)
    const token = req.headers['x-token'];

    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        // Desencriptar con clave vacía "" como se descubrió en el análisis
        const bytes = CryptoJS.AES.decrypt(token, "");
        const decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
        req.user = decryptedData;
        next();
    } catch (error) {
        console.error("[AUTH] Token corrupto o clave incorrecta", error.message);
        req.user = { userId: 'unknown' };
        next();
    }
};

app.use(verifyXToken);

// ==========================================
//  SISTEMA DE VERIFICACIÓN
// ==========================================

const checkUserLicense = (userId) => {
    // 1. Leer lista de IDs permitidos desde Variables de Entorno
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";

    // Robust parsing: remove quotes, split, trim
    const allowedIds = allowedIdsString.replace(/['"]/g, '').split(',').map(id => id.trim());

    console.log(`[DEBUG] Checking User ${userId} against Allowed List: ${JSON.stringify(allowedIds)}`);

    // 2. Verificar si el ID está en la lista
    if (allowedIds.includes(userId.toString())) {
        return {
            valid: true,
            days: 365,
            type: 'PRO_MANUAL'
        };
    }

    return { valid: false, days: 0 };
};

// ==========================================
//  RUTAS DE LICENCIA
// ==========================================

const handleCheckLicense = (req, res) => {
    const { userId } = req.user;
    // Fallback to body for manual checks
    const targetId = userId !== 'unknown' ? userId : req.body.playerId;

    if (!targetId) {
        console.log("[LICENCIA] No Player ID found in request");
        return res.status(400).json({ error: "No Player ID found" });
    }

    console.log(`[LICENCIA] Verificando ID: ${targetId}`);
    const status = checkUserLicense(targetId);

    if (status.valid) {
        console.log(`[LICENCIA] ID ${targetId} es VÁLIDO`);
        res.json({
            licence: SAFE_LICENSE,
            days: status.days,
            object: { valid: true, until: "Manual/EnvVar" }
        });
    } else {
        console.log(`[LICENCIA] ID ${targetId} es INVÁLIDO`);
        res.json({
            licence: "",
            days: 0,
            object: { valid: false }
        });
    }
};

const handleFreeLicense = (req, res) => {
    console.log(`[LICENCIA] Free license requested`);
    res.json({
        licence: SAFE_LICENSE,
        days: 1,
        object: { valid: true, type: "TRIAL" }
    });
};

// Rutas V1
app.put('/check-licence/check/:key', handleCheckLicense);
app.post('/check-licence/free', handleFreeLicense);

// Rutas V2
app.put('/check-licence/v2/check/:key', handleCheckLicense);
app.post('/check-licence/v2/free', handleFreeLicense);

// Check Version Route (Missing previously)
app.get('/check-version', (req, res) => {
    res.json({ version: "9.9.9", update: false });
});
app.post('/check-version', (req, res) => {
    res.json({ version: "9.9.9", update: false });
});


// ==========================================
//  RUTAS DE PAQUETES (PACK SYSTEM)
// ==========================================

app.post('/pack/request', (req, res) => {
    const { bankId, goldAmount, duration } = req.body;
    const clientId = req.user.userId !== 'unknown' ? req.user.userId : req.body.clientId;

    if (!clientId) {
        return res.status(400).json({ error: "Missing clientId" });
    }

    const newPack = {
        _id: Math.random().toString(36).substr(2, 9),
        clientId: clientId.toString(),
        bankId: bankId ? bankId.toString() : "0",
        goldAmount: parseInt(goldAmount || 0),
        duration: parseInt(duration || 0),
        state: 'pending',
        createdAt: Date.now(),
        metaData: { basis: "14-1", quality: 0, level: 1, soulboundTo: null }
    };
    packs.push(newPack);
    res.json(newPack);
});

app.get('/pack/pending/:playerId', (req, res) => {
    const { playerId } = req.params;
    const pendingPacks = packs.filter(p => p.bankId === playerId.toString() && p.state === 'pending');
    res.json(pendingPacks);
});

app.get('/pack/ready/:playerId', (req, res) => {
    const { playerId } = req.params;
    const readyPacks = packs.filter(p => p.clientId === playerId.toString() && p.state === 'ready');
    res.json(readyPacks);
});

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
    const { id } = req.params;
    const initialLength = packs.length;
    packs = packs.filter(p => p._id !== id);
    if (packs.length < initialLength) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Pack not found" });
    }
});

// ==========================================
//  RUTAS DE TELEGRAM
// ==========================================

// Generate Token
app.post('/telegram/token', (req, res) => {
    // Fallback: Use userId from token OR from body (if token fails/missing)
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);

    if (!userId || userId === 'unknown') {
        console.log("[TELEGRAM] Token generation failed: No User ID found");
        return res.status(401).json({ error: "Unauthorized: No User ID found" });
    }

    // Verify license before generating token
    const licenseStatus = checkUserLicense(userId);
    if (!licenseStatus.valid) {
        console.log(`[TELEGRAM] Token generation denied for invalid user ${userId}`);
        return res.status(403).json({ error: "Forbidden: Invalid License" });
    }

    const token = Math.random().toString(36).substr(2, 8).toUpperCase();
    telegramTokens.set(token, userId);

    setTimeout(() => telegramTokens.delete(token), 600000);

    console.log(`[TELEGRAM] Generated token ${token} for user ${userId}`);
    res.json({ token });
});

// Get Token (Check if linked)
app.get('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    if (!userId || userId === 'unknown') return res.status(401).json({ error: "Unauthorized" });

    const chatId = telegramUsers.get(userId);
    res.json({ linked: !!chatId, chatId });
});

// Delete Token (Unlink)
app.delete('/telegram/token', (req, res) => {
    const userId = (req.user && req.user.userId !== 'unknown') ? req.user.userId : (req.body.userId || req.body.playerId);
    if (!userId || userId === 'unknown') return res.status(401).json({ error: "Unauthorized" });

    if (telegramUsers.has(userId)) {
        const chatId = telegramUsers.get(userId);
        telegramUsers.delete(userId);
        telegramChats.delete(chatId);
        console.log(`[TELEGRAM] Unlinked user ${userId}`);
    }
    res.json({ success: true });
});

// Webhook Endpoint
app.post('/telegram/webhook', (req, res) => {
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// Notify Endpoint (Internal/Client use)
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
//  PANEL ADMIN (SOLO INFORMATIVO)
// ==========================================
app.get('/admin/config', (req, res) => {
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    res.json({
        allowedIds: allowedIdsString ? allowedIdsString.split(',') : [],
        activePacksInMemory: packs.length,
        telegramLinks: telegramUsers.size,
        packs: packs
    });
});

// Root route
app.get('/', (req, res) => {
    res.send('Hostile Server V2 is active.');
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n[SERVER] Hostile Server running on http://localhost:${PORT}`);
        console.log(`[SERVER] Allowed IDs: ${process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "None set"}`);
    });
}

module.exports = app;
