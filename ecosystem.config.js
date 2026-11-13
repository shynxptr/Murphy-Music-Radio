'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

// Always reload the latest .env values when PM2 reads ecosystem.config.js
const parsed = dotenv.config({ path: path.join(__dirname, '.env'), override: true }).parsed || {};
const env = (key, fallback = '') => (parsed[key] ?? process.env[key] ?? fallback).trim();

function decodeClientId(token) {
    try {
        const first = String(token || '').trim().split('.')[0];
        const decoded = Buffer.from(first, 'base64').toString('utf8').trim();
        return /^\d{15,22}$/.test(decoded) ? decoded : '';
    } catch {
        return '';
    }
}

const defaultStatus = env('STATUS', 'Serving Murphy · Together Around the World');
const premiumStart = Math.max(2, Number.parseInt(env('PREMIUM_START', '6'), 10) || 6);
const apps = [];

const token1 = env('DISCORD_TOKEN');
if (token1) {
    apps.push({
        name: 'murphy-1',
        script: 'index.js',
        cwd: __dirname,
        env: {
            DISCORD_TOKEN: token1,
            CLIENT_ID: env('CLIENT_ID') || decodeClientId(token1),
            BOT_PRIORITY: '1',
            BOT_TIER: env('BOT_TIER_1') || 'free',
            DATA_DIR: 'data/bot1',
            STATUS: env('STATUS_1') || defaultStatus,
            MURPHY_PM2_CLUSTER: '1',
        },
    });
}

for (let i = 2; i <= 20; i++) {
    const token = env(`DISCORD_TOKEN_${i}`);
    if (!token) continue;
    const tier = env(`BOT_TIER_${i}`) || (i >= premiumStart ? 'premium' : 'free');
    apps.push({
        name: `murphy-${i}`,
        script: 'index.js',
        cwd: __dirname,
        env: {
            DISCORD_TOKEN: token,
            CLIENT_ID: env(`CLIENT_ID_${i}`) || decodeClientId(token),
            BOT_PRIORITY: String(i),
            BOT_TIER: tier,
            DATA_DIR: `data/bot${i}`,
            STATUS: env(`STATUS_${i}`) || (tier === 'premium' ? `Murphy VIP #${i} · Together Around the World` : defaultStatus),
            MURPHY_PM2_CLUSTER: '1',
        },
    });
}

module.exports = { apps };

