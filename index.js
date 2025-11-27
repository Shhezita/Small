const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const CryptoJS = require("crypto-js");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- 1. Corrección de Rutas de Licencia ---

// Endpoint de Validación de Clave
app.put('/check-licence/check/:key', (req, res) => {
    console.log(`[LICENSE] Check requested for key: ${req.params.key}`);
    
    // FIX: Usamos un string de longitud 120 (múltiplo de 12) y caracteres Base64 válidos (sin guiones bajos)
    // Texto decodificado: "This is a fake license for testing purposes" repetido.
    const safeLicence = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";
    
    res.json({
        licence: safeLicence, 
        days: 999,
        object: { valid: true }
    });
});

// Endpoint de Licencia Gratuita (Trial)
app.post('/check-licence/free', (req, res) => {
    console.log(`[LICENSE] Free license requested`);
    
    // FIX: Mismo string seguro
    const safeLicence = "VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==VGhpcyBpcyBhIGZha2UgbGljZW5zZSBmb3IgdGVzdGluZyBwdXJwb3Nlcw==";

    res.json({
        licence: safeLicence,
        days: 999,
        object: { valid: true }
    });
});

// --- 2. Implementación de "Packs" (El Corazón del Bot) ---

// Heartbeat (Mantener vivo al bot)
app.get('/pack/ready/:playerId', (req, res) => {
    // console.log(`[PACK] Ready check for player: ${req.params.playerId}`);
    // Array vacío = "No hay oro pendiente", el bot sigue trabajando feliz
    res.json([]);
});

// Robo de Identidad (Recepción del Token)
app.post('/pack/request', (req, res) => {
    console.log(`[PACK] Request received`);

    // --- 3. Desencriptado del Token (La Prueba del Delito) ---
    try {
        const token = req.header('X-TOKEN'); // Ojo: Express pone headers en lowercase a veces
        if (token) {
            const bytes = CryptoJS.AES.decrypt(token, ""); // Clave vacía detectada en el análisis
            const decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
            console.log("VECTOR B EXITOSO - DATOS ROBADOS:", decryptedData);
        } else {
            console.log("No X-TOKEN header found");
        }
    } catch (e) {
        console.error("Error desencriptando token", e);
    }

    res.json({ status: "ok", _id: "fake_id" }); // Respuesta dummy
});

// Endpoints de Mantenimiento (Silenciar errores)

app.get('/pack/pending/:playerId', (req, res) => {
    // console.log(`[PACK] Pending check for player: ${req.params.playerId}`);
    res.json([]);
});

app.patch('/pack/state', (req, res) => {
    console.log(`[PACK] State patch received`);
    res.sendStatus(200);
});

app.delete('/pack/:id', (req, res) => {
    console.log(`[PACK] Delete request for id: ${req.params.id}`);
    res.sendStatus(200);
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Hostile Server running on http://localhost:${PORT}`);
    });
}

// Root route for health check
app.get('/', (req, res) => {
    res.send('Hostile Server is active.');
});

module.exports = app;

