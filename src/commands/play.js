'use strict';

const { Playlist } = require('distube');
const config = require('../config');
const i18n = require('../core/i18n');
const murphy = require('../murphy');
const vip = require('../murphy_vip');
const { command } = require('./_shared');
const { checkVoice, panelChannel, say } = require('../handlers/guards');
const { choices } = require('../music/suggest');
const log = require('../core/logger').createLogger('play');

/**
 * Shared by /play and the /search menu.
 */
async function playFromInteraction(interaction, ctx, query, { next = false } = {}) {
    const { t, manager } = ctx;
    const check = checkVoice(interaction, manager, t, { requireQueue: false, join: true });
    if (check.error) return say(interaction, check.error);

    const hadSession = Boolean(murphy.getSession(interaction.guildId));
    if (interaction.user?.id && check.channel?.id) {
        const isVip = murphy.isPremiumUser(interaction.user.id);
        const trusted = isVip ? vip.getTrustedIds(interaction.user.id) : [];
        await murphy.claimSession(interaction.guildId, interaction.user.id, check.channel.id, interaction.client, trusted);
        if (!hadSession && isVip) {
            const prefs = vip.getVipPrefs(interaction.user.id);
            if (prefs.nick) {
                interaction.guild?.members?.me?.setNickname?.(prefs.nick).catch(() => undefined);
            }
        }
    }

    const startedAt = Date.now();
    let answered = false;
    const answer = async (outcome) => {
        answered = true;
        const { resolved } = outcome;
        let message;
        if (resolved instanceof Playlist) {
            message = `${t('commands.play.playlist_success', { count: resolved.songs.length })}\n-# ${resolved.name}`;
            if (outcome.truncated) message += `\n-# ${t('ui.playlist_truncated', { max: config.bot.maxQueueSize })}`;
        } else if (outcome.started) {
            message = t('commands.play.track_started', { title: resolved.name });
        } else {
            message = t('commands.play.track_queued', { title: resolved.name, position: outcome.position });
        }
        if (!(resolved instanceof Playlist) && resolved.fallbackFrom) message += `\n-# ${t('ui.fallback_soundcloud')}`;
        await say(interaction, message);
    };

    try {
        const outcome = await manager.play({
            voiceChannel: check.channel,
            textChannel: panelChannel(interaction),
            member: interaction.member,
            query,
            position: next ? 1 : 0,
            onQueued: answer,
        });
        if (!answered) await answer(outcome);
        return null;
    } catch (error) {
        if (!hadSession && !manager.getQueue(interaction.guildId) && !murphy.isAfk(interaction.guildId)) {
            await murphy.clearSession(interaction.guildId, interaction.client);
        }
        if (error?.errorCode === 'QUEUE_FULL') return say(interaction, t('ui.queue_full', { max: config.bot.maxQueueSize }));
        const key = manager.explainError(error, startedAt);
        if (key === 'errors.unknown') log.error(`Failed to play "${query}":`, error);
        else log.warn(`Failed to play "${query}": ${error.message}`);
        return say(interaction, t(key));
    }
}

module.exports = {
    category: 'playback',
    data: command('play', 'Play a song or playlist from YouTube, Spotify, SoundCloud or a link')
        .addStringOption((option) => option
            .setName('query')
            .setDescription('Song name or link')
            .setDescriptionLocalizations(i18n.localizations('commands.play.query_description'))
            .setRequired(true)
            .setMaxLength(1000)
            .setAutocomplete(true))
        .addBooleanOption((option) => option
            .setName('next')
            .setDescription('Play it right after the current song')),

    async execute(interaction, ctx) {
        await interaction.deferReply({ flags: 'Ephemeral' });
        return playFromInteraction(interaction, ctx, interaction.options.getString('query', true).trim(), {
            next: interaction.options.getBoolean('next') ?? false,
        });
    },

    async autocomplete(interaction) {
        await interaction.respond(await choices(interaction.options.getFocused()));
    },

    playFromInteraction,
};
