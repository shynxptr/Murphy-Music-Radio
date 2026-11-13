'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { formatStatDuration } = require('../murphy_vip');

const CARD_WIDTH = 920;
const CARD_HEIGHT = 540;
const FONT_FAMILY = 'sans-serif';

function hexToRgb(hex) {
    const clean = String(hex || '#0EA5E9').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(clean)) return { r: 14, g: 165, b: 233 };
    return {
        r: Number.parseInt(clean.slice(0, 2), 16),
        g: Number.parseInt(clean.slice(2, 4), 16),
        b: Number.parseInt(clean.slice(4, 6), 16),
    };
}

function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darken(hex, factor = 0.25) {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    const str = String(text || '');
    if (ctx.measureText(str).width <= maxWidth) return str;
    let out = str;
    while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) {
        out = out.slice(0, -1);
    }
    return `${out}...`;
}

function drawMusicPattern(ctx, accent) {
    ctx.save();
    ctx.strokeStyle = rgba(accent, 0.14);
    ctx.fillStyle = rgba(accent, 0.08);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Decorative giant beamed eighth note on right side (inspired by Jockie card)
    ctx.beginPath();
    ctx.arc(520, 380, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(760, 340, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(576, 370);
    ctx.lineTo(605, 110);
    ctx.lineTo(845, 70);
    ctx.lineTo(816, 330);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(598, 160);
    ctx.lineTo(838, 120);
    ctx.stroke();

    // Decorative smaller note on top-left
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(285, 85, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(305, 82);
    ctx.lineTo(318, -10);
    ctx.stroke();

    // Soft sky-glow circles
    const glow1 = ctx.createRadialGradient(780, 80, 10, 780, 80, 320);
    glow1.addColorStop(0, rgba(accent, 0.28));
    glow1.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    ctx.restore();
}

function drawBadgeIcons(ctx, startX, y, accent, isPremium) {
    const drawCircle = (cx) => {
        ctx.beginPath();
        ctx.arc(cx, y, 16, 0, Math.PI * 2);
        ctx.fillStyle = rgba(accent, 0.9);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.stroke();
    };

    let cx = startX + 16;

    // Badge 1: VIP Diamond (if Premium) or Headphones dot
    drawCircle(cx);
    ctx.fillStyle = '#FFFFFF';
    if (isPremium) {
        ctx.beginPath();
        ctx.moveTo(cx, y - 8);
        ctx.lineTo(cx + 8, y);
        ctx.lineTo(cx, y + 8);
        ctx.lineTo(cx - 8, y);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.arc(cx, y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    cx += 42;

    // Badge 2: Equalizer bars
    drawCircle(cx);
    ctx.fillStyle = '#FFFFFF';
    const bars = [
        { dx: -6, h: 7 },
        { dx: -2, h: 12 },
        { dx: 2, h: 9 },
        { dx: 6, h: 11 },
    ];
    for (const bar of bars) {
        ctx.fillRect(cx + bar.dx - 1.2, y + 6 - bar.h, 2.4, bar.h);
    }
    cx += 42;

    // Badge 3: Music note
    drawCircle(cx);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx - 3, y + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 0.5, y - 7, 2.2, 11);
    ctx.fillRect(cx - 0.5, y - 7, 7, 2.6);
}

function drawRankCard(ctx, { x, y, w, h, title, rows, accent, emptyText }) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(7, 13, 26, 0.72)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    // Section Title
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `bold 15px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + 20, y + 16);

    if (!rows.length) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(emptyText, x + 20, y + 54);
        ctx.restore();
        return;
    }

    const rankColors = [accent, 'rgba(148, 163, 184, 0.35)', 'rgba(100, 116, 139, 0.28)'];
    let rowY = y + 48;

    for (let i = 0; i < Math.min(3, rows.length); i++) {
        const item = rows[i];
        // Rank badge
        roundRectPath(ctx, x + 20, rowY, 24, 24, 5);
        ctx.fillStyle = rankColors[i] || rankColors[2];
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 13px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x + 32, rowY + 12.5);

        // Duration + Name
        ctx.textAlign = 'left';
        const durText = formatStatDuration(item.seconds);
        ctx.font = `bold 16px ${FONT_FAMILY}`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(durText, x + 54, rowY + 12.5);

        const durWidth = ctx.measureText(durText).width;
        const sepX = x + 54 + durWidth + 8;
        ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
        ctx.font = `16px ${FONT_FAMILY}`;
        const label = fitText(ctx, `· ${item.name}`, w - (sepX - x) - 20);
        ctx.fillText(label, sepX, rowY + 12.5);

        rowY += 34;
    }

    ctx.restore();
}

async function safeLoadImage(url) {
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

/**
 * Render a Jockie-style Murphy Blue-Sky Aesthetic profile card PNG buffer.
 */
async function renderProfileCardDirect({
    username,
    avatarUrl,
    bannerUrl = null,
    accentColor = '#0EA5E9',
    bio = '',
    radioName = 'MURPHY MUSIC',
    isPremium = false,
    stats = { totalSeconds: 0, totalPlays: 0, topServers: [], topFriends: [], topTracks: [] },
    lang = 'en',
}) {
    const accent = /^#[0-9a-f]{6}$/i.test(String(accentColor || '')) ? accentColor : '#0EA5E9';
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Clip whole card to rounded rectangle
    roundRectPath(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 20);
    ctx.clip();

    // Base Blue-Sky / Custom Gradient Background
    const bgGrad = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    bgGrad.addColorStop(0, '#071326');
    bgGrad.addColorStop(0.55, darken(accent, 0.42));
    bgGrad.addColorStop(1, darken(accent, 0.68));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Optional Custom Banner Image
    if (bannerUrl) {
        const bannerImg = await safeLoadImage(bannerUrl);
        if (bannerImg) {
            const scale = Math.max(CARD_WIDTH / bannerImg.width, CARD_HEIGHT / bannerImg.height);
            const drawW = bannerImg.width * scale;
            const drawH = bannerImg.height * scale;
            ctx.drawImage(bannerImg, (CARD_WIDTH - drawW) / 2, (CARD_HEIGHT - drawH) / 2, drawW, drawH);

            const overlay = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
            overlay.addColorStop(0, 'rgba(7, 13, 26, 0.55)');
            overlay.addColorStop(1, 'rgba(7, 13, 26, 0.82)');
            ctx.fillStyle = overlay;
            ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        }
    }

    drawMusicPattern(ctx, accent);

    // Top-right Brand / Radio Name Pill
    const brandText = String(radioName || 'MURPHY MUSIC').toUpperCase().slice(0, 24);
    ctx.font = `bold 15px ${FONT_FAMILY}`;
    const brandWidth = Math.max(150, ctx.measureText(brandText).width + 36);
    const pillX = CARD_WIDTH - brandWidth - 26;
    roundRectPath(ctx, pillX, 18, brandWidth, 34, 8);
    ctx.fillStyle = rgba(accent, 0.85);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brandText, pillX + brandWidth / 2, 35.5);

    // Avatar Circle (top-left)
    const avatarX = 36;
    const avatarY = 28;
    const avatarSize = 122;
    const avatarCenterX = avatarX + avatarSize / 2;
    const avatarCenterY = avatarY + avatarSize / 2;

    const avatarImg = await safeLoadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatarImg) {
        ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    } else {
        ctx.fillStyle = darken(accent, 0.5);
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    }
    ctx.restore();

    // Avatar Border Ring
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // Username & Bio & Badges
    const textX = avatarX + avatarSize + 24;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.fillText(fitText(ctx, username || 'Murphy Listener', 420), textX, 42);

    let badgeY = 102;
    if (bio) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(fitText(ctx, bio, 520), textX, 80);
        badgeY = 114;
    } else {
        const subline = isPremium
            ? `VIP Listener · ${formatStatDuration(stats.totalSeconds)} total`
            : `Free Listener · ${formatStatDuration(stats.totalSeconds)} total`;
        ctx.fillStyle = 'rgba(186, 230, 253, 0.82)';
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(subline, textX, 79);
        badgeY = 112;
    }

    drawBadgeIcons(ctx, textX, badgeY, accent, isPremium);

    // Middle Row: TOP SERVERS & TOP FRIENDS
    const pad = 30;
    const gap = 18;
    const halfW = (CARD_WIDTH - pad * 2 - gap) / 2;
    const midY = 176;
    const cardH = 162;

    const emptyLabel = lang === 'id' ? 'Belum ada data mendengarkan' : 'No listening data yet';

    drawRankCard(ctx, {
        x: pad,
        y: midY,
        w: halfW,
        h: cardH,
        title: 'TOP SERVERS',
        rows: stats.topServers || [],
        accent,
        emptyText: emptyLabel,
    });

    drawRankCard(ctx, {
        x: pad + halfW + gap,
        y: midY,
        w: halfW,
        h: cardH,
        title: 'TOP FRIENDS',
        rows: stats.topFriends || [],
        accent,
        emptyText: emptyLabel,
    });

    // Bottom Row: TOP TRACKS
    drawRankCard(ctx, {
        x: pad,
        y: midY + cardH + gap,
        w: CARD_WIDTH - pad * 2,
        h: cardH,
        title: 'TOP TRACKS',
        rows: stats.topTracks || [],
        accent,
        emptyText: emptyLabel,
    });

    return Buffer.from(await canvas.encode('png'));
}

let cardWorker = null;
let cardWorkerIdleTimer = null;
let nextCardJobId = 1;
const pendingCardJobs = new Map();
const WORKER_IDLE_MS = 15_000;

function resetWorkerIdleTimer() {
    if (cardWorkerIdleTimer) clearTimeout(cardWorkerIdleTimer);
    cardWorkerIdleTimer = setTimeout(() => {
        if (pendingCardJobs.size === 0 && cardWorker) {
            const w = cardWorker;
            cardWorker = null;
            w.terminate().catch(() => undefined);
        }
    }, WORKER_IDLE_MS);
    cardWorkerIdleTimer.unref?.();
}

function getCardWorker() {
    if (cardWorker) {
        resetWorkerIdleTimer();
        return cardWorker;
    }
    const w = new Worker(__filename);
    w.unref?.();
    w.on('message', (msg) => {
        const job = pendingCardJobs.get(msg?.id);
        if (!job) return;
        pendingCardJobs.delete(msg.id);
        resetWorkerIdleTimer();
        if (msg.ok && msg.buffer) {
            job.resolve(Buffer.from(msg.buffer));
        } else {
            job.reject(new Error(msg?.error || 'Card render failed'));
        }
    });
    w.on('error', (err) => {
        if (cardWorker === w) cardWorker = null;
        for (const [id, job] of pendingCardJobs.entries()) {
            pendingCardJobs.delete(id);
            renderProfileCardDirect(job.options).then(job.resolve, job.reject);
        }
    });
    w.on('exit', () => {
        if (cardWorker === w) cardWorker = null;
        for (const [id, job] of pendingCardJobs.entries()) {
            pendingCardJobs.delete(id);
            renderProfileCardDirect(job.options).then(job.resolve, job.reject);
        }
    });
    cardWorker = w;
    resetWorkerIdleTimer();
    return w;
}

function renderProfileCard(options = {}) {
    if (!isMainThread) return renderProfileCardDirect(options);
    return new Promise((resolve, reject) => {
        const id = nextCardJobId++;
        pendingCardJobs.set(id, { resolve, reject, options });
        try {
            const w = getCardWorker();
            w.postMessage({ id, options });
        } catch {
            pendingCardJobs.delete(id);
            renderProfileCardDirect(options).then(resolve, reject);
        }
    });
}

if (!isMainThread && parentPort) {
    parentPort.on('message', ({ id, options } = {}) => {
        renderProfileCardDirect(options)
            .then((buffer) => parentPort.postMessage({ id, ok: true, buffer }))
            .catch((error) => parentPort.postMessage({ id, ok: false, error: error?.message || String(error) }));
    });
}

module.exports = {
    CARD_WIDTH,
    CARD_HEIGHT,
    renderProfileCard,
    renderProfileCardDirect,
};

