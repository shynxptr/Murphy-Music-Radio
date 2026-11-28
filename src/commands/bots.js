'use strict';

const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { JsonStore } = require('../core/store');
const { truncate, escapeMarkdown } = require('../core/format');
const config = require('../config');
const murphy = require('../murphy');

const EMOJI_DISK = '<a:disk:1576199386567020574>';
const EMOJI_READY = '<a:open:1559450037631721483>';
const EMOJI_BUSY = '<a:off:1566868467376988350>';

let botListStore = null;
const store = () => (botListStore ??= new JsonStore(path.join(murphy.sharedDataDir(), 'murphy', 'botlist'), { shared: true }));

function getManualBots() {
    const list = store().get('registry')?.bots;
    return Array.isArray(list) ? list : [];
}

async function saveManualBots(bots) {
    await store().set('registry', { bots, updatedAt: Date.now() });
}

function extractId(text) {
    if (!text) return null;
    const match = String(text).trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
    return match ? (match[1] || match[2]) : null;
}

function parseRawBotsArgs(raw) {
    const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { action: 'list', tokens: [] };
    return { action: tokens[0].toLowerCase(), tokens: tokens.slice(1) };
}

function parseGroup(input) {
    const val = String(input || '').trim().toLowerCase();
    if (['luar', 'external', 'ext', 'partner', 'other', '1'].includes(val)) return 'external';
    if (['official', 'murphy', 'off', 'vip', 'free', '2'].includes(val)) return 'official';
    return null;
}

function resolveLiveVoiceChannel(guild, botId, clusterChannelId = null) {
    return guild?.voiceStates?.cache?.get(botId)?.channelId || clusterChannelId || null;
}

function mergeBots(guild, manualBots) {
    const clusterBots = guild ? murphy.getClusterBotsForGuild(guild) : [];
    const byId = new Map();

    for (const bot of clusterBots) {
        const member = guild?.members?.cache?.get(bot.botId);
        const user = member?.user || guild?.client?.users?.cache?.get(bot.botId);
        byId.set(bot.botId, {
            botId: bot.botId,
            name: user?.username || `Murphy #${bot.priority || 1}`,
            group: 'official',
            priority: bot.priority || 99,
            channelId: resolveLiveVoiceChannel(guild, bot.botId, bot.channelId),
            manual: false,
        });
    }

    for (const entry of manualBots) {
        const group = entry.group === 'external' ? 'external' : 'official';
        const existing = byId.get(entry.botId);
        if (existing) {
            existing.name = entry.name || existing.name;
            existing.group = group;
            existing.manual = true;
            existing.channelId = resolveLiveVoiceChannel(guild, entry.botId, existing.channelId);
        } else {
            byId.set(entry.botId, {
                botId: entry.botId,
                name: entry.name || entry.botId,
                group,
                priority: 999,
                channelId: resolveLiveVoiceChannel(guild, entry.botId, null),
                manual: true,
            });
        }
    }

    return [...byId.values()].sort((a, b) => (a.priority - b.priority) || a.name.localeCompare(b.name));
}

function formatBotLines(bots, emptyText) {
    if (!bots.length) return emptyText;
    return bots.map((bot) => (bot.channelId
        ? `${EMOJI_BUSY} <@${bot.botId}> - <#${bot.channelId}>`
        : `${EMOJI_READY} <@${bot.botId}>`)).join('\n');
}

function buildBotListPayload(interaction, bots) {
    const guild = interaction.guild;
    const serverName = truncate((guild?.name || 'SERVER').toUpperCase(), 45);
    const botIcon = interaction.client?.user?.displayAvatarURL?.({ size: 64 }) || undefined;
    const externalBots = bots.filter((b) => b.group === 'external');
    const officialBots = bots.filter((b) => b.group !== 'external');

    const embedExternal = new EmbedBuilder()
        .setColor(config.bot.color)
        .setTitle(`${EMOJI_DISK} LIST BOT MUSIC ${serverName}`)
        .setDescription(truncate(formatBotLines(
            externalBots,
            '-# Belum ada bot penyedia luar. Owner bisa tambah lewat `z!bot add @bot luar`',
        ), 4000));

    const embedOfficial = new EmbedBuilder()
        .setColor(config.bot.color)
        .setTitle(`${EMOJI_DISK} LIST BOT OFFICIAL ${murphy.BRAND_NAME.toUpperCase()}`)
        .setDescription(truncate(formatBotLines(
            officialBots,
            '-# Belum ada bot official terdaftar.',
        ), 4000))
        .setFooter({
            text: 'Status Bot Musik: 🟢 Ready | 🔴 Sedang Dipakai',
            iconURL: botIcon,
        })
        .setTimestamp();

    return {
        embeds: [embedExternal, embedOfficial],
        allowedMentions: { parse: [] },
    };
}

