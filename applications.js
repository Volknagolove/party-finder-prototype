// Local-only application workflow. Replace these stores with authenticated API calls later.
const applicationsKey = 'partyFinder.applications.v1';
const listingKey = isGuest() ? 'partyFinder.ownedListing.guest.v1' : 'partyFinder.ownedListing.v1';
const contactKey = isGuest() ? 'partyFinder.contacts.guest.v1' : 'partyFinder.contacts.v1';
const deletedListingBackupKey = isGuest() ? 'partyFinder.deletedListing.guest.v1' : 'partyFinder.deletedListing.profile.v1';
const demoSeedKey = 'partyFinder.demoSeed.v1';

function readDemoData(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveDemoData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The current page still works when browser storage is unavailable. */ }
}
function escapeApplicationText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function applicationId() {
  return globalThis.crypto?.randomUUID?.() || `application-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function partyIdentity(serverId, name) { return `${serverId}:${name}`; }
function cleanContacts(contacts) {
  return {
    telegram: String(contacts?.telegram || '').trim().slice(0, 64),
    discord: String(contacts?.discord || '').trim().slice(0, 64)
  };
}
function hasContacts(contacts) { return Boolean(contacts.telegram || contacts.discord); }
function findContacts() {
  return cleanContacts({telegram:document.querySelector('#findTelegram').value, discord:document.querySelector('#findDiscord').value});
}
function setFindContacts(contacts) {
  document.querySelector('#findTelegram').value = contacts.telegram;
  document.querySelector('#findDiscord').value = contacts.discord;
  document.querySelector('#findContactHint').textContent = hasContacts(contacts)
    ? 'Контакт сохранён. При заявке лидер увидит указанные данные.'
    : 'Можно заполнить сейчас или при первой заявке.';
}
function contactCards(contacts) {
  const entries = [['Telegram', contacts.telegram], ['Discord', contacts.discord]].filter(([, value]) => value);
  return entries.map(([platform, value]) => {
    const icon = platform === 'Telegram' ? 'telegram' : 'discord';
    return `<div class="application-contact-card"><span>${platform} · <img class="application-contact-icon" src="../assets/icons/${icon}.svg" alt="" aria-hidden="true"></span><strong>${escapeApplicationText(value)}</strong><button type="button" data-copy-contact="${escapeApplicationText(value)}" aria-label="Скопировать контакт ${platform}">КОПИРОВАТЬ</button></div>`;
  }).join('');
}
function applicationStatus(status) {
  return ({pending:'На рассмотрении', accepted:'Принят в пати', declined:'Отказ', withdrawn:'Отозвана', removed:'Исключён из пати'})[status] || 'На рассмотрении';
}
function accountBadge(status) {
  const guest = status === 'guest';
  return `<span class="identity-badge identity-badge-${guest ? 'guest' : 'profile'}" title="${guest ? 'Данные персонажа введены вручную' : 'Персонаж выбран из профиля (в макете — тестовые данные)'}">${guest ? 'ГОСТЬ' : 'АВТОРИЗОВАН'}</span>`;
}
function applicationDate(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}).format(new Date(timestamp));
}
function weeklySlotsInUserZone(weeklyAvailability, sourceTimeZone = userTimeZone) {
  if (!Array.isArray(weeklyAvailability)) return new Set();
  const monday = localWeekStartDate();
  const slots = new Set();
  weeklyAvailability.slice(0, 7).forEach((hours, sourceDay) => {
    if (!Array.isArray(hours)) return;
    hours.forEach(hour => {
      const parsed = Number(hour);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return;
      const sourceDate = new Date(Date.UTC(monday.year, monday.month - 1, monday.day + sourceDay));
      const instant = zonedWallTimeToDate(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth() + 1, sourceDate.getUTCDate(), parsed, sourceTimeZone);
      const local = zonedParts(instant, userTimeZone);
      const localDate = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day));
      const dayIndex = ((Math.round((localDate - monday.timestamp) / 86400000) % 7) + 7) % 7;
      slots.add(`${dayIndex}:${Number(local.hour)}`);
    });
  });
  return slots;
}
function applicationAvailability(availability, timeZone) {
  const slots = weeklySlotsInUserZone(availability, timeZone || userTimeZone);
  return slots.size ? describeWeeklySlots(slots).join(' · ') : 'График не указан';
}
function listingLocalSlots(listing) {
  return weeklySlotsInUserZone(listing?.weeklyAvailability, listing?.timeZone || userTimeZone);
}
function availabilityCoversListing(availability, applicantTimeZone, listing) {
  const applicantSlots = weeklySlotsInUserZone(availability, applicantTimeZone || userTimeZone);
  const requiredSlots = listingLocalSlots(listing);
  return requiredSlots.size > 0 && [...requiredSlots].every(slot => applicantSlots.has(slot));
}

let submittedApplications = readDemoData(applicationsKey, []);
if (!Array.isArray(submittedApplications)) submittedApplications = [];
let ownedListing = readDemoData(listingKey, null);
if (!ownedListing || !Array.isArray(ownedListing.vacancies)) ownedListing = null;
let inboxFilter = 'all';
let removalCandidateId = null;
let applicationParty = null;
let applicationTrigger = null;
let createFormHydrated = false;

function saveApplications() { saveDemoData(applicationsKey, submittedApplications); }
function activeApplication(partyId, characterId) {
  return submittedApplications.find(application => application.source === 'self' && application.partyId === partyId && application.characterId === characterId && ['pending','accepted'].includes(application.status));
}
function latestApplication(partyId, characterId) {
  return submittedApplications.filter(application => application.source === 'self' && application.partyId === partyId && application.characterId === characterId).sort((a,b) => b.createdAt - a.createdAt)[0];
}
function fixtureLeaderContacts(party) {
  const slug = party.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 18);
  return {telegram:`@demo_${slug}`, discord:`demo.${slug}`};
}

function updateResultApplicationButtons() {
  const character = selectedFindCharacter();
  document.querySelectorAll('#partyResults .join-btn').forEach(button => {
    const partyId = partyIdentity(selectedServerId, button.dataset.party);
    const application = character && activeApplication(partyId, character.id);
    const previous = character && latestApplication(partyId, character.id);
    button.disabled = Boolean(application);
    button.textContent = application?.status === 'accepted' ? 'ТЕБЯ ПРИНЯЛИ ✓' : application ? 'ЗАЯВКА ОТПРАВЛЕНА ✓' : previous?.status === 'declined' ? 'ПОДАТЬ ПОВТОРНО →' : 'ОСТАВИТЬ ЗАЯВКУ →';
  });
}

function renderMyApplications() {
  const container = document.querySelector('#myApplicationsList');
  const mine = submittedApplications.filter(application => application.source === 'self' && (application.authStatus || 'profile') === (isGuest() ? 'guest' : 'profile')).sort((a,b) => b.createdAt - a.createdAt);
  if (!mine.length) {
    container.innerHTML = '<div class="application-empty"><span>✦</span><strong>Пока нет заявок</strong><p>Найди подходящую пати и оставь заявку — здесь появятся статус и контакт лидера.</p></div>';
    return;
  }
  container.innerHTML = mine.map(application => {
    const active = ['pending','accepted'].includes(application.status);
    const server = servers.find(item => item.id === application.serverId)?.name || application.serverId;
    return `<article class="application-card application-card-${escapeApplicationText(application.status)}"><div class="application-card-top"><div class="application-card-identity"><span class="application-kicker">${escapeApplicationText(server)} · ${escapeApplicationText(applicationDate(application.createdAt))}${application.demoApplication ? ' · ДЕМО' : ''}</span><h3>${escapeApplicationText(application.partyName)}</h3><p>${escapeApplicationText(application.characterName)} · ${escapeApplicationText(application.className)} · ${escapeApplicationText(application.level)} ур. ${accountBadge(application.authStatus)}</p></div><span class="application-status application-status-${escapeApplicationText(application.status)}">${applicationStatus(application.status)}</span></div><div class="application-info-row"><div class="application-availability"><span>МОГУ ИГРАТЬ</span><strong>${escapeApplicationText(applicationAvailability(application.availability, application.timeZone))}</strong></div>${active ? `<div class="application-contact-area"><span class="application-leader-line">ЛИДЕР · ${escapeApplicationText(application.leaderName)} ${accountBadge(application.leaderAuthStatus)}</span><div class="application-contact-list">${contactCards(application.leaderContacts)}</div></div>` : ''}</div><div class="application-card-foot"><span>${application.status === 'pending' ? 'Ждём решения лидера' : application.status === 'accepted' ? 'Свяжитесь, чтобы договориться об игре' : 'Заявка закрыта'}</span>${active ? `<button class="application-text-button" data-withdraw="${escapeApplicationText(application.id)}" type="button">ОТОЗВАТЬ</button>` : ''}</div></article>`;
  }).join('');
}

function freeVacancyIndex(application) {
  if (!ownedListing) return -1;
  if (!availabilityCoversListing(application.availability, application.timeZone, ownedListing)) return -1;
  const taken = new Set(submittedApplications.filter(item => item.partyId === ownedListing.id && item.status === 'accepted').map(item => item.acceptedSlot));
  return ownedListing.vacancies.findIndex((vacancy, index) => !taken.has(index) && (!vacancy.className || vacancy.className === application.className) && application.level >= vacancy.minLevel && application.level <= vacancy.maxLevel);
}
function hasMatchingVacancy(application) {
  return Boolean(ownedListing?.vacancies.some(vacancy =>
    (!vacancy.className || vacancy.className === application.className) &&
    application.level >= vacancy.minLevel && application.level <= vacancy.maxLevel
  ));
}

function renderLeaderInbox() {
  const container = document.querySelector('#leaderInbox');
  const count = document.querySelector('#leaderApplicationsCount');
  if (!ownedListing) {
    count.textContent = 'Набор не открыт';
    const canRestore = Boolean(readDemoData(deletedListingBackupKey, null)?.listing);
    container.innerHTML = `<div class="application-empty"><span>✦</span><strong>Здесь появятся кандидаты</strong><p>Укажи контакт лидера и создай пати. Объявление сохранится в этом браузере, а для проверки интерфейса появятся тестовые заявки.</p>${canRestore ? '<button class="restore-deleted-party" type="button" data-restore-deleted>↶ ВОССТАНОВИТЬ УДАЛЁННУЮ ПАТИ</button>' : ''}</div>`;
    return;
  }
  const applications = submittedApplications.filter(application => application.partyId === ownedListing.id);
  const pending = applications.filter(application => application.status === 'pending').length;
  const accepted = applications.filter(application => application.status === 'accepted').length;
  count.textContent = `${pending} ожидают · ${accepted}/${ownedListing.vacancies.length} принято`;
  const shown = (inboxFilter === 'pending' ? applications.filter(application => application.status === 'pending') : inboxFilter === 'accepted' ? applications.filter(application => application.status === 'accepted') : applications).sort((a,b) => b.createdAt - a.createdAt);
  container.innerHTML = `<div class="application-inbox-meta"><div><strong>${escapeApplicationText(ownedListing.name)} ${accountBadge(ownedListing.authStatus)}</strong><span>${escapeApplicationText(servers.find(server => server.id === ownedListing.serverId)?.name || '')} · ${escapeApplicationText(ownedListing.schedule)}</span></div><span class="application-demo-badge">ДЕМО-НАБОР</span></div><div class="application-tabs" role="group" aria-label="Фильтр заявок"><button type="button" data-inbox-filter="all" class="${inboxFilter === 'all' ? 'active' : ''}">Все <b>${applications.length}</b></button><button type="button" data-inbox-filter="pending" class="${inboxFilter === 'pending' ? 'active' : ''}">Ожидают <b>${pending}</b></button><button type="button" data-inbox-filter="accepted" class="${inboxFilter === 'accepted' ? 'active' : ''}">В пати <b>${accepted}</b></button></div>${shown.length ? shown.map(application => {
    const vacancyIndex = application.status === 'pending' ? freeVacancyIndex(application) : -1;
    const meetsSchedule = availabilityCoversListing(application.availability, application.timeZone, ownedListing);
    const noOpenVacancyCopy = !meetsSchedule
      ? 'Расписание не покрывает все часы пати — это обязательное условие для вступления.'
      : hasMatchingVacancy(application)
      ? 'Все подходящие места уже заняты принятыми игроками. Заявка подходила на момент подачи.'
      : 'После подачи изменились требования к классу или уровню этой вакансии.';
    return `<article class="application-card application-card-compact">
      <div class="application-card-top">
        <div class="application-card-identity"><span class="application-kicker">${escapeApplicationText(applicationDate(application.createdAt))} · ${application.demoCandidate ? 'ДЕМО-КАНДИДАТ' : 'ИГРОК'}</span><h3>${escapeApplicationText(application.characterName)} ${accountBadge(application.authStatus)}</h3><p>${escapeApplicationText(application.className)} · ${escapeApplicationText(application.level)} ур.</p></div>
        <span class="application-status application-status-${escapeApplicationText(application.status)}">${applicationStatus(application.status)}</span>
      </div>
      <div class="application-info-row"><div class="application-availability"><span>МОЖЕТ ИГРАТЬ</span><strong>${escapeApplicationText(applicationAvailability(application.availability, application.timeZone))}</strong></div>
      <div class="application-contact-area"><span>КОНТАКТЫ</span><div class="application-contact-list">${contactCards(application.contacts)}</div></div></div>
      ${application.status === 'pending' ? `<div class="application-decisions"><button class="application-accept" type="button" data-decision="accept" data-id="${escapeApplicationText(application.id)}" ${vacancyIndex < 0 ? 'disabled' : ''}>ПРИНЯТЬ В ПАТИ ✓</button><button class="application-decline" type="button" data-decision="decline" data-id="${escapeApplicationText(application.id)}">ОТКАЗАТЬ</button>${vacancyIndex < 0 ? `<small>${noOpenVacancyCopy}</small>` : ''}</div>` : application.status === 'accepted' ? `<div class="application-decisions">${removalCandidateId === application.id ? `<span class="application-remove-question">Освободить место и убрать ${escapeApplicationText(application.characterName)}?</span><button class="application-remove-confirm" type="button" data-remove-confirm="${escapeApplicationText(application.id)}">ДА, УБРАТЬ</button><button class="application-decline" type="button" data-remove-cancel>ОТМЕНА</button>` : `<button class="application-decline" type="button" data-remove="${escapeApplicationText(application.id)}">УБРАТЬ ИЗ ПАТИ</button>`}</div>` : ''}
    </article>`;
  }).join('') : '<div class="application-empty"><span>✦</span><strong>Заявок в этом разделе нет</strong><p>Новые отклики появятся здесь.</p></div>'}`;
}

function demoCandidatesFor(listing) {
  const names = ['Aster', 'Mirael', 'Ragnar', 'Elion'];
  return names.map((name, index) => {
    const vacancy = listing.vacancies[index % listing.vacancies.length];
    return {
      id:applicationId(), source:'demo', demoCandidate:true, authStatus:index === 3 ? 'guest' : 'profile', partyId:listing.id, partyName:listing.name,
      serverId:listing.serverId, characterId:`demo-${index}`, characterName:name,
      className:vacancy.className || ['Bishop','Gladiator','Warcryer'][index],
      level:Math.min(vacancy.maxLevel, Math.max(vacancy.minLevel, 74 + index)),
      contacts:index === 3 ? {telegram:'@demo_elion', discord:'demo.elion'} : index % 2 ? {telegram:'', discord:`demo.${name.toLowerCase()}`} : {telegram:`@demo_${name.toLowerCase()}`, discord:''},
      availability:(listing.weeklyAvailability || []).map(hours => [...hours]), timeZone:listing.timeZone || userTimeZone,
      createdAt:Date.now() - (index + 1) * 3600000, status:'pending'
    };
  });
}

function seedDemoApplications() {
  if (readDemoData(demoSeedKey, false)) return;
  // Keep an earlier local draft recoverable while making the requested Teon example visible.
  if (!ownedListing || ownedListing.serverId !== 'teon') {
    if (ownedListing) saveDemoData('partyFinder.preTeonListing.v1', ownedListing);
    ownedListing = {
      id:'local:teon:Стражи Теона', name:'Стражи Теона', serverId:'teon',
      leaderCharacterId:'char-201', leaderName:'Rhett', leaderClass:'Dark Avenger',
      contacts:{telegram:'@demo_teon_leader', discord:'teon.leader.demo'},
      members:[{className:'Bishop',name:'Aria'},{className:'Warcryer',name:'Voss'}],
      vacancies:[
        {className:'Treasure Hunter',minLevel:70,maxLevel:78},
        {className:'Elven Elder',minLevel:70,maxLevel:78},
        {className:'Gladiator',minLevel:70,maxLevel:78}
      ],
      weeklyAvailability:Array.from({length:7}, () => [19,20,21]),
      schedule:'Пн–Вс 19:00–22:00', timeZone:userTimeZone, createdAt:Date.now()
    };
    saveDemoData(listingKey, ownedListing);
  }
  if (ownedListing.serverId === 'teon' && !submittedApplications.some(application => application.partyId === ownedListing.id)) {
    submittedApplications.push(...demoCandidatesFor(ownedListing));
    saveApplications();
  }
  if (!submittedApplications.some(application => application.source === 'self' && ['pending','accepted'].includes(application.status))) {
    const demoParty = parties.find(party => party.serverId === 'bartz' && party.name === 'Crimson Relay');
    if (demoParty) {
      submittedApplications.push({
        id:applicationId(), source:'self', demoApplication:true,
        partyId:partyIdentity(demoParty.serverId, demoParty.name), partyName:demoParty.name,
        serverId:'bartz', characterId:'char-101', characterName:'Kain', className:'Warcryer', level:78,
        timeZone:userTimeZone, availability:Array.from({length:7}, () => [18,19,20,21,22]),
        contacts:{telegram:'@demo_party_player',discord:''},
        leaderContacts:fixtureLeaderContacts(demoParty), leaderName:demoParty.leader,
        createdAt:Date.now(), status:'pending'
      });
      saveApplications();
    }
  }
  saveDemoData(demoSeedKey, true);
}

function refreshDemoFixtureData() {
  let changed = false;
  if (ownedListing?.id === 'local:teon:Стражи Теона' &&
      !submittedApplications.some(application => application.partyId === ownedListing.id && application.characterId === 'demo-3')) {
    submittedApplications.push(demoCandidatesFor(ownedListing)[3]);
    changed = true;
  }
  submittedApplications.forEach(application => {
    if (application.demoCandidate && !application.authStatus) {
      application.authStatus = application.characterName === 'Elion' ? 'guest' : 'profile';
      changed = true;
    }
    if (application.demoCandidate && application.partyId === ownedListing?.id &&
        !availabilityCoversListing(application.availability, application.timeZone, ownedListing)) {
      application.availability = (ownedListing.weeklyAvailability || []).map(hours => [...hours]);
      application.timeZone = ownedListing.timeZone || userTimeZone;
      changed = true;
    }
    if (application.source !== 'self') return;
    const party = parties.find(item => item.serverId === application.serverId && item.name === application.partyName);
    if (!party) return;
    const contacts = fixtureLeaderContacts(party);
    if (application.leaderContacts?.telegram === contacts.telegram && application.leaderContacts?.discord === contacts.discord) return;
    application.leaderContacts = contacts;
    changed = true;
  });
  if (changed) saveApplications();
}

function publishDemoListing() {
  const contacts = cleanContacts({telegram:document.querySelector('#leaderTelegram').value, discord:document.querySelector('#leaderDiscord').value});
  const error = document.querySelector('#leaderContactError');
  if (!hasContacts(contacts)) {
    error.hidden = false;
    document.querySelector('#leaderTelegram').focus();
    error.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  error.hidden = true;
  const leader = selectedLeaderCharacter();
  if (!leader) return;
  const name = document.querySelector('#partyName').value.trim();
  const vacancies = [...vacancyList.children].map(row => ({
    className:row.querySelector('.roster-class-select').value,
    minLevel:Number(row.querySelector('.level-min').value),
    maxLevel:Number(row.querySelector('.level-max').value)
  }));
  const members = [...memberList.children].map(row => ({
    className:row.querySelector('.roster-class-select').value,
    name:row.querySelector('.member-name').value.trim()
  })).filter(member => member.className || member.name);
  if (!name || !vacancies.length) return;
  const next = {
    id:`local:${isGuest() ? 'guest:' : ''}${partyIdentity(selectedServerId, name)}`, name, serverId:selectedServerId,
    authStatus:isGuest() ? 'guest' : 'profile',
    leaderCharacterId:leader.id, leaderName:leader.name, leaderClass:leader.className, leaderLevel:leader.level,
    contacts, members, vacancies, weeklyAvailability:createAvailability.map(set => [...set]),
    schedule:describeCreateSchedule().join(' · '), timeZone:userTimeZone,
    createdAt:Date.now()
  };
  const firstPublish = !ownedListing || ownedListing.id !== next.id;
  ownedListing = next;
  saveDemoData(listingKey, ownedListing);
  if (firstPublish || !submittedApplications.some(application => application.partyId === ownedListing.id)) {
    submittedApplications.push(...demoCandidatesFor(ownedListing));
    saveApplications();
  }
  renderLeaderInbox();
  updateDeletePartyVisibility();
}

function hydrateCreateForm() {
  if (createFormHydrated || !ownedListing || !partyApp.classList.contains('mode-create')) return;
  createFormHydrated = true;
  chooseServer(ownedListing.serverId);
  document.querySelector('#partyName').value = ownedListing.name;
  document.querySelector('#leaderTelegram').value = ownedListing.contacts?.telegram || '';
  document.querySelector('#leaderDiscord').value = ownedListing.contacts?.discord || '';
  if (isGuest()) {
    document.querySelector('#leaderGuestName').value = ownedListing.leaderName || '';
    document.querySelector('#leaderGuestClass').tomselect?.setValue(ownedListing.leaderClass || '');
    document.querySelector('#leaderGuestLevel').value = ownedListing.leaderLevel || '';
    updateLeaderCharacter();
  } else leaderCharacterSelect.tomselect?.setValue(ownedListing.leaderCharacterId);
  if (Array.isArray(ownedListing.weeklyAvailability) && ownedListing.weeklyAvailability.length === 7) {
    ownedListing.weeklyAvailability.forEach((hours, index) => { createAvailability[index] = new Set(hours); });
    syncCreateGrid();
  }
  for (const row of [...memberList.children, ...vacancyList.children]) {
    row.querySelector('.roster-class-select')?.tomselect?.destroy();
    row.remove();
  }
  (ownedListing.members || []).forEach(member => {
    addMember();
    const row = memberList.lastElementChild;
    row.querySelector('.roster-class-select').tomselect.setValue(member.className);
    row.querySelector('.member-name').value = member.name;
  });
  ownedListing.vacancies.forEach(vacancy => {
    addVacancy();
    const row = vacancyList.lastElementChild;
    row.querySelector('.roster-class-select').tomselect.setValue(vacancy.className);
    const min = row.querySelector('.level-min'), max = row.querySelector('.level-max');
    min.value = String(vacancy.minLevel);
    max.value = String(vacancy.maxLevel);
    min.dispatchEvent(new Event('input'));
    max.dispatchEvent(new Event('input'));
  });
  if (memberList.children.length + vacancyList.children.length < 8) addMember();
  updateRoster();
  updateDeletePartyVisibility();
}

const applicationOverlay = document.querySelector('#applicationOverlay');
function closeApplicationDialog() {
  applicationOverlay.hidden = true;
  document.body.classList.remove('application-open');
  applicationTrigger?.focus();
  applicationParty = null;
}
function openApplicationDialog(partyName) {
  const party = parties.find(item => item.serverId === selectedServerId && item.name === partyName);
  const character = selectedFindCharacter();
  if (!party || !character) return;
  const playerSlots = new Set(availability.flatMap((set, day) => [...set].map(hour => `${day}:${hour}`)));
  if (!party.open.includes(selectedCode) || ![...partyLocalSlots(party)].every(slot => playerSlots.has(slot))) {
    renderResults();
    return;
  }
  if (activeApplication(partyIdentity(party.serverId, party.name), character.id)) {
    document.querySelector('#myApplications').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  const saved = findContacts();
  if (hasContacts(saved)) {
    submitApplication(party, character, saved);
    document.querySelector('#myApplications').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  applicationParty = party;
  applicationTrigger = [...document.querySelectorAll('#partyResults .join-btn')].find(button => button.dataset.party === partyName);
  document.querySelector('#applicationTitle').textContent = party.name;
  document.querySelector('#applicationPartyMeta').textContent = `${servers.find(server => server.id === party.serverId)?.name || ''} · лидер ${party.leader} · ${describeWeeklySlots(partyLocalSlots(party)).join(' · ')}`;
  document.querySelector('#applicationCharacter').innerHTML = `<span>ТВОЙ ПЕРСОНАЖ ${accountBadge(isGuest() ? 'guest' : 'profile')}</span><strong>${escapeApplicationText(character.name)}</strong><small>${escapeApplicationText(character.className)} · ${escapeApplicationText(character.level)} ур.</small>`;
  document.querySelector('#applicantTelegram').value = saved.telegram;
  document.querySelector('#applicantDiscord').value = saved.discord;
  document.querySelector('#applicationError').hidden = true;
  document.querySelector('#applicationCompose').hidden = false;
  document.querySelector('#applicationSuccess').hidden = true;
  applicationOverlay.hidden = false;
  document.body.classList.add('application-open');
  document.querySelector('#applicantTelegram').focus();
}

function submitApplication(party, character, contacts) {
  const leaderContacts = fixtureLeaderContacts(party);
  submittedApplications.push({
    id:applicationId(), source:'self', authStatus:isGuest() ? 'guest' : 'profile', leaderAuthStatus:party.authStatus || 'profile', partyId:partyIdentity(party.serverId, party.name),
    partyName:party.name, serverId:party.serverId, characterId:character.id,
    characterName:character.name, className:character.className, level:character.level,
    timeZone:userTimeZone, availability:availability.map(set => [...set]),
    contacts, leaderContacts, leaderName:party.leader,
    createdAt:Date.now(), status:'pending'
  });
  saveApplications();
  saveDemoData(contactKey, contacts);
  setFindContacts(contacts);
  renderMyApplications();
  updateResultApplicationButtons();
  return leaderContacts;
}

document.querySelector('#applicationForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!applicationParty) return;
  const character = selectedFindCharacter();
  const contacts = cleanContacts({telegram:document.querySelector('#applicantTelegram').value, discord:document.querySelector('#applicantDiscord').value});
  const error = document.querySelector('#applicationError');
  if (!hasContacts(contacts)) { error.hidden = false; document.querySelector('#applicantTelegram').focus(); return; }
  error.hidden = true;
  const party = applicationParty;
  const leaderContacts = submitApplication(party, character, contacts);
  document.querySelector('#applicationSuccessText').textContent = `Заявка в ${party.name} отправлена. Лидер видит твой контакт и ${isGuest() ? 'указанные вручную данные персонажа' : 'данные персонажа'}.`;
  document.querySelector('#applicationLeaderContacts').innerHTML = contactCards(leaderContacts);
  document.querySelector('#applicationCompose').hidden = true;
  document.querySelector('#applicationSuccess').hidden = false;
  document.querySelector('#applicationToMine').focus();
});

document.querySelector('#applicationClose').addEventListener('click', closeApplicationDialog);
document.querySelector('#applicationBackdrop').addEventListener('click', closeApplicationDialog);
document.querySelector('#applicationToMine').addEventListener('click', () => {
  closeApplicationDialog();
  document.querySelector('#myApplications').scrollIntoView({behavior:'smooth', block:'start'});
});
for (const input of document.querySelectorAll('#findTelegram, #findDiscord')) {
  input.addEventListener('input', () => {
    const contacts = findContacts();
    saveDemoData(contactKey, contacts);
    document.querySelector('#findContactHint').textContent = hasContacts(contacts)
      ? 'Контакт сохранён. При заявке лидер увидит указанные данные.'
      : 'Можно заполнить сейчас или при первой заявке.';
  });
}
for (const input of document.querySelectorAll('#leaderTelegram, #leaderDiscord')) {
  input.addEventListener('input', () => {
    const contacts = cleanContacts({telegram:document.querySelector('#leaderTelegram').value, discord:document.querySelector('#leaderDiscord').value});
    if (!hasContacts(contacts)) return;
    document.querySelector('#leaderContactError').hidden = true;
    document.querySelector('#leaderTelegram').removeAttribute('aria-invalid');
    document.querySelector('#leaderDiscord').removeAttribute('aria-invalid');
  });
}
document.addEventListener('keydown', event => {
  if (applicationOverlay.hidden) return;
  if (event.key === 'Escape') { closeApplicationDialog(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...applicationOverlay.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('partyfinder:apply', event => openApplicationDialog(event.detail.partyName));
document.addEventListener('partyfinder:results-rendered', updateResultApplicationButtons);
document.addEventListener('partyfinder:preview', publishDemoListing);
document.addEventListener('partyfinder:mode-changed', event => { if (event.detail.mode === 'create') hydrateCreateForm(); });
const deletePartyOpen = document.querySelector('#deletePartyOpen');
const deletePartyConfirm = document.querySelector('#deletePartyConfirm');
function updateDeletePartyVisibility() {
  deletePartyOpen.hidden = !ownedListing;
  if (!ownedListing) deletePartyConfirm.hidden = true;
}
deletePartyOpen.addEventListener('click', () => {
  if (!ownedListing) return;
  deletePartyConfirm.hidden = false;
  deletePartyOpen.setAttribute('aria-expanded', 'true');
  document.querySelector('#deletePartyCancel').focus();
});
document.querySelector('#deletePartyCancel').addEventListener('click', () => {
  deletePartyConfirm.hidden = true;
  deletePartyOpen.setAttribute('aria-expanded', 'false');
  deletePartyOpen.focus();
});
document.querySelector('#deletePartyApply').addEventListener('click', () => {
  if (!ownedListing) return;
  const relatedApplications = submittedApplications.filter(application => application.partyId === ownedListing.id);
  try {
    localStorage.setItem(deletedListingBackupKey, JSON.stringify({listing:ownedListing, applications:relatedApplications, savedAt:Date.now()}));
    localStorage.setItem(applicationsKey, JSON.stringify(submittedApplications.filter(application => application.partyId !== ownedListing.id)));
    localStorage.removeItem(listingKey);
    window.location.reload();
  } catch {
    deletePartyConfirm.querySelector('p').textContent = 'Не удалось удалить пати из этого браузера. Проверь, доступно ли локальное хранилище.';
  }
});
document.querySelector('#leaderInbox').addEventListener('click', event => {
  if (!event.target.closest('[data-restore-deleted]')) return;
  const backup = readDemoData(deletedListingBackupKey, null);
  if (!backup?.listing || !Array.isArray(backup.applications)) return;
  try {
    const existing = readDemoData(applicationsKey, []);
    const restored = [...existing, ...backup.applications.filter(application => !existing.some(item => item.id === application.id))];
    localStorage.setItem(listingKey, JSON.stringify(backup.listing));
    localStorage.setItem(applicationsKey, JSON.stringify(restored));
    localStorage.removeItem(deletedListingBackupKey);
    window.location.reload();
  } catch {
    event.target.textContent = 'НЕ УДАЛОСЬ ВОССТАНОВИТЬ';
  }
});
const resetDemoOpen = document.querySelector('#resetDemoOpen');
const resetDemoConfirm = document.querySelector('#resetDemoConfirm');
resetDemoOpen.hidden = isGuest();
resetDemoOpen.addEventListener('click', () => {
  resetDemoConfirm.hidden = false;
  resetDemoOpen.setAttribute('aria-expanded', 'true');
  document.querySelector('#resetDemoCancel').focus();
});
document.querySelector('#resetDemoCancel').addEventListener('click', () => {
  resetDemoConfirm.hidden = true;
  resetDemoOpen.setAttribute('aria-expanded', 'false');
  resetDemoOpen.focus();
});
document.querySelector('#resetDemoApply').addEventListener('click', () => {
  try {
    localStorage.setItem('partyFinder.lastResetBackup.v1', JSON.stringify({listing:ownedListing, applications:submittedApplications, savedAt:Date.now()}));
    localStorage.removeItem(applicationsKey);
    localStorage.removeItem(listingKey);
    localStorage.removeItem(demoSeedKey);
    window.location.reload();
  } catch {
    resetDemoConfirm.querySelector('p').textContent = 'Не удалось сбросить данные в этом браузере. Проверь, доступно ли локальное хранилище.';
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-contact]');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copyContact);
    button.textContent = 'СКОПИРОВАНО ✓';
  } catch {
    button.textContent = 'ВЫДЕЛИ ТЕКСТ ВЫШЕ';
  }
});

document.querySelector('#myApplicationsList').addEventListener('click', event => {
  const button = event.target.closest('[data-withdraw]');
  if (!button) return;
  const application = submittedApplications.find(item => item.id === button.dataset.withdraw && item.source === 'self');
  if (!application || !['pending','accepted'].includes(application.status)) return;
  application.status = 'withdrawn';
  saveApplications();
  renderMyApplications();
  updateResultApplicationButtons();
});
document.querySelector('#leaderInbox').addEventListener('click', event => {
  const filter = event.target.closest('[data-inbox-filter]');
  if (filter) { inboxFilter = filter.dataset.inboxFilter; removalCandidateId = null; renderLeaderInbox(); return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) { removalCandidateId = remove.dataset.remove; renderLeaderInbox(); return; }
  if (event.target.closest('[data-remove-cancel]')) { removalCandidateId = null; renderLeaderInbox(); return; }
  const confirmRemoval = event.target.closest('[data-remove-confirm]');
  if (confirmRemoval) {
    const accepted = submittedApplications.find(item => item.id === confirmRemoval.dataset.removeConfirm && item.partyId === ownedListing?.id && item.status === 'accepted');
    if (!accepted || removalCandidateId !== accepted.id) return;
    accepted.status = 'removed';
    delete accepted.acceptedSlot;
    removalCandidateId = null;
    saveApplications();
    renderLeaderInbox();
    renderMyApplications();
    updateResultApplicationButtons();
    return;
  }
  const button = event.target.closest('[data-decision]');
  if (!button || !ownedListing) return;
  const application = submittedApplications.find(item => item.id === button.dataset.id && item.partyId === ownedListing.id && item.status === 'pending');
  if (!application) return;
  if (button.dataset.decision === 'accept') {
    const slot = freeVacancyIndex(application);
    if (slot < 0) return;
    application.acceptedSlot = slot;
    application.status = 'accepted';
  } else if (button.dataset.decision === 'decline') {
    application.status = 'declined';
  }
  saveApplications();
  renderLeaderInbox();
  renderMyApplications();
});

if (!isGuest()) {
  seedDemoApplications();
  refreshDemoFixtureData();
}
const savedFindContacts = cleanContacts(readDemoData(contactKey, {}));
if (localStorage.getItem(contactKey) !== null) setFindContacts(savedFindContacts);
else {
  const existingApplication = submittedApplications.find(application => application.source === 'self' && (application.authStatus || 'profile') === (isGuest() ? 'guest' : 'profile') && hasContacts(cleanContacts(application.contacts)));
  setFindContacts(existingApplication ? cleanContacts(existingApplication.contacts) : savedFindContacts);
  if (existingApplication) saveDemoData(contactKey, cleanContacts(existingApplication.contacts));
}
renderMyApplications();
renderLeaderInbox();
hydrateCreateForm();
updateDeletePartyVisibility();
