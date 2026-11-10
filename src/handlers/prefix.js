'use strict';

const path = require('node:path');
const { MessageFlags } = require('discord.js');
const config = require('../config');
const i18n = require('../core/i18n');
const { JsonStore } = require('../core/store');
const { say, IGNORED_CODES } = require('./guards');
const log = require('../core/logger').createLogger('prefix');

const MAX_PREFIX_LENGTH = 10;
const INVALID_PREFIX = /[\s/\\`@<>]/;

let guildStore = null;
let userStore = null;
const guilds = () => (guildStore ??= new JsonStore(path.join(config.dataDir, 'prefixes', 'guilds')));
const users = () => (userStore ??= new JsonStore(path.join(config.dataDir, 'prefixes', 'users')));

/**
 * Reset in-memory stores (used by tests when DATA_DIR changes).
 */
function resetStores() {
    guildStore = null;
    userStore = null;
}

function defaultServerPrefix() {
    return config.bot.defaultPrefix || 'f!';
}

function getServerPrefix(guildId) {
    if (!guildId) return defaultServerPrefix();
    const saved = guilds().get(String(guildId))?.prefix;
    return typeof saved === 'string' && saved.length ? saved : defaultServerPrefix();
}

async function setServerPrefix(guildId, prefix) {
    const id = String(guildId);
    if (!prefix) {
        await guilds().delete(id);
        return defaultServerPrefix();
    }
    const clean = validatePrefix(prefix);
    if (!clean) throw new Error('INVALID_PREFIX');
    await guilds().set(id, { prefix: clean });
    return clean;
}

function getUserPrefix(userId) {
    if (!userId) return null;
    const saved = users().get(String(userId))?.prefix;
    return typeof saved === 'string' && saved.length ? saved : null;
}

async function setUserPrefix(userId, prefix) {
    const id = String(userId);
    if (!prefix) {
        await users().delete(id);
        return null;
    }
    const clean = validatePrefix(prefix);
    if (!clean) throw new Error('INVALID_PREFIX');
    await users().set(id, { prefix: clean });
    return clean;
}

function validatePrefix(input) {
    const trimmed = String(input ?? '').trim();
    if (!trimmed || trimmed.length > MAX_PREFIX_LENGTH || INVALID_PREFIX.test(trimmed)) return null;
    return trimmed;
}

// ─── Command & Alias table ─────────────────────────────────────────────

const DIRECT_FILTERS = new Set(['bassboost', 'nightcore', 'vaporwave', '3d', '8d', 'karaoke', 'echo', 'surround', 'tremolo', 'nofilter', 'clearfilter']);

const COMMAND_ALIASES = {
    play: ['play', 'p', 'playnext', 'pn'],
    search: ['search', 'find', 'sr'],
    nowplaying: ['nowplaying', 'np', 'current', 'song'],
    pause: ['pause', 'pa'],
    resume: ['resume', 'res', 'unpause', 'continue'],
    skip: ['skip', 's', 'next'],
    previous: ['previous', 'prev', 'back'],
    stop: ['stop', 'dc', 'disconnect', 'leave', 'lv'],
    seek: ['seek', 'ff'],
    volume: ['volume', 'vol', 'v'],
    loop: ['loop', 'l', 'repeat', 'rep'],
    autoplay: ['autoplay', 'ap', 'auto'],
    filter: ['filter', 'f', 'fx', ...DIRECT_FILTERS],
    queue: ['queue', 'q', 'list'],
    remove: ['remove', 'rm', 'del', 'delete'],
    move: ['move', 'mv'],
    jump: ['jump', 'j', 'skipto'],
    clear: ['clear', 'cl', 'empty'],
    shuffle: ['shuffle', 'sh', 'mix'],
    lyrics: ['lyrics', 'ly', 'lyric'],
    language: ['language', 'lang'],
    help: ['help', 'h', 'commands', 'cmd'],
    prefix: ['prefix', 'px', 'setprefix'],
    afk: ['afk', '247', 'stay'],
    voicestatus: ['voicestatus', 'vs', 'vcstatus'],
    favorite: ['favorite', 'fav', 'favs'],
    grab: ['grab', 'save', 'dm'],
};

const ALIAS_TO_COMMAND = new Map();
for (const [commandName, aliases] of Object.entries(COMMAND_ALIASES)) {
    for (const alias of aliases) ALIAS_TO_COMMAND.set(alias, commandName);
}

/**
 * When a user chooses a plain-letter prefix (e.g. "d" -> "dp", "ds", "dq"), guard single-letter
 * aliases so normal chat sentences starting with those letters never trigger a command by mistake.
 */
function passesWordPrefixGuard(commandName, alias, rawArgs) {
    if (alias.length > 1) {
        if (['skip', 'pause', 'resume', 'stop', 'previous', 'clear', 'shuffle', 'autoplay', 'nowplaying', 'help', 'language', 'grab'].includes(commandName)) {
            return rawArgs === '';
        }
        return true;
    }
    switch (commandName) {
        case 'play':
            return rawArgs.length > 0;
        case 'skip':
        case 'help':
            return rawArgs === '';
        case 'queue':
            return rawArgs === '' || /^\d+$/.test(rawArgs);
        case 'volume':
        case 'jump':
            return /^\d+$/.test(rawArgs);
        case 'loop':
            return rawArgs === '' || /^(off|song|track|queue|all|0|1|2|mati|lagu|antrian)$/i.test(rawArgs);
        case 'filter':
            return rawArgs === '' || /^(none|off|clear|reset|bassboost|nightcore|vaporwave|3d|8d|karaoke|echo|surround|tremolo)$/i.test(rawArgs);
        default:
            return true;
    }
}

/**
 * Parse a chat message against active prefixes (user personal prefix, server prefix, or bot mention).
 * Returns { prefix, commandName, alias, rawArgs } or null when the message is not a command.
 */
function parsePrefixCommand(content, { userPrefix = null, serverPrefix = defaultServerPrefix(), botId = null } = {}) {
    const trimmed = String(content ?? '').trim();
    if (!trimmed) return null;

    if (botId) {
        const mentionMatch = trimmed.match(new RegExp(`^<@!?${botId}>\\s*([a-zA-Z0-9_-]+)(?:\\s+([\\s\\S]*))?$`));
        if (mentionMatch) {
            const alias = mentionMatch[1].toLowerCase();
            const commandName = ALIAS_TO_COMMAND.get(alias);
            if (commandName) {
                return { prefix: `@bot `, commandName, alias, rawArgs: (mentionMatch[2] || '').trim() };
            }
        }
    }

    const candidates = [...new Set([userPrefix, serverPrefix].filter(Boolean))]
        .sort((a, b) => b.length - a.length);

    const lower = trimmed.toLowerCase();
    for (const prefix of candidates) {
        if (!lower.startsWith(prefix.toLowerCase())) continue;
        const isWordPrefix = /^[a-z0-9]+$/i.test(prefix);
        const rest = trimmed.slice(prefix.length);

        // Plain-letter prefixes (e.g. "d") must be attached directly to the command ("dp", "dplay")
        // so everyday chat like "d rumah" is never mistaken for a command.
        if (isWordPrefix && /^\s/.test(rest)) continue;

        const match = rest.trimStart().match(/^([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
        if (!match) continue;

        const alias = match[1].toLowerCase();
        const rawArgs = (match[2] || '').trim();
        const commandName = ALIAS_TO_COMMAND.get(alias);
        if (!commandName) continue;

        if (isWordPrefix && !passesWordPrefixGuard(commandName, alias, rawArgs)) continue;

        return { prefix, commandName, alias, rawArgs };
    }

    return null;
}

// ─── Option & Interaction adapter ──────────────────────────────────────

function parseLoopArg(rawArgs) {
    const val = rawArgs.toLowerCase();
    if (['off', '0', 'none', 'disable', 'mati'].includes(val)) return 'off';
    if (['song', 'track', '1', 'lagu'].includes(val)) return 'song';
    if (['queue', 'all', '2', 'antrian'].includes(val)) return 'queue';
    return '';
}

function parseFilterArg(alias, rawArgs) {
    if (DIRECT_FILTERS.has(alias)) {
        if (alias === '8d') return '3d';
        if (alias === 'nofilter' || alias === 'clearfilter') return 'none';
        return alias;
    }
    const val = rawArgs.toLowerCase();
    if (!val || ['none', 'off', 'clear', 'reset'].includes(val)) return 'none';
    if (val === '8d') return '3d';
    return val;
}

function createOptions(commandName, alias, rawArgs) {
    const intOrNull = (str) => (/^\d+$/.test(str) ? Number.parseInt(str, 10) : null);
    const intOrNaN = (str) => (/^\d+$/.test(str) ? Number.parseInt(str, 10) : NaN);
    const parts = rawArgs ? rawArgs.split(/\s+/) : [];

    return {
        getString(name) {
            if (commandName === 'play' && name === 'query') return rawArgs;
            if (commandName === 'search' && name === 'query') return rawArgs;
            if (commandName === 'seek' && name === 'time') return rawArgs;
            if (commandName === 'lyrics' && name === 'song') return rawArgs || null;
            if (commandName === 'loop' && name === 'mode') return parseLoopArg(rawArgs);
            if (commandName === 'filter' && name === 'name') return parseFilterArg(alias, rawArgs);
            if (commandName === 'afk' && name === 'mode') return rawArgs || null;
            if (commandName === 'voicestatus' && name === 'status') return rawArgs || null;
            if (commandName === 'favorite' && name === 'raw') return rawArgs;
            if (commandName === 'favorite') return null;
            if (commandName === 'prefix' && name === 'raw') return rawArgs;
            if (commandName === 'prefix') return null;
            return rawArgs || null;
        },
        getBoolean(name) {
            if (commandName === 'play' && name === 'next') return alias === 'playnext' || alias === 'pn';
            return null;
        },
        getInteger(name) {
            if (commandName === 'volume' && name === 'level') return intOrNaN(rawArgs);
            if (commandName === 'queue' && name === 'page') return intOrNull(rawArgs);
            if ((commandName === 'remove' || commandName === 'jump') && name === 'position') return intOrNaN(rawArgs);
            if (commandName === 'move' && name === 'from') return intOrNaN(parts[0] || '');
            if (commandName === 'move' && name === 'to') return intOrNaN(parts[1] || '');
            return null;
        },
    };
}

function cleanMessagePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const { flags, withResponse, ...rest } = payload;
    const cleaned = {
        ...rest,
        allowedMentions: { parse: [], repliedUser: false },
    };
    if (typeof flags === 'number') {
        const stripped = flags & ~MessageFlags.Ephemeral;
        if (stripped) cleaned.flags = stripped;
    }
    return cleaned;
}

/**
 * Wrap a Discord Message so existing slash command modules can execute it without changes.
 */
function createMessageInteraction(message, { commandName, alias, rawArgs }) {
    let sentMessage = null;
    const adapter = {
        isPrefix: true,
        message,
        commandName,
        client: message.client,
        guild: message.guild,
        guildId: message.guildId,
        channel: message.channel,
        channelId: message.channelId,
        member: message.member,
        user: message.author,
        memberPermissions: message.member?.permissions ?? null,
        locale: message.guild?.preferredLocale ?? null,
        deferred: false,
        replied: false,
        options: createOptions(commandName, alias, rawArgs),

        async deferReply() {
            this.deferred = true;
            message.channel?.sendTyping?.().catch(() => undefined);
        },

        async reply(payload) {
            const data = cleanMessagePayload(payload);
            sentMessage = await (typeof message.reply === 'function'
                ? message.reply(data)
                : message.channel.send(data));
            this.replied = true;
            if (sentMessage && typeof sentMessage === 'object') {
                sentMessage.resource = { message: sentMessage };
            }
            return sentMessage;
        },

        async editReply(payload) {
            const data = cleanMessagePayload(payload);
            if (sentMessage && typeof sentMessage.edit === 'function') {
                sentMessage = await sentMessage.edit(data);
                return sentMessage;
            }
            return this.reply(payload);
        },

        async followUp(payload) {
            const data = cleanMessagePayload(payload);
            return message.channel.send(data);
        },
    };
    return adapter;
}

// ─── Event handler ─────────────────────────────────────────────────────

function usageHint(lang, prefix, alias, commandName) {
    const isId = lang === 'id';
    if (commandName === 'play' || commandName === 'search') {
        return isId
            ? `Masukkan judul lagu atau tautan! Contoh: \`${prefix}${alias} Hindia Evaluasi\``
            : `Please provide a song name or link! Example: \`${prefix}${alias} Never Gonna Give You Up\``;
    }
    if (commandName === 'volume') {
        return isId
            ? `Masukkan angka volume (0-100)! Contoh: \`${prefix}${alias} 80\``
            : `Please provide a volume level (0-100)! Example: \`${prefix}${alias} 80\``;
    }
    if (commandName === 'move') {
        return isId
            ? `Masukkan posisi asal dan tujuan! Contoh: \`${prefix}${alias} 3 1\``
            : `Please provide the from and to positions! Example: \`${prefix}${alias} 3 1\``;
    }
    if (commandName === 'remove' || commandName === 'jump') {
        return isId
            ? `Masukkan nomor urutan lagu di antrean! Contoh: \`${prefix}${alias} 2\``
            : `Please provide the song position in the queue! Example: \`${prefix}${alias} 2\``;
    }
    return null;
}

