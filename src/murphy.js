'use strict';

const path = require('node:path');
const config = require('./config');
const { JsonStore } = require('./core/store');
const { truncate } = require('./core/format');
const log = require('./core/logger').createLogger('murphy');

const BRAND_NAME = 'Murphy Music';
const TAGLINE = 'Together Around the World';
const FOOTER = `${BRAND_NAME} · ${TAGLINE}`;
const DEFAULT_COLOR = '#1E3A8A';
const DEFAULT_STATUS = `Serving Murphy · ${TAGLINE}`;
const DEFAULT_VOICE_TEMPLATE = 'Listening to {song}';
const MAX_FAVORITES = 100;
const MAX_ALLOWED_USERS = 50;
const CLUSTER_STALE_MS = 45_000;

let afkStore = null;
let sessionOwnerStore = null;
let voiceStatusStore = null;
let favoritesStore = null;
let clusterStore = null;

/**
 * Shared directory across multiple bot instances (Murphy 1–5) running from the same repo.
 * Falls back to `config.dataDir` during isolated unit tests when DATA_DIR points to a temp directory.
 */
function sharedDataDir() {
    if (config.sharedDir) return config.sharedDir;
    const defaultDataRoot = path.resolve(config.root, 'data');
    if (config.dataDir === defaultDataRoot || config.dataDir.startsWith(`${defaultDataRoot}${path.sep}`)) {
        return defaultDataRoot;
    }
    return config.dataDir;
}

const afks = () => (afkStore ??= new JsonStore(path.join(config.dataDir, 'murphy', 'afk')));
const sessionOwners = () => (sessionOwnerStore ??= new JsonStore(path.join(config.dataDir, 'murphy', 'owners')));
const voiceStatuses = () => (voiceStatusStore ??= new JsonStore(path.join(sharedDataDir(), 'murphy', 'voicestatus'), { shared: true }));
const favorites = () => (favoritesStore ??= new JsonStore(path.join(sharedDataDir(), 'murphy', 'favorites'), { shared: true }));
const cluster = () => (clusterStore ??= new JsonStore(path.join(sharedDataDir(), 'murphy', 'cluster'), { shared: true }));

function resetMurphyStores() {
    afkStore = null;
    sessionOwnerStore = null;
    voiceStatusStore = null;
    favoritesStore = null;
    clusterStore = null;
}

// ─── Session Owner & Access Lock (1 Bot = 1 Owner = 1 Voice) ───────────

function getSession(guildId) {
    if (!guildId) return null;
    const data = sessionOwners().get(String(guildId));
    return data?.ownerId ? data : null;
}

function isSessionOwner(guildId, userId) {
    if (!guildId || !userId) return false;
    return getSession(guildId)?.ownerId === String(userId);
}

/**
 * Strictly checks whether `userId` may control the bot in `guildId`.
 * Only the Session Owner and explicitly allowed users may control the session (no Admin override).
 */
function isSessionAuthorized(guildId, userId) {
    if (!userId) return false;
    const session = getSession(guildId);
    if (!session?.ownerId) return true;
    const id = String(userId);
    if (session.ownerId === id) return true;
    return Array.isArray(session.allowedIds) && session.allowedIds.includes(id);
}

