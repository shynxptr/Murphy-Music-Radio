'use strict';

const path = require('node:path');
const { JsonStore } = require('./core/store');
const { truncate } = require('./core/format');
const murphy = require('./murphy');

const MAX_PLAYLISTS = 50;
const MAX_HISTORY = 25;
const MAX_TRUSTED = 25;

const COLOR_PRESETS = {
    bluesky: '#0EA5E9',
    sky: '#0EA5E9',
    blue: '#1E3A8A',
    midnight: '#1E3A8A',
    navy: '#1E3A8A',
    gold: '#F59E0B',
    amber: '#F59E0B',
    crimson: '#E11D48',
    red: '#E11D48',
    sakura: '#EC4899',
    pink: '#EC4899',
    violet: '#8B5CF6',
    purple: '#8B5CF6',
    emerald: '#10B981',
    green: '#10B981',
    cyan: '#06B6D4',
};

let playlistsStore = null;
let historyStore = null;
let statsStore = null;
let vipPrefsStore = null;

const playlists = () => (playlistsStore ??= new JsonStore(path.join(murphy.sharedDataDir(), 'murphy', 'playlists'), { shared: true }));
const history = () => (historyStore ??= new JsonStore(path.join(murphy.sharedDataDir(), 'murphy', 'history'), { shared: true }));
const stats = () => (statsStore ??= new JsonStore(path.join(murphy.sharedDataDir(), 'murphy', 'stats'), { shared: true }));
const vipPrefs = () => (vipPrefsStore ??= new JsonStore(path.join(murphy.sharedDataDir(), 'murphy', 'vipprefs'), { shared: true }));

function resetVipStores() {
    playlistsStore = null;
    historyStore = null;
    statsStore = null;
    vipPrefsStore = null;
}

// ─── Color & Branding Preferences ──────────────────────────────────────

function resolveColorInput(input) {
    const raw = String(input ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (COLOR_PRESETS[raw]) return COLOR_PRESETS[raw];
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
}

function getVipPrefs(userId) {
    if (!userId) return {};
    return vipPrefs().get(String(userId)) || {};
}

async function updateVipPrefs(userId, patch) {
    const id = String(userId);
    const current = getVipPrefs(id);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await vipPrefs().set(id, next);
    return next;
}

async function resetVipPrefs(userId) {
    const id = String(userId);
    const current = getVipPrefs(id);
    const preserved = {
        trustedIds: Array.isArray(current.trustedIds) ? current.trustedIds : [],
        followMe: Boolean(current.followMe),
        autoClean: Boolean(current.autoClean),
    };
    await vipPrefs().set(id, preserved);
    return preserved;
}

function getTrustedIds(userId) {
    const prefs = getVipPrefs(userId);
    return Array.isArray(prefs.trustedIds) ? prefs.trustedIds : [];
}

async function addTrustedUser(ownerId, targetId) {
    const list = [...getTrustedIds(ownerId)];
    const target = String(targetId);
    if (target === String(ownerId)) return { ok: false, reason: 'self', list };
    if (list.includes(target)) return { ok: false, reason: 'duplicate', list };
    if (list.length >= MAX_TRUSTED) return { ok: false, reason: 'full', list };
    list.push(target);
    await updateVipPrefs(ownerId, { trustedIds: list });
    return { ok: true, list };
}

async function removeTrustedUser(ownerId, targetId) {
    const list = [...getTrustedIds(ownerId)];
    const index = list.indexOf(String(targetId));
    if (index === -1) return { ok: false, list };
    list.splice(index, 1);
    await updateVipPrefs(ownerId, { trustedIds: list });
    return { ok: true, list };
}

// ─── Auto-Save Spotify Library & Custom Queues (`f!playlist` / `f!pl`) ──

function getPlaylists(userId) {
    if (!userId) return [];
    const list = playlists().get(String(userId))?.items;
    return Array.isArray(list) ? list : [];
}

function sortPlaylists(list) {
    return [...list].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return (b.lastPlayedAt || b.savedAt || 0) - (a.lastPlayedAt || a.savedAt || 0);
    });
}