module.exports = {
    category: 'settings',
    data: command('bots', 'View live list of external & official Murphy Music bots (z!bot)')
        .addStringOption((option) => option
            .setName('action')
            .setDescription('Action (list, add, remove, clear)')
            .addChoices(
                { name: 'View Bot List Panel', value: 'list' },
                { name: 'Add Bot (Owner)', value: 'add' },
                { name: 'Remove Bot (Owner)', value: 'remove' },
                { name: 'Clear Manual List (Owner)', value: 'clear' },
            ))
        .addStringOption((option) => option
            .setName('target')
            .setDescription('Bot @mention or Client ID')
            .setMaxLength(64))
        .addStringOption((option) => option
            .setName('group')
            .setDescription('List group: external (luar) or official (Murphy)')
            .addChoices(
                { name: 'Bot Penyedia Luar (External)', value: 'external' },
                { name: 'Bot Official Murphy', value: 'official' },
            )),

    async execute(interaction, { t }) {
        const isId = t.lang === 'id';
        let action = interaction.options.getString?.('action') || null;
        let target = interaction.options.getString?.('target') || '';
        let group = interaction.options.getString?.('group') || '';

        const raw = interaction.options.getString?.('raw');
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawBotsArgs(raw);
            action = parsed.action;
            if (action === 'add') {
                target = parsed.tokens[0] || '';
                group = parsed.tokens[1] || 'official';
            } else if (action === 'remove' || action === 'del' || action === 'delete') {
                action = 'remove';
                target = parsed.tokens[0] || '';
            } else if (action === 'clear') {
                group = parsed.tokens[0] || '';
            }
        }
        action = action || 'list';

        if (action === 'list' || action === 'panel' || action === 'show') {
            const merged = mergeBots(interaction.guild, getManualBots());
            return interaction.reply(buildBotListPayload(interaction, merged));
        }

        if (!murphy.isBotOwner(interaction.user.id)) {
            return say(interaction, isId
                ? `🔒 Tambah/hapus bot manual hanya untuk **Owner Bot** (\`BOT_OWNER_ID\`).\n-# ${murphy.FOOTER}`
                : `🔒 Manual bot list management is restricted to the **Bot Owner** (\`BOT_OWNER_ID\`).\n-# ${murphy.FOOTER}`);
        }

        if (action === 'add') {
            const botId = extractId(target);
            if (!botId) {
                return say(interaction, isId
                    ? 'Format: `z!bot add <@bot_atau_clientId> [luar|official]`\nContoh:\n• `z!bot add @Jockie luar`\n• `z!bot add @MurphyVIP official`'
                    : 'Usage: `z!bot add <@bot_or_clientId> [external|official]`');
            }
            const parsedGroup = parseGroup(group) || 'official';
            const fetched = await interaction.client.users?.fetch?.(botId).catch(() => null);
            const displayName = fetched?.username || `Bot-${botId.slice(-4)}`;
            const list = getManualBots().filter((b) => b.botId !== botId);
            list.push({ botId, name: truncate(displayName, 50), group: parsedGroup, addedAt: Date.now() });
            await saveManualBots(list);
            const groupLabel = parsedGroup === 'external' ? 'Penyedia Luar' : 'Official Murphy';
            return say(interaction, isId
                ? `✅ <@${botId}> (**${escapeMarkdown(displayName)}**) ditambahkan ke daftar **${groupLabel}**.\n-# Ketik \`z!bot\` untuk lihat panel.`
                : `✅ Added <@${botId}> (**${escapeMarkdown(displayName)}**) to **${groupLabel}** list.\n-# Run \`z!bot\` to view the panel.`, { ephemeral: false });
        }

        if (action === 'remove') {
            const botId = extractId(target);
            const list = getManualBots();
            if (!botId || !list.some((b) => b.botId === botId)) {
                return say(interaction, isId
                    ? 'Bot tidak ditemukan di daftar manual! Gunakan `z!bot remove @bot` atau `z!bot remove <clientId>`.'
                    : 'Bot not found in manual list! Use `z!bot remove @bot` or `z!bot remove <clientId>`.');
            }
            await saveManualBots(list.filter((b) => b.botId !== botId));
            return say(interaction, isId
                ? `🗑️ <@${botId}> dihapus dari daftar manual.`
                : `🗑️ Removed <@${botId}> from manual list.`, { ephemeral: false });
        }

        if (action === 'clear') {
            const targetGroup = parseGroup(group);
            if (targetGroup) {
                const remaining = getManualBots().filter((b) => (b.group === 'external' ? 'external' : 'official') !== targetGroup);
                await saveManualBots(remaining);
                return say(interaction, `🗑️ Daftar bot manual **${targetGroup}** dibersihkan.`);
            }
            await saveManualBots([]);
            return say(interaction, isId ? '🗑️ Semua daftar bot manual dibersihkan.' : '🗑️ Cleared all manual bot entries.');
        }

        const merged = mergeBots(interaction.guild, getManualBots());
        return interaction.reply(buildBotListPayload(interaction, merged));
    },
};
