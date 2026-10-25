/* One same-origin API for the public and cabinet presentations. */
let guestSessionReady = false;
let guestSessionRequest = null;
async function ensureGuestSession() {
  if (guestSessionReady) return;
  if (!guestSessionRequest) {
    guestSessionRequest = fetch('/api/session/guest', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-Party-Access': 'guest'},
      body: '{}'
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось открыть гостевую сессию.');
      guestSessionReady = true;
    }).finally(() => { guestSessionRequest = null; });
  }
  return guestSessionRequest;
}
async function partyApi(path, options = {}) {
  let response;
  try {
    const access = sessionStorage.getItem('partyFinder.access.v1');
    if (access === 'guest' && (path === '/bootstrap' ||
        ((options.method || 'GET').toUpperCase() !== 'GET' && !path.startsWith('/session/')))) {
      await ensureGuestSession();
    }
    const requestOptions = {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Party-Access': access === 'demo' ? 'demo' : 'guest',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    };
    response = await fetch(`/api${path}`, requestOptions);
    if (response.status === 401 && access === 'guest' && !path.startsWith('/session/')) {
      guestSessionReady = false;
      await ensureGuestSession();
      response = await fetch(`/api${path}`, requestOptions);
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Нет связи с локальным API. Запусти сайт командой python server.py.');
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status}).`);
  return data;
}
