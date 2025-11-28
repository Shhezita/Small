const express = require('express');
const cors = require('cors');
const CryptoJS = require("crypto-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN
// ==========================================

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CONSTANTES
// String de 120 chars, válido para Base64 y divisible por 3. CRÍTICO PARA CLIENTE atob().
const SAFE_LICENSE = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Base de datos volátil (Packs)
let packs = [];

// ==========================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const verifyXToken = (req, res, next) => {
    if (req.path.startsWith('/admin')) {
        const authHeader = req.headers['authorization'];
        if (authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
            return res.status(403).json({ error: "Forbidden" });
        }
        return next();
    }

    const token = req.headers['x-token'];
    if (!token) {
        req.user = { userId: 'unknown' };
        return next();
    }

    try {
        const bytes = CryptoJS.AES.decrypt(token, "");
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedString) throw new Error("Decryption empty");
        
        req.user = JSON.parse(decryptedString);
        next();
    } catch (error) {
        req.user = { userId: 'unknown' };
        next();
    }
};

app.use(verifyXToken);

// ==========================================
//  LÓGICA DE LICENCIAS
// ==========================================

const checkUserLicense = (userId) => {
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());

    // MODO DIOS (*) o ID ESPECIFICO
    if (allowedIds.includes('*') || allowedIds.includes(userId.toString())) {
        return { valid: true, days: 365 };
    }
    return { valid: false, days: 0 };
};

// Manejador de Licencia
const handleCheckLicense = (req, res) => {
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;

    if (!targetId) return res.status(400).json({ error: "No ID" });

    const status = checkUserLicense(targetId);

    if (status.valid) {
        res.json({
            licence: SAFE_LICENSE, // CRÍTICO: 'licence' con C
            days: status.days,
            object: { valid: true, until: "Manual_Verified" },
            q: "activated_ok" // <--- CRÍTICO: La propiedad que faltaba
        });
    } else {
        // Devolver estructura válida pero vacía para evitar crash en cliente
        res.json({
            licence: "",
            days: 0,
            object: { valid: false },
            q: null
        });
    }
};

// Manejador de Free Trial
const handleFreeLicense = (req, res) => {
    res.json({
        licence: SAFE_LICENSE,
        days: 1,
        object: { valid: true, type: "TRIAL" },
        q: "trial_ok" // <--- CRÍTICO
    });
};

// RUTAS DE LICENCIA (Soporte Total V1 y V2 + PUT/POST)
app.all(['/check-licence/check/:key', '/api/v2/check-license'], handleCheckLicense);
app.all(['/check-licence/free', '/api/v2/free'], handleFreeLicense);


// ==========================================
//  SISTEMA DE PAQUETES
// ==========================================
app.post('/pack/request', (req, res) => {
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
    res.json(newPack);
});

// Rutas GET flexibles
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
    res.json({
        server_status: "online",
        auth_mode: "Environment Variables",
        allowed_ids_configured: !!process.env.ALLOWED_IDS,
        memory_packs_count: packs.length
    });
});

app.get('/', (req, res) => res.send('Hostile Server V5 (Final TFG) Active.'));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
    });
}

module.exports = app;
