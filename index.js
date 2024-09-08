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


async function connectToWhatsApp(nomor) {
    const store = makeInMemoryStore({ })
    const { state, saveCreds } = await useMultiFileAuthState(`auth`)
    const { version, isLatest } = await fetchLatestWaWebVersion({});
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);
    const sock = makeWASocket({
        version: [2, 3000, 1016192183],
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        keepAliveIntervalMs: 60_000,
        connectTimeoutMs: 60_000,
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
                    if ([401, 403].includes(statusCode)) {
                        console.log(`Akun dikeluarkan`);
                    } else {
                        console.log(`Koneksi dimulai ulang`, lastDisconnect);
                        connectToWhatsApp();
                    }
                }           
                console.log('connection update', update);
            }

            if (events['creds.update']) {
                await saveCreds();
            }


            if (events.call) {
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


    async function mainHandler(msg) {
        
    }


    async function editMessage(chatId, edit, text) {
        await sock.sendMessage(chatId, { text, edit })
    }

    async function reactMessage(chatId, key, emote) {
        return await sock.sendMessage(chatId, {
            react: {
                text: emote,
                key: key
            }
        })
    }

}

connectToWhatsApp()
