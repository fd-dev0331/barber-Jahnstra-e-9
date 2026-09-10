/** @type {import('tailwindcss').Config} */
// Stylesheet der Verwaltung (/admin). Dieselben Tokens wie die Website, aber ein
// eigener Build: public/assets/css/admin.css enthält nur, was die Admin-Seiten
// benutzen, und site.css bleibt frei von Admin-Klassen.
const base = require('./tailwind.config.js');

module.exports = {
  ...base,
  // Die Admin-Seiten bauen ihre Tabellen und Karten im JavaScript zusammen —
  // ohne den JS-Pfad fehlen im Build genau die Klassen, die nur dort vorkommen.
  content: ['./public/admin/**/*.html', './public/assets/js/admin/**/*.js'],
};
