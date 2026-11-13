'use strict';

const { ActionRowBuilder, ContainerBuilder, MessageFlags, StringSelectMenuBuilder, TextDisplayBuilder } = require('discord.js');
const { Playlist } = require('distube');
const { command } = require('./_shared');
const { checkVoice, say, respond } = require('../handlers/guards');
const { playFromInteraction } = require('./play');
const { truncate, link } = require('../core/format');
const config = require('../config');
const murphy = require('../murphy');
const vip = require('../murphy_vip');
const views = require('../ui/views');

function parseRawPlaylistArgs(alias, raw) {
    const trimmed = String(raw ?? '').trim();
    if (alias === 'savequeue' || alias === 'sq') {
        return { action: 'save', target: trimmed, shuffle: false };
    }
    if (!trimmed) return { action: 'list', target: '', shuffle: false };
    const tokens = trimmed.split(/\s+/);
    const first = tokens[0].toLowerCase();

    if (['list', 'ls', 'show'].includes(first)) return { action: 'list', target: '', shuffle: false };
    if (['save', 'savequeue', 'add'].includes(first)) return { action: 'save', target: tokens.slice(1).join(' '), shuffle: false };
    if (['remove', 'rm', 'del', 'delete'].includes(first)) return { action: 'remove', target: tokens[1] || '', shuffle: false };
    if (['pin', 'unpin'].includes(first)) return { action: 'pin', target: tokens[1] || '', shuffle: false };
    if (/^\d+$/.test(first)) {
        const shuffle = tokens.slice(1).some((tok) => ['shuffle', 'sh', 'acak', 'mix'].includes(tok.toLowerCase()));
        return { action: 'play', target: first, shuffle };
    }
    return { action: 'playname', target: trimmed, shuffle: false };
}

function buildPlaylistView(t, userId, items) {
    const isId = t.lang === 'id';
    const c = new ContainerBuilder().setAccentColor(config.bot.color);
    const lines = items.slice(0, 20).map((item, idx) => {
        const pinBadge = item.pinned ? '📌 ' : '';
        const sourceTag = item.type === 'queue' ? 'Saved Queue' : (item.source || 'spotify').toUpperCase();
        const title = item.url ? link(item.name, item.url, 60) : `**${truncate(item.name, 60)}**`;
        return `\`${String(idx + 1).padStart(2, ' ')}.\` ${pinBadge}${title} · *${sourceTag} (${item.count || item.songs?.length || 0})*`;
    });

    const header = isId
        ? `### 📂 Library Playlist Kamu (${items.length}/${vip.MAX_PLAYLISTS})`
        : `### 📂 Your Playlist Library (${items.length}/${vip.MAX_PLAYLISTS})`;
    const footer = isId
        ? `Pilih playlist di menu bawah atau ketik \`f!pl <nomor> [shuffle]\` · \`f!savequeue <nama>\`\n-# ${murphy.FOOTER}`
        : `Pick a playlist below or type \`f!pl <number> [shuffle]\` · \`f!savequeue <name>\`\n-# ${murphy.FOOTER}`;

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n${lines.join('\n')}\n\n${footer}`));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${views.ID.playlistPick}${userId}`)
            .setPlaceholder(isId ? 'Pilih playlist untuk langsung diputar...' : 'Select a playlist to play...')
            .addOptions(items.slice(0, 25).map((item, idx) => ({
                label: truncate(`${idx + 1}. ${item.pinned ? '[PIN] ' : ''}${item.name}`, 100),
                description: truncate(`${item.type === 'queue' ? 'Saved Queue' : (item.source || 'spotify').toUpperCase()} · ${item.count || item.songs?.length || 0} tracks`, 100),
                value: String(idx),
            }))),
    ));

    return {
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    };
}

async function playSavedEntry(interaction, ctx, entry, { shuffle = false } = {}) {
    const { t, manager } = ctx;
    if (entry.type === 'queue' && Array.isArray(entry.songs)) {
        const check = checkVoice(interaction, manager, t, { requireQueue: false, join: true });
        if (check.error) return say(interaction, check.error);
        const rawSongs = shuffle ? [...entry.songs].sort(() => Math.random() - 0.5) : entry.songs;
        const built = manager.sessions.buildSongs({
            songs: rawSongs.map((s) => ({ ...s, plugin: s.plugin || 'youtube', requesterId: interaction.user.id, autoplay: false })),
        }, interaction.guild);
        if (!built.length) return say(interaction, t('errors.unknown'));
        const pl = new Playlist({ source: 'youtube', songs: built, name: entry.name }, { member: interaction.member });
        return playFromInteraction(interaction, ctx, pl);
    }

    await vip.savePlaylistEntry(interaction.user.id, entry);
    return playFromInteraction(interaction, ctx, entry.url);
}

