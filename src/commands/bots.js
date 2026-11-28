'use strict';

const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    TextDisplayBuilder,
} = require('discord.js');
const { command } = require('./_shared');
const { say } = require('../handlers/guards');
const { JsonStore } = require('../core/store');
const { truncate, escapeMarkdown } = require('../core/format');
const config = require('../config');
const murphy = require('../murphy');

const INVITE_PERMISSIONS = '36703296';
const inviteUrl = (clientId) => `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;

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

function mergeBots(guild, manualBots) {
    const clusterBots = guild ? murphy.getClusterBotsForGuild(guild) : [];
    const byId = new Map();

    for (const bot of clusterBots) {
        const member = guild?.members?.cache?.get(bot.botId);
        const user = member?.user || guild?.client?.users?.cache?.get(bot.botId);
        byId.set(bot.botId, {
            botId: bot.botId,
            name: user?.username || `Murphy #${bot.priority || 1}`,
            tier: bot.tier === 'premium' ? 'premium' : 'free',
            priority: bot.priority || 99,
            channelId: bot.channelId || null,
            inCluster: true,
            manual: false,
        });
    }

    for (const entry of manualBots) {
        const existing = byId.get(entry.botId);
        if (existing) {
            existing.name = entry.name || existing.name;
            existing.tier = entry.tier || existing.tier;
            existing.manual = true;
        } else {
            byId.set(entry.botId, {
                botId: entry.botId,
                name: entry.name || `Murphy (${entry.botId.slice(-4)})`,
                tier: entry.tier === 'premium' ? 'premium' : 'free',
                priority: 999,
                channelId: null,
                inCluster: false,
                manual: true,
            });
        }
    }

    return [...byId.values()].sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
        return (a.priority - b.priority) || a.name.localeCompare(b.name);
    });
}

function buildBotListPanel(t, bots) {
    const isId = t.lang === 'id';
    const c = new ContainerBuilder().setAccentColor(config.bot.color);

    const freeBots = bots.filter((b) => b.tier !== 'premium');
    const vipBots = bots.filter((b) => b.tier === 'premium');

    const formatLine = (bot, idx) => {
        const status = bot.inCluster
            ? (bot.channelId ? (isId ? `Sibuk di <#${bot.channelId}>` : `Busy in <#${bot.channelId}>`) : 'Ready')
            : (isId ? 'External / Invite' : 'External / Invite');
        return `\`${String(idx + 1).padStart(2, ' ')}.\` **${escapeMarkdown(truncate(bot.name, 40))}** — ${status} · [Invite](${inviteUrl(bot.botId)})`;
    };

    const sections = [];
    sections.push(isId
        ? `### 🤖 Daftar Bot ${murphy.BRAND_NAME} (${bots.length})`
        : `### 🤖 ${murphy.BRAND_NAME} Bot List (${bots.length})`);

    if (freeBots.length) {
        sections.push(`**🆓 Free Tier (${freeBots.length})**\n${freeBots.map(formatLine).join('\n')}`);
    }
    if (vipBots.length) {
        sections.push(`**💎 Premium VIP Tier (${vipBots.length})**\n${vipBots.map(formatLine).join('\n')}`);
    }
    if (!bots.length) {
        sections.push(isId ? 'Belum ada bot terdaftar.' : 'No bots registered yet.');
    }

    sections.push(isId
        ? `-# Owner bisa tambah/hapus bot manual: \`f!bots add @bot [free|vip] [nama]\` · \`f!bots remove <nomor/id>\`\n-# ${murphy.FOOTER}`
        : `-# Bot Owner can manage manually: \`f!bots add @bot [free|vip] [name]\` · \`f!bots remove <num/id>\`\n-# ${murphy.FOOTER}`);

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(sections.join('\n\n')));

    // Add up to 5 quick Invite link buttons (no emoji on buttons)
    const buttonBots = bots.slice(0, 5);
    if (buttonBots.length) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            buttonBots.map((bot) => new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(truncate(`Invite ${bot.name}`, 80))
                .setURL(inviteUrl(bot.botId))),
        ));
    }

    return {
        components: [c],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    };
}

