'use strict';

const { command, queueAction } = require('./_shared');
const { say } = require('../handlers/guards');
const actions = require('../music/actions');
const murphy = require('../murphy');

module.exports = {
    category: 'playback',
    data: command('volume', 'Change the volume')
        .addIntegerOption((option) => option
            .setName('level')
            .setDescription('Volume from 0 to 150 (101–150 is Murphy Premium)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(150)),

    execute(interaction, ctx) {
        const level = interaction.options.getInteger('level', true);
        const limits = murphy.getUserLimits(interaction.user.id);
        if (level > limits.maxVolume && !murphy.isPremiumUser(interaction.user.id)) {
            return say(interaction, murphy.premiumRequiredMessage(ctx.t.lang, 'Volume Boost (101% – 150%)'));
        }
        return queueAction(interaction, ctx, (queue, t) => actions.setVolume(queue, t, level, { maxVolume: limits.maxVolume }));
    },
};
