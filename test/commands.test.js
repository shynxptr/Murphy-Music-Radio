'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Locale, InteractionContextType } = require('discord.js');
const { loadCommands } = require('../src/commands');
const { commandBodies } = require('../src/deploy');

const locales = new Set(Object.values(Locale));

test('all commands serialize and respect Discord limits', () => {
    const bodies = commandBodies();
    assert.equal(bodies.length, 39);
    const names = new Set();
    for (const body of bodies) {
        assert.match(body.name, /^[a-z0-9_-]{1,32}$/);
        assert.ok(!names.has(body.name));
        names.add(body.name);
        assert.ok(body.description.length >= 1 && body.description.length <= 100, body.name);
        assert.deepEqual(body.contexts, [InteractionContextType.Guild]);
        for (const [locale, text] of Object.entries(body.description_localizations || {})) {
            assert.ok(locales.has(locale), `${body.name}: bad locale ${locale}`);
            assert.ok(text.length <= 100);
        }
        for (const option of body.options || []) {
            assert.ok(option.description.length <= 100);
            for (const [locale] of Object.entries(option.description_localizations || {})) assert.ok(locales.has(locale));
        }
    }
    assert.ok(JSON.stringify(bodies).length < 8000 * bodies.length);
});

test('every command has a category and execute handler; play has autocomplete', () => {
    for (const command of loadCommands().values()) {
        assert.ok(['playback', 'queue', 'settings'].includes(command.category), command.data.name);
        assert.equal(typeof command.execute, 'function');
    }
    assert.equal(typeof loadCommands().get('play').autocomplete, 'function');
});

test('language command requires Manage Server by default', () => {
    const body = commandBodies().find((b) => b.name === 'language');
    assert.equal(body.default_member_permissions, String(1n << 5n));
});

test('custom prefix parser handles server default (f!), personal plain prefix (d), and ignores normal chat', async () => {
    const {
        parsePrefixCommand,
        getServerPrefix,
        setServerPrefix,
        getUserPrefix,
        setUserPrefix,
        resetStores,
    } = require('../src/handlers/prefix');
    resetStores();

    assert.equal(getServerPrefix('100'), 'f!');
    assert.equal(getUserPrefix('200'), null);

    // Default server prefix f!
    assert.deepEqual(parsePrefixCommand('f!p Hindia Evaluasi'), {
        prefix: 'f!',
        commandName: 'play',
        alias: 'p',
        rawArgs: 'Hindia Evaluasi',
    });
    assert.deepEqual(parsePrefixCommand('f!play Hindia'), {
        prefix: 'f!',
        commandName: 'play',
        alias: 'play',
        rawArgs: 'Hindia',
    });
    assert.deepEqual(parsePrefixCommand('f!s'), {
        prefix: 'f!',
        commandName: 'skip',
        alias: 's',
        rawArgs: '',
    });

    // Member sets personal prefix "d" (no "!")
    await setUserPrefix('200', 'd');
    assert.equal(getUserPrefix('200'), 'd');

    assert.deepEqual(parsePrefixCommand('dp Hindia Evaluasi', { userPrefix: 'd', serverPrefix: 'f!' }), {
        prefix: 'd',
        commandName: 'play',
        alias: 'p',
        rawArgs: 'Hindia Evaluasi',
    });
    assert.deepEqual(parsePrefixCommand('dplay Hindia Evaluasi', { userPrefix: 'd', serverPrefix: 'f!' }), {
        prefix: 'd',
        commandName: 'play',
        alias: 'play',
        rawArgs: 'Hindia Evaluasi',
    });
    assert.deepEqual(parsePrefixCommand('ds', { userPrefix: 'd', serverPrefix: 'f!' }), {
        prefix: 'd',
        commandName: 'skip',
        alias: 's',
        rawArgs: '',
    });
    assert.deepEqual(parsePrefixCommand('dq', { userPrefix: 'd', serverPrefix: 'f!' }), {
        prefix: 'd',
        commandName: 'queue',
        alias: 'q',
        rawArgs: '',
    });

    // Normal Indonesian chat starting with "d" is never mistaken for a command
    assert.equal(parsePrefixCommand('dan aku lagi makan', { userPrefix: 'd', serverPrefix: 'f!' }), null);
    assert.equal(parsePrefixCommand('dia belum datang', { userPrefix: 'd', serverPrefix: 'f!' }), null);
    assert.equal(parsePrefixCommand('d rumah aja', { userPrefix: 'd', serverPrefix: 'f!' }), null);
    assert.equal(parsePrefixCommand('ds lagi makan siang', { userPrefix: 'd', serverPrefix: 'f!' }), null);
    assert.equal(parsePrefixCommand('dp', { userPrefix: 'd', serverPrefix: 'f!' }), null);

    // Server prefix can still be used alongside personal prefix
    assert.deepEqual(parsePrefixCommand('f!p Lagu Baru', { userPrefix: 'd', serverPrefix: 'f!' }), {
        prefix: 'f!',
        commandName: 'play',
        alias: 'p',
        rawArgs: 'Lagu Baru',
    });

    // Server custom prefix persistence and reset
    await setServerPrefix('100', 'm!');
    assert.equal(getServerPrefix('100'), 'm!');
    await setServerPrefix('100', null);
    assert.equal(getServerPrefix('100'), 'f!');
    await setUserPrefix('200', null);
    assert.equal(getUserPrefix('200'), null);
});

