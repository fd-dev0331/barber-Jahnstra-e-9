Проведи полный аудит безопасности базы данных и исправь проблему с Row Level Security (RLS) в этом проекте.

ВАЖНО:
Это существующий production-проект.

Главный приоритет:
1. SECURITY
2. Сохранение всей существующей функциональности
3. Минимальные изменения в коде
4. Воспроизводимая migration
5. Никакого переписывания проекта без необходимости

НЕ удаляй существующие таблицы, данные, API, функции, endpoints или UI.

НЕ меняй бизнес-логику без необходимости.

НЕ создавай новую архитектуру авторизации, если в проекте уже существует рабочая.

НЕ отключай существующие функции.

==================================================
1. КОНТЕКСТ ПРОЕКТА
==================================================

Проект использует PostgreSQL/Supabase.

Supabase Security Advisor обнаружил критическую проблему:

"Table publicly accessible — Anyone with your project URL can read, edit, and delete all data in this table because Row Level Security is not enabled."

В Supabase Table Editor несколько таблиц находятся в состоянии:

"UNRESTRICTED"
"RLS disabled"

В проекте есть:

- публичный сайт
- Admin Panel
- Telegram Mini App, связанная с административной/booking функциональностью
- backend
- PostgreSQL
- Google Calendar integration
- booking system
- media/gallery
- authentication/session system

ВАЖНО:

Telegram Mini App — это часть ЭТОГО ЖЕ проекта.

Не считай Telegram отдельным проектом.

Не удаляй и не отключай существующий Telegram Mini App.

==================================================
2. СНАЧАЛА ИЗУЧИ ВЕСЬ ПРОЕКТ
==================================================

До внесения любых изменений полностью проанализируй:

