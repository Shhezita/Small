const express = require('express');
const cors = require('cors');
const CryptoJS = require("crypto-js");
const Redis = require('ioredis'); // Standard Redis Client

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN TFG
// ==========================================
const AUTO_LICENSE_MODE = true; // ¡ACTIVADO POR DEFECTO PARA TFG!
const ENCRYPTION_KEY = ""; // Clave vacía detectada en el cliente (para desencriptar REQUEST)

// Detectar si usar Redis (Flag explícito)
const USE_DB = process.env.USE_DB === 'true';

// Inicializar Redis si es necesario
let redis = null;
if (USE_DB) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        redis = new Redis(redisUrl);
        redis.on('error', (err) => console.error('[REDIS] Error:', err));
        redis.on('connect', () => console.log('[REDIS] Conectado'));
    } else {
        console.error('[REDIS] USE_DB es true pero falta REDIS_URL');
    }
} else {
    console.log('[REDIS] Modo Memoria (USE_DB no es true)');
}

// CONSTANTES
// 120 chars Base64 string WITHOUT padding (multiple of 3 bytes = 4 chars, so 90 bytes -> 120 chars)
// "abcdefghijklmnopqrstuvwxyz1234567890" repeated
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFy";

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
//  BASE DE DATOS (Memoria vs Redis)
// ==========================================
let memoryPacks = [];
let memoryConfigs = {};

// Helper para obtener packs
const getPacks = async () => {
    if (redis) {
        try {
            const data = await redis.get('packs');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error("Redis Error (getPacks):", e);
            return [];
        }
    }
    return memoryPacks;
};

// Helper para guardar packs
const savePacks = async (newPacks) => {
    if (redis) {
        try {
            await redis.set('packs', JSON.stringify(newPacks));
        } catch (e) {
            console.error("Redis Error (savePacks):", e);
        }
    } else {
        memoryPacks = newPacks;
    }
};

// Helper para guardar Configuración
const savePlayerConfig = async (playerId, config) => {
    if (redis) {
        try {
            // Guardamos como string JSON en un hash
            await redis.hset('player_configs', playerId, JSON.stringify(config));
            console.log(`[DB] Config guardada en Redis para ${playerId}`);
        } catch (e) {
            console.error("Redis Error (savePlayerConfig):", e);
        }
    } else {
        memoryConfigs[playerId] = config;
        console.log(`[MEM] Config guardada en RAM para ${playerId}`);
    }
};

// Helper para cargar Configuración
const getPlayerConfig = async (playerId) => {
    if (redis) {
        try {
            const data = await redis.hget('player_configs', playerId);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error("Redis Error (getPlayerConfig):", e);
            return null;
        }
    } else {
        return memoryConfigs[playerId] || null;
    }
};


// ==========================================
//  UTILIDADES
// ==========================================
const encryptResponse = (data) => {
    // El cliente espera que la respuesta sea un string encriptado (ciphertext)
    // CRITICAL FIX: El cliente desencripta la RESPUESTA usando la clave "sugi"
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, "sugi").toString();
    return encrypted;
};

// ==========================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    if (req.path.startsWith('/admin')) return next();

    const token = req.headers['x-token'];
    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        // El cliente encripta el REQUEST con clave vacía ""
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
    console.log(`[TFG DEBUG] Verificando licencia para Player ID: ${userId}`);

    if (AUTO_LICENSE_MODE) {
        console.log(`[TFG DEBUG] AUTO_LICENSE_MODE activo. Acceso CONCEDIDO.`);
        return { valid: true, days: 999, type: 'TFG_AUTO' };
    }

    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());

    if (allowedIds.includes(userId.toString())) {
        return { valid: true, days: 365, type: 'PRO_MANUAL' };
    }
    return { valid: false, days: 0 };
};

const handleCheckLicense = (req, res) => {
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;

    // En modo TFG, si no hay ID, asumimos uno dummy para que pase
    const finalId = targetId || (AUTO_LICENSE_MODE ? "TFG_GUEST" : null);

    if (!finalId) {
        return res.status(400).send(encryptResponse({ error: "No Player ID identified" }));
    }

    const status = checkUserLicense(finalId);

    // Estructura exacta que espera el cliente tras desencriptar
    const responseData = {
        licence: SAFE_LICENSE, // Use the safe, padding-free string
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

// Manejador para Check Version (Nuevo endpoint detectado)
const handleCheckVersion = (req, res) => {
    console.log(`[VERSION] Check version requested: ${req.params.version}`);
    // Respondemos siempre que es válida
    const responseData = {
        valid: true,
        url: "https://small-mu.vercel.app/download", // Dummy URL
        version: req.params.version
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
            q: "activated" // CRITICAL FIX
        }
    };
    res.send(encryptResponse(responseData));
};

// Rutas Licencia
app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license', '/check-licence/v2/check/'], handleCheckLicense);
app.all(['/check-licence/free', '/check-licence/v2/free', '/api/v2/free'], handleFreeLicense);
app.all(['/check-licence/v2/check-version/:version'], handleCheckVersion);

// ==========================================
//  SISTEMA DE PAQUETES (PACKS)
// ==========================================
app.post('/pack/request', async (req, res) => {
    let currentPacks = await getPacks();

    // Limpieza automática si crece mucho
    if (currentPacks.length > 500) currentPacks = currentPacks.slice(-200);

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

    currentPacks.push(newPack);
    await savePacks(currentPacks);

    console.log(`[PACK] Nuevo pack creado: ${newPack._id} para ${clientId}`);
    res.json(newPack);
});

const handleGetPending = async (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId) return res.status(400).json({ error: "ID missing" });

    const currentPacks = await getPacks();
    // Pending: Packs donde bankId == playerId (alguien me envía a mí)
    const pending = currentPacks.filter(p => p.bankId === playerId.toString() && p.state === 'pending');
    res.json(pending);
};

