'use strict';

const { Playlist } = require('distube');
const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { playFromInteraction } = require('./play');
const { formatDuration, link, truncate } = require('../core/format');
const murphy = require('../murphy');

function messages(lang) {
    if (lang === 'id') {
        return {
            title: (count) => `### Lagu Favoritmu (${count}/${murphy.MAX_FAVORITES})`,
            empty: [
                'Daftar lagu favoritmu masih kosong!',
                '',
                '**Cara Menggunakan:**',
                '• Simpan lagu yang sedang diputar: `f!fav add` atau `/favorite action:add`',
                '• Simpan lagu dari judul/link: `f!fav add <judul/link>`',
                '• Putar semua favoritmu: `f!fav play`',
                '• Putar 1 lagu favorit: `f!fav play <nomor>`',
                '• Hapus lagu favorit: `f!fav remove <nomor>`',
            ].join('\n'),
            footerHelp: 'Ketik `f!fav play` untuk memutar semua, atau `f!fav add` untuk menyimpan lagu.',
            noPlayingToAdd: 'Tidak ada lagu yang sedang diputar! Kamu juga bisa mengetik `f!fav add <judul lagu/link>`.',
            added: (title, pos) => `**${title}** berhasil disimpan ke daftar favoritmu (nomor **#${pos}**)!`,
            duplicate: (title) => `**${title}** sudah ada di dalam daftar favoritmu!`,
            full: `Daftar favoritmu sudah penuh (maksimal ${murphy.MAX_FAVORITES} lagu). Hapus beberapa dengan \`f!fav remove <nomor>\`.`,
            removed: (title) => `**${title}** telah dihapus dari daftar favoritmu.`,
            invalidPos: (pos) => `Tidak ada lagu favorit di nomor **#${pos}**.`,
            cleared: 'Seluruh daftar lagu favoritmu telah dikosongkan.',
            playlistName: (username) => `Favorit ${username}`,
        };
    }
    return {
        title: (count) => `### Your Favorite Songs (${count}/${murphy.MAX_FAVORITES})`,
        empty: [
            'Your favorite songs list is empty!',
            '',
            '**How to Use:**',
            '• Save the currently playing song: `f!fav add` or `/favorite action:add`',
            '• Save a song by name/link: `f!fav add <song/link>`',
            '• Play all your favorites: `f!fav play`',
            '• Play a specific favorite: `f!fav play <number>`',
            '• Remove a favorite: `f!fav remove <number>`',
        ].join('\n'),
        footerHelp: 'Type `f!fav play` to play all, or `f!fav add` to save the current song.',
        noPlayingToAdd: 'No song is currently playing! You can also type `f!fav add <song name or link>`.',
        added: (title, pos) => `**${title}** has been saved to your favorites (**#${pos}**)!`,
        duplicate: (title) => `**${title}** is already in your favorites!`,
        full: `Your favorites list is full (max ${murphy.MAX_FAVORITES} songs). Remove some with \`f!fav remove <number>\`.`,
        removed: (title) => `**${title}** has been removed from your favorites.`,
        invalidPos: (pos) => `There is no favorite song at position **#${pos}**.`,
        cleared: 'All your favorite songs have been cleared.',
        playlistName: (username) => `${username}'s Favorites`,
    };
}

function parseRawFavArgs(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { action: 'list', target: '' };
    const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const sub = match[1].toLowerCase();
    const rest = (match[2] || '').trim();

    if (['list', 'ls', 'show'].includes(sub)) return { action: 'list', target: rest };
    if (['add', 'save', '+'].includes(sub)) return { action: 'add', target: rest };
    if (['play', 'p', 'start'].includes(sub)) return { action: 'play', target: rest };
    if (['remove', 'rm', 'del', 'delete', '-'].includes(sub)) return { action: 'remove', target: rest };
    if (['clear', 'reset', 'empty'].includes(sub)) return { action: 'clear', target: '' };
    if (/^\d+$/.test(sub)) return { action: 'play', target: sub };
    return { action: 'add', target: trimmed };
}

