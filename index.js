const express = require('express');
const cors = require('cors');
const CryptoJS = require("crypto-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONSTANTE CRÍTICA REPARADA ---
// 120 caracteres, sin padding '==', puro alfanumérico.
// Esto evita el crash de atob() en el cliente.
const SAFE_LICENSE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5emFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MTIzNDU2Nzg5MA";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
let packs = [];

const verifyXToken = (req, res, next) => {
    if (req.path.startsWith('/admin')) return next();
    const token = req.headers['x-token'];
    if (!token) { req.user = { userId: 'unknown' }; return next(); }
    try {
        const bytes = CryptoJS.AES.decrypt(token, "");
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) throw new Error("Empty");
        req.user = JSON.parse(decryptedString);
        next();
    } catch (error) {
        req.user = { userId: 'unknown' };
        next();
    }
};
app.use(verifyXToken);

const checkUserLicense = (userId) => {
    const allowedIdsString = process.env.ALLOWED_IDS || process.env.ALLOWED_PLAYERS || "";
    const allowedIds = allowedIdsString.split(',').map(id => id.trim());
    
    console.log(`[CHECK] ID: ${userId} vs ALLOWED: ${allowedIdsString}`);

    if (allowedIds.includes('*') || allowedIds.includes(userId.toString())) {
        return { valid: true, days: 365 };
    }
    return { valid: false, days: 0 };
};

const handleCheckLicense = (req, res) => {
    const targetId = (req.user.userId !== 'unknown') ? req.user.userId : req.body.playerId;
    if (!targetId) return res.status(400).json({ error: "No ID" });

    const status = checkUserLicense(targetId);

    if (status.valid) {
        // ESTRUCTURA EXACTA PARA EVITAR CRASH DE UI
        res.json({
            licence: SAFE_LICENSE,
            days: status.days,
            object: { valid: true, until: "2099-12-31" },
            q: "activated_ok"
        });
    } else {
        res.json({
            licence: "",
            days: 0,
            object: { valid: false },
            q: null
        });
    }
};

// Soporte para todas las rutas y métodos
app.all(['/check-licence/check/:key', '/api/v2/check-license'], handleCheckLicense);

app.all(['/check-licence/free', '/api/v2/free'], (req, res) => {
    res.json({
        licence: SAFE_LICENSE,
        days: 1,
        object: { valid: true, type: "TRIAL" },
        q: "trial_ok"
    });
});

// Rutas de Packs (Sin cambios, funcionan bien)
app.post('/pack/request', (req, res) => {
    if (packs.length > 500) packs = packs.slice(-200);
    const clientId = req.user.userId !== 'unknown' ? req.user.userId : req.body.clientId;
    const newPack = {
        _id: Math.random().toString(36).substr(2, 9),
        clientId: clientId ? clientId.toString() : "anon",
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
app.get(['/pack/pending/:playerId', '/pack/pending'], (req, res) => {
    const pid = req.params.playerId || req.user.userId || req.query.playerId;
    res.json(packs.filter(p => p.bankId === pid?.toString() && p.state === 'pending'));
});
app.get(['/pack/ready/:playerId', '/pack/ready'], (req, res) => {
    const pid = req.params.playerId || req.user.userId || req.query.playerId;
    res.json(packs.filter(p => p.clientId === pid?.toString() && p.state === 'ready'));
});
app.patch('/pack/state', (req, res) => {
    const idx = packs.findIndex(p => p._id === req.body.packId);
    if (idx !== -1) { packs[idx].state = req.body.state; res.json({ success: true }); }
    else res.status(404).json({ error: "Not found" });
});
app.delete('/pack/:id', (req, res) => {
    packs = packs.filter(p => p._id !== req.params.id);
    res.json({ success: true });
});
app.get('/', (req, res) => res.send('Hostile Server V6 (Final Fix)'));

if (require.main === module) { app.listen(PORT, () => console.log(`Port ${PORT}`)); }
module.exports = app;