async function claimSession(guildId, userId, channelId = null, client = null) {
    if (!guildId || !userId) return null;
    const id = String(guildId);
    const existing = getSession(id);
    if (existing?.ownerId) {
        if (channelId && existing.channelId !== String(channelId)) {
            const updated = { ...existing, channelId: String(channelId), updatedAt: Date.now() };
            await sessionOwners().set(id, updated);
            if (client) await syncClusterState(client);
            return updated;
        }
        return existing;
    }
    const record = {
        ownerId: String(userId),
        allowedIds: [],
        channelId: channelId ? String(channelId) : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await sessionOwners().set(id, record);
    if (client) await syncClusterState(client);
    return record;
}

async function clearSession(guildId, client = null) {
    if (!guildId) return;
    await sessionOwners().delete(String(guildId));
    if (client) await syncClusterState(client);
}

async function allowSessionUser(guildId, targetUserId, client = null) {
    const id = String(guildId);
    const session = getSession(id);
    if (!session) return { ok: false, reason: 'no_session', session: null };
    const target = String(targetUserId);
    if (session.ownerId === target) return { ok: false, reason: 'is_owner', session };
    const allowedIds = Array.isArray(session.allowedIds) ? [...session.allowedIds] : [];
    if (allowedIds.includes(target)) return { ok: false, reason: 'already_allowed', session };
    if (allowedIds.length >= MAX_ALLOWED_USERS) return { ok: false, reason: 'full', session };
    allowedIds.push(target);
    const updated = { ...session, allowedIds, updatedAt: Date.now() };
    await sessionOwners().set(id, updated);
    if (client) await syncClusterState(client);
    return { ok: true, session: updated };
}

async function disallowSessionUser(guildId, targetUserId, client = null) {
    const id = String(guildId);
    const session = getSession(id);
    if (!session) return { ok: false, reason: 'no_session', session: null };
    const target = String(targetUserId);
    const allowedIds = Array.isArray(session.allowedIds) ? [...session.allowedIds] : [];
    const index = allowedIds.indexOf(target);
    if (index === -1) return { ok: false, reason: 'not_allowed', session };
    allowedIds.splice(index, 1);
    const updated = { ...session, allowedIds, updatedAt: Date.now() };
    await sessionOwners().set(id, updated);
    if (client) await syncClusterState(client);
    return { ok: true, session: updated };
}

async function transferSessionOwner(guildId, newOwnerId, client = null) {
    const id = String(guildId);
    const session = getSession(id);
    if (!session) return { ok: false, reason: 'no_session', session: null };
    const target = String(newOwnerId);
    if (session.ownerId === target) return { ok: false, reason: 'already_owner', session };
    const allowedIds = (Array.isArray(session.allowedIds) ? session.allowedIds : [])
        .filter((uid) => uid !== target);
    if (!allowedIds.includes(session.ownerId)) allowedIds.push(session.ownerId);
    const updated = {
        ...session,
        ownerId: target,
        allowedIds,
        updatedAt: Date.now(),
    };
    await sessionOwners().set(id, updated);
    if (client) await syncClusterState(client);
    return { ok: true, session: updated };
}

function sessionLockedMessage(lang, ownerId) {
    if (lang === 'id') {
        return `🔒 Sesi bot ini dikunci oleh **Session Owner** <@${ownerId}>.\nHanya Session Owner atau member yang sudah di-\`allow\` (\`f!allow @user\`) yang bisa mengontrol bot ini.\n-# ${FOOTER}`;
    }
    return `🔒 This bot session is locked by **Session Owner** <@${ownerId}>.\nOnly the Session Owner or allowed members (\`f!allow @user\`) can control this bot.\n-# ${FOOTER}`;
}

function ownerBusyInOtherChannelMessage(lang, channelId) {
    if (lang === 'id') {
        return `🔒 Kamu masih menjadi **Session Owner** aktif di <#${channelId}>!\n1 member hanya bisa memegang 1 bot dalam satu waktu. Gunakan \`f!dc\` atau \`f!afk off\` untuk menyelesaikan sesi tersebut terlebih dahulu.\n-# ${FOOTER}`;
    }
    return `🔒 You are still the active **Session Owner** in <#${channelId}>!\nEach member can hold at most 1 bot at a time. Use \`f!dc\` or \`f!afk off\` to finish that session first.\n-# ${FOOTER}`;
}

function allBotsBusyMessage(lang) {
    if (lang === 'id') {
        return `⚠️ Semua bot **${BRAND_NAME}** di server ini sedang digunakan di voice channel lain! Tunggu salah satu sesi selesai ya.\n-# ${FOOTER}`;
    }
    return `⚠️ All **${BRAND_NAME}** bots in this server are currently in use in other voice channels! Please wait for a session to finish.\n-# ${FOOTER}`;
}

// ─── Multi-Bot Cluster Coordination (Murphy 1–5) ───────────────────────

function collectClientGuildStates(client) {
    const guilds = {};
    if (!client?.guilds?.cache) return guilds;
    for (const [guildId, guild] of client.guilds.cache.entries()) {
        const session = getSession(guildId);
        const afk = getAfk(guildId);
        const queue = client.music?.getQueue?.(guildId);
        const voiceChannelId = guild.members?.me?.voice?.channelId
            || queue?.voiceChannel?.id
            || session?.channelId
            || afk?.voiceChannelId
            || null;
        if (voiceChannelId || session?.ownerId || afk?.enabled) {
            guilds[guildId] = {
                channelId: voiceChannelId,
                ownerId: session?.ownerId || null,
                allowedIds: session?.allowedIds || [],
                afk: Boolean(afk?.enabled),
            };
        }
    }
    return guilds;
}

async function syncClusterState(client) {
    const botId = client?.user?.id;
    if (!botId) return;
    try {
        await cluster().set(String(botId), {
            botId: String(botId),
            tag: client.user.tag || BRAND_NAME,
            priority: config.bot.priority || 1,
            updatedAt: Date.now(),
            guilds: collectClientGuildStates(client),
        });
    } catch (error) {
        log.debug(`Cluster sync failed: ${error.message}`);
    }
}

async function removeClusterState(client) {
    const botId = client?.user?.id;
    if (!botId) return;
    try {
        await cluster().delete(String(botId));
    } catch {
        // ignore
    }
}

function getClusterBotsForGuild(guild) {
    const myBotId = guild?.client?.user?.id;
    if (!myBotId) return [];
    const now = Date.now();
    const keys = cluster().keys();
    const result = [];
    const seen = new Set();

    for (const key of keys) {
        const data = cluster().get(key);
        if (!data?.botId || now - (data.updatedAt || 0) > CLUSTER_STALE_MS) continue;
        // Verify the bot is present in this guild if member/voice cache is populated
        const inVoiceCache = guild.voiceStates?.cache?.get(data.botId);
        const inMemberCache = guild.members?.cache?.has(data.botId);
        if (data.botId !== myBotId && guild.members?.cache?.size > 1 && !inMemberCache && !inVoiceCache && !data.guilds?.[guild.id]) {
            continue;
        }
        seen.add(data.botId);
        const guildState = data.guilds?.[guild.id] || {};
        const liveChannelId = inVoiceCache !== undefined
            ? inVoiceCache.channelId
            : (guildState.channelId || null);
        result.push({
            botId: String(data.botId),
            priority: Number(data.priority) || 1,
            channelId: liveChannelId || guildState.channelId || null,
            ownerId: guildState.ownerId || null,
            allowedIds: Array.isArray(guildState.allowedIds) ? guildState.allowedIds : [],
            afk: Boolean(guildState.afk),
        });
    }

    if (!seen.has(String(myBotId))) {
        const mySession = getSession(guild.id);
        const myAfk = getAfk(guild.id);
        const myChannelId = guild.members?.me?.voice?.channelId
            || guild.client?.music?.getQueue?.(guild.id)?.voiceChannel?.id
            || mySession?.channelId
            || myAfk?.voiceChannelId
            || null;
        result.push({
            botId: String(myBotId),
            priority: config.bot.priority || 1,
            channelId: myChannelId,
            ownerId: mySession?.ownerId || null,
            allowedIds: mySession?.allowedIds || [],
            afk: Boolean(myAfk?.enabled),
        });
    }

    result.sort((a, b) => (a.priority - b.priority) || a.botId.localeCompare(b.botId));
    return result;
}

function isSummonCommand(commandName, rawArgs) {
    if (commandName === 'play' || commandName === 'search' || commandName === 'afk') return true;
    if (commandName === 'favorite') {
        const first = String(rawArgs ?? '').trim().split(/\s+/)[0]?.toLowerCase() || '';
        return ['play', 'p', 'start'].includes(first) || /^\d+$/.test(first);
    }
    return false;
}

function isGlobalNonVoiceCommand(commandName, rawArgs) {
    if (['help', 'prefix', 'language'].includes(commandName)) return true;
    if (commandName === 'favorite') {
        const trimmed = String(rawArgs ?? '').trim();
        if (!trimmed) return true; // list
        const [first, ...rest] = trimmed.split(/\s+/);
        const sub = first.toLowerCase();
        if (['list', 'ls', 'show', 'remove', 'rm', 'del', 'delete', '-', 'clear', 'reset', 'empty'].includes(sub)) return true;
        if (['add', 'save', '+'].includes(sub)) return rest.length > 0; // `f!fav add` without args reads current playing song
    }
    return false;
}

/**
 * Decide whether this bot instance should respond to a prefix command when multiple
 * Murphy bots (Murphy 1–5) share the same guild and prefix.
 */
function routePrefixCommand(message, { prefix, commandName, rawArgs }) {
    if (prefix === '@bot ') return { shouldHandle: true, allBusy: false };
    const guild = message.guild;
    const myBotId = message.client?.user?.id;
    if (!guild || !myBotId) return { shouldHandle: true, allBusy: false };

    const bots = getClusterBotsForGuild(guild);
    if (bots.length <= 1) return { shouldHandle: true, allBusy: false };

    const primaryBot = bots[0];
    const userId = String(message.author.id);
    const userChannelId = message.member?.voice?.channelId || null;
    const botInUserChannel = userChannelId ? bots.find((b) => b.channelId === userChannelId) : null;
    const botOwnedByUser = bots.find((b) => b.ownerId === userId);
    const botAllowedForUser = bots.find((b) => b.allowedIds.includes(userId) && b.channelId);

    if (isGlobalNonVoiceCommand(commandName, rawArgs)) {
        const target = botInUserChannel || botOwnedByUser || primaryBot;
        return { shouldHandle: target.botId === String(myBotId), allBusy: false };
    }

    // 1) If there is already a Murphy bot in the user's voice channel, only that bot responds.
    if (botInUserChannel) {
        return { shouldHandle: botInUserChannel.botId === String(myBotId), allBusy: false };
    }

    // 2) If the user already owns a session on a Murphy bot (even if they stepped out of VC or moved to another VC),
    //    only their owned bot responds (enforcing 1 bot = 1 owner and allowing remote control/stop).
    if (botOwnedByUser) {
        return { shouldHandle: botOwnedByUser.botId === String(myBotId), allBusy: false };
    }

    // 3) If the user is not in a VC and is an allowed user on an active bot session, route to that bot.
    if (!userChannelId && botAllowedForUser) {
        return { shouldHandle: botAllowedForUser.botId === String(myBotId), allBusy: false };
    }

    // 4) User is in a VC with no Murphy bot yet and does not own any bot yet:
    if (userChannelId && isSummonCommand(commandName, rawArgs)) {
        const idleBots = bots.filter((b) => !b.channelId && !b.ownerId);
        if (idleBots.length > 0) {
            return { shouldHandle: idleBots[0].botId === String(myBotId), allBusy: false };
        }
        return { shouldHandle: primaryBot.botId === String(myBotId), allBusy: true };
    }

    // 5) Fallback (e.g. non-summon command in an empty VC): only the primary bot responds.
    return { shouldHandle: primaryBot.botId === String(myBotId), allBusy: false };
}

// ─── 24/7 AFK Mode ─────────────────────────────────────────────────────

function getAfk(guildId) {
    if (!guildId) return null;
    const data = afks().get(String(guildId));
    return data?.enabled ? data : null;
}

function isAfk(guildId) {
    return Boolean(getAfk(guildId));
}

async function setAfk(guildId, { enabled, voiceChannelId = null, textChannelId = null } = {}, client = null) {
    const id = String(guildId);
    if (!enabled) {
        await afks().delete(id);
        if (client) await syncClusterState(client);
        return null;
    }
    const record = { enabled: true, voiceChannelId, textChannelId };
    await afks().set(id, record);
    if (client) await syncClusterState(client);
    return record;
}

function afkGuildIds() {
    return afks().keys();
}

// ─── Custom Voice Channel Status ───────────────────────────────────────

function getVoiceTemplate(guildId) {
    if (!guildId) return null;
    const saved = voiceStatuses().get(String(guildId))?.template;
    return typeof saved === 'string' && saved.trim() ? saved.trim() : null;
}

async function setVoiceTemplate(guildId, template) {
    const id = String(guildId);
    const trimmed = String(template ?? '').trim();
    if (!trimmed) {
        await voiceStatuses().delete(id);
        return null;
    }
    const clean = truncate(trimmed, 300);
    await voiceStatuses().set(id, { template: clean });
    return clean;
}

/**
 * Format the voice channel status string for a guild.
 * Defaults to "Listening to <song title>" when a song is playing.
 */
function formatVoiceStatus(guildId, song = null) {
    const custom = getVoiceTemplate(guildId);
    const songName = song?.name ? truncate(song.name, 200) : null;

    if (custom) {
        if (/\{(song|title|lagu)\}/i.test(custom)) {
            if (!songName) return isAfk(guildId) ? `${BRAND_NAME} · 24/7` : '';
            return truncate(custom.replace(/\{(song|title|lagu)\}/gi, songName), 480);
        }
        return truncate(custom, 480);
    }

    if (songName) return truncate(`Listening to ${songName}`, 480);
    if (isAfk(guildId)) return `${BRAND_NAME} · 24/7`;
    return '';
}

/**
 * Set Discord's Voice Channel Status via REST API. Never throws if permissions are missing.
 */
async function syncVoiceStatus(client, guildId, channelId, song = null) {
    if (!client?.rest?.put || !channelId) return false;
    const status = formatVoiceStatus(guildId, song);
    try {
        await client.rest.put(`/channels/${channelId}/voice-status`, {
            body: { status },
        });
        return true;
    } catch (error) {
        log.debug(`Could not set voice channel status in ${channelId}: ${error.message}`);
        return false;
    }
}

async function clearVoiceStatus(client, channelId) {
    if (!client?.rest?.put || !channelId) return false;
    try {
        await client.rest.put(`/channels/${channelId}/voice-status`, {
            body: { status: '' },
        });
        return true;
    } catch {
        return false;
    }
}

// ─── Member Favorite Songs ─────────────────────────────────────────────

function getFavorites(userId) {
    if (!userId) return [];
    const saved = favorites().get(String(userId))?.songs;
    return Array.isArray(saved) ? saved : [];
}

async function addFavorite(userId, songData) {
    const id = String(userId);
    const list = [...getFavorites(id)];
    if (list.some((item) => item.url === songData.url)) {
        return { added: false, reason: 'duplicate', list };
    }
    if (list.length >= MAX_FAVORITES) {
        return { added: false, reason: 'full', list };
    }
    const entry = {
        plugin: songData.plugin || 'youtube',
        source: songData.source || 'youtube',
        playFromSource: songData.playFromSource ?? true,
        id: songData.id || null,
        name: truncate(songData.name || 'Untitled', 200),
        url: songData.url,
        duration: Number(songData.duration) || 0,
        isLive: Boolean(songData.isLive),
        thumbnail: songData.thumbnail || null,
        uploader: { name: songData.uploader?.name || undefined, url: songData.uploader?.url || undefined },
        ageRestricted: Boolean(songData.ageRestricted),
    };
    list.push(entry);
    await favorites().set(id, { songs: list });
    return { added: true, position: list.length, song: entry, list };
}

async function removeFavorite(userId, position) {
    const id = String(userId);
    const list = [...getFavorites(id)];
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
        return { removed: null, list };
    }
    const [removed] = list.splice(index, 1);
    if (list.length) await favorites().set(id, { songs: list });
    else await favorites().delete(id);
    return { removed, list };
}

async function clearFavorites(userId) {
    const id = String(userId);
    await favorites().delete(id);
    return [];
}

module.exports = {
    BRAND_NAME,
    TAGLINE,
    FOOTER,
    DEFAULT_COLOR,
    DEFAULT_STATUS,
    DEFAULT_VOICE_TEMPLATE,
    MAX_FAVORITES,
    MAX_ALLOWED_USERS,
    sharedDataDir,
    getSession,
    isSessionOwner,
    isSessionAuthorized,
    claimSession,
    clearSession,
    allowSessionUser,
    disallowSessionUser,
    transferSessionOwner,
    sessionLockedMessage,
    ownerBusyInOtherChannelMessage,
    allBotsBusyMessage,
    syncClusterState,
    removeClusterState,
    getClusterBotsForGuild,
    routePrefixCommand,
    getAfk,
    isAfk,
    setAfk,
    afkGuildIds,
    getVoiceTemplate,
    setVoiceTemplate,
    formatVoiceStatus,
    syncVoiceStatus,
    clearVoiceStatus,
    getFavorites,
    addFavorite,
    removeFavorite,
    clearFavorites,
    resetMurphyStores,
};
