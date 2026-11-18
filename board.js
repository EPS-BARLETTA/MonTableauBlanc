'use strict';

const BOARD_BACKGROUNDS = {
  blank: 'Tableau blanc',
  team: 'Sport collectif',
  basket: 'Basket',
  racket: 'Badminton / volley',
  tennis: 'Tennis',
  badminton: 'Montée-descente · Badminton',
  pickleball: 'Montée-descente · Pickleball',
  scale: 'Échelle de 1 à 20',
};
const boardClamp = (value, min, max) => Math.max(min, Math.min(max, value));
const boardNumber = (value, fallback) => Number.isFinite(value) ? boardClamp(value, 0, 100) : fallback;
const BOARD_INK_POINTS = 500;
const BOARD_INK_STROKES = 100;
const BOARD_REFERENCE_LIMIT = 15 * 1024 * 1024;
const BOARD_REFERENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function boardFileTransaction(mode, operation) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mon-tableau-blanc-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('references');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction('references', mode);
        const result = operation(transaction.objectStore('references'));
        transaction.oncomplete = () => { db.close(); resolve(result.result); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

function boardFirstName(name) {
  const words = name.trim().split(/\s+/);
  const firstGiven = words.findIndex((word, index) => index > 0 && /\p{Ll}/u.test(word));
  if (firstGiven < 0) return words.at(-1);
  const lastGiven = words.findIndex((word, index) => index > firstGiven && !/\p{Ll}/u.test(word));
  return words.slice(firstGiven, lastGiven < 0 ? undefined : lastGiven).join(' ');
}

function normalizeBoard(raw, studentIds) {
  const positions = {};
  for (const id of studentIds) {
    const point = raw.positions?.[id];
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      positions[id] = {x: boardNumber(point.x, 50), y: boardNumber(point.y, 50)};
    }
  }
  const roster = new Set(studentIds);
  const marks = Array.isArray(raw.marks) ? raw.marks : [];
  const reference = raw.reference;
  return {
    background: Object.hasOwn(BOARD_BACKGROUNDS, raw.background) ? raw.background : 'blank',
    courts: boardClamp(Math.round(Number(raw.courts)) || 1, 1, 4),
    ladderCourts: boardClamp(Math.round(Number(raw.ladderCourts)) || 6, 1, 12),
    positions,
    studentIds: Array.isArray(raw.studentIds) ? [...new Set(raw.studentIds.filter(id => roster.has(id)))] : null,
    absentIds: Array.isArray(raw.absentIds) ? [...new Set(raw.absentIds.filter(id => roster.has(id)))] : [],
    groups: boardClamp(Math.floor(Number(raw.groups)) || 0, 0, 80),
    ink: Array.isArray(raw.ink) ? raw.ink.slice(0, BOARD_INK_STROKES).filter(line =>
      typeof line === 'string' && line.length <= BOARD_INK_POINTS * 10 &&
      /^(?:\d{1,4},\d{1,4})(?: \d{1,4},\d{1,4})*$/.test(line)) : [],
    reference: reference && typeof reference.id === 'string' && /^[\w-]{1,80}$/.test(reference.id) &&
      typeof reference.name === 'string' && BOARD_REFERENCE_TYPES.includes(reference.type)
      ? {id: reference.id, name: reference.name.slice(0, 180), type: reference.type} : null,
    marks: marks.filter(m => m && typeof m.id === 'string' && /^[\w-]{1,80}$/.test(m.id) &&
      ['note', 'group', 'text'].includes(m.type) && typeof m.text === 'string').slice(0, 100).map(m => ({
      id: m.id, type: m.type, text: m.text.slice(0, m.type === 'group' ? 32 : 1200),
      x: boardNumber(m.x, 50), y: boardNumber(m.y, 50),
      ...(m.type === 'note' && roster.has(m.studentId) ? {studentId: m.studentId} : {}),
    })),
  };
}

function renderClassBoard(group, students, classId, container, multiple, saveAsNewBoard, closeBoard) {
  const studentIds = students.map(p => p.id);
  const layout = normalizeBoard(group.board || {}, studentIds);
  const {background} = layout;
  const prefix = 'board-' + group.id + '-';
  const $ = id => document.getElementById(prefix + id);
  container.innerHTML = `<section class="card class-board" aria-label="${esc(group.name)}">
    <div class="board-heading">
      ${multiple ? `<h2 class="board-title">${esc(group.name)}</h2>` : ''}
      <button id="boardAttendance" class="board-attendance">Appel · 0 absent</button>
      <button id="boardCloseView" type="button" aria-label="Fermer ${esc(group.name)}">Fermer</button>
    </div>
    <div class="board-toolbar">
      <label>Fond<select id="boardBackground">${Object.entries(BOARD_BACKGROUNDS).filter(([key]) => key !== 'tennis' || background === 'tennis').map(([key, label]) =>
        `<option value="${key}" ${key === background ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label id="boardCountLabel">Terrains<select id="boardCourtCount"></select></label>
      <button id="boardChooseStudents">Élèves du tableau</button><button id="boardAddNote">Ajouter une note</button><button id="boardArchives">Enregistrer</button><button id="boardExpand" aria-pressed="false">Plein écran</button>
      <button id="boardDistribute">Répartir les présents</button>
    </div>
    <div class="board-writing">
      <button id="boardAddText">Texte / Pencil</button>
      <button id="boardReferenceToggle">Barème ou critères</button>
      <details class="board-drawing-tools">
        <summary>Dessin libre</summary>
        <button id="boardDraw" aria-pressed="false">Tracer sur le tableau</button>
        <button id="boardUndoInk" disabled>Annuler le dernier trait</button>
      </details>
    </div>
    <p class="muted board-help">Glisse les portraits librement. Double-touche ou double-clique sur un élève pour l’agrandir. Appuie longuement sur un espace libre pour ajouter une note. Glisse une note sur un portrait pour les associer.</p>
    <p id="boardLadderHelp" class="muted board-ladder-help" hidden>Terrain 1 en haut. Les gagnants montent vers le terrain précédent et les perdants descendent vers le suivant. Déplace les élèves à la main.</p>
    <div id="boardWorkspace" class="board-workspace"><div id="boardSurface" class="board-surface" role="region" aria-label="Tableau de ${esc(group.name)}">
      <div id="boardFloor" class="board-floor" aria-hidden="true"></div>
      <div id="boardGroupZones" class="board-group-zones" hidden></div>
      <svg id="boardInk" class="board-ink" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg>
    </div>
    <aside class="board-notes" aria-labelledby="boardNotesTitle">
      <h2 id="boardNotesTitle">Notes <span id="boardNoteCount">0</span></h2>
      <ol id="boardNoteList"></ol>
    </aside></div>
    <dialog id="boardReference" class="board-reference" aria-labelledby="boardReferenceTitle">
      <h2 id="boardReferenceTitle">Barème ou critères</h2>
      <div class="board-reference-actions">
        <button id="boardImportReference">Importer un document</button>
        <button id="boardRemoveReference" hidden>Retirer</button>
        <button id="boardReferenceClose" class="primary">Revenir au tableau</button>
        <input id="boardReferenceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden>
      </div>
      <p id="boardReferenceStatus" role="status"></p>
      <div id="boardReferencePreview"></div>
    </dialog>
    <dialog id="boardAttendanceDialog" aria-labelledby="boardAttendanceTitle">
      <h2 id="boardAttendanceTitle">Faire l’appel</h2>
      <p id="boardAttendanceStatus" role="status"></p>
      <div id="boardAttendanceList" class="board-roster-list"></div>
      <div class="actions"><button id="boardAttendanceDone" class="primary">Terminé</button></div>
    </dialog>
    <dialog id="boardDistributionDialog" aria-labelledby="boardDistributionTitle">
      <h2 id="boardDistributionTitle">Répartir les présents</h2>
      <form id="boardDistributionForm">
        <p id="boardDistributionStatus" role="status"></p>
        <label id="boardGroupSizeLabel">Élèves par groupe au maximum
          <input id="boardGroupSize" type="number" min="2" max="12" value="4" required>
        </label>
        <label class="board-check"><input id="boardMix" type="checkbox"> Mélanger les élèves</label>
        <div class="actions"><button id="boardDistributionCancel" type="button">Annuler</button><button id="boardApplyDistribution" class="primary">Répartir</button></div>
      </form>
    </dialog>
    <dialog id="boardRosterDialog" aria-labelledby="boardRosterTitle">
      <h2 id="boardRosterTitle">Élèves · ${esc(group.name)}</h2>
      <form id="boardRosterForm">
        <div class="board-roster-actions">
          <button id="boardSelectAll" type="button">Toute la classe</button>
          <button id="boardSelectNone" type="button">Tout décocher</button>
        </div>
        <div id="boardRosterList" class="board-roster-list"></div>
        <div class="actions"><button id="boardRosterCancel" type="button">Annuler</button><button class="primary">Appliquer</button></div>
      </form>
    </dialog>
    <dialog id="boardArchiveDialog" aria-labelledby="boardArchiveTitle">
      <h2 id="boardArchiveTitle">Enregistrer · ${esc(group.name)}</h2>
      <button id="boardSaveCurrent" class="primary">Enregistrer ce tableau</button>
      <form id="boardSaveCopy">
        <label for="boardArchiveName">Nom du nouveau tableau</label>
        <div class="board-archive-controls"><input id="boardArchiveName" maxlength="80" required><button>Enregistrer comme nouveau tableau</button></div>
      </form>
      <ul id="boardArchiveList" class="board-archive-list"></ul>
      <p class="muted">Le fichier contient la disposition, les notes, le texte et les traits. Les portraits et le document importé restent sur cet appareil.</p>
      <p id="boardArchiveStatus" class="board-archive-status" role="status"></p>
      <div class="actions">
        <button id="boardDownload">Télécharger le tableau</button>
        <button id="boardUpload">Ouvrir un fichier</button><input type="file" id="boardArchiveFile" accept=".json,application/json" hidden>
        <button id="boardCloseArchive">Fermer</button>
      </div>
    </dialog>
    <dialog id="boardPortraitDialog" class="board-portrait-dialog" aria-labelledby="boardPortraitName">
      <div id="boardLargePortrait"></div><h2 id="boardPortraitName"></h2>
      <form method="dialog"><button>Fermer le portrait</button></form>
    </dialog>
    <dialog id="boardEditor" aria-labelledby="boardEditorTitle">
      <form id="boardForm">
        <h2 id="boardEditorTitle"></h2>
        <p id="boardScribbleHint" class="muted" hidden>Sur iPad, écris au Pencil dans la zone ci-dessous avec Griffonner, ou saisis ton texte au clavier.</p>
      <label id="boardTextLabel" for="boardText"></label><textarea id="boardText" rows="4" maxlength="1200" required></textarea>
        <label id="boardStudentLabel">Associer à un élève<select id="boardNoteStudent">
          <option value="">Note libre</option>
          ${students.map(student => `<option value="${esc(student.id)}">${esc(student.name)}</option>`).join('')}
        </select></label>
        <p id="boardError" class="board-error" role="status"></p>
        <div class="actions"><button type="button" id="boardDelete" class="danger">Retirer du tableau</button><button type="button" id="boardCancel">Fermer</button><button class="primary" type="submit">Enregistrer</button></div>
      </form>
    </dialog>
  </section>`.replace(/\b(id|for|aria-labelledby)="(board\w+)"/g, (_, attribute, id) => `${attribute}="${prefix}${id}"`);
  const panel = container.firstElementChild;
  $('boardCloseView').onclick = closeBoard;
  const surface = $('boardSurface');
  const workspace = $('boardWorkspace');
  const expand = $('boardExpand');
  const ink = $('boardInk');
  const draw = $('boardDraw');
  const undoInk = $('boardUndoInk');
  let stroke;
  const referencePanel = $('boardReference');
  const referenceToggle = $('boardReferenceToggle');
  const referenceFile = $('boardReferenceFile');
  const referenceStatus = $('boardReferenceStatus');
  const referencePreview = $('boardReferencePreview');
  const removeReference = $('boardRemoveReference');
  const importReference = $('boardImportReference');
  let referenceUrl;

  function setExpanded(expanded) {
    panel.classList.toggle('board-expanded', expanded);
    expand.textContent = expanded ? 'Quitter le plein écran' : 'Plein écran';
    expand.setAttribute('aria-pressed', String(expanded));
  }

  expand.onclick = () => setExpanded(!panel.classList.contains('board-expanded'));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.classList.contains('board-expanded') && !panel.querySelector('dialog[open]')) {
      event.preventDefault();
      setExpanded(false);
      expand.focus();
    }
  });
  const floor = $('boardFloor');
  const groupZones = $('boardGroupZones');
  const editor = $('boardEditor');
  const cards = new Map();
  const markElements = new Map();
  const portraitDialog = $('boardPortraitDialog');
  const isLadder = () => ['badminton', 'pickleball'].includes(layout.background);
  const hasCourts = () => !['blank', 'scale'].includes(layout.background);
  const numberOfCourts = () => isLadder() ? layout.ladderCourts : layout.courts;
  let gesture, pendingTap, editing, highlightedStudent;

  function showPortrait(student) {
    if (portraitDialog.open) return;
    $('boardPortraitName').textContent = student.name;
    $('boardLargePortrait').innerHTML = validRosterPortrait(student.portrait)
      ? `<img alt="" src="${student.portrait}">` : '<p class="muted">Aucun portrait importé</p>';
    portraitDialog.showModal();
  }

  function paintFloor() {
    const sport = hasCourts();
    const ladder = isLadder();
    const count = numberOfCourts();
    $('boardCountLabel').hidden = !sport;
    $('boardLadderHelp').hidden = !ladder;
    $('boardCourtCount').replaceChildren(...Array.from({length: ladder ? 12 : 4}, (_, index) => new Option(index + 1, index + 1)));
    $('boardCourtCount').value = count;
    surface.dataset.background = layout.background;
    floor.className = `board-floor board-${layout.background}`;
    floor.dataset.count = count;
    surface.classList.toggle('board-ladder', ladder);
    surface.style.setProperty('--court-rows', Math.ceil(count / 2));
    if (layout.background === 'scale') {
      floor.innerHTML = Array.from({length: 20}, (_, i) => `<div class="board-tick"><b>${20 - i}</b></div>`).join('');
    } else if (sport) {
      floor.innerHTML = Array.from({length: count}, (_, i) => `<div class="board-court"><i></i><i></i><i></i><i></i>${ladder ? `<b>Terrain ${i + 1}</b>` : ''}</div>`).join('');
    } else {
      floor.replaceChildren();
    }
    groupZones.hidden = sport || !layout.groups;
    if (groupZones.hidden) {
      groupZones.replaceChildren();
      return;
    }
    const columns = Math.min(5, Math.ceil(Math.sqrt(layout.groups)));
    groupZones.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    groupZones.replaceChildren(...Array.from({length: layout.groups}, (_, index) => {
      const zone = document.createElement('div');
      zone.textContent = `Groupe ${index + 1}`;
      return zone;
    }));
  }

  function writeBoard() {
    const previous = group.board;
    group.board = layout;
    if (save()) return true;
    group.board = previous;
    return false;
  }

  function inkLine() {
    return document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  }

  function paintInk() {
    ink.replaceChildren(...layout.ink.map(points => {
      const line = inkLine();
      line.setAttribute('points', points);
      return line;
    }));
    undoInk.disabled = !layout.ink.length;
  }

  function extendStroke(event) {
    const rect = ink.getBoundingClientRect();
    const x = Math.round(boardClamp((event.clientX - rect.left) * 1000 / rect.width, 0, 1000));
    const y = Math.round(boardClamp((event.clientY - rect.top) * 1000 / rect.height, 0, 1000));
    const point = `${x},${y}`;
    if (stroke.points.at(-1) === point) return;
    if (stroke.points.length === BOARD_INK_POINTS) stroke.points = stroke.points.filter((_, i) => i % 2 === 0);
    stroke.points.push(point);
    const points = stroke.points.length === 1 ? `${point} ${x},${y + 1}` : stroke.points.join(' ');
    stroke.line.setAttribute('points', points);
  }

  draw.onclick = () => {
    const active = ink.classList.toggle('board-ink-active');
    draw.textContent = active ? 'Terminer le dessin' : 'Tracer sur le tableau';
    draw.setAttribute('aria-pressed', String(active));
  };
  ink.addEventListener('pointerdown', event => {
    event.stopPropagation();
    if (event.button !== 0 || stroke) return;
    if (layout.ink.length >= BOARD_INK_STROKES) {
      notify('Ce tableau contient déjà 100 traits. Annule le dernier trait pour continuer.');
      return;
    }
    stroke = {id: event.pointerId, points: [], line: inkLine()};
    ink.append(stroke.line);
    ink.setPointerCapture(event.pointerId);
    extendStroke(event);
  });
  ink.addEventListener('pointermove', event => {
    if (stroke?.id === event.pointerId) extendStroke(event);
  });
  ink.addEventListener('pointerup', event => {
    if (stroke?.id !== event.pointerId) return;
    extendStroke(event);
    const previous = layout.ink;
    layout.ink = [...previous, stroke.line.getAttribute('points')];
    if (!writeBoard()) layout.ink = previous;
    stroke = null;
    paintInk();
  });
  ink.addEventListener('lostpointercapture', event => {
    if (stroke?.id !== event.pointerId) return;
    stroke.line.remove();
    stroke = null;
  });
  undoInk.onclick = () => {
    if (stroke) return;
    const previous = layout.ink;
    layout.ink = previous.slice(0, -1);
    if (!writeBoard()) layout.ink = previous;
    paintInk();
  };

  async function paintReference() {
    const reference = layout.reference;
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = null;
    referencePreview.replaceChildren();
    removeReference.hidden = !reference;
    referenceStatus.textContent = reference ? 'Ouverture du document…' : 'PDF, JPG ou PNG · 15 Mo maximum.';
    if (!reference) return;
    try {
      const file = await boardFileTransaction('readonly', store => store.get(reference.id));
      if (!boardIsCurrent() || layout.reference !== reference) return;
      if (!file) throw Error('Document absent de cet appareil.');
      referenceUrl = URL.createObjectURL(file);
      const view = document.createElement(reference.type === 'application/pdf' ? 'iframe' : 'img');
      view.src = referenceUrl;
      if (view.tagName === 'IFRAME') view.title = reference.name;
      else view.alt = reference.name;
      const link = document.createElement('a');
      link.textContent = 'Ouvrir le document';
      link.href = referenceUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      referencePreview.append(link, view);
      referenceStatus.textContent = reference.name;
    } catch (error) {
      if (boardIsCurrent() && layout.reference === reference) {
        referenceStatus.textContent = error.message || 'Impossible d’ouvrir le document.';
      }
    }
  }

  referenceToggle.onclick = () => referencePanel.showModal();
  $('boardReferenceClose').onclick = () => referencePanel.close();
  importReference.onclick = () => referenceFile.click();
  referenceFile.onchange = async () => {
    const file = referenceFile.files[0];
    referenceFile.value = '';
    if (!file) return;
    importReference.disabled = removeReference.disabled = true;
    try {
      if (file.size > BOARD_REFERENCE_LIMIT) throw Error('Le document dépasse 15 Mo.');
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const prefix = Array.from(bytes).join(',');
      let type;
      if (prefix.startsWith('37,80,68,70,45,')) type = 'application/pdf';
      if (prefix === '137,80,78,71,13,10,26,10') type = 'image/png';
      if (prefix.startsWith('255,216,255,')) type = 'image/jpeg';
      if (!type) throw Error('Choisis un document PDF, JPG ou PNG.');
      if (!boardIsCurrent()) return;
      const id = uid();
      await boardFileTransaction('readwrite', store => store.put(file.slice(0, file.size, type), id));
      const previous = layout.reference;
      if (boardIsCurrent()) {
        layout.reference = {id, name: file.name.slice(0, 180), type};
        if (writeBoard()) {
          await paintReference();
          return;
        }
        layout.reference = previous;
        referenceStatus.textContent = 'Le document n’a pas pu être associé à ce tableau.';
      }
      await boardFileTransaction('readwrite', store => store.delete(id));
    } catch (error) {
      referenceStatus.textContent = error.message || 'Impossible d’enregistrer ce document.';
    } finally {
      importReference.disabled = removeReference.disabled = false;
    }
  };
  removeReference.onclick = () => {
    const previous = layout.reference;
    layout.reference = null;
    if (writeBoard()) paintReference();
    else layout.reference = previous;
  };

  function point(element, x, y) {
    const insetX = Math.min(49, element.offsetWidth * 50 / surface.clientWidth);
    const insetY = Math.min(49, element.offsetHeight * 50 / surface.clientHeight);
    return {x: boardClamp(x, insetX, 100 - insetX), y: boardClamp(y, insetY, 100 - insetY)};
  }

  function paint(element, position) {
    const visible = point(element, position.x, position.y);
    element.style.left = `${visible.x}%`;
    element.style.top = `${visible.y}%`;
  }

  function paintItems() {
    cards.forEach(({element, position}) => paint(element, position));
    markElements.forEach(({element, position}) => {
      if (!position.studentId) paint(element, position);
    });
    cards.forEach((_, id) => paintStudentNotes(id));
  }

  function paintStudentNotes(id, dragged) {
    const card = cards.get(id)?.element;
    const notes = [...markElements.values()].filter(({position}) => position.studentId === id);
    if (!card || !notes.length) return;
    const width = surface.clientWidth, height = surface.clientHeight;
    const cardX = parseFloat(card.style.left) * width / 100;
    const cardY = parseFloat(card.style.top) * height / 100;
    const step = 36;
    const columns = Math.min(notes.length, Math.max(3, Math.floor(width / step)));
    const rows = Math.ceil(notes.length / columns);
    const below = cardY + card.offsetHeight / 2 + 4;
    const above = cardY - card.offsetHeight / 2 - 4;
    const top = below + rows * step <= height || above < height - below;
    notes.forEach(({element}, i) => {
      if (element === dragged) return;
      const row = Math.floor(i / columns);
      const inRow = Math.min(columns, notes.length - row * columns);
      const spacing = inRow * step;
      const left = boardClamp(cardX - spacing / 2, 0, Math.max(0, width - spacing));
      const x = left + (i % columns + .5) * step;
      const y = top ? below + (row + .5) * step : above - (row + .5) * step;
      paint(element, {x: 100 * x / width, y: 100 * y / height});
    });
  }

  function noteDropTarget(x, y) {
    return document.elementsFromPoint(x, y).find(element => element.matches('.board-student') && surface.contains(element));
  }

  function highlightNoteTarget(target) {
    if (target === highlightedStudent) return;
    highlightedStudent?.classList.remove('board-note-target');
    target?.classList.add('board-note-target');
    highlightedStudent = target;
  }

  function boardIsCurrent() {
    return surface.isConnected;
  }

  if (typeof ResizeObserver !== 'undefined') {
    const resize = new ResizeObserver(() => {
      if (boardIsCurrent()) paintItems();
      else resize.disconnect();
    });
    resize.observe(surface);
  }
  const lifetime = new MutationObserver(() => {
    if (boardIsCurrent()) return;
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    lifetime.disconnect();
    cancelGesture();
  });
  lifetime.observe(document.getElementById('content'), {childList: true});

  function makeDraggable(element, position, persistPosition, activate, twice = false) {
    element.classList.add('board-movable');
    element.addEventListener('pointerdown', event => {
      const shownX = parseFloat(element.style.left);
      const shownY = parseFloat(element.style.top);
      startGesture(event, element, {x: shownX, y: shownY}, persistPosition, activate, twice);
    });
    element.addEventListener('click', event => {
      if (event.detail === 0) activate();
    });
    element.addEventListener('keydown', event => {
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!delta) return;
      event.preventDefault();
      const step = event.shiftKey ? 8 : 2;
      const next = point(element, parseFloat(element.style.left) + delta[0] * step, parseFloat(element.style.top) + delta[1] * step);
      persistPosition(next);
    });
    paint(element, position);
  }

  const columns = matchMedia('(max-width: 640px)').matches ? 4 : 7;
  const rows = Math.ceil(students.length / columns);
  function presentStudents() {
    const visible = layout.studentIds && new Set(layout.studentIds);
    const absent = new Set(layout.absentIds);
    return students.filter(student => (!visible || visible.has(student.id)) && !absent.has(student.id));
  }

  function showStudents() {
    cards.forEach(({element}) => element.remove());
    cards.clear();
    const present = new Set(presentStudents().map(student => student.id));
    const count = layout.absentIds.length;
    $('boardAttendance').textContent = `Appel · ${count} absent${count > 1 ? 's' : ''}`;
    students.forEach((student, index) => {
      if (!present.has(student.id)) return;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'board-student';
      element.dataset.studentId = student.id;
      element.setAttribute('aria-label', `${student.name} · Glisser pour déplacer, double toucher pour agrandir`);
      element.title = student.name;
      const validPhoto = validRosterPortrait(student.portrait);
      const initials = student.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
      element.innerHTML = `${validPhoto ? `<img alt="" src="${student.portrait}" draggable="false">` : `<span class="board-initials">${esc(initials)}</span>`}<span>${esc(boardFirstName(student.name))}</span>`;
      surface.append(element);
      const old = layout.positions[student.id] || {};
      const record = {element, position: {
        x: boardNumber(old.x, (index % columns + 0.5) * 100 / columns),
        y: boardNumber(old.y, (Math.floor(index / columns) + 0.5) * Math.min(15, 92 / rows) + 4),
      }};
      cards.set(student.id, record);
      makeDraggable(element, record.position, next => {
        const previous = layout.positions[student.id];
        layout.positions[student.id] = next;
        if (writeBoard()) record.position = next;
        else if (previous) layout.positions[student.id] = previous;
        else delete layout.positions[student.id];
        paint(element, record.position);
        paintStudentNotes(student.id);
      }, () => showPortrait(student), true);
    });
  }

  function makeStudentChecks(list) {
    return students.map(student => {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = student.id;
    label.append(check, RosterPortraits.photo(student.portrait), document.createTextNode(student.name));
    list.append(label);
    return check;
    });
  }
  const rosterDialog = $('boardRosterDialog');
  const rosterChecks = makeStudentChecks($('boardRosterList'));
  $('boardChooseStudents').onclick = () => {
    const chosen = layout.studentIds && new Set(layout.studentIds);
    rosterChecks.forEach(check => { check.checked = !chosen || chosen.has(check.value); });
    rosterDialog.showModal();
  };
  $('boardSelectAll').onclick = () => rosterChecks.forEach(check => { check.checked = true; });
  $('boardSelectNone').onclick = () => rosterChecks.forEach(check => { check.checked = false; });
  $('boardRosterCancel').onclick = () => rosterDialog.close();
  $('boardRosterForm').onsubmit = event => {
    event.preventDefault();
    const previous = layout.studentIds;
    const chosen = rosterChecks.filter(check => check.checked).map(check => check.value);
    layout.studentIds = chosen.length === students.length ? null : chosen;
    if (!writeBoard()) { layout.studentIds = previous; return; }
    showStudents();
    showMarks();
    rosterDialog.close();
  };

  const attendance = $('boardAttendanceDialog');
  const attendanceChecks = makeStudentChecks($('boardAttendanceList'));
  function refreshAttendance() {
    const absent = new Set(layout.absentIds);
    attendanceChecks.forEach(check => { check.checked = absent.has(check.value); });
    $('boardAttendanceStatus').textContent = `Coche les absents · ${absent.size} absent${absent.size > 1 ? 's' : ''} sur ${students.length}`;
  }
  $('boardAttendance').onclick = () => {
    refreshAttendance();
    attendance.showModal();
  };
  $('boardAttendanceDone').onclick = () => attendance.close();
  $('boardAttendanceList').onchange = () => {
    const previous = layout.absentIds;
    layout.absentIds = attendanceChecks.filter(check => check.checked).map(check => check.value);
    if (!writeBoard()) {
      layout.absentIds = previous;
      refreshAttendance();
      $('boardAttendanceStatus').textContent = 'Impossible d’enregistrer l’appel. Réessaie.';
      return;
    }
    showStudents();
    showMarks();
    refreshAttendance();
  };

  const distribution = $('boardDistributionDialog');
  const distributionStatus = $('boardDistributionStatus');
  const groupSize = $('boardGroupSize');
  $('boardDistribute').onclick = () => {
    const count = presentStudents().length;
    distributionStatus.textContent = count ? `${count} élève(s) présent(s) sur ce tableau` +
      (hasCourts() ? ` · ${numberOfCourts()} terrain(s).` : '.') : 'Aucun élève présent sur ce tableau.';
    $('boardGroupSizeLabel').hidden = hasCourts();
    groupSize.disabled = hasCourts();
    $('boardApplyDistribution').disabled = !count;
    distribution.showModal();
  };
  $('boardDistributionCancel').onclick = () => distribution.close();
  $('boardDistributionForm').onsubmit = event => {
    event.preventDefault();
    const present = presentStudents();
    if (!present.length) return;
    if ($('boardMix').checked) {
      for (let i = present.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [present[i], present[j]] = [present[j], present[i]];
      }
    }
    const previous = {positions: layout.positions, groups: layout.groups};
    layout.groups = hasCourts() ? 0 : Math.ceil(present.length / groupSize.valueAsNumber);
    paintFloor();
    const zones = hasCourts() ? [...floor.children] : [...groupZones.children];
    const bounds = surface.getBoundingClientRect();
    layout.positions = {...previous.positions};
    let start = 0;
    zones.forEach((zone, index) => {
      const count = Math.floor(present.length / zones.length) + (index < present.length % zones.length ? 1 : 0);
      if (!count) return;
      const box = zone.getBoundingClientRect();
      const columns = Math.min(count, Math.max(1, Math.floor(box.width / 65)));
      const rows = Math.ceil(count / columns);
      for (let i = 0; i < count; i++) {
        const x = box.left - bounds.left + (i % columns + .5) * box.width / columns;
        const y = box.top - bounds.top + 24 + (Math.floor(i / columns) + .5) * Math.max(1, box.height - 24) / rows;
        layout.positions[present[start + i].id] = {x: 100 * x / bounds.width, y: 100 * y / bounds.height};
      }
      start += count;
    });
    if (!writeBoard()) {
      Object.assign(layout, previous);
      paintFloor();
      distributionStatus.textContent = 'La répartition n’a pas été enregistrée.';
      return;
    }
    showStudents();
    showMarks();
    distribution.close();
  };

  function showMarks() {
    markElements.forEach(({element}) => element.remove());
    markElements.clear();
    const list = $('boardNoteList');
    list.replaceChildren();
    let noteNumber = 0;
    layout.marks.forEach(mark => {
      const number = mark.type === 'note' ? ++noteNumber : null;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `board-marker board-marker-${mark.type}`;
      element.textContent = number ?? mark.text;
      const owner = students.find(student => student.id === mark.studentId);
      if (owner) element.classList.add('board-note-attached');
      if (number) element.dataset.boardNote = '';
      element.setAttribute('aria-label', number ? `Ouvrir la note ${number}`
        : mark.type === 'text' ? `Modifier le texte ${mark.text}` : `Modifier le groupe ${mark.text}`);
      if (number) {
        const item = document.createElement('li');
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = number;
        link.setAttribute('aria-label', `Lire la note ${number}${owner ? ` · ${owner.name}` : ''}`);
        if (owner) link.title = owner.name;
        link.onclick = () => openEdit(mark.type, mark, mark);
        item.append(link);
        list.append(item);
      }
      if (owner && !cards.has(owner.id)) return;
      surface.append(element);
      markElements.set(mark.id, {element, position: mark});
      makeDraggable(element, mark, (next, target) => {
        const previous = {...mark};
        const studentId = number ? target?.dataset.studentId : undefined;
        Object.assign(mark, next, {studentId});
        if (!writeBoard()) {
          Object.assign(mark, previous, {studentId: previous.studentId});
          paintItems();
        } else if (studentId !== previous.studentId) {
          showMarks();
        } else {
          paintItems();
        }
      }, () => openEdit(mark.type, mark, mark));
    });
    paintItems();
    $('boardNoteCount').textContent = noteNumber;
  }

  function startGesture(event, element, origin, commit, activate, twice) {
    if (event.button !== 0 || gesture || !event.isPrimary) return;
    const box = surface.getBoundingClientRect();
    const g = {id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, element, origin, commit, activate, twice};
    gesture = g;
    surface.setPointerCapture(g.id);
    if (!element) {
      g.timer = setTimeout(() => {
        if (gesture !== g) return;
        const box = surface.getBoundingClientRect();
        cancelGesture();
        openEdit('note', {x: 100 * (g.x - box.left) / box.width, y: 100 * (g.y - box.top) / box.height});
      }, 550);
    }
  }

  function cancelGesture() {
    if (!gesture) return;
    clearTimeout(gesture.timer);
    cancelAnimationFrame(gesture.frame);
    if (gesture.element) gesture.element.classList.remove('board-dragging');
    highlightNoteTarget(null);
    gesture = null;
  }

  surface.addEventListener('pointerdown', event => {
    if (!event.target.closest('.board-movable')) startGesture(event, null);
  });
  function paintDragged(g) {
    const box = surface.getBoundingClientRect();
    const dx = g.clientX - g.x + g.left - box.left;
    const dy = g.clientY - g.y + g.top - box.top;
    g.next = point(g.element, g.origin.x + dx * 100 / surface.clientWidth, g.origin.y + dy * 100 / surface.clientHeight);
    paint(g.element, g.next);
    if (g.element.dataset.studentId) paintStudentNotes(g.element.dataset.studentId, g.element);
    if ('boardNote' in g.element.dataset) highlightNoteTarget(noteDropTarget(g.clientX, g.clientY));
  }

  function scrollDuringDrag(g) {
    if (gesture !== g || !isLadder()) return;
    const viewport = panel.classList.contains('board-expanded') ? workspace.getBoundingClientRect() : {top: 0, bottom: window.innerHeight};
    const scrollArea = panel.classList.contains('board-expanded') ? workspace : window;
    const margin = 68;
    const box = surface.getBoundingClientRect();
    if (g.clientY < viewport.top + margin && box.top < viewport.top) scrollArea.scrollBy(0, -10);
    if (g.clientY > viewport.bottom - margin && box.bottom > viewport.bottom) scrollArea.scrollBy(0, 10);
    paintDragged(g);
    g.frame = requestAnimationFrame(() => scrollDuringDrag(g));
  }

  surface.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || g.id !== event.pointerId) return;
    if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 6) return;
    const firstMove = !g.moved;
    g.moved = true;
    clearTimeout(g.timer);
    pendingTap = null;
    if (g.element) {
      g.clientX = event.clientX;
      g.clientY = event.clientY;
      g.element.classList.add('board-dragging');
      paintDragged(g);
      if (firstMove && isLadder()) g.frame = requestAnimationFrame(() => scrollDuringDrag(g));
    }
  });
  surface.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || g.id !== event.pointerId) return;
    const target = highlightedStudent;
    cancelGesture();
    if (g.next) {
      g.commit(g.next, target);
    } else if (g.activate && !g.moved) {
      if (!g.twice) {
        g.activate();
        return;
      }
      const now = performance.now();
      if (pendingTap?.element === g.element && now - pendingTap.time < 480) {
        pendingTap = null;
        g.activate();
      } else {
        pendingTap = {element: g.element, time: now};
      }
    }
  });
  surface.addEventListener('pointercancel', () => { cancelGesture(); paintItems(); });
  surface.addEventListener('contextmenu', event => event.preventDefault());

  function openEdit(type, position, mark) {
    if (editor.open) return;
    editing = {type, position, mark};
    const isNote = type === 'note';
    const notes = layout.marks.filter(entry => entry.type === 'note');
    $('boardEditorTitle').textContent = isNote ? `Note ${mark ? notes.indexOf(mark) + 1 : notes.length + 1}`
      : type === 'text' ? 'Texte sur le tableau' : 'Nom du groupe';
    $('boardTextLabel').textContent = isNote ? 'Commentaire' : type === 'text' ? 'Texte' : 'Groupe';
    $('boardScribbleHint').hidden = type !== 'text';
    $('boardText').maxLength = type === 'group' ? 32 : 1200;
    $('boardText').value = mark?.text || '';
    $('boardStudentLabel').hidden = !isNote;
    for (const option of $('boardNoteStudent').options) {
      option.hidden = option.value !== '' && !cards.has(option.value) && option.value !== mark?.studentId;
      option.disabled = option.hidden;
    }
    $('boardNoteStudent').value = mark?.studentId || '';
    $('boardError').textContent = '';
    $('boardDelete').hidden = !mark;
    editor.showModal();
  }

  $('boardForm').onsubmit = event => {
    event.preventDefault();
    const value = $('boardText').value.trim();
    if (!value) {
      $('boardError').textContent = 'Saisis un texte avant d’enregistrer.';
      return;
    }
    const {type, position, mark} = editing;
    if (!mark && layout.marks.length >= 100) {
      $('boardError').textContent = 'Le tableau contient déjà 100 éléments de texte et notes.';
      return;
    }
    const previous = layout.marks;
    const studentId = type === 'note' ? $('boardNoteStudent').value || undefined : undefined;
    const element = markElements.get(mark?.id)?.element;
    const location = element && mark.studentId && !studentId
      ? {x: parseFloat(element.style.left), y: parseFloat(element.style.top)} : {x: position.x, y: position.y};
    const entry = {id: mark?.id || uid(), type, text: value, ...location, studentId};
    layout.marks = mark ? previous.map(m => m === mark ? entry : m) : [...previous, entry];
    if (!writeBoard()) {
      layout.marks = previous;
      $('boardError').textContent = 'Enregistrement impossible sur cet appareil.';
      return;
    }
    showMarks();
    editor.close();
  };
  $('boardDelete').onclick = () => {
    if (!editing.mark) return;
    const previous = layout.marks;
    layout.marks = previous.filter(m => m !== editing.mark);
    if (!writeBoard()) {
      layout.marks = previous;
      $('boardError').textContent = 'La modification n’a pas été enregistrée.';
      return;
    }
    showMarks();
    editor.close();
  };
  $('boardCancel').onclick = () => editor.close();
  $('boardAddNote').onclick = () => openEdit('note', {x: 50, y: 50});
  $('boardAddText').onclick = () => openEdit('text', {x: 50, y: 50});
  $('boardBackground').onchange = event => {
    const previous = layout.background;
    layout.background = event.target.value;
    if (!writeBoard()) event.target.value = layout.background = previous;
    paintFloor();
  };
  $('boardCourtCount').onchange = event => {
    const key = isLadder() ? 'ladderCourts' : 'courts';
    const previous = layout[key];
    layout[key] = Number(event.target.value);
    if (!writeBoard()) layout[key] = previous;
    paintFloor();
  };
  function snapshot() {
    const positions = {...layout.positions};
    cards.forEach(({position}, id) => { positions[id] = position; });
    return normalizeBoard({...layout, positions}, studentIds);
  }

  const archiveDialog = $('boardArchiveDialog');
  const archiveStatus = $('boardArchiveStatus');
  const archiveName = $('boardArchiveName');
  const archives = () => Array.isArray(group.boardArchives) ? group.boardArchives : [];

  function addArchive(name, board) {
    const previous = group.boardArchives;
    if (archives().length >= 50) {
      archiveStatus.textContent = 'Tu as atteint 50 sauvegardes pour cette classe.';
      return false;
    }
    group.boardArchives = [...archives(), {id: uid(), name, board}];
    if (save()) return true;
    group.boardArchives = previous;
    archiveStatus.textContent = 'La sauvegarde n’a pas pu être enregistrée sur cet appareil.';
    return false;
  }

  function listArchives() {
    const list = $('boardArchiveList');
    list.replaceChildren();
    for (const entry of [...archives()].reverse()) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = entry.name;
      const open = document.createElement('button');
      open.textContent = 'Ouvrir';
      open.setAttribute('aria-label', `Ouvrir la sauvegarde ${entry.name}`);
      open.onclick = () => {
        if (!confirm('Ouvrir cette copie à la place du tableau affiché ? Les copies enregistrées restent disponibles.')) return;
        const previous = group.board;
        group.board = normalizeBoard(entry.board, studentIds);
        if (save()) render();
        else group.board = previous;
      };
      const remove = document.createElement('button');
      remove.textContent = 'Supprimer';
      remove.setAttribute('aria-label', `Supprimer la sauvegarde ${entry.name}`);
      remove.onclick = () => {
        if (!confirm(`Supprimer la sauvegarde « ${entry.name} » ?`)) return;
        const previous = group.boardArchives;
        group.boardArchives = previous.filter(copy => copy !== entry);
        if (save()) listArchives();
        else group.boardArchives = previous;
      };
      item.append(name, open, remove);
      list.append(item);
    }
  }

  $('boardArchives').onclick = () => {
    archiveName.value = '';
    archiveStatus.textContent = '';
    listArchives();
    archiveDialog.showModal();
  };
  $('boardCloseArchive').onclick = () => archiveDialog.close();
  $('boardSaveCurrent').onclick = () => {
    const previous = layout.positions;
    layout.positions = snapshot().positions;
    if (!writeBoard()) {
      layout.positions = previous;
      archiveStatus.textContent = 'Enregistrement impossible sur cet appareil.';
      return;
    }
    archiveDialog.close();
    notify('Tableau enregistré dans la classe.');
  };
  $('boardSaveCopy').onsubmit = event => {
    event.preventDefault();
    const name = archiveName.value.trim();
    if (!name) return;
    if (!saveAsNewBoard(name, snapshot())) {
      archiveStatus.textContent = 'Enregistrement impossible sur cet appareil.';
      return;
    }
    archiveName.value = '';
    archiveStatus.textContent = `« ${name} » est disponible dans les tableaux de la classe.`;
  };
  $('boardDownload').onclick = () => {
    const name = archiveName.value.trim() || `Tableau du ${new Date().toLocaleDateString('fr-FR')}`;
    const data = {format: 'mon-tableau-blanc', version: 1, classId, name, board: snapshot()};
    download(`MonTableauBlanc-${group.name.replace(/[^a-z0-9_-]/gi, '_')}-${today()}.json`, JSON.stringify(data), 'application/json');
  };
  $('boardUpload').onclick = () => $('boardArchiveFile').click();
  $('boardArchiveFile').onchange = async event => {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 1000000) throw Error('Ce fichier est trop volumineux.');
      const data = JSON.parse(await file.text());
      if (data?.format !== 'mon-tableau-blanc' || data.version !== 1 ||
          !data.board || !Object.hasOwn(BOARD_BACKGROUNDS, data.board.background) ||
          typeof data.name !== 'string' || !data.name.trim()) throw Error('Choisis un fichier de tableau Mon Tableau Blanc.');
      if (data.classId !== classId) throw Error('Ouvre la classe d’origine pour importer ce tableau.');
      if (addArchive(data.name.trim().slice(0, 80), normalizeBoard(data.board, studentIds))) {
        listArchives();
        archiveStatus.textContent = 'Fichier importé. Choisis « Ouvrir » pour afficher cette copie.';
      }
    } catch (error) {
      archiveStatus.textContent = error instanceof SyntaxError ? 'Le fichier de tableau est illisible.' : error.message;
    } finally {
      input.value = '';
    }
  };
  paintFloor();
  showStudents();
  showMarks();
  paintInk();
  paintReference();
}