test('Murphy Music branding, 24/7 AFK mode, and custom voice channel status', async () => {
    const murphy = require('../src/murphy');
    murphy.resetMurphyStores();

    // Default voice channel status is "Listening to <song title>"
    assert.equal(murphy.formatVoiceStatus('500', { name: 'Hindia - Evaluasi' }), 'Listening to Hindia - Evaluasi');
    assert.equal(murphy.formatVoiceStatus('500', null), '');

    // Custom voice channel status template (with and without {song})
    await murphy.setVoiceTemplate('500', 'Vibes: {song} · Murphy');
    assert.equal(murphy.formatVoiceStatus('500', { name: 'Hindia - Evaluasi' }), 'Vibes: Hindia - Evaluasi · Murphy');
    await murphy.setVoiceTemplate('500', 'Nongkrong Bareng Murphy');
    assert.equal(murphy.formatVoiceStatus('500', null), 'Nongkrong Bareng Murphy');
    await murphy.setVoiceTemplate('500', null);
    assert.equal(murphy.formatVoiceStatus('500', { name: 'Lagu' }), 'Listening to Lagu');

    // 24/7 AFK mode state
    assert.equal(murphy.isAfk('500'), false);
    await murphy.setAfk('500', { enabled: true, voiceChannelId: '777', textChannelId: '888' });
    assert.equal(murphy.isAfk('500'), true);
    assert.equal(murphy.formatVoiceStatus('500', null), 'Murphy Music · 24/7');
    await murphy.setAfk('500', { enabled: false });
    assert.equal(murphy.isAfk('500'), false);

    // Member favorite songs (add, deduplicate, remove, clear)
    assert.deepEqual(murphy.getFavorites('user1'), []);
    const first = await murphy.addFavorite('user1', {
        name: 'Hindia - Evaluasi',
        url: 'https://www.youtube.com/watch?v=11111111111',
        duration: 210,
    });
    assert.equal(first.added, true);
    assert.equal(first.position, 1);

    const dup = await murphy.addFavorite('user1', {
        name: 'Hindia - Evaluasi',
        url: 'https://www.youtube.com/watch?v=11111111111',
        duration: 210,
    });
    assert.equal(dup.added, false);
    assert.equal(dup.reason, 'duplicate');

    await murphy.addFavorite('user1', {
        name: 'Feast - Peradaban',
        url: 'https://www.youtube.com/watch?v=22222222222',
        duration: 240,
    });
    assert.equal(murphy.getFavorites('user1').length, 2);

    const removed = await murphy.removeFavorite('user1', 1);
    assert.equal(removed.removed.name, 'Hindia - Evaluasi');
    assert.equal(murphy.getFavorites('user1').length, 1);

    await murphy.clearFavorites('user1');
    assert.deepEqual(murphy.getFavorites('user1'), []);

    // Session Owner (1 Bot = 1 Owner = 1 Voice) & Allow system
    assert.equal(murphy.getSession('500'), null);
    assert.equal(murphy.isSessionAuthorized('500', 'userA'), true);

    await murphy.claimSession('500', 'userA', 'vc1');
    assert.equal(murphy.isSessionOwner('500', 'userA'), true);
    assert.equal(murphy.isSessionOwner('500', 'userB'), false);
    assert.equal(murphy.isSessionAuthorized('500', 'userA'), true);
    assert.equal(murphy.isSessionAuthorized('500', 'userB'), false);

    // Allow & Disallow userB
    const allowRes = await murphy.allowSessionUser('500', 'userB');
    assert.equal(allowRes.ok, true);
    assert.equal(murphy.isSessionAuthorized('500', 'userB'), true);

    const dupAllow = await murphy.allowSessionUser('500', 'userB');
    assert.equal(dupAllow.ok, false);
    assert.equal(dupAllow.reason, 'already_allowed');

    const disallowRes = await murphy.disallowSessionUser('500', 'userB');
    assert.equal(disallowRes.ok, true);
    assert.equal(murphy.isSessionAuthorized('500', 'userB'), false);

    // Transfer Session Owner to userC (previous owner userA remains in allowedIds)
    const transferRes = await murphy.transferSessionOwner('500', 'userC');
    assert.equal(transferRes.ok, true);
    assert.equal(murphy.isSessionOwner('500', 'userC'), true);
    assert.equal(murphy.isSessionAuthorized('500', 'userC'), true);
    assert.equal(murphy.isSessionAuthorized('500', 'userA'), true);

    await murphy.clearSession('500');
    assert.equal(murphy.getSession('500'), null);
});

