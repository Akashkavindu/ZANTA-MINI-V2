const { getContentType } = require("baileys-elite");

/**
 * WhatsApp මැසේජ් එකක් සරල කර බොට් එකට කියවිය හැකි ලෙස සකසයි
 * @param {Object} conn (Socket Connection)
 * @param {Object} m (Raw Message)
 */
function sms(conn, m) {
    if (m.key) {
        m.id = m.key.id;
        m.isSelf = m.key.fromMe;
        m.chat = m.key.remoteJid;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.isSelf ? conn.user.id : (m.key.participant || m.key.remoteJid);
        m.sender = m.sender.split(':')[0] + '@s.whatsapp.net'; // LID issues fix
    }

    if (m.message) {
        m.type = getContentType(m.message);
        m.msg = (m.type === 'viewOnceMessageV2') ? m.message.viewOnceMessageV2.message[getContentType(m.message.viewOnceMessageV2.message)] : m.message[m.type];
        
        // මැසේජ් එකේ අන්තර්ගතය (Text/Caption) ලබා ගැනීම
        m.body = (m.type === 'conversation') ? m.message.conversation : 
                 (m.type === 'imageMessage') ? m.message.imageMessage.caption : 
                 (m.type === 'videoMessage') ? m.message.videoMessage.caption : 
                 (m.type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : 
                 (m.type === 'buttonsResponseMessage') ? m.message.buttonsResponseMessage.selectedButtonId : 
                 (m.type === 'listResponseMessage') ? m.message.listResponseMessage.singleSelectReply.selectedRowId : 
                 (m.type === 'templateButtonReplyMessage') ? m.message.templateButtonReplyMessage.selectedId : 
                 (m.type === 'interactiveResponseMessage') ? JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id : '';

        // Quoted message (Reply කරපු මැසේජ් එක) හසුරුවන කොටස
        m.quoted = m.msg?.contextInfo ? m.msg.contextInfo.quotedMessage : null;
        if (m.quoted) {
            let type = getContentType(m.quoted);
            m.quoted = m.quoted[type];
            if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
            m.quoted.mtype = type;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.sender = m.msg.contextInfo.participant.split(':')[0] + '@s.whatsapp.net';
            m.quoted.isSelf = m.quoted.sender === (conn.user && conn.user.id);
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || '';
        }
    }

    // මැසේජ් එකට රිප්ලයි කිරීමේ පහසුව සඳහා
    m.reply = (text) => conn.sendMessage(m.chat, { text: text }, { quoted: m });

    return m;
}

module.exports = { sms };
