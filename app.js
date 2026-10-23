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
  document.body.classList.toggle('cabinet-theme', isCabinetView());
  document.body.classList.toggle('dark-only', isCabinetView());
  document.querySelectorAll('[data-profile-style]').forEach(link => { link.media = isCabinetView() ? 'all' : 'not all'; });
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
  demoLogout.hidden = !hasLocalAccess();
  demoLogout.textContent = isGuest() ? 'ВЫЙТИ ИЗ ГОСТЕВОГО РЕЖИМА' : 'ВЫЙТИ ИЗ ТЕСТОВОГО АККАУНТА';
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
async function leaveLocalAccess() {
  try { await partyApi('/session', {method:'DELETE'}); }
  catch { /* The local view can still be closed if the API is unavailable. */ }
  sessionStorage.removeItem(authKey);
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('mode');
  window.location.replace(url);
}
demoLogout.addEventListener('click', leaveLocalAccess);
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
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await partyApi('/session/login', {method:'POST', body:{email:loginEmail.value.trim(), password:loginPassword.value}});
  } catch (error) {
    loginError.textContent = error.message;
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
document.querySelector('#continueAsGuest').addEventListener('click', async () => {
  try { await partyApi('/session/guest', {method:'POST', body:{}}); }
  catch (error) { loginError.textContent = error.message; loginError.hidden = false; return; }
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
if (!hasLocalAccess()) {
  partyApi('/session').then(session => {
    if (!session.returningGuest || hasLocalAccess()) return;
    sessionStorage.setItem(authKey, 'guest');
    syncAccessFields();
    document.querySelector('#resetDemoOpen').hidden = true;
    if (['find', 'create'].includes(initialMode)) showSelectedMode(initialMode, false);
    else showModeChooser(false);
    if (document.readyState === 'complete') loadPartyState();
    else window.addEventListener('load', () => loadPartyState(), {once:true});
  }).catch(() => { /* The chooser remains usable if the local API is offline. */ });
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
    for (const hour of party.weeklyAvailability?.[sourceDay] || party.hours || []) {
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
const classDisplayCode = code => code === 'OL' ? 'Over' : code;
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
function showCreateFormError(message, field) {
  createFormError.textContent = message;
  createFormError.hidden = false;
  createFormError.scrollIntoView({behavior:'smooth', block:'center'});
  if (field) field.setAttribute('aria-invalid', 'true');
}
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
  document.dispatchEvent(new CustomEvent('partyfinder:server-changed', { detail: { serverId } }));
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
    closeAfterSelect: true,
    onItemAdd() { requestAnimationFrame(() => { this.close(); this.blur(); }); },
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
let displayedListing = null;
function updateRoster() {
  const memberRows = [...memberList.children];
  const members = memberRows.filter(row => row.querySelector('.roster-class-select').value || row.querySelector('.member-name').value.trim()).length;
  const vacancies = vacancyList.children.length;
  const accepted = (displayedListing?.acceptedMembers || []).length;
  const openVacancies = Math.max(0, vacancies - accepted);
  const remaining = 8 - members - vacancies;
  const allocatedRows = memberRows.length + vacancies;
  document.querySelector('#addMember').disabled = allocatedRows >= 8;
  document.querySelector('#addMemberAtEnd').disabled = allocatedRows >= 8;
  document.querySelector('#addVacancy').disabled = allocatedRows >= 8;
  document.querySelector('#addVacancyAtEnd').disabled = allocatedRows >= 8;
  document.querySelector('#openSlotCount').textContent = openVacancies;
  document.querySelector('#openSlotLabel').textContent = `${vacanciesWord(openVacancies)} для набора`;
  rosterCount.textContent = `В пати ${members + accepted + 1} / 9 · ищем ${openVacancies} · ещё не распределено ${remaining}`;
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
function renderOwnedListingState(listing, applications = submittedApplications) {
  displayedListing = listing;
  const accepted = listing?.acceptedMembers || [];
  const acceptedByIndex = new Map(accepted.map(member => [member.vacancyIndex, member]));
  const acceptedList = document.querySelector('#acceptedMemberList');
  acceptedList.replaceChildren();
  accepted.forEach(member => {
    const application = applications.find(item => item.partyId === listing.id && item.status === 'accepted' && item.acceptedSlot === member.vacancyIndex);
    const row = document.createElement('div');
    row.className = 'leader-row accepted-member-row';
    const number = document.createElement('span');
    number.className = 'create-slot-number';
    number.textContent = String(listing.vacancies[member.vacancyIndex]?.slotNumber || '').padStart(2, '0');
    const name = document.createElement('span');
    name.textContent = `${member.name} · ${member.className}`;
    const status = document.createElement('strong');
    status.textContent = `Принят · ${member.level} ур.`;
    const remove = document.createElement('button');
    remove.className = 'roster-remove accepted-member-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.disabled = !application;
    remove.dataset.removeAccepted = application?.id || '';
    remove.setAttribute('aria-label', `Исключить ${member.name} из пати`);
    const confirmation = document.createElement('div');
    confirmation.className = 'accepted-member-confirm';
    confirmation.hidden = true;
    const message = document.createElement('span');
    message.textContent = `Исключить ${member.name}? Место снова откроется для заявок.`;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.dataset.confirmAccepted = application?.id || '';
    confirm.textContent = 'ИСКЛЮЧИТЬ';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.cancelAccepted = '';
    cancel.textContent = 'ОТМЕНА';
    confirmation.append(message, confirm, cancel);
    row.append(number, name, status, remove, confirmation);
    acceptedList.appendChild(row);
  });
  acceptedList.hidden = !accepted.length;
  if (listing && listing.vacancies.length === vacancyList.children.length) {
    [...vacancyList.children].forEach((row, index) => { row.hidden = acceptedByIndex.has(index); });
  }
  updateRoster();

  const preview = document.querySelector('#createdPreview');
  preview.replaceChildren();
  if (!listing) { preview.hidden = true; return; }
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'ТВОЁ ОБЪЯВЛЕНИЕ';
  const title = document.createElement('h3'); title.textContent = listing.name;
  const summary = document.createElement('p');
  const openCount = listing.vacancies.length - accepted.length;
  summary.textContent = `${servers.find(server => server.id === listing.serverId)?.name || listing.serverId} · ${listing.members.length + accepted.length + 1} в пати · ${openCount} ${vacanciesWord(openCount)} · ${listing.weeklyAvailability.flat().length} ч/нед. · лидер: ${listing.leaderName} (${listing.leaderClass})`;
  const expiry = document.createElement('p'); expiry.className = 'created-preview-expiry'; expiry.hidden = true;
  const countdown = document.createElement('strong'); countdown.dataset.listingCountdown = ''; expiry.append('Активно ещё ', countdown);
  const schedule = document.createElement('p'); schedule.className = 'created-preview-schedule';
  schedule.textContent = `${describeWeeklySlots(partyLocalSlots(listing)).join(' · ')} · ${timeZoneDisplayLabel(userTimeZone)}`;
  const slots = document.createElement('div'); slots.className = 'created-preview-slots';
  const slotEntries = new Map([[1, {label:`Ты · ${listing.leaderName} · ${listing.leaderClass}`, kind:'occupied'}]]);
  listing.members.forEach(member => slotEntries.set(member.slotNumber, {label:`${member.className}${member.name ? ` · ${member.name}` : ''}`, kind:'occupied'}));
  listing.vacancies.forEach((vacancy, index) => {
    const member = acceptedByIndex.get(index);
    slotEntries.set(vacancy.slotNumber, member
      ? {label:`${member.name} · ${member.className} · ${member.level} ур.`, kind:'accepted'}
      : {label:`${vacancy.className || 'Любой класс'} · ${vacancy.minLevel}–${vacancy.maxLevel} ур.`, kind:'open'});
  });
  for (let slotNumber = 1; slotNumber <= 9; slotNumber++) {
    const entry = slotEntries.get(slotNumber) || {label:'Не распределено', kind:'empty'};
    const slot = document.createElement('span');
    slot.className = `preview-slot-${entry.kind}`;
    slot.textContent = `${String(slotNumber).padStart(2, '0')} ${entry.label}`;
    slots.appendChild(slot);
  }
  preview.append(eyebrow, title, summary, expiry, schedule, slots);
  preview.hidden = false;
  updateListingCountdown();
}
document.querySelector('#createPartyForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedServerId) { showCreateFormError('Выбери сервер, на котором играет твоя пати.'); return; }
  const partyName = document.querySelector('#partyName');
  if (!partyName.value.trim()) { showCreateFormError('Укажи название пати.', partyName); return; }
  partyName.removeAttribute('aria-invalid');
  const leader = selectedLeaderCharacter();
  if (!leader) { showCreateFormError(isGuest() ? 'Укажи имя, класс и уровень своего персонажа.' : 'Выбери персонажа на этом сервере.'); return; }
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
    showCreateFormError('Отметь хотя бы один час игры в недельной сетке.');
    return;
  }
  if (!vacancyList.children.length) {
    showCreateFormError('Добавь хотя бы одну вакансию для поиска игроков.');
    return;
  }
  for (const row of memberList.children) {
    if (!row.querySelector('select').value && !row.querySelector('.member-name').value.trim()) continue;
    if (row.querySelector('select').value) continue;
    showCreateFormError('Выбери класс для каждого игрока, который уже в пати.');
    return;
  }
  for (const row of vacancyList.children) {
    const min = row.querySelector('.level-min');
    const max = row.querySelector('.level-max');
    if (Number(max.value) < Number(min.value)) { showCreateFormError('Минимальный уровень вакансии не может быть выше максимального.'); return; }
  }
  const submitButton = document.querySelector('#createPartyForm button[type="submit"]');
  submitButton.disabled = true;
  let saved;
  try { saved = await publishDemoListing(); }
  finally { submitButton.disabled = false; }
  if (!saved) return;
  createFormError.hidden = true;
  renderOwnedListingState(ownedListing);
  document.querySelector('#createdPreview').scrollIntoView({behavior:'smooth', block:'start'});
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

let parties = [];
function partyFromApi(listing) {
  const acceptedByIndex = new Map((listing.acceptedMembers || []).map(member => [member.vacancyIndex, member]));
  const occupied = [
    {slotNumber:1, className:listing.leaderClass, name:listing.leaderName},
    ...listing.members
  ].map(member => ({slotNumber:member.slotNumber, code:classCodeByName.get(member.className) || '—', label:member.name, open:false}));
  const openings = listing.vacancies.map((vacancy, index) => {
    const accepted = acceptedByIndex.get(index);
    return accepted
      ? {slotNumber:vacancy.slotNumber, code:classCodeByName.get(accepted.className) || '—', label:accepted.name, open:false}
      : {slotNumber:vacancy.slotNumber, code:classCodeByName.get(vacancy.className) || '—', label:`${vacancy.minLevel}–${vacancy.maxLevel} ур.`, open:true};
  });
  return {
    ...listing,
    leader:listing.leaderName,
    tag:`Ищут игроков ${occupied.length + acceptedByIndex.size} / 9`,
    open:openings.filter(item => item.open).map(item => item.code),
    roles:[...occupied, ...openings].sort((a,b) => a.slotNumber - b.slotNumber)
  };
}
function escapePartyText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function userTimes(){ return new Set(availability.flatMap((set, day) => [...set].map(hour => `${day}:${hour}`))); }
function overlapHours(party){ const user = userTimes(); return [...partyLocalSlots(party)].filter(slot => user.has(slot)); }
function matchPercent(party){ const availableHours = Math.max(userTimes().size, 1); return Math.min(100, Math.round(overlapHours(party).length / availableHours * 100)); }
async function renderResults({scroll = true, silent = false} = {}){
  const code = selectedCode;
  const container = document.querySelector('#partyResults');
  const serverName = servers.find(server => server.id === selectedServerId)?.name || '';
  const character = selectedFindCharacter();
  if (!silent) container.innerHTML = '<div class="empty-state" role="status"><p>Ищем подходящие пати…</p></div>';
  document.querySelector('#results').hidden = false;
  try {
    const result = await partyApi('/parties/search', {method:'POST', body:{
      serverId:selectedServerId, className:character.className, level:character.level,
      availability:availability.map(set => [...set]), timeZone:userTimeZone
    }});
    parties = result.parties.map(partyFromApi);
  } catch (error) {
    if (!silent) container.innerHTML = `<div class="empty-state" role="alert"><h3>Не удалось выполнить поиск</h3><p>${escapePartyText(error.message)}</p></div>`;
    return;
  }
  const matches = parties;
  const resultSummary = document.querySelector('#resultSummary');
  const resultCount = document.createElement('strong');
  resultCount.textContent = matches.length
    ? `Найдено ${matches.length} ${matches.length === 1 ? 'подходящее пати' : 'подходящих пати'}`
    : 'Подходящих пати пока нет';
  const resultContext = document.createElement('span');
  resultContext.textContent = `${serverName} · ${selectedClass || 'класс не выбран'}`;
  resultSummary.replaceChildren(resultCount, resultContext);
  container.innerHTML = matches.length ? matches.map(party => {
    let claimed = false;
    const roles = [...party.roles];
    while (roles.length < 9) roles.push({code:'—',label:'Ожидают',open:false});
    const slots = roles.map(entry => {
      const mine = !claimed && entry.open && (entry.code === code || entry.code === '—');
      if (mine) claimed = true;
      return {...entry, label:mine ? 'твоё место' : entry.label, mine};
    });
    const scheduleSlots = partyLocalSlots(party);
    const badge = party.authStatus === 'profile' ? 'АВТОРИЗОВАН' : party.authStatus === 'guest' ? 'ГОСТЬ' : 'ДЕМО';
    return `<article class="party-card"><span class="match-score">${matchPercent(party)}% MATCH</span><h3>${escapePartyText(party.name)}</h3><p class="party-sub">${escapePartyText(party.tag)} · лидер ${escapePartyText(party.leader)} <span class="identity-badge identity-badge-${party.authStatus === 'profile' ? 'profile' : 'guest'}">${badge}</span></p><div class="slots">${slots.map(slot => `<div class="slot ${slot.open ? 'open' : ''} ${slot.mine ? 'your-place' : ''}">${escapePartyText(classDisplayCode(slot.code))}<small>${escapePartyText(slot.label)}</small></div>`).join('')}</div><div class="party-bottom"><span>◷ ${escapePartyText(describeWeeklySlots(scheduleSlots).join(' · '))} · ${scheduleSlots.size} ч/нед. · ${escapePartyText(timeZoneDisplayLabel(userTimeZone))}</span><button class="join-btn" data-party="${escapePartyText(party.id)}" type="button">ОСТАВИТЬ ЗАЯВКУ →</button></div></article>`;
  }).join('') : `<div class="empty-state"><h3>Пока нет подходящих пати</h3><p>Попробуй отметить ещё несколько часов или выбрать другой класс.</p></div>`;
  document.querySelector('#results').hidden = false;
  if (scroll) document.querySelector('#results').scrollIntoView({behavior:'smooth', block:'start'});
  container.querySelectorAll('.join-btn').forEach(button => button.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('partyfinder:apply', {detail:{partyId:button.dataset.party}}));
  }));
  document.dispatchEvent(new Event('partyfinder:results-rendered'));
}
document.querySelector('#findButton').addEventListener('click', () => {
  if (!selectedServerId) { document.querySelector('#findServerOptions .server-option').focus(); document.querySelector('#findServerOptions').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (!selectedFindCharacter()) { if (isGuest()) focusGuestCharacter('find'); else (findCharacterSelect.tomselect?.control_input || findCharacterSelect).focus(); return; }
  renderResults();
});
document.querySelector('#editSearch').addEventListener('click', () => document.querySelector('#finder').scrollIntoView({behavior:'smooth'}));
