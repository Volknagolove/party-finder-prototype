/* Local cabinet presentation only. Real ElmoreLab auth is not used by this prototype. */
(() => {
  const shell = document.querySelector('#cabinetShell');
  const dashboard = document.querySelector('#cabinetDashboard');
  const menuToggle = document.querySelector('#cabinetMenuToggle');
  const menuShade = document.querySelector('#cabinetMobileShade');
  const themeToggle = document.querySelector('#cabinetThemeToggle');
  const modeButtons = [...document.querySelectorAll('[data-cabinet-mode]')];
  const themeKey = 'partyFinder.cabinetTheme.v1';

  function activeMode() {
    if (partyApp.classList.contains('mode-create')) return 'create';
    if (partyApp.classList.contains('mode-find') && new URL(window.location.href).searchParams.get('section') === 'applications') return 'applications';
    if (partyApp.classList.contains('mode-find')) return 'find';
    return 'home';
  }

  function syncNavigation() {
    const mode = activeMode();
    dashboard.hidden = !isCabinetView() || mode !== 'home';
    modeButtons.forEach(button => {
      const active = button.dataset.cabinetMode === mode;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const title = document.querySelector('.cabinet-topbar-location strong');
    title.textContent = mode === 'create' ? 'Создать пати' : mode === 'find' ? 'Найти пати' : mode === 'applications' ? 'Мои заявки' : 'Поиск пати';
    requestAnimationFrame(updateServerReadout);
  }

  function closeMobileMenu() {
    document.body.classList.remove('cabinet-menu-open');
    menuShade.hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
  }

  modeButtons.forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.cabinetMode;
    if (mode === 'home') showModeChooser();
    else if (mode === 'applications') {
      showSelectedMode('find');
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'applications');
      window.history.replaceState({mode:'find',section:'applications'}, '', url);
      requestAnimationFrame(() => document.querySelector('#myApplications').scrollIntoView({behavior:'smooth',block:'start'}));
    } else showSelectedMode(mode);
    closeMobileMenu();
    syncNavigation();
  }));
  document.querySelector('#cabinetFindMode').addEventListener('click', () => showSelectedMode('find'));
  document.querySelector('#cabinetCreateMode').addEventListener('click', () => showSelectedMode('create'));
  document.addEventListener('partyfinder:mode-changed', syncNavigation);

  menuToggle.addEventListener('click', () => {
    const opening = !document.body.classList.contains('cabinet-menu-open');
    document.body.classList.toggle('cabinet-menu-open', opening);
    menuShade.hidden = !opening;
    menuToggle.setAttribute('aria-expanded', String(opening));
  });
  menuShade.addEventListener('click', closeMobileMenu);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('cabinet-menu-open')) closeMobileMenu();
  });

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.body.dataset.cabinetTheme = dark ? 'dark' : 'light';
    themeToggle.setAttribute('aria-pressed', String(dark));
    themeToggle.querySelector('.cabinet-theme-glyph').textContent = dark ? '☼' : '☾';
    themeToggle.querySelector('.cabinet-theme-label').textContent = dark ? 'Светлая тема' : 'Тёмная тема';
    themeToggle.setAttribute('title', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }
  const storedTheme = localStorage.getItem(themeKey);
  setTheme(storedTheme === 'light' || storedTheme === 'dark'
    ? storedTheme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeToggle.addEventListener('click', () => {
    const next = document.body.dataset.cabinetTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem(themeKey, next);
  });

  function updateServerReadout() {
    const selected = document.querySelector('.server-option.selected');
    document.querySelector('#cabinetServerReadout').textContent = selected
      ? `${selected.querySelector('strong')?.textContent || ''} ${selected.querySelector('b')?.textContent || ''}`.trim().toUpperCase()
      : 'Сервер выбирается в заявке';
  }
  for (const options of document.querySelectorAll('.server-options')) {
    options.addEventListener('click', () => requestAnimationFrame(updateServerReadout));
  }
  syncNavigation();
  updateServerReadout();
  shell.hidden = !isCabinetView();
  if (isCabinetView() && activeMode() === 'applications') {
    requestAnimationFrame(() => document.querySelector('#myApplications').scrollIntoView({block:'start'}));
  }
})();
