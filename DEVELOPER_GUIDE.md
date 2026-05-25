# Инструкция разработчика VIP Orders Dashboard

Этот документ нужен, чтобы новый разработчик мог без устной передачи понять, как устроено приложение, как запускать его локально, как деплоить на Vercel, как обновлять код и как безопасно работать с GitHub.

## 1. Что это за приложение

`VIP Orders Dashboard` - Flask-приложение для просмотра смарт-процесса Bitrix24 `Реестр VIP-заказов`.

Приложение:

- забирает записи из Bitrix24 REST API;
- показывает директорскую таблицу заказов;
- открывает красивую карточку заказа;
- показывает комментарий, этапы и даты этапов;
- показывает недавно завершенные заказы еще 7 дней;
- делает Excel-сводку по незавершенным заказам;
- умеет работать как PWA на телефоне;
- деплоится на Vercel как Python/Flask Function.

## 2. Основные файлы проекта

- `app.py` - весь backend: Flask, Bitrix API, сбор payload, фильтрация стадий, форматирование значений.
- `templates/index.html` - основной HTML-шаблон.
- `public/assets/app.js` - frontend: загрузка заказов, фильтры, карточка заказа, Excel-экспорт.
- `public/assets/app.css` - стили приложения.
- `public/sw.js` - service worker для PWA.
- `public/manifest.webmanifest` - PWA-манифест.
- `requirements.txt` - Python-зависимости для локального запуска и Vercel.
- `.env.example` - пример переменных окружения. Настоящий `.env` нельзя коммитить.
- `.gitignore` и `.vercelignore` - исключения для Git и Vercel.

## 3. Доступы, которые нужны разработчику

Нужны:

1. Доступ к GitHub-репозиторию:
   `https://github.com/SlegOimkin/VIP-Orders-App`

2. Доступ к Vercel-проекту.

3. Bitrix24 webhook для REST API.
   Его нельзя публиковать в GitHub, README, чатах и скриншотах.

4. Если включена Basic Auth:
   `APP_AUTH_USERNAME` и `APP_AUTH_PASSWORD`.

## 4. Локальная подготовка с нуля

Команды ниже рассчитаны на Windows PowerShell.

```powershell
git clone https://github.com/SlegOimkin/VIP-Orders-App.git
cd VIP-Orders-App

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

Copy-Item .env.example .env
```

После этого откройте `.env` и замените тестовый webhook:

```env
BITRIX_WEBHOOK_URL=https://ВАШ_ПОРТАЛ.bitrix24.ru/rest/USER_ID/WEBHOOK_CODE/
```

Минимально для живых данных нужны:

```env
BITRIX_WEBHOOK_URL=...
BITRIX_ENTITY_TYPE_ID=1158
```

Если webhook пока недоступен, можно включить демо-режим:

```powershell
$env:USE_DEMO_DATA='1'
python app.py
```

## 5. Локальный запуск

Обычный запуск:

```powershell
.\.venv\Scripts\Activate.ps1
python app.py
```

Приложение откроется на:

```text
http://127.0.0.1:5000/
```

Health-check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/health
```

Принудительно обновить данные:

```text
http://127.0.0.1:5000/api/orders?refresh=1
```

## 6. Переменные окружения

Главные переменные:

```env
BITRIX_WEBHOOK_URL=https://...
BITRIX_ENTITY_TYPE_ID=1158
BITRIX_PROCESS_TITLE=Реестр VIP-заказов

BITRIX_WORK_STAGE_NAME=В работе
BITRIX_WORK_STAGE_IDS=DT1158_153:NEW

