'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { ShardingManager, RESTJSONErrorCodes } = require('discord.js');
const config = require('../config');
const logger = require('../core/logger');
const { deployCommands } = require('../deploy');
const preflight = require('./preflight');
const { StreamRelay } = require('../music/relay');

const log = logger.createLogger('manager');
logger.setDebug(config.debug);

function decodeClientIdFromToken(token) {
    try {
        const firstPart = String(token || '').trim().split('.')[0];
        const decoded = Buffer.from(firstPart, 'base64').toString('utf8').trim();
        return /^\d{15,22}$/.test(decoded) ? decoded : '';
    } catch {
        return '';
    }
}

function collectExtraBotConfigs() {
    const extras = [];
    for (let i = 2; i <= 10; i++) {
        const token = (process.env[`DISCORD_TOKEN_${i}`] || '').trim();
        if (!token) continue;
        const clientId = (process.env[`CLIENT_ID_${i}`] || '').trim() || decodeClientIdFromToken(token);
        const status = (process.env[`STATUS_${i}`] || '').trim() || config.bot.status;
        extras.push({
            index: i,
            token,
            clientId,
            status,
            priority: String(i),
            dataDir: path.join('data', `bot${i}`),
        });
    }
    return extras;
}

function spawnExtraBots(extras, isStopping) {
    const children = new Map();
    const botScript = path.join(__dirname, '..', 'bot.js');

    const launch = (botCfg) => {
        if (isStopping()) return;
        log.info(`Launching Murphy #${botCfg.index} (priority ${botCfg.priority})`);
        const child = fork(botScript, [], {
            env: {
                ...process.env,
                DISCORD_TOKEN: botCfg.token,
                CLIENT_ID: botCfg.clientId,
                BOT_PRIORITY: botCfg.priority,
                DATA_DIR: botCfg.dataDir,
                STATUS: botCfg.status,
                MURPHY_EXTRA_BOT: '1',
            },
            stdio: 'inherit',
        });
        children.set(botCfg.index, child);
        child.on('exit', (code) => {
            children.delete(botCfg.index);
            if (!isStopping()) {
                log.warn(`Murphy #${botCfg.index} exited (code ${code ?? 'unknown'}), restarting in 5s...`);
                setTimeout(() => launch(botCfg), 5000).unref();
            }
        });
    };

    for (const botCfg of extras) {
        launch(botCfg);
    }
    return children;
}

/**
 * v16 and older downloaded every song into audio_cache/. Nothing uses it any more, so free the disk space.
 */
function removeLegacyCache() {
    const dir = path.join(config.root, 'audio_cache');
    if (!fs.existsSync(dir)) return;
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info('Removed the old audio_cache folder (no longer used).');
    } catch (error) {
        log.warn('Could not remove the old audio_cache folder:', error.message);
    }
}

/**
 * Entry point. The bot always runs under the ShardingManager: small bots get one shard,
 * large bots get as many as Discord recommends, and crashed shards restart automatically.
 */
async function main() {
    removeLegacyCache();
    StreamRelay.cleanAll();
    // Checks the configuration, downloads yt-dlp/ffmpeg when needed and stops with
    // instructions when something must be fixed by hand.
    await preflight.run();

    try {
        await deployCommands();
    } catch (error) {
        if (error.code === RESTJSONErrorCodes.MissingAccess || error.code === RESTJSONErrorCodes.UnknownGuild) {
            log.error(`Slash commands could not be registered in GUILD_ID ${config.discord.guildId}: the bot is not in that server. Invite it there or leave GUILD_ID empty.`);
        } else {
            log.error('Slash command registration failed:', error.message);
        }
    }

    const manager = new ShardingManager(path.join(__dirname, '..', 'bot.js'), {
        token: config.discord.token,
        totalShards: config.sharding.totalShards,
        shardList: config.sharding.shardList,
        mode: config.sharding.mode,
        respawn: config.sharding.respawn,
        execArgv: process.execArgv,
    });

    manager.on('shardCreate', (shard) => {
        log.info(`Launching shard ${shard.id}`);
        shard.on('death', (child) => log.warn(`Shard ${shard.id} exited (code ${child.exitCode ?? 'unknown'})${manager.respawn ? ', restarting' : ''}`));
        shard.on('error', (error) => log.error(`Shard ${shard.id} error:`, error));
    });

    let stopping = false;
    let extraChildren = new Map();
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        manager.respawn = false;
        log.info('Stopping all shards...');
        for (const child of extraChildren.values()) {
            try {
                child.disconnect?.();
            } catch {
                // ignore
            }
        }
        await Promise.race([
            manager.broadcastEval((client) => client.shutdown?.()).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]);
        for (const shard of manager.shards.values()) shard.kill();
        for (const child of extraChildren.values()) child.kill();
        process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    await manager.spawn({
        amount: config.sharding.totalShards,
        delay: config.sharding.spawnDelay,
        timeout: config.sharding.spawnTimeout,
    });
    log.ok(`${manager.shards.size} shard(s) running`);

    if (!process.env.MURPHY_PM2_CLUSTER) {
        const extras = collectExtraBotConfigs();
        if (extras.length > 0) {
            extraChildren = spawnExtraBots(extras, () => stopping);
            log.ok(`Multi-bot cluster active: Murphy #1 + ${extras.length} additional bot(s)`);
        }
    }
}

module.exports = {
    main: () => main().catch((error) => {
        log.error('Failed to start:', error);
        process.exit(1);
    }),
};
