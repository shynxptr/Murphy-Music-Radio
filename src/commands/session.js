'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');

function messages(lang) {
    if (lang === 'id') {
        return {
            title: '### Informasi Sesi Bot (Session Owner)',
            noSession: `Belum ada sesi aktif di bot ini! Ketik \`f!p <lagu>\` atau \`f!afk on\` di voice channel untuk menjadi **Session Owner**.\n-# ${murphy.FOOTER}`,
            ownerLine: (ownerId) => `👑 **Session Owner:** <@${ownerId}>`,
            channelLine: (channelId) => (channelId ? `🔊 **Voice Channel:** <#${channelId}>` : null),
            allowedLine: (ids) => (ids.length
                ? `✅ **Member Diizinkan (${ids.length}):** ${ids.map((id) => `<@${id}>`).join(', ')}`
                : '✅ **Member Diizinkan:** Belum ada (hanya Session Owner)'),
            howTo: [
                '**Perintah Session Owner:**',
                '• Izinkan teman mengontrol bot: `f!allow @user` atau `/session action:allow user:@user`',
                '• Cabut izin teman: `f!disallow @user` atau `/session action:disallow user:@user`',
                '• Pindahkan Session Owner: `f!transfer @user` atau `/session action:transfer user:@user`',
            ].join('\n'),
            onlyOwner: (ownerId) => `🔒 Hanya **Session Owner** (<@${ownerId}>) yang bisa menambah/mencabut izin atau memindahkan kepemilikan sesi ini!\n-# ${murphy.FOOTER}`,
            needUser: (example) => `Tag member yang dituju! Contoh: \`${example}\`\n-# ${murphy.FOOTER}`,
            cannotBot: `Kamu tidak bisa menjadikan bot sebagai pengontrol sesi!\n-# ${murphy.FOOTER}`,
            alreadyOwner: (id) => `<@${id}> sudah menjadi **Session Owner** di sesi ini!\n-# ${murphy.FOOTER}`,
            alreadyAllowed: (id) => `<@${id}> sudah ada di daftar yang diizinkan!\n-# ${murphy.FOOTER}`,
            notAllowed: (id) => `<@${id}> tidak ada di daftar yang diizinkan!\n-# ${murphy.FOOTER}`,
            allowedFull: `Daftar izin sesi sudah penuh (maksimal ${murphy.MAX_ALLOWED_USERS} member).\n-# ${murphy.FOOTER}`,
            allowedSuccess: (id) => `✅ <@${id}> sekarang diizinkan untuk ikut mengontrol bot di sesi ini (\`play\`, \`skip\`, \`pause\`, dll.)!\n-# ${murphy.FOOTER}`,
            disallowedSuccess: (id) => `🚫 Izin kontrol sesi untuk <@${id}> telah dicabut.\n-# ${murphy.FOOTER}`,
            transferredSuccess: (id) => `👑 **Session Owner** berhasil dipindahkan ke <@${id}>!\n-# ${murphy.FOOTER}`,
        };
    }
    return {
        title: '### Bot Session Info (Session Owner)',
        noSession: `There is no active session on this bot right now! Use \`f!p <song>\` or \`f!afk on\` in a voice channel to become the **Session Owner**.\n-# ${murphy.FOOTER}`,
        ownerLine: (ownerId) => `👑 **Session Owner:** <@${ownerId}>`,
        channelLine: (channelId) => (channelId ? `🔊 **Voice Channel:** <#${channelId}>` : null),
        allowedLine: (ids) => (ids.length
            ? `✅ **Allowed Members (${ids.length}):** ${ids.map((id) => `<@${id}>`).join(', ')}`
            : '✅ **Allowed Members:** None (Session Owner only)'),
        howTo: [
            '**Session Owner Commands:**',
            '• Allow a member to control the bot: `f!allow @user` or `/session action:allow user:@user`',
            '• Revoke a member\'s access: `f!disallow @user` or `/session action:disallow user:@user`',
            '• Transfer Session Ownership: `f!transfer @user` or `/session action:transfer user:@user`',
        ].join('\n'),
        onlyOwner: (ownerId) => `🔒 Only the **Session Owner** (<@${ownerId}>) can manage permissions or transfer ownership of this session!\n-# ${murphy.FOOTER}`,
        needUser: (example) => `Please mention a member! Example: \`${example}\`\n-# ${murphy.FOOTER}`,
        cannotBot: `You cannot grant session control to a bot!\n-# ${murphy.FOOTER}`,
        alreadyOwner: (id) => `<@${id}> is already the **Session Owner**!\n-# ${murphy.FOOTER}`,
        alreadyAllowed: (id) => `<@${id}> is already allowed in this session!\n-# ${murphy.FOOTER}`,
        notAllowed: (id) => `<@${id}> is not in the allowed list!\n-# ${murphy.FOOTER}`,
        allowedFull: `The allowed members list is full (max ${murphy.MAX_ALLOWED_USERS} members).\n-# ${murphy.FOOTER}`,
        allowedSuccess: (id) => `✅ <@${id}> is now allowed to control the bot in this session (\`play\`, \`skip\`, \`pause\`, etc.)!\n-# ${murphy.FOOTER}`,
        disallowedSuccess: (id) => `🚫 Session control access for <@${id}> has been revoked.\n-# ${murphy.FOOTER}`,
        transferredSuccess: (id) => `👑 **Session Owner** has been transferred to <@${id}>!\n-# ${murphy.FOOTER}`,
    };
}

