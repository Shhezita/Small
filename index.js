const express = require('express');
const cors = require('cors'); // body-parser ya no es necesario en Express 4.16+
const CryptoJS = require("crypto-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN
// ==========================================

// 1. Modernización: Express nativo en lugar de body-parser
app.use(cors({ origin: "*" })); // Permite peticiones desde cualquier origen (el juego)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Constantes
const SAFE_LICENSE = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Base de datos volátil (Packs)
// NOTA: En Vercel se borra al dormir la instancia.
let packs = [];

// ==========================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    // Proteger rutas de admin
    if (req.path.startsWith('/admin')) {
        const authHeader = req.headers['authorization'];
        if (authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
            return res.status(403).json({ error: "Forbidden" });
        }
        return next();
    }

    // Verificar token del juego
    const token = req.headers['x-token'];
    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        const bytes = CryptoJS.AES.decrypt(token, "");
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedString) throw new Error("Decryption empty");
        
        req.user = JSON.parse(decryptedString); // { userId, serverId, language }
        next();
    } catch (error) {
        console.error(`[AUTH] Fallo token: ${error.message}`);
        req.user = { userId: 'unknown' };
        next(); // Dejamos pasar como unknown, la licencia fallará después
    }
};

app.use(verifyXToken);

// ==========================================
//  LÓGICA DE LICENCIAS (VARIABLES DE ENTORNO)
// ==========================================
const checkUserLicense = (userId) => {
    // 1. Leer lista de IDs desde Vercel Environment Variables
    // Configurar en Vercel: Key="ALLOWED_IDS", Value="12345,67890,11111"
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());

    // 2. Comprobar si existe
    if (allowedIds.includes(userId.toString())) {
        return { valid: true, days: 365 };
    }
    return { valid: false, days: 0 };
};

// Manejador unificado para todas las rutas de check
const handleCheckLicense = (req, res) => {
    // Prioridad: Token > Body (para pruebas manuales)
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;

    if (!targetId) {
        return res.status(400).json({ error: "No Player ID identified" });
    }

    console.log(`[LICENCIA] Check ID: ${targetId}`);
    const status = checkUserLicense(targetId);

    if (status.valid) {
        res.json({
            licence: SAFE_LICENSE,
            days: status.days,
            object: { valid: true, until: "Manual_Env_Auth" }
        });
    } else {
        // Respuesta de fallo "silenciosa" (sin licencia válida)
        res.json({
            licence: "",
            days: 0,
            object: { valid: false }
        });
    }
};

// Manejador unificado para Free Trial
const handleFreeLicense = (req, res) => {
    console.log(`[TRIAL] Trial solicitado por ${req.user.userId}`);
    res.json({
        licence: SAFE_LICENSE,
        days: 1,
        object: { valid: true, type: "TRIAL" }
    });
};

// --- RUTAS DE LICENCIA (Soporte Total V1 y V2) ---
// Aceptamos PUT y POST para asegurar compatibilidad con cualquier versión del script
app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license'], handleCheckLicense);
app.all(['/check-licence/free', '/check-licence/v2/free', '/api/v2/free'], handleFreeLicense);

// ==========================================
//  SISTEMA DE PAQUETES
// ==========================================
app.post('/pack/request', (req, res) => {
    // Limpieza preventiva de memoria para Vercel (evitar fugas en instancias calientes)
    if (packs.length > 500) packs = packs.slice(-200);

    const { bankId, goldAmount, duration } = req.body;
    const clientId = req.user.userId !== 'unknown' ? req.user.userId : req.body.clientId;

    if (!clientId) return res.status(400).json({ error: "Missing clientId" });

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
    console.log(`[PACK] Nuevo pack creado: ${newPack._id}`);
    res.json(newPack);
});

// Rutas GET flexibles (con y sin param)
const handleGetPending = (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId || playerId === 'unknown') return res.status(400).json({ error: "ID missing" });
    res.json(packs.filter(p => p.bankId === playerId.toString() && p.state === 'pending'));
};

const handleGetReady = (req, res) => {
    const playerId = req.params.playerId || req.user.userId || req.query.playerId;
    if (!playerId || playerId === 'unknown') return res.status(400).json({ error: "ID missing" });
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
    const { id } = req.params;
    packs = packs.filter(p => p._id !== id);
    res.json({ success: true });
});

// ==========================================
//  ADMIN & STARTUP
// ==========================================
app.get('/admin/config', (req, res) => {
    // Muestra configuración actual para depuración
    res.json({
        server_status: "online",
        auth_mode: "Environment Variables",
        allowed_ids_configured: !!process.env.ALLOWED_IDS,
        memory_packs_count: packs.length
    });
});

app.get('/', (req, res) => res.send('Hostile Server V3 (TFG Edition) Active.'));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
    });
}

module.exports = app;