module.exports = {
    category: 'info',
    data: command('bots', 'View Murphy Music bot list & invite links (Owner can add/remove bots manually)')
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
            .setDescription('Bot ID / @mention (for add) or number / Bot ID (for remove)')
            .setMaxLength(64))
        .addStringOption((option) => option
            .setName('tier')
            .setDescription('Bot tier (for add)')
            .addChoices(
                { name: 'Free', value: 'free' },
                { name: 'Premium VIP', value: 'premium' },
            ))
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Custom display name for the bot')
            .setMaxLength(50)),

    async execute(interaction, { t }) {
        const isId = t.lang === 'id';
        let action = interaction.options.getString?.('action') || null;
        let target = interaction.options.getString?.('target') || '';
        let tier = interaction.options.getString?.('tier') || '';
        let name = interaction.options.getString?.('name') || '';

        const raw = interaction.options.getString?.('raw');
        if (raw !== null && raw !== undefined && !action) {
            const parsed = parseRawBotsArgs(raw);
            action = parsed.action;
            if (action === 'add') {
                target = parsed.tokens[0] || '';
                const maybeTier = (parsed.tokens[1] || '').toLowerCase();
                if (['free', 'vip', 'premium'].includes(maybeTier)) {
                    tier = maybeTier === 'free' ? 'free' : 'premium';
                    name = parsed.tokens.slice(2).join(' ');
                } else {
                    tier = 'free';
                    name = parsed.tokens.slice(1).join(' ');
                }
            } else if (action === 'remove' || action === 'del' || action === 'delete') {
                action = 'remove';
                target = parsed.tokens[0] || '';
            }
        }
        action = action || 'list';

        if (action === 'list' || action === 'panel' || action === 'show') {
            const merged = mergeBots(interaction.guild, getManualBots());
            return interaction.reply(buildBotListPanel(t, merged));
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
                    ? 'Format: `f!bots add <@bot_atau_clientId> [free|vip] [nama]`\nContoh: `f!bots add 123456789012345678 vip Murphy VIP (1)`'
                    : 'Usage: `f!bots add <@bot_or_clientId> [free|vip] [name]`');
            }
            const normalizedTier = tier === 'premium' || tier === 'vip' ? 'premium' : 'free';
            let displayName = name.trim();
            if (!displayName) {
                const fetched = await interaction.client.users?.fetch?.(botId).catch(() => null);
                displayName = fetched?.username || `Murphy (${botId.slice(-4)})`;
            }
            const list = getManualBots().filter((b) => b.botId !== botId);
            list.push({ botId, name: truncate(displayName, 50), tier: normalizedTier, addedAt: Date.now() });
            await saveManualBots(list);
            return say(interaction, isId
                ? `✅ **${escapeMarkdown(displayName)}** (\`${botId}\`) ditambahkan ke panel sebagai **${normalizedTier === 'premium' ? '💎 VIP' : '🆓 Free'}**.\n-# Ketik \`f!bots\` untuk lihat panel.`
                : `✅ Added **${escapeMarkdown(displayName)}** (\`${botId}\`) as **${normalizedTier === 'premium' ? '💎 VIP' : '🆓 Free'}**.\n-# Run \`f!bots\` to view the panel.`, { ephemeral: false });
        }

        if (action === 'remove') {
            const list = getManualBots();
            const merged = mergeBots(interaction.guild, list);
            let removeId = extractId(target);
            if (!removeId && /^\d+$/.test(target.trim())) {
                const idx = Number.parseInt(target.trim(), 10) - 1;
                removeId = merged[idx]?.botId || null;
            }
            if (!removeId || !list.some((b) => b.botId === removeId)) {
                return say(interaction, isId
                    ? 'Bot tidak ditemukan di daftar manual! Gunakan `f!bots remove <clientId>` atau nomor urut dari daftar manual.'
                    : 'Bot not found in manual list! Use `f!bots remove <clientId>`.');
            }
            await saveManualBots(list.filter((b) => b.botId !== removeId));
            return say(interaction, isId
                ? `🗑️ Bot \`${removeId}\` dihapus dari daftar manual.`
                : `🗑️ Removed bot \`${removeId}\` from manual list.`);
        }

        if (action === 'clear') {
            await saveManualBots([]);
            return say(interaction, isId ? '🗑️ Daftar bot manual dibersihkan.' : '🗑️ Cleared manual bot list.');
        }

        const merged = mergeBots(interaction.guild, getManualBots());
        return interaction.reply(buildBotListPanel(t, merged));
    },
};
