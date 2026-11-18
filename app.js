'use strict';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const STORAGE_KEY = 'mon-tableau-blanc-v1';
const content = $('content');
const cover = content.innerHTML;
let classes = [];
let canReadStorage = true;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(saved)) throw Error('Format incorrect');
  classes = saved;
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

function save() {
  try {
    if (!canReadStorage) throw Error('Lecture du stockage impossible');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classes));
    return true;
  } catch {
    notify('Enregistrement impossible dans ce navigateur.');
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
    ${classes.length ? `<div class="class-grid">${classes.map(group => `<a class="menu-card" href="${classRoute(group)}">
      <h2>${esc(group.name)}</h2><p>${group.students.length} élève${group.students.length === 1 ? '' : 's'}</p>
    </a>`).join('')}</div>` : '<p>Aucune classe pour le moment. Tu peux en créer une avec ton trombinoscope.</p>'}
  </section>`;
}

function renderClassForm(group) {
  const heading = group ? 'Élèves de ' + group.name : 'Créer une classe';
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="${group ? classRoute(group) : '#accueil'}">← ${group ? 'Tableau de classe' : 'Accueil'}</a>
    <h1>${esc(heading)}</h1>
    <form id="classForm" class="card">
      <label for="className">Nom de la classe</label>
      <input id="className" maxlength="80" required value="${esc(group?.name || '')}" placeholder="Ex. 6e B">
      <div class="roster-import">
        <button id="importPortraits" class="primary" type="button">Importer un trombinoscope</button>
        <input type="file" id="pictureInput" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden>
        <p class="muted">Choisis une capture PRONOTE avec les photos et les noms visibles. Les portraits restent sur l’appareil.</p>
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

  function saveRoster(students) {
    const previous = classes;
    const updated = {...group, id: group?.id || uid(), name: name.value.trim(), students};
    classes = group ? classes.map(c => c.id === group.id ? updated : c) : [...classes, updated];
    if (!save()) {
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
      items: group?.students.map(student => ({...student, line: student.name})) || [],
      itemName: line => ({name: line}),
      save(items) {
        const students = items.map(item => ({
          id: item.id || uid(), name: item.line,
          ...(validRosterPortrait(item.portrait) ? {portrait: item.portrait} : {}),
        }));
        if (!saveRoster(students)) return false;
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
  const [page, id, subpage] = location.hash.slice(1).split('/');
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
      const students = [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      renderClassBoard(group, students);
      const bar = document.createElement('div');
      bar.className = 'class-nav';
      bar.innerHTML = `<a href="#classes">← Mes classes</a><h1>${esc(group.name)}</h1><a href="${classRoute(group)}/eleves">Gérer les élèves</a>`;
      content.prepend(bar);
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
