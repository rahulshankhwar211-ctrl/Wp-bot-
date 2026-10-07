const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');

const BOT_PHONE_NUMBER = '917464963392';

const adminSessions = {};
let activeTargetJid = '';
let savedCustomMessage = '';
let isReplyActive = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false
    });

    if (!sock.authState.creds.registered) {
        await delay(3000);
        const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
        console.log(`\n========================================`);
        console.log(`🔑 AAPKA PAIRING CODE HAI: ${code}`);
        console.log(`WhatsApp > Linked Devices > Link with phone number me dalein`);
        console.log(`========================================\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot successfully Render par connect ho gaya!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            const from = msg.key.remoteJid;
            const isMe = msg.key.fromMe;
            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || '';

            if (isMe) {
                let session = adminSessions[from] || { step: 'IDLE' };

                if (text === '.setup') {
                    adminSessions[from] = { step: 'CHOOSE_TARGET' };
                    await sock.sendMessage(from, {
                        text: '⚙️ *SETUP WIZARD*\n\nTarget choose karein:\n1️⃣ Group me lagana hai (Type: 1)\n2️⃣ Direct user ko bhejna hai (Type: 2)'
                    });
                    return;
                }

                if (session.step === 'CHOOSE_TARGET') {
                    if (text === '1') {
                        adminSessions[from].step = 'AWAITING_LINK';
                        await sock.sendMessage(from, { text: '🔗 Target Group ka invite link bhejiye:' });
                    } else if (text === '2') {
                        adminSessions[from].step = 'AWAITING_NUMBER';
                        await sock.sendMessage(from, { text: '📱 Target user ka mobile number bhejiye (Country code ke sath):' });
                    }
                    return;
                }

                if (session.step === 'AWAITING_LINK') {
                    const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/);
                    if (match) {
                        try {
                            const groupId = await sock.groupAcceptInvite(match[1]);
                            activeTargetJid = groupId;
                            adminSessions[from].step = 'AWAITING_MESSAGE';
                            await sock.sendMessage(from, { text: `✅ Group join ho gaya!\n\nAb wo *Custom Message* bhejiye jo bot ko reply me bhejna hai:` });
                        } catch (err) {
                            await sock.sendMessage(from, { text: `❌ Join error: ${err.message}. Sahi link dobara bhejein:` });
                        }
                    }
                    return;
                }

                if (session.step === 'AWAITING_NUMBER') {
                    const cleanNum = text.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 10) {
                        activeTargetJid = `${cleanNum}@s.whatsapp.net`;
                        adminSessions[from].step = 'AWAITING_MESSAGE';
                        await sock.sendMessage(from, { text: `✅ User lock ho gaya!\n\nAb wo *Custom Message* bhejiye jo bot ko reply me bhejna hai:` });
                    }
                    return;
                }

                if (session.step === 'AWAITING_MESSAGE') {
                    savedCustomMessage = text;
                    isReplyActive = true;
                    adminSessions[from].step = 'IDLE';
                    await sock.sendMessage(from, {
                        text: `🎯 *SETUP COMPLETE!*\n\n• Target: ${activeTargetJid}\n• Message: "${savedCustomMessage}"\n• Status: Active\n\n(Rokane ke liye *.stop* likhein, Dobara chalu karne ke liye *.start* likhein)`
                    });
                    return;
                }

                if (text === '.stop') {
                    isReplyActive = false;
                    await sock.sendMessage(from, { text: '🛑 Bot response band kar diya gaya hai.' });
                    return;
                }

                if (text === '.start') {
                    isReplyActive = true;
                    await sock.sendMessage(from, { text: '⚡ Bot response chalu kar diya gaya hai.' });
                    return;
                }

                if (text.startsWith('.setname')) {
                    const newTitle = text.replace('.setname', '').trim();
                    const target = activeTargetJid || from;
                    if (newTitle && target.endsWith('@g.us')) {
                        try {
                            await sock.groupUpdateSubject(target, newTitle.slice(0, 100));
                            await sock.sendMessage(from, { text: `🔥 Group name changed: "${newTitle}"` });
                        } catch (e) {
                            await sock.sendMessage(from, { text: `❌ Name change failed (Admin rights check karein): ${e.message}` });
                        }
                    }
                    return;
                }
            }

            if (isReplyActive && from === activeTargetJid && !isMe) {
                sock.sendMessage(from, { text: savedCustomMessage }, { quoted: msg }).catch(() => {});
            }
        }
    });
}

startBot();
