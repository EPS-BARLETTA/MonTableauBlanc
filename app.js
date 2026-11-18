'use strict';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const STORAGE_KEY = 'mon-tableau-blanc-v1';
const MAX_OPEN_BOARDS = 4;
const content = $('content');
const cover = content.innerHTML;
let classes = [];
let canReadStorage = true;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(saved)) throw Error('Format incorrect');
  classes = saved.map(group => {
    if (Array.isArray(group.boards)) return group;
    const {board, boardArchives, ...rest} = group;
    return {...rest, boards: [{id: 'principal', name: 'Tableau principal', board, boardArchives}]};
  });
} catch {
  canReadStorage = false;
}

let noticeTimer;
function notify(message) {
  const notice = $('appNotice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3800);
}

function save(reportError = notify) {
  try {
    if (!canReadStorage) throw Error('Lecture du stockage impossible');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classes));
    return true;
  } catch (error) {
    reportError(error.name === 'QuotaExceededError'
      ? 'Le stockage de ce navigateur est plein. Les modifications n’ont pas été enregistrées.'
      : 'Enregistrement impossible dans ce navigateur.');
    return false;
  }
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function classRoute(group) {
  return `#classe/${group.id}`;
}

function boardRoute(group, board) {
  return `${classRoute(group)}/tableau/${board.id}`;
}

function createNamedBoard(group, name, board) {
  const entry = {id: uid(), name, board};
  group.boards.push(entry);
  if (save()) return entry;
  group.boards.pop();
}

function openBoardView(group, boards) {
  if (boards.length === 1) location.hash = boardRoute(group, boards[0]);
  else if (boards.length) location.hash = `${classRoute(group)}/tableaux/${boards.map(board => board.id).join(',')}`;
  else location.hash = classRoute(group);
}

function rememberSession(group, boards) {
  const previous = group.sessionBoards;
  const ids = boards.map(board => board.id);
  if (JSON.stringify(previous) === JSON.stringify(ids)) return true;
  group.sessionBoards = ids;
  if (save()) return true;
  group.sessionBoards = previous;
  return false;
}

function renderBoardDirectory(group) {
  const session = (group.sessionBoards || []).map(id => group.boards.find(board => board.id === id)).filter(Boolean);
  const resume = session.length ? session : group.boards.slice(0, MAX_OPEN_BOARDS);
  content.innerHTML = `<section class="route">
    <a class="back-link" href="#classes">← Mes classes</a>
    <div class="route-head">
      <h1>${esc(group.name)}</h1>
      <div class="class-nav-actions">
        ${resume.length > 1 || session.length ? `<button id="resumeSession" class="primary" type="button">${session.length ? 'Reprendre la séance' : 'Ouvrir les tableaux ensemble'} · ${resume.length}</button>` : ''}
        <a href="${classRoute(group)}/eleves">Élèves et trombinoscope</a>
        <button id="newBoard" class="primary" type="button">+ Nouveau tableau</button>
      </div>
    </div>
    ${group.boards.length ? `<div class="class-grid">${group.boards.map(board => `<div class="board-directory-card">
      <a href="${boardRoute(group, board)}">${esc(board.name)}</a>
      <button class="board-delete danger" type="button" data-delete-board="${esc(board.id)}"
        aria-label="Supprimer ${esc(board.name)}" title="Supprimer le tableau">×</button>
    </div>`).join('')}</div>` : '<p>Aucun tableau dans cette classe.</p>'}
    <dialog id="newBoardDialog" aria-labelledby="newBoardTitle">
      <h2 id="newBoardTitle">Nouveau tableau</h2>
      <form id="createBoard">
        <label for="newBoardName">Nom du tableau</label>
        <input id="newBoardName" maxlength="80" placeholder="Ex. Badminton" required autofocus>
        <div class="actions">
          <button id="cancelNewBoard" type="button">Annuler</button>
          <button class="primary" type="submit">Créer le tableau</button>
        </div>
      </form>
    </dialog>
  </section>`;
  const dialog = $('newBoardDialog');
  const resumeButton = $('resumeSession');
  if (resumeButton) resumeButton.onclick = () => openBoardView(group, resume);
  const input = $('newBoardName');
  $('newBoard').onclick = () => dialog.showModal();
  $('cancelNewBoard').onclick = () => dialog.close();
  $('createBoard').onsubmit = event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const board = createNamedBoard(group, name);
    if (board) openBoardView(group, [board]);
  };
  for (const button of content.querySelectorAll('[data-delete-board]')) {
    button.onclick = () => {
      const previous = group.boards;
      const board = previous.find(item => item.id === button.dataset.deleteBoard);
      if (!confirm(`Supprimer définitivement « ${board.name} » et ses sauvegardes ?`)) return;
      group.boards = previous.filter(item => item !== board);
      if (save()) {
        renderBoardDirectory(group);
        $('newBoard').focus({preventScroll: true});
      } else group.boards = previous;
    };
  }
}

