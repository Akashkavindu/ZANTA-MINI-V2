const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    Browsers
} = require("baileys-elite");

const fs = require("fs-extra");
const P = require("pino");
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const config = require("./config");
const { sms } = require("./lib/msg");
const { getGroupAdmins } = require("./lib/functions");
const { commands } = require("./command");
const { connectDB, getBotSettings, updateSetting } = require("./plugins/bot_db");

const activeSockets = new Set();
global.BOT_SESSIONS_CONFIG = {};
const PORT = process.env.PORT || 8000;

// --- 📦 MongoDB Session Schema ---
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, required: true }
}, { collection: 'sessions' });
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jid.split(':');
        return (decode[0] + '@' + decode[1].split('@')[1]) || jid;
    }
    return jid;
};

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'web'))); // සයිට් එකේ CSS/JS වලට

// --- 🌐 Pair Logic ---
// ඔයාගේ පරණ 'pair.js' එක මේ project එක ඇතුළට අරන් මෙතනින් link කරන්න
let codeRouter = require('./pair'); 
app.use('/code', codeRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// --- 🚀 Core Bot System ---
async function startSystem() {
    await connectDB();
    
    // Plugins Load කිරීම
    const pluginsPath = path.join(__dirname, "plugins");
    if (fs.existsSync(pluginsPath)) {
        fs.readdirSync(pluginsPath).forEach((plugin) => {
            if (path.extname(plugin).toLowerCase() === ".js") {
                try { require(`./plugins/${plugin}`); } catch (e) { console.error(`[Loader] Error ${plugin}:`, e); }
            }
        });
    }
    console.log(`✨ Loaded: ${commands.length} Commands`);

    // DB එකෙන් පරණ Sessions load කර connect කිරීම
    const allSessions = await Session.find({});
    console.log(`📂 Total sessions: ${allSessions.length}. Connecting...`);
    for (let sessionData of allSessions) {
        await connectToWA(sessionData);
    }

    // ⚡ වැදගත්ම කොටස: සයිට් එකෙන් කවුරුහරි අලුතින් scan කළොත් ඒ වෙලාවෙම connect වීම
    Session.watch().on('change', async (data) => {
        if (data.operationType === 'insert') {
            console.log("🆕 New session detected! Connecting...");
            await connectToWA(data.fullDocument);
        }
    });
}

async function connectToWA(sessionData) {
    const userNumber = sessionData.number.split("@")[0];
    global.BOT_SESSIONS_CONFIG[userNumber] = await getBotSettings(userNumber);
    let userSettings = global.BOT_SESSIONS_CONFIG[userNumber];

    const authPath = path.join(__dirname, `./auth/${userNumber}/`);
    await fs.ensureDir(authPath);
    await fs.writeJSON(path.join(authPath, "creds.json"), sessionData.creds);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const zanta = makeWASocket({
        logger: P({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        auth: state,
        syncFullHistory: false,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage || message.interactiveMessage);
            if (requiresPatch) {
                return { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
            }
            return message;
        }
    });

    activeSockets.add(zanta);

    zanta.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            activeSockets.delete(zanta);
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(sessionData), 5000);
            } else {
                await Session.deleteOne({ number: sessionData.number });
                await fs.remove(authPath);
            }
        } else if (connection === "open") {
            console.log(`✅ [${userNumber}] Connected via Elite Engine`);
            if (userSettings?.connectionMsg === 'true') {
                await zanta.sendMessage(decodeJid(zanta.user.id), {
                    text: `*${userSettings.botName || 'ZANTA-MD'}* is Online 🤖`,
                    ai: true 
                });
            }
        }
    });

    zanta.ev.on("creds.update", saveCreds);

    zanta.ev.on("messages.upsert", async ({ messages }) => {
        const mek = messages[0];
        if (!mek || !mek.message) return;
        userSettings = global.BOT_SESSIONS_CONFIG[userNumber];
        const from = mek.key.remoteJid;
        const type = getContentType(mek.message);
        const body = (type === "conversation") ? mek.message.conversation : (mek.message[type]?.text || mek.message[type]?.caption || "");
        const prefix = userSettings?.prefix || ".";
        const isCmd = body.startsWith(prefix);

        if (from === "status@broadcast" && userSettings?.autoStatusSeen === 'true') {
            await zanta.readMessages([mek.key]);
            return;
        }
        if (!isCmd) return;

        const m = sms(zanta, mek);
        const commandName = body.slice(prefix.length).trim().split(" ")[0].toLowerCase();
        const args = body.trim().split(/ +/).slice(1);
        const reply = (text) => zanta.sendMessage(from, { text, ai: true }, { quoted: mek });

        const cmd = commands.find(c => c.pattern === commandName || (c.alias && c.alias.includes(commandName)));
        if (cmd) {
            try {
                await cmd.function(zanta, mek, m, {
                    from, body, isCmd, command: commandName, args, q: args.join(" "),
                    reply, prefix, userSettings
                });
            } catch (e) { console.error(e); }
        }
    });
}

// Startup
startSystem();

app.listen(PORT, () => {
    console.log(`🚀 ZANTA-MD Server & Site started on port ${PORT}`);
});
