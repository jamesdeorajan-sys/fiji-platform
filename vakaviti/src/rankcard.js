/* ═══════════════════════════════════════════════
   VAKAVITI — Shareable Rank Card Generator
   Renders a 1080×1080 Canvas image for social sharing.
   ═══════════════════════════════════════════════ */

// ── Tier palette (matches xp.js LEVELS + level colours) ──────────────
const RC_TIERS = [
  {
    title:    'Vulagi',
    subtitle: 'Visitor',
    min: 0,   max: 199,
    bg1: '#0d5f6e', bg2: '#0a3d47',   // ocean deep
    accent: '#5bc8d8',
    badge:  '#5ba4b0',
    wave:   '#0a4a56',
  },
  {
    title:    'Tamata',
    subtitle: 'Learner',
    min: 200, max: 499,
    bg1: '#1a6e48', bg2: '#0e4230',   // jungle green
    accent: '#52d48a',
    badge:  '#3d9e6e',
    wave:   '#145c3a',
  },
  {
    title:    'Cauravou',
    subtitle: 'Student',
    min: 500, max: 999,
    bg1: '#7a4a10', bg2: '#4a2a06',   // warm amber
    accent: '#f5c842',
    badge:  '#e08b2a',
    wave:   '#603808',
  },
  {
    title:    'Matai',
    subtitle: 'Scholar',
    min: 1000, max: 1999,
    bg1: '#8a4e12', bg2: '#5c2e06',   // deep sand
    accent: '#ffb347',
    badge:  '#c47b2b',
    wave:   '#6e3a0a',
  },
  {
    title:    'Turaga',
    subtitle: 'Chief',
    min: 2000, max: Infinity,
    bg1: '#3d2a6e', bg2: '#1e1040',   // royal purple
    accent: '#c8a0ff',
    badge:  '#7c5cbf',
    wave:   '#2e1e58',
  },
];

// ── Tier lookup (mirrors xpGetLevel) ─────────────────────────────────
function rcGetTier(total) {
  for (let i = RC_TIERS.length - 1; i >= 0; i--) {
    if (total >= RC_TIERS[i].min) return RC_TIERS[i];
  }
  return RC_TIERS[0];
}

// ── Helper: draw rounded rectangle path ──────────────────────────────
function rcRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// ── Draw decorative wave ──────────────────────────────────────────────
function rcDrawWave(ctx, W, H, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.62);
  ctx.bezierCurveTo(W * 0.25, H * 0.54, W * 0.5, H * 0.70, W * 0.75, H * 0.60);
  ctx.bezierCurveTo(W * 0.88, H * 0.54, W * 0.94, H * 0.58, W, H * 0.56);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.72);
  ctx.bezierCurveTo(W * 0.3, H * 0.64, W * 0.6, H * 0.78, W * 0.85, H * 0.68);
  ctx.bezierCurveTo(W * 0.92, H * 0.64, W * 0.96, H * 0.67, W, H * 0.65);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Draw decorative dots / particle accents ───────────────────────────
