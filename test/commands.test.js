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
    assert.equal(bodies.length, 27);
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
});
