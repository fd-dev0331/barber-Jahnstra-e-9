/* Galerie: Instagram-Daten aus dem Backend-Cache + native <dialog> Lightbox.
   Ohne JS und ohne API bleiben die statischen Fallback-Kacheln stehen. */
(() => {
  'use strict';

  const grid = document.querySelector('[data-gallery]');
  const dialog = document.querySelector('[data-lightbox]');
  if (!grid || !dialog) return;

  const esc = window.BB.esc;
  const loading = document.querySelector('[data-gallery-loading]');
  const empty = document.querySelector('[data-gallery-empty]');

  /* Aktueller Datensatz: zunächst aus dem statischen Markup gelesen, damit die
     Lightbox auch ohne API funktioniert. */
  let items = Array.from(grid.querySelectorAll('img')).map((img) => ({
    src: img.getAttribute('src'),
    full: img.getAttribute('src'),
    alt: img.getAttribute('alt') || '',
    type: 'IMAGE',
    permalink: null,
  }));

  /* ---------------- Instagram-Daten ---------------- */
  (async () => {
    loading.hidden = false;
    try {
      const data = await window.BB.getJSON('/api/gallery?limit=40');
      const fetched = Array.isArray(data?.items) ? data.items.filter((i) => i?.src) : [];
      if (!fetched.length) return; // Fallback-Kacheln behalten
      items = fetched.map((i) => ({
        src: i.thumbnail || i.src,
        full: i.src,
        alt: i.alt || 'Arbeit aus dem Bregenz Barbershop',
        type: i.type || 'IMAGE',
        permalink: i.permalink || null,
      }));
      render();
    } catch {
      /* API nicht erreichbar oder noch nicht deployed: statische Kacheln bleiben.
         Das ist der vorgesehene Zustand, kein Fehler für Besucher. */
    } finally {
      loading.hidden = true;
      loading.removeAttribute('aria-busy');
    }
  })();

  function render() {
    if (!items.length) {
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    grid.hidden = false;
    empty.hidden = true;
    grid.innerHTML = items
      .map(
        (it, i) => `
        <li>
          <button type="button" class="group relative block w-full overflow-hidden rounded-sm border border-line"
                  data-lightbox-open data-index="${i}"
                  aria-label="Bild ${i + 1} von ${items.length} vergrößern">
            <img src="${esc(it.src)}" alt="${esc(it.alt)}" width="800" height="800"
                 ${i < 4 ? '' : 'loading="lazy"'} decoding="async"
                 class="aspect-square w-full object-cover transition-opacity duration-200 group-hover:opacity-80">
            ${
              it.type === 'VIDEO'
                ? `<span class="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-black/70 p-1.5 text-accent">
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                     <span class="sr-only">Video</span>
                   </span>`
                : ''
            }
          </button>
        </li>`
      )
      .join('');
    document.querySelector('[data-lightbox-total]').textContent = String(items.length);
  }

  /* ---------------- Lightbox ---------------- */
  const image = dialog.querySelector('[data-lightbox-image]');
  const position = dialog.querySelector('[data-lightbox-position]');
  const permalink = dialog.querySelector('[data-lightbox-permalink]');
  const btnClose = dialog.querySelector('[data-lightbox-close]');
  const btnPrev = dialog.querySelector('[data-lightbox-prev]');
  const btnNext = dialog.querySelector('[data-lightbox-next]');

  let index = 0;
  let opener = null;

  function show(i) {
    if (!items.length) return;
    index = (i + items.length) % items.length;
    const it = items[index];
    image.src = it.full || it.src;
    image.alt = it.alt;
    position.textContent = String(index + 1);
    if (it.permalink) {
      permalink.href = it.permalink;
      permalink.hidden = false;
    } else {
      permalink.hidden = true;
    }
  }

  grid.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-lightbox-open]');
    if (!trigger) return;
    opener = trigger;
    show(Number(trigger.dataset.index) || 0);
    dialog.showModal();
    document.documentElement.style.overflow = 'hidden';
    btnClose.focus();
  });

  const close = () => dialog.close();
  btnClose.addEventListener('click', close);
  btnPrev.addEventListener('click', () => show(index - 1));
  btnNext.addEventListener('click', () => show(index + 1));

  // <dialog> behandelt Esc selbst; hier nur den Fokus zurückgeben.
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = '';
    image.src = '';
    opener?.focus();
  });

  // Klick auf den Hintergrund schließt.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  });

  // Wischgeste auf Touch-Geräten.
  let startX = null;
  dialog.addEventListener('touchstart', (e) => { startX = e.changedTouches[0].clientX; }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) show(dx > 0 ? index - 1 : index + 1);
    startX = null;
  }, { passive: true });
})();
