'use strict';

const { command } = require('./_shared');
const { checkVoice, say } = require('../handlers/guards');
const murphy = require('../murphy');

function parseSleepMs(raw) {
    const str = String(raw ?? '').trim().toLowerCase();
    if (!str) return null;
    if (['off', 'cancel', 'stop', 'reset', 'mati', 'batal'].includes(str)) return 0;
    const match = str.match(/^(\d+)\s*(m|min|mins|menit|h|hr|hrs|hour|hours|jam|s|sec|detik)?$/i);
    if (!match) return null;
    const n = Number.parseInt(match[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = (match[2] || 'm').toLowerCase();
    let mult = 60_000;
    if (unit.startsWith('h') || unit === 'jam') mult = 3_600_000;
    else if (unit.startsWith('s') || unit === 'detik') mult = 1000;
    const ms = n * mult;
    if (ms < 10_000 || ms > 12 * 3_600_000) return null;
    return ms;
}

module.exports = {
    category: 'playback',
    data: command('sleep', 'Set a sleep timer to automatically stop music and disconnect (Premium)')
        .addStringOption((option) => option
            .setName('duration')
            .setDescription('Duration (e.g. 30m, 1h, or "off" to cancel)')
            .setRequired(true)
            .setMaxLength(20)),

    async execute(interaction, { t, manager }) {
        const isId = t.lang === 'id';
        if (!murphy.isPremiumUser(interaction.user.id)) {
            return say(interaction, murphy.premiumRequiredMessage(t.lang, 'Sleep Timer (f!sleep)'));
        }

        const check = checkVoice(interaction, manager, t, { requireQueue: false, join: false });
        if (check.error) return say(interaction, check.error);

        const raw = interaction.options.getString('duration', true);
        const ms = parseSleepMs(raw);
        if (ms === null) {
            return say(interaction, isId
                ? 'Durasi tidak valid! Contoh: `f!sleep 30m`, `f!sleep 1h`, atau `f!sleep off` (maks 12 jam).'
                : 'Invalid duration! Example: `f!sleep 30m`, `f!sleep 1h`, or `f!sleep off` (max 12h).');
        }

        if (ms === 0) {
            manager.clearSleepTimer(interaction.guildId);
            return say(interaction, isId ? '🌙 Sleep timer dibatalkan.' : '🌙 Sleep timer cancelled.');
        }

        const endsAt = manager.setSleepTimer(interaction.guildId, ms);
        const ts = Math.floor(endsAt / 1000);
        return say(interaction, isId
            ? `🌙 **Sleep Timer Aktif!** Musik akan berhenti & bot keluar otomatis <t:${ts}:R> (<t:${ts}:t>).`
            : `🌙 **Sleep Timer Set!** Music will stop & bot will disconnect <t:${ts}:R> (<t:${ts}:t>).`, { ephemeral: false });
    },
};