- db/schema.sql
- все SQL migrations
- lib/db.js
- lib/auth.js
- lib/*
- api/*
- public/*
- frontend JS
- Admin Panel
- Telegram Mini App
- scripts/*
- package.json
- README.md
- info.md
- все конфигурационные файлы
- все места, где используется PostgreSQL
- все места, где используется Supabase
- все места, где используются environment variables

Проведи поиск всех SQL-запросов и обращений к таблицам.

Особенно:

- absence
- app_session
- app_user
- booking
- business
- closure_day
- employee
- employee_service
- gallery_item
- google_integration
- media
- review
- service
- telegram_account
- working_hours

Также найди:

- views
- functions
- triggers
- sequences
- foreign keys
- SECURITY DEFINER functions
- API endpoints
- middleware
- authentication checks

НЕ делай предположений о доступе.

Определи реальный access flow на основании кода.

==================================================
3. ОПРЕДЕЛИ РЕАЛЬНУЮ АРХИТЕКТУРУ DATABASE ACCESS
==================================================

В проекте backend может использовать PostgreSQL напрямую через pg.

Проверь:

- DATABASE_URL
- POSTGRES_URL
- POSTGRES_URL_NON_POOLING

Определи:

1. Какая PostgreSQL role используется production backend.
2. Как эта role получает доступ к БД.
3. Имеет ли она BYPASSRLS.
4. Используется ли Supabase Data API.
5. Используется ли @supabase/supabase-js.
6. Используется ли REST API Supabase.
7. Используется ли anon/publishable key.
8. Используется ли service_role/secret key.
9. Есть ли прямой frontend → Supabase доступ.
10. Какие запросы идут только через backend.

НЕ предполагай, что backend использует service_role.

Проверь фактически.

Если проект использует прямой PostgreSQL connection через backend, учитывай это при проектировании RLS.

==================================================
4. ПОЛНОСТЬЮ ПРОВЕРЬ TELEGRAM MINI APP
==================================================

В этом проекте существует Telegram Mini App.

Найди и проанализируй весь связанный код:

- Telegram WebApp initialization
- initData
- initDataUnsafe
- Telegram user ID
- Telegram authentication
- telegram_account
- Mini App frontend
- Mini App API calls
- backend endpoints
- authorization
- admin permissions
- booking operations

Найди весь код, связанный с:

- telegram
- WebApp
- initData
- initDataUnsafe
- telegram_account
- Telegram user ID
- bot token

Определи точный flow:

Telegram Mini App
        ↓
frontend
        ↓
API/backend
        ↓
authorization
        ↓
PostgreSQL

НЕ допускай:

Telegram Mini App
        ↓
anon/public Data API
        ↓
прямой полный доступ к PostgreSQL

если такой доступ не является действительно необходимым.

Проверь, что Mini App НЕ получает:

- DATABASE_URL
- POSTGRES_URL
- POSTGRES_URL_NON_POOLING
- service_role
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_SECRET_KEY
- другие database credentials

Эти данные никогда не должны попадать:

- в browser JavaScript
- в public/
- в HTML
- в frontend bundle
- в API response

==================================================
5. TELEGRAM AUTHENTICATION
==================================================

Найди существующую реализацию проверки Telegram WebApp authentication.

Проверь:

- проверяется ли подпись Telegram initData
- проверяется ли auth_date
- проверяется ли актуальность auth data
- определяется ли Telegram user ID
- проверяется ли telegram_account
- проверяется ли admin permission
- проверяется ли ownership/permission перед изменением данных

НЕ заменяй существующий Telegram authentication новым механизмом без необходимости.

НЕ переноси Telegram authentication в Supabase Auth.

Если текущая реализация небезопасна:

1. Зафиксируй это как Security Finding.
2. Предложи минимальное исправление.
3. Внеси исправление только если оно необходимо для безопасности.
4. Не ломай существующую Mini App.

ВАЖНО:

RLS НЕ должен быть единственным уровнем авторизации Telegram Mini App.

Backend должен продолжать проверять:

"имеет ли этот Telegram user право выполнять данную операцию?"

==================================================
6. ПРОАНАЛИЗИРУЙ КАЖДУЮ ТАБЛИЦУ
==================================================

Для каждой таблицы определи:

- кто может SELECT
- кто может INSERT
- кто может UPDATE
- кто может DELETE

Для каждой таблицы определить:

- нужна ли RLS
- какие PostgreSQL roles имеют доступ
- какие grants нужны
- какие policies нужны
- какие операции должны быть запрещены

Сделай это на основании реального кода проекта.

Не используй один общий шаблон для всех таблиц.

==================================================
7. ПРЕДВАРИТЕЛЬНАЯ МОДЕЛЬ ДОСТУПА
==================================================

Используй следующую модель только как отправную точку.

Если реальный код показывает другую необходимость — следуй реальному коду и объясни отличие.

------------------------------------------
PUBLIC DATA
------------------------------------------

business

Публичный сайт может читать только необходимые публичные поля.

Изменение:
только backend/admin.

------------------------------------------

employee

Публичный сайт может читать только необходимые публичные данные.

Изменение:
только backend/admin.

------------------------------------------

employee_service

Публичное чтение только если реально используется сайтом.

Изменение:
только backend/admin.

------------------------------------------

service

Публичное чтение активных услуг.

Изменение:
только backend/admin.

------------------------------------------

working_hours

Публичное чтение необходимых рабочих часов.

Изменение:
только backend/admin.

------------------------------------------

closure_day

Публичное чтение необходимых данных.

Изменение:
только backend/admin.

------------------------------------------

gallery_item

Публичное чтение.

Изменение:
только backend/admin.

------------------------------------------

review

Публичное чтение только тех данных, которые реально предназначены для сайта.

Изменение:
только backend/admin.

------------------------------------------
8. BOOKING
------------------------------------------

booking является чувствительной таблицей.

Публичный посетитель может создать booking ТОЛЬКО через существующий разрешённый flow.

Публичный пользователь НЕ должен иметь возможность:

- SELECT всех booking
- SELECT чужих booking
- UPDATE произвольных booking
- DELETE произвольных booking

Admin должен иметь необходимые права.

Telegram Mini App должна иметь только те права, которые реально нужны существующему flow.

Проверь отдельно:

- создание booking
- просмотр booking
- изменение booking
- отмена booking
- удаление booking

Не разрешай полный CRUD anon.

==================================================
9. ЧУВСТВИТЕЛЬНЫЕ ТАБЛИЦЫ
==================================================

Следующие таблицы должны рассматриваться как sensitive:

app_user
app_session
google_integration
telegram_account
absence

Проверь фактическое использование каждой.

------------------------------------------
app_user
------------------------------------------

Не должна быть публично доступна.

Особенно:

- password_hash
- email/login
- session-related data
- admin information

anon не должен читать эту таблицу.

------------------------------------------
app_session
------------------------------------------

Не должна быть публично доступна.

Защитить:

- token_hash
- csrf_token
- session information

------------------------------------------
google_integration
------------------------------------------

Не должна быть публично доступна.

Защитить:

- OAuth credentials
- encrypted tokens
- refresh tokens
- Google integration data

------------------------------------------
telegram_account
------------------------------------------

Не должна быть публично доступна.

Защитить:

- Telegram user ID
- account linkage
- authorization information
- admin relationship

------------------------------------------
absence
------------------------------------------

Не должна быть публично доступна.

Используется административной частью.

==================================================
10. MEDIA
==================================================

Отдельно проверь таблицу:

media

Определи:

- как изображения загружаются
- как изображения читаются
- используется ли frontend напрямую
- используется ли API endpoint
- используется ли bytea
- может ли backend отдавать изображения

Если изображения выдаются через backend/API:

не делай всю таблицу media публично доступной через Data API только ради отображения изображений.

Проверь реальный access path.

==================================================
11. GRANTS + RLS
==================================================

ОЧЕНЬ ВАЖНО:

Не ограничивайся:

ALTER TABLE ... ENABLE ROW LEVEL SECURITY;

Проверь также PostgreSQL GRANT.

Supabase использует два уровня:

1. GRANT
2. RLS policies

Policy сама по себе не отзывает существующие grants.

Поэтому проверь:

- anon
- authenticated
- service_role
- другие роли

Для каждой таблицы оставь только минимально необходимые права.

Не предоставляй anon полный CRUD.

Не используй широкие:

USING (true)

для sensitive tables.

Если public SELECT действительно необходим:

разреши его только для соответствующей таблицы и только для нужной операции.

==================================================
12. НЕ СЛОМАЙ BACKEND
==================================================

Если backend использует PostgreSQL напрямую и его role имеет необходимые права:

не создавай бессмысленные policies, которые backend не должен использовать.

Но обязательно проверь фактически:

- role
- grants
- bypassrls
- database permissions

Если backend использует роль без BYPASSRLS, разработай корректную модель RLS.

==================================================
13. SECRET SECURITY
==================================================

Проверь, что следующие значения НИКОГДА не попадают во frontend:

- DATABASE_URL
- POSTGRES_URL
- POSTGRES_URL_NON_POOLING
- SESSION_SECRET
- TOKEN_ENCRYPTION_KEY
- Google OAuth secrets
- Telegram bot token
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_SECRET_KEY
- любые database credentials

Проверь:

- public/
- browser JS
- API responses
- build output
- source maps
- environment configuration

НЕ меняй существующие secrets без необходимости.

Если обнаружишь потенциальную утечку:

отдельно укажи это в Security Findings.

==================================================
14. RLS MIGRATION
==================================================

Не выполняй случайные ручные изменения только через Dashboard.

Создай воспроизводимую SQL migration.

Используй существующую migration system проекта, если она есть.

Например:

db/migrations/xxxx_secure_rls.sql

или существующий формат проекта.

Migration должна:

- быть максимально идемпотентной
- не удалять данные
- не удалять таблицы
- не ломать существующие foreign keys
- не ломать application logic
- включать RLS
- устанавливать необходимые grants
- создавать необходимые policies
- при необходимости отзывать лишние grants

Не делай DROP TABLE.

Не удаляй существующие данные.

==================================================
15. RLS POLICIES
==================================================

Для каждой policy обязательно укажи:

- table
- operation
- role
- USING
- WITH CHECK

Особенно внимательно проверь:

SELECT
INSERT
UPDATE
DELETE

Для UPDATE учитывай, что PostgreSQL должен корректно проверять доступ к существующей строке и новую строку.

Не создавай policy только ради того, чтобы "ошибка исчезла".

Policy должна отражать реальный access model приложения.

==================================================
16. VIEWS И FUNCTIONS
==================================================

Проверь все:

- views
- functions
- SECURITY DEFINER
- triggers

Supabase предупреждает, что views могут обходить RLS в зависимости от того, как они созданы.

Проверь, нет ли view, которая раскрывает данные защищённой таблицы.

Проверь SECURITY DEFINER functions.

Не создавай SECURITY DEFINER без необходимости.

Если SECURITY DEFINER нужен:

- используй минимальные права
- задай безопасный search_path
- ограничь EXECUTE
- проверь возможность обхода авторизации

==================================================
17. TESTS
==================================================

После изменений создай/обнови database security tests.

Если проект использует Supabase CLI:

используй совместимую с проектом систему тестирования.

Проверь минимум:

PUBLIC / ANON:

- SELECT public data → разрешён там, где необходимо
- SELECT app_user → запрещён
- SELECT app_session → запрещён
- SELECT google_integration → запрещён
- SELECT telegram_account → запрещён
- SELECT absence → запрещён
- SELECT arbitrary booking → запрещён
- UPDATE arbitrary booking → запрещён
- DELETE arbitrary booking → запрещён

BOOKING:

- разрешён только необходимый public booking flow
- нельзя читать все booking
- нельзя изменять чужие booking
- нельзя удалять чужие booking

ADMIN:

- login работает
- session работает
- bookings работают
- employees работают
- employee services работают
- services работают
- working hours работают
- closure days работают
- absences работают
- gallery работает
- media работает
- Google Calendar integration работает

TELEGRAM MINI APP:

- Mini App открывается
- Telegram authentication работает
- Telegram user определяется корректно
- разрешённые операции работают
- запрещённые операции блокируются
- нельзя получить чужие данные
- нельзя получить app_user
- нельзя получить app_session
- нельзя получить google_integration
- нельзя получить telegram_account напрямую
- нельзя обойти backend authorization

PUBLIC WEBSITE:

- услуги загружаются
- сотрудники загружаются
- расписание загружается
- галерея загружается
- reviews загружаются
- booking работает

==================================================
18. SECURITY ADVISOR
==================================================

После создания migration проверь результат с точки зрения Supabase Security Advisor.

Цель:

убрать проблему:

"Table publicly accessible"

для действительно защищаемых таблиц.

Но НЕ делай таблицы публичными только для того, чтобы Security Advisor перестал показывать предупреждение.

Security Advisor должен быть исправлен за счёт правильного access control.

==================================================
19. НЕ ВНОСИ ИЗМЕНЕНИЯ В SUPABASE DASHBOARD ВСЛЕПУЮ
==================================================

Не проси меня вручную нажимать:

"Enable RLS"

на отдельных таблицах до того, как ты определишь policies.

Сначала подготовь migration.

После этого сообщи:

- какие таблицы будут переведены на RLS
- какие policies будут созданы
- какие grants изменятся
- какие риски есть
- какие тесты пройдены

==================================================
20. ФИНАЛЬНЫЙ SECURITY REPORT
==================================================

После завершения дай подробный, но понятный отчёт.

Создай раздел:

SECURITY AUDIT RESULT

И покажи таблицу:

Table | RLS | anon SELECT | anon INSERT | anon UPDATE | anon DELETE | Backend/Admin | Notes

Отдельно:

SECURITY FINDINGS

Для каждой проблемы:

- Severity
- Problem
- Evidence
- Fix
- File
- Status

Отдельно:

TELEGRAM MINI APP SECURITY

Покажи:

- authentication flow
- initData validation
- Telegram user identification
- authorization
- endpoints
- database tables
- allowed operations
- blocked operations
- возможный прямой доступ к Data API
- secrets exposure
- исправленные проблемы

Отдельно:

DATABASE SECURITY

Покажи:

- PostgreSQL role backend
- BYPASSRLS
- grants
- RLS
- policies
- sensitive tables
- public tables

Отдельно:

FILES CHANGED

Покажи каждый изменённый файл.

Отдельно:

MIGRATION

Покажи имя migration и кратко что она делает.

Отдельно:

TEST RESULTS

Покажи, что реально было протестировано.

Отдельно:

REMAINING RISKS

Если что-то невозможно проверить без production credentials или Supabase Dashboard — прямо напиши это.

Не говори "всё безопасно", если что-то не было проверено.

==================================================
21. КРИТИЧЕСКОЕ ТРЕБОВАНИЕ
==================================================

НЕ СЧИТАЙ ЗАДАЧУ ЗАВЕРШЁННОЙ только потому, что:

- RLS включён
- Security Advisor warning исчез
- migration успешно выполнилась

Задача считается завершённой только после проверки трёх основных клиентов:

1. Public Website
2. Admin Panel
3. Telegram Mini App

И проверки:

Database
+
Backend authorization
+
RLS
+
GRANTS
+
Secrets

должны соответствовать реальному access flow проекта.

Главная цель:

ЗАЩИТИТЬ DATABASE ОТ ПУБЛИЧНОГО ДОСТУПА,

НО НЕ СЛОМАТЬ:

- сайт
- booking
- admin panel
- Google Calendar
- media/gallery
- authentication
- Telegram Mini App
- существующий backend.

Сначала проанализируй.

Затем предложи план.

Затем внеси изменения.

Затем создай migration.

Затем протестируй.

И только после этого дай финальный отчёт.