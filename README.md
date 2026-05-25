# VIP Orders Dashboard

Python/Flask-приложение для директорского просмотра смарт-процесса Bitrix24 `Реестр VIP-Заказов`.

Подробная инструкция для разработчика, деплоя на Vercel и обновлений: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

## Возможности

- живая загрузка данных из Bitrix24 REST;
- автообнаружение смарт-процесса по названию или фиксированный `BITRIX_ENTITY_TYPE_ID=1158`;
- таблица для ПК и карточки для телефона;
- поиск, фильтр по ответственному, фильтр по стадии, быстрые stage-чипы;
- PWA-манифест и service worker для установки на телефон;
- опциональная Basic Auth защита.

## Локальный запуск

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Заполните `BITRIX_WEBHOOK_URL` в `.env`, затем:

```powershell
python app.py
```

Приложение откроется на `http://localhost:5000`.

## Vercel

Vercel поддерживает Flask как Python Function. В репозиторий нужно загрузить эти файлы, а секреты добавить в Project Settings -> Environment Variables:

- `BITRIX_WEBHOOK_URL`
- `BITRIX_ENTITY_TYPE_ID=1158`
- `BITRIX_WORK_STAGE_NAME=В работе`
- `BITRIX_WORK_STAGE_IDS=DT1158_153:NEW`
- `BITRIX_COMPLETED_STAGE_NAME=Завершенные`
- `BITRIX_COMPLETED_STAGE_IDS=DT1158_153:SUCCESS`
- `BITRIX_COMPLETED_VISIBLE_DAYS=7`
- `VIP_FIELD_PROJECT=ufCrm105_1777364307`
- `VIP_FIELD_RESPONSIBLE=ufCrm105_1777364333`
- `VIP_FIELD_CUSTOMER=ufCrm105_1777364351`
- `VIP_FIELD_SUBJECT=ufCrm105_1777364362`
- `VIP_FIELD_CALCULATION_STAGE=ufCrm105_1777364374`
- `VIP_FIELD_COMMENT=ufCrm105_1778845145`
- `APP_AUTH_USERNAME` и `APP_AUTH_PASSWORD`, если нужна защита входа

По умолчанию панель показывает карточки из стадии смарт-процесса `В работе`.
Карточки из стадии `Завершенные` остаются в панели еще 7 дней после изменения стадии
и помечаются меткой `Завершена`. Если в Bitrix стадии переименованы или нужно закрепить
внутренние ID стадий, задайте соответствующие `BITRIX_*_STAGE_*` переменные в Vercel.

Для деплоя через CLI:

```powershell
vercel
```

Если Vercel ругается на `.venv`, значит локальное виртуальное окружение попало в деплой. Удалите его из Git и задеплойте заново:

```powershell
git rm -r --cached .venv
git commit -m "Remove local virtual environment from deployment"
git push
```

Если деплой идет напрямую через Vercel CLI из папки, убедитесь, что `.vercelignore` уже есть в проекте, или временно удалите локальную `.venv` перед деплоем:

```powershell
Remove-Item -Recurse -Force .venv
vercel
```

## Безопасность

Не публикуйте Bitrix webhook в GitHub. Файл `.env` исключен через `.gitignore`; в репозитории должен оставаться только `.env.example`.
