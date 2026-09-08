# РАЗРАБОТКА WEBSITE + BOOKING SYSTEM

Ты — Senior Full-Stack Developer, UI/UX Developer, SEO Specialist и Web Performance Engineer.

Создай production-ready сайт для локального бизнеса с собственной системой онлайн-бронирования, интегрированной с Google Calendar.

Главный принцип:

> Сначала проанализируй требования и архитектуру, затем создай план, после этого реализуй проект поэтапно, протестируй его и только после успешного тестирования считай работу завершённой.

Не создавай фиктивные API, credentials или интеграции.

Если какая-либо функция технически невозможна без дополнительного доступа, API или настройки аккаунта — прямо укажи это и предложи безопасный вариант.

---

# 1. ИНФОРМАЦИЯ О КЛИЕНТЕ

## CLIENT

всю информацию вытяни из сайта и инстагам
https://bregenzbarbershop.mytreatwell.at/
https://www.instagram.com/bregenz_barbershop/


---

# 2. FRONTEND

Использовать:

* HTML
* Tailwind CSS
* JavaScript

Не использовать Angular для публичного сайта, если он не нужен архитектурно.

Главная страница должна быть максимально лёгкой и быстрой.
весь сайн на немецком языке

Использовать semantic HTML и современный responsive design.

Не добавлять тяжёлые библиотеки без необходимости.

---

# 3. СТРУКТУРА САЙТА

Создать следующие страницы:

## HOME

Главная страница.

Секции:

1. Hero
2. About
3. Services preview
4. Gallery preview
5. Opening hours
6. Contact
7. Google Maps
8. Instagram
9. CTA "Book appointment"

---

## PRICE / SERVICES

Отдельная страница с полным прайсом.

Для каждой услуги:

* название;
* описание;
* продолжительность;
* цена;
* доступные мастера;
* кнопка "Book appointment".

Пример:

Herren Haarschnitt
30 min
25 €

[BOOK NOW]

---

## GALLERY

Страница галереи.

Поддерживать:

* фотографии;
* видео;
* responsive gallery;
* lightbox;
* lazy loading.

Источник контента:

Instagram клиента.

Приоритет:

1. официальный Instagram / Meta API;
2. официальный Instagram embed, если подходит;
3. ручная загрузка/обновление как fallback.

НЕ использовать ненадёжный scraping Instagram.

Если официальный API не позволяет получить необходимые данные или требует специальных разрешений, не пытайся обходить ограничения.

Вместо этого реализуй fallback и объясни, как владелец сможет обновлять галерею.

Если возможно официальным способом получать новые публикации Instagram автоматически, архитектура должна позволять обновлять галерею без изменения frontend.

Instagram icon/profile link должен вести на официальный Instagram клиента.

---

## CONTACT

Показать:

* адрес;
* телефон;
* email;
* opening hours;
* Instagram;
* Google Maps;
* кнопку Book appointment.

Телефон должен использовать:

`tel:`

Email:

`mailto:`

Адрес должен быть связан с Google Maps.

---

# 4. NAVIGATION

Главное меню:

Home
Services / Price
Gallery
Contact
Book appointment

На desktop использовать обычную navigation.

На mobile использовать компактное mobile menu.

Для якорных ссылок на главной странице использовать:

#home
#services
#gallery
#contact
#hours

Если пользователь находится на другой странице, ссылки должны корректно возвращать его на соответствующую секцию Home.

---

# 5. BOOKING BUTTON

Кнопка "Book appointment" должна присутствовать:

* в Header;
* Hero;
* Services;
* каждой услуге;
* Contact;
* Footer;
* при необходимости в Gallery.

Все кнопки должны вести на:

`/booking`

---

# 6. BOOKING PAGE

Создать отдельную максимально лёгкую страницу:

`/booking`

Не перегружать её дизайном.

Основная задача страницы — быстро выбрать:

1. услугу;
2. мастера;
3. дату;
4. свободное время;
5. данные клиента;
6. подтвердить бронирование.

---

# 7. BOOKING FLOW

Шаг 1:

Выбор услуги.

Например:

Herren Haarschnitt
30 min
25 €

Шаг 2:

Выбор мастера.

Список мастеров должен загружаться из backend.

Например:

Alex
David
Michael

Не хардкодить мастеров во frontend.

---

# 8. MASTER ACCOUNT

Создать административную систему.

Первый зарегистрированный владелец бизнеса становится:

`OWNER`

или:

`MASTER`

Он является владельцем бизнеса.

После подключения Google Calendar владелец может управлять сотрудниками.

---

# 9. EMPLOYEE MANAGEMENT

Owner должен иметь возможность:

* добавить сотрудника;
* изменить сотрудника;
* отключить сотрудника;
* повторно активировать сотрудника;
* удалить сотрудника при необходимости;
* назначить ему Google Calendar;
* определить доступные услуги;
* определить его рабочие часы.