test('Multi-bot cluster routing assigns 1 idle bot per voice channel and 1 bot per owner', async () => {
    const murphy = require('../src/murphy');
    const { parsePrefixCommand } = require('../src/handlers/prefix');
    murphy.resetMurphyStores();

    // Register Murphy 1 (idle) and Murphy 2 (idle) in guild 900
    const makeFakeClient = (botId, priority, guildStates = {}) => ({
        user: { id: botId, tag: `Murphy#${priority}` },
        guilds: {
            cache: new Map([
                ['900', {
                    id: '900',
                    members: { me: { voice: { channelId: guildStates.channelId || null } } },
                }],
            ]),
        },
        music: { getQueue: () => null },
    });

    await murphy.syncClusterState(makeFakeClient('bot1', 1));
    await murphy.syncClusterState(makeFakeClient('bot2', 2));

    const makeMsg = (botId, userId, voiceChannelId, content) => ({
        content,
        author: { id: userId, bot: false },
        member: { id: userId, voice: { channelId: voiceChannelId } },
        client: { user: { id: botId } },
        guild: {
            id: '900',
            client: { user: { id: botId } },
            members: { cache: new Map([['bot1', {}], ['bot2', {}]]) },
            voiceStates: { cache: new Map() },
        },
    });

    const parsedPlay = parsePrefixCommand('f!p Hindia');

    // Both bots idle -> User 1 in VC 1 triggers ONLY bot1 (priority 1), bot2 stays silent
    assert.equal(murphy.routePrefixCommand(makeMsg('bot1', 'u1', 'vc1', 'f!p Hindia'), parsedPlay).shouldHandle, true);
    assert.equal(murphy.routePrefixCommand(makeMsg('bot2', 'u1', 'vc1', 'f!p Hindia'), parsedPlay).shouldHandle, false);

    // Now bot1 is active in vc1 owned by u1
    await murphy.claimSession('900', 'u1', 'vc1', makeFakeClient('bot1', 1, { channelId: 'vc1' }));

    // User 2 in VC 2 runs f!p Hindia -> bot1 is busy in vc1, so ONLY bot2 responds!
    assert.equal(murphy.routePrefixCommand(makeMsg('bot1', 'u2', 'vc2', 'f!p Hindia'), parsedPlay).shouldHandle, false);
    assert.equal(murphy.routePrefixCommand(makeMsg('bot2', 'u2', 'vc2', 'f!p Hindia'), parsedPlay).shouldHandle, true);

    // User 1 (who already owns bot1 in vc1) tries to call f!p from vc3 -> routed back to bot1 (cannot claim bot2!)
    assert.equal(murphy.routePrefixCommand(makeMsg('bot1', 'u1', 'vc3', 'f!p Hindia'), parsedPlay).shouldHandle, true);
    assert.equal(murphy.routePrefixCommand(makeMsg('bot2', 'u1', 'vc3', 'f!p Hindia'), parsedPlay).shouldHandle, false);

    // Partial members cache (real Discord without GuildMembers intent): each bot only caches itself + author
    await murphy.clearSession('900', makeFakeClient('bot1', 1));
    await murphy.syncClusterState(makeFakeClient('bot1', 1));
    await murphy.syncClusterState(makeFakeClient('bot2', 2));
    const makePartialMsg = (botId, userId, voiceChannelId) => ({
        content: 'f!p Hindia',
        author: { id: userId, bot: false },
        member: { id: userId, voice: { channelId: voiceChannelId } },
        client: { user: { id: botId } },
        guild: {
            id: '900',
            client: { user: { id: botId } },
            members: { cache: new Map([[botId, {}], [userId, {}]]) },
            voiceStates: { cache: new Map() },
        },
    });
    assert.equal(murphy.routePrefixCommand(makePartialMsg('bot1', 'u1', 'vc1'), parsedPlay).shouldHandle, true);
    assert.equal(murphy.routePrefixCommand(makePartialMsg('bot2', 'u1', 'vc1'), parsedPlay).shouldHandle, false);
});