module.exports = {
    category: 'playback',
    data: command('favorite', 'Save, view, or play your personal favorite songs')
        .addStringOption((option) => option
            .setName('action')
            .setDescription('What to do with your favorites')
            .addChoices(
                { name: 'List Favorites', value: 'list' },
                { name: 'Play Favorites', value: 'play' },
                { name: 'Add Current / Search Song', value: 'add' },
                { name: 'Remove by Number', value: 'remove' },
                { name: 'Clear All', value: 'clear' },
            ))
        .addStringOption((option) => option
            .setName('target')
            .setDescription('Song name/link to add, or favorite number to play/remove')
            .setMaxLength(500)),

    async execute(interaction, ctx) {
        const { t, manager } = ctx;
        const msg = messages(t.lang);
        const userId = interaction.user.id;

        let action = interaction.options.getString('action') || null;
        let target = interaction.options.getString('target')?.trim() || '';

        const raw = interaction.options.getString('raw');
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawFavArgs(raw);
            action = parsed.action;
            target = parsed.target;
        }
        action = action || 'list';

        if (action === 'clear') {
            await murphy.clearFavorites(userId);
            return say(interaction, `${msg.cleared}\n-# ${murphy.FOOTER}`);
        }

        if (action === 'remove') {
            const pos = /^\d+$/.test(target) ? Number.parseInt(target, 10) : NaN;
            const { removed } = await murphy.removeFavorite(userId, pos);
            if (!removed) return say(interaction, msg.invalidPos(target || '?'));
            return say(interaction, `${msg.removed(removed.name)}\n-# ${murphy.FOOTER}`);
        }

        if (action === 'add') {
            let songToSave = null;
            if (target) {
                if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 'Ephemeral' });
                try {
                    const resolved = await manager.distube.handler.resolve(target, {
                        member: interaction.member,
                        metadata: { requesterId: userId, guildId: interaction.guildId },
                    });
                    songToSave = resolved instanceof Playlist ? resolved.songs[0] : resolved;
                } catch (error) {
                    return say(interaction, t(manager.explainError(error)));
                }
            } else {
                songToSave = manager.getQueue(interaction.guildId)?.songs?.[0] || null;
            }

            if (!songToSave) return say(interaction, msg.noPlayingToAdd);
            const serialized = manager.sessions.serializeSong(songToSave);
            const outcome = await murphy.addFavorite(userId, serialized);
            if (!outcome.added) {
                const reasonText = outcome.reason === 'duplicate' ? msg.duplicate(songToSave.name) : msg.full;
                return say(interaction, `${reasonText}\n-# ${murphy.FOOTER}`);
            }
            return say(interaction, `${msg.added(outcome.song.name, outcome.position)}\n-# ${murphy.FOOTER}`);
        }

        if (action === 'play') {
            const list = murphy.getFavorites(userId);
            if (!list.length) return say(interaction, `${msg.empty}\n-# ${murphy.FOOTER}`);

            if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 'Ephemeral' });

            if (/^\d+$/.test(target)) {
                const index = Number.parseInt(target, 10) - 1;
                const chosen = list[index];
                if (!chosen) return say(interaction, msg.invalidPos(target));
                return playFromInteraction(interaction, ctx, chosen.url);
            }

            const builtSongs = manager.sessions.buildSongs({
                songs: list.map((item) => ({ ...item, plugin: item.plugin || 'youtube', requesterId: userId, autoplay: false })),
            }, interaction.guild);

            if (!builtSongs.length) return playFromInteraction(interaction, ctx, list[0].url);
            if (builtSongs.length === 1) return playFromInteraction(interaction, ctx, builtSongs[0]);

            const playlist = new Playlist({
                source: 'youtube',
                songs: builtSongs,
                name: msg.playlistName(interaction.user.username || 'Member'),
            }, { member: interaction.member });
            return playFromInteraction(interaction, ctx, playlist);
        }

        // Default: list favorites
        const list = murphy.getFavorites(userId);
        if (!list.length) return say(interaction, `${msg.empty}\n-# ${murphy.FOOTER}`);

        const totalDuration = list.reduce((sum, item) => sum + (item.duration || 0), 0);
        const lines = list.slice(0, 20).map((item, idx) =>
            `\`${String(idx + 1).padStart(2, ' ')}.\` ${link(item.name, item.url, 65)} · ${item.isLive ? t('ui.live') : formatDuration(item.duration)}`);
        if (list.length > 20) lines.push(`-# ... +${list.length - 20}`);

        const content = [
            msg.title(list.length),
            lines.join('\n'),
            '',
            `-# Total: ${formatDuration(totalDuration)} · ${msg.footerHelp}`,
            `-# ${murphy.FOOTER}`,
        ].join('\n');
        return say(interaction, content);
    },
};