async function savePlaylistEntry(userId, entry) {
    if (!userId || !entry?.name) return null;
    const id = String(userId);
    const list = [...getPlaylists(id)];
    const now = Date.now();
    const isQueueSnapshot = entry.type === 'queue' && Array.isArray(entry.songs);

    const existingIdx = list.findIndex((item) => {
        if (isQueueSnapshot) {
            return item.type === 'queue' && item.name.toLowerCase() === entry.name.trim().toLowerCase();
        }
        return item.type !== 'queue' && entry.url && item.url === entry.url;
    });

    const clean = {
        type: isQueueSnapshot ? 'queue' : 'link',
        name: truncate(entry.name.trim(), 100),
        url: entry.url || null,
        source: entry.source || (isQueueSnapshot ? 'custom' : 'spotify'),
        count: isQueueSnapshot ? entry.songs.length : (Number(entry.count) || 0),
        thumbnail: entry.thumbnail || null,
        songs: isQueueSnapshot ? entry.songs : undefined,
        pinned: existingIdx >= 0 ? Boolean(list[existingIdx].pinned) : false,
        savedAt: existingIdx >= 0 ? (list[existingIdx].savedAt || now) : now,
        lastPlayedAt: now,
    };

    if (existingIdx >= 0) {
        list[existingIdx] = clean;
    } else {
        list.unshift(clean);
        if (list.length > MAX_PLAYLISTS) {
            // Keep pinned playlists if trimming
            const unpinnedIdx = [...list].reverse().findIndex((item) => !item.pinned);
            if (unpinnedIdx >= 0) list.splice(list.length - 1 - unpinnedIdx, 1);
            else list.pop();
        }
    }

    const sorted = sortPlaylists(list);
    await playlists().set(id, { items: sorted });
    return sorted;
}

async function removePlaylist(userId, position) {
    const id = String(userId);
    const list = [...getPlaylists(id)];
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
        return { removed: null, list };
    }
    const [removed] = list.splice(index, 1);
    await playlists().set(id, { items: list });
    return { removed, list };
}

async function togglePinPlaylist(userId, position) {
    const id = String(userId);
    const list = [...getPlaylists(id)];
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
        return { item: null, list };
    }
    list[index] = { ...list[index], pinned: !list[index].pinned };
    const sorted = sortPlaylists(list);
    await playlists().set(id, { items: sorted });
    return { item: list[index], list: sorted };
}

// ─── Recently Played History (`f!history`) ──────────────────────────────

function getHistory(userId) {
    if (!userId) return [];
    const list = history().get(String(userId))?.songs;
    return Array.isArray(list) ? list : [];
}

async function addHistory(userId, songData) {
    if (!userId || !songData?.url) return null;
    const id = String(userId);
    const list = getHistory(id).filter((item) => item.url !== songData.url);
    list.unshift({
        name: truncate(songData.name || 'Untitled', 150),
        url: songData.url,
        duration: Number(songData.duration) || 0,
        isLive: Boolean(songData.isLive),
        uploader: songData.uploader?.name || null,
        playedAt: Date.now(),
    });
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    await history().set(id, { songs: list });
    return list;
}

// ─── Listening Stats (`TOP SERVERS`, `TOP FRIENDS`, `TOP TRACKS`) ──────

function getRawStats(userId) {
    if (!userId) return null;
    return stats().get(String(userId)) || {
        totalSeconds: 0,
        totalPlays: 0,
        servers: {},
        friends: {},
        tracks: {},
    };
}

