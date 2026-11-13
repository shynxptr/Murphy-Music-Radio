'use strict';

const { ActionRowBuilder, ContainerBuilder, MessageFlags, StringSelectMenuBuilder, TextDisplayBuilder } = require('discord.js');
const { command } = require('./_shared');
const { say, respond } = require('../handlers/guards');
const { formatDuration, link, truncate } = require('../core/format');
const config = require('../config');
const murphy = require('../murphy');
const vip = require('../murphy_vip');
const views = require('../ui/views');

module.exports = {
    category: 'playback',
    data: command('history', 'View your recently played songs and replay any track (Premium)'),

    async execute(interaction, { t }) {
        const isId = t.lang === 'id';
        const userId = interaction.user.id;

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Listening History (f!history)'));
        }

        const items = vip.getHistory(userId);
        if (!items.length) {
            return say(interaction, isId
                ? `🕒 Riwayat lagu kamu masih kosong! Putar lagu dulu dan otomatis tercatat di sini.\n-# ${murphy.FOOTER}`
                : `🕒 Your listening history is empty! Play some songs first.\n-# ${murphy.FOOTER}`);
        }

        const lines = items.slice(0, 15).map((song, idx) =>
            `\`${String(idx + 1).padStart(2, ' ')}.\` ${link(song.name, song.url, 65)} · ${song.isLive ? t('ui.live') : formatDuration(song.duration)}`);

        const header = isId
            ? `### 🕒 Riwayat Lagu Terakhir (${items.length})`
            : `### 🕒 Recently Played Songs (${items.length})`;
        const footer = isId
            ? `Pilih lagu di menu bawah untuk langsung memutar ulang!\n-# ${murphy.FOOTER}`
            : `Select a track below to play it again!\n-# ${murphy.FOOTER}`;

        const c = new ContainerBuilder()
            .setAccentColor(config.bot.color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n${lines.join('\n')}\n\n${footer}`))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${views.ID.historyPick}${userId}`)
                    .setPlaceholder(isId ? 'Pilih lagu untuk diputar ulang...' : 'Select a song to replay...')
                    .addOptions(items.slice(0, 25).map((song, idx) => ({
                        label: truncate(`${idx + 1}. ${song.name}`, 100),
                        description: truncate([song.uploader, song.isLive ? 'LIVE' : formatDuration(song.duration)].filter(Boolean).join(' · ') || 'Murphy History', 100),
                        value: String(idx),
                    }))),
            ));

        return respond(interaction, {
            components: [c],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
    },
};
