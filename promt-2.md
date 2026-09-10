ЗАДАЧА: ПЕРЕРАБОТАТЬ ТОЛЬКО ADMIN PANEL И ДОБАВИТЬ 3 ЯЗЫКА

ВАЖНО:

Публичный сайт НЕ менять.

PUBLIC WEBSITE должен остаться ТОЛЬКО НА НЕМЕЦКОМ ЯЗЫКЕ.

Не добавлять RU/TR на:
- Home
- Services / Price
- Gallery
- Contact
- Booking
- public header
- public footer

Локализация нужна ТОЛЬКО внутри /admin.

==================================================
1. ADMIN UI
==================================================

Полностью переработай существующую административную панель:

/admin

Сделай её современной, профессиональной и удобной для владельца барбершопа.

НЕ переписывай backend без необходимости.

НЕ меняй существующую:
- database architecture;
- authentication;
- sessions;
- Google OAuth;
- Google Calendar integration;
- booking API;
- employee API;
- service API.

Сначала проанализируй существующий код и используй уже работающие API.

Не создавай дубликаты существующих endpoints.

==================================================
2. ADMIN SECTIONS
==================================================

В /admin должны быть:

1. Dashboard
2. Bookings
3. Calendar
4. Employees
5. Services
6. Business Settings
7. Google Calendar
8. Settings

OWNER должен иметь полный доступ.

EMPLOYEE должен видеть только разрешённые ему разделы и действия.

Backend authorization остаётся источником истины.

==================================================
3. ADMIN HEADER
==================================================

Создай современный Admin Header.

Header должен содержать:

- Business name / logo;
- текущего пользователя;
- его роль;
- Language Switcher;
- Logout.

==================================================
4. LANGUAGE SWITCHER — ТОЛЬКО ADMIN
==================================================

Добавить переключение языков ТОЛЬКО в /admin.

Поддерживаемые языки:

DE — Deutsch
RU — Русский
TR — Türkçe

Публичный сайт НЕ должен использовать этот переключатель.

==================================================
5. LANGUAGE SWITCHER В HEADER
==================================================

Language Switcher должен находиться непосредственно в ADMIN HEADER.

На desktop:

[ DE ▼ ]

На mobile:

[ DE ▼ ]

или компактный вариант:

[ DE ]

При нажатии показывать:

Deutsch
Русский
Türkçe

После выбора:

DE → Deutsch
RU → Русский
TR → Türkçe

Текущий язык всегда должен быть виден непосредственно в Header.

ОЧЕНЬ ВАЖНО:

На mobile Language Switcher НЕ должен исчезать внутри hamburger menu.

Даже на ширине 320px пользователь должен видеть:

Business / Logo
Language Switcher
Menu button

Не убирать Language Switcher из Header ради экономии места.

==================================================
6. ADMIN LOCALIZATION
==================================================

Локализовать ВСЕ тексты административной панели.

DE:
- Dashboard
- Bookings
- Calendar
- Employees
- Services
- Business Settings
- Google Calendar
- Settings
- Logout
- Login
- buttons
- forms
- validation
- errors
- confirmations
- loading states
- empty states
- statuses

RU:
полный перевод тех же элементов.

TR:
полный перевод тех же элементов.

Не оставлять часть интерфейса на немецком после переключения на RU/TR.

==================================================
7. TRANSLATION ARCHITECTURE
==================================================

Использовать единый translation system.

Например:

/i18n/de.js
/i18n/ru.js
/i18n/tr.js

Но если в проекте уже есть localization system:
использовать существующий механизм и расширить его.

НЕ создавать второй независимый translation system.

Все пользовательские UI strings должны находиться в translation dictionaries.

Не делать:

if (language === 'ru') ...

для каждого отдельного текста.

Использовать централизованные translations.

==================================================
8. LANGUAGE PERSISTENCE
==================================================

Выбранный язык должен сохраняться между посещениями /admin.

Использовать localStorage или существующий механизм проекта.

Например:

admin_language = de
admin_language = ru
admin_language = tr

После обновления страницы выбранный язык не должен сбрасываться.

При первом посещении /admin:

определить browser language.

Поддерживаемые:

de → DE
ru → RU
tr → TR

Если browser language не поддерживается:
использовать DE.

Если пользователь уже выбирал язык вручную:
его выбор имеет приоритет.

ВАЖНО:

Это поведение относится ТОЛЬКО К ADMIN.

Не изменять язык публичного сайта.

==================================================
9. PUBLIC WEBSITE MUST REMAIN GERMAN
==================================================

Это обязательное требование.

НЕ добавлять language switcher в public header.

НЕ менять public website localization.

НЕ переводить public website на RU/TR.

Public website:

DE only.

Admin:

DE / RU / TR.

==================================================
10. DASHBOARD
==================================================

Dashboard должен использовать реальные данные backend.

Показывать:

- сегодняшние bookings;
- ближайшие bookings;
- активных сотрудников;
- количество услуг;
- Google Calendar status.

Добавить быстрые действия:

- Neues Booking
- Mitarbeiter hinzufügen
- Service hinzufügen
- Google Calendar verbinden

Все тексты должны быть переведены на DE/RU/TR.

==================================================
11. BOOKINGS
==================================================

Показывать реальные bookings:

- Datum
- Uhrzeit
- Kunde
- Service
- Mitarbeiter
- Status
- Aktionen

Статусы:

PENDING
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW

Добавить:

- фильтр;
- поиск;
- просмотр booking;
- изменение статуса;
- отмену;
- manual booking согласно permissions.