test('Murphy Premium licenses, vouchers, limits, and free (#1-5) vs VIP (#6-20) routing', async () => {
    const murphy = require('../src/murphy');
    const config = require('../src/config');
    const { parsePrefixCommand } = require('../src/handlers/prefix');
    murphy.resetMurphyStores();

    // Free user limits
    assert.equal(murphy.isPremiumUser('freeUser'), false);
    assert.deepEqual(murphy.getUserLimits('freeUser'), murphy.FREE_LIMITS);

    // Grant Premium via voucher
    const [voucher] = await murphy.generateVouchers('30d', 1, { createdBy: 'owner1' });
    assert.match(voucher.code, /^MURPHY-[A-F0-9]{4}-[A-F0-9]{4}$/);

    const redeemed = await murphy.redeemVoucher(voucher.code, 'vipUser');
    assert.equal(redeemed.ok, true);
    assert.equal(murphy.isPremiumUser('vipUser'), true);
    assert.deepEqual(murphy.getUserLimits('vipUser'), murphy.PREMIUM_LIMITS);

    // Reusing the same voucher fails
    const reuse = await murphy.redeemVoucher(voucher.code, 'otherUser');
    assert.equal(reuse.ok, false);
    assert.equal(reuse.reason, 'already_used');

    // Tier-aware cluster routing: free bot1 (priority 1, tier free) and vip bot6 (priority 6, tier premium)
    const prevPriority = config.bot.priority;
    const prevTier = config.bot.tier;
    const makeClient = (botId, priority, tier) => {
        config.bot.priority = priority;
        config.bot.tier = tier;
        return {
            user: { id: botId, tag: `Murphy#${priority}` },
            guilds: { cache: new Map([['901', { id: '901', members: { me: { voice: { channelId: null } } } }]]) },
            music: { getQueue: () => null },
        };
    };

    await murphy.syncClusterState(makeClient('botFree1', 1, 'free'));
    await murphy.syncClusterState(makeClient('botVip6', 6, 'premium'));
    config.bot.priority = prevPriority;
    config.bot.tier = prevTier;

    const makeMsg = (botId, userId, voiceChannelId) => ({
        content: 'f!p Hindia',
        author: { id: userId, bot: false },
        member: { id: userId, voice: { channelId: voiceChannelId } },
        client: { user: { id: botId } },
        guild: {
            id: '901',
            client: { user: { id: botId } },
            members: { cache: new Map([['botFree1', {}], ['botVip6', {}]]) },
            voiceStates: { cache: new Map() },
        },
    });
    const parsedPlay = parsePrefixCommand('f!p Hindia');

    // VIP user gets routed directly to VIP bot #6 even though Free bot #1 is also idle
    assert.equal(murphy.routePrefixCommand(makeMsg('botFree1', 'vipUser', 'vc10'), parsedPlay).shouldHandle, false);
    assert.equal(murphy.routePrefixCommand(makeMsg('botVip6', 'vipUser', 'vc10'), parsedPlay).shouldHandle, true);

    // Free user gets routed only to Free bot #1
    assert.equal(murphy.routePrefixCommand(makeMsg('botFree1', 'freeUser', 'vc11'), parsedPlay).shouldHandle, true);
    assert.equal(murphy.routePrefixCommand(makeMsg('botVip6', 'freeUser', 'vc11'), parsedPlay).shouldHandle, false);

    // Revoke premium works
    assert.equal(await murphy.revokePremium('vipUser'), true);
    assert.equal(murphy.isPremiumUser('vipUser'), false);
});

