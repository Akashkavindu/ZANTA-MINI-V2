const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const router = express.Router();
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
} = require("baileys-elite"); // ✅ Elite Engine එකට මාරු කළා

// MongoDB Session Schema (අපේ index.js එකේ එකටම සමානයි)
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, required: true },
    added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

    async function RobinPair() {
        // තාවකාලිකව සෙෂන් එක සේව් වෙන්න ෆෝල්ඩරයක්
        const authPath = `./temp_session_${Date.now()}`; 
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        try {
            let RobinPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.ubuntu("Chrome"), // ✅ වඩාත් ස්ථාවරයි
            });

            if (!RobinPairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, "");
                const code = await RobinPairWeb.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            RobinPairWeb.ev.on("creds.update", saveCreds);
            RobinPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(5000);
                        const user_jid = jidNormalizedUser(RobinPairWeb.user.id);
                        
                        // 1. MongoDB එකට අපේ Format එකටම සේව් කිරීම
                        const session_json = JSON.parse(fs.readFileSync(`${authPath}/creds.json`, "utf8"));
                        
                        await Session.findOneAndUpdate(
                            { number: user_jid },
                            { number: user_jid, creds: session_json },
                            { upsert: true }
                        );

                        console.log(`✅ [DB] Session saved for ${user_jid}`);

                        const success_msg = `╔════════════════════╗\n ✨ *ZANTA-MD CONNECTED* ✨\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n*🗄️ Database:* MongoDB Secured 🔒\n\n> ඔබේ දත්ත MongoDB Database එකේ ආරක්ෂිතව තැන්පත් කරන ලදී. දැන් බොට් ස්වයංක්‍රීයව ක්‍රියාත්මක වනු ඇත.\n\n*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

                        await RobinPairWeb.sendMessage(user_jid, { text: success_msg });

                    } catch (e) {
                        console.error("❌ DB Error:", e);
                    } finally {
                        await delay(2000);
                        removeFile(authPath); // Cleanup
                        console.log("♻️ Local Temp Files Cleared.");
                        // process.exit(0) අවශ්‍ය නැත, මොකද index.js එක දිගටම run විය යුතුයි
                    }
                } else if (connection === "close") {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    if (reason !== 401) {
                        // වැරදීමකින් close වුණොත් විතරක් රීට්‍රයි කරන්න
                    }
                }
            });
        } catch (err) {
            console.log("Service Error:", err);
            if (!res.headersSent) res.status(500).send({ error: "Internal Error" });
        }
    }
    return await RobinPair();
});

module.exports = router;