function renderOpenBoards(group, boards) {
  const students = [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const multiple = boards.length > 1;
  const canAddBoard = boards.length < MAX_OPEN_BOARDS;
  const available = group.boards.filter(board => !boards.includes(board));
  content.innerHTML = `<div class="class-nav">
    <a href="${classRoute(group)}">← Tableaux de ${esc(group.name)}</a>
    <h1>${esc(multiple ? group.name : boards[0].name)}</h1>
    <div class="class-nav-actions">
      <button id="saveSession" type="button">Enregistrer la séance</button>
      <button id="captureSession" type="button">Capture PNG</button>
      ${canAddBoard ? '<button id="addOpenBoard" class="primary" type="button">+ Ajouter un tableau</button>' : '<span class="muted">4 tableaux ouverts</span>'}
      ${canAddBoard && available.length ? `<select id="openSavedBoard" aria-label="Ouvrir un tableau enregistré">
        <option value="">Ouvrir un tableau enregistré</option>
        ${available.map(board => `<option value="${esc(board.id)}">${esc(board.name)}</option>`).join('')}
      </select>` : ''}
      <a href="${classRoute(group)}/eleves">Gérer les élèves</a>
    </div>
  </div><div class="open-boards${multiple ? ' open-boards-multiple' : ''}"></div>`;
  if (multiple) rememberSession(group, boards);
  $('saveSession').onclick = () => {
    if (rememberSession(group, boards)) notify('Séance enregistrée. Retrouve-la depuis la page de la classe.');
  };
  if (canAddBoard) {
    $('addOpenBoard').onclick = event => {
      let number = group.boards.length + 1;
      const names = new Set(group.boards.map(board => board.name));
      while (names.has(`Tableau ${number}`)) number++;
      const board = createNamedBoard(group, `Tableau ${number}`);
      if (!board) return;
      event.currentTarget.disabled = true;
      openBoardView(group, [...boards, board]);
    };
  }
  const savedPicker = $('openSavedBoard');
  if (savedPicker) {
    savedPicker.onchange = () => {
      const board = available.find(item => item.id === savedPicker.value);
      if (board) openBoardView(group, [...boards, board]);
    };
  }
  const grid = content.querySelector('.open-boards');
  $('captureSession').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const image = await captureBoardSession(grid, group.name, boards.map(board => board.name));
      download(`Seance-${group.name.replace(/[^a-z0-9_-]/gi, '_')}-${today()}.png`, image, 'image/png');
    } catch {
      notify('La capture PNG n’a pas pu être créée.');
    } finally {
      button.disabled = false;
    }
  };
  for (const board of boards) {
    const container = document.createElement('div');
    grid.append(container);
    renderClassBoard(board, students, group.id, container, multiple,
      (name, layout) => createNamedBoard(group, name, layout),
      () => openBoardView(group, boards.filter(item => item !== board)));
  }
}

function renderMenu() {
  content.innerHTML = `<section class="route">
    <h1>Mes tableaux de classe</h1>
    <div class="menu-grid">
      <a class="menu-card" href="#classes"><span class="menu-icon" aria-hidden="true">▦</span><h2>Mes classes</h2><p>Retrouve tes classes et leurs tableaux.</p></a>
      <a class="menu-card" href="#creer"><span class="menu-icon" aria-hidden="true">+</span><h2>Créer une classe</h2><p>Importe un trombinoscope PRONOTE ou saisis une liste.</p></a>
    </div>
  </section>`;
}

function renderDirectory() {
  content.innerHTML = `<section class="route">
    <div class="route-head"><h1>Mes classes</h1><a class="primary action" href="#creer">Créer une classe</a></div>
    ${classes.length ? `<div class="class-grid">${classes.map(group => `<a class="menu-card class-tile" href="${classRoute(group)}">
      <h2>${esc(group.name)}</h2><p>${group.students.length} élève${group.students.length === 1 ? '' : 's'} · ${group.boards.length} tableau${group.boards.length === 1 ? '' : 'x'}</p>
    </a>`).join('')}</div>` : '<p>Aucune classe pour le moment. Tu peux en créer une avec ton trombinoscope.</p>'}
  </section>`;
}

