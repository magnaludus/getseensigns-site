/* Get Seen Signs design preview.
   Original layouts. Sample names are fictional. Prices come from the catalog
   the site build copies out of seo_products.py. No print file is exported. */
(function () {
  var root = document.getElementById('designer');
  var catalogNode = document.getElementById('design-catalog');
  if (!root || !catalogNode) return;

  var catalog = JSON.parse(catalogNode.textContent);
  var mailtoAddr = root.getAttribute('data-mailto') || 'sales@getseensignsco.com';
  var endpoint = root.getAttribute('data-endpoint') || '/api/design-proof';
  var ALIAS = {
    canopy: 'canopy',
    feather: 'feather',
    yard: 'yard',
    throw: 'throw',
    banner: 'banner',
    'custom-canopy-tents': 'canopy',
    'feather-flags': 'feather',
    'bulk-campaign-signs': 'yard',
    'table-throws': 'throw',
    'vinyl-banners': 'banner'
  };
  var HINTS = {
    canopy: 'Preview shows the front valance. Use one design on all four sides, or different words on each.',
    feather: 'The price is the whole kit: flag, pole, base and carry bag.',
    yard: '18×24 coroplast with a metal H-stake for every sign. Packs start at 5.',
    throw: 'Preview is the front panel, where the full-color print goes.',
    banner: 'Heavy 13 oz vinyl, hemmed, with metal grommets. Printed on one side.'
  };

  var state = {
    productId: catalog.products[0].id,
    choices: {},
    templateId: '',
    colors: ['#14161A', '#FFD100', '#FFFFFF'],
    fontId: catalog.fonts[0].id,
    sidesMode: 'same',
    activeSide: 0,
    sideNames: ['Front'],
    sides: [{ headline: '', secondary: '' }],
    logo: null,
    contact: { name: '', email: '', phone: '', notes: '' },
    sending: false
  };

  var form, canvas;

  function productById(id) {
    for (var i = 0; i < catalog.products.length; i++) if (catalog.products[i].id === id) return catalog.products[i];
    return catalog.products[0];
  }
  function currentProduct() { return productById(state.productId); }
  function currentTemplate() {
    var p = currentProduct();
    for (var i = 0; i < p.templates.length; i++) if (p.templates[i].id === state.templateId) return p.templates[i];
    return p.templates[0];
  }
  function currentFont() {
    for (var i = 0; i < catalog.fonts.length; i++) if (catalog.fonts[i].id === state.fontId) return catalog.fonts[i];
    return catalog.fonts[0];
  }
  function currentPrice() {
    var p = currentProduct();
    for (var i = 0; i < p.prices.length; i++) {
      var row = p.prices[i], ok = true, k;
      for (k in row.when) if (row.when[k] !== state.choices[k]) ok = false;
      if (ok) return row;
    }
    return p.prices[0];
  }
  function currentArt() {
    var row = currentPrice();
    return row.art || currentProduct().art;
  }
  function activeCopy() {
    var i = state.sidesMode === 'each' ? state.activeSide : 0;
    return state.sides[i] || state.sides[0];
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function up(value, fallback) {
    var s = String(value || '').trim();
    return (s || fallback || '').toUpperCase();
  }
  function profileOf(art) {
    var r = art.w / art.h;
    if (r >= 4.5) return 'strip';
    if (r >= 1.7) return 'wide';
    if (r <= 0.6) return 'tall';
    return 'portrait';
  }
  function fontCss(font, px) {
    return font.weight + ' ' + px + 'px "' + font.family + '", "Barlow Condensed", Impact, sans-serif';
  }
  function mix(hex, target, p) {
    var n = String(hex || '#14161A').replace('#', '');
    if (n.length !== 6) n = '14161A';
    var ch = [0, 2, 4].map(function (i) { return parseInt(n.slice(i, i + 2), 16); });
    return '#' + ch.map(function (c) {
      var v = Math.max(0, Math.min(255, Math.round(c + (target - c) * p)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }
  function wrapText(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var lines = [], cur = '';
    words.forEach(function (word) {
      var trial = cur ? cur + ' ' + word : word;
      if (ctx.measureText(trial).width <= maxW) cur = trial;
      else {
        if (cur) lines.push(cur);
        cur = word;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawBlock(ctx, text, x, y, maxW, maxH, color, font, align, maxLines) {
    if (!text) return;
    var px = Math.floor(maxH / (maxLines === 1 ? 1.05 : maxLines * 0.82));
    px = Math.max(12, Math.min(px, Math.floor(maxH * 0.92)));
    var lines = [text];
    while (px > 12) {
      ctx.font = fontCss(font, px);
      lines = wrapText(ctx, text, maxW);
      var wide = lines.some(function (line) { return ctx.measureText(line).width > maxW + 1; });
      if (lines.length <= maxLines && !wide) break;
      px -= 2;
    }
    ctx.font = fontCss(font, px);
    lines = wrapText(ctx, text, maxW).slice(0, maxLines);
    ctx.fillStyle = color;
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    var lh = px * 0.94;
    var total = lines.length * lh;
    var cy = y - total / 2 + lh / 2;
    lines.forEach(function (line) {
      ctx.fillText(line, x, cy);
      cy += lh;
    });
  }
  function slotPath(ctx, x, y, w, h, shape) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    else {
      var r = Math.min(w, h) * 0.16;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }
  function drawCover(ctx, img, x, y, w, h) {
    var ir = img.width / img.height, r = w / h, sx, sy, sw, sh;
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  function drawLogo(ctx, d, x, y, w, h, shape, plate, ink) {
    ctx.save();
    slotPath(ctx, x, y, w, h, shape);
    ctx.clip();
    if (d.logoImg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      drawCover(ctx, d.logoImg, x, y, w, h);
    } else {
      ctx.fillStyle = plate;
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = fontCss(d.font, Math.min(w, h) * 0.56);
      ctx.fillText(up(d.headline, 'A').charAt(0), x + w / 2, y + h / 2 + Math.min(w, h) * 0.03);
    }
    ctx.restore();
    slotPath(ctx, x, y, w, h, shape);
    ctx.strokeStyle = 'rgba(20,22,26,0.3)';
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.04);
    ctx.stroke();
  }

  function paint(ctx, w, h, d) {
    var profile = d.profile;
    if (d.layout === 'split') paintSplit(ctx, w, h, d, profile);
    else if (d.layout === 'band') paintBand(ctx, w, h, d, profile);
    else if (d.layout === 'badge') paintBadge(ctx, w, h, d, profile);
    else paintCenter(ctx, w, h, d, profile);
  }
  function paintCenter(ctx, w, h, d, profile) {
    var c0 = d.colors[0], c1 = d.colors[1], c2 = d.colors[2];
    var head = up(d.headline, 'YOUR NAME'), sub = up(d.secondary, '');
    ctx.fillStyle = c0;
    ctx.fillRect(0, 0, w, h);
    if (profile === 'tall' || profile === 'portrait') {
      var band = h * (profile === 'tall' ? 0.15 : 0.16);
      ctx.fillStyle = c1;
      ctx.fillRect(0, h - band, w, band);
      var logo = Math.min(w * 0.42, h * (profile === 'tall' ? 0.18 : 0.22));
      var cx = profile === 'tall' ? w * 0.46 : w / 2;
      drawLogo(ctx, d, cx - logo / 2, h * 0.06, logo, logo, 'circle', c1, c0);
      var top = h * 0.06 + logo;
      var areaH = h - band - top;
      var textW = profile === 'tall' ? w * 0.74 : w * 0.86;
      drawBlock(ctx, head, cx, top + areaH * 0.42, textW, areaH * 0.72, c2, d.font, 'center', profile === 'tall' ? 4 : 3);
      if (sub) drawBlock(ctx, sub, cx, h - band / 2, textW, band * 0.62, c0, d.font, 'center', 2);
      return;
    }
    var bandH = h * (profile === 'strip' ? 0.3 : 0.26);
    ctx.fillStyle = c1;
    ctx.fillRect(0, h - bandH, w, bandH);
    var logoS = (h - bandH) * 0.74;
    var margin = Math.max(12, h * 0.12);
    drawLogo(ctx, d, margin, (h - bandH - logoS) / 2, logoS, logoS, 'round', c1, c0);
    var textX = margin + logoS + margin * 0.7;
    drawBlock(ctx, head, textX, (h - bandH) * 0.5, w - textX - margin, (h - bandH) * 0.72, c2, d.font, 'left', profile === 'strip' ? 1 : 2);
    if (sub) drawBlock(ctx, sub, margin, h - bandH / 2, w - margin * 2, bandH * 0.62, c0, d.font, 'left', 1);
  }
  function paintSplit(ctx, w, h, d, profile) {
    var c0 = d.colors[0], c1 = d.colors[1], c2 = d.colors[2];
    var head = up(d.headline, 'YOUR NAME'), sub = up(d.secondary, '');
    ctx.fillStyle = c0;
    ctx.fillRect(0, 0, w, h);
    if (profile === 'tall' || profile === 'portrait') {
      var topH = h * (profile === 'tall' ? 0.32 : 0.36);
      ctx.fillStyle = c1;
      ctx.fillRect(0, 0, w, topH);
      var logo = Math.min(w * 0.34, topH * 0.62);
      var cx = profile === 'tall' ? w * 0.46 : w / 2;
      drawLogo(ctx, d, cx - logo / 2, (topH - logo) / 2, logo, logo, 'circle', c0, c1);
      var textW = profile === 'tall' ? w * 0.74 : w * 0.84;
      drawBlock(ctx, head, cx, topH + (h - topH) * 0.38, textW, (h - topH) * 0.48, c2, d.font, 'center', profile === 'tall' ? 3 : 2);
      if (sub) drawBlock(ctx, sub, cx, topH + (h - topH) * 0.78, textW, (h - topH) * 0.22, c1, d.font, 'center', 2);
      return;
    }
    var panel = w * (profile === 'strip' ? 0.24 : 0.32);
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, panel, h);
    var logoS = Math.min(panel * 0.62, h * 0.62);
    drawLogo(ctx, d, (panel - logoS) / 2, (h - logoS) / 2, logoS, logoS, 'circle', c0, c1);
    var x = panel + w * 0.04;
    var textW = w - x - w * 0.04;
    if (sub) {
      drawBlock(ctx, head, x, h * 0.38, textW, h * 0.42, c2, d.font, 'left', profile === 'strip' ? 1 : 2);
      drawBlock(ctx, sub, x, h * 0.74, textW, h * 0.24, c1, d.font, 'left', 1);
    } else {
      drawBlock(ctx, head, x, h * 0.5, textW, h * 0.6, c2, d.font, 'left', profile === 'strip' ? 1 : 2);
    }
  }
  function paintBand(ctx, w, h, d, profile) {
    var c0 = d.colors[0], c1 = d.colors[1], c2 = d.colors[2];
    var head = up(d.headline, 'YOUR NAME'), sub = up(d.secondary, '');
    ctx.fillStyle = c0;
    ctx.fillRect(0, 0, w, h);
    if (profile === 'tall' || profile === 'portrait') {
      var band = h * 0.16;
      var bandY = h * 0.62;
      ctx.fillStyle = c1;
      ctx.fillRect(0, bandY, w, band);
      var logo = Math.min(w * 0.36, h * 0.16);
      var cx = profile === 'tall' ? w * 0.46 : w / 2;
      drawLogo(ctx, d, cx - logo / 2, h * 0.05, logo, logo, 'circle', c1, c0);
      var textW = profile === 'tall' ? w * 0.74 : w * 0.86;
      drawBlock(ctx, head, cx, h * 0.4, textW, h * 0.28, c2, d.font, 'center', profile === 'tall' ? 3 : 2);
      if (sub) drawBlock(ctx, sub, cx, bandY + band / 2, textW, band * 0.7, c0, d.font, 'center', 2);
      return;
    }
    var bandH = h * (profile === 'strip' ? 0.34 : 0.28);
    var bandY = h * (profile === 'strip' ? 0.56 : 0.6);
    ctx.fillStyle = c1;
    ctx.fillRect(0, bandY, w, bandH);
    var logoS = h * 0.46;
    var margin = h * 0.12;
    drawLogo(ctx, d, margin, (h - logoS) / 2, logoS, logoS, 'circle', c1, c0);
    var textX = margin + logoS + margin * 0.55;
    drawBlock(ctx, head, textX, bandY * 0.48, w - textX - margin, bandY * 0.7, c2, d.font, 'left', profile === 'strip' ? 1 : 2);
    if (sub) drawBlock(ctx, sub, textX, bandY + bandH / 2, w - textX - margin, bandH * 0.62, c0, d.font, 'left', 1);
  }
  function paintBadge(ctx, w, h, d, profile) {
    var c0 = d.colors[0], c1 = d.colors[1], c2 = d.colors[2];
    var head = up(d.headline, 'YOUR NAME'), sub = up(d.secondary, '');
    ctx.fillStyle = c0;
    ctx.fillRect(0, 0, w, h);
    if (profile === 'tall' || profile === 'portrait') {
      var logo = Math.min(w * 0.48, h * (profile === 'tall' ? 0.22 : 0.28));
      var cx = profile === 'tall' ? w * 0.46 : w / 2;
      drawLogo(ctx, d, cx - logo / 2, h * 0.07, logo, logo, 'circle', c1, c0);
      var textW = profile === 'tall' ? w * 0.76 : w * 0.86;
      var y = h * 0.07 + logo + h * 0.06;
      drawBlock(ctx, head, cx, y + h * 0.16, textW, h * 0.28, c2, d.font, 'center', profile === 'tall' ? 3 : 2);
      ctx.fillStyle = c1;
      var ruleW = Math.min(textW * 0.45, w * 0.28);
      ctx.fillRect(cx - ruleW / 2, y + h * 0.32, ruleW, Math.max(6, h * 0.012));
      if (sub) drawBlock(ctx, sub, cx, y + h * 0.42, textW, h * 0.12, c1, d.font, 'center', 2);
      return;
    }
    var logoS = h * (profile === 'strip' ? 0.7 : 0.62);
    var margin = h * 0.14;
    drawLogo(ctx, d, margin, (h - logoS) / 2, logoS, logoS, 'circle', c1, c0);
    var textX = margin + logoS + margin * 0.7;
    var textW = w - textX - margin;
    drawBlock(ctx, head, textX, h * (sub ? 0.36 : 0.5), textW, h * 0.4, c2, d.font, 'left', profile === 'strip' ? 1 : 2);
    ctx.fillStyle = c1;
    ctx.fillRect(textX, h * 0.56, Math.min(textW * 0.42, w * 0.22), Math.max(5, h * 0.035));
    if (sub) drawBlock(ctx, sub, textX, h * 0.76, textW, h * 0.22, c1, d.font, 'left', 1);
  }

  function traceFlag(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h * 0.02);
    ctx.bezierCurveTo(x + w * 0.78, y - h * 0.02, x + w * 1.04, y + h * 0.2, x + w * 0.9, y + h * 0.46);
    ctx.bezierCurveTo(x + w * 1.02, y + h * 0.7, x + w * 0.78, y + h * 1.0, x + w * 0.42, y + h * 0.97);
    ctx.lineTo(x + w * 0.1, y + h * 0.9);
    ctx.lineTo(x + w * 0.1, y + h * 0.02);
    ctx.closePath();
  }
  function drawCanopy(ctx, W, H, art, colors) {
    var left = W * 0.08, right = W * 0.92, mid = (left + right) / 2;
    var eaveY = H * 0.36, peakY = H * 0.08, valH = H * 0.25, footY = H * 0.9;
    ctx.fillStyle = 'rgba(20,22,26,0.1)';
    ctx.beginPath();
    ctx.ellipse(mid, footY + 8, (right - left) * 0.34, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#B7BCC4';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(left + 24, eaveY);
    ctx.lineTo(left + 34, footY);
    ctx.moveTo(right - 24, eaveY);
    ctx.lineTo(right - 34, footY);
    ctx.stroke();
    ctx.strokeStyle = '#5E646C';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(left + 12, footY);
    ctx.lineTo(left + 56, footY);
    ctx.moveTo(right - 56, footY);
    ctx.lineTo(right - 12, footY);
    ctx.stroke();
    ctx.fillStyle = mix(colors[0], 0, 0.22);
    ctx.beginPath();
    ctx.moveTo(left - 8, eaveY);
    ctx.lineTo(mid, peakY);
    ctx.lineTo(right + 8, eaveY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.moveTo(left + 46, eaveY - 4);
    ctx.lineTo(mid, peakY + 36);
    ctx.lineTo(right - 46, eaveY - 4);
    ctx.closePath();
    ctx.fill();
    ctx.drawImage(art, left - 6, eaveY, right - left + 12, valH);
    ctx.strokeStyle = 'rgba(20,22,26,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left - 6, eaveY, right - left + 12, valH);
  }
  function drawFeather(ctx, W, H, art, colors, choices) {
    var scale = { '10.5': 0.74, '14': 0.88, '18': 1 }[choices.height] || 0.88;
    var poleX = W * 0.24;
    var flagTop = H * 0.04;
    var avail = H * 0.78;
    var flagH = avail * scale;
    var flagW = W * 0.7;
    var baseY = flagTop + flagH + H * 0.04;
    ctx.fillStyle = 'rgba(20,22,26,0.1)';
    ctx.beginPath();
    ctx.ellipse(poleX, Math.min(H * 0.94, baseY + 28), 70, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D5D8DE';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poleX, flagTop + 8);
    ctx.lineTo(poleX, baseY);
    ctx.stroke();
    ctx.strokeStyle = '#8E949C';
    ctx.lineWidth = 2;
    [0.28, 0.55, 0.8].forEach(function (t) {
      var y = flagTop + flagH * t;
      ctx.beginPath();
      ctx.moveTo(poleX - 5, y);
      ctx.lineTo(poleX + 5, y);
      ctx.stroke();
    });
    ctx.save();
    traceFlag(ctx, poleX - 6, flagTop, flagW, flagH);
    ctx.clip();
    ctx.drawImage(art, poleX - 6, flagTop, flagW, flagH);
    ctx.restore();
    traceFlag(ctx, poleX - 6, flagTop, flagW, flagH);
    ctx.strokeStyle = 'rgba(20,22,26,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (choices.base === 'cross') {
      ctx.fillStyle = '#3E444C';
      ctx.fillRect(poleX - 78, baseY - 6, 156, 10);
      ctx.fillStyle = '#1F4E73';
      ctx.fillRect(poleX + 24, baseY - 30, 40, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(poleX + 28, baseY - 26, 10, 8);
    } else {
      ctx.fillStyle = '#8B9098';
      ctx.beginPath();
      ctx.moveTo(poleX - 7, baseY - 2);
      ctx.lineTo(poleX + 7, baseY - 2);
      ctx.lineTo(poleX, baseY + 34);
      ctx.fill();
    }
  }
  function drawYard(ctx, W, H, art) {
    var sw = W * 0.66, sh = sw * (24 / 18);
    var x = (W - sw) / 2, y = H * 0.05;
    ctx.fillStyle = 'rgba(20,22,26,0.1)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.93, 100, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F7F4EE';
    ctx.fillRect(x - 12, y - 12, sw + 24, sh + 24);
    ctx.strokeStyle = '#14161A';
    ctx.lineWidth = 4;
    ctx.strokeRect(x - 12, y - 12, sw + 24, sh + 24);
    ctx.drawImage(art, x, y, sw, sh);
    var cx = W / 2, top = y + sh + 12, bot = H * 0.9;
    ctx.strokeStyle = '#6E737C';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bot);
    var hy = top + (bot - top) * 0.42;
    ctx.moveTo(cx - 54, hy);
    ctx.lineTo(cx + 54, hy);
    ctx.moveTo(cx - 40, hy + 8);
    ctx.lineTo(cx - 14, bot);
    ctx.moveTo(cx + 40, hy + 8);
    ctx.lineTo(cx + 14, bot);
    ctx.stroke();
  }
  function drawTable(ctx, W, H, art, lengthId, colors) {
    var span = lengthId === '8' ? 0.94 : 0.8;
    var tw = W * span, x = (W - tw) / 2;
    var topY = H * 0.12, skirtY = H * 0.28, skirtH = H * 0.56;
    var sideW = Math.max(16, tw * 0.04);
    ctx.fillStyle = 'rgba(20,22,26,0.1)';
    ctx.beginPath();
    ctx.ellipse(W / 2, skirtY + skirtH + 18, tw * 0.32, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(colors[0], 0, 0.25);
    ctx.fillRect(x - sideW * 0.2, skirtY + 16, sideW, skirtH * 0.92);
    ctx.fillRect(x + tw - sideW * 0.8, skirtY + 16, sideW, skirtH * 0.92);
    ctx.drawImage(art, x, skirtY, tw, skirtH);
    ctx.strokeStyle = 'rgba(20,22,26,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, skirtY, tw, skirtH);
    ctx.beginPath();
    ctx.moveTo(x + tw * 0.02, skirtY + 1);
    ctx.lineTo(x + tw * 0.98, skirtY + 1);
    ctx.lineTo(x + tw, topY);
    ctx.lineTo(x, topY);
    ctx.closePath();
    ctx.fillStyle = mix(colors[0], 255, 0.16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,22,26,0.4)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, skirtY, tw, 8);
  }
  function drawBanner(ctx, W, H, art) {
    var ratio = art.width / art.height;
    var maxW = W * 0.9, maxH = H * 0.82;
    var bw = maxW, bh = bw / ratio;
    if (bh > maxH) { bh = maxH; bw = bh * ratio; }
    var x = (W - bw) / 2, y = (H - bh) / 2;
    ctx.fillStyle = 'rgba(20,22,26,0.12)';
    ctx.fillRect(x + 10, y + 12, bw, bh);
    ctx.drawImage(art, x, y, bw, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(4, bh * 0.025);
    ctx.strokeRect(x + 7, y + 7, bw - 14, bh - 14);
    ctx.strokeStyle = 'rgba(20,22,26,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, bw, bh);
    var n = ratio > 3 ? 5 : 3;
    var inset = Math.min(bw, bh) * 0.07;
    var r = Math.max(4, Math.min(bw, bh) * 0.018);
    for (var i = 0; i < n; i++) {
      var px = x + inset + (bw - inset * 2) * (n === 1 ? 0.5 : i / (n - 1));
      [y + inset, y + bh - inset].forEach(function (py) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#F4F0E6';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#14161A';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#14161A';
        ctx.fill();
      });
    }
  }
  function drawFlat(ctx, W, H, art) {
    var pad = 36;
    ctx.fillStyle = 'rgba(20,22,26,0.1)';
    ctx.fillRect(pad + 8, pad + 10, W - pad * 2, H - pad * 2);
    ctx.drawImage(art, pad, pad, W - pad * 2, H - pad * 2);
    ctx.strokeStyle = '#14161A';
    ctx.lineWidth = 6;
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
  }
  function stageBox(product, art) {
    if (product.mockup === 'canopy') return { w: 980, h: 680 };
    if (product.mockup === 'feather') return { w: 540, h: 900 };
    if (product.mockup === 'yard') return { w: 640, h: 860 };
    if (product.mockup === 'table') return { w: 980, h: 640 };
    if (product.mockup === 'banner') {
      var r = art.w / art.h;
      return { w: 1040, h: Math.max(280, Math.round(1040 / r * 0.9 + 56)) };
    }
    var ratio = art.w / art.h;
    return { w: 1000, h: Math.round(1000 / ratio + 80) };
  }
  function liveDesign(art) {
    var copy = activeCopy();
    return {
      layout: currentTemplate().layout,
      headline: copy.headline,
      secondary: copy.secondary,
      colors: state.colors.slice(),
      font: currentFont(),
      logoImg: state.logo && state.logo.img,
      art: art,
      profile: profileOf(art)
    };
  }
  function renderArt(design) {
    var c = document.createElement('canvas');
    c.width = design.art.w;
    c.height = design.art.h;
    paint(c.getContext('2d'), design.art.w, design.art.h, design);
    return c;
  }
  function drawStage(ctx, w, h, design, product) {
    ctx.fillStyle = '#F3EFE6';
    ctx.fillRect(0, 0, w, h);
    var art = renderArt(design);
    var mock = product.mockup;
    if (mock === 'canopy') drawCanopy(ctx, w, h, art, design.colors);
    else if (mock === 'feather') drawFeather(ctx, w, h, art, design.colors, state.choices);
    else if (mock === 'yard') drawYard(ctx, w, h, art);
    else if (mock === 'table') drawTable(ctx, w, h, art, state.choices.length, design.colors);
    else if (mock === 'banner') drawBanner(ctx, w, h, art);
    else drawFlat(ctx, w, h, art);
  }
  function draw() {
    if (!canvas) return;
    var product = currentProduct();
    var art = currentArt();
    var box = stageBox(product, art);
    var parentW = canvas.parentElement.clientWidth || 640;
    var narrow = window.innerWidth <= 900;
    var maxH = Math.max(240, window.innerHeight - (narrow ? 280 : 230));
    var cssW = parentW;
    var cssH = cssW * (box.h / box.w);
    if (cssH > maxH) {
      cssH = maxH;
      cssW = cssH * (box.w / box.h);
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / box.w, 0, 0, canvas.height / box.h, 0, 0);
    drawStage(ctx, box.w, box.h, liveDesign(art), product);
    canvas.setAttribute('aria-label', 'Preview of your ' + product.name);
  }
  function exportCanvas() {
    var product = currentProduct();
    var art = currentArt();
    var box = stageBox(product, art);
    var header = 78, footer = 48, scale = 2;
    var c = document.createElement('canvas');
    c.width = box.w * scale;
    c.height = (box.h + header + footer) * scale;
    var ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#F3EFE6';
    ctx.fillRect(0, 0, box.w, header + box.h + footer);
    ctx.fillStyle = '#14161A';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 30px "Barlow Condensed", Impact, sans-serif';
    var title = product.name.toUpperCase();
    while (ctx.measureText(title).width > box.w - 56 && title.length > 8) title = title.slice(0, -2);
    ctx.fillText(title, 28, 28);
    var row = currentPrice();
    ctx.font = '700 18px Barlow, sans-serif';
    ctx.fillText(money(row.price) + '  ·  ' + row.label, 28, 56);
    ctx.save();
    ctx.translate(0, header);
    drawStage(ctx, box.w, box.h, liveDesign(art), product);
    ctx.restore();
    ctx.fillStyle = '#5B5F66';
    ctx.font = '600 16px Barlow, sans-serif';
    ctx.fillText('Preview only · Get Seen Signs · not the print file', 28, header + box.h + 26);
    return c;
  }
  function paintThumbs() {
    var art = currentArt();
    var nodes = document.querySelectorAll('.d-thumb');
    for (var i = 0; i < nodes.length; i++) {
      var thumb = nodes[i];
      var id = thumb.getAttribute('data-thumb');
      var templates = currentProduct().templates;
      var template = templates[0];
      for (var t = 0; t < templates.length; t++) if (templates[t].id === id) template = templates[t];
      thumb.width = 320;
      thumb.height = 180;
      var ctx = thumb.getContext('2d');
      ctx.fillStyle = '#E7E1D4';
      ctx.fillRect(0, 0, 320, 180);
      var design = {
        layout: template.layout,
        headline: template.headline,
        secondary: template.secondary,
        colors: template.colors,
        font: currentFont(),
        logoImg: null,
        art: art,
        profile: profileOf(art)
      };
      var off = renderArt(design);
      var maxW = 300, maxH = 160, r = art.w / art.h;
      var tw = maxW, th = tw / r;
      if (th > maxH) { th = maxH; tw = th * r; }
      var x = (320 - tw) / 2, y = (180 - th) / 2;
      ctx.drawImage(off, x, y, tw, th);
      ctx.strokeStyle = 'rgba(20,22,26,0.25)';
      ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
    }
  }

  function viewLabel() {
    var p = currentProduct();
    if (p.mockup === 'canopy') {
      if (state.sidesMode === 'each') return state.sideNames[state.activeSide] + ' valance · front view';
      return 'Front view · same on all 4 valances';
    }
    if (p.mockup === 'table') return 'Front panel';
    if (p.mockup === 'feather') return 'Front view · ' + (state.choices.height || '') + ' ft';
    return 'Front view';
  }
  function updateChrome() {
    var product = currentProduct();
    var row = currentPrice();
    var price = money(row.price);
    var priceEl = document.getElementById('d-price');
    var optEl = document.getElementById('d-opt');
    var noteEl = document.getElementById('d-note');
    var viewEl = document.getElementById('d-view');
    var dockPrice = document.getElementById('d-dock-price');
    var dockOpt = document.getElementById('d-dock-opt');
    var details = document.getElementById('d-details');
    if (priceEl) priceEl.textContent = price;
    if (optEl) optEl.textContent = row.label;
    if (dockPrice) dockPrice.textContent = price;
    if (dockOpt) dockOpt.textContent = row.label;
    if (viewEl) viewEl.textContent = viewLabel();
    if (details) details.setAttribute('href', product.page);
    if (noteEl) {
      var bits = [];
      if (HINTS[product.id]) bits.push(HINTS[product.id]);
      if (row.note) bits.push(row.note);
      noteEl.textContent = bits.join(' ');
    }
    var pressed = document.querySelectorAll('[aria-pressed]');
    for (var i = 0; i < pressed.length; i++) {
      var el = pressed[i];
      var act = el.getAttribute('data-act');
      var on = false;
      if (act === 'product') on = el.getAttribute('data-id') === state.productId;
      else if (act === 'choice') on = state.choices[el.getAttribute('data-group')] === el.getAttribute('data-id');
      else if (act === 'template') on = el.getAttribute('data-id') === state.templateId;
      else if (act === 'font') on = el.getAttribute('data-id') === state.fontId;
      else if (act === 'sidesmode') on = el.getAttribute('data-mode') === state.sidesMode;
      else if (act === 'side') on = Number(el.getAttribute('data-i')) === state.activeSide;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var sideWrap = document.getElementById('d-side-tabs');
    if (sideWrap) sideWrap.hidden = state.sidesMode !== 'each';
    paintThumbs();
    draw();
  }
  function fillTextFields() {
    var copy = activeCopy();
    var head = form.elements.headline;
    var sub = form.elements.secondary;
    if (head) head.value = copy.headline;
    if (sub) sub.value = copy.secondary;
    for (var i = 0; i < 3; i++) {
      var color = form.elements['color' + i];
      var hex = form.elements['hex' + i];
      if (color) color.value = state.colors[i];
      if (hex) hex.value = state.colors[i];
    }
  }
  function applyTemplate(template) {
    state.templateId = template.id;
    state.colors = template.colors.slice();
    state.sides = state.sideNames.map(function () {
      return { headline: template.headline, secondary: template.secondary };
    });
    state.activeSide = 0;
  }
  function applyProduct(id, keepText) {
    var product = productById(id);
    state.productId = product.id;
    state.sideNames = (product.sides && product.sides.names) || ['Front'];
    state.sidesMode = 'same';
    state.activeSide = 0;
    var choices = {};
    product.groups.forEach(function (g) { choices[g.id] = g.choices[0].id; });
    state.choices = choices;
    if (!keepText) applyTemplate(product.templates[0]);
  }
  function readQuery() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (_) { return; }
    var requested = ALIAS[q.get('product') || ''] || '';
    if (requested) applyProduct(requested, false);
    else applyProduct(state.productId, false);
    var product = currentProduct();
    product.groups.forEach(function (g) {
      var want = q.get(g.id);
      if (!want) return;
      for (var i = 0; i < g.choices.length; i++) if (g.choices[i].id === want) state.choices[g.id] = want;
    });
    var templateId = q.get('template');
    if (templateId) {
      for (var i = 0; i < product.templates.length; i++) {
        if (product.templates[i].id === templateId) applyTemplate(product.templates[i]);
      }
    }
    if (q.get('sides') === 'each' && product.sides) state.sidesMode = 'each';
  }

  function chips(act, items, extra) {
    return items.map(function (item) {
      return '<button type="button" data-act="' + act + '" data-id="' + esc(item.id) + '"' + (extra ? ' ' + extra(item) : '') + ' aria-pressed="false">' + esc(item.label || item.name || item.short) + '</button>';
    }).join('');
  }
  function renderForm() {
    var product = currentProduct();
    var copy = activeCopy();
    var groups = product.groups.map(function (g) {
      return '<fieldset><legend>' + esc(g.label) + '</legend><div class="d-chips">' +
        g.choices.map(function (c) {
          return '<button type="button" data-act="choice" data-group="' + esc(g.id) + '" data-id="' + esc(c.id) + '" aria-pressed="false">' + esc(c.label) + '</button>';
        }).join('') + '</div></fieldset>';
    }).join('');
    var templates = product.templates.map(function (t) {
      return '<button type="button" data-act="template" data-id="' + esc(t.id) + '" aria-pressed="false"><canvas class="d-thumb" data-thumb="' + esc(t.id) + '" width="320" height="180"></canvas><span>' + esc(t.name) + '</span></button>';
    }).join('');
    var colors = ['Background', 'Accent', 'Lettering'].map(function (label, i) {
      return '<div class="d-color"><span>' + esc(label) + '</span>' +
        '<input type="color" name="color' + i + '" value="' + esc(state.colors[i]) + '" aria-label="' + esc(label) + ' color">' +
        '<input type="text" name="hex' + i + '" value="' + esc(state.colors[i]) + '" maxlength="7" spellcheck="false" autocomplete="off" aria-label="' + esc(label) + ' hex">' +
        '</div>';
    }).join('');
    var sides = '';
    if (product.sides) {
      sides = '<fieldset><legend>Valances</legend><div class="d-chips">' +
        '<button type="button" data-act="sidesmode" data-mode="same" aria-pressed="false">' + esc(product.sides.sameLabel) + '</button>' +
        '<button type="button" data-act="sidesmode" data-mode="each" aria-pressed="false">' + esc(product.sides.eachLabel) + '</button>' +
        '</div><div class="d-sides" id="d-side-tabs">' +
        product.sides.names.map(function (name, i) {
          return '<button type="button" data-act="side" data-i="' + i + '" aria-pressed="false">' + esc(name) + '</button>';
        }).join('') + '</div></fieldset>';
    }
    var logo = state.logo
      ? '<p class="d-logo-name">Logo: ' + esc(state.logo.name) + ' <button type="button" data-act="clear-logo">Remove</button></p>'
      : '<p class="d-logo-name">No logo yet. A letter stands in until you add one.</p>';
    form.innerHTML =
      '<fieldset><legend>Product</legend><div class="d-chips">' +
      catalog.products.map(function (p) {
        return '<button type="button" data-act="product" data-id="' + esc(p.id) + '" aria-pressed="false">' + esc(p.short) + '</button>';
      }).join('') + '</div></fieldset>' +
      groups +
      '<fieldset><legend>Template</legend><p class="d-help">Picking a template fills in sample words and colors. Replace them with yours. Sample names are made up.</p><div class="d-templates">' + templates + '</div></fieldset>' +
      sides +
      '<fieldset><legend>Words</legend><div class="d-fields">' +
      '<label>Headline / business name<input name="headline" type="text" maxlength="48" value="' + esc(copy.headline) + '" autocomplete="organization"></label>' +
      '<label>Phone, website or tagline<input name="secondary" type="text" maxlength="48" value="' + esc(copy.secondary) + '"></label>' +
      '</div></fieldset>' +
      '<fieldset><legend>Colors</legend><div class="d-colors">' + colors + '</div></fieldset>' +
      '<fieldset><legend>Font</legend><div class="d-font">' +
      catalog.fonts.map(function (f) {
        return '<button type="button" data-act="font" data-id="' + esc(f.id) + '" aria-pressed="false" style="font-family:\'' + esc(f.family) + '\',var(--hd)">' + esc(f.label) + '</button>';
      }).join('') + '</div></fieldset>' +
      '<fieldset><legend>Logo</legend><div class="d-logo"><input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Upload a logo"></div>' +
      logo +
      '<p class="d-help">The logo stays in your browser until you send the request. You confirm you have the right to use it. We don\'t print team, school or league names, logos or slogans.</p></fieldset>' +
      '<fieldset><legend>Request my free proof</legend>' +
      '<p class="d-help">We build the real print file from this and reply within 12 hours, 7 days a week. 3 revisions. Nothing prints until you approve. <a href="/privacy">Privacy</a></p>' +
      '<div class="d-fields d-contact">' +
      '<label>Name<input name="name" type="text" autocomplete="name" required value="' + esc(state.contact.name) + '"></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email" required value="' + esc(state.contact.email) + '"></label>' +
      '<label>Phone<input name="phone" type="tel" autocomplete="tel" required value="' + esc(state.contact.phone) + '"></label>' +
      '<label>Notes<textarea name="notes" rows="3" placeholder="Needed-by date, where it will be used, anything we should match.">' + esc(state.contact.notes) + '</textarea></label>' +
      '</div>' +
      '<input type="text" name="_gotcha" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="btn btn-ink" type="submit">Request my free proof <span aria-hidden="true">→</span></button>' +
      '<p class="form-status" id="d-status" role="status" aria-live="polite"></p>' +
      '</fieldset>';
    updateChrome();
    fillTextFields();
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !form.contains(btn)) return;
    var act = btn.getAttribute('data-act');
    if (act === 'product') {
      if (btn.getAttribute('data-id') !== state.productId) {
        applyProduct(btn.getAttribute('data-id'), false);
        renderForm();
      }
      return;
    }
    if (act === 'choice') {
      state.choices[btn.getAttribute('data-group')] = btn.getAttribute('data-id');
      updateChrome();
      return;
    }
    if (act === 'template') {
      var templates = currentProduct().templates;
      for (var i = 0; i < templates.length; i++) if (templates[i].id === btn.getAttribute('data-id')) applyTemplate(templates[i]);
      fillTextFields();
      updateChrome();
      return;
    }
    if (act === 'font') {
      state.fontId = btn.getAttribute('data-id');
      updateChrome();
      return;
    }
    if (act === 'sidesmode') {
      state.sidesMode = btn.getAttribute('data-mode');
      if (state.sidesMode !== 'each') state.activeSide = 0;
      fillTextFields();
      updateChrome();
      return;
    }
    if (act === 'side') {
      state.activeSide = Number(btn.getAttribute('data-i')) || 0;
      fillTextFields();
      updateChrome();
      return;
    }
    if (act === 'clear-logo') {
      state.logo = null;
      if (form.elements.logo) form.elements.logo.value = '';
      renderForm();
    }
  }
  function setColor(i, value) {
    var v = String(value || '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return false;
    state.colors[i] = v.toUpperCase();
    return true;
  }
  function onInput(e) {
    var el = e.target;
    if (!el.name) return;
    if (el.name === 'headline' || el.name === 'secondary') {
      activeCopy()[el.name] = el.value;
      draw();
      return;
    }
    if (el.name === 'name' || el.name === 'email' || el.name === 'phone' || el.name === 'notes') {
      state.contact[el.name] = el.value;
      return;
    }
    if (/^color[0-2]$/.test(el.name)) {
      var i = Number(el.name.slice(5));
      setColor(i, el.value);
      var hex = form.elements['hex' + i];
      if (hex) hex.value = state.colors[i];
      draw();
      return;
    }
    if (/^hex[0-2]$/.test(el.name)) {
      var n = Number(el.name.slice(3));
      if (setColor(n, el.value.trim())) {
        form.elements['color' + n].value = state.colors[n];
        draw();
      }
    }
  }
  function loadLogo(file) {
    var status = document.getElementById('d-status');
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      if (status) { status.textContent = 'That logo is over 8 MB. Use a smaller PNG, JPG or SVG.'; status.className = 'form-status err'; }
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 900;
        var scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.width || 1) * scale));
        c.height = Math.max(1, Math.round((img.height || 1) * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var small = new Image();
        small.onload = function () {
          state.logo = { img: small, name: file.name, file: file };
          renderForm();
        };
        small.src = c.toDataURL('image/png');
      };
      img.onerror = function () {
        if (status) { status.textContent = 'That logo file did not open. Try a PNG or JPG.'; status.className = 'form-status err'; }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function say(msg, isErr) {
    var status = document.getElementById('d-status');
    if (!status) return;
    status.className = 'form-status' + (isErr ? ' err' : '');
    status.textContent = msg;
  }
  function markInvalid(el, bad) {
    if (el) el.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }
  function designPayload() {
    var product = currentProduct();
    var row = currentPrice();
    var template = currentTemplate();
    var font = currentFont();
    var list = state.sidesMode === 'each' ? state.sides : [state.sides[0]];
    return {
      productId: product.id,
      product: product.name,
      page: product.page,
      option: row.label,
      price: row.price,
      priceText: money(row.price),
      templateId: template.id,
      template: template.name,
      font: font.label,
      colors: state.colors.slice(),
      sidesMode: product.sides ? state.sidesMode : 'single',
      sides: list.map(function (side, i) {
        return {
          name: state.sidesMode === 'each' ? state.sideNames[i] : (product.sides ? 'All 4 sides' : 'Front'),
          headline: side.headline,
          secondary: side.secondary
        };
      }),
      logoFileName: state.logo ? state.logo.name : ''
    };
  }
  function mailtoBody(payload, ref) {
    var lines = [
      'Free proof request',
      '',
      'Name: ' + (state.contact.name || '-'),
      'Email: ' + (state.contact.email || '-'),
      'Phone: ' + (state.contact.phone || '-'),
      'Notes: ' + (state.contact.notes || '-'),
      '',
      'Product: ' + payload.product,
      'Option: ' + payload.option,
      'Price shown: ' + payload.priceText,
      'Template: ' + payload.template,
      'Font: ' + payload.font,
      'Colors: ' + payload.colors.join(', '),
      'Sides: ' + payload.sidesMode
    ];
    payload.sides.forEach(function (side) {
      lines.push(side.name + ': ' + (side.headline || '-') + ' / ' + (side.secondary || '-'));
    });
    if (payload.logoFileName) lines.push('Logo file name: ' + payload.logoFileName);
    if (ref) lines.push('Saved reference: ' + ref);
    lines.push('', 'Please attach get-seen-preview.png. If you uploaded a logo, attach that file too.');
    lines.push('This preview is not the print file.');
    var body = lines.join('\n');
    if (body.length > 1700) body = body.slice(0, 1680) + '\n…';
    return body;
  }
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function showFallback(blob, payload, ref) {
    var subject = 'Free proof request: ' + payload.product + ' (' + state.contact.name + ')';
    var href = 'mailto:' + mailtoAddr + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(mailtoBody(payload, ref));
    var status = document.getElementById('d-status');
    status.className = 'form-status';
    status.textContent = '';
    var msg = document.createElement('span');
    msg.textContent = 'Your email app should open with the details filled in. Attach the preview PNG that just downloaded. If you added a logo, attach that file too. Nothing opened? Use the email button. We finish the real print file on the free proof.';
    var row = document.createElement('span');
    row.className = 'd-fallback';
    var mail = document.createElement('a');
    mail.className = 'btn btn-ink btn-sm';
    mail.href = href;
    mail.textContent = 'Email this request';
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-line btn-sm';
    again.textContent = 'Download preview again';
    again.addEventListener('click', function () { downloadBlob(blob, 'get-seen-preview.png'); });
    row.appendChild(mail);
    row.appendChild(again);
    status.appendChild(msg);
    status.appendChild(row);
    downloadBlob(blob, 'get-seen-preview.png');
    window.location.href = href;
  }
  function onSubmit(e) {
    e.preventDefault();
    if (state.sending) return;
    var name = form.elements.name, email = form.elements.email, phone = form.elements.phone;
    state.contact.name = name.value.trim();
    state.contact.email = email.value.trim();
    state.contact.phone = phone.value.trim();
    state.contact.notes = form.elements.notes.value.trim();
    var emailOk = /.+@.+\..+/.test(state.contact.email);
    var phoneOk = state.contact.phone.replace(/\D/g, '').length >= 7;
    markInvalid(name, !state.contact.name);
    markInvalid(email, !emailOk);
    markInvalid(phone, !phoneOk);
    if (!state.contact.name || !emailOk || !phoneOk) {
      say('Add your name, a valid email and a phone number.', true);
      (!state.contact.name ? name : !emailOk ? email : phone).focus();
      return;
    }
    if (form.elements._gotcha.value) return;
    state.sending = true;
    say('Preparing your preview…');
    var payload = designPayload();
    exportCanvas().toBlob(function (blob) {
      if (!blob) {
        state.sending = false;
        say('The preview did not export. Email sales@getseensignsco.com and we will design it with you.', true);
        return;
      }
      var fd = new FormData();
      fd.set('name', state.contact.name);
      fd.set('email', state.contact.email);
      fd.set('phone', state.contact.phone);
      fd.set('notes', state.contact.notes);
      fd.set('design', JSON.stringify(payload));
      fd.set('preview', blob, 'preview.png');
      if (state.logo && state.logo.file) fd.set('logo', state.logo.file, state.logo.name);
      fd.set('_gotcha', form.elements._gotcha.value || '');
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
      fetch(endpoint, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }).catch(function () { return { res: res, data: null }; }); })
        .then(function (out) {
          if (timer) clearTimeout(timer);
          state.sending = false;
          if (out.res && out.res.ok && out.data && out.data.ok && out.data.emailed) {
            say('Request received. We will send your free proof within 12 hours. Nothing prints until you approve it.');
            return;
          }
          showFallback(blob, payload, out.data && out.data.id);
        })
        .catch(function () {
          if (timer) clearTimeout(timer);
          state.sending = false;
          showFallback(blob, payload, '');
        });
    }, 'image/png');
  }

  function mount() {
    root.innerHTML =
      '<div class="designer-layout">' +
      '<form id="d-form" class="designer-controls" novalidate></form>' +
      '<div class="designer-stage-col"><div class="designer-stage-card">' +
      '<div class="designer-stage-top"><p class="designer-view" id="d-view"></p><p class="designer-price" id="d-price" aria-live="polite"></p></div>' +
      '<p class="designer-opt" id="d-opt"></p>' +
      '<canvas id="d-canvas"></canvas>' +
      '<p class="designer-note" id="d-note"></p>' +
      '<p class="designer-fine">This is a preview, not the print file. We finish the real file on your free proof, within 12 hours, 7 days a week, 3 revisions. Nothing prints until you approve. The price includes free shipping in the lower 48.</p>' +
      '<a class="designer-details" id="d-details" href="/custom-canopy-tents/">Sizes and materials</a>' +
      '</div></div></div>' +
      '<div class="designer-dock"><div><strong id="d-dock-price"></strong><span id="d-dock-opt"></span></div>' +
      '<button class="btn btn-y btn-sm" type="submit" form="d-form">Free proof</button></div>';
    form = document.getElementById('d-form');
    canvas = document.getElementById('d-canvas');
    form.addEventListener('click', onClick);
    form.addEventListener('input', onInput);
    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'logo' && e.target.files && e.target.files[0]) loadLogo(e.target.files[0]);
    });
    form.addEventListener('submit', onSubmit);
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { draw(); }, 120);
    });
    readQuery();
    renderForm();
    if (document.fonts && document.fonts.ready) {
      var jobs = catalog.fonts.map(function (f) { return document.fonts.load(f.weight + ' 48px "' + f.family + '"'); });
      Promise.all(jobs).then(function () { paintThumbs(); draw(); }).catch(function () { paintThumbs(); draw(); });
    }
  }

  mount();
})();
