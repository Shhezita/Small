const express = require('express');
const cors = require('cors');
const CryptoJS = require("crypto-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//  CONFIGURACIÓN TFG
// ==========================================
const AUTO_LICENSE_MODE = true; // ¡ACTIVADO POR DEFECTO PARA TFG!
const ENCRYPTION_KEY = ""; // Clave vacía detectada en el cliente

// CONSTANTES
// 120 chars Base64 string WITHOUT padding (multiple of 3 bytes = 4 chars, so 90 bytes -> 120 chars)
// "abcdefghijklmnopqrstuvwxyz1234567890" repeated
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFy";

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Base de datos volátil
let packs = [];

// ==========================================
//  UTILIDADES
// ==========================================
const encryptResponse = (data) => {
    // El cliente espera que la respuesta sea un string encriptado (ciphertext)
    // Si enviamos JSON plano, el cliente falla al desencriptar.
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, ENCRYPTION_KEY).toString();
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
    // El cliente hará: JSON.parse(AES.decrypt(response, ""))
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

// Rutas
// Agregamos ruta para cuando NO hay key (check/) y version check
app.all(['/check-licence/check/:key', '/check-licence/v2/check/:key', '/api/v2/check-license', '/check-licence/v2/check/'], handleCheckLicense);
app.all(['/check-licence/free', '/check-licence/v2/free', '/api/v2/free'], handleFreeLicense);
app.all(['/check-licence/v2/check-version/:version'], handleCheckVersion);

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
    res.json(newPack); // Los packs parece que NO van encriptados en la respuesta, según análisis previo
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
//  ADMIN
// ==========================================
app.get('/admin/config', (req, res) => {
    res.json({
        server_status: "online",
        auto_license_mode: AUTO_LICENSE_MODE,
        memory_packs_count: packs.length
    });
});

app.get('/', (req, res) => res.send('Hostile Server V4 (TFG Auto-License) Active.'));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Running on port ${PORT}`);
        console.log(`[SERVER] AUTO_LICENSE_MODE: ${AUTO_LICENSE_MODE}`);
    });
}

module.exports = app;
