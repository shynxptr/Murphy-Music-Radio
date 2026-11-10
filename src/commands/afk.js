'use strict';

const { command } = require('./_shared');
const { checkVoice, say } = require('../handlers/guards');
const murphy = require('../murphy');

function messages(lang) {
    if (lang === 'id') {
        return {
            enabled: (channelId) => `### Mode 24/7 AFK: Aktif\nBot sekarang akan tetap standby 24 jam di <#${channelId}> tanpa keluar meskipun antrean lagu habis atau channel kosong.\n-# ${murphy.FOOTER}`,
            disabled: `### Mode 24/7 AFK: Nonaktif\nBot akan kembali keluar otomatis saat antrean selesai atau voice channel kosong.\n-# ${murphy.FOOTER}`,
        };
    }
    return {
        enabled: (channelId) => `### 24/7 AFK Mode: Enabled\nThe bot will now stay connected 24/7 in <#${channelId}> without leaving when the queue ends or the channel is empty.\n-# ${murphy.FOOTER}`,
        disabled: `### 24/7 AFK Mode: Disabled\nThe bot will now leave automatically when the queue finishes or the voice channel is empty.\n-# ${murphy.FOOTER}`,
    };
}

module.exports = {
    category: 'settings',
    data: command('afk', 'Toggle 24/7 AFK mode so the bot stays in the voice channel 24 hours without leaving')
        .addStringOption((option) => option
            .setName('mode')
            .setDescription('Turn 24/7 AFK mode on or off')
            .addChoices(
                { name: 'On (Stay 24/7)', value: 'on' },
                { name: 'Off', value: 'off' },
            )),

    async execute(interaction, { t, manager }) {
        const guildId = interaction.guildId;
        const msg = messages(t.lang);
        const rawMode = (interaction.options.getString('mode') || '').trim().toLowerCase();

        let enable;
        if (['on', 'enable', 'true', '1', 'aktif', 'yes'].includes(rawMode)) enable = true;
        else if (['off', 'disable', 'false', '0', 'mati', 'no'].includes(rawMode)) enable = false;
        else enable = !murphy.isAfk(guildId);

        if (!enable) {
            const check = checkVoice(interaction, manager, t, { requireQueue: false, join: false });
            if (check.error) return say(interaction, check.error);
            await murphy.setAfk(guildId, { enabled: false }, interaction.client);
            const activeQueue = manager.getQueue(guildId);
            if (!activeQueue?.songs?.length) {
                const channelId = check.channel?.id || interaction.guild?.members?.me?.voice?.channelId;
                await murphy.clearVoiceStatus(interaction.client, channelId);
                await murphy.clearSession(guildId, interaction.client);
                manager.distube.voices.leave(guildId);
            } else {
                manager.refreshPanel(guildId);
            }
            return say(interaction, msg.disabled, { ephemeral: false });
        }

        const check = checkVoice(interaction, manager, t, { requireQueue: false, join: true });
        if (check.error) return say(interaction, check.error);

        if (interaction.user?.id && check.channel?.id) {
            await murphy.claimSession(guildId, interaction.user.id, check.channel.id, interaction.client);
        }
        await murphy.setAfk(guildId, {
            enabled: true,
            voiceChannelId: check.channel.id,
            textChannelId: interaction.channelId,
        }, interaction.client);
        manager.cancelLeaveTimers?.(guildId);

        const botVoiceId = interaction.guild?.members?.me?.voice?.channelId;
        if (botVoiceId !== check.channel.id) {
            await manager.distube.voices.join(check.channel).catch(() => undefined);
        }

        const currentSong = manager.getQueue(guildId)?.songs?.[0] || null;
        await murphy.syncVoiceStatus(interaction.client, guildId, check.channel.id, currentSong);
        manager.refreshPanel(guildId);
        return say(interaction, msg.enabled(check.channel.id), { ephemeral: false });
    },
};

