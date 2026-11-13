'use strict';

const { command, queueAction } = require('./_shared');
const { say } = require('../handlers/guards');
const actions = require('../music/actions');
const murphy = require('../murphy');

module.exports = {
    category: 'playback',
    data: command('autoplay', 'Turn autoplay of related songs on or off'),

    execute(interaction, ctx) {
        if (!murphy.isPremiumUser(interaction.user.id)) {
            return say(interaction, murphy.premiumRequiredMessage(ctx.t.lang, 'Autoplay'));
        }
        return queueAction(interaction, ctx, (queue, t) => actions.toggleAutoplay(queue, t));
    },
};
