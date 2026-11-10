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

let afkStore = null;
let voiceStatusStore = null;
let favoritesStore = null;

const afks = () => (afkStore ??= new JsonStore(path.join(config.dataDir, 'murphy', 'afk')));
const voiceStatuses = () => (voiceStatusStore ??= new JsonStore(path.join(config.dataDir, 'murphy', 'voicestatus')));
const favorites = () => (favoritesStore ??= new JsonStore(path.join(config.dataDir, 'murphy', 'favorites')));

function resetMurphyStores() {
    afkStore = null;
    voiceStatusStore = null;
    favoritesStore = null;
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

async function setAfk(guildId, { enabled, voiceChannelId = null, textChannelId = null } = {}) {
    const id = String(guildId);
    if (!enabled) {
        await afks().delete(id);
        return null;
    }
    const record = { enabled: true, voiceChannelId, textChannelId };
    await afks().set(id, record);
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