function rcDrawParticles(ctx, W, H, color) {
  ctx.save();
  ctx.fillStyle = color;
  const dots = [
    [0.08, 0.12, 4], [0.15, 0.22, 2.5], [0.88, 0.10, 3.5],
    [0.92, 0.20, 2], [0.05, 0.45, 2], [0.96, 0.42, 3],
    [0.12, 0.75, 2.5], [0.90, 0.72, 2], [0.50, 0.08, 2],
    [0.70, 0.14, 3], [0.30, 0.18, 1.5], [0.80, 0.30, 2],
  ];
  dots.forEach(([px, py, r]) => {
    ctx.globalAlpha = 0.18 + Math.random() * 0.12;
    ctx.beginPath();
    ctx.arc(W * px, H * py, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// ── Draw big decorative star (behind tier name) ───────────────────────
function rcDrawStar(ctx, cx, cy, outerR, innerR, points, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r   = i % 2 === 0 ? outerR : innerR;
    const ang = (i * Math.PI) / points - Math.PI / 2;
    if (i === 0) ctx.moveTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
    else         ctx.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Draw XP progress arc ──────────────────────────────────────────────
function rcDrawProgressArc(ctx, cx, cy, radius, pct, trackColor, fillColor) {
  const startAng = -Math.PI * 0.75;
  const sweepAng =  Math.PI * 1.5;

  // Track
  ctx.save();
  ctx.strokeStyle = trackColor;
  ctx.lineWidth   = 12;
  ctx.lineCap     = 'round';
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAng, startAng + sweepAng);
  ctx.stroke();

  // Fill
  ctx.strokeStyle = fillColor;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAng, startAng + sweepAng * (pct / 100));
  ctx.stroke();
  ctx.restore();
}

// ── Draw streak flame icon (simple path) ─────────────────────────────
function rcDrawFlame(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔥', cx, cy);
  ctx.restore();
}

// ── Main render function ──────────────────────────────────────────────
/**
 * generateRankCard({ name, total, streak, quizRounds, perfectRounds, joinDate })
 * Returns a PNG data URL (1080×1080).
 */
function generateRankCard(opts) {
  const {
    name         = 'Learner',
    total        = 0,
    streak       = 0,
    quizRounds   = 0,
    perfectRounds = 0,
  } = opts;

  const W = 1080;
  const H = 1080;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const tier = rcGetTier(total);

  // ── Background gradient ──
  const grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
  grad.addColorStop(0, tier.bg1);
  grad.addColorStop(1, tier.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── Decorative waves ──
  rcDrawWave(ctx, W, H, tier.wave);

  // ── Background particles ──
  rcDrawParticles(ctx, W, H, tier.accent);

  // ── Big faint star behind card ──
  rcDrawStar(ctx, W * 0.82, H * 0.22, 200, 90, 8, tier.accent, 0.06);

  // ── Top: Vakaviti logo text ──
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.55;
  ctx.font = 'italic 700 38px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Vakaviti', 72, 64);
  ctx.font = '300 24px Georgia, serif';
  ctx.globalAlpha = 0.35;
  ctx.fillText('Fijian Dictionary', 72, 108);
  ctx.restore();

  // ── Top-right: URL tag ──
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#ffffff';
  ctx.font = '300 20px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('vakaviti.pplx.ai', W - 72, 72);
  ctx.restore();

  // ═══════════════════════════════
  //   MAIN CARD (glass panel)
  // ═══════════════════════════════
  const cardX = 72;
  const cardY = 160;
  const cardW = W - 144;
  const cardH = 620;
  const cardR = 40;

  // Glass background
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#ffffff';
  rcRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.fill();
  ctx.restore();

  // Glass border
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  rcRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.stroke();
  ctx.restore();

  // ── Tier badge pill (top of card) ──
  const pillW = 220;
  const pillH = 52;
  const pillX = W / 2 - pillW / 2;
  const pillY = cardY - pillH / 2;

  ctx.save();
  ctx.fillStyle = tier.badge;
  rcRoundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();

  // Tier title in pill
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tier.title.toUpperCase(), W / 2, pillY + pillH / 2);
  ctx.restore();

  // ── Tier subtitle ──
  ctx.save();
  ctx.fillStyle = tier.accent;
  ctx.font = 'italic 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.85;
  ctx.fillText(tier.subtitle, W / 2, cardY + 44);
  ctx.restore();

  // ── Name ──
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur  = 18;
  // Clamp long names
  let displayName = name;
  ctx.font = 'bold 72px Georgia, serif';
  while (ctx.measureText(displayName).width > cardW - 120 && displayName.length > 1) {
    ctx.font = `bold ${parseInt(ctx.font) - 2}px Georgia, serif`;
  }
  ctx.fillText(displayName, W / 2, cardY + 88);
  ctx.restore();

  // ── Divider ──
  ctx.save();
  ctx.strokeStyle = tier.accent;
  ctx.lineWidth   = 2;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(cardX + 80, cardY + 180);
  ctx.lineTo(cardX + cardW - 80, cardY + 180);
  ctx.stroke();
  ctx.restore();

  // ═══════════════════════════════
  //   XP PROGRESS CIRCLE (centre)
  // ═══════════════════════════════
  const arcCX = W / 2;
  const arcCY = cardY + 360;
  const arcR  = 140;

  // Progress percentage within current tier
  let pct = 100;
  if (tier.max !== Infinity) {
    const range = tier.max - tier.min + 1;
    pct = Math.round(((total - tier.min) / range) * 100);
  }

  rcDrawProgressArc(ctx, arcCX, arcCY, arcR, pct, '#ffffff', tier.accent);

  // XP number inside arc
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur  = 10;
  ctx.fillText(total.toLocaleString(), arcCX, arcCY - 12);
  ctx.font = '300 30px Georgia, serif';
  ctx.globalAlpha = 0.7;
  ctx.fillText('XP', arcCX, arcCY + 52);
  ctx.restore();

  // Pct label at arc bottom
  ctx.save();
  ctx.fillStyle = tier.accent;
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(
    tier.max === Infinity ? 'Max Tier' : `${pct}% to ${RC_TIERS[RC_TIERS.indexOf(tier) + 1]?.title || 'Max'}`,
    arcCX,
    arcCY + arcR + 28
  );
  ctx.restore();

  // ═══════════════════════════════
  //   STATS ROW (bottom of card)
  // ═══════════════════════════════
  const statsY = cardY + cardH - 142;

  // Divider above stats
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.moveTo(cardX + 60, statsY);
  ctx.lineTo(cardX + cardW - 60, statsY);
  ctx.stroke();
  ctx.restore();

  const stats = [
    { label: 'Streak',  value: `${streak}d`,     emoji: '🔥' },
    { label: 'Rounds',  value: quizRounds,        emoji: '🎯' },
    { label: 'Perfect', value: perfectRounds,     emoji: '⭐' },
  ];

  const statW = cardW / 3;
  stats.forEach((s, i) => {
    const sx = cardX + statW * i + statW / 2;
    const sy = statsY + 28;

    // Emoji
    ctx.save();
    ctx.font = '38px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(s.emoji, sx, sy);
    ctx.restore();

    // Value
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(s.value), sx, sy + 52);
    ctx.restore();

    // Label
    ctx.save();
    ctx.fillStyle = tier.accent;
    ctx.font = '22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.8;
    ctx.fillText(s.label, sx, sy + 96);
    ctx.restore();
  });

  // ═══════════════════════════════
  //   BOTTOM CTA STRIP
  // ═══════════════════════════════
  const stripY = cardY + cardH + 36;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.9;
  ctx.fillText('Can you beat me? Try Vakaviti — free Fijian word learning', W / 2, stripY);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = tier.accent;
  ctx.font = 'italic 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.85;
  ctx.fillText('Rewards by fijitourtransfers.com', W / 2, stripY + 46);
  ctx.restore();

  // ── Small tier path indicator ──
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.font = '20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#ffffff';
  const tierPath = RC_TIERS.map((t, i) => {
    const isCurrent = t.title === tier.title;
    return isCurrent ? `[ ${t.title} ]` : t.title;
  }).join(' → ');
  ctx.fillText(tierPath, W / 2, H - 44);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

// ── Open rank card modal ──────────────────────────────────────────────
function openRankCard() {
  const xpData  = xpRead();
  const profile = profileRead();
  const streak  = (() => {
    try {
      const s = readStreak ? readStreak() : null;
      return s ? (s.count || 0) : 0;
    } catch (_) { return 0; }
  })();

  const dataUrl = generateRankCard({
    name:          profile ? profile.name : 'Learner',
    total:         xpData.total        || 0,
    streak,
    quizRounds:    xpData.quizRounds   || 0,
    perfectRounds: xpData.perfectRounds || 0,
  });

  // Inject into modal
  const modal = document.getElementById('rankCardModal');
  const img   = document.getElementById('rankCardImg');
  const dl    = document.getElementById('rankCardDownload');
  const share = document.getElementById('rankCardShare');
  if (!modal || !img) return;

  img.src = dataUrl;
  dl.href = dataUrl;
  dl.download = 'vakaviti-rank-card.png';

  // Share button
  if (share) {
    share.onclick = async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'vakaviti-rank-card.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'My Vakaviti Rank Card',
            text:  `I'm a ${rcGetTier(xpData.total || 0).title} on Vakaviti! Can you beat me?`,
            files: [file],
          });
          return;
        }
      } catch (_) {}
      // Fallback: open Facebook sharer
      const tier = rcGetTier(xpData.total || 0);
      const text = encodeURIComponent(`I'm a ${tier.title} (${tier.subtitle}) on Vakaviti with ${xpData.total || 0} XP! Can you beat me? Free Fijian learning: https://www.perplexity.ai/computer/a/vakaviti-fijian-dictionary-Wu1SKdfvR2CpbHKFWmvbhg`);
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${text}&u=https%3A%2F%2Fwww.fijitourtransfers.com`, '_blank');
    };
  }

  modal.classList.add('rc-modal-visible');
}

function closeRankCard() {
  const modal = document.getElementById('rankCardModal');
  if (modal) modal.classList.remove('rc-modal-visible');
}

// Init: wire close buttons
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn   = document.getElementById('rankCardClose');
  const backdrop   = document.getElementById('rankCardModal');
  if (closeBtn)  closeBtn.addEventListener('click', closeRankCard);
  if (backdrop)  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeRankCard();
  });
});
