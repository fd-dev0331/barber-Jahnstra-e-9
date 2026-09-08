# BACKEND AUDIT AND RECOVERY — DO NOT REBUILD THE PROJECT

Текущий проект уже существует. Не переписывай его с нуля и не начинай новый проект.

Твоя задача сейчас — провести полный аудит существующего backend/admin/Google Calendar функционала, определить, что реально реализовано, что реализовано частично, а чего нет, после чего довести систему до рабочего состояния.

## КРИТИЧЕСКИ ВАЖНО

Не считай задачу выполненной только потому, что:

* Vercel deploy проходит;
* PostgreSQL подключается;
* `/admin` существует;
* frontend выглядит правильно;
* API отвечает HTTP 200 в простом тесте.

Функция считается реализованной только после проверки полного пользовательского сценария.

---

# 1. СНАЧАЛА АУДИТ

Перед изменением кода:

1. Проанализируй текущую структуру проекта.
2. Найди frontend.
3. Найди backend/serverless functions.
4. Найди database layer.
5. Найди schema/migrations.
6. Найди authentication.
7. Найди admin.
8. Найди Google OAuth.
9. Найди Google Calendar integration.
10. Найди employee management.
11. Найди booking API.
12. Найди environment configuration.

Не делай предположений.

Для каждого пункта укажи:

* EXISTS
* PARTIALLY IMPLEMENTED
* MISSING
* BROKEN

После аудита составь короткий список проблем и только потом начинай исправления.

---

# 2. ЛОКАЛЬНАЯ БАЗА ДАННЫХ

Для локального тестирования использовать PostgreSQL, который уже запущен в Docker:

localhost:5433

Не использовать Supabase для локальной разработки.

Сначала система должна полностью работать локально.

Проверить:

* database connection;
* migrations;
* schema;
* constraints;
* indexes;
* seed;
* transactions.

---

# 3. ENVIRONMENT VARIABLES

Runtime должен поддерживать:

DATABASE_URL

с fallback:

POSTGRES_URL

То есть:

DATABASE_URL имеет приоритет.

Если DATABASE_URL отсутствует, использовать POSTGRES_URL.

Для migrations использовать:

POSTGRES_URL_NON_POOLING

если она существует.

Не ломать существующий локальный `.env`.

Не коммитить `.env`.

Проверить `.gitignore`.

---

# 4. MASTER / OWNER ACCOUNT

Это КРИТИЧЕСКАЯ функция.

При первом входе в `/admin` backend должен определить, существует ли активный OWNER.

Если OWNER ещё нет:

показать setup flow для создания первого владельца бизнеса.

Первый пользователь должен стать:

role = OWNER

status = ACTIVE

Он должен быть связан с Business.

Не разрешать второму пользователю автоматически становиться OWNER.

Проверка должна выполняться backend.

Frontend не должен самостоятельно решать, кто OWNER.

---

# 5. INITIAL SETUP FLOW

Первый запуск должен работать так:

/admin

↓

No OWNER exists

↓

Create Business / Master Account

Поля:

* business name
* owner name
* email
* password

↓

создание:

Business

User

OWNER relation

↓

создание session

↓

Dashboard / Google setup

---

# 6. AUTHENTICATION

Проверить и при необходимости реализовать:

* login;
* logout;
* session;
* password hashing;
* protected admin routes;
* protected API endpoints;
* session expiration;
* invalid session handling.

Не хранить password в открытом виде.

Не доверять role, переданной frontend.

Backend должен получать пользователя из валидной session и только после этого проверять permissions.

---

# 7. GOOGLE OAUTH 2.0

Owner должен иметь кнопку:

Connect Google Account

Использовать настоящий Google OAuth 2.0.

Не создавать fake OAuth.

Не просить Google password.

OAuth flow:

/api/auth/google

↓

Google

↓

/api/auth/google/callback

↓

exchange authorization code

↓

получение access token / refresh token

↓

зашифрованное хранение refresh token на backend

↓

Google account connected

Не помещать client secret, refresh token или access token во frontend.

---

# 8. GOOGLE INTEGRATION

После подключения Google Owner должен иметь возможность получить список доступных Google Calendars.

Пример:

Main Calendar
Business
Alex
David

Owner выбирает календарь.

Сохранить:

google_calendar_id

в соответствующем Employee или Google integration record согласно существующей архитектуре.

---

# 9. РЕКОМЕНДУЕМАЯ АРХИТЕКТУРА

Для этого проекта предпочтительно:

один Google Account бизнеса

↓

несколько Google Calendars

↓

каждый Employee связан со своим calendar.

Не реализовывать отдельный OAuth для каждого Employee без необходимости.

Если существующая архитектура уже предусматривает другой подход, сначала объясни его и не ломай существующие данные без необходимости.

---

# 10. EMPLOYEE MANAGEMENT

Owner должен иметь возможность:

* add employee;
* edit employee;
* deactivate employee;
* reactivate employee;
* delete employee, если это безопасно;
* assign services;
* assign working hours;
* assign Google Calendar.

При увольнении:

status = inactive

Не удалять исторические bookings.

Inactive employee:

* не показывается клиенту;
* не доступен для новых bookings;
* не получает новые bookings.

Исторические bookings сохраняются.

Backend обязательно проверяет это правило.

---

# 11. ROLES

