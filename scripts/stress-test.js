'use strict';

const os = require('node:os');
const { spawn } = require('node:child_process');
const { resolveFfmpeg } = require('../src/music/manager');
const ytdlp = require('../src/music/ytdlp');

function parseArgs(argv) {
    const opts = {
        stages: [3, 6, 10, 13],
        durationSec: 8,
        ytdlpConcurrency: 3,
        skipYtdlp: false,
    };
    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--stages=')) {
            const nums = arg.slice(9).split(',').map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0);
            if (nums.length) opts.stages = nums;
        } else if (arg.startsWith('--duration=')) {
            const sec = Number.parseInt(arg.slice(11), 10);
            if (Number.isInteger(sec) && sec >= 3 && sec <= 60) opts.durationSec = sec;
        } else if (arg.startsWith('--ytdlp=')) {
            const c = Number.parseInt(arg.slice(8), 10);
            if (Number.isInteger(c) && c >= 1 && c <= 10) opts.ytdlpConcurrency = c;
        } else if (arg === '--skip-ytdlp') {
            opts.skipYtdlp = true;
        }
    }
    return opts;
}

function measureJitter(durationMs) {
    return new Promise((resolve) => {
        const jitters = [];
        let expected = performance.now() + 20;
        const endAt = performance.now() + durationMs;
        const tick = () => {
            const now = performance.now();
            const drift = Math.max(0, now - expected);
            jitters.push(drift);
            if (now >= endAt) {
                jitters.sort((a, b) => a - b);
                const p95 = jitters[Math.floor(jitters.length * 0.95)] || 0;
                const max = jitters[jitters.length - 1] || 0;
                const late = jitters.filter((j) => j > 15).length;
                return resolve({
                    samples: jitters.length,
                    p95Ms: Number(p95.toFixed(1)),
                    maxMs: Number(max.toFixed(1)),
                    latePct: Number(((late / Math.max(1, jitters.length)) * 100).toFixed(1)),
                });
            }
            expected = now + 20;
            setTimeout(tick, 20);
        };
        setTimeout(tick, 20);
    });
}

function spawnFfmpegStream(ffmpegPath, durationSec, withFilter) {
    return new Promise((resolve) => {
        const args = [
            '-hide_banner',
            '-loglevel', 'info',
            '-stats_period', '0.5',
            '-re',
            '-f', 'lavfi',
            '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
            '-ac', '2',
            '-ar', '48000',
        ];
        if (withFilter) {
            args.push('-af', 'lowpass=f=3200,asetrate=44100*0.95,aresample=44100');
        }
        args.push('-c:a', 'libopus', '-b:a', '96k', '-f', 'null', '-');

        const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let lastSpeed = null;
        let errText = '';
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
            errText += chunk;
            const matches = [...chunk.matchAll(/speed=\s*([\d.]+)x/g)];
            if (matches.length) {
                lastSpeed = Number.parseFloat(matches[matches.length - 1][1]);
            }
        });
        child.on('error', (error) => resolve({ ok: false, speed: 0, error: error.message }));
        child.on('close', (code) => {
            resolve({
                ok: code === 0,
                speed: Number.isFinite(lastSpeed) ? lastSpeed : (code === 0 ? 1.0 : 0),
                error: code === 0 ? null : errText.trim().split(/\r?\n/).pop(),
            });
        });
    });
}

async function runFfmpegStage(ffmpegPath, count, durationSec) {
    const startWall = performance.now();
    const jitterPromise = measureJitter(durationSec * 1000);
    const streams = Array.from({ length: count }, (_, idx) => spawnFfmpegStream(ffmpegPath, durationSec, idx % 3 === 0));
    const [results, jitter] = await Promise.all([Promise.all(streams), jitterPromise]);
    const elapsedSec = (performance.now() - startWall) / 1000;

    const okCount = results.filter((r) => r.ok).length;
    const speeds = results.filter((r) => r.ok && r.speed > 0).map((r) => r.speed);
    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const minSpeed = speeds.length ? Math.min(...speeds) : 0;
    const load1 = os.loadavg()[0];
    const freeMb = Math.round(os.freemem() / 1024 / 1024);

    let verdict = 'AMAN';
    if (okCount < count || minSpeed < 0.9 || jitter.p95Ms >= 20 || elapsedSec > durationSec + 3) {
        verdict = 'OVERLOAD (kresek)';
    } else if (minSpeed < 0.98 || jitter.p95Ms >= 10 || elapsedSec > durationSec + 1.5) {
        verdict = 'WASPADA';
    }

    const firstError = results.find((r) => !r.ok)?.error || null;
    return {
        count,
        okCount,
        firstError,
        elapsedSec: Number(elapsedSec.toFixed(1)),
        avgSpeed: Number(avgSpeed.toFixed(2)),
        minSpeed: Number(minSpeed.toFixed(2)),
        jitter,
        load1: Number(load1.toFixed(2)),
        freeMb,
        verdict,
    };
}

