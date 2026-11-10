'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const {
    getServerPrefix,
    setServerPrefix,
    getUserPrefix,
    setUserPrefix,
    defaultServerPrefix,
    validatePrefix,
} = require('../handlers/prefix');

const RESET_WORDS = new Set(['reset', 'clear', 'off', 'none', 'hapus', 'default']);

function messages(lang) {
    if (lang === 'id') {
        return {
            title: '### Pengaturan Prefix',
            serverCurrent: (p) => `**Prefix Server:** \`${p}\` (contoh: \`${p}p <lagu>\`, \`${p}s\`, \`${p}q\`)`,
            userCurrent: (p) => p
                ? `**Prefix Pribadimu:** \`${p}\` (contoh: \`${p}p <lagu>\`, \`${p}play <lagu>\`, \`${p}s\`)`
                : '**Prefix Pribadimu:** Belum diatur',
            howTo: (sp) => [
                '**Cara Mengatur:**',
                `• Set prefix pribadi: \`${sp}prefix <prefix>\` atau \`/prefix personal:<prefix>\` (contoh: \`${sp}prefix d\`)`,
                `• Hapus prefix pribadi: \`${sp}prefix reset\``,
                `• Ubah prefix server (Admin): \`${sp}prefix server <prefix>\` atau \`/prefix server:<prefix>\``,
            ].join('\n'),
            userSet: (p) => `Prefix pribadimu berhasil diatur ke **\`${p}\`**!\nSekarang kamu bisa memutar lagu dengan mengetik **\`${p}p <lagu>\`** atau **\`${p}play <lagu>\`** (serta \`${p}s\`, \`${p}q\`, \`${p}dc\`).`,
            userReset: 'Prefix pribadimu telah dihapus. Kamu tetap bisa menggunakan prefix server.',
            serverSet: (p) => `Prefix server berhasil diubah ke **\`${p}\`**! Contoh penggunaan: **\`${p}p <lagu>\`** atau **\`${p}play <lagu>\`**.`,
            serverReset: (p) => `Prefix server telah dikembalikan ke default: **\`${p}\`**.`,
            invalid: 'Prefix tidak valid! Gunakan 1–10 karakter tanpa spasi dan tidak diawali `/` (contoh: `d`, `m!`, `f!`).',
            noPermission: 'Kamu memerlukan izin **Kelola Server (Manage Server)** untuk mengubah prefix server!',
        };
    }
    return {
        title: '### Prefix Settings',
        serverCurrent: (p) => `**Server Prefix:** \`${p}\` (e.g. \`${p}p <song>\`, \`${p}s\`, \`${p}q\`)`,
        userCurrent: (p) => p
            ? `**Your Personal Prefix:** \`${p}\` (e.g. \`${p}p <song>\`, \`${p}play <song>\`, \`${p}s\`)`
            : '**Your Personal Prefix:** Not set',
        howTo: (sp) => [
            '**How to Change:**',
            `• Set personal prefix: \`${sp}prefix <prefix>\` or \`/prefix personal:<prefix>\` (e.g. \`${sp}prefix d\`)`,
            `• Clear personal prefix: \`${sp}prefix reset\``,
            `• Change server prefix (Admin): \`${sp}prefix server <prefix>\` or \`/prefix server:<prefix>\``,
        ].join('\n'),
        userSet: (p) => `Your personal prefix has been set to **\`${p}\`**!\nYou can now play music with **\`${p}p <song>\`** or **\`${p}play <song>\`** (and \`${p}s\`, \`${p}q\`, \`${p}dc\`).`,
        userReset: 'Your personal prefix has been cleared. You can still use the server prefix.',
        serverSet: (p) => `Server prefix has been set to **\`${p}\`**! Example: **\`${p}p <song>\`** or **\`${p}play <song>\`**.`,
        serverReset: (p) => `Server prefix has been reset to default: **\`${p}\`**.`,
        invalid: 'Invalid prefix! Use 1–10 characters without spaces and not starting with `/` (e.g. `d`, `m!`, `f!`).',
        noPermission: 'You need the **Manage Server** permission to change the server prefix!',
    };
}

function parseRawPrefixArgs(raw) {
    const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { target: 'info', value: null };
    const first = tokens[0].toLowerCase();
    if (first === 'info' || first === 'status') return { target: 'info', value: null };
    if (first === 'server' || first === 'guild') {
        return { target: 'server', value: tokens[1] || '' };
    }
    if (first === 'my' || first === 'personal' || first === 'me' || first === 'set') {
        return { target: 'personal', value: tokens[1] || '' };
    }
    return { target: 'personal', value: tokens[0] };
}

module.exports = {
    category: 'settings',
    data: command('prefix', 'Set your personal custom prefix or change the server prefix')
        .addStringOption((option) => option
            .setName('personal')
            .setDescription('Your personal prefix (e.g. "d" for dp/dplay, or "reset" to clear)')
            .setMaxLength(10))
        .addStringOption((option) => option
            .setName('server')
            .setDescription('Server prefix — requires Manage Server (e.g. "f!" or "reset")')
            .setMaxLength(10)),

    async execute(interaction, { t }) {
        const msg = messages(t.lang);
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        let personalArg = interaction.options.getString('personal')?.trim() || null;
        let serverArg = interaction.options.getString('server')?.trim() || null;

        const raw = interaction.options.getString('raw');
        if (raw !== null && raw !== undefined && !personalArg && !serverArg) {
            const parsed = parseRawPrefixArgs(raw);
            if (parsed.target === 'server') serverArg = parsed.value || null;
            else if (parsed.target === 'personal') personalArg = parsed.value || null;
        }

        if (serverArg) {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return say(interaction, msg.noPermission);
            }
            if (RESET_WORDS.has(serverArg.toLowerCase())) {
                const def = await setServerPrefix(guildId, null);
                return say(interaction, msg.serverReset(def), { ephemeral: false });
            }
            const clean = validatePrefix(serverArg);
            if (!clean) return say(interaction, msg.invalid);
            await setServerPrefix(guildId, clean);
            return say(interaction, msg.serverSet(clean), { ephemeral: false });
        }

        if (personalArg) {
            if (RESET_WORDS.has(personalArg.toLowerCase())) {
                await setUserPrefix(userId, null);
                return say(interaction, msg.userReset);
            }
            const clean = validatePrefix(personalArg);
            if (!clean) return say(interaction, msg.invalid);
            await setUserPrefix(userId, clean);
            return say(interaction, msg.userSet(clean));
        }

        const sp = getServerPrefix(guildId);
        const up = getUserPrefix(userId);
        const info = [
            msg.title,
            msg.serverCurrent(sp),
            msg.userCurrent(up),
            '',
            msg.howTo(sp),
        ].join('\n');
        return say(interaction, info);
    },
};