BITRIX_COMPLETED_STAGE_NAME=Завершенные
BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS
BITRIX_COMPLETED_VISIBLE_DAYS=7
```

Поля заказа:

```env
VIP_FIELD_PROJECT=ufCrm105_1777364307
VIP_FIELD_RESPONSIBLE=ufCrm105_1777364333
VIP_FIELD_CUSTOMER=ufCrm105_1777364351
VIP_FIELD_SUBJECT=ufCrm105_1777364362
VIP_FIELD_CALCULATION_STAGE=ufCrm105_1777364374
VIP_FIELD_COMMENT=ufCrm105_1778845145
```

Поля дат этапов обычно находятся автоматически по названию, но их можно закрепить:

```env
VIP_STAGE_DATE_TASK_RECEIVED=ufCrm105_1778845162
VIP_STAGE_DATE_MEASUREMENT=ufCrm105_1778845188
VIP_STAGE_DATE_CALCULATION=ufCrm105_1778845493
VIP_STAGE_DATE_SKETCH=ufCrm105_1778845424
VIP_STAGE_DATE_APPROVAL=ufCrm105_1778845455
VIP_STAGE_DATE_MATERIALS=ufCrm105_1778845472
VIP_STAGE_DATE_PRODUCTION=ufCrm105_1778845509
VIP_STAGE_DATE_INSTALLATION=ufCrm105_1778845528
```

Прочее:

```env
CACHE_TTL_SECONDS=45
BITRIX_MAX_ITEMS=500
BITRIX_TIMEOUT_SECONDS=15
```

Опциональная защита входа:

```env
APP_AUTH_USERNAME=director
APP_AUTH_PASSWORD=strong-password-here
```

Если обе переменные не заданы, Basic Auth выключена.

## 7. Что важно знать про бизнес-логику

### Рабочие заказы

По умолчанию показываются записи из стадии:

```env
BITRIX_WORK_STAGE_IDS=DT1158_153:NEW
```

### Завершенные заказы

Завершенные записи берутся из:

```env
BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS
```

Они остаются в панели еще 7 дней после `movedTime`:

```env
BITRIX_COMPLETED_VISIBLE_DAYS=7
```

### Этапы и даты

В карточке заказа есть этапы:

1. Поступила задача
2. Замер
3. Выполнение расчета
4. Выполнение эскизов/предварительное проектирование
5. Согласование с заказчиком
6. Заказ материалов
7. Изготовление на производстве
8. Монтаж

Дата этапа считается завершением только если дата раньше сегодняшнего дня.
Если дата сегодняшняя или будущая, этап не считается завершенным.

### Excel-сводка

На desktop-версии есть кнопка `Сводка Excel`.

Она экспортирует только незавершенные записи, с учетом текущих фильтров и поиска.
Файл создается в браузере как Excel-compatible `.xls`.

## 8. Проверки перед commit

Перед каждым commit желательно выполнить:

```powershell
.\.venv\Scripts\python.exe -m py_compile app.py
node --check public\assets\app.js
node --check public\sw.js
git diff --check
```

Если Node.js не установлен, минимум выполнить Python-проверку:

```powershell
.\.venv\Scripts\python.exe -m py_compile app.py
```

Проверка live API:

```powershell
$env:BITRIX_WEBHOOK_URL='https://...'
$env:USE_DEMO_DATA=''
.\.venv\Scripts\python.exe -c "from app import app; c=app.test_client(); r=c.get('/api/orders?refresh=1'); print(r.status_code, r.get_json().get('ok'), len(r.get_json().get('items', [])))"
```

## 9. Работа с GitHub

### Получить свежий код

```powershell
git switch main
git pull origin main
```

### Посмотреть изменения

```powershell
git status --short --branch
git diff
```

### Обычный безопасный вариант: через отдельную ветку и Pull Request

```powershell
git switch main
git pull origin main
git switch -c feature/short-description
```

После правок:

```powershell
git status --short
git diff

.\.venv\Scripts\python.exe -m py_compile app.py
node --check public\assets\app.js
node --check public\sw.js
git diff --check

git add -- app.py public\assets\app.js public\assets\app.css templates\index.html README.md .env.example
git commit -m "Short clear commit message"
git push -u origin feature/short-description
```

Дальше открыть PR на GitHub:

```text
https://github.com/SlegOimkin/VIP-Orders-App/pulls
```

После merge в `main` Vercel обычно сам делает production deploy, если проект подключен к GitHub.

### Быстрый вариант: напрямую в main

Использовать только для маленьких проверенных правок.

```powershell
git switch main
git pull origin main

# правки

.\.venv\Scripts\python.exe -m py_compile app.py
node --check public\assets\app.js
node --check public\sw.js
git diff --check

