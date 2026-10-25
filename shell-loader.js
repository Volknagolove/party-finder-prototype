(function loadOriginalElmoreShell() {
  // Keep the original shell, but start it in the official Russian locale.
  // This must run before the downloaded original app.min.js translator starts.
  if (window.location.hash.toLowerCase() === '#ru') {
    window.localStorage.setItem('language', 'ru');
  }

  const xhr = new XMLHttpRequest();
  xhr.open('GET', '../assets/elmorelab/original-home.html', false);
  try { xhr.send(); } catch (error) { return; }
  if (xhr.status < 200 || xhr.status >= 300) return;

  const source = new DOMParser().parseFromString(xhr.responseText, 'text/html');
  const originalHeader = source.querySelector('header.header');
  const originalFooter = source.querySelector('footer.footer');
  const currentHeader = document.querySelector('header.header');
  const currentFooter = document.querySelector('footer.footer');
  if (!originalHeader || !originalFooter || !currentHeader || !currentFooter) return;



  originalFooter.querySelectorAll('img').forEach((image) => {
    if (image.src.includes('l2pick.com')) image.src = '../assets/images/dist/l2pick2.jpg';
    if (image.src.includes('hopzone.net')) image.src = '../assets/images/dist/hopzone-vote.png';
    if (image.src.includes('mmotop.ru')) image.src = '../assets/images/dist/mmotop-vote.png';
  });

  // The downloaded shell was authored for the site root. Keep its markup and
  // styling, but resolve its local relative resources from /party-finder/.
  [originalHeader, originalFooter].forEach((part) => {
    part.querySelectorAll('[src], [href], [style]').forEach((element) => {
      for (const attribute of ['src', 'href']) {
        const value = element.getAttribute(attribute);
        if (value && (/^(assets|images)\//.test(value) || value.startsWith('./'))) {
          element.setAttribute(attribute, `../${value.replace(/^\.\//, '')}`);
        }
      }
      const style = element.getAttribute('style');
      if (style) element.setAttribute('style', style.replace(/url\((['"]?)(assets|images)\//g, 'url($1../$2/'));
    });
  });

  const address = originalFooter.querySelector('.footer-copyrights:last-of-type');
  if (address) address.textContent = address.textContent.replaceAll('\\n', ' ');
  window.addEventListener('DOMContentLoaded', () => {
    const renderedAddress = document.querySelector('footer.footer .footer-copyrights:last-of-type');
    if (renderedAddress) renderedAddress.textContent = renderedAddress.textContent.replaceAll('\\n', ' ');

    // The original bundle loads the locale asynchronously from the production
    // root. Apply the downloaded official locale locally as well, so the shell
    // remains identical while its Russian strings are available offline.
    if (window.location.hash.toLowerCase() === '#ru') {
      fetch('../i18n/ru.json?v=24')
        .then((response) => response.json())
        .then((translation) => {
          const getValue = (key) => key.split('.').reduce((value, part) => value && value[part], translation);
          document.querySelectorAll('[data-i18n]').forEach((element) => {
            const keys = element.getAttribute('data-i18n').split(' ');
            const properties = (element.getAttribute('data-i18n-attr') || 'innerHTML').split(' ');
            keys.forEach((key, index) => {
              const value = getValue(key);
              if (value !== undefined && value !== null) {
                element[properties[index] || 'innerHTML'] = value;
              }
            });
          });
          document.documentElement.lang = 'ru';
        })
        .catch(() => {});
    }
  });

  currentHeader.replaceWith(originalHeader);
  currentFooter.replaceWith(originalFooter);
})();
