'use strict';

const SESSION_FILE_LIMIT = 100 * 1024 * 1024;
const sessionFileFormat = 'mon-tableau-blanc-seance';
const sessionIdentifier = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);

function sessionDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function downloadSessionFile(group, name, panels) {
  const studentIds = group.students.map(student => student.id);
  const documents = new Map();
  function exportLayout(layout) {
    const normalized = normalizeBoard(layout || {}, studentIds);
    if (normalized.reference) documents.set(normalized.reference.id, normalized.reference.type);
    return normalized;
  }

  const boards = panels.map(panel => ({
    name: panel.name,
    board: exportLayout(panel.board),
    boardArchives: (panel.boardArchives || []).map(copy => ({...copy, board: exportLayout(copy.board)})),
  }));
  const assets = [];
  for (const [id, type] of documents) {
    const blob = await boardFileTransaction('readonly', store => store.get(id));
    if (!blob) throw Error('Un barème de la séance est introuvable. Réimporte-le avant d’exporter.');
    assets.push({id, type, data: await sessionDataUrl(blob)});
  }
  const data = new Blob([JSON.stringify({
    format: sessionFileFormat, version: 1, name, classId: group.id, students: group.students, boards, assets,
  })], {type: 'application/json'});
  if (data.size > SESSION_FILE_LIMIT) throw Error('Le fichier de séance dépasse 100 Mo.');
  const filename = name.replace(/[\\/:*?"<>|]/g, '-');
  download(`${filename}.json`, data, 'application/json');
}

async function importSessionFile(file, group) {
  if (file.size > SESSION_FILE_LIMIT) throw Error('Le fichier de séance dépasse 100 Mo.');
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { throw Error('Ce fichier de séance est illisible.'); }
  if (data?.format !== sessionFileFormat || data.version !== 1 || typeof data.name !== 'string' || !data.name.trim() ||
      !Array.isArray(data.boards) || !data.boards.length || !Array.isArray(data.students) || !Array.isArray(data.assets)) {
    throw Error('Choisis un fichier de séance créé par Mon Tableau Blanc.');
  }

  const students = [...group.students];
  const studentMap = new Map();
  const assigned = new Set();
  for (const source of data.students) {
    if (!sessionIdentifier(source?.id) || studentMap.has(source.id) || typeof source.name !== 'string' || !source.name.trim()) {
      throw Error('La liste des élèves du fichier est invalide.');
    }
    const name = source.name.trim().slice(0, 120);
    const key = portraitNameKey(name);
    const exact = data.classId === group.id && students.find(student => student.id === source.id && !assigned.has(student.id));
    const matches = students.filter(student => portraitNameKey(student.name) === key && !assigned.has(student.id));
    const match = exact || (matches.length === 1 && matches[0]);
    const portrait = validRosterPortrait(source.portrait) ? source.portrait : null;
    const student = match || {id: uid(), name, ...(portrait ? {portrait} : {})};
    if (!match) students.push(student);
    else if (portrait && !validRosterPortrait(match.portrait)) {
      const index = students.indexOf(match);
      students[index] = {...match, portrait};
    }
    studentMap.set(source.id, student.id);
    assigned.add(student.id);
  }

  const assets = new Map();
  for (const asset of data.assets) {
    if (!sessionIdentifier(asset?.id) || assets.has(asset.id) || !BOARD_REFERENCE_TYPES.includes(asset.type) ||
        typeof asset.data !== 'string' || !asset.data.startsWith(`data:${asset.type};base64,`)) {
      throw Error('Un document du fichier est invalide.');
    }
    const bytes = Uint8Array.from(atob(asset.data.split(',')[1]), char => char.charCodeAt(0));
    if (bytes.length > BOARD_REFERENCE_LIMIT || boardReferenceType(bytes.subarray(0, 8)) !== asset.type) {
      throw Error('Un document du fichier est invalide.');
    }
    assets.set(asset.id, {id: uid(), blob: new Blob([bytes], {type: asset.type})});
  }

  function importLayout(raw) {
    const layout = normalizeBoard(raw || {}, [...studentMap.keys()]);
    layout.positions = Object.fromEntries(Object.entries(layout.positions).map(([id, position]) => [studentMap.get(id), position]));
    layout.studentIds = (layout.studentIds || [...studentMap.keys()]).map(id => studentMap.get(id));
    layout.absentIds = layout.absentIds.map(id => studentMap.get(id));
    for (const mark of layout.marks) {
      if (mark.studentId) mark.studentId = studentMap.get(mark.studentId);
    }
    if (layout.reference) {
      const asset = assets.get(layout.reference.id);
      if (!asset || asset.blob.type !== layout.reference.type) throw Error('Il manque un document dans le fichier.');
      layout.reference.id = asset.id;
    }
    return layout;
  }

  const [session, ...panels] = data.boards.map(board => {
    if (!board || typeof board.name !== 'string' || !board.name.trim() || !board.board) throw Error('Un tableau du fichier est invalide.');
    return {id: uid(), name: board.name.trim().slice(0, 80), board: importLayout(board.board),
      boardArchives: (Array.isArray(board.boardArchives) ? board.boardArchives : []).filter(copy =>
        copy && typeof copy.name === 'string' && copy.board).map(copy => ({
        id: uid(), name: copy.name.slice(0, 80), board: importLayout(copy.board),
      }))};
  });
  session.name = data.name.trim().slice(0, 80);
  session.panels = panels;
  if (assets.size) {
    await boardFileTransaction('readwrite', store => {
      let request;
      for (const {id, blob} of assets.values()) request = store.put(blob, id);
      return request;
    });
  }
  const previousStudents = group.students;
  group.students = students;
  group.boards.push(session);
  if (save()) return session;
  group.students = previousStudents;
  group.boards.pop();
  if (assets.size) {
    await boardFileTransaction('readwrite', store => {
      let request;
      for (const {id} of assets.values()) request = store.delete(id);
      return request;
    });
  }
}
