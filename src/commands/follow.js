'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');
const vip = require('../murphy_vip');

module.exports = {
    category: 'settings',
    data: command('follow', 'Follow-Me Mode: bot automatically follows you when you move voice channels (Premium)')
        .addStringOption((option) => option
            .setName('mode')
            .setDescription('Turn Follow-Me mode on or off')
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),

    async execute(interaction, { t }) {
        const userId = interaction.user.id;
        const isId = t.lang === 'id';

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Follow-Me Mode (f!follow)'));
        }

        const rawMode = (interaction.options.getString('mode') || '').trim().toLowerCase();
        const current = Boolean(vip.getVipPrefs(userId).followMe);

        let enable;
        if (['on', 'enable', 'true', '1', 'aktif', 'yes'].includes(rawMode)) enable = true;
        else if (['off', 'disable', 'false', '0', 'mati', 'no'].includes(rawMode)) enable = false;
        else enable = !current;

        await vip.updateVipPrefs(userId, { followMe: enable });
        return say(interaction, enable
            ? (isId
                ? `🚶‍♂️ **Follow-Me Mode: Aktif!**\nSaat kamu pindah ke Voice Channel lain, bot akan otomatis ikut pindah mengikutimu tanpa memutus lagu.\n-# ${murphy.FOOTER}`
                : `🚶‍♂️ **Follow-Me Mode: Enabled!**\nWhenever you move to another voice channel, the bot will automatically follow you.\n-# ${murphy.FOOTER}`)
            : (isId
                ? `🚶‍♂️ **Follow-Me Mode: Nonaktif.**\n-# ${murphy.FOOTER}`
                : `🚶‍♂️ **Follow-Me Mode: Disabled.**\n-# ${murphy.FOOTER}`));
    },
};
