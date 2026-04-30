# VIP Orders Dashboard

Python/Flask-приложение для директорского просмотра смарт-процесса Bitrix24 `Реестр VIP-Заказов`.

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
- `VIP_FIELD_PROJECT=ufCrm105_1777364307`
- `VIP_FIELD_RESPONSIBLE=ufCrm105_1777364333`
- `VIP_FIELD_CUSTOMER=ufCrm105_1777364351`
- `VIP_FIELD_SUBJECT=ufCrm105_1777364362`
- `VIP_FIELD_CALCULATION_STAGE=ufCrm105_1777364374`
- `APP_AUTH_USERNAME` и `APP_AUTH_PASSWORD`, если нужна защита входа

По умолчанию панель показывает только карточки из стадии смарт-процесса `В работе`.
Если в Bitrix стадия переименована или нужно закрепить внутренние ID стадий, задайте
`BITRIX_WORK_STAGE_NAME` или `BITRIX_WORK_STAGE_IDS` в переменных окружения Vercel.

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