const handleGetReady = async (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId) return res.status(400).json({ error: "ID missing" });

    const currentPacks = await getPacks();
    // Ready: Packs donde clientId == playerId (yo envié y ya están listos/cobrados)
    const ready = currentPacks.filter(p => p.clientId === playerId.toString() && p.state === 'ready');
    res.json(ready);
};

app.get(['/pack/pending/:playerId', '/pack/pending'], handleGetPending);
app.get(['/pack/ready/:playerId', '/pack/ready'], handleGetReady);

app.patch('/pack/state', async (req, res) => {
    const { packId, state } = req.body;
    let currentPacks = await getPacks();

    const packIndex = currentPacks.findIndex(p => p._id === packId);
    if (packIndex !== -1) {
        currentPacks[packIndex].state = state;
        await savePacks(currentPacks);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Pack not found" });
    }
});

app.delete('/pack/:id', async (req, res) => {
    let currentPacks = await getPacks();
    const newPacks = currentPacks.filter(p => p._id !== req.params.id);
    await savePacks(newPacks);
    res.json({ success: true });
});

// ==========================================
//  SISTEMA DE CONFIGURACIONES (NUEVO)
// ==========================================

// Alias /config para compatibilidad con UI (Import/Export)
app.post('/config', async (req, res) => {
    const playerId = req.user.userId !== 'unknown' ? req.user.userId : req.body.playerId;

    if (!playerId) {
        return res.status(400).json({ error: "Missing playerId" });
    }

    // Flexibilidad: payload puede estar anidado o ser el body entero
    const configData = req.body.payload || req.body;

    await savePlayerConfig(playerId, configData);
    console.log(`[CONFIG] Guardado para ${playerId}`);
    res.json({ success: true, message: "Config saved" });
});

app.get('/config', async (req, res) => {
    const playerId = req.user.userId !== 'unknown' ? req.user.userId : req.query.playerId;

    if (!playerId) {
        return res.status(400).json({ error: "Missing playerId" });
    }

    const config = await getPlayerConfig(playerId);

    if (config) {
        // Devolvemos la configuración directa, sin envoltorio, ya que el cliente espera iterar sobre las claves
        res.json(config);
    } else {
        res.status(404).json({ error: "Config not found" });
    }
});

app.post('/config/save', async (req, res) => {
    const { playerId, payload } = req.body;

    if (!playerId || !payload) {
        return res.status(400).json({ error: "Missing playerId or payload" });
    }

    await savePlayerConfig(playerId, payload);
    res.json({ success: true, message: "Config saved" });
});

app.get('/config/load/:playerId', async (req, res) => {
    const { playerId } = req.params;
    if (!playerId) return res.status(400).json({ error: "Missing playerId" });

    const config = await getPlayerConfig(playerId);

    if (config) {
        res.json({ success: true, payload: config });
    } else {
        res.status(404).json({ error: "Config not found" });
    }
});

// ==========================================
//  ADMIN
// ==========================================
app.get('/admin/config', async (req, res) => {
    const currentPacks = await getPacks();
    res.json({
        server_status: "online",
        auto_license_mode: AUTO_LICENSE_MODE,
        db_mode: redis ? "Redis" : "Memory",
        packs_count: currentPacks.length
    });
});

app.post('/admin/reset', async (req, res) => {
    await savePacks([]);
    if (redis) await redis.del('player_configs'); // Opcional: limpiar configs también
    console.log('[ADMIN] Reset requested.');
    res.json({ success: true, message: "All data cleared." });
});

app.get('/', (req, res) => res.send('Hostile Server V6 (TFG + Redis Standard) Active.'));

// ==========================================
//  ERROR HANDLING & 404
// ==========================================

// Catch-All 404 Handler
app.use((req, res) => {
    console.log(`[404] Missing Endpoint: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "Endpoint not found" });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[ERROR] Unhandled Exception: ${err.message}`);
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error" });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
        console.log(`[SERVER] AUTO_LICENSE_MODE: ${AUTO_LICENSE_MODE}`);
        console.log(`[SERVER] DB MODE: ${USE_DB ? "Redis" : "Memory"}`);
    });
}

module.exports = app;
