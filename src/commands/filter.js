'use strict';

const { command, queueAction } = require('./_shared');
const { say } = require('../handlers/guards');
const actions = require('../music/actions');
const murphy = require('../murphy');
const views = require('../ui/views');

module.exports = {
    category: 'playback',
    data: command('filter', 'Apply an audio filter')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Filter')
            .setRequired(true)
            .addChoices({ name: 'None', value: 'none' }, ...views.FILTERS.map((name) => ({ name: views.FILTER_LABELS[name], value: name })))),

    execute(interaction, ctx) {
        const filterName = interaction.options.getString('name', true);
        if (filterName !== 'none' && !murphy.isPremiumUser(interaction.user.id)) {
            return say(interaction, murphy.premiumRequiredMessage(ctx.t.lang, 'Audio Filters'));
        }
        return queueAction(interaction, ctx, (queue, t) => actions.setFilter(queue, t, filterName));
    },
};
