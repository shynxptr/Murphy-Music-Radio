'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');

function extractUserId(text) {
    if (!text) return null;
    const match = String(text).trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
    return match ? (match[1] || match[2]) : null;
}

function parseRawPremArgs(raw) {
    const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { sub: 'help', tokens: [] };
    return { sub: tokens[0].toLowerCase(), tokens: tokens.slice(1) };
}

module.exports = {
    category: 'settings',
    data: command('prem', 'Bot Owner: manage Murphy Premium users and voucher codes')
        .addStringOption((option) => option
            .setName('raw')
            .setDescription('Subcommand (add @user 30d | remove @user | gen 30d [count] | list | info @user)')
            .setMaxLength(200)),

    async execute(interaction, { t }) {
        const isId = t.lang === 'id';
        if (!murphy.isBotOwner(interaction.user.id)) {
            return say(interaction, isId
                ? `🔒 Perintah ini hanya untuk **Owner Bot** (\`BOT_OWNER_ID\`).\n-# ${murphy.FOOTER}`
                : `🔒 This command is restricted to the **Bot Owner** (\`BOT_OWNER_ID\`).\n-# ${murphy.FOOTER}`);
        }

        const raw = interaction.options.getString('raw') || '';
        const { sub, tokens } = parseRawPremArgs(raw);

        if (sub === 'add' || sub === 'give') {
            const targetId = extractUserId(tokens[0]);
            const dur = tokens[1] || '30d';
            if (!targetId) {
                return say(interaction, 'Format: `f!prem add @user 30d` (atau `7d`, `90d`, `lifetime`)');
            }
            try {
                const record = await murphy.grantPremium(targetId, dur, { grantedBy: interaction.user.id });
                const remaining = murphy.formatRemaining(t.lang, record);
                return say(interaction, `✅ <@${targetId}> sekarang **Murphy Premium** (**${remaining}**).\n-# ${murphy.FOOTER}`, { ephemeral: false });
            } catch {
                return say(interaction, 'Durasi tidak valid! Gunakan contoh: `7d`, `30d`, `90d`, `1y`, atau `lifetime`.');
            }
        }

        if (sub === 'remove' || sub === 'del' || sub === 'revoke') {
            const targetId = extractUserId(tokens[0]);
            if (!targetId) return say(interaction, 'Format: `f!prem remove @user`');
            const removed = await murphy.revokePremium(targetId);
            return say(interaction, removed
                ? `🚫 Status **Murphy Premium** untuk <@${targetId}> telah dicabut.`
                : `<@${targetId}> tidak sedang berlangganan Murphy Premium.`);
        }

        if (sub === 'gen' || sub === 'voucher' || sub === 'code') {
            const dur = tokens[0] || '30d';
            const count = tokens[1] ? Number.parseInt(tokens[1], 10) : 1;
            try {
                const created = await murphy.generateVouchers(dur, count, { createdBy: interaction.user.id });
                const list = created.map((v) => `\`${v.code}\` (${v.duration})`).join('\n');
                return say(interaction, `🎟️ **Voucher Murphy Premium Dibuat:**\n${list}\n-# Pembeli bisa klaim dengan \`f!redeem <kode>\``);
            } catch {
                return say(interaction, 'Durasi tidak valid! Contoh: `f!prem gen 30d 5` atau `f!prem gen lifetime 1`.');
            }
        }

        if (sub === 'info' || sub === 'check') {
            const targetId = extractUserId(tokens[0]) || interaction.user.id;
            const record = murphy.getPremium(targetId);
            if (!record) return say(interaction, `<@${targetId}> saat ini berstatus **Free**.`);
            return say(interaction, `💎 <@${targetId}> · **${murphy.formatRemaining(t.lang, record)}**`);
        }

        if (sub === 'list') {
            const users = murphy.listPremiumUsers();
            if (!users.length) return say(interaction, 'Belum ada pelanggan Murphy Premium aktif.');
            const lines = users.slice(0, 25).map((u, idx) =>
                `\`${idx + 1}.\` <@${u.userId}> — **${murphy.formatRemaining(t.lang, u)}**`);
            if (users.length > 25) lines.push(`-# ... +${users.length - 25} lainnya`);
            return say(interaction, `### 💎 Pelanggan Murphy Premium Aktif (${users.length})\n${lines.join('\n')}`);
        }

        return say(interaction, [
            '### 🛠️ Murphy Premium Owner Panel',
            '• `f!prem add @user 30d` — Beri / perpanjang Premium user (`7d`, `30d`, `lifetime`)',
            '• `f!prem remove @user` — Cabut Premium user',
            '• `f!prem gen 30d [jumlah]` — Buat kode voucher `MURPHY-XXXX-XXXX`',
            '• `f!prem list` — Lihat daftar pelanggan aktif',
            '• `f!prem info @user` — Cek detail langganan user',
        ].join('\n'));
    },
};