function renderClassForm(group) {
  const heading = group ? 'Élèves de ' + group.name : 'Créer une classe';
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="${group ? classRoute(group) : '#accueil'}">← ${group ? 'Tableaux de la classe' : 'Accueil'}</a>
    <h1>${esc(heading)}</h1>
    <form id="classForm" class="card">
      <label for="className">Nom de la classe</label>
      <input id="className" maxlength="80" required value="${esc(group?.name || '')}" placeholder="Ex. 6e B">
      <div class="roster-import">
        <button id="importPortraits" class="primary" type="button">Importer un trombinoscope</button>
        <input type="file" id="pictureInput" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden>
        <p class="muted">Choisis une capture PRONOTE en JPG ou PNG, avec les photos et les noms visibles. Les portraits restent sur l’appareil.</p>
      </div>
      ${group ? '<h2>Liste des élèves</h2><ul id="rosterPreview" class="roster-preview"></ul>' : ''}
      <label for="manualNames">${group ? 'Ajouter des élèves à la liste' : 'Saisir les élèves à la main'}</label>
      <textarea id="manualNames" rows="4" placeholder="Un nom et un prénom par ligne"></textarea>
      <button class="${group ? 'primary' : ''}" type="submit">${group ? 'Enregistrer' : 'Créer la classe'}</button>
    </form>
  </section>`;
  const name = $('className');
  const file = $('pictureInput');

  function validName() {
    name.setCustomValidity(name.value.trim() ? '' : 'Indique le nom de la classe.');
    return name.reportValidity();
  }

  name.oninput = () => name.setCustomValidity('');

  function paintRoster() {
    const list = $('rosterPreview');
    if (!list) return;
    list.replaceChildren(...group.students.map(student => {
      const item = document.createElement('li');
      item.append(RosterPortraits.photo(student.portrait), document.createTextNode(student.name));
      return item;
    }));
  }

  function saveRoster(students, reportError) {
    const previous = classes;
    const updated = {...group, id: group?.id || uid(), name: name.value.trim(), students,
      boards: group?.boards || [{id: 'principal', name: 'Tableau principal'}]};
    classes = group ? classes.map(c => c.id === group.id ? updated : c) : [...classes, updated];
    if (!save(reportError)) {
      classes = previous;
      return false;
    }
    if (group) Object.assign(group, updated);
    else location.hash = classRoute(updated);
    return true;
  }

  $('importPortraits').onclick = () => { if (validName()) file.click(); };
  file.onchange = () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    RosterPortraits.importRoster({
      file: selected,
      className: group ? '' : name.value.trim(),
      items: group?.students.map(student => ({...student, line: student.name})) || [],
      itemName: line => ({name: line}),
      save(items, reportError) {
        const students = items.map(item => ({
          id: item.id || uid(), name: item.line,
          ...(validRosterPortrait(item.portrait) ? {portrait: item.portrait} : {}),
        }));
        if (!saveRoster(students, reportError)) return false;
        items.forEach((item, index) => { item.id = students[index].id; });
        paintRoster();
        notify('Trombinoscope enregistré.');
        return true;
      },
    });
  };

  $('classForm').onsubmit = event => {
    event.preventDefault();
    if (!validName()) return;
    const students = [...(group?.students || [])];
    const names = new Set(students.map(student => portraitNameKey(student.name)));
    for (const line of $('manualNames').value.split(/\r?\n/)) {
      const cleaned = line.trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = portraitNameKey(cleaned);
      if (!key || names.has(key)) continue;
      names.add(key);
      students.push({id: uid(), name: cleaned});
    }
    if (!students.length && !group) {
      notify('Ajoute au moins un élève, ou importe le trombinoscope.');
      return;
    }
    if (saveRoster(students) && group) location.hash = classRoute(group);
  };
  paintRoster();
}

function render() {
  const [page, id, subpage, boardId] = location.hash.slice(1).split('/');
  $('navHome').hidden = !page || page === 'accueil';
  if (!page) {
    content.innerHTML = cover;
  } else if (page === 'creer') {
    renderClassForm();
  } else if (page === 'classes') {
    renderDirectory();
  } else if (page === 'classe') {
    const group = classes.find(c => c.id === id);
    if (!group) {
      renderDirectory();
    } else if (subpage === 'eleves') {
      renderClassForm(group);
    } else {
      const ids = subpage === 'tableaux' ? (boardId || '').split(',').slice(0, MAX_OPEN_BOARDS)
        : subpage === 'tableau' ? [boardId] : [];
      const boards = [...new Set(ids)].map(id => group.boards.find(board => board.id === id)).filter(Boolean);
      if (boards.length) renderOpenBoards(group, boards);
      else renderBoardDirectory(group);
    }
  } else {
    renderMenu();
  }
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