async function runYtdlpStress(concurrency) {
    const queries = [
        'ytsearch1:lofi hip hop radio',
        'ytsearch1:radiohead let down',
        'ytsearch1:hindia evaluasi',
        'ytsearch1:nadin amizah bertaut',
        'ytsearch1:coldplay yellow',
    ];
    const jitterPromise = measureJitter(4000);
    const tasks = Array.from({ length: concurrency }, async (_, idx) => {
        const started = performance.now();
        try {
            const res = await ytdlp.runJson(queries[idx % queries.length], ['--flat-playlist']);
            return { ok: Boolean(res), ms: Math.round(performance.now() - started) };
        } catch (error) {
            return { ok: false, ms: Math.round(performance.now() - started), error: error.message };
        }
    });
    const [results, jitter] = await Promise.all([Promise.all(tasks), jitterPromise]);
    const okCount = results.filter((r) => r.ok).length;
    const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
    const maxMs = Math.max(...results.map((r) => r.ms));
    return { concurrency, okCount, avgMs, maxMs, jitter };
}

async function main() {
    const opts = parseArgs(process.argv);
    const ffmpegPath = resolveFfmpeg();
    const cpus = os.cpus().length;
    const totalMb = Math.round(os.totalmem() / 1024 / 1024);
    const freeMb = Math.round(os.freemem() / 1024 / 1024);

    console.log('=== Murphy Music VPS Stress Test ===');
    console.log(`Host      : ${os.platform()} ${os.arch()} | ${cpus} vCPU | RAM ${freeMb}MB free / ${totalMb}MB total`);
    console.log(`FFmpeg    : ${ffmpegPath}`);
    console.log(`yt-dlp    : ${ytdlp.binary}`);
    console.log(`Stages    : ${opts.stages.join(', ')} concurrent Opus streams (${opts.durationSec}s each, 33% with DSP filter)\n`);

    const stageResults = [];
    for (const count of opts.stages) {
        process.stdout.write(`Running ${count} concurrent FFmpeg streams... `);
        const res = await runFfmpegStage(ffmpegPath, count, opts.durationSec);
        stageResults.push(res);
        console.log(`${res.verdict} (${res.okCount}/${res.count} ok) | speed min=${res.minSpeed}x avg=${res.avgSpeed}x | jitter p95=${res.jitter.p95Ms}ms max=${res.jitter.maxMs}ms | load=${res.load1} | free=${res.freeMb}MB`);
        if (res.firstError) console.log(`  error: ${res.firstError}`);
    }

    if (!opts.skipYtdlp) {
        console.log(`\nRunning ${opts.ytdlpConcurrency} concurrent yt-dlp searches...`);
        const yt = await runYtdlpStress(opts.ytdlpConcurrency);
        console.log(`yt-dlp    : ${yt.okCount}/${yt.concurrency} OK | avg=${yt.avgMs}ms max=${yt.maxMs}ms | jitter p95=${yt.jitter.p95Ms}ms max=${yt.jitter.maxMs}ms`);
    }

    const safeStages = stageResults.filter((s) => s.verdict === 'AMAN').map((s) => s.count);
    const maxSafe = safeStages.length ? Math.max(...safeStages) : 0;
    console.log('\n=== Ringkasan Kapasitas ===');
    if (maxSafe > 0) {
        console.log(`Aman untuk maksimal ${maxSafe} bot memutar lagu secara bersamaan (audio bersih).`);
    } else {
        console.log('Semua stage mengalami beban berat/overload — cek htop, swap, atau kurangi bot aktif bersamaan.');
    }
}

main().catch((error) => {
    console.error('Stress test failed:', error);
    process.exit(1);
});
