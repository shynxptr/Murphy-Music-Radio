'use strict';

const { command } = require('./_shared');
const { checkVoice, say } = require('../handlers/guards');
const murphy = require('../murphy');

const RESET_WORDS = new Set(['reset', 'default', 'clear', 'off', 'auto']);

function messages(lang) {
    if (lang === 'id') {
        return {
            title: '### Status Aktivitas Voice Channel',
            current: (tpl) => `**Template Saat Ini:** \`${tpl || murphy.DEFAULT_VOICE_TEMPLATE}\``,
            howTo: [
                '**Cara Mengubah:**',
                '• Gunakan `/voicestatus status:<teks>` atau `f!vs <teks>`',
                '• Gunakan `{song}` di dalam teks untuk menyisipkan judul lagu yang sedang diputar (contoh: `f!vs Listening to {song} · Murphy`)',
                '• Ketik `f!vs reset` untuk kembali ke default (`Listening to <judul lagu>`)',
            ].join('\n'),
            updated: (preview) => `Status aktivitas voice channel berhasil diatur ke:\n**\`${preview}\`**\n-# ${murphy.FOOTER}`,
            reset: `Status aktivitas voice channel dikembalikan ke default: **\`${murphy.DEFAULT_VOICE_TEMPLATE}\`**\n-# ${murphy.FOOTER}`,
        };
    }
    return {
        title: '### Voice Channel Activity Status',
        current: (tpl) => `**Current Template:** \`${tpl || murphy.DEFAULT_VOICE_TEMPLATE}\``,
        howTo: [
            '**How to Customize:**',
            '• Use `/voicestatus status:<text>` or `f!vs <text>`',
            '• Include `{song}` to insert the currently playing song title (e.g. `f!vs Listening to {song} · Murphy`)',
            '• Type `f!vs reset` to restore the default (`Listening to <song title>`)',
        ].join('\n'),
        updated: (preview) => `Voice channel activity status has been set to:\n**\`${preview}\`**\n-# ${murphy.FOOTER}`,
        reset: `Voice channel activity status has been reset to default: **\`${murphy.DEFAULT_VOICE_TEMPLATE}\`**\n-# ${murphy.FOOTER}`,
    };
}

module.exports = {
    category: 'settings',
    data: command('voicestatus', 'Customize the voice channel activity status (defaults to Listening to <song>)')
        .addStringOption((option) => option
            .setName('status')
            .setDescription('Custom status text (use {song} for song title, or "reset" for default)')
            .setMaxLength(300)),

    async execute(interaction, { t, manager }) {
        const guildId = interaction.guildId;
        const msg = messages(t.lang);
        const input = interaction.options.getString('status')?.trim() || '';

        if (!input) {
            const tpl = murphy.getVoiceTemplate(guildId);
            return say(interaction, [msg.title, msg.current(tpl), '', msg.howTo, `-# ${murphy.FOOTER}`].join('\n'));
        }

        const check = checkVoice(interaction, manager, t, { requireQueue: false, join: false });
        if (check.error) return say(interaction, check.error);

        const queue = manager.getQueue(guildId);
        const currentSong = queue?.songs?.[0] || null;
        const voiceChannelId = queue?.voiceChannel?.id || interaction.guild?.members?.me?.voice?.channelId || check.channel?.id;

        if (RESET_WORDS.has(input.toLowerCase())) {
            await murphy.setVoiceTemplate(guildId, null);
            await murphy.syncVoiceStatus(interaction.client, guildId, voiceChannelId, currentSong);
            return say(interaction, msg.reset, { ephemeral: false });
        }

        await murphy.setVoiceTemplate(guildId, input);
        await murphy.syncVoiceStatus(interaction.client, guildId, voiceChannelId, currentSong);
        const preview = murphy.formatVoiceStatus(guildId, currentSong) || input;
        return say(interaction, msg.updated(preview), { ephemeral: false });
    },
};