test('VIP features: Spotify library auto-save, history, stats, trusted squad, and Jockie-style Canvas card', async () => {
    const vip = require('../src/murphy_vip');
    const { renderProfileCard } = require('../src/ui/card');
    vip.resetVipStores();

    // Auto-save Spotify playlist & pin
    await vip.savePlaylistEntry('u1', {
        type: 'link',
        name: 'Nongkrong Malam',
        url: 'https://open.spotify.com/playlist/abc',
        source: 'spotify',
        count: 42,
    });
    await vip.savePlaylistEntry('u1', {
        type: 'queue',
        name: 'Mabar Mix',
        source: 'custom',
        count: 2,
        songs: [{ name: 'Track A', url: 'https://youtube.com/watch?v=1' }, { name: 'Track B', url: 'https://youtube.com/watch?v=2' }],
    });
    assert.equal(vip.getPlaylists('u1').length, 2);
    await vip.togglePinPlaylist('u1', 2);
    assert.equal(vip.getPlaylists('u1')[0].pinned, true);

    // History
    await vip.addHistory('u1', { name: 'Tarot', url: 'https://youtube.com/watch?v=tarot', duration: 210 });
    assert.equal(vip.getHistory('u1').length, 1);

    // Trusted squad
    const trustRes = await vip.addTrustedUser('u1', 'u2');
    assert.equal(trustRes.ok, true);
    assert.deepEqual(vip.getTrustedIds('u1'), ['u2']);

    // Listening stats tick (Top Servers, Top Friends, Top Tracks)
    const fakeGuild = {
        id: 'g1',
        name: 'BRATVA || NO CIRCLE!!',
        client: { user: { id: 'bot1' } },
        members: { me: { voice: { channelId: 'vc1' } } },
        voiceStates: {
            cache: new Map([
                ['u1', { id: 'u1', channelId: 'vc1', member: { user: { username: 'zoelian_ptr', bot: false } } }],
                ['u2', { id: 'u2', channelId: 'vc1', member: { user: { username: 'zannn._07', bot: false } } }],
            ]),
        },
    };
    await vip.recordListeningTick(fakeGuild, { name: 'Tarot', url: 'https://youtube.com/watch?v=tarot' }, 12960);
    const top = vip.getTopStats('u1');
    assert.equal(top.topServers[0].name, 'BRATVA || NO CIRCLE!!');
    assert.equal(top.topFriends[0].name, 'zannn._07');
    assert.equal(top.topTracks[0].name, 'Tarot');
    assert.equal(vip.formatStatDuration(12960), '3h 36m');

    // Render PNG profile card
    const png = await renderProfileCard({
        username: 'zoelian_ptr',
        avatarUrl: null,
        accentColor: '#0EA5E9',
        radioName: 'MURPHY MUSIC',
        isPremium: true,
        stats: top,
        lang: 'id',
    });
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.length > 5000);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