Минимум:

OWNER
EMPLOYEE
CLIENT

При необходимости:

ADMIN

Permissions должны проверяться backend.

Нельзя защищать backend только таким кодом frontend:

if user.role === OWNER

Frontend role checks используются только для отображения UI.

---

# 12. BOOKING

Проверить полный flow:

Service
→ Employee
→ Date
→ Availability
→ Time
→ Customer data
→ Booking
→ Google Calendar Event
→ Confirmation

Перед созданием booking backend ОБЯЗАТЕЛЬНО повторно проверяет availability.

Нельзя доверять availability, которую frontend получил ранее.

Если Google Calendar показывает занятость:

booking не создаётся.

Если Google API недоступен:

не создавать booking как успешный.

---

# 13. WORKING HOURS

Availability должна учитывать:

* working days;
* working hours;
* breaks;
* days off;
* vacation;
* inactive employee;
* Google Calendar busy events;
* service duration;
* timezone.

Business timezone:

Europe/Vienna

если это соответствует настройке бизнеса.

Не использовать timezone сервера как единственный источник времени.

---

# 14. DATABASE

Проверить наличие и корректность:

businesses
users
employees
services
bookings
google_integrations

Проверить foreign keys.

Проверить status fields.

Проверить timestamps.

Проверить индексы.

Проверить защиту от конфликтующих bookings.

Не удалять исторические данные employee.

---

# 15. ADMIN PAGES

Проверить:

/admin
/admin/bookings
/admin/calendar
/admin/employees
/admin/services
/admin/settings
/admin/google

Если каких-либо страниц нет — реализовать.

---

# 16. ERROR HANDLING

Каждый API должен иметь:

* validation;
* authentication check;
* authorization check;
* database error handling;
* Google API error handling;
* meaningful HTTP status;
* safe error message.

Никогда не возвращать пользователю:

* stack trace;
* database credentials;
* OAuth secrets;
* internal paths.

---

# 17. SECURITY

Проверить:

* password hashing;
* session security;
* authorization;
* input validation;
* SQL injection;
* XSS;
* CSRF where applicable;
* CORS;
* rate limiting;
* OAuth token encryption;
* secrets;
* `.env`;
* Git history.

Никакие credentials не должны попадать в Git.

---

# 18. TESTING

Сначала локально.

PostgreSQL:

localhost:5433

Проверить реальный сценарий:

1. чистая база;
2. открыть `/admin`;
3. создать Master/Owner;
4. войти;
5. открыть Google integration;
6. пройти Google OAuth;
7. получить calendars;
8. выбрать calendar;
9. создать employee;
10. назначить employee calendar;
11. создать service;
12. настроить working hours;
13. открыть public `/booking`;
14. выбрать service;
15. выбрать employee;
16. выбрать date;
17. получить availability;
18. создать booking;
19. проверить Google Calendar event;
20. проверить booking в database;
21. попробовать создать overlapping booking;
22. убедиться, что второй booking отклоняется;
23. deactivate employee;
24. убедиться, что employee исчез из public booking;
25. убедиться, что старые bookings остались.

---

# 19. VERCEL

Только после успешного локального тестирования подготовить production deployment.

Vercel environment variables должны быть разделены:

Production
Preview
Development

Не предполагать, что переменные автоматически существуют во всех окружениях.

После изменения environment variables выполнить новый deployment.

---

# 20. SUPABASE / POSTGRES

Если используется Vercel Supabase integration:

runtime:

POSTGRES_URL

или DATABASE_URL, если он задан вручную.

migration:

POSTGRES_URL_NON_POOLING

Не использовать pooled connection для DDL, если это несовместимо с конкретной конфигурацией.

---

# 21. НЕ ИСПОЛЬЗОВАТЬ FAKE DATA ДЛЯ ИМИТАЦИИ ИНТЕГРАЦИИ

Не создавать fake:

* Google OAuth;
* Google Calendar;
* access token;
* refresh token;
* API credentials;
* calendar events.

Если для локального тестирования невозможно выполнить реальный Google OAuth без credentials:

реализуй integration полностью и явно укажи, какую настройку должен выполнить владелец проекта.

---

# 22. ВАЖНО: НЕ ОСТАНАВЛИВАЙСЯ НА DATABASE CONNECTION

Исправление:

DATABASE_URL
→ POSTGRES_URL

не является завершением задачи.

Это только устранение одной инфраструктурной проблемы.

После исправления database connection продолжить аудит и тестирование:

OWNER
→ AUTH
→ GOOGLE OAUTH
→ CALENDAR
→ EMPLOYEE
→ BOOKING.

---

# 23. FINAL REPORT

После работы предоставить:

## Existing

Что уже было реализовано.

## Fixed

Что исправлено.

## Missing

Что отсутствовало.

## Architecture

Frontend
Backend
Database
Authentication
Google OAuth
Google Calendar

## Local testing

Какие реальные сценарии проверены через PostgreSQL localhost:5433.

## Production configuration

Какие environment variables нужны Vercel.

## Google configuration

Что нужно создать/настроить в Google Cloud.

## Remaining

Что осталось сделать владельцу проекта.

Не утверждать, что Google OAuth или Calendar работают, если реальный OAuth flow не был проверен.

Не считать deployment успешным доказательством работоспособности backend.