async function onMessage(message) {
    try {
        if (!message?.guild || message.author?.bot || !message.content) return null;

        const userPrefix = getUserPrefix(message.author.id);
        const serverPrefix = getServerPrefix(message.guild.id);
        const parsed = parsePrefixCommand(message.content, {
            userPrefix,
            serverPrefix,
            botId: message.client?.user?.id,
        });
        if (!parsed) return null;

        const { prefix, commandName, alias, rawArgs } = parsed;
        const command = message.client.commands?.get(commandName);
        if (!command) return null;

        const interaction = createMessageInteraction(message, parsed);
        const t = i18n.forGuild(message.guild);
        const ctx = { client: message.client, manager: message.client.music, t };

        if ((commandName === 'play' || commandName === 'search') && !rawArgs) {
            return say(interaction, usageHint(t.lang, prefix, alias, commandName));
        }
        if (commandName === 'volume' && !rawArgs) {
            const queue = ctx.manager.getQueue(message.guild.id);
            if (!queue?.songs.length) return say(interaction, t('commands.nowplaying.no_track'));
            return say(interaction, `${t('commands.nowplaying.volume', { volume: queue.volume })}\n-# ${usageHint(t.lang, prefix, alias, commandName)}`);
        }
        if ((commandName === 'remove' || commandName === 'jump') && !rawArgs) {
            return say(interaction, usageHint(t.lang, prefix, alias, commandName));
        }
        if (commandName === 'move' && rawArgs.split(/\s+/).filter(Boolean).length < 2) {
            return say(interaction, usageHint(t.lang, prefix, alias, commandName));
        }

        return await command.execute(interaction, ctx);
    } catch (error) {
        if (IGNORED_CODES.has(error?.code)) return null;
        log.error(`Prefix command failed in ${message?.guildId}:`, error);
        return null;
    }
}

module.exports = {
    onMessage,
    parsePrefixCommand,
    createMessageInteraction,
    getServerPrefix,
    setServerPrefix,
    getUserPrefix,
    setUserPrefix,
    defaultServerPrefix,
    validatePrefix,
    resetStores,
    COMMAND_ALIASES,
    ALIAS_TO_COMMAND,
};

