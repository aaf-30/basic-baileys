const { makeWASocket, makeCacheableSignalKeyStore, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, fetchLatestWaWebVersion, makeInMemoryStore, delay, downloadMediaMessage, proto, isJidBroadcast, isJidGroup, WAMessageKey, WAMessageContent, Browsers } = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');
const fs = require('fs');
const readline = require("readline");
const logger = require("pino")({ level: "silent" });
const rl = readline.createInterface({
 input: process.stdin,
 output: process.stdout,
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
const store = makeInMemoryStore({ })

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(`auth`)
    const { currentVersion } = await (await fetch("https://cdn.jsdelivr.net/gh/wppconnect-team/wa-version@main/versions.json")).json();
    const version = (currentVersion.match(/\d+\.\d+\.\d+/g)?.[0] || "2.3000.1016320664").split(".")
    console.log(`using WA v${version.join(".")}`);
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        syncFullHistory: false,
        markOnlineOnConnect: true,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        getMessage,
        browser: Browsers.macOS("Safari"),

    });

    store?.bind(sock.ev);

    if (!sock.authState.creds.registered) {
        await delay(3000)
        const phoneNumber = await question("Mohon masukkan nomor WhatsApp-mu disertai kode negara (contoh 6285xxx):\n",);
        const code = await sock.requestPairingCode(phoneNumber)
        await console.log(code)
    }

    sock.ev.process(
        async (events) => {
            if (events['connection.update']) {
                const update = events['connection.update'];
                const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if ([401, 403, 440].includes(statusCode)) {
                        console.log(`connection closed, account logged out.`);
                    } else {
                        console.log(`connection restarted`, lastDisconnect);
                        connectToWhatsApp();
                    }
                }           
                console.log('connection update', update);
            }

            if (events['creds.update']) {
                await saveCreds();
            }

            if (events.call) {
                // reject call
                console.log('recv call event', events.call);
                const call = events.call
                let chatId = String(call[0].from)
                let userId = chatId.split("@")[0]
                if (call[0].status == 'offer') {
                    await sock.rejectCall(String(call[0].id), chatId)
                }
            }

            if (events['messaging-history.set']) {
                const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
                console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`);
            }

            if (events['messages.upsert']) {
                const upsert = events['messages.upsert'];
                switch (upsert.type) {
                    case "notify":
                    case "append":
                        for (const msg of upsert.messages) {
                            // handle incoming messages
                            console.log(msg)
                        }
                        break;
                }
            }
        }
    )
    return sock;

    async function getMessage(key) {
        if (store) {
            const msg = await store.loadMessage(key.remoteJid, key.id);
            return msg?.message || proto.Message.fromObject({});
        }
        return proto.Message.fromObject({});
    }
}

connectToWhatsApp()
