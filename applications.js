// Contact inputs are remembered locally; listings and applications live in SQLite.
const contactKey = isGuest() ? 'partyFinder.contacts.guest.v1' : 'partyFinder.contacts.v1';
let listingCountdownInterval = null;

function readStoredData(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveStoredData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The current page still works when browser storage is unavailable. */ }
}
function escapeApplicationText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function timeUnit(value, forms) {
  const lastTwo = value % 100;
  const last = value % 10;
  return `${value} ${lastTwo >= 11 && lastTwo <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2]}`;
}
function countdownLabel(milliseconds) {
  if (milliseconds <= 0) return 'срок истёк';
  if (milliseconds > 86400000) return timeUnit(Math.ceil(milliseconds / 86400000), ['день', 'дня', 'дней']);
  return timeUnit(Math.ceil(milliseconds / 3600000), ['час', 'часа', 'часов']);
}
function updateListingCountdown() {
  const output = document.querySelector('#createdPreview [data-listing-countdown]');
  if (!output || !ownedListing?.expiresAt) return;
  const remaining = Number(ownedListing.expiresAt) - Date.now();
  if (ownedListing.status === 'closed') {
    const expiry = output.parentElement;
    expiry.replaceChildren('Объявление закрыто');
    expiry.hidden = false;
    return;
  }
  output.textContent = countdownLabel(remaining);
  output.closest('.created-preview-expiry').hidden = false;
}
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
  return ({pending:'На рассмотрении', accepted:'Принят в пати', declined:'Отказ', withdrawn:'Отозвана', removed:'Исключён из пати', expired:'Срок истёк'})[status] || 'На рассмотрении';
}
function accountBadge(status) {
  if (status === 'demo') return '<span class="identity-badge identity-badge-guest" title="Пример объявления">ДЕМО</span>';
  const guest = status === 'guest';
  return `<span class="identity-badge identity-badge-${guest ? 'guest' : 'profile'}" title="${guest ? 'Данные персонажа введены вручную' : 'Персонаж выбран из профиля (в макете — тестовые данные)'}">${guest ? 'ГОСТЬ' : 'АВТОРИЗОВАН'}</span>`;
}
function applicationDate(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}).format(new Date(timestamp));
}
function weeklySlotsInUserZone(weeklyAvailability, sourceTimeZone = userTimeZone) {
  if (!Array.isArray(weeklyAvailability)) return new Set();
  return partyLocalSlots({weeklyAvailability, timeZone:sourceTimeZone});
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

let submittedApplications = [];
let ownedListing = null;
let ownedListings = [];
let applicationHistoryHasMore = false;
let applicationHistoryOffset = 0;
let applicationHistoryLoading = false;
function mergeApplicationHistory(page, append = false) {
  const entries = new Map((append ? submittedApplications : []).map(item => [item.id, item]));
  page.applications.forEach(item => entries.set(item.id, item));
  submittedApplications = [...entries.values()].map(item =>
    item.status === 'pending' && item.expiresAt <= Date.now() ? {...item, status:'expired'} : item);
}
function updateHistoryButtons() {
  document.querySelectorAll('[data-load-history]').forEach(button => {
    button.hidden = !applicationHistoryHasMore;
    button.disabled = applicationHistoryLoading;
    button.textContent = applicationHistoryLoading ? 'ЗАГРУЖАЕМ…' : 'ПОКАЗАТЬ БОЛЕЕ РАННИЕ ЗАЯВКИ';
  });
}
document.querySelectorAll('[data-load-history]').forEach(button => button.addEventListener('click', async () => {
  if (applicationHistoryLoading) return;
  applicationHistoryLoading = true;
  updateHistoryButtons();
  try {
    const page = await partyApi('/bootstrap?offset=' + applicationHistoryOffset);
    mergeApplicationHistory(page, true);
    applicationHistoryOffset = page.applicationsNextOffset;
    applicationHistoryHasMore = page.applicationsHasMore;
    renderMyApplications();
    renderLeaderInbox();
  } catch (error) {
    button.textContent = error.message;
  } finally {
    applicationHistoryLoading = false;
    updateHistoryButtons();
  }
}));

const listingSelectionKey = 'partyFinder.selectedListing.v1';
function renderListingManager() {
  const select = document.querySelector('#ownedListingSelect');
  const current = ownedListing?.id || 'new';
  const options = [new Option('Создать новую пати', 'new')];
  ownedListings.forEach(listing => {
    const state = listing.status === 'closed' ? 'закрыта' : listing.expiresAt <= Date.now() ? 'срок истёк' : 'активна';
    options.push(new Option(listing.name + ' · ' + state, listing.id));
  });
  select.replaceChildren(...options);
  select.value = current;
  document.querySelector('#ownedListingCount').textContent =
    ownedListings.filter(item => item.status === 'active' && item.expiresAt > Date.now()).length + ' / 5 активных пати';
}
function selectOwnedListing(id) {
  sessionStorage.setItem(listingSelectionKey, id);
  ownedListing = ownedListings.find(item => item.id === id) || null;
  displayedListing = ownedListing;
  createFormHydrated = false;
  if (!ownedListing) {
    document.querySelector('#createPartyForm').reset();
    document.querySelector('#leaderGuestClass').tomselect?.clear();
    for (const row of [...memberList.children, ...vacancyList.children]) {
      row.querySelector('.roster-class-select')?.tomselect?.destroy();
      row.remove();
    }
    createAvailability.forEach(day => day.clear());
    syncCreateGrid();
    addMember();
    addVacancy();
    updateLeaderCharacter();
    updateRoster();
  }
  hydrateCreateForm();
  renderOwnedListingState(ownedListing);
  renderLeaderInbox();
  renderListingManager();
  updateDeletePartyVisibility();
}
document.querySelector('#ownedListingSelect').addEventListener('change', event => selectOwnedListing(event.target.value));
document.querySelector('#newPartyListing').addEventListener('click', () => selectOwnedListing('new'));

function applicationExpiryNote(application) {
  return application.status === 'pending'
    ? '<small class="application-expiry">На рассмотрение: ещё ' + countdownLabel(application.expiresAt - Date.now()) + '</small>'
    : '';
}

let deletedListingId = null;
let inboxFilter = 'all';
let removalCandidateId = null;
let applicationParty = null;
let applicationTrigger = null;
const pendingApplicationPartyIds = new Set();
let createFormHydrated = false;

function activeApplication(partyId, characterId) {
  return submittedApplications.find(application => application.source === 'self' && application.partyId === partyId && application.characterId === characterId && ['pending','accepted'].includes(application.status));
}
function latestApplication(partyId, characterId) {
  return submittedApplications.filter(application => application.source === 'self' && application.partyId === partyId && application.characterId === characterId).sort((a,b) => b.createdAt - a.createdAt)[0];
}

function updateResultApplicationButtons() {
  const character = selectedFindCharacter();
  document.querySelectorAll('#partyResults .join-btn').forEach(button => {
    const partyId = button.dataset.party;
    const application = character && activeApplication(partyId, character.id);
    const previous = character && latestApplication(partyId, character.id);
    const pending = pendingApplicationPartyIds.has(partyId);
    button.disabled = Boolean(application || pending);
    button.dataset.applicationStatus = application?.status || '';
    button.textContent = pending ? 'ОТПРАВЛЯЕМ ЗАЯВКУ…' : application?.status === 'accepted' ? 'ТЕБЯ ПРИНЯЛИ ✓' : application ? 'ЗАЯВКА ОТПРАВЛЕНА ✓' : previous?.status === 'declined' ? 'ПОДАТЬ ПОВТОРНО →' : 'ОСТАВИТЬ ЗАЯВКУ →';
    const card = button.closest('.party-card');
    let contactArea = card.querySelector('.party-result-contacts');
    if (application && hasContacts(cleanContacts(application.leaderContacts))) {
      if (!contactArea) {
        contactArea = document.createElement('div');
        contactArea.className = 'party-result-contacts';
        button.closest('.party-bottom').before(contactArea);
      }
      contactArea.innerHTML = `<span>КОНТАКТЫ ЛИДЕРА</span><div class="application-contact-list">${contactCards(application.leaderContacts)}</div>`;
    } else {
      contactArea?.remove();
    }
  });
}

function renderMyApplications() {
  const container = document.querySelector('#myApplicationsList');
  const mine = submittedApplications.filter(application => application.source === 'self').sort((a,b) => b.createdAt - a.createdAt);
  if (!mine.length) {
    container.innerHTML = '<div class="application-empty"><strong>Пока нет заявок</strong><p>Найди подходящую пати и оставь заявку — здесь появятся её статус и контакты лидера.</p></div>';
    return;
  }
  container.innerHTML = mine.map(application => {
    const active = ['pending','accepted'].includes(application.status);
    const server = servers.find(item => item.id === application.serverId)?.name || application.serverId;
    return `<article class="application-card application-card-${escapeApplicationText(application.status)}"><div class="application-card-top"><div class="application-card-identity"><span class="application-kicker">${escapeApplicationText(server)} · ${escapeApplicationText(applicationDate(application.createdAt))}${application.demoApplication ? ' · ДЕМО' : ''}</span><h3>${escapeApplicationText(application.partyName)}</h3><p>${escapeApplicationText(application.characterName)} · ${escapeApplicationText(application.className)} · ${escapeApplicationText(application.level)} ур. ${accountBadge(application.authStatus)}</p></div><div class="application-status-stack"><span class="application-status application-status-${escapeApplicationText(application.status)}">${applicationStatus(application.status)}</span>${applicationExpiryNote(application)}</div></div><div class="application-info-row"><div class="application-availability"><span>МОГУ ИГРАТЬ</span><strong>${escapeApplicationText(applicationAvailability(application.availability, application.timeZone))}</strong></div>${active ? `<div class="application-contact-area"><span class="application-leader-line">ЛИДЕР · ${escapeApplicationText(application.leaderName)} ${accountBadge(application.leaderAuthStatus)}</span><div class="application-contact-list">${contactCards(application.leaderContacts)}</div></div>` : ''}</div><div class="application-card-foot"><span>${application.status === 'pending' ? 'Ждём решения лидера' : application.status === 'accepted' ? 'Свяжитесь, чтобы договориться об игре' : 'Заявка закрыта'}</span>${active ? `<button class="application-text-button" data-withdraw="${escapeApplicationText(application.id)}" type="button">ОТОЗВАТЬ</button>` : ''}</div></article>`;
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
    container.innerHTML = `<div class="application-empty"><strong>Здесь появятся кандидаты</strong><p>Укажи контакт лидера и создай пати. Объявление и заявки сохранятся в общей локальной базе.</p>${deletedListingId ? '<button class="restore-deleted-party" type="button" data-restore-deleted><span aria-hidden="true">↶</span> Восстановить пати</button>' : ''}</div>`;
    return;
  }
  const applications = submittedApplications.filter(application => application.partyId === ownedListing.id);
  const pending = applications.filter(application => application.status === 'pending').length;
  const accepted = applications.filter(application => application.status === 'accepted').length;
  count.textContent = `${pending} ожидают · ${accepted}/${ownedListing.vacancies.length} принято`;
  const shown = (inboxFilter === 'pending' ? applications.filter(application => application.status === 'pending') : inboxFilter === 'accepted' ? applications.filter(application => application.status === 'accepted') : applications).sort((a,b) => b.createdAt - a.createdAt);
  container.innerHTML = `<div class="application-inbox-meta"><div><strong>${escapeApplicationText(ownedListing.name)} ${accountBadge(ownedListing.authStatus)}</strong><span>${escapeApplicationText(servers.find(server => server.id === ownedListing.serverId)?.name || '')} · ${escapeApplicationText(applicationAvailability(ownedListing.weeklyAvailability, ownedListing.timeZone))}</span></div><span class="application-demo-badge">ЛОКАЛЬНЫЙ НАБОР</span></div><div class="application-tabs" role="group" aria-label="Фильтр заявок"><button type="button" data-inbox-filter="all" class="${inboxFilter === 'all' ? 'active' : ''}">Все <b>${applications.length}</b></button><button type="button" data-inbox-filter="pending" class="${inboxFilter === 'pending' ? 'active' : ''}">Ожидают <b>${pending}</b></button><button type="button" data-inbox-filter="accepted" class="${inboxFilter === 'accepted' ? 'active' : ''}">В пати <b>${accepted}</b></button></div>${shown.length ? shown.map(application => {
    const vacancyIndex = application.status === 'pending' ? freeVacancyIndex(application) : -1;
    const meetsSchedule = availabilityCoversListing(application.availability, application.timeZone, ownedListing);
    const noOpenVacancyCopy = !meetsSchedule
      ? 'Расписание не покрывает все часы пати — это обязательное условие для вступления.'
      : hasMatchingVacancy(application)
      ? 'Все подходящие места уже заняты принятыми игроками. Заявка подходила на момент подачи.'
      : 'После подачи изменились требования к классу или уровню этой вакансии.';
    return `<article class="application-card application-card-compact">
      <div class="application-card-top">
        <div class="application-card-identity"><span class="application-kicker">${escapeApplicationText(applicationDate(application.createdAt))} · ИГРОК</span><h3>${escapeApplicationText(application.characterName)} ${accountBadge(application.authStatus)}</h3><p>${escapeApplicationText(application.className)} · ${escapeApplicationText(application.level)} ур.</p></div>
        <div class="application-status-stack"><span class="application-status application-status-${escapeApplicationText(application.status)}">${applicationStatus(application.status)}</span>${applicationExpiryNote(application)}</div>
      </div>
      <div class="application-info-row"><div class="application-availability"><span>МОЖЕТ ИГРАТЬ</span><strong>${escapeApplicationText(applicationAvailability(application.availability, application.timeZone))}</strong></div>
      <div class="application-contact-area"><span>КОНТАКТЫ</span><div class="application-contact-list">${contactCards(application.contacts)}</div></div></div>
      ${application.status === 'pending' ? `<div class="application-decisions"><button class="application-accept" type="button" data-decision="accept" data-id="${escapeApplicationText(application.id)}" ${vacancyIndex < 0 ? 'disabled' : ''}>ПРИНЯТЬ В ПАТИ ✓</button><button class="application-decline" type="button" data-decision="decline" data-id="${escapeApplicationText(application.id)}">ОТКАЗАТЬ</button>${vacancyIndex < 0 ? `<small>${noOpenVacancyCopy}</small>` : ''}</div>` : application.status === 'accepted' ? `<div class="application-decisions">${removalCandidateId === application.id ? `<span class="application-remove-question">Освободить место и убрать ${escapeApplicationText(application.characterName)}?</span><button class="application-remove-confirm" type="button" data-remove-confirm="${escapeApplicationText(application.id)}">ДА, УБРАТЬ</button><button class="application-decline" type="button" data-remove-cancel>ОТМЕНА</button>` : `<button class="application-decline" type="button" data-remove="${escapeApplicationText(application.id)}">УБРАТЬ ИЗ ПАТИ</button>`}</div>` : ''}
    </article>`;
  }).join('') : '<div class="application-empty"><strong>Заявок в этом разделе нет</strong><p>Новые отклики появятся здесь.</p></div>'}`;
}

async function publishListing() {
  const contacts = cleanContacts({telegram:document.querySelector('#leaderTelegram').value, discord:document.querySelector('#leaderDiscord').value});
  const error = document.querySelector('#leaderContactError');
  if (!hasContacts(contacts)) {
    error.hidden = false;
    document.querySelector('#leaderTelegram').focus();
    error.scrollIntoView({behavior:'smooth', block:'center'});
    return false;
  }
  error.hidden = true;
  const leader = selectedLeaderCharacter();
  if (!leader) return false;
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
  if (!name || !vacancies.length) return false;
  const payload = {
    name, serverId:selectedServerId,
    leaderCharacterId:leader.id, leaderName:leader.name, leaderClass:leader.className, leaderLevel:leader.level,
    contacts, members, vacancies, weeklyAvailability:createAvailability.map(set => [...set]),
    timeZone:userTimeZone
  };
  try {
    ownedListing = await partyApi(ownedListing ? `/parties/${encodeURIComponent(ownedListing.id)}` : '/parties', {
      method:ownedListing ? 'PUT' : 'POST', body:payload
    });
  } catch (failure) {
    createFormError.textContent = failure.message;
    createFormError.hidden = false;
    createFormError.scrollIntoView({behavior:'smooth', block:'center'});
    return false;
  }
  sessionStorage.setItem(listingSelectionKey, ownedListing.id);
  createFormError.hidden = true;
  createFormHydrated = true;
  updateListingCountdown();
  if (!listingCountdownInterval) listingCountdownInterval = setInterval(updateListingCountdown, 30000);
  await loadPartyState();
  renderLeaderInbox();
  updateDeletePartyVisibility();
  return true;
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
const applicationDialog = applicationOverlay.querySelector('.application-dialog');
function closeApplicationDialog() {
  applicationOverlay.hidden = true;
  document.body.classList.remove('application-open');
  applicationTrigger?.focus();
  applicationParty = null;
}
function openApplicationProblem(message) {
  applicationParty = null;
  document.querySelector('#applicationCompose').hidden = true;
  document.querySelector('#applicationSuccess').hidden = true;
  document.querySelector('#applicationProblemText').textContent = message;
  document.querySelector('#applicationProblem').hidden = false;
  applicationDialog.classList.add('is-problem');
  applicationDialog.setAttribute('aria-labelledby', 'applicationProblemTitle');
  applicationOverlay.hidden = false;
  document.body.classList.add('application-open');
  document.querySelector('#applicationProblemClose').focus();
}
async function openApplicationDialog(partyId) {
  const party = parties.find(item => item.id === partyId);
  const character = selectedFindCharacter();
  applicationTrigger = [...document.querySelectorAll('#partyResults .join-btn')].find(button => button.dataset.party === partyId);
  if (!party) { openApplicationProblem('Пати больше не доступна. Обнови результаты поиска.'); return; }
  if (!character) { openApplicationProblem('Сначала выбери персонажа для заявки.'); return; }
  if (activeApplication(party.id, character.id)) {
    document.querySelector('#myApplications').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  if (pendingApplicationPartyIds.has(party.id)) return;
  if (ownedListing?.id === party.id) { openApplicationProblem('Нельзя подать заявку в свою пати. Ты можешь управлять набором в разделе «Создать пати».'); return; }
  const saved = findContacts();
  if (isCabinetView()) {
    if (!hasContacts(saved)) {
      const hint = document.querySelector('#findContactHint');
      hint.textContent = 'Укажи Telegram или Discord, затем нажми «Оставить заявку» ещё раз.';
      hint.classList.add('is-error');
      hint.setAttribute('role', 'alert');
      document.querySelector('#findTelegram').setAttribute('aria-invalid', 'true');
      document.querySelector('#findDiscord').setAttribute('aria-invalid', 'true');
      document.querySelector('#findTelegram').focus();
      return;
    }
    pendingApplicationPartyIds.add(party.id);
    updateResultApplicationButtons();
    try {
      await submitApplication(party, character, saved);
      const card = [...document.querySelectorAll('#partyResults .join-btn')]
        .find(resultButton => resultButton.dataset.party === party.id)?.closest('.party-card');
      if (card) {
        const feedback = document.createElement('p');
        feedback.className = 'application-action-feedback';
        feedback.setAttribute('role', 'status');
        feedback.textContent = 'Заявка отправлена. Её статус и контакты лидера — в разделе «Мои заявки».';
        card.querySelector('.party-bottom').insertAdjacentElement('afterend', feedback);
      }
    } catch (failure) {
      openApplicationProblem(failure.message);
    } finally {
      pendingApplicationPartyIds.delete(party.id);
      updateResultApplicationButtons();
    }
    return;
  }
  applicationParty = party;
  document.querySelector('#applicationTitle').textContent = party.name;
  document.querySelector('#applicationPartyMeta').textContent = `${servers.find(server => server.id === party.serverId)?.name || ''} · лидер ${party.leader} · ${describeWeeklySlots(partyLocalSlots(party)).join(' · ')}`;
  document.querySelector('#applicationCharacter').innerHTML = `<span>ТВОЙ ПЕРСОНАЖ ${accountBadge(isGuest() ? 'guest' : 'profile')}</span><strong>${escapeApplicationText(character.name)}</strong><small>${escapeApplicationText(character.className)} · ${escapeApplicationText(character.level)} ур.</small>`;
  document.querySelector('#applicantTelegram').value = saved.telegram;
  document.querySelector('#applicantDiscord').value = saved.discord;
  const error = document.querySelector('#applicationError');
  error.textContent = 'Укажи хотя бы один контакт: Telegram или Discord.';
  error.hidden = true;
  document.querySelector('#applicationCompose').hidden = false;
  document.querySelector('#applicationProblem').hidden = true;
  document.querySelector('#applicationSuccess').hidden = true;
  applicationDialog.classList.remove('is-problem');
  applicationDialog.setAttribute('aria-labelledby', 'applicationTitle');
  applicationOverlay.hidden = false;
  document.body.classList.add('application-open');
  document.querySelector('#applicantTelegram').focus();
}

async function submitApplication(party, character, contacts) {
  const application = await partyApi(`/parties/${encodeURIComponent(party.id)}/applications`, {
    method:'POST', body:{characterId:character.id, characterName:character.name,
      className:character.className, level:character.level,
      availability:availability.map(set => [...set]), timeZone:userTimeZone, contacts}
  });
  submittedApplications.push(application);
  saveStoredData(contactKey, contacts);
  setFindContacts(contacts);
  renderMyApplications();
  updateResultApplicationButtons();
  return application.leaderContacts;
}

document.querySelector('#applicationForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!applicationParty) return;
  const character = selectedFindCharacter();
  const contacts = cleanContacts({telegram:document.querySelector('#applicantTelegram').value, discord:document.querySelector('#applicantDiscord').value});
  const error = document.querySelector('#applicationError');
  if (!character) { error.textContent = 'Сначала выбери персонажа для заявки.'; error.hidden = false; return; }
  if (!hasContacts(contacts)) { error.textContent = 'Укажи хотя бы один контакт: Telegram или Discord.'; error.hidden = false; document.querySelector('#applicantTelegram').focus(); return; }
  error.hidden = true;
  const party = applicationParty;
  let leaderContacts;
  const button = document.querySelector('#applicationForm button[type="submit"]');
  button.disabled = true;
  try { leaderContacts = await submitApplication(party, character, contacts); }
  catch (failure) { button.disabled = false; openApplicationProblem(failure.message); return; }
  button.disabled = false;
  document.querySelector('#applicationSuccessText').textContent = `Заявка в ${party.name} отправлена. Лидер видит твой контакт и ${isGuest() ? 'указанные вручную данные персонажа' : 'данные персонажа'}.`;
  document.querySelector('#applicationLeaderContacts').innerHTML = contactCards(leaderContacts);
  document.querySelector('#applicationCompose').hidden = true;
  document.querySelector('#applicationSuccess').hidden = false;
  applicationDialog.setAttribute('aria-labelledby', 'applicationSuccessTitle');
  document.querySelector('#applicationToMine').focus();
});

document.querySelector('#applicationClose').addEventListener('click', closeApplicationDialog);
document.querySelector('#applicationBackdrop').addEventListener('click', closeApplicationDialog);
document.querySelector('#applicationProblemClose').addEventListener('click', closeApplicationDialog);
document.querySelector('#applicationToMine').addEventListener('click', () => {
  closeApplicationDialog();
  document.querySelector('#myApplications').scrollIntoView({behavior:'smooth', block:'start'});
});
for (const input of document.querySelectorAll('#findTelegram, #findDiscord')) {
  input.addEventListener('input', () => {
    const contacts = findContacts();
    saveStoredData(contactKey, contacts);
    if (hasContacts(contacts)) {
      const hint = document.querySelector('#findContactHint');
      hint.classList.remove('is-error');
      hint.removeAttribute('role');
      document.querySelector('#findTelegram').removeAttribute('aria-invalid');
      document.querySelector('#findDiscord').removeAttribute('aria-invalid');
    }
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
document.addEventListener('partyfinder:apply', event => openApplicationDialog(event.detail.partyId));
document.addEventListener('partyfinder:results-rendered', updateResultApplicationButtons);
document.addEventListener('partyfinder:mode-changed', event => {
  if (event.detail.mode === 'create') {
    hydrateCreateForm();
    renderOwnedListingState(ownedListing);
  }
});
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
document.querySelector('#deletePartyApply').addEventListener('click', async () => {
  if (!ownedListing) return;
  try {
    await partyApi(`/parties/${encodeURIComponent(ownedListing.id)}`, {method:'DELETE'});
    window.location.reload();
  } catch (error) {
    deletePartyConfirm.querySelector('p').textContent = error.message;
  }
});
document.querySelector('#leaderInbox').addEventListener('click', async event => {
  if (!event.target.closest('[data-restore-deleted]')) return;
  if (!deletedListingId) return;
  try {
    await partyApi(`/parties/${encodeURIComponent(deletedListingId)}/restore`, {method:'POST', body:{}});
    window.location.reload();
  } catch (error) {
    event.target.textContent = error.message;
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

document.querySelector('#myApplicationsList').addEventListener('click', async event => {
  const button = event.target.closest('[data-withdraw]');
  if (!button) return;
  const application = submittedApplications.find(item => item.id === button.dataset.withdraw && item.source === 'self');
  if (!application || !['pending','accepted'].includes(application.status)) return;
  try { Object.assign(application, await partyApi(`/applications/${encodeURIComponent(application.id)}`, {method:'PATCH', body:{status:'withdrawn'}})); }
  catch (error) { button.textContent = error.message; return; }
  renderMyApplications();
  updateResultApplicationButtons();
});
document.querySelector('#acceptedMemberList').addEventListener('click', async event => {
  const row = event.target.closest('.accepted-member-row');
  if (!row) return;
  const confirmation = row.querySelector('.accepted-member-confirm');
  const remove = row.querySelector('.accepted-member-remove');
  if (event.target.closest('[data-remove-accepted]')) {
    confirmation.hidden = false;
    remove.hidden = true;
    confirmation.querySelector('[data-cancel-accepted]').focus();
    return;
  }
  if (event.target.closest('[data-cancel-accepted]')) {
    confirmation.hidden = true;
    remove.hidden = false;
    remove.focus();
    return;
  }
  const confirm = event.target.closest('[data-confirm-accepted]');
  if (!confirm) return;
  const application = submittedApplications.find(item => item.id === confirm.dataset.confirmAccepted && item.partyId === ownedListing?.id && item.status === 'accepted');
  if (!application) return;
  confirm.disabled = true;
  try {
    await partyApi(`/applications/${encodeURIComponent(application.id)}`, {method:'PATCH', body:{status:'removed'}});
    await loadPartyState();
  } catch (error) {
    confirmation.querySelector('span').textContent = error.message;
    confirm.disabled = false;
  }
});
document.querySelector('#leaderInbox').addEventListener('click', async event => {
  const filter = event.target.closest('[data-inbox-filter]');
  if (filter) { inboxFilter = filter.dataset.inboxFilter; removalCandidateId = null; renderLeaderInbox(); return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) { removalCandidateId = remove.dataset.remove; renderLeaderInbox(); return; }
  if (event.target.closest('[data-remove-cancel]')) { removalCandidateId = null; renderLeaderInbox(); return; }
  const confirmRemoval = event.target.closest('[data-remove-confirm]');
  if (confirmRemoval) {
    const accepted = submittedApplications.find(item => item.id === confirmRemoval.dataset.removeConfirm && item.partyId === ownedListing?.id && item.status === 'accepted');
    if (!accepted || removalCandidateId !== accepted.id) return;
    try { Object.assign(accepted, await partyApi(`/applications/${encodeURIComponent(accepted.id)}`, {method:'PATCH', body:{status:'removed'}})); }
    catch (error) { confirmRemoval.textContent = error.message; return; }
    removalCandidateId = null;
    await loadPartyState();
    return;
  }
  const button = event.target.closest('[data-decision]');
  if (!button || !ownedListing) return;
  const application = submittedApplications.find(item => item.id === button.dataset.id && item.partyId === ownedListing.id && item.status === 'pending');
  if (!application) return;
  try { Object.assign(application, await partyApi(`/applications/${encodeURIComponent(application.id)}`, {method:'PATCH', body:{status:button.dataset.decision === 'accept' ? 'accepted' : 'declined'}})); }
  catch (error) { button.textContent = error.message; return; }
  await loadPartyState();
});

async function loadPartyState() {
  let state;
  try { state = await partyApi('/bootstrap'); }
  catch (error) {
    document.querySelector('#leaderInbox').innerHTML = `<div class="application-empty" role="alert"><strong>База недоступна</strong><p>${escapeApplicationText(error.message)}</p></div>`;
    document.querySelector('#myApplicationsList').innerHTML = `<div class="application-empty" role="alert"><p>${escapeApplicationText(error.message)}</p></div>`;
    return;
  }
  if (state.mode === 'demo' && currentAccess() !== 'demo') {
    sessionStorage.setItem(authKey, 'demo');
    const url = new URL(location.href);
    url.searchParams.set('view', 'cabinet');
    if (!url.searchParams.has('mode')) url.searchParams.set('mode', 'find');
    location.replace(url);
    return;
  }
  if (currentAccess() === 'demo' && state.mode !== 'demo') {
    sessionStorage.removeItem(authKey);
    location.replace(`${location.pathname}#ru`);
    return;
  }
  ownedListings = state.listings || (state.listing ? [state.listing] : []);
  const selectedListingId = sessionStorage.getItem(listingSelectionKey);
  ownedListing = selectedListingId === "new" ? null : ownedListings.find(item => item.id === selectedListingId) || state.listing;
  renderListingManager();
  deletedListingId = state.deletedListingId;
  mergeApplicationHistory(state, applicationHistoryOffset > 50);
  if (applicationHistoryOffset <= 50) {
    applicationHistoryOffset = state.applicationsNextOffset;
    applicationHistoryHasMore = state.applicationsHasMore;
  }
  updateHistoryButtons();
  renderMyApplications();
  renderLeaderInbox();
  hydrateCreateForm();
  renderOwnedListingState(ownedListing);
  updateDeletePartyVisibility();
  updateListingCountdown();
}
const savedFindContacts = cleanContacts(readStoredData(contactKey, {}));
if (localStorage.getItem(contactKey) !== null) setFindContacts(savedFindContacts);
else {
  const existingApplication = submittedApplications.find(application => application.source === 'self' && (application.authStatus || 'profile') === (isGuest() ? 'guest' : 'profile') && hasContacts(cleanContacts(application.contacts)));
  setFindContacts(existingApplication ? cleanContacts(existingApplication.contacts) : savedFindContacts);
  if (existingApplication) saveStoredData(contactKey, cleanContacts(existingApplication.contacts));
}
renderMyApplications();
renderLeaderInbox();
if (hasLocalAccess()) loadPartyState();

let liveRefreshBusy = false;
async function refreshLivePartyState() {
  if (liveRefreshBusy || document.hidden || !hasLocalAccess() || !applicationOverlay.hidden ||
      document.querySelector('.accepted-member-confirm:not([hidden])')) return;
  const finding = partyApp.classList.contains('mode-find') && !document.querySelector('#results').hidden;
  const creating = partyApp.classList.contains('mode-create');
  if (!finding && !creating) return;
  liveRefreshBusy = true;
  try {
    await loadPartyState();
    if (finding) await renderResults({scroll:false, silent:true});
  } finally { liveRefreshBusy = false; }
}
window.addEventListener('focus', refreshLivePartyState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLivePartyState(); });
setInterval(refreshLivePartyState, 20000);
