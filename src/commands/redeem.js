'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');

module.exports = {
    category: 'settings',
    data: command('redeem', 'Redeem a Murphy Premium voucher code')
        .addStringOption((option) => option
            .setName('code')
            .setDescription('Voucher code (e.g. MURPHY-ABCD-1234)')
            .setRequired(true)
            .setMaxLength(64)),

    async execute(interaction, { t }) {
        const code = (interaction.options.getString('code') || '').trim();
        const isId = t.lang === 'id';

        if (!code) {
            return say(interaction, isId
                ? `Masukkan kode voucher! Contoh: \`f!redeem MURPHY-ABCD-1234\`\n-# ${murphy.FOOTER}`
                : `Please provide a voucher code! Example: \`f!redeem MURPHY-ABCD-1234\`\n-# ${murphy.FOOTER}`);
        }

        const res = await murphy.redeemVoucher(code, interaction.user.id);
        if (!res.ok) {
            if (res.reason === 'already_used') {
                return say(interaction, isId
                    ? `❌ Kode voucher \`${code.toUpperCase()}\` sudah pernah digunakan!\n-# ${murphy.FOOTER}`
                    : `❌ Voucher code \`${code.toUpperCase()}\` has already been redeemed!\n-# ${murphy.FOOTER}`);
            }
            return say(interaction, isId
                ? `❌ Kode voucher \`${code.toUpperCase()}\` tidak valid atau tidak ditemukan.\n-# ${murphy.FOOTER}`
                : `❌ Invalid or unknown voucher code \`${code.toUpperCase()}\`.\n-# ${murphy.FOOTER}`);
        }

        const remaining = murphy.formatRemaining(t.lang, res.premium);
        const msg = isId
            ? `### 🎉 Selamat! Murphy Premium Aktif!\nKode \`${res.voucher.code}\` berhasil diklaim untuk <@${interaction.user.id}>.\n⏳ Masa Aktif: **${remaining}**\nSekarang kamu bisa langsung memanggil **Murphy #6–#20** dan menikmati seluruh fitur VIP!\n-# ${murphy.FOOTER}`
            : `### 🎉 Murphy Premium Activated!\nVoucher \`${res.voucher.code}\` has been redeemed for <@${interaction.user.id}>.\n⏳ Remaining: **${remaining}**\nYou now have full access to **Murphy #6–#20** and all VIP features!\n-# ${murphy.FOOTER}`;
        return say(interaction, msg, { ephemeral: false });
    },
};