async function recordListeningTick(guild, song, elapsedSec = 20) {
    if (!guild || !song?.name || elapsedSec <= 0) return;
    const botChannelId = guild.members?.me?.voice?.channelId;
    if (!botChannelId) return;

    const humans = [];
    for (const vs of guild.voiceStates?.cache?.values?.() || []) {
        if (vs.channelId !== botChannelId) continue;
        if (vs.id === guild.client?.user?.id || vs.member?.user?.bot) continue;
        const username = vs.member?.user?.username || vs.member?.displayName || `User ${vs.id.slice(-4)}`;
        humans.push({ id: String(vs.id), name: username });
    }
    if (!humans.length) return;

    const trackKey = song.url || song.name;
    const trackName = truncate(song.name, 120);
    const guildName = truncate(guild.name || 'Discord Server', 80);

    await Promise.all(humans.map(async (listener) => {
        const data = getRawStats(listener.id);
        const servers = { ...(data.servers || {}) };
        const friends = { ...(data.friends || {}) };
        const tracks = { ...(data.tracks || {}) };

        const prevSrv = servers[guild.id] || { name: guildName, seconds: 0 };
        servers[guild.id] = { name: guildName, seconds: (prevSrv.seconds || 0) + elapsedSec };

        const prevTrk = tracks[trackKey] || { name: trackName, url: song.url || null, seconds: 0 };
        tracks[trackKey] = { name: trackName, url: song.url || null, seconds: (prevTrk.seconds || 0) + elapsedSec };

        for (const other of humans) {
            if (other.id === listener.id) continue;
            const prevFr = friends[other.id] || { name: other.name, seconds: 0 };
            friends[other.id] = { name: other.name, seconds: (prevFr.seconds || 0) + elapsedSec };
        }

        // Keep maps bounded to top 50 entries so JSON stays tiny
        const trimMap = (map, max = 50) => {
            const entries = Object.entries(map);
            if (entries.length <= max) return map;
            entries.sort((a, b) => (b[1].seconds || 0) - (a[1].seconds || 0));
            return Object.fromEntries(entries.slice(0, max));
        };

        await stats().set(listener.id, {
            totalSeconds: (data.totalSeconds || 0) + elapsedSec,
            totalPlays: data.totalPlays || 0,
            servers: trimMap(servers),
            friends: trimMap(friends),
            tracks: trimMap(tracks, 100),
        });
    }));
}

async function incrementPlayCount(userId) {
    if (!userId) return;
    const id = String(userId);
    const data = getRawStats(id);
    await stats().set(id, {
        ...data,
        totalPlays: (data.totalPlays || 0) + 1,
    });
}

function getTopStats(userId) {
    const data = getRawStats(userId);
    const topN = (map, n = 3) => Object.entries(map || {})
        .map(([id, item]) => ({ id, ...item }))
        .sort((a, b) => (b.seconds || 0) - (a.seconds || 0))
        .slice(0, n);

    return {
        totalSeconds: data.totalSeconds || 0,
        totalPlays: data.totalPlays || 0,
        topServers: topN(data.servers, 3),
        topFriends: topN(data.friends, 3),
        topTracks: topN(data.tracks, 3),
    };
}

/**
 * Format seconds in Jockie Music's compact duration style (e.g. "2w 4d", "14h 57m", "3h 36m", "12m").
 */
function formatStatDuration(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const weeks = Math.floor(sec / 604_800);
    const days = Math.floor((sec % 604_800) / 86_400);
    const hours = Math.floor((sec % 86_400) / 3_600);
    const mins = Math.floor((sec % 3_600) / 60);

    if (weeks > 0) return days > 0 ? `${weeks}w ${days}d` : `${weeks}w`;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    if (mins > 0) return `${mins}m`;
    return `${sec}s`;
}

module.exports = {
    MAX_PLAYLISTS,
    MAX_HISTORY,
    MAX_TRUSTED,
    COLOR_PRESETS,
    resolveColorInput,
    getVipPrefs,
    updateVipPrefs,
    resetVipPrefs,
    getTrustedIds,
    addTrustedUser,
    removeTrustedUser,
    getPlaylists,
    savePlaylistEntry,
    removePlaylist,
    togglePinPlaylist,
    getHistory,
    addHistory,
    recordListeningTick,
    incrementPlayCount,
    getTopStats,
    formatStatDuration,
    resetVipStores,
};