Desktop:
таблица.

Mobile:
cards/list.

Не создавать горизонтальный overflow.

==================================================
12. CALENDAR
==================================================

Показывать реальные bookings.

Поддержать:

- Day;
- Week;
- upcoming bookings.

Использовать Business timezone.

==================================================
13. EMPLOYEES
==================================================

OWNER должен иметь возможность:

- Add employee;
- Edit employee;
- Activate;
- Deactivate;
- Reactivate;
- Delete, если backend это поддерживает;
- assign services;
- assign Google Calendar;
- working hours;
- breaks.

Inactive employee:

- не показывается клиенту;
- не участвует в booking;
- не получает новые bookings.

История старых bookings сохраняется.

==================================================
14. SERVICES
==================================================

OWNER может:

- Add service;
- Edit;
- Activate;
- Deactivate.

Для услуги:

- name;
- description;
- duration;
- price;
- status;
- employees.

==================================================
15. BUSINESS SETTINGS
==================================================

OWNER может изменить:

- Business name;
- address;
- phone;
- email;
- timezone;
- opening hours.

Использовать timezone бизнеса.

Default:

Europe/Vienna

==================================================
16. GOOGLE CALENDAR
==================================================

НЕ ПЕРЕПИСЫВАТЬ существующий Google OAuth.

Использовать уже работающую integration.

Показывать:

- Connected / Not connected;
- Google account;
- available calendars;
- selected calendar;
- connect/disconnect/reconnect, если существующий backend это поддерживает.

Не показывать frontend:

- Client Secret;
- OAuth tokens;
- refresh tokens;
- SESSION_SECRET;
- TOKEN_ENCRYPTION_KEY;
- database credentials.

==================================================
17. SETTINGS
==================================================

Создать/переработать Settings.

Например:

Account
Security
Language
Logout

Language section должен управлять ТОЛЬКО языком ADMIN.

==================================================
18. MOBILE ADMIN
==================================================

Обязательно протестировать:

320px
375px
390px
430px

Header на mobile должен содержать:

Business/logo
Language Switcher
Menu button

Language Switcher всегда виден.

НЕ помещать его только внутрь mobile menu.

Не должно быть horizontal overflow.

Touch targets должны быть удобными.

==================================================
19. RESPONSIVE
==================================================

Проверить:

320px
375px
390px
430px
768px
1024px
1280px
1440px
1920px

Особое внимание:

- header;
- sidebar;
- mobile menu;
- language switcher;
- tables;
- forms;
- modals;
- cards.

==================================================
20. UI STYLE
==================================================

Сохранить существующий premium barbershop style:

- dark theme;
- gold accent;
- clean typography;
- modern cards;
- consistent spacing;
- clear buttons.

Admin должен выглядеть профессионально и функционально.

Не перегружать интерфейс анимациями.

==================================================
21. SECURITY
==================================================

НЕ ослаблять существующую security architecture.

Backend должен проверять:

- authentication;
- authorization;
- OWNER permissions;
- EMPLOYEE permissions.

Frontend role checks используются только для UI.

Не передавать credentials во frontend.

==================================================
22. НЕ ЛОМАТЬ ТЕКУЩУЮ РАБОТУ
==================================================

Перед изменениями проверь существующую рабочую функциональность:

- /api/admin/setup
- authentication
- sessions
- OWNER
- Google OAuth
- Google callback
- Google Calendar
- encrypted credentials
- Supabase/PostgreSQL
- bookings
- availability
- employees
- services

После изменений убедись, что они продолжают работать.

==================================================
23. TESTING
==================================================

Обязательно проверить:

ADMIN:

1. /admin
2. login
3. logout
4. OWNER permissions
5. EMPLOYEE permissions
6. Dashboard
7. Bookings
8. Calendar
9. Employees
10. Services
11. Business Settings
12. Google Calendar
13. Settings

LANGUAGES:

14. DE
15. RU
16. TR
17. language switch
18. language persistence
19. browser language detection

MOBILE:

20. 320px
21. 375px
22. 390px
23. 430px

Особенно:

24. Language Switcher виден в Header
25. Language Switcher виден на mobile
26. Language Switcher показывает текущий язык
27. RU переводит весь Admin UI
28. TR переводит весь Admin UI
29. DE переводит весь Admin UI

PUBLIC WEBSITE:

30. Проверить, что public website остался ТОЛЬКО НА DE.
31. Не добавился public language switcher.
32. Public header не изменён.

==================================================
24. FINAL REPORT
==================================================

После выполнения дай отчёт:

### Admin UI
Что изменено.

### Localization
DE / RU / TR.

### Mobile
Какие размеры проверены.

### Backend
Какие существующие API использованы.

### Google
Работает ли существующая Google integration после изменений.

### Security
Что проверено.

### Testing
Какие тесты реально выполнены.

### Remaining
Что осталось.

Не утверждай, что функция работает, если она фактически не была проверена.

==================================================
ГЛАВНОЕ
==================================================

ПУБЛИЧНЫЙ САЙТ:

DE ONLY.

ADMIN:

DE + RU + TR.

Language Switcher существует ТОЛЬКО В ADMIN.

Language Switcher находится непосредственно в ADMIN HEADER.

Language Switcher всегда виден, включая mobile.

Не ломать существующие Google Calendar, authentication, database и booking functionality.

Сначала:
AUDIT → PLAN → IMPLEMENT → TEST.

Не переписывать проект с нуля.