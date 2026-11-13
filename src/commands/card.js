'use strict';

const { AttachmentBuilder } = require('discord.js');
const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { safeUrl, truncate } = require('../core/format');
const murphy = require('../murphy');
const vip = require('../murphy_vip');
const { renderProfileCard } = require('../ui/card');

function extractUserId(text) {
    if (!text) return null;
    const match = String(text).trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
    return match ? (match[1] || match[2]) : null;
}

function parseRawCardArgs(alias, raw) {
    const trimmed = String(raw ?? '').trim();
    if (alias === 'theme') {
        return { action: 'color', value: trimmed };
    }
    if (alias === 'radioname' || alias === 'radio') {
        return { action: 'radio', value: trimmed };
    }
    if (!trimmed) return { action: 'view', targetId: null, value: '' };
    const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const first = match[1].toLowerCase();
    const rest = (match[2] || '').trim();

    if (['color', 'theme', 'warna'].includes(first)) return { action: 'color', value: rest };
    if (['bio', 'desc', 'status'].includes(first)) return { action: 'bio', value: rest };
    if (['banner', 'bg', 'background'].includes(first)) return { action: 'banner', value: rest };
    if (['radio', 'radioname', 'title'].includes(first)) return { action: 'radio', value: rest };
    if (['volume', 'vol'].includes(first)) return { action: 'volume', value: rest };
    if (['reset', 'default'].includes(first)) return { action: 'reset', value: '' };

    const mentionId = extractUserId(match[1]);
    if (mentionId) return { action: 'view', targetId: mentionId, value: '' };
    return { action: 'view', targetId: null, value: '' };
}

module.exports = {
    category: 'settings',
    data: command('card', 'View or customize your Jockie-style Murphy Music profile card')
        .addUserOption((option) => option
            .setName('user')
            .setDescription('View another member\'s Murphy profile card'))
        .addStringOption((option) => option
            .setName('action')
            .setDescription('Customize your Premium card (color, bio, banner, radio, volume, reset)')
            .addChoices(
                { name: 'View Card', value: 'view' },
                { name: 'Set Color / Theme', value: 'color' },
                { name: 'Set Bio', value: 'bio' },
                { name: 'Set Banner URL', value: 'banner' },
                { name: 'Set Radio Name', value: 'radio' },
                { name: 'Set Default Volume', value: 'volume' },
                { name: 'Reset Customization', value: 'reset' },
            ))
        .addStringOption((option) => option
            .setName('value')
            .setDescription('New value (color preset/#hex, bio text, image URL, radio name, or volume 1-150)')
            .setMaxLength(300)),

    async execute(interaction, { t, manager }) {
        const isId = t.lang === 'id';
        let action = interaction.options.getString?.('action') || null;
        let value = interaction.options.getString?.('value')?.trim() || '';
        const targetOption = interaction.options.getUser?.('user') || null;
        let targetId = targetOption?.id || null;

        const raw = interaction.options.getString?.('raw');
        const alias = interaction.options.getString?.('alias') || 'card';
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawCardArgs(alias, raw);
            action = parsed.action;
            value = parsed.value || '';
            targetId = parsed.targetId || null;
        }
        action = action || 'view';

        if (action === 'view') {
            if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
            const user = targetOption
                || (targetId ? await interaction.client.users.fetch(targetId).catch(() => null) : null)
                || interaction.user;
            const uid = user.id;
            const isVip = murphy.isPremiumUser(uid);
            const prefs = isVip ? vip.getVipPrefs(uid) : {};
            const userStats = vip.getTopStats(uid);
            const avatarUrl = typeof user.displayAvatarURL === 'function'
                ? user.displayAvatarURL({ extension: 'png', size: 256 })
                : null;

            const png = await renderProfileCard({
                username: user.username || user.tag || 'Listener',
                avatarUrl,
                bannerUrl: isVip ? prefs.bannerUrl : null,
                accentColor: isVip && prefs.color ? prefs.color : '#0EA5E9',
                bio: isVip && prefs.bio ? prefs.bio : '',
                radioName: isVip && prefs.radioName ? prefs.radioName : murphy.BRAND_NAME,
                isPremium: isVip,
                stats: userStats,
                lang: t.lang,
            });

            const attachment = new AttachmentBuilder(png, { name: 'murphy-card.png' });
            const payload = { files: [attachment] };
            if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
            return interaction.reply(payload);
        }

        // Customization requires Murphy Premium
        if (!murphy.isPremiumUser(interaction.user.id)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Custom Murphy Card (f!card)'));
        }

        const userId = interaction.user.id;

        if (action === 'reset') {
            await vip.resetVipPrefs(userId);
            manager.refreshPanel(interaction.guildId);
            return say(interaction, isId
                ? `🎨 Tampilan \`f!card\` & tema panel kamu dikembalikan ke default **Murphy Blue-Sky**.\n-# ${murphy.FOOTER}`
                : `🎨 Your \`f!card\` & panel theme have been reset to **Murphy Blue-Sky**.\n-# ${murphy.FOOTER}`);
        }

        if (action === 'color') {
            const hex = vip.resolveColorInput(value);
            if (!hex) {
                const presets = Object.keys(vip.COLOR_PRESETS).join(', ');
                return say(interaction, isId
                    ? `Warna tidak valid! Pilih preset (${presets}) atau kode hex (contoh: \`f!card color #38BDF8\`).`
                    : `Invalid color! Choose a preset (${presets}) or hex code (e.g. \`f!card color #38BDF8\`).`);
            }
            await vip.updateVipPrefs(userId, { color: hex });
            manager.refreshPanel(interaction.guildId);
            return say(interaction, isId
                ? `🎨 Warna tema \`f!card\` & panel musik diubah ke **\`${hex}\`**!`
                : `🎨 Your \`f!card\` & panel accent color has been set to **\`${hex}\`**!`);
        }

        if (action === 'bio') {
            if (!value || ['clear', 'reset', 'off'].includes(value.toLowerCase())) {
                await vip.updateVipPrefs(userId, { bio: '' });
                return say(interaction, isId ? '📝 Bio kartu profilmu dihapus.' : '📝 Your profile card bio has been cleared.');
            }
            const clean = truncate(value, 80);
            await vip.updateVipPrefs(userId, { bio: clean });
            return say(interaction, isId ? `📝 Bio kartu profil diatur ke:\n> ${clean}` : `📝 Profile card bio set to:\n> ${clean}`);
        }

        if (action === 'banner') {
            if (!value || ['clear', 'reset', 'off'].includes(value.toLowerCase())) {
                await vip.updateVipPrefs(userId, { bannerUrl: null });
                return say(interaction, isId ? '🖼️ Banner kartu profil dihapus.' : '🖼️ Your profile card banner has been cleared.');
            }
            const cleanUrl = safeUrl(value);
            if (!cleanUrl) {
                return say(interaction, isId ? 'URL banner tidak valid! Gunakan link gambar `https://...`.' : 'Invalid banner URL! Provide a valid `https://...` image link.');
            }
            await vip.updateVipPrefs(userId, { bannerUrl: cleanUrl });
            return say(interaction, isId ? '🖼️ Banner custom berhasil dipasang di `f!card`!' : '🖼️ Custom banner updated on your `f!card`!');
        }

        if (action === 'radio') {
            if (!value || ['clear', 'reset', 'off'].includes(value.toLowerCase())) {
                await vip.updateVipPrefs(userId, { radioName: '' });
                manager.refreshPanel(interaction.guildId);
                return say(interaction, isId ? '📻 Nama radio dikembalikan ke default **Murphy Music**.' : '📻 Radio name reset to **Murphy Music**.');
            }
            const clean = truncate(value, 32);
            await vip.updateVipPrefs(userId, { radioName: clean });
            manager.refreshPanel(interaction.guildId);
            return say(interaction, isId ? `📻 Nama radio pribadimu diatur ke **${clean}**!` : `📻 Your personal radio name is now **${clean}**!`);
        }

        if (action === 'volume') {
            const vol = /^\d+$/.test(value) ? Number.parseInt(value, 10) : NaN;
            if (!Number.isInteger(vol) || vol < 1 || vol > 150) {
                return say(interaction, isId ? 'Masukkan volume default antara `1` – `150`!' : 'Provide a default volume between `1` and `150`!');
            }
            await vip.updateVipPrefs(userId, { defaultVolume: vol });
            return say(interaction, isId ? `🔊 Volume default pribadimu diatur ke **${vol}%**.` : `🔊 Your default volume is now **${vol}%**.`);
        }

        return null;
    },
};