git add -- public\assets\app.js
git commit -m "Short clear commit message"
git push origin main
```

## 10. Деплой на Vercel через GitHub

Это рекомендуемый способ.

1. Открыть Vercel Dashboard.
2. Создать проект из GitHub-репозитория:

   ```text
   SlegOimkin/VIP-Orders-App
   ```

3. Production Branch поставить:

   ```text
   main
   ```

4. В Environment Variables добавить значения из `.env.example`.
   Обязательно добавить реальный `BITRIX_WEBHOOK_URL`.

5. Нажать Deploy.

После этого:

- push в ветку или PR создает Preview Deployment;
- merge/push в `main` создает Production Deployment.

Это соответствует стандартной Git-интеграции Vercel: preview для веток/PR и production для production branch.

## 11. Деплой через Vercel CLI

Установка CLI:

```powershell
npm i -g vercel
```

Логин:

```powershell
vercel login
```

Привязать локальную папку к Vercel-проекту:

```powershell
vercel link
```

Подтянуть переменные окружения локально:

```powershell
vercel env pull .env.local
```

Preview deployment:

```powershell
vercel
```

Production deployment:

```powershell
vercel --prod
```

Важно: для обычной работы лучше использовать GitHub-интеграцию, а CLI держать как запасной вариант.

## 12. Настройка переменных в Vercel

В Vercel открыть:

```text
Project -> Settings -> Environment Variables
```

Добавить:

```env
BITRIX_WEBHOOK_URL=...
BITRIX_ENTITY_TYPE_ID=1158
BITRIX_PROCESS_TITLE=Реестр VIP-заказов
BITRIX_WORK_STAGE_NAME=В работе
BITRIX_WORK_STAGE_IDS=DT1158_153:NEW
BITRIX_COMPLETED_STAGE_NAME=Завершенные
BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS
BITRIX_COMPLETED_VISIBLE_DAYS=7
VIP_FIELD_PROJECT=ufCrm105_1777364307
VIP_FIELD_RESPONSIBLE=ufCrm105_1777364333
VIP_FIELD_CUSTOMER=ufCrm105_1777364351
VIP_FIELD_SUBJECT=ufCrm105_1777364362
VIP_FIELD_CALCULATION_STAGE=ufCrm105_1777364374
VIP_FIELD_COMMENT=ufCrm105_1778845145
CACHE_TTL_SECONDS=45
BITRIX_MAX_ITEMS=500
BITRIX_TIMEOUT_SECONDS=15
```

Если нужна защита:

```env
APP_AUTH_USERNAME=director
APP_AUTH_PASSWORD=...
```

Для production нужно выбрать среду `Production`.
Для preview можно продублировать те же значения в `Preview`.

## 13. Обновление приложения

Типовой порядок:

1. Забрать свежий `main`:

   ```powershell
   git switch main
   git pull origin main
   ```

2. Сделать правки.

3. Проверить локально:

   ```powershell
   python app.py
   ```

4. Открыть:

   ```text
   http://127.0.0.1:5000/
   ```

5. Прогнать проверки:

   ```powershell
   .\.venv\Scripts\python.exe -m py_compile app.py
   node --check public\assets\app.js
   node --check public\sw.js
   git diff --check
   ```

6. Commit и push.

7. Проверить Vercel Deployment.

## 14. Если поменялись поля в Bitrix

Если в Bitrix переименовали поля, приложение часто найдет их автоматически по названиям.
Но надежнее закрепить внутренние коды через env.

Как найти код поля:

1. Открыть Bitrix smart process.
2. Найти нужное поле.
3. Посмотреть внутренний код вида:

   ```text
   ufCrm105_1778845145
   ```

4. Добавить его в Vercel Environment Variables.

Например:

```env
VIP_FIELD_COMMENT=ufCrm105_1778845145
```

После изменения env в Vercel нужно сделать redeploy.

## 15. Если поменялись стадии в Bitrix

Главные переменные:

```env
BITRIX_WORK_STAGE_IDS=DT1158_153:NEW
BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS
```

Если стадия в Bitrix переименована, но ID тот же, ничего менять не нужно.
Если поменялся внутренний ID, обновить env в Vercel и redeploy.

## 16. Rollback

### Через Vercel

В Vercel Dashboard:

```text
Project -> Deployments -> выбрать старый успешный deployment -> Promote / Redeploy
```

### Через Git

Если плохой commit уже в `main`:

```powershell
git switch main
git pull origin main
git revert <commit_sha>
git push origin main
```

Не использовать `git reset --hard` для общей ветки без полного понимания последствий.

## 17. Типовые проблемы

### Приложение показывает demo-данные

Причины:

- не задан `BITRIX_WEBHOOK_URL`;
- включен `USE_DEMO_DATA=1`;
- Vercel env задан не в той среде.

Что проверить:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/orders?refresh=1
```

### Нет завершенных заказов

Проверить:

```env
BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS
BITRIX_COMPLETED_VISIBLE_DAYS=7
```

Завершенные старше 7 дней не показываются.

### Vercel задеплоил `.venv`

Проверить `.vercelignore`.
В проекте уже есть исключения:

```text
.venv/
**/.venv/
```

Если `.venv` случайно попала в Git:

```powershell
git rm -r --cached .venv
git commit -m "Remove local virtual environment from repository"
git push
```

### После обновления frontend старый вид

Причина может быть в service worker.

Что сделать:

1. Открыть сайт.
2. Сделать hard refresh.
3. На телефоне закрыть и открыть PWA.
4. Если не помогло, в DevTools удалить service worker/cache.

### Excel выглядит не так

Excel-сводка генерируется в `public/assets/app.js`, функция:

```js
buildExcelHtml(items)
```

Там находятся:

- список колонок;
- ширины колонок;
- стили печати;
- цвета этапов;
- настройки A3.

## 18. Что нельзя делать

- Нельзя коммитить `.env`.
- Нельзя публиковать реальный Bitrix webhook.
- Нельзя коммитить `.venv`.
- Нельзя делать `git reset --hard` на общей ветке без осознанной причины.
- Нельзя менять ID стадий/полей без проверки live Bitrix payload.

## 19. Полезные официальные ссылки

- Vercel Python Runtime: https://vercel.com/docs/functions/runtimes/python
- Flask on Vercel: https://vercel.com/docs/frameworks/backend/flask
- Vercel Git Deployments: https://vercel.com/docs/deployments/git
- Vercel CLI Deploy: https://vercel.com/docs/cli/deploy
- Vercel Environment Variables: https://vercel.com/docs/environment-variables

## 20. Быстрый чеклист передачи проекта

Перед передачей убедиться, что новый разработчик:

- имеет доступ к GitHub repo;
- имеет доступ к Vercel project;
- знает, где хранится Bitrix webhook;
- умеет локально запустить `python app.py`;
- знает, какие env-переменные стоят в Vercel;
- понимает, что production branch - `main`;
- умеет сделать commit/push;
- знает, где смотреть Vercel Deployments и Logs.
