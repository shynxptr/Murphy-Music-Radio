'use strict';

const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { truncate } = require('../core/format');
const murphy = require('../murphy');
const vip = require('../murphy_vip');

module.exports = {
    category: 'settings',
    data: command('nick', 'Customize the bot nickname in this server for your sessions (Premium)')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('New bot nickname (or "reset" to restore default)')
            .setMaxLength(32)),

    async execute(interaction, { t }) {
        const userId = interaction.user.id;
        const isId = t.lang === 'id';

        if (!murphy.isPremiumUser(userId)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Custom Bot Nickname (f!nick)'));
        }

        const raw = (interaction.options.getString('name') || '').trim();
        if (!raw || ['reset', 'default', 'clear', 'off'].includes(raw.toLowerCase())) {
            await vip.updateVipPrefs(userId, { nick: '' });
            await interaction.guild?.members?.me?.setNickname?.(null).catch(() => undefined);
            return say(interaction, isId ? '🏷️ Nickname bot dikembalikan ke default.' : '🏷️ Bot nickname reset to default.');
        }

        const clean = truncate(raw, 32);
        await vip.updateVipPrefs(userId, { nick: clean });
        try {
            await interaction.guild?.members?.me?.setNickname?.(clean);
            return say(interaction, isId ? `🏷️ Nickname bot diubah ke **${clean}**!` : `🏷️ Bot nickname changed to **${clean}**!`, { ephemeral: false });
        } catch {
            return say(interaction, isId
                ? `🏷️ Nickname **${clean}** disimpan, namun bot tidak memiliki izin *Change Nickname* di server ini.`
                : `🏷️ Saved nickname **${clean}**, though the bot lacks *Change Nickname* permission here.`);
        }
    },
};