function extractUserId(text) {
    if (!text) return null;
    const match = String(text).trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
    return match ? (match[1] || match[2]) : null;
}

function parseRawSessionArgs(alias, raw) {
    const trimmed = String(raw ?? '').trim();
    const tokens = trimmed ? trimmed.split(/\s+/) : [];

    if (alias === 'allow') {
        return { action: 'allow', targetId: extractUserId(tokens[0]) };
    }
    if (['disallow', 'unallow', 'deny'].includes(alias)) {
        return { action: 'disallow', targetId: extractUserId(tokens[0]) };
    }
    if (alias === 'transfer') {
        return { action: 'transfer', targetId: extractUserId(tokens[0]) };
    }

    if (!tokens.length) return { action: 'info', targetId: null };
    const first = tokens[0].toLowerCase();
    if (['info', 'status', 'list'].includes(first)) return { action: 'info', targetId: null };
    if (['allow', 'add', '+'].includes(first)) return { action: 'allow', targetId: extractUserId(tokens[1]) };
    if (['disallow', 'unallow', 'deny', 'remove', 'rm', '-'].includes(first)) {
        return { action: 'disallow', targetId: extractUserId(tokens[1]) };
    }
    if (['transfer', 'give', 'owner'].includes(first)) {
        return { action: 'transfer', targetId: extractUserId(tokens[1]) };
    }

    // e.g. `f!owner @user` transfers ownership directly
    const directUser = extractUserId(tokens[0]);
    if (directUser) return { action: 'transfer', targetId: directUser };
    return { action: 'info', targetId: null };
}

module.exports = {
    category: 'settings',
    data: command('session', 'View the current Session Owner or allow/disallow members to control the bot')
        .addStringOption((option) => option
            .setName('action')
            .setDescription('Session action to perform')
            .addChoices(
                { name: 'Info (View Owner & Allowed Users)', value: 'info' },
                { name: 'Allow Member', value: 'allow' },
                { name: 'Disallow Member', value: 'disallow' },
                { name: 'Transfer Ownership', value: 'transfer' },
            ))
        .addUserOption((option) => option
            .setName('user')
            .setDescription('Member to allow, disallow, or transfer Session Ownership to')),

    async execute(interaction, { t, manager }) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const msg = messages(t.lang);

        let action = interaction.options.getString?.('action') || null;
        let targetUser = interaction.options.getUser?.('user') || null;
        let targetId = targetUser?.id || null;

        const raw = interaction.options.getString?.('raw');
        const alias = interaction.options.getString?.('alias') || 'session';
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawSessionArgs(alias, raw);
            action = parsed.action;
            targetId = parsed.targetId;
        }
        action = action || 'info';

        let session = murphy.getSession(guildId);
        const queue = manager.getQueue(guildId);
        const botChannelId = interaction.guild?.members?.me?.voice?.channelId || queue?.voiceChannel?.id || null;

        // If a song is already playing without a recorded session, attribute it to the current song's requester
        if (!session && queue?.songs?.[0]?.user?.id && !queue.songs[0].user.bot) {
            session = await murphy.claimSession(guildId, queue.songs[0].user.id, botChannelId, interaction.client);
        }

        if (!session?.ownerId) {
            return say(interaction, msg.noSession);
        }

        if (action === 'info') {
            const lines = [
                msg.title,
                msg.ownerLine(session.ownerId),
                msg.channelLine(botChannelId || session.channelId),
                msg.allowedLine(session.allowedIds || []),
                '',
                msg.howTo,
                `-# ${murphy.FOOTER}`,
            ].filter((line) => line !== null);
            return say(interaction, lines.join('\n'));
        }

        if (!murphy.isSessionOwner(guildId, userId)) {
            return say(interaction, msg.onlyOwner(session.ownerId));
        }

        if (!targetId) {
            const example = action === 'allow'
                ? 'f!allow @user'
                : action === 'disallow'
                    ? 'f!disallow @user'
                    : 'f!transfer @user';
            return say(interaction, msg.needUser(example));
        }

        if (!targetUser) {
            targetUser = interaction.client?.users?.cache?.get(targetId)
                || interaction.guild?.members?.cache?.get(targetId)?.user
                || null;
        }
        if (targetUser?.bot || targetId === interaction.client?.user?.id) {
            return say(interaction, msg.cannotBot);
        }

        if (action === 'allow') {
            const res = await murphy.allowSessionUser(guildId, targetId, interaction.client);
            if (!res.ok) {
                if (res.reason === 'is_owner') return say(interaction, msg.alreadyOwner(targetId));
                if (res.reason === 'already_allowed') return say(interaction, msg.alreadyAllowed(targetId));
                if (res.reason === 'full') return say(interaction, msg.allowedFull);
            }
            manager.refreshPanel(guildId);
            return say(interaction, msg.allowedSuccess(targetId), { ephemeral: false });
        }

        if (action === 'disallow') {
            const res = await murphy.disallowSessionUser(guildId, targetId, interaction.client);
            if (!res.ok) return say(interaction, msg.notAllowed(targetId));
            manager.refreshPanel(guildId);
            return say(interaction, msg.disallowedSuccess(targetId), { ephemeral: false });
        }

        if (action === 'transfer') {
            const res = await murphy.transferSessionOwner(guildId, targetId, interaction.client);
            if (!res.ok) return say(interaction, msg.alreadyOwner(targetId));
            manager.refreshPanel(guildId);
            return say(interaction, msg.transferredSuccess(targetId), { ephemeral: false });
        }

        return say(interaction, msg.noSession);
    },
};
