'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const murphy = require('../murphy');
const vip = require('../murphy_vip');

module.exports = {
    category: 'settings',
    data: command('clean', 'Auto-Clean: automatically delete your command messages after 3 seconds (Premium)')
        .addStringOption((option) => option
            .setName('mode')
            .setDescription('Turn Auto-Clean on or off')
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),

    async execute(interaction, { t }) {
        const userId = interaction.user.id;
        const isId = t.lang === 'id';

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Auto-Clean Chat (f!clean)'));
        }

        const rawMode = (interaction.options.getString('mode') || '').trim().toLowerCase();
        const current = Boolean(vip.getVipPrefs(userId).autoClean);

        let enable;
        if (['on', 'enable', 'true', '1', 'aktif', 'yes'].includes(rawMode)) enable = true;
        else if (['off', 'disable', 'false', '0', 'mati', 'no'].includes(rawMode)) enable = false;
        else enable = !current;

        await vip.updateVipPrefs(userId, { autoClean: enable });
        return say(interaction, enable
            ? (isId
                ? `🧹 **Auto-Clean: Aktif!** Pesan perintahmu (\`f!p\`, \`f!s\`, dll.) akan otomatis dihapus setelah 3 detik agar channel tetap rapi.\n-# ${murphy.FOOTER}`
                : `🧹 **Auto-Clean: Enabled!** Your command messages will be deleted after 3 seconds.\n-# ${murphy.FOOTER}`)
            : (isId
                ? `🧹 **Auto-Clean: Nonaktif.**\n-# ${murphy.FOOTER}`
                : `🧹 **Auto-Clean: Disabled.**\n-# ${murphy.FOOTER}`));
    },
};
