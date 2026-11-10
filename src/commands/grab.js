'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { formatDuration, link, escapeMarkdown, truncate } = require('../core/format');
const views = require('../ui/views');
const murphy = require('../murphy');

function messages(lang) {
    if (lang === 'id') {
        return {
            dmHeader: '### Simpan Lagu — Murphy Music',
            channelLabel: 'Channel / Artis',
            durationLabel: 'Durasi',
            serverLabel: 'Dari Server',
            directUrlLabel: 'Tautan Langsung',
            sent: (title) => `Detail lagu **${title}** berhasil dikirim ke **DM** kamu!\n-# Tips: Ketik \`f!fav add\` jika ingin menyimpannya ke playlist favoritmu di bot.`,
            dmBlocked: 'Tidak dapat mengirim pesan ke DM kamu! Pastikan opsi **Allow Direct Messages from server members** di pengaturan privasi Discord kamu sudah aktif.',
        };
    }
    return {
        dmHeader: '### Saved Track — Murphy Music',
        channelLabel: 'Channel / Artist',
        durationLabel: 'Duration',
        serverLabel: 'From Server',
        directUrlLabel: 'Direct Link',
        sent: (title) => `Details for **${title}** have been sent to your **DMs**!\n-# Tip: Type \`f!fav add\` to also save it to your bot favorites.`,
        dmBlocked: 'Could not send you a DM! Make sure **Allow Direct Messages from server members** is enabled in your Discord privacy settings.',
    };
}

module.exports = {
    category: 'playback',
    data: command('grab', 'Send the currently playing song details and link to your DMs'),

    async execute(interaction, { t, manager }) {
        const queue = manager.getQueue(interaction.guildId);
        const song = queue?.songs?.[0];
        if (!song) return say(interaction, t('commands.nowplaying.no_track'));

        const msg = messages(t.lang);
        const duration = song.isLive ? t('ui.live') : `${formatDuration(queue.currentTime || 0)} / ${formatDuration(song.duration)}`;
        const uploader = song.uploader?.name ? escapeMarkdown(truncate(song.uploader.name, 80)) : '-';
        const serverName = escapeMarkdown(truncate(interaction.guild?.name || 'Discord Server', 80));

        const cardText = [
            msg.dmHeader,
            `### ${link(song.name, song.url, 90)}`,
            `**${msg.channelLabel}:** ${uploader}`,
            `**${msg.durationLabel}:** \`${duration}\``,
            `**${msg.serverLabel}:** ${serverName}`,
            `**${msg.directUrlLabel}:** ${song.url}`,
            `-# ${murphy.FOOTER}`,
        ].join('\n');

        try {
            await interaction.user.send(views.notice(cardText, { ephemeral: false }));
            return say(interaction, msg.sent(song.name));
        } catch {
            return say(interaction, msg.dmBlocked);
        }
    },
};