Пример:

Business

OWNER
│
├── Alex
├── David
└── Michael

Если сотрудник уволился:

`status = inactive`

Он больше не должен:

* показываться клиентам;
* появляться в booking;
* получать новые бронирования;
* считаться доступным мастером.

Не удалять историю его старых бронирований.

Старые бронирования должны оставаться в базе и Google Calendar.

---

# 10. USER ROLES

Создать минимум следующие роли:

OWNER
EMPLOYEE

При необходимости предусмотреть возможность:

ADMIN

CLIENT

Owner имеет полный доступ к бизнесу.

Employee получает только разрешённые права.

Client не получает доступ к административной панели.

Права должны проверяться backend, а не только frontend.

---

# 11. GOOGLE ACCOUNT CONNECTION

Owner должен иметь возможность подключить Google Account через OAuth 2.0.

Никогда не просить пользователя вводить Google password в собственную форму.

Использовать официальный Google OAuth flow.

После авторизации сохранить необходимые credentials безопасно на backend.

Не хранить:

* client secret;
* refresh token;
* access token;
* private credentials

в frontend JavaScript.

---

# 12. GOOGLE CALENDAR ARCHITECTURE

Google Calendar используется как источник информации о занятости мастеров.

Каждому активному мастеру можно назначить Google Calendar.

Архитектура:

Frontend
↓
Backend API
↓
Google Calendar API
↓
Employee Calendar

Backend должен уметь:

* получать busy/free information;
* проверять доступность;
* создавать события;
* обновлять события;
* отменять события;
* получать существующие события при необходимости.

---

# 13. AVAILABILITY

На странице `/booking` пользователь выбирает:

Date
↓
Employee
↓
Service
↓
Available time

Backend должен запросить Google Calendar free/busy information.

Например:

10:00 — BUSY
10:30 — BUSY
11:00 — AVAILABLE
11:30 — AVAILABLE
12:00 — BUSY

Frontend отображает только доступные интервалы либо визуально показывает занятые.

---

# 14. WORKING HOURS

Не считать всё свободное время календаря доступным автоматически.

Должны учитываться:

* рабочие дни;
* рабочие часы;
* перерывы;
* выходные;
* отпуск;
* отсутствие сотрудника;
* существующие события Google Calendar.

Например:

Employee:

Monday
09:00–18:00

Break:
13:00–14:00

Тогда система не должна предлагать:

13:00–14:00

даже если Google Calendar свободен.

---

# 15. SERVICE DURATION

Каждая услуга должна иметь duration.

Например:

Haircut
30 min

Haircut + Beard
45 min

Child Haircut
20 min

Если услуга длится 45 минут, нельзя предлагать слот, если после него нет полного свободного 45-минутного интервала.

---

# 16. DOUBLE BOOKING PROTECTION

Перед созданием бронирования backend ОБЯЗАТЕЛЬНО должен повторно проверить доступность.

Не доверять availability, которую frontend получил несколько секунд назад.

Flow:

1. User выбирает время.
2. Frontend отправляет booking request.
3. Backend повторно проверяет Google Calendar.
4. Если время занято — вернуть error.
5. Если свободно — создать booking.
6. Создать Google Calendar Event.
7. Сохранить booking information.
8. Вернуть confirmation.

Это необходимо для защиты от одновременного бронирования двумя пользователями.

---

# 17. BOOKING DATABASE

Использовать database для хранения собственной информации о бронированиях.

Минимальная структура:

Business

* id
* name
* timezone
* address
* phone
* email

User

* id
* business_id
* name
* email
* role
* status

Employee

* id
* business_id
* user_id
* name
* status
* google_calendar_id

Service

* id
* business_id
* name
* description
* duration
* price
* status

Booking

* id
* business_id
* employee_id
* service_id
* customer_name
* customer_email
* customer_phone
* start_time
* end_time
* status
* google_event_id
* created_at
* updated_at

GoogleIntegration

* id
* business_id
* google_account_id
* encrypted credentials
* status

Никогда не хранить Google credentials в открытом виде.

---

# 18. MANUAL BOOKING

Owner и Employee должны иметь возможность создавать бронирование вручную из административной панели.

Например:

Client:
Max Mustermann

Service:
Haircut

Employee:
Alex

Date:
09.09.2026

Time:
14:00

Backend должен создать событие в соответствующем Google Calendar.

Таким образом:

MANUAL BOOKING
и
WEBSITE BOOKING

используют один и тот же Google Calendar.

---

# 19. ADMIN DASHBOARD

Создать отдельную административную часть:

`/admin`

Основные разделы:

Dashboard
Bookings
Calendar
Employees
Services
Business settings
Google integration
Settings

---

# 20. DASHBOARD

Показывать:

* сегодняшние бронирования;
* ближайшие бронирования;
* количество активных сотрудников;
* количество услуг;
* статус Google Calendar integration.

---

# 21. BOOKINGS

Owner/Employee должен видеть:

* дату;
* время;
* клиента;
* услугу;
* мастера;
* статус.

Статусы:

PENDING
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW

---

# 22. SECURITY

Backend должен проверять permissions для каждого административного endpoint.

Нельзя полагаться на:

`if user.role === OWNER`

только во frontend.

Frontend controls нужны только для UI.

Настоящая авторизация должна выполняться backend.

Защитить:

* authentication;
* authorization;
* API endpoints;
* OAuth tokens;
* database;
* customer data.

---

# 23. TIMEZONE

Очень важно правильно работать с timezone.

Business должен иметь timezone.

Например:

`Europe/Vienna`

Все booking operations должны корректно учитывать timezone бизнеса.

Не использовать локальное время сервера как единственный источник времени.

---

# 24. FRONTEND PERFORMANCE

Главная страница должна быть максимально быстрой.

Использовать:

* semantic HTML;
* Tailwind CSS;
* минимальный JavaScript;
* lazy loading;
* responsive images;
* WebP/AVIF;
* правильные размеры изображений;
* preload только критических ресурсов;
* оптимизированные fonts;
* lazy loading видео.

Не загружать booking/admin JavaScript на главной странице, если он там не нужен.

---

# 25. VIDEO

Видео в Hero или Gallery:

* poster;
* lazy loading;
* оптимальный формат;
* не блокировать initial render;
* учитывать mobile;
* учитывать `prefers-reduced-motion`.

Не загружать большие видео сразу при открытии сайта.

---

# 26. SEO

Для публичного сайта реализовать:

* unique title;
* meta description;
* canonical;
* Open Graph;
* semantic HTML;
* H1/H2/H3;
* alt text;
* internal links;
* robots.txt;
* sitemap.xml;
* JSON-LD structured data.

Для локального бизнеса использовать подходящий:

`LocalBusiness`

schema.

Если тип бизнеса позволяет использовать более конкретный schema type — использовать его.

Адрес, телефон и название должны быть одинаковыми на сайте и в Google Business Profile.

---

# 27. ACCESSIBILITY

Проверить:

* keyboard navigation;
* focus;
* contrast;
* labels;
* buttons;
* links;
* alt;
* semantic HTML;
* mobile touch targets;
* reduced motion.

---

# 28. RESPONSIVE

Обязательно проверить:

320px
375px
390px
430px
768px
1024px
1280px
1440px
1920px

Не должно быть случайного horizontal overflow.

---

# 29. BROWSER TESTING

Проверить:

Chrome
Safari
Firefox
Edge

Особое внимание:

iPhone Safari
Android Chrome

---

# 30. TESTING BOOKING

Проверить:

1. Выбор услуги.
2. Выбор мастера.
3. Выбор даты.
4. Получение availability.
5. Выбор времени.
6. Заполнение клиента.
7. Создание booking.
8. Создание Google Calendar event.
9. Повторная проверка занятости.
10. Отмена booking.
11. Manual booking.
12. Employee booking.
13. Owner booking.
14. Deactivated employee.
15. Overlapping booking.
16. Outside working hours.
17. Break.
18. Day off.
19. Different service durations.
20. Timezone.

---

# 31. EMPLOYEE TESTING

Проверить:

Employee active:

→ показывается клиенту.

Employee inactive:

→ не показывается клиенту.

Employee inactive:

→ нельзя создать новое booking.

Старые bookings:

→ остаются доступны владельцу.

---

# 32. GOOGLE CALENDAR TESTING

Проверить:

* OAuth;
* calendar connection;
* free/busy;
* event creation;
* event update;
* event cancellation;
* multiple employees;
* multiple calendars;
* expired access token;
* token refresh;
* revoked access;
* unavailable calendar.

Если Google API недоступен:

не создавать booking как будто он успешно создан.

Показывать понятную ошибку.

---

# 33. INSTAGRAM

Использовать только официальные способы получения Instagram content.

Приоритет:

1. Official Meta/Instagram API.
2. Official embed.
3. Manual gallery fallback.

Не использовать scraping, обход ограничений или неофициальные API для production.

Если автоматическая синхронизация поддерживается:

Backend периодически получает новые posts/reels.

Frontend получает gallery data от backend.

Пример:

Instagram
↓
Official API
↓
Backend
↓
Database/cache
↓
Website Gallery

Не запрашивать Instagram API напрямую из frontend, если credentials должны оставаться секретными.

---

# 34. INSTAGRAM CACHE

Если используется Instagram API:

не делать запрос к Instagram при каждом открытии страницы пользователем.

Использовать backend cache.

Например:

Instagram API
↓
Backend
↓
Cache
↓
Website

Обновлять cache периодически.

---

# 35. ERROR HANDLING

Для всех API:

* loading state;
* success state;
* error state;
* empty state.

Ошибки должны быть понятны пользователю.

Не показывать stack traces или внутреннюю информацию backend.

---

# 36. PRODUCTION SECURITY

Проверить:

* secrets;
* `.env`;
* OAuth credentials;
* database credentials;
* API keys;
* CORS;
* authentication;
* authorization;
* rate limiting;
* input validation;
* SQL injection;
* XSS;
* CSRF там, где применимо.

Никакие credentials не должны попасть в Git.

---

# 37. PRODUCTION BUILD

Проверить:

* frontend build;
* backend build;
* database connection;
* environment variables;
* migrations;
* API endpoints;
* routing;
* HTTPS.

---

# 38. DEPLOYMENT

Frontend и backend могут размещаться отдельно.

Например:

Frontend:

`Vercel / static hosting`

Backend:

`Vercel Functions / Node.js server / VPS`

Database:

`PostgreSQL`

Выбери конкретную инфраструктуру только после анализа требований проекта.

Не добавляй инфраструктуру, которая не нужна.

---

# 39. FINAL PERFORMANCE AUDIT

После deployment протестировать production URL.

Проверить:

* Lighthouse;
* PageSpeed Insights;
* Core Web Vitals;
* LCP;
* INP;
* CLS;
* total page size;
* JavaScript;
* CSS;
* images;
* fonts.

После исправлений повторить тест.

---

# 40. FINAL SEO AUDIT

Проверить:

* title;
* description;
* H1;
* headings;
* canonical;
* Open Graph;
* JSON-LD;
* sitemap;
* robots;
* internal links;
* broken links;
* image alt;
* indexability.

---

# 41. FINAL CHECKLIST

## Website

[ ] Home
[ ] Services
[ ] Gallery
[ ] Contact
[ ] Booking
[ ] Responsive
[ ] Mobile menu
[ ] Navigation
[ ] CTA

## Business information

[ ] Address
[ ] Phone
[ ] Email
[ ] Opening hours
[ ] Google Maps
[ ] Instagram

## Booking

[ ] Services
[ ] Employees
[ ] Calendar
[ ] Availability
[ ] Working hours
[ ] Breaks
[ ] Booking creation
[ ] Manual booking
[ ] Cancellation
[ ] Double booking protection
[ ] Timezone

## Admin

[ ] Owner
[ ] Employees
[ ] Roles
[ ] Permissions
[ ] Employee activation/deactivation
[ ] Services
[ ] Bookings
[ ] Google integration

## Google

[ ] OAuth
[ ] Calendar connection
[ ] Free/busy
[ ] Event creation
[ ] Event update
[ ] Event cancellation
[ ] Token refresh
[ ] Error handling

## Instagram

[ ] Official integration investigated
[ ] Gallery
[ ] Video
[ ] New posts synchronization if supported
[ ] Fallback implemented if API unavailable

## SEO

[ ] Titles
[ ] Meta descriptions
[ ] Canonical
[ ] Open Graph
[ ] Structured data
[ ] Sitemap
[ ] Robots
[ ] Alt text

## Performance

[ ] Images optimized
[ ] Video optimized
[ ] Lazy loading
[ ] JavaScript minimized
[ ] CSS optimized
[ ] Fonts optimized
[ ] Core Web Vitals checked

## Security

[ ] Secrets protected
[ ] OAuth tokens protected
[ ] Authentication
[ ] Authorization
[ ] Input validation
[ ] CORS
[ ] Rate limiting
[ ] No credentials in Git

## Deployment

[ ] Production build
[ ] Frontend deployed
[ ] Backend deployed
[ ] Database deployed
[ ] Domain connected
[ ] HTTPS
[ ] Environment variables
[ ] Production testing

---

# 42. FINAL REPORT

После завершения предоставить:

## Completed

Что реализовано.

## Architecture

Как устроены:

Frontend
Backend
Database
Google Calendar
Instagram

## SEO

Что сделано.

## Performance

Какие оптимизации выполнены.

## Security

Что защищено.

## Testing

Что протестировано.

## Deployment

Где опубликовано.

## Remaining

Что осталось сделать.

## Client Configuration Required

Что должен предоставить или настроить клиент:

* Google account;
* Google Calendar;
* Instagram;
* business information;
* employees;
* services;
* prices;
* working hours;
* domain;
* другие необходимые credentials/configuration.

Никогда не утверждай, что интеграция или функция работает, если она фактически не была проверена.
Сайт в первую очередь будет загружен на vercel.com подготовить файлы для него.
В докере на компьютере запушен postgres на порте 5433 используй его для тестов бэкэнда.
Сздай и настрой файл gitignore
