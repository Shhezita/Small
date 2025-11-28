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
// NOTA: En Vercel, la memoria se borra. 
// Los paquetes 'packs' se perderán si el servidor se duerme.
let packs = [];
let telegramTokens = new Map(); // token -> userId
let telegramUsers = new Map(); // userId -> chatId
let telegramChats = new Map(); // chatId -> userId

// CONSTANTES
// Texto decodificado: "This is a fake license for testing purposes" repetido.
const SAFE_LICENSE = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

// ==========================================
//  TELEGRAM BOT SETUP
// ==========================================
let bot;
if (TELEGRAM_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN") {
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

    // Handle other messages (Replay functionality placeholder)
    bot.on('message', (msg) => {
        if (msg.text && !msg.text.startsWith('/')) {
            const chatId = msg.chat.id;
            const userId = telegramChats.get(chatId);
            if (userId) {
                // Here we would forward to the game if we had a socket connection
                // For now, just echo or acknowledge
                bot.sendMessage(chatId, `Received: ${msg.text} (This is a reply placeholder)`);
            }
        }
    });
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
        // console.log(`[AUTH] User authenticated: ${req.user.userId}`);
        next();
    } catch (error) {
        console.error("[AUTH] Token corrupto o clave incorrecta", error.message);
        // Si falla la desencriptación, tratamos como desconocido o error?
        // El usuario pidió: "Si no está en la lista ➝ Devuelve error o licencia caducada."
        // Pero si el token es inválido, mejor rechazar.
        // Sin embargo, para robustez, dejaremos pasar como 'unknown' si falla, 
        // y la licencia fallará después.
        req.user = { userId: 'unknown' };
        next();
    }
};

app.use(verifyXToken);

// ==========================================
//  SISTEMA DE VERIFICACIÓN (MANUAL POR ENV VAR)
// ==========================================

const checkUserLicense = (userId) => {
    // 1. Leer lista de IDs permitidos desde Variables de Entorno
    // Formato: ALLOWED_IDS="12345,67890,55555"
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());

    // 2. Verificar si el ID está en la lista
    if (allowedIds.includes(userId.toString())) {
        return {
            valid: true,
            days: 365, // Damos 1 año por defecto a los IDs manuales
            type: 'PRO_MANUAL'
        };
    }

    return { valid: false, days: 0 };
};

// ==========================================
//  RUTAS DE LICENCIA
// ==========================================

// Función manejadora para check
const handleCheckLicense = (req, res) => {
    const { userId } = req.user;
    // Si no hay userId (petición manual sin token), intentar leer del body para pruebas
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

// Función manejadora para free
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

// Rutas V2 (Detectadas en content-ui)
app.put('/check-licence/v2/check/:key', handleCheckLicense);
app.post('/check-licence/v2/free', handleFreeLicense);


// ==========================================
//  RUTAS DE PAQUETES (PACK SYSTEM)
// ==========================================

app.post('/pack/request', (req, res) => {
    const { bankId, goldAmount, duration } = req.body;
    // Usar userId del token si existe, sino del body (clientId)
    const clientId = req.user.userId !== 'unknown' ? req.user.userId : req.body.clientId;

    if (!clientId) {
        return res.status(400).json({ error: "Missing clientId" });
    }

    console.log(`[PACK] Request received from ${clientId}`);

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
    // Pending packs are for the "bank" (who gives gold) ?? 
    // Or packs that are pending for the player?
    // Based on user pseudocode: p.bankId === playerId
    const pendingPacks = packs.filter(p => p.bankId === playerId.toString() && p.state === 'pending');
    res.json(pendingPacks);
});

app.get('/pack/ready/:playerId', (req, res) => {
    const { playerId } = req.params;
    // Ready packs are for the client (who requested gold) ??
    // Based on user pseudocode: p.clientId === playerId
    const readyPacks = packs.filter(p => p.clientId === playerId.toString() && p.state === 'ready');
    res.json(readyPacks);
});

app.patch('/pack/state', (req, res) => {
    const { packId, state } = req.body;
    const packIndex = packs.findIndex(p => p._id === packId);
    if (packIndex !== -1) {
        packs[packIndex].state = state;
        console.log(`[PACK] State updated for ${packId} to ${state}`);
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
        console.log(`[PACK] Deleted pack ${id}`);
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
    const { userId } = req.user;
    if (!userId || userId === 'unknown') return res.status(401).json({ error: "Unauthorized" });

    const token = Math.random().toString(36).substr(2, 8).toUpperCase();
    telegramTokens.set(token, userId);

    // Auto-expire token after 10 minutes
    setTimeout(() => telegramTokens.delete(token), 600000);

    console.log(`[TELEGRAM] Generated token ${token} for user ${userId}`);
    res.json({ token });
});

// Get Token (Check if linked)
app.get('/telegram/token', (req, res) => {
    const { userId } = req.user;
    if (!userId || userId === 'unknown') return res.status(401).json({ error: "Unauthorized" });

    const chatId = telegramUsers.get(userId);
    res.json({ linked: !!chatId, chatId });
});

// Delete Token (Unlink)
app.delete('/telegram/token', (req, res) => {
    const { userId } = req.user;
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
    const { userId } = req.user;
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
        packs: packs // Show packs for debugging
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
