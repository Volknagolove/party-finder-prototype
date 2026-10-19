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
const demoLogout = document.querySelector('#demoLogout');
const finderSections = [...document.querySelectorAll('#finder, .party-app > .workspace, #how-it-works')];
const authKey = 'partyFinder.demoSession.v3';
const demoEmail = 'demo@party.local';
const demoPassword = 'Party2026!';
let pendingMode = null;
let lastModeTrigger = null;
function currentAccess() { return sessionStorage.getItem(authKey); }
function isGuest() { return currentAccess() === 'guest'; }
function hasLocalAccess() { return ['demo', 'guest'].includes(currentAccess()); }
function isCabinetView() { return currentAccess() === 'demo'; }
function syncAccessShell() {
  document.body.classList.toggle('cabinet-view', isCabinetView());
  document.querySelector('#cabinetShell').hidden = !isCabinetView();
}
syncAccessShell();

function updateModeUrl(mode) {
  const url = new URL(window.location.href);
  if (mode) url.searchParams.set('mode', mode);
  else url.searchParams.delete('mode');
  url.searchParams.delete('section');
  if (isCabinetView()) url.searchParams.set('view', 'cabinet');
  else url.searchParams.delete('view');
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
  syncAccessShell();
  demoLogout.hidden = !hasLocalAccess();
  demoLogout.textContent = isGuest() ? 'ВЫЙТИ ИЗ ГОСТЕВОГО РЕЖИМА' : 'ВЫЙТИ ИЗ ТЕСТОВОГО АККАУНТА';
  partyApp.classList.remove('mode-find', 'mode-create');
  partyApp.classList.add('mode-select');
  modeChooser.hidden = isCabinetView();
  document.querySelector('#cabinetDashboard').hidden = !isCabinetView();
  createParty.hidden = true;
  document.querySelector('#finderBack').hidden = true;
  finderSections.forEach(section => { section.hidden = true; });
  if (updateUrl) updateModeUrl(null);
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('partyfinder:mode-changed', {detail:{mode:'home'}}));
}

function showSelectedMode(mode, updateUrl = true) {
  closeLogin();
  syncAccessShell();
  partyApp.classList.remove('mode-select', 'mode-find', 'mode-create');
  partyApp.classList.add(`mode-${mode}`);
  modeChooser.hidden = true;
  document.querySelector('#cabinetDashboard').hidden = true;
  createParty.hidden = mode !== 'create';
  document.querySelector('#finderBack').hidden = mode !== 'find';
  finderSections.forEach(section => {
    section.hidden = mode !== 'find' || section.id === 'results';
  });
  if (updateUrl) updateModeUrl(mode);
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('partyfinder:mode-changed', {detail:{mode}}));
}

function selectMode(mode, trigger) {
  lastModeTrigger = trigger;
  pendingMode = mode;
  if (hasLocalAccess()) {
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
function leaveLocalAccess() {
  sessionStorage.removeItem(authKey);
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('mode');
  window.location.replace(url);
}
demoLogout.addEventListener('click', leaveLocalAccess);
document.querySelector('#cabinetLogout').addEventListener('click', leaveLocalAccess);
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
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'cabinet');
  url.searchParams.set('mode', pendingMode || 'find');
  window.location.assign(url);
});
document.querySelector('#continueAsGuest').addEventListener('click', () => {
  sessionStorage.setItem(authKey, 'guest');
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.set('mode', pendingMode || 'find');
  window.location.assign(url);
});
const initialMode = new URL(window.location.href).searchParams.get('mode');
if (hasLocalAccess() && ['find', 'create'].includes(initialMode)) {
  showSelectedMode(initialMode, false);
} else {
  showModeChooser(false);
  if (['find', 'create'].includes(initialMode)) selectMode(initialMode, document.querySelector(initialMode === 'find' ? '#findMode' : '#createMode'));
}
window.addEventListener('popstate', () => {
  const mode = new URL(window.location.href).searchParams.get('mode');
  if (hasLocalAccess() && ['find', 'create'].includes(mode)) showSelectedMode(mode, false);
  else showModeChooser(false);
});

const createDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const demoScheduleTimeZone = 'Europe/Madrid';
const userTimeZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
})();
const zonedPartsFormatters = new Map();
function zonedParts(date, timeZone) {
  if (!zonedPartsFormatters.has(timeZone)) {
    zonedPartsFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }));
  }
  return Object.fromEntries(zonedPartsFormatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]));
}
function timeZoneDisplayLabel(timeZone) {
  return `${timeZone} · местное время`;
}
function zonedWallTimeToDate(year, month, day, hour, timeZone) {
  const wanted = Date.UTC(year, month - 1, day, hour);
  let timestamp = wanted;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = zonedParts(new Date(timestamp), timeZone);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const adjustment = wanted - observed;
    timestamp += adjustment;
    if (!adjustment) break;
  }
  return new Date(timestamp);
}
function localWeekStartDate() {
  const now = zonedParts(new Date(), userTimeZone);
  const date = new Date(Date.UTC(Number(now.year), Number(now.month) - 1, Number(now.day)));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return {year:date.getUTCFullYear(), month:date.getUTCMonth() + 1, day:date.getUTCDate(), timestamp:date.getTime()};
}
function partyLocalSlots(party) {
  const monday = localWeekStartDate();
  const slots = new Set();
  for (let sourceDay = 0; sourceDay < 7; sourceDay++) {
    const sourceDate = new Date(Date.UTC(monday.year, monday.month - 1, monday.day + sourceDay));
    for (const hour of party.hours) {
      const instant = zonedWallTimeToDate(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth() + 1, sourceDate.getUTCDate(), hour, party.timeZone || demoScheduleTimeZone);
      const local = zonedParts(instant, userTimeZone);
      const localDate = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day));
      const dayIndex = ((Math.round((localDate - monday.timestamp) / 86400000) % 7) + 7) % 7;
      slots.add(`${dayIndex}:${Number(local.hour)}`);
    }
  }
  return slots;
}
function describeWeeklySlots(slots) {
  const byDay = Array.from({length:7}, () => new Set());
  slots.forEach(key => { const [day, hour] = key.split(':').map(Number); byDay[day]?.add(hour); });
  const groups = new Map();
  byDay.forEach((set, day) => {
    if (!set.size) return;
    const ordered = [...set].sort((a,b) => a-b);
    const ranges = [];
    let start = ordered[0], end = start;
    ordered.slice(1).forEach(hour => {
      if (hour === end + 1) end = hour;
      else { ranges.push(`${String(start).padStart(2,'0')}:00–${String((end + 1) % 24).padStart(2,'0')}:00`); start = end = hour; }
    });
    ranges.push(`${String(start).padStart(2,'0')}:00–${String((end + 1) % 24).padStart(2,'0')}:00`);
    const key = ranges.join(', ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  });
  return [...groups].map(([hours, days]) => {
    const ranges = [];
    let start = days[0], end = start;
    days.slice(1).forEach(day => {
      if (day === end + 1) end = day;
      else { ranges.push(start === end ? dayNames[start] : `${dayNames[start]}–${dayNames[end]}`); start = end = day; }
    });
    ranges.push(start === end ? dayNames[start] : `${dayNames[start]}–${dayNames[end]}`);
    return `${ranges.join(', ')} ${hours}`;
  });
}
document.querySelectorAll('[data-user-time-zone]').forEach(element => { element.textContent = timeZoneDisplayLabel(userTimeZone); });
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
function guestCharacter(prefix) {
  const name = document.querySelector(`#${prefix}GuestName`).value.trim();
  const className = document.querySelector(`#${prefix}GuestClass`).value;
  const level = Number(document.querySelector(`#${prefix}GuestLevel`).value);
  if (!selectedServerId || !name || !className || !Number.isInteger(level) || level < 1 || level > 80) return null;
  return {id:`guest:${selectedServerId}:${name.toLowerCase()}:${className}`, serverId:selectedServerId, name, className, level};
}
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
function selectedLeaderCharacter() { return isGuest() ? guestCharacter('leader') : charactersById.get(leaderCharacterSelect.value); }
function selectedFindCharacter() { return isGuest() ? guestCharacter('find') : charactersById.get(findCharacterSelect.value); }
function focusGuestCharacter(prefix) {
  for (const suffix of ['Name', 'Class', 'Level']) {
    const field = document.querySelector(`#${prefix}Guest${suffix}`);
    if (field.value.trim() && (suffix !== 'Level' || (Number.isInteger(Number(field.value)) && Number(field.value) >= 1 && Number(field.value) <= 80))) continue;
    (field.tomselect?.control_input || field).focus();
    return;
  }
}
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
  if (select.tomselect) select.tomselect.destroy();
  select.replaceChildren(new Option(selectedServerId ? 'Выбери персонажа' : 'Сначала выбери сервер', ''));
  select.disabled = !selectedServerId;
  demoCharacters.filter(character => character.serverId === selectedServerId).forEach(character => {
    select.add(new Option(`${character.name} · ${character.className} · ${character.level} ур.`, character.id));
  });
  if (selectedServerId) {
    const searchable = select === findCharacterSelect;
    new TomSelect(select, {
      create: false,
      maxItems: 1,
      maxOptions: demoCharacters.length,
      closeAfterSelect: true,
      onItemAdd() { requestAnimationFrame(() => this.blur()); },
      searchField: searchable ? ['text'] : [],
      controlInput: searchable
        ? '<input type="text" autocomplete="off" size="1" />'
        : '<input type="text" autocomplete="off" size="1" readonly tabindex="-1" />',
      placeholder: searchable ? 'Введи имя или выбери персонажа' : 'Выбери персонажа',
      render: {
        no_results: (data, escape) => `<div class="no-results">Персонаж «${escape(data.input)}» не найден</div>`
      }
    });
  }
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
  updateLeaderCharacter();
  updateFindCharacter();
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
function updateLeaderCharacter() {
  const character = selectedLeaderCharacter();
  const details = document.querySelector('#selectedCharacter');
  details.hidden = !character;
  document.querySelector('#leaderCharacterDisplay').textContent = character
    ? `${character.name} · ${character.className}`
    : isGuest() ? 'Укажи имя, класс и уровень' : 'Персонаж не выбран';
  if (!character) return;
  document.querySelector('#characterServer').textContent = `ПЕРСОНАЖ · ${servers.find(server => server.id === character.serverId).name.toUpperCase()}`;
  document.querySelector('#characterMark').textContent = character.name[0];
  document.querySelector('#characterName').textContent = character.name;
  document.querySelector('#characterClass').textContent = character.className;
  document.querySelector('#characterLevel').textContent = character.level;
}
leaderCharacterSelect.addEventListener('change', updateLeaderCharacter);

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
  const guestClass = select.id.endsWith('GuestClass');
  new TomSelect(select, {
    create: false,
    maxItems: 1,
    maxOptions: classNames.length + 1,
    closeAfterSelect: guestClass,
    ...(guestClass ? {onItemAdd() { requestAnimationFrame(() => this.blur()); }} : {}),
    searchField: ['text'],
    placeholder: select.dataset.anyAllowed === 'true' ? 'Любой класс · введи для поиска' : 'Введи или выбери класс',
    render: {
      no_results: (data, escape) => `<div class="no-results">Класс «${escape(data.input)}» не найден</div>`
    }
  });
}
for (const prefix of ['leader', 'find']) {
  const select = document.querySelector(`#${prefix}GuestClass`);
  classNames.forEach(name => select.add(new Option(name, name)));
  enhanceClassSelect(select);
  for (const suffix of ['Name', 'Class', 'Level']) {
    const field = document.querySelector(`#${prefix}Guest${suffix}`);
    field.addEventListener(suffix === 'Class' ? 'change' : 'input', () => {
      if (prefix === 'leader') updateLeaderCharacter();
      else updateFindCharacter();
    });
  }
}
function syncAccessFields() {
  const guest = isGuest();
  partyApp.classList.toggle('guest-mode', guest);
  for (const prefix of ['leader', 'find']) {
    document.querySelector(`#${prefix}ProfileField`).hidden = guest;
    document.querySelector(`#${prefix}GuestFields`).hidden = !guest;
    document.querySelector(`#${prefix}ProfileHelp`).hidden = guest;
  }
  leaderCharacterSelect.required = !guest;
  document.querySelector('.hero-text').textContent = guest
    ? 'Выбери сервер, укажи класс и уровень вручную, отметь время игры — мы покажем подходящие группы.'
    : 'Выбери сервер и своего персонажа, отметь время игры — мы покажем группы, которым не хватает именно тебя.';
  updateLeaderCharacter();
  updateFindCharacter();
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
  const memberRows = [...memberList.children];
  const members = memberRows.filter(row => row.querySelector('.roster-class-select').value || row.querySelector('.member-name').value.trim()).length;
  const vacancies = vacancyList.children.length;
  const remaining = 8 - members - vacancies;
  const allocatedRows = memberRows.length + vacancies;
  document.querySelector('#addMember').disabled = allocatedRows >= 8;
  document.querySelector('#addMemberAtEnd').disabled = allocatedRows >= 8;
  document.querySelector('#addVacancy').disabled = allocatedRows >= 8;
  document.querySelector('#addVacancyAtEnd').disabled = allocatedRows >= 8;
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
  select.addEventListener('change', updateRoster);
  name.addEventListener('input', updateRoster);
  updateRoster();
}
function addVacancy() {
  if (memberList.children.length + vacancyList.children.length >= 8) return;
  const row = document.createElement('div');
  row.className = 'roster-row vacancy-row';
  const number = document.createElement('span'); number.className = 'create-slot-number';
  const select = classSelect('Кого ищем: класс', true);
  const range = document.createElement('div'); range.className = 'roster-level-range';
  const values = document.createElement('div'); values.className = 'roster-level-values';
  const caption = document.createElement('span'); caption.textContent = 'УРОВЕНЬ';
  const readout = document.createElement('strong');
  const minValue = document.createElement('output'); minValue.className = 'level-min-value'; minValue.textContent = '1';
  const separator = document.createElement('i'); separator.textContent = '–';
  const maxValue = document.createElement('output'); maxValue.className = 'level-max-value'; maxValue.textContent = '80';
  readout.append(minValue, separator, maxValue); values.append(caption, readout);
  const track = document.createElement('div'); track.className = 'roster-level-track';
  const fill = document.createElement('span'); fill.className = 'roster-level-fill';
  const min = rosterInput('Минимальный уровень', 'range', '', 1, 80); min.className = 'level-range-input level-min'; min.value = '1'; min.step = '1';
  const max = rosterInput('Максимальный уровень', 'range', '', 1, 80); max.className = 'level-range-input level-max'; max.value = '80'; max.step = '1';
  const updateRange = changed => {
    if (Number(min.value) > Number(max.value)) {
      if (changed === min) max.value = min.value;
      else min.value = max.value;
    }
    minValue.value = minValue.textContent = min.value;
    maxValue.value = maxValue.textContent = max.value;
    const left = ((Number(min.value) - 1) / 79) * 100;
    const right = ((Number(max.value) - 1) / 79) * 100;
    fill.style.left = `${left}%`;
    fill.style.width = `${right - left}%`;
  };
  min.addEventListener('input', () => updateRange(min));
  max.addEventListener('input', () => updateRange(max));
  track.append(fill, min, max); range.append(values, track); updateRange();
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'roster-remove'; remove.setAttribute('aria-label', 'Убрать вакансию'); remove.textContent = '×';
  remove.addEventListener('click', () => { select.tomselect?.destroy(); row.remove(); updateRoster(); });
  row.append(number, select, range, remove);
  vacancyList.appendChild(row);
  enhanceClassSelect(select);
  updateRoster();
}
document.querySelector('#addMember').addEventListener('click', addMember);
document.querySelector('#addMemberAtEnd').addEventListener('click', addMember);
document.querySelector('#addVacancy').addEventListener('click', addVacancy);
document.querySelector('#addVacancyAtEnd').addEventListener('click', addVacancy);
addMember();
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
  if (!leader) { if (isGuest()) focusGuestCharacter('leader'); else (leaderCharacterSelect.tomselect?.control_input || leaderCharacterSelect).focus(); return; }
  const leaderTelegram = document.querySelector('#leaderTelegram');
  const leaderDiscord = document.querySelector('#leaderDiscord');
  const leaderContactError = document.querySelector('#leaderContactError');
  if (!leaderTelegram.value.trim() && !leaderDiscord.value.trim()) {
    leaderContactError.hidden = false;
    leaderTelegram.setAttribute('aria-invalid', 'true');
    leaderDiscord.setAttribute('aria-invalid', 'true');
    leaderTelegram.focus();
    leaderContactError.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  leaderContactError.hidden = true;
  leaderTelegram.removeAttribute('aria-invalid');
  leaderDiscord.removeAttribute('aria-invalid');
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
    if (!row.querySelector('select').value && !row.querySelector('.member-name').value.trim()) continue;
    if (row.querySelector('select').value) continue;
    createFormError.textContent = 'Выбери класс для каждого игрока, который уже в пати.';
    createFormError.hidden = false;
    row.querySelector('.ts-control input').focus();
    return;
  }
  for (const row of vacancyList.children) {
    const min = row.querySelector('.level-min');
    const max = row.querySelector('.level-max');
    if (Number(max.value) < Number(min.value)) { max.focus(); return; }
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
  const activeMemberRows = [...memberList.children].filter(row => row.querySelector('.roster-class-select').value || row.querySelector('.member-name').value.trim());
  summary.textContent = `${servers.find(server => server.id === selectedServerId).name} · ${activeMemberRows.length + 1} в пати · ${vacancyList.children.length} ${vacanciesWord(vacancyList.children.length)} · ${selectedHours} ч/нед. · лидер: ${leader.name} (${leader.className})`;
  const schedule = document.createElement('p'); schedule.className = 'created-preview-schedule'; schedule.textContent = `${describeCreateSchedule().join(' · ')} · ${timeZoneDisplayLabel(userTimeZone)}`;
  const slots = document.createElement('div');
  slots.className = 'created-preview-slots';
  const slotNames = [
    {label: `Ты · ${leader.name} · ${leader.className}`, kind:'occupied'},
    ...activeMemberRows.map(row => { const name = row.querySelector('.member-name'); return {label:`${row.querySelector('select').value}${name.value.trim() ? ` · ${name.value.trim()}` : ''}`, kind:'occupied'}; }),
    ...[...vacancyList.children].map(row => { const min = row.querySelector('.level-min'); const max = row.querySelector('.level-max'); return {label:`${row.querySelector('select').value || 'Любой класс'} · ${min.value}–${max.value} ур.`, kind:'open'}; })
  ];
  while (slotNames.length < 9) slotNames.push({label:'Не распределено', kind:'empty'});
  slotNames.forEach((entry, index) => {
    const slot = document.createElement('span');
    slot.className = `preview-slot-${entry.kind}`;
    slot.textContent = `${String(index + 1).padStart(2, '0')} ${entry.label}`;
    slots.appendChild(slot);
  });
  const note = document.createElement('small');
  note.textContent = 'Объявление и вакансии сохранены в этом браузере. Для публикации на сайте потребуется серверная часть.';
  preview.append(eyebrow, title, summary, schedule, slots, note);
  preview.hidden = false;
  document.dispatchEvent(new Event('partyfinder:preview'));
  preview.scrollIntoView({behavior:'smooth', block:'start'});
});

const days = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
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

function updateFindCharacter() {
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
}
findCharacterSelect.addEventListener('change', updateFindCharacter);
syncAccessFields();

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
const parties = servers.flatMap(server => partyFixtures.map((party, index) => ({...party, authStatus:index % 5 === 1 ? 'guest' : 'profile', timeZone:party.timeZone || demoScheduleTimeZone, serverId:server.id})));
function userTimes(){ return new Set(availability.flatMap((set, day) => [...set].map(hour => `${day}:${hour}`))); }
function overlapHours(party){ const user = userTimes(); return [...partyLocalSlots(party)].filter(slot => user.has(slot)); }
function matchPercent(party){ const availableHours = Math.max(userTimes().size, 1); return Math.min(100, Math.round(overlapHours(party).length / availableHours * 100)); }
function renderResults(){
  const code = selectedCode;
  const user = userTimes();
  const matches = parties.filter(party => party.serverId === selectedServerId && party.open.includes(code) && [...partyLocalSlots(party)].every(slot => user.has(slot)));
  const container = document.querySelector('#partyResults');
  const serverName = servers.find(server => server.id === selectedServerId)?.name || '';
  document.querySelector('#resultSummary').textContent = matches.length ? `Найдено ${matches.length} ${matches.length === 1 ? 'подходящее пати' : 'подходящих пати'} · ${serverName} · ${selectedClass}` : `На ${serverName} для класса «${selectedClass || 'не выбран'}» пока нет полного совпадения`;
  container.innerHTML = matches.length ? matches.map(party => { let claimed = false; const roles = [...party.roles, ['—','Ожидают']].slice(0,9); const slots = roles.map(([role,label]) => { const mine = !claimed && role === code; const open = mine || label === 'Открыто'; if (mine) claimed = true; return [role, mine ? 'твоё место' : label, open, mine]; }); const scheduleSlots = partyLocalSlots(party); const scheduleHours = scheduleSlots.size; return `<article class="party-card"><span class="match-score">${matchPercent(party)}% MATCH</span><h3>${party.name}</h3><p class="party-sub">${party.tag} · лидер ${party.leader} <span class="identity-badge identity-badge-${party.authStatus}" title="${party.authStatus === 'guest' ? 'Данные лидера введены вручную' : 'Лидер использует профиль (демо-данные)'}">${party.authStatus === 'guest' ? 'ГОСТЬ' : 'АВТОРИЗОВАН'}</span></p><div class="slots">${slots.map(([role,label,open,mine]) => `<div class="slot ${open ? 'open' : ''} ${mine ? 'your-place' : ''}">${role}<small>${label}</small></div>`).join('')}</div><div class="party-bottom"><span>◷ ${describeWeeklySlots(scheduleSlots).join(' · ')} · ${scheduleHours} ч/нед. · ${timeZoneDisplayLabel(userTimeZone)}</span><button class="join-btn" data-party="${party.name}" type="button">ОСТАВИТЬ ЗАЯВКУ →</button></div></article>`; }).join('') : `<div class="empty-state"><span>✦</span><h3>Нужно чуть больше времени</h3><p>Попробуй отметить ещё несколько часов или выбрать другой класс — так мы найдём больше живых групп.</p></div>`;
  document.querySelector('#results').hidden = false; document.querySelector('#results').scrollIntoView({behavior:'smooth', block:'start'});
  container.querySelectorAll('.join-btn').forEach(button => button.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('partyfinder:apply', {detail:{partyName:button.dataset.party}}));
  }));
  document.dispatchEvent(new Event('partyfinder:results-rendered'));
}
document.querySelector('#findButton').addEventListener('click', () => {
  if (!selectedServerId) { document.querySelector('#findServerOptions .server-option').focus(); document.querySelector('#findServerOptions').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (!selectedFindCharacter()) { if (isGuest()) focusGuestCharacter('find'); else (findCharacterSelect.tomselect?.control_input || findCharacterSelect).focus(); return; }
  renderResults();
});
document.querySelector('#editSearch').addEventListener('click', () => document.querySelector('#finder').scrollIntoView({behavior:'smooth'}));
