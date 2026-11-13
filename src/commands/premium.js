'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');

module.exports = {
    category: 'settings',
    data: command('premium', 'View your Murphy Premium status, remaining duration, and VIP perks'),

    async execute(interaction, { t }) {
        const userId = interaction.user.id;
        const record = murphy.getPremium(userId);
        const isId = t.lang === 'id';

        if (record) {
            const remaining = murphy.formatRemaining(t.lang, record);
            const expLine = record.lifetime
                ? (isId ? '∞ **Selamanya (Lifetime)**' : '∞ **Lifetime**')
                : `⏳ **${remaining}** (<t:${Math.floor(record.expiresAt / 1000)}:R>)`;

            const lines = isId
                ? [
                    '### 💎 Status: Murphy Premium Aktif',
                    `Akun: <@${userId}> · Masa Aktif: ${expLine}`,
                    '',
                    '**Fitur VIP yang Aktif:**',
                    '• Akses VIP **Murphy #6–#20** + **24/7 AFK** (`f!afk on`)',
                    '• Queue **500** lagu, Playlist **200** lagu, Favorit **100** lagu, Volume s/d **150%**',
                    '• Semua **Audio Filter** & **Autoplay**',
                    '• **Personal Prefix** (`f!prefix d`) & **Custom Voice Status** (`f!vs`)',
                    `-# ${murphy.FOOTER}`,
                ]
                : [
                    '### 💎 Status: Murphy Premium Active',
                    `Account: <@${userId}> · Remaining: ${expLine}`,
                    '',
                    '**Unlocked VIP Perks:**',
                    '• VIP access to **Murphy #6–#20** + **24/7 AFK** (`f!afk on`)',
                    '• **500** queue limit, **200** playlist import, **100** favorites, **150%** volume boost',
                    '• All **Audio Filters** & **Autoplay**',
                    '• **Personal Prefix** (`f!prefix d`) & **Custom Voice Status** (`f!vs`)',
                    `-# ${murphy.FOOTER}`,
                ];
            return say(interaction, lines.join('\n'));
        }

        const lines = isId
            ? [
                '### 🎧 Status: Murphy Free',
                `Akun: <@${userId}> · Paket: **Free (#1–#5)**`,
                '',
                '**Perbandingan Free vs 💎 Murphy Premium:**',
                '• **Slot Bot:** Free (#1–#5) vs **VIP (#6–#20 anti-penuh)**',
                '• **24/7 AFK:** ❌ vs **✅ 24 Jam Penuh**',
                '• **Queue / Playlist / Favorit:** `25 / 20 / 10` vs **`500 / 200 / 100`**',
                '• **Volume Max:** `100%` vs **`150%` Boost**',
                '• **Audio Filter & Autoplay:** ❌ vs **✅ Semua Aktif**',
                '• **Personal Prefix & Custom Voice Status:** ❌ vs **✅ Bebas Custom**',
                '',
                'Sudah punya kode voucher? Ketik **`f!redeem <kode>`** atau `/redeem`!',
                `-# ${murphy.FOOTER}`,
            ]
            : [
                '### 🎧 Status: Murphy Free',
                `Account: <@${userId}> · Plan: **Free (#1–#5)**`,
                '',
                '**Free vs 💎 Murphy Premium:**',
                '• **Bot Pool:** Free (#1–#5) vs **VIP (#6–#20 priority lane)**',
                '• **24/7 AFK:** ❌ vs **✅ Full 24/7**',
                '• **Queue / Playlist / Favorites:** `25 / 20 / 10` vs **`500 / 200 / 100`**',
                '• **Max Volume:** `100%` vs **`150%` Boost**',
                '• **Audio Filters & Autoplay:** ❌ vs **✅ Unlocked**',
                '• **Personal Prefix & Custom Voice Status:** ❌ vs **✅ Unlocked**',
                '',
                'Have a voucher code? Run **`f!redeem <code>`** or `/redeem`!',
                `-# ${murphy.FOOTER}`,
            ];
        return say(interaction, lines.join('\n'));
    },
};

