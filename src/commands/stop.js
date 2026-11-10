'use strict';

const { command } = require('./_shared');
const actions = require('../music/actions');
const murphy = require('../murphy');
const { checkVoice, say } = require('../handlers/guards');

module.exports = {
    category: 'playback',
    data: command('stop', 'Stop the music, clear the queue and leave the voice channel'),

    async execute(interaction, { t, manager }) {
        const guildId = interaction.guildId;
        const session = murphy.getSession(guildId);
        const botChannelId = interaction.guild?.members?.me?.voice?.channelId;
        const alias = interaction.options?.getString?.('alias') || '';
        const forceLeave = ['dc', 'disconnect', 'leave', 'lv'].includes(alias);

        const check = checkVoice(interaction, manager, t, { requireQueue: !session && !botChannelId && !murphy.isAfk(guildId) });
        if (check.error) return say(interaction, check.error);

        if (check.queue?.songs?.length) {
            const outcome = await actions.stop(check.queue, t, manager, { forceLeave });
            return say(interaction, outcome.message);
        }

        const channelId = botChannelId || session?.channelId || check.channel?.id;
        await murphy.setAfk(guildId, { enabled: false }, interaction.client);
        await murphy.clearVoiceStatus(interaction.client, channelId);
        await murphy.clearSession(guildId, interaction.client);
        manager.distube.voices.leave(guildId);
        return say(interaction, t('buttonhandler.music_stopped_title'));
    },
};
