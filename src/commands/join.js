'use strict';

const { command } = require('./_shared');
const { checkVoice, say } = require('../handlers/guards');
const murphy = require('../murphy');
const vip = require('../murphy_vip');

module.exports = {
    category: 'playback',
    data: command('join', 'Join your current voice channel'),

    async execute(interaction, { t, manager }) {
        const check = checkVoice(interaction, manager, t, { requireQueue: false, join: true });
        if (check.error) return say(interaction, check.error);

        const guildId = interaction.guildId;
        const channel = check.channel;

        if (interaction.user?.id && channel?.id) {
            await murphy.claimSession(guildId, interaction.user.id, channel.id, interaction.client, vip.getTrustedIds(interaction.user.id));
            if (murphy.isPremiumUser(interaction.user.id)) {
                const customNick = vip.getVipPrefs(interaction.user.id).nick;
                if (customNick) {
                    interaction.guild?.members?.me?.setNickname?.(customNick).catch(() => undefined);
                }
            }
        }

        const botVoiceId = interaction.guild?.members?.me?.voice?.channelId;
        if (botVoiceId !== channel.id) {
            await manager.distube.voices.join(channel);
        }

        const isId = t.lang === 'id';
        return say(interaction, isId
            ? `🔊 Berhasil masuk ke <#${channel.id}>.\n-# ${murphy.FOOTER}`
            : `🔊 Joined <#${channel.id}>.\n-# ${murphy.FOOTER}`, { ephemeral: false });
    },
};