module.exports = {
    category: 'playback',
    playSavedEntry,
    data: command('playlist', 'View and play your auto-saved Spotify playlists or saved queues (Premium)')
        .addStringOption((option) => option
            .setName('action')
            .setDescription('Playlist library action')
            .addChoices(
                { name: 'List My Playlists', value: 'list' },
                { name: 'Play by Number', value: 'play' },
                { name: 'Save Current Queue', value: 'save' },
                { name: 'Pin / Unpin by Number', value: 'pin' },
                { name: 'Remove by Number', value: 'remove' },
            ))
        .addStringOption((option) => option
            .setName('target')
            .setDescription('Playlist number or custom queue name')
            .setMaxLength(100))
        .addBooleanOption((option) => option
            .setName('shuffle')
            .setDescription('Shuffle tracks when playing')),

    async execute(interaction, ctx) {
        const { t, manager } = ctx;
        const isId = t.lang === 'id';
        const userId = interaction.user.id;

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Auto-Save Spotify Library (f!playlist)'));
        }

        let action = interaction.options.getString?.('action') || null;
        let target = interaction.options.getString?.('target')?.trim() || '';
        let shuffle = interaction.options.getBoolean?.('shuffle') ?? false;

        const raw = interaction.options.getString?.('raw');
        const alias = interaction.options.getString?.('alias') || 'playlist';
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawPlaylistArgs(alias, raw);
            action = parsed.action;
            target = parsed.target;
            shuffle = parsed.shuffle;
        }
        action = action || 'list';

        if (action === 'save') {
            const queue = manager.getQueue(interaction.guildId);
            if (!queue?.songs?.length) return say(interaction, t('commands.nowplaying.no_track'));
            const name = target || `Queue ${new Date().toLocaleDateString('id-ID')}`;
            const serialized = queue.songs.slice(0, 200).map((s) => manager.sessions.serializeSong(s));
            await vip.savePlaylistEntry(userId, {
                type: 'queue',
                name,
                source: 'custom',
                count: serialized.length,
                songs: serialized,
            });
            return say(interaction, isId
                ? `💾 Antrean saat ini (**${serialized.length} lagu**) disimpan ke Library Playlist dengan nama **${truncate(name, 80)}**!\nPutar lagi kapan saja lewat \`f!playlist\`.`
                : `💾 Current queue (**${serialized.length} tracks**) saved to your Playlist Library as **${truncate(name, 80)}**!\nPlay it anytime via \`f!playlist\`.`);
        }

        const list = vip.getPlaylists(userId);
        if (!list.length) {
            return say(interaction, isId
                ? `📂 Library Playlist kamu masih kosong!\nPutar link **Playlist Spotify** lewat \`f!p <link>\` dan otomatis tersimpan di sini, atau simpan antrean dengan \`f!savequeue <nama>\`.\n-# ${murphy.FOOTER}`
                : `📂 Your Playlist Library is empty!\nPlay any **Spotify Playlist** link with \`f!p <link>\` to auto-save it here, or save your current queue with \`f!savequeue <name>\`.\n-# ${murphy.FOOTER}`);
        }

        if (action === 'remove') {
            const pos = /^\d+$/.test(target) ? Number.parseInt(target, 10) : NaN;
            const { removed } = await vip.removePlaylist(userId, pos);
            if (!removed) return say(interaction, isId ? `Tidak ada playlist di nomor #${target || '?'}.` : `No playlist at #${target || '?'}.`);
            return say(interaction, isId ? `🗑️ Playlist **${removed.name}** dihapus dari library.` : `🗑️ Removed **${removed.name}** from your library.`);
        }

        if (action === 'pin') {
            const pos = /^\d+$/.test(target) ? Number.parseInt(target, 10) : NaN;
            const { item } = await vip.togglePinPlaylist(userId, pos);
            if (!item) return say(interaction, isId ? `Tidak ada playlist di nomor #${target || '?'}.` : `No playlist at #${target || '?'}.`);
            return say(interaction, item.pinned
                ? (isId ? `📌 **${item.name}** disematkan ke atas.` : `📌 Pinned **${item.name}** to the top.`)
                : (isId ? `📌 Pin **${item.name}** dilepas.` : `📌 Unpinned **${item.name}**.`));
        }

        if (action === 'play' || action === 'playname') {
            const chosen = action === 'play'
                ? list[Number.parseInt(target, 10) - 1]
                : list.find((item) => item.name.toLowerCase().includes(target.toLowerCase()));
            if (!chosen) return say(interaction, isId ? `Playlist "${target}" tidak ditemukan.` : `Playlist "${target}" not found.`);
            if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 'Ephemeral' });
            return playSavedEntry(interaction, ctx, chosen, { shuffle });
        }

        return respond(interaction, buildPlaylistView(t, userId, list));
    },
};
