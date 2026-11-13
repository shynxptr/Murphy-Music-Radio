'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');
const vip = require('../murphy_vip');

function extractUserId(text) {
    if (!text) return null;
    const match = String(text).trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
    return match ? (match[1] || match[2]) : null;
}

module.exports = {
    category: 'settings',
    data: command('trust', 'Trusted Squad: permanently auto-allow friends in every bot session you start (Premium)')
        .addStringOption((option) => option
            .setName('action')
            .setDescription('List, add, or remove a trusted friend')
            .addChoices(
                { name: 'List Trusted Squad', value: 'list' },
                { name: 'Add Friend', value: 'add' },
                { name: 'Remove Friend', value: 'remove' },
            ))
        .addUserOption((option) => option
            .setName('user')
            .setDescription('Friend to add or remove from your Trusted Squad')),

    async execute(interaction, { t }) {
        const userId = interaction.user.id;
        const isId = t.lang === 'id';

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Trusted Squad (f!trust)'));
        }

        let action = interaction.options.getString?.('action') || null;
        let targetUser = interaction.options.getUser?.('user') || null;
        let targetId = targetUser?.id || null;

        const raw = interaction.options.getString?.('raw');
        const alias = interaction.options.getString?.('alias') || 'trust';
        if (raw !== null && raw !== undefined && !action) {
            const tokens = raw.trim().split(/\s+/).filter(Boolean);
            if (alias === 'untrust') {
                action = 'remove';
                targetId = extractUserId(tokens[0]);
            } else if (!tokens.length || ['list', 'ls'].includes(tokens[0].toLowerCase())) {
                action = 'list';
            } else if (['remove', 'rm', 'del', 'delete', '-'].includes(tokens[0].toLowerCase())) {
                action = 'remove';
                targetId = extractUserId(tokens[1]);
            } else if (['add', '+'].includes(tokens[0].toLowerCase())) {
                action = 'add';
                targetId = extractUserId(tokens[1]);
            } else {
                action = 'add';
                targetId = extractUserId(tokens[0]);
            }
        }
        action = action || 'list';

        if (action === 'list') {
            const list = vip.getTrustedIds(userId);
            if (!list.length) {
                return say(interaction, isId
                    ? `🤝 **Trusted Squad** kamu masih kosong!\nTambahkan teman dengan \`f!trust @user\` agar mereka otomatis bisa mengontrol bot setiap kali kamu memanggil Murphy.\n-# ${murphy.FOOTER}`
                    : `🤝 Your **Trusted Squad** is empty!\nAdd friends with \`f!trust @user\` so they are automatically allowed in every session you start.\n-# ${murphy.FOOTER}`);
            }
            return say(interaction, isId
                ? `### 🤝 Trusted Squad Kamu (${list.length}/${vip.MAX_TRUSTED})\n${list.map((id) => `• <@${id}>`).join('\n')}\n\n-# Hapus teman: \`f!untrust @user\`\n-# ${murphy.FOOTER}`
                : `### 🤝 Your Trusted Squad (${list.length}/${vip.MAX_TRUSTED})\n${list.map((id) => `• <@${id}>`).join('\n')}\n\n-# Remove friend: \`f!untrust @user\`\n-# ${murphy.FOOTER}`);
        }

        if (!targetId) {
            return say(interaction, isId ? 'Tag teman yang dituju! Contoh: `f!trust @user`' : 'Please mention a friend! Example: `f!trust @user`');
        }

        if (action === 'remove') {
            const res = await vip.removeTrustedUser(userId, targetId);
            if (!res.ok) return say(interaction, isId ? `<@${targetId}> tidak ada di Trusted Squad.` : `<@${targetId}> is not in your Trusted Squad.`);
            return say(interaction, isId ? `🚫 <@${targetId}> dihapus dari Trusted Squad.` : `🚫 Removed <@${targetId}> from your Trusted Squad.`);
        }

        if (targetUser?.bot || targetId === interaction.client?.user?.id) {
            return say(interaction, isId ? 'Tidak bisa menambahkan bot ke Trusted Squad.' : 'Cannot add a bot to Trusted Squad.');
        }

        const res = await vip.addTrustedUser(userId, targetId);
        if (!res.ok) {
            if (res.reason === 'self') return say(interaction, isId ? 'Kamu sudah menjadi pemiliknya!' : 'You are already the owner!');
            if (res.reason === 'duplicate') return say(interaction, isId ? `<@${targetId}> sudah ada di Trusted Squad.` : `<@${targetId}> is already in your Trusted Squad.`);
            return say(interaction, isId ? `Trusted Squad sudah penuh (maks ${vip.MAX_TRUSTED}).` : `Trusted Squad is full (max ${vip.MAX_TRUSTED}).`);
        }

        // Also allow immediately in current active session if this user owns it
        if (murphy.isSessionOwner(interaction.guildId, userId)) {
            await murphy.allowSessionUser(interaction.guildId, targetId, interaction.client).catch(() => undefined);
        }

        return say(interaction, isId
            ? `🤝 <@${targetId}> ditambahkan ke **Trusted Squad**! Mereka akan otomatis diizinkan di setiap sesimu.`
            : `🤝 Added <@${targetId}> to your **Trusted Squad**! They will be auto-allowed in all your sessions.`);
    },
};
