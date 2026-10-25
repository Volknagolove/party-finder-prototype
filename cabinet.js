/* The visible cabinet chrome is loaded from the captured ElmoreLab RU markup.
   This file only connects its controls to the local Party Finder prototype. */
(() => {
  const shell = document.querySelector('#cabinetShell');
  const contentMount = document.querySelector('#cabinetContentMount');
  const dashboard = document.querySelector('#cabinetDashboard');
  const shade = document.querySelector('#cabinetMobileShade');
  const themeKey = 'partyFinder.cabinetTheme.v1';
  let mounted = false;
  let mounting;
  let clockMode = 'server';

  function activeMode() {
    if (partyApp.classList.contains('mode-create')) return 'create';
    if (partyApp.classList.contains('mode-find') && new URL(location.href).searchParams.get('section') === 'applications') return 'applications';
    if (partyApp.classList.contains('mode-find')) return 'find';
    return 'home';
  }

  function syncDashboard() {
    dashboard.hidden = !isCabinetView() || activeMode() !== 'home';
  }

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.dataset.cabinetTheme = dark ? 'dark' : 'light';
    shell.querySelector('[data-theme-toggle]')?.setAttribute('aria-pressed', String(dark));
    localStorage.setItem(themeKey, dark ? 'dark' : 'light');
  }

  function closeMenu() {
    shell.querySelector('.sidebar-wrapper')?.classList.add('close_icon');
    shade.hidden = true;
  }

  function refreshClock() {
    const clock = shell.querySelector('[data-cab-clock]');
    if (!clock) return;
    clock.textContent = new Intl.DateTimeFormat('ru-RU', {
      timeZone: clockMode === 'server' ? 'Europe/Paris' : Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());
  }

  function bindChrome() {
    const sidebar = shell.querySelector('.sidebar-wrapper');
    const serverSelect = shell.querySelector('#serverSelect');
    const serverMenu = shell.querySelector('#serverSelectMenu');
    const profileNav = shell.querySelector('.profile-nav');
    const langNav = shell.querySelector('.langs-body');

    shell.querySelector('.sidebar-toggle')?.addEventListener('click', () => {
      const open = sidebar.classList.toggle('close_icon') === false;
      shade.hidden = !open;
    });
    shade.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

    serverSelect?.addEventListener('click', event => {
      event.preventDefault();
      serverMenu.hidden = !serverMenu.hidden;
      serverSelect.setAttribute('aria-expanded', String(!serverMenu.hidden));
    });
    serverMenu?.addEventListener('click', event => {
      const option = event.target.closest('[data-value]');
      if (!option) return;
      const serverId = {1: 'bartz', 2: 'teon', 3: 'erica'}[option.dataset.value];
      serverSelect.querySelector('#serverSelectLabel').textContent = option.textContent.trim();
      serverMenu.querySelectorAll('[role="option"]').forEach(item => item.setAttribute('aria-selected', String(item === option)));
      serverMenu.hidden = true;
      serverSelect.setAttribute('aria-expanded', 'false');
      if (serverId) chooseServer(serverId);
    });
    document.addEventListener('partyfinder:server-changed', event => {
      const selected = {bartz: '1', teon: '2', erica: '3'}[event.detail.serverId];
      const option = serverMenu.querySelector(`[data-value="${selected}"]`);
      if (!option) return;
      serverSelect.querySelector('#serverSelectLabel').textContent = option.textContent.trim();
      serverMenu.querySelectorAll('[role="option"]').forEach(item => item.setAttribute('aria-selected', String(item === option)));
    });

    shell.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    for (const button of shell.querySelectorAll('[data-cab-time-toggle]')) {
      button.addEventListener('click', () => {
        clockMode = button.dataset.cabTimeToggle;
        shell.querySelectorAll('[data-cab-time-toggle]').forEach(item => item.classList.toggle('active', item === button));
        refreshClock();
      });
    }
    refreshClock();
    setInterval(refreshClock, 1000);

    shell.querySelectorAll('.server-list [data-server]').forEach(item => item.addEventListener('click', () => {
      const serverId = {1: 'bartz', 2: 'teon', 3: 'erica'}[item.dataset.server];
      if (serverId) chooseServer(serverId);
    }));
    shell.querySelector('a[href="https://profile.elmorelab.com/logout"]')?.addEventListener('click', event => {
      event.preventDefault();
      leaveLocalAccess();
    });
    shell.querySelector('.profile-media')?.addEventListener('click', () => profileNav.classList.toggle('cabinet-dropdown-open'));
    shell.querySelector('.notification-box.lang')?.addEventListener('click', () => langNav.classList.toggle('cabinet-dropdown-open'));
    document.addEventListener('click', event => {
      if (!profileNav.contains(event.target)) profileNav.classList.remove('cabinet-dropdown-open');
      if (!langNav.contains(event.target)) langNav.classList.remove('cabinet-dropdown-open');
      if (!serverSelect.contains(event.target) && !serverMenu.contains(event.target)) {
        serverMenu.hidden = true;
        serverSelect.setAttribute('aria-expanded', 'false');
      }
    });
    setTheme(localStorage.getItem(themeKey) || 'light');
  }

  async function mountChrome() {
    if (mounted || !isCabinetView()) return;
    if (mounting) return mounting;
    mounting = (async () => {
      const [sidebarResponse, headerResponse] = await Promise.all([
        fetch('../assets/profile-shell/sidebar.ru.html'),
        fetch('../assets/profile-shell/header.ru.html')
      ]);
      if (!sidebarResponse.ok || !headerResponse.ok) throw new Error('Не удалось загрузить оригинальную оболочку ЛК');
      document.querySelector('#cabinetSidebarMount').outerHTML = await sidebarResponse.text();
      document.querySelector('#cabinetHeaderMount').outerHTML = await headerResponse.text();
      contentMount.appendChild(partyApp);
      mounted = true;
      bindChrome();
      syncDashboard();
      if (activeMode() === 'applications') requestAnimationFrame(() => document.querySelector('#myApplications').scrollIntoView({block: 'start'}));
    })().catch(error => console.error(error));
    return mounting;
  }

  document.querySelector('#cabinetFindMode').addEventListener('click', () => showSelectedMode('find'));
  document.querySelector('#cabinetCreateMode').addEventListener('click', () => showSelectedMode('create'));
  document.addEventListener('partyfinder:mode-changed', () => {
    mountChrome();
    syncDashboard();
    if (activeMode() !== 'applications') shell.querySelector('.page-body')?.scrollTo(0, 0);
  });
  syncDashboard();
  mountChrome();
})();
