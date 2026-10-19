if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#ru`);
if (window.location.hash.toLowerCase() === '#ru') localStorage.setItem('language', 'ru');

const partyApp = document.querySelector('.party-app');
const modeChooser = document.querySelector('#modeChooser');
const createParty = document.querySelector('#createParty');
const loginOverlay = document.querySelector('#loginOverlay');
const loginForm = document.querySelector('#loginForm');
const loginEmail = document.querySelector('#loginEmail');
const loginPassword = document.querySelector('#loginPassword');
const loginError = document.querySelector('#loginError');
const finderSections = [...document.querySelectorAll('#finder, .party-app > .workspace, #how-it-works')];
const authKey = 'partyFinder.demoSession.v3';
const demoEmail = 'demo@party.local';
const demoPassword = 'Party2026!';
let pendingMode = null;
let lastModeTrigger = null;

function updateModeUrl(mode) {
  const url = new URL(window.location.href);
  if (mode) url.searchParams.set('mode', mode);
  else url.searchParams.delete('mode');
  window.history.pushState({mode}, '', url);
}

function closeLogin() {
  loginOverlay.hidden = true;
  document.body.classList.remove('login-open');
  loginForm.reset();
  loginError.hidden = true;
  lastModeTrigger?.focus();
}

function showModeChooser(updateUrl = true) {
  closeLogin();
  partyApp.classList.remove('mode-find', 'mode-create');
  partyApp.classList.add('mode-select');
  modeChooser.hidden = false;
  createParty.hidden = true;
  document.querySelector('#finderBack').hidden = true;
  finderSections.forEach(section => { section.hidden = true; });
  if (updateUrl) updateModeUrl(null);
  window.scrollTo(0, 0);
}

function showSelectedMode(mode, updateUrl = true) {
  closeLogin();
  partyApp.classList.remove('mode-select', 'mode-find', 'mode-create');
  partyApp.classList.add(`mode-${mode}`);
  modeChooser.hidden = true;
  createParty.hidden = mode !== 'create';
  document.querySelector('#finderBack').hidden = mode !== 'find';
  finderSections.forEach(section => {
    section.hidden = mode !== 'find' || section.id === 'results';
  });
  if (updateUrl) updateModeUrl(mode);
  window.scrollTo(0, 0);
}

function selectMode(mode, trigger) {
  lastModeTrigger = trigger;
  pendingMode = mode;
  if (sessionStorage.getItem(authKey) === 'demo') {
    showSelectedMode(mode);
    return;
  }
  document.querySelector('#loginContext').textContent = mode === 'find'
    ? 'Войди, чтобы увидеть пати, которым нужен твой класс.'
    : 'Войди, чтобы открыть набор игроков в свою пати.';
  loginOverlay.hidden = false;
  document.body.classList.add('login-open');
  loginEmail.focus();
}

document.querySelector('#findMode').addEventListener('click', event => selectMode('find', event.currentTarget));
document.querySelector('#createMode').addEventListener('click', event => selectMode('create', event.currentTarget));
document.querySelector('#backToModes').addEventListener('click', () => showModeChooser());
document.querySelector('#finderBack').addEventListener('click', () => showModeChooser());
document.querySelector('#loginClose').addEventListener('click', closeLogin);
document.querySelector('#loginBackdrop').addEventListener('click', closeLogin);
document.querySelector('#fillDemoLogin').addEventListener('click', () => {
  loginEmail.value = demoEmail;
  loginPassword.value = demoPassword;
  loginError.hidden = true;
  loginPassword.focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !loginOverlay.hidden) closeLogin();
});
loginForm.addEventListener('submit', event => {
  event.preventDefault();
  if (loginEmail.value.trim().toLowerCase() !== demoEmail || loginPassword.value !== demoPassword) {
    loginError.hidden = false;
    loginPassword.focus();
    return;
  }
  sessionStorage.setItem(authKey, 'demo');
  showSelectedMode(pendingMode || 'find');
});
const initialMode = new URL(window.location.href).searchParams.get('mode');
if (sessionStorage.getItem(authKey) === 'demo' && ['find', 'create'].includes(initialMode)) {
  showSelectedMode(initialMode, false);
} else {
  showModeChooser(false);
  if (['find', 'create'].includes(initialMode)) selectMode(initialMode, document.querySelector(initialMode === 'find' ? '#findMode' : '#createMode'));
}
window.addEventListener('popstate', () => {
  const mode = new URL(window.location.href).searchParams.get('mode');
  if (sessionStorage.getItem(authKey) === 'demo' && ['find', 'create'].includes(mode)) showSelectedMode(mode, false);
  else showModeChooser(false);
});

const createDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const classCards = [...document.querySelectorAll('.class-card')];
const classNames = classCards.map(card => card.dataset.class);
const classCodeByName = new Map(classCards.map(card => [card.dataset.class, card.dataset.short]));
const servers = [
  {id:'bartz', name:'Bartz', rate:'x3', chronicle:'Hellbound'},
  {id:'teon', name:'Teon', rate:'x1', chronicle:'Hellbound'},
  {id:'erica', name:'Erica', rate:'x3', chronicle:'Interlude'}
];
let selectedServerId = '';
const leaderCharacterSelect = document.querySelector('#leaderCharacter');
const findCharacterSelect = document.querySelector('#findCharacter');
// Demo account data. Replace this source with the authenticated profile API later.
const demoCharacters = [
  {id:'char-101', serverId:'bartz', name:'Kain', className:'Warcryer', level:78},
  {id:'char-102', serverId:'bartz', name:'Mirael', className:'Paladin', level:76},
  {id:'char-103', serverId:'bartz', name:'Elyria', className:'Bishop', level:74},
  {id:'char-104', serverId:'bartz', name:'Ardent', className:'Gladiator', level:79},
  {id:'char-105', serverId:'bartz', name:'Lunara', className:'Spellsinger', level:77},
  {id:'char-201', serverId:'teon', name:'Rhett', className:'Dark Avenger', level:72},
  {id:'char-202', serverId:'teon', name:'Serena', className:'Elven Elder', level:73},
  {id:'char-203', serverId:'teon', name:'Torvik', className:'Destroyer', level:75},
  {id:'char-204', serverId:'teon', name:'Shade', className:'Treasure Hunter', level:74},
  {id:'char-205', serverId:'teon', name:'Aether', className:'Sorcerer', level:76},
  {id:'char-301', serverId:'erica', name:'Selene', className:'Shillien Elder', level:74},
  {id:'char-302', serverId:'erica', name:'Varyn', className:'Warlord', level:77},
  {id:'char-303', serverId:'erica', name:'Neris', className:'Necromancer', level:76},
  {id:'char-304', serverId:'erica', name:'Lyra', className:'Swordsinger', level:75},
  {id:'char-305', serverId:'erica', name:'Morrin', className:'Phantom Summoner', level:73}
];
const charactersById = new Map(demoCharacters.map(character => [character.id, character]));
function selectedLeaderCharacter() { return charactersById.get(leaderCharacterSelect.value); }
function selectedFindCharacter() { return charactersById.get(findCharacterSelect.value); }
const memberList = document.querySelector('#memberList');
const vacancyList = document.querySelector('#vacancyList');
const rosterCount = document.querySelector('#rosterCount');
const createFormError = document.querySelector('#createFormError');
function vacanciesWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return 'вакансия';
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'вакансии';
  return 'вакансий';
}
function populateCharacterSelect(select) {
  select.replaceChildren(new Option(selectedServerId ? 'Выбери персонажа' : 'Сначала выбери сервер', ''));
  select.disabled = !selectedServerId;
  demoCharacters.filter(character => character.serverId === selectedServerId).forEach(character => {
    select.add(new Option(`${character.name} · ${character.className} · ${character.level} ур.`, character.id));
  });
  select.dispatchEvent(new Event('change'));
}
function chooseServer(serverId) {
  selectedServerId = serverId;
  document.querySelectorAll('.server-option').forEach(button => {
    const active = button.dataset.server === serverId;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  populateCharacterSelect(leaderCharacterSelect);
  populateCharacterSelect(findCharacterSelect);
  document.querySelector('#results').hidden = true;
  document.querySelector('#createdPreview').hidden = true;
}
for (const container of document.querySelectorAll('.server-options')) {
  servers.forEach(server => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'server-option';
    button.dataset.server = server.id;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="server-option-top"><strong>${server.name}</strong><b>${server.rate}</b></span><small>${server.chronicle}</small><span class="server-option-check" aria-hidden="true">✓</span>`;
    button.addEventListener('click', () => chooseServer(server.id));
    container.appendChild(button);
  });
}
leaderCharacterSelect.addEventListener('change', () => {
  const character = selectedLeaderCharacter();
  const details = document.querySelector('#selectedCharacter');
  details.hidden = !character;
  document.querySelector('#leaderCharacterDisplay').textContent = character
    ? `${character.name} · ${character.className}`
    : 'Персонаж не выбран';
  if (!character) return;
  document.querySelector('#characterServer').textContent = `ПЕРСОНАЖ · ${servers.find(server => server.id === character.serverId).name.toUpperCase()}`;
  document.querySelector('#characterMark').textContent = character.name[0];
  document.querySelector('#characterName').textContent = character.name;
  document.querySelector('#characterClass').textContent = character.className;
  document.querySelector('#characterLevel').textContent = character.level;
});

function classSelect(label, anyAllowed = false) {
  const select = document.createElement('select');
  select.className = 'roster-class-select';
  select.setAttribute('aria-label', label);
  select.dataset.anyAllowed = String(anyAllowed);
  select.add(new Option(anyAllowed ? 'Любой класс' : 'Выбери класс', ''));
  classNames.forEach(name => select.add(new Option(name, name)));
  return select;
}
function enhanceClassSelect(select) {
  new TomSelect(select, {
    create: false,
    maxItems: 1,
    maxOptions: classNames.length + 1,
    searchField: ['text'],
    placeholder: select.dataset.anyAllowed === 'true' ? 'Любой класс · введи для поиска' : 'Введи или выбери класс',
    render: {
      no_results: (data, escape) => `<div class="no-results">Класс «${escape(data.input)}» не найден</div>`
    }
  });
}
function rosterInput(label, type, placeholder, min, max) {
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('aria-label', label);
  input.placeholder = placeholder;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  return input;
}
function labeledRosterInput(label, input) {
  const wrapper = document.createElement('label');
  wrapper.className = 'roster-field';
  const caption = document.createElement('span'); caption.textContent = label;
  wrapper.append(caption, input);
  return wrapper;
}
function updateRoster() {
  const members = memberList.children.length;
  const vacancies = vacancyList.children.length;
  const remaining = 8 - members - vacancies;
  document.querySelector('#addMember').disabled = remaining <= 0;
  document.querySelector('#addVacancy').disabled = remaining <= 0;
  document.querySelector('#openSlotCount').textContent = vacancies;
  document.querySelector('#openSlotLabel').textContent = `${vacanciesWord(vacancies)} для набора`;
  rosterCount.textContent = `В пати ${members + 1} / 9 · ищем ${vacancies} · ещё не распределено ${remaining}`;
  [...memberList.children, ...vacancyList.children].forEach((row, index) => {
    row.querySelector('.create-slot-number').textContent = String(index + 2).padStart(2, '0');
  });
  createFormError.hidden = true;
}
function addMember() {
  if (memberList.children.length + vacancyList.children.length >= 8) return;
  const row = document.createElement('div');
  row.className = 'roster-row member-row';
  const number = document.createElement('span'); number.className = 'create-slot-number';
  const select = classSelect('Класс игрока в пати');
  const name = rosterInput('Имя персонажа в пати', 'text', 'Имя персонажа'); name.maxLength = 24; name.className = 'member-name';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'roster-remove'; remove.setAttribute('aria-label', 'Убрать игрока из состава'); remove.textContent = '×';
  remove.addEventListener('click', () => { select.tomselect?.destroy(); row.remove(); updateRoster(); });
  row.append(number, select, name, remove);
  memberList.appendChild(row);
  enhanceClassSelect(select);
  updateRoster();
}
function addVacancy() {
  if (memberList.children.length + vacancyList.children.length >= 8) return;
  const row = document.createElement('div');
  row.className = 'roster-row vacancy-row';
  const number = document.createElement('span'); number.className = 'create-slot-number';
  const select = classSelect('Кого ищем: класс', true);
  const min = rosterInput('Минимальный уровень', 'number', 'Мин. ур.', 1, 80); min.value = '1'; min.required = true;
  const max = rosterInput('Максимальный уровень', 'number', 'Макс. ур.', 1, 80); max.value = '80'; max.required = true;
  for (const input of [min, max]) input.addEventListener('input', () => max.setCustomValidity(''));
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'roster-remove'; remove.setAttribute('aria-label', 'Убрать вакансию'); remove.textContent = '×';
  remove.addEventListener('click', () => { select.tomselect?.destroy(); row.remove(); updateRoster(); });
  row.append(number, select, labeledRosterInput('МИН.', min), labeledRosterInput('МАКС.', max), remove);
  vacancyList.appendChild(row);
  enhanceClassSelect(select);
  updateRoster();
}
document.querySelector('#addMember').addEventListener('click', addMember);
document.querySelector('#addVacancy').addEventListener('click', addVacancy);
addVacancy();

const createAvailability = createDayNames.map(() => new Set([19, 20, 21]));
const createGrid = document.querySelector('#createScheduleGrid');
const createLabels = document.querySelector('#createTimeLabels');
let createDrag = null;
createDayNames.forEach(day => { const span = document.createElement('span'); span.textContent = day; createLabels.appendChild(span); });
for (let hour = 0; hour < 24; hour++) {
  const row = document.createElement('div'); row.className = 'create-schedule-row';
  const label = document.createElement('span'); label.className = 'create-hour-label'; label.textContent = `${String(hour).padStart(2, '0')}:00`;
  const cells = document.createElement('div'); cells.className = 'create-hours';
  createDayNames.forEach((day, dayIndex) => {
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'create-hour'; cell.dataset.day = dayIndex; cell.dataset.hour = hour;
    cell.setAttribute('aria-label', `${day} ${String(hour).padStart(2, '0')}:00`);
    cell.addEventListener('pointerdown', event => {
      event.preventDefault();
      createDrag = {day:dayIndex, hour, value:!createAvailability[dayIndex].has(hour), base:createAvailability.map(set => new Set(set))};
      createGrid.setPointerCapture(event.pointerId);
      paintCreateRectangle(dayIndex, hour);
    });
    cell.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (createAvailability[dayIndex].has(hour)) createAvailability[dayIndex].delete(hour);
      else createAvailability[dayIndex].add(hour);
      syncCreateGrid();
    });
    cells.appendChild(cell);
  });
  row.append(label, cells); createGrid.appendChild(row);
}
function syncCreateGrid() {
  createGrid.querySelectorAll('.create-hour').forEach(cell => {
    const selected = createAvailability[Number(cell.dataset.day)].has(Number(cell.dataset.hour));
    cell.classList.toggle('on', selected);
    cell.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#createSelectedHours').textContent = createAvailability.reduce((total, set) => total + set.size, 0);
}
function paintCreateRectangle(day, hour) {
  if (!createDrag) return;
  createDrag.base.forEach((set, index) => { createAvailability[index] = new Set(set); });
  for (let d = Math.min(day, createDrag.day); d <= Math.max(day, createDrag.day); d++) {
    for (let h = Math.min(hour, createDrag.hour); h <= Math.max(hour, createDrag.hour); h++) {
      if (createDrag.value) createAvailability[d].add(h);
      else createAvailability[d].delete(h);
    }
  }
  syncCreateGrid();
}
createGrid.addEventListener('pointermove', event => {
  if (!createDrag) return;
  event.preventDefault();
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('.create-hour');
  if (cell && createGrid.contains(cell)) paintCreateRectangle(Number(cell.dataset.day), Number(cell.dataset.hour));
});
window.addEventListener('pointerup', () => { createDrag = null; });
window.addEventListener('pointercancel', () => { createDrag = null; });
syncCreateGrid();

function describeCreateSchedule() {
  const groups = new Map();
  createAvailability.forEach((set, index) => {
    const sorted = [...set].sort((a, b) => a - b);
    if (!sorted.length) return;
    const spans = [];
    let start = sorted[0], end = start;
    sorted.slice(1).forEach(hour => {
      if (hour === end + 1) end = hour;
      else { spans.push(`${String(start).padStart(2, '0')}:00–${String(end + 1).padStart(2, '0')}:00`); start = end = hour; }
    });
    spans.push(`${String(start).padStart(2, '0')}:00–${String(end + 1).padStart(2, '0')}:00`);
    const hours = spans.join(', ');
    if (!groups.has(hours)) groups.set(hours, []);
    groups.get(hours).push(index);
  });
  return [...groups].map(([hours, dayIndexes]) => {
    const dayRanges = [];
    let rangeStart = dayIndexes[0], rangeEnd = rangeStart;
    dayIndexes.slice(1).forEach(day => {
      if (day === rangeEnd + 1) rangeEnd = day;
      else {
        dayRanges.push(rangeStart === rangeEnd ? createDayNames[rangeStart] : `${createDayNames[rangeStart]}–${createDayNames[rangeEnd]}`);
        rangeStart = rangeEnd = day;
      }
    });
    dayRanges.push(rangeStart === rangeEnd ? createDayNames[rangeStart] : `${createDayNames[rangeStart]}–${createDayNames[rangeEnd]}`);
    return `${dayRanges.join(', ')} ${hours}`;
  });
}
document.querySelector('#createPartyForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedServerId) { document.querySelector('#createServerOptions .server-option').focus(); return; }
  const leader = selectedLeaderCharacter();
  if (!leader) { leaderCharacterSelect.focus(); return; }
  const selectedHours = createAvailability.reduce((total, set) => total + set.size, 0);
  if (!selectedHours) {
    createFormError.textContent = 'Отметь хотя бы один час игры в недельной сетке.';
    createFormError.hidden = false;
    createGrid.querySelector('.create-hour').focus();
    return;
  }
  if (!vacancyList.children.length) {
    createFormError.textContent = 'Добавь хотя бы одну вакансию для поиска игроков.';
    createFormError.hidden = false;
    document.querySelector('#addVacancy').focus();
    return;
  }
  for (const row of memberList.children) {
    if (row.querySelector('select').value) continue;
    createFormError.textContent = 'Выбери класс для каждого игрока, который уже в пати.';
    createFormError.hidden = false;
    row.querySelector('.ts-control input').focus();
    return;
  }
  for (const row of vacancyList.children) {
    const [min, max] = row.querySelectorAll('input[type=number]');
    max.setCustomValidity(Number(max.value) < Number(min.value) ? 'Максимальный уровень должен быть не меньше минимального.' : '');
    if (!max.reportValidity()) return;
  }
  createFormError.hidden = true;
  const preview = document.querySelector('#createdPreview');
  preview.replaceChildren();
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'ПРЕДПРОСМОТР ОБЪЯВЛЕНИЯ';
  const title = document.createElement('h3');
  title.textContent = document.querySelector('#partyName').value.trim();
  const summary = document.createElement('p');
  summary.textContent = `${servers.find(server => server.id === selectedServerId).name} · ${memberList.children.length + 1} в пати · ${vacancyList.children.length} ${vacanciesWord(vacancyList.children.length)} · ${selectedHours} ч/нед. · лидер: ${leader.name} (${leader.className})`;
  const schedule = document.createElement('p'); schedule.className = 'created-preview-schedule'; schedule.textContent = describeCreateSchedule().join(' · ');
  const slots = document.createElement('div');
  slots.className = 'created-preview-slots';
  const slotNames = [
    {label: `Ты · ${leader.name} · ${leader.className}`, kind:'occupied'},
    ...[...memberList.children].map(row => { const name = row.querySelector('.member-name'); return {label:`${row.querySelector('select').value}${name.value.trim() ? ` · ${name.value.trim()}` : ''}`, kind:'occupied'}; }),
    ...[...vacancyList.children].map(row => { const [min, max] = row.querySelectorAll('input[type=number]'); return {label:`${row.querySelector('select').value || 'Любой класс'} · ${min.value}–${max.value} ур.`, kind:'open'}; })
  ];
  while (slotNames.length < 9) slotNames.push({label:'Не распределено', kind:'empty'});
  slotNames.forEach((entry, index) => {
    const slot = document.createElement('span');
    slot.className = `preview-slot-${entry.kind}`;
    slot.textContent = `${String(index + 1).padStart(2, '0')} ${entry.label}`;
    slots.appendChild(slot);
  });
  const note = document.createElement('small');
  note.textContent = 'Макет сохранён только на этой странице. Для публикации потребуется серверная часть.';
  preview.append(eyebrow, title, summary, schedule, slots, note);
  preview.hidden = false;
  preview.scrollIntoView({behavior:'smooth', block:'start'});
});

const days = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const hours = Array.from({length:24}, (_, i) => i);
let selectedClass = '';
let selectedCode = '';
let isDragging = false;
let dragValue = true;
let dragAnchor = null;
let dragBase = null;
let availability = days.map(() => new Set([18,19,20,21,22]));

const menuButton = document.querySelector('#menuButton');
const topbar = document.querySelector('.header');
const menuBody = document.querySelector('.menu__body');
menuButton?.addEventListener('click', () => {
  const isOpen = menuBody?.classList.toggle('_active') ?? false;
  topbar?.classList.toggle('menu-open', isOpen);
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

const timeLabels = document.querySelector('#timeLabels');
days.forEach((day, dayIndex) => { const cell = document.createElement('span'); cell.innerHTML = `${day}<small>${dayNames[dayIndex]}</small>`; timeLabels.appendChild(cell); });
const grid = document.querySelector('#scheduleGrid');
hours.forEach(hour => {
  const row = document.createElement('div'); row.className = 'schedule-row';
  row.innerHTML = `<div class="day-label">${String(hour).padStart(2,'0')}:00</div><div class="hours"></div>`;
  const hoursEl = row.querySelector('.hours');
  days.forEach((day, dayIndex) => {
    const cell = document.createElement('button'); cell.className = `hour ${availability[dayIndex].has(hour) ? 'on' : ''}`; cell.type = 'button'; cell.dataset.day = dayIndex; cell.dataset.hour = hour; cell.ariaLabel = `${dayNames[dayIndex]} ${hour}:00`;
    cell.addEventListener('pointerdown', event => { event.preventDefault(); isDragging = true; dragAnchor = {day: dayIndex, hour}; dragValue = !availability[dayIndex].has(hour); dragBase = availability.map(set => new Set(set)); paintRectangle(dayIndex, hour); });
    cell.addEventListener('pointerenter', () => { if (isDragging) paintRectangle(dayIndex, hour); });
    hoursEl.appendChild(cell);
  });
  grid.appendChild(row);
});
function paintRectangle(currentDay, currentHour){
  if (!dragAnchor || !dragBase) return;
  availability = dragBase.map(set => new Set(set));
  const dayStart = Math.min(dragAnchor.day, currentDay); const dayEnd = Math.max(dragAnchor.day, currentDay);
  const hourStart = Math.min(dragAnchor.hour, currentHour); const hourEnd = Math.max(dragAnchor.hour, currentHour);
  for (let day = dayStart; day <= dayEnd; day++) for (let hour = hourStart; hour <= hourEnd; hour++) {
    if (dragValue) availability[day].add(hour); else availability[day].delete(hour);
  }
  document.querySelectorAll('.hour').forEach(cell => cell.classList.toggle('on', availability[Number(cell.dataset.day)].has(Number(cell.dataset.hour))));
  updateHourCount();
}
window.addEventListener('pointerup', () => { isDragging = false; dragAnchor = null; dragBase = null; });
window.addEventListener('pointercancel', () => { isDragging = false; dragAnchor = null; dragBase = null; });
function updateHourCount(){ document.querySelector('#selectedHours').textContent = availability.reduce((sum, set) => sum + set.size, 0); }
updateHourCount();

findCharacterSelect.addEventListener('change', () => {
  const character = selectedFindCharacter();
  selectedClass = character?.className || '';
  selectedCode = classCodeByName.get(selectedClass) || '';
  document.querySelector('#findSelectedCharacter').hidden = !character;
  document.querySelector('#selectedClass').textContent = selectedClass || 'Класс не выбран';
  if (character) {
    document.querySelector('#findCharacterMark').textContent = character.name[0];
    document.querySelector('#findCharacterName').textContent = character.name;
    document.querySelector('#findCharacterServer').textContent = `ПЕРСОНАЖ · ${servers.find(server => server.id === character.serverId).name.toUpperCase()}`;
    document.querySelector('#findCharacterLevel').textContent = character.level;
  }
  document.querySelector('#results').hidden = true;
});

const partyFixtures = [
  {name:'Night Watch', tag:'Ищут игрока 7 / 9', leader:'Kain', hours:[19,20,21], open:['TH','Glad'], roles:[['SK','Танк'],['PP','Бафф'],['BP','Хил'],['Glad','Дамаг'],['TH','Даггер'],['OL','Бафф'],['WL','Контроль']]},
  {name:'Aden Legacy', tag:'Ищут игроков 7 / 9', leader:'Mirael', hours:[18,19,20,21], open:['DA','Pala'], roles:[['Pala','Открыто'],['BP','Хил'],['PP','Бафф'],['WL','Контроль'],['Glad','Дамаг'],['OL','Бафф'],['DA','Открыто'],['TH','Даггер']]},
  {name:'Vanguard', tag:'Ищут игрока 6 / 9', leader:'Shinjik', hours:[20,21,22], open:['WL','TH'], roles:[['SK','Танк'],['PP','Бафф'],['BP','Хил'],['Glad','Дамаг'],['OL','Бафф'],['DA','Танк']]},
  {name:'Silver Dawn', tag:'Ищут игроков 6 / 9', leader:'Elyria', hours:[18,19,20], open:['SK','TK','BP','EE','SE'], roles:[['Pala','Танк'],['SK','Открыто'],['TK','Открыто'],['BP','Открыто'],['EE','Открыто'],['SE','Открыто'],['PP','Бафф'],['Glad','Дамаг']]},
  {name:'Crimson Relay', tag:'Ищут игроков 7 / 9', leader:'Ragnar', hours:[19,20,21,22], open:['PP','WC','OL'], roles:[['DA','Танк'],['BP','Хил'],['PP','Открыто'],['WC','Открыто'],['OL','Открыто'],['Glad','Дамаг'],['TH','Даггер'],['WL','Контроль']]},
  {name:'Moonlit Oath', tag:'Ищут игроков 8 / 9', leader:'Lunara', hours:[18,19,20], open:['SWS','BD'], roles:[['SK','Танк'],['BP','Хил'],['PP','Бафф'],['SWS','Открыто'],['BD','Открыто'],['Glad','Дамаг'],['TH','Даггер'],['OL','Бафф']]},
  {name:'Dragon Valley', tag:'Ищут игрока 8 / 9', leader:'Ardent', hours:[20,21,22], open:['PW','AW'], roles:[['Pala','Танк'],['BP','Хил'],['PP','Бафф'],['PW','Открыто'],['AW','Открыто'],['Glad','Дамаг'],['OL','Бафф'],['TH','Даггер']]},
  {name:"Archer's Rest", tag:'Ищут игроков 7 / 9', leader:'Hawke', hours:[18,19,20,21], open:['HE','SR','PR'], roles:[['TK','Танк'],['BP','Хил'],['PP','Бафф'],['HE','Открыто'],['SR','Открыто'],['PR','Открыто'],['OL','Бафф'],['SWS','Песни']]},
  {name:'Iron Fist', tag:'Ищут игроков 6 / 9', leader:'Dester', hours:[19,20,21], open:['Destro','Tyr','BH'], roles:[['DA','Танк'],['BP','Хил'],['PP','Бафф'],['Destro','Открыто'],['Tyr','Открыто'],['BH','Открыто'],['OL','Бафф'],['Glad','Дамаг']]},
  {name:'Forge Union', tag:'Ищут крафтера 8 / 9', leader:'Masterwork', hours:[18,19,20], open:['Craft'], roles:[['SK','Танк'],['BP','Хил'],['PP','Бафф'],['Craft','Открыто'],['Glad','Дамаг'],['TH','Даггер'],['OL','Бафф'],['WC','Бафф']]},
  {name:'Arcane Circle', tag:'Ищут игроков 6 / 9', leader:'Aether', hours:[20,21,22], open:['Sorc','SPS','SH','Necro'], roles:[['Pala','Танк'],['BP','Хил'],['PP','Бафф'],['Sorc','Открыто'],['SPS','Открыто'],['SH','Открыто'],['Necro','Открыто'],['OL','Бафф']]},
  {name:'Beast Pact', tag:'Ищут игроков 6 / 9', leader:'Katarina', hours:[19,20,21], open:['Cat','ES','PS'], roles:[['SK','Танк'],['BP','Хил'],['PP','Бафф'],['Cat','Открыто'],['ES','Открыто'],['PS','Открыто'],['OL','Бафф'],['BD','Танцы']]},
  {name:'Dawn Patrol', tag:'Ищут игроков 5 / 9', leader:'Aurelia', hours:[17,18,19], open:['Pala','DA','TK'], roles:[['Pala','Открыто'],['DA','Открыто'],['TK','Открыто'],['BP','Хил'],['PP','Бафф'],['Glad','Дамаг'],['OL','Бафф'],['TH','Даггер']]},
  {name:'Hellbound Runners', tag:'Ищут игроков 6 / 9', leader:'Rexxar', hours:[20,21,22], open:['Glad','WL','Destro','Tyr'], roles:[['SK','Танк'],['BP','Хил'],['PP','Бафф'],['Glad','Открыто'],['WL','Открыто'],['Destro','Открыто'],['Tyr','Открыто'],['OL','Бафф']]},
  {name:'Elven Harmony', tag:'Ищут игроков 5 / 9', leader:'Elyndra', hours:[18,19,20], open:['TK','SK','EE','SE','SWS','BD'], roles:[['TK','Открыто'],['SK','Открыто'],['EE','Открыто'],['SE','Открыто'],['SWS','Открыто'],['BD','Открыто'],['BP','Хил'],['PP','Бафф']]},
  {name:'Clan Council', tag:'Ищут игроков 5 / 9', leader:'Overwatch', hours:[19,20,21,22], open:['BP','PP','WC','OL'], roles:[['Pala','Танк'],['BP','Открыто'],['PP','Открыто'],['WC','Открыто'],['OL','Открыто'],['Glad','Дамаг'],['TH','Даггер'],['BD','Танцы']]},
  {name:'Arrowhead', tag:'Ищут игроков 6 / 9', leader:'Hawkeye', hours:[18,19,20], open:['HE','SR','PR'], roles:[['SK','Танк'],['BP','Хил'],['PP','Бафф'],['HE','Открыто'],['SR','Открыто'],['PR','Открыто'],['OL','Бафф'],['SWS','Песни']]},
  {name:'Dagger Syndicate', tag:'Ищут игроков 6 / 9', leader:'Shadowstep', hours:[20,21,22], open:['TH','PW','AW'], roles:[['DA','Танк'],['BP','Хил'],['PP','Бафф'],['TH','Открыто'],['PW','Открыто'],['AW','Открыто'],['OL','Бафф'],['WC','Бафф']]},
  {name:'Berserker Line', tag:'Ищут игроков 5 / 9', leader:'Ironhide', hours:[17,18,19,20], open:['Destro','Tyr','BH','Craft'], roles:[['Pala','Танк'],['BP','Хил'],['PP','Бафф'],['Destro','Открыто'],['Tyr','Открыто'],['BH','Открыто'],['Craft','Открыто'],['OL','Бафф']]},
  {name:'Magic Lantern', tag:'Ищут игроков 5 / 9', leader:'Mirage', hours:[19,20,21], open:['Sorc','SPS','SH','Necro'], roles:[['TK','Танк'],['BP','Хил'],['PP','Бафф'],['Sorc','Открыто'],['SPS','Открыто'],['SH','Открыто'],['Necro','Открыто'],['OL','Бафф']]},
  {name:'Summon Circle', tag:'Ищут игроков 6 / 9', leader:'Mewtwo', hours:[18,19,20,21], open:['Cat','ES','PS'], roles:[['SK','Танк'],['BP','Хил'],['SE','Бафф'],['Cat','Открыто'],['ES','Открыто'],['PS','Открыто'],['OL','Бафф'],['BD','Танцы']]},
];
// Independent demo listings per server; replace with server-filtered API results later.
const parties = servers.flatMap(server => partyFixtures.map(party => ({...party, serverId:server.id})));
function userTimes(){ return new Set(availability.flatMap(set => [...set])); }
function overlapHours(party){ return party.hours.filter(hour => userTimes().has(hour)); }
function matchPercent(party){ const availableHours = Math.max(userTimes().size, 1); return Math.min(100, Math.round(overlapHours(party).length / availableHours * 100)); }
function renderResults(){
  const code = selectedCode;
  const matches = parties.filter(party => party.serverId === selectedServerId && party.open.includes(code) && party.hours.every(hour => userTimes().has(hour)));
  const container = document.querySelector('#partyResults');
  const serverName = servers.find(server => server.id === selectedServerId)?.name || '';
  document.querySelector('#resultSummary').textContent = matches.length ? `Найдено ${matches.length} ${matches.length === 1 ? 'подходящее пати' : 'подходящих пати'} · ${serverName} · ${selectedClass}` : `На ${serverName} для класса «${selectedClass || 'не выбран'}» пока нет полного совпадения`;
  container.innerHTML = matches.length ? matches.map(party => { let claimed = false; const roles = [...party.roles, ['—','Ожидают']].slice(0,9); const slots = roles.map(([role,label]) => { const mine = !claimed && role === code; if (mine) claimed = true; const open = mine || label === 'Открыто'; return [role, mine ? 'твоё место' : label, open]; }); return `<article class="party-card"><span class="match-score">${matchPercent(party)}% MATCH</span><h3>${party.name}</h3><p class="party-sub">${party.tag} · лидер ${party.leader}</p><div class="slots">${slots.map(([role,label,open]) => `<div class="slot ${open ? 'open' : ''}">${role}<small>${label}</small></div>`).join('')}</div><div class="party-bottom"><span>◷ ${party.hours[0]}:00–${party.hours[party.hours.length-1]+1}:00 · ${party.hours.length} ч.</span><button class="join-btn" data-party="${party.name}">ОТКЛИКНУТЬСЯ →</button></div></article>`; }).join('') : `<div class="empty-state"><span>✦</span><h3>Нужно чуть больше времени</h3><p>Попробуй отметить ещё несколько часов или выбрать другой класс — так мы найдём больше живых групп.</p></div>`;
  document.querySelector('#results').hidden = false; document.querySelector('#results').scrollIntoView({behavior:'smooth', block:'start'});
  container.querySelectorAll('.join-btn').forEach(button => button.addEventListener('click', () => { button.textContent = 'ЗАПРОС ОТПРАВЛЕН ✓'; button.disabled = true; }));
}
document.querySelector('#findButton').addEventListener('click', () => {
  if (!selectedServerId) { document.querySelector('#findServerOptions .server-option').focus(); document.querySelector('#findServerOptions').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (!selectedFindCharacter()) { findCharacterSelect.focus(); return; }
  renderResults();
});
document.querySelector('#editSearch').addEventListener('click', () => document.querySelector('#finder').scrollIntoView({behavior:'smooth'}));
