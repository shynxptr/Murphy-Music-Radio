'use strict';

const { PermissionFlagsBits, MessageFlags, RESTJSONErrorCodes } = require('discord.js');
const { isTextChannelInstance } = require('distube');
const murphy = require('../murphy');
const views = require('../ui/views');

/**
 * Check that the user may control music: in a voice channel, in the bot's channel if connected,
 * and authorized as the Session Owner (or an allowed user) when a session is active.
 * `join: true` also verifies the bot can connect and speak there.
 */
function checkVoice(interaction, manager, t, { requireQueue = true, join = false } = {}) {
    const guild = interaction.guild;
    const userId = interaction.user?.id || interaction.member?.id;
    const session = murphy.getSession(guild.id);
    const queue = manager.getQueue(guild.id);
    const botChannelId = guild.members?.me?.voice?.channelId || session?.channelId || null;

    if (session?.ownerId && userId && !murphy.isSessionAuthorized(guild.id, userId)) {
        return { error: murphy.sessionLockedMessage(t.lang, session.ownerId) };
    }

    let channel = interaction.member?.voice?.channel || null;

    // If the Session Owner (or allowed user) temporarily stepped out of the voice channel,
    // they still retain control over their active bot session.
    if (!channel && session?.ownerId && userId && murphy.isSessionAuthorized(guild.id, userId) && botChannelId) {
        channel = guild.channels?.cache?.get(botChannelId) || queue?.voiceChannel || { id: botChannelId, guild };
    }

    if (!channel) return { error: t('commands.play.voice_channel_required') };

    if (botChannelId && botChannelId !== channel.id) {
        if (session?.ownerId && String(userId) === session.ownerId) {
            return { error: murphy.ownerBusyInOtherChannelMessage(t.lang, botChannelId) };
        }
        return { error: t('commands.play.same_channel_required') };
    }

    // 1 Bot = 1 Session Owner: prevent a user who already owns another bot in the cluster from claiming a second bot.
    if (!session?.ownerId && userId && join) {
        const bots = murphy.getClusterBotsForGuild(guild);
        const myBotId = interaction.client?.user?.id;
        const alreadyOwned = bots.find((b) => b.ownerId === String(userId) && b.botId !== String(myBotId) && b.channelId);
        if (alreadyOwned) {
            return { error: murphy.ownerBusyInOtherChannelMessage(t.lang, alreadyOwned.channelId) };
        }
    }

    if (requireQueue && (!queue || !queue.songs.length)) return { error: t('commands.nowplaying.no_track') };

    if (join && !guild.members?.me?.voice?.channelId) {
        const permissions = channel.permissionsFor?.(guild.members.me);
        if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
            return { error: t('commands.play.no_permissions') };
        }
        if (channel.full && permissions && !permissions.has(PermissionFlagsBits.MoveMembers)) return { error: t('ui.voice_full') };
    }
    return { channel, queue };
}

/**
 * Text channel DisTube may post the panel in (or undefined when the bot can't write there).
 */
function panelChannel(interaction) {
    const channel = interaction.channel;
    // Exactly the channels DisTube accepts as a queue text channel.
    if (!channel?.isTextBased() || !isTextChannelInstance(channel)) return undefined;
    const permissions = channel.permissionsFor?.(interaction.guild.members.me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return undefined;
    if (channel.isThread() && !permissions.has(PermissionFlagsBits.SendMessagesInThreads)) return undefined;
    return channel;
}

const IGNORED_CODES = new Set([RESTJSONErrorCodes.UnknownInteraction, RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged]);

/**
 * Reply, follow up or edit depending on the interaction state. Never throws for expired interactions.
 */
async function respond(interaction, payload) {
    try {
        if (interaction.deferred && !interaction.replied) {
            const { flags, ...rest } = payload;
            return await interaction.editReply({ ...rest, flags: flags & MessageFlags.IsComponentsV2 ? MessageFlags.IsComponentsV2 : undefined });
        }
        if (interaction.replied) return await interaction.followUp(payload);
        return await interaction.reply(payload);
    } catch (error) {
        if (IGNORED_CODES.has(error.code)) return null;
        throw error;
    }
}

const say = (interaction, message, options) => respond(interaction, views.notice(message, options));

module.exports = { checkVoice, panelChannel, respond, say, IGNORED_CODES };
