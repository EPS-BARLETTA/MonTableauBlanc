'use strict';

async function captureBoardSession(grid, className, boardNames) {
  const root = grid.getBoundingClientRect();
  const margin = 18;
  const heading = 48;
  const boards = [...grid.querySelectorAll('.class-board')];
  const surfaces = boards.map(board => board.querySelector('.board-surface'));
  const canvas = document.createElement('canvas');
  const width = Math.ceil(root.width + margin * 2);
  const height = Math.ceil(root.height + heading + margin);
  const scale = Math.min(2, Math.sqrt(8000000 / (width * height)), 4096 / Math.max(width, height));
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Capture indisponible.');
  const rect = el => {
    const box = el.getBoundingClientRect();
    return [box.left - root.left + margin, box.top - root.top + heading, box.width, box.height];
  };
  function box(el) {
    const bounds = rect(el);
    const style = getComputedStyle(el);
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(...bounds);
    const borderWidth = parseFloat(style.borderTopWidth);
    if (borderWidth) {
      ctx.strokeStyle = style.borderTopColor;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(...bounds);
    }
  }
  function text(message, x, y, maxWidth, align = 'left', style = null) {
    ctx.font = style ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` : '700 17px sans-serif';
    ctx.fillStyle = style?.color || '#14293e';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(message, x, y, Math.max(1, maxWidth));
  }
  function label(el, inset = 5) {
    const [x, y, w] = rect(el);
    text(el.textContent, x + inset, y + inset, w - inset * 2, 'left', getComputedStyle(el));
  }
  function court(el) {
    box(el);
    const [x, y, w, h] = rect(el);
    const style = getComputedStyle(el);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();
    for (const line of el.querySelectorAll('i')) {
      const [left, top, width, height] = rect(line);
      const markStyle = getComputedStyle(line);
      const topWidth = parseFloat(markStyle.borderTopWidth);
      const leftWidth = parseFloat(markStyle.borderLeftWidth);
      if (topWidth && leftWidth && width > 3 && height > 3) ctx.strokeRect(left, top, width, height);
      else if (topWidth) ctx.fillRect(left, top, width, topWidth);
      else if (leftWidth) ctx.fillRect(left, top, leftWidth, height);
    }
    const title = el.querySelector('b');
    if (title) { box(title); label(title); }
  }
  function marker(el) {
    box(el);
    const [x, y, w, h] = rect(el);
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    const lines = el.textContent.split('\n');
    const maxWidth = w - 8;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const wrapped = [];
    for (const line of lines) {
      let current = '';
      for (const word of line.split(' ')) {
        const next = current ? current + ' ' + word : word;
        if (current && ctx.measureText(next).width > maxWidth) {
          wrapped.push(current);
          current = word;
        } else current = next;
      }
      wrapped.push(current);
    }
    const left = style.textAlign === 'left';
    const step = fontSize * 1.2;
    const top = y + Math.max(2, (h - step * wrapped.length) / 2);
    wrapped.slice(0, Math.max(1, Math.floor(h / step))).forEach((line, index) =>
      text(line, left ? x + 4 : x + w / 2, top + index * step, maxWidth, left ? 'left' : 'center', style));
  }

  ctx.scale(scale, scale);
  ctx.fillStyle = '#f4f6f0';
  ctx.fillRect(0, 0, width, height);
  text(className, margin, margin - 3, width - margin * 2);

  surfaces.forEach((surface, index) => {
    const [x, y, w, h] = rect(surface);
    text(boardNames[index], x, Math.max(heading, y - 30), w);
    box(surface);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    surface.querySelectorAll('.board-tick, .board-group-zones:not([hidden]) > div').forEach(zone => { box(zone); label(zone); });
    ctx.fillStyle = '#fff';
    surface.querySelectorAll('.board-court').forEach(court);
    for (const line of surface.querySelectorAll('.board-ink polyline')) {
      const points = line.getAttribute('points').split(' ').map(pair => pair.split(',').map(Number));
      ctx.strokeStyle = '#173558';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach(([px, py], i) => {
        const method = i ? 'lineTo' : 'moveTo';
        ctx[method](x + w * px / 1000, y + h * py / 1000);
      });
      ctx.stroke();
    }
    surface.querySelectorAll('.board-marker-group').forEach(marker);
    for (const student of surface.querySelectorAll('.board-student')) {
      box(student);
      const avatar = student.firstElementChild;
      const [ax, ay, aw, ah] = rect(avatar);
      if (avatar.tagName === 'IMG' && avatar.complete && avatar.naturalWidth) ctx.drawImage(avatar, ax, ay, aw, ah);
      else if (avatar.tagName !== 'IMG') {
        box(avatar);
        text(avatar.textContent, ax + aw / 2, ay + 5, aw, 'center', getComputedStyle(avatar));
      }
      const name = student.lastElementChild;
      const [nx, ny, nw] = rect(name);
      text(name.textContent, nx + nw / 2, ny, nw, 'center', getComputedStyle(name));
    }
    surface.querySelectorAll('.board-marker-text, .board-marker-note').forEach(marker);
    ctx.restore();
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(Error('Capture indisponible.'));
  }, 'image/png'));
}
