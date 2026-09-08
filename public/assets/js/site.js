/* Bregenz Barbershop — shared site behaviour.
   Deliberately dependency-free: the home page ships < 30 kB of JS (info.md §24). */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Header: transparent over hero, solid after scroll ---------- */
  const header = document.querySelector('[data-header]');
  if (header) {
    const SOLID = ['bg-bg', 'border-b', 'border-line'];
    let solid = null;
    const sync = () => {
      const next = window.scrollY > 40;
      if (next === solid) return;
      solid = next;
      header.classList[next ? 'add' : 'remove'](...SOLID);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
  }

  /* ---------- Mobile menu ----------
     Full-screen panel, focus trapped, Esc closes, focus returns to the toggle. */
  const toggle = document.querySelector('[data-menu-toggle]');
  const panel = document.getElementById('mobile-menu');
  if (toggle && panel) {
    const label = toggle.querySelector('[data-menu-label]');
    const iconOpen = toggle.querySelector('[data-icon-open]');
    const iconClose = toggle.querySelector('[data-icon-close]');
    const focusables = () =>
      Array.from(panel.querySelectorAll('a[href], button:not([disabled])')).filter(
        (el) => el.offsetParent !== null
      );

    const setOpen = (open) => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Menü schließen' : 'Menü öffnen';
      if (iconOpen) iconOpen.hidden = open;
      if (iconClose) iconClose.hidden = !open;
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (open) focusables()[0]?.focus();
    };

    toggle.addEventListener('click', () => setOpen(panel.hidden));

    panel.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (panel.hidden) return;
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Leaving the mobile breakpoint with the panel open would strand the overflow lock.
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
      if (e.matches && !panel.hidden) setOpen(false);
    });
  }

  /* ---------- Aktiver Abschnitt in der Kopfzeile ----------
     Die Navigation zeigt auf Anker der Startseite (#preise, #kontakt …).
     Markiert wird der Abschnitt, dessen Oberkante zuletzt unter der Kopfzeile
     durchgelaufen ist. Ohne solche Links passiert nichts. */
  const navLinks = Array.from(document.querySelectorAll('[data-nav-link]'));
  if (navLinks.length) {
    const IDLE = ['text-fg-body', 'text-fg'];
    const byId = new Map();
    for (const link of navLinks) {
      const id = link.getAttribute('href').slice(1);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(link);
      // Die Ruhefarbe unterscheidet sich zwischen Desktop- und Mobilmenü,
      // deshalb wird sie pro Link gemerkt statt geraten.
      link.dataset.idleClass = IDLE.find((c) => link.classList.contains(c)) || 'text-fg-body';
    }
    const sections = [...byId.keys()]
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .sort((a, b) => a.offsetTop - b.offsetTop);

    if (sections.length) {
      let current = null;
      const setActive = (id) => {
        if (id === current) return;
        current = id;
        for (const [key, links] of byId) {
          const on = key === id;
          for (const link of links) {
            link.classList.toggle('text-accent', on);
            link.classList.toggle(link.dataset.idleClass, !on);
            if (on) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          }
        }
      };

      const sync = () => {
        // Etwas unterhalb der fixen Kopfzeile messen, damit der Abschnitt
        // wechselt, sobald seine Überschrift oben ankommt.
        const line = window.scrollY + 120;
        let active = sections[0];
        for (const el of sections) {
          if (el.offsetTop <= line) active = el;
        }
        // Am Seitenende gewinnt der letzte Abschnitt, auch wenn er kurz ist.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
          active = sections[sections.length - 1];
        }
        setActive(active.id);
      };

      sync();
      window.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync, { passive: true });
    }
  }

  /* ---------- Scroll reveal ----------
     Content is visible in the HTML; the class is added only when JS runs, so
     crawlers and no-JS visitors never get a blank page. */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  /* ---------- Shared helpers ---------- */
  window.BB = {
    reduceMotion,
    /** Preisformat wie auf der Kundenseite: 25,00 € (nicht "€ 25,00"). */
    price(cents) {
      const n = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(cents / 100);
      return `${n}\u00A0€`;
    },
    /** Escape untrusted strings before they touch innerHTML. */
    esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    },
    async getJSON(url, options) {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
      if (!res.ok) {
        const err = new Error(`Request failed: ${res.status}`);
        err.status = res.status;
        try { err.body = await res.json(); } catch { /* not JSON */ }
        throw err;
      }
      return res.json();
    },
  };
})();
