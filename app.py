from __future__ import annotations

import hmac
import os
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, send_from_directory


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"

app = Flask(__name__, template_folder=str(BASE_DIR / "templates"), static_folder=None)

CACHE: dict[str, Any] = {"expires_at": 0, "payload": None}
USER_CACHE: dict[str, str] = {}

DEFAULT_PROCESS_TITLE = "Реестр VIP-заказов"
DEFAULT_WORK_STAGE_NAME = "В работе"
DEFAULT_WORK_STAGE_IDS = {"DT1158_153:NEW"}
DEFAULT_COMPLETED_STAGE_NAME = "Завершенные"
DEFAULT_COMPLETED_STAGE_IDS = {"DT1158_153:SUCCESS", "SUCCESS"}
DEFAULT_COMPLETED_VISIBLE_DAYS = 7

COLUMN_DEFINITIONS = [
    {
        "id": "project",
        "label": "Проект",
        "env": "VIP_FIELD_PROJECT",
        "candidates": ["проект", "project"],
        "fallbacks": ["title"],
    },
    {
        "id": "responsible",
        "label": "Ответственный",
        "env": "VIP_FIELD_RESPONSIBLE",
        "candidates": ["ответственный", "responsible"],
        "fallbacks": ["assignedById"],
    },
    {
        "id": "customer",
        "label": "Заказчик",
        "env": "VIP_FIELD_CUSTOMER",
        "candidates": ["заказчик", "клиент", "customer", "client"],
        "fallbacks": ["contactId", "companyId"],
    },
    {
        "id": "subject",
        "label": "Предмет",
        "env": "VIP_FIELD_SUBJECT",
        "candidates": ["предмет", "тема", "описание", "subject"],
        "fallbacks": ["title"],
    },
    {
        "id": "calculationStage",
        "label": "Стадия расчета",
        "env": "VIP_FIELD_CALCULATION_STAGE",
        "candidates": ["стадия расчета", "этап расчета", "статус расчета", "calculation stage"],
        "fallbacks": ["stageId"],
    },
]

STAGE_DATE_DEFINITIONS = [
    {
        "id": "taskReceived",
        "label": "Поступила задача",
        "env": "VIP_STAGE_DATE_TASK_RECEIVED",
        "candidates": ["дата поступления задачи", "поступила задача"],
        "fallbacks": [],
    },
    {
        "id": "measurement",
        "label": "Замер",
        "env": "VIP_STAGE_DATE_MEASUREMENT",
        "candidates": ["дата замера", "замер"],
        "fallbacks": [],
    },
    {
        "id": "calculation",
        "label": "Выполнение расчета",
        "env": "VIP_STAGE_DATE_CALCULATION",
        "candidates": ["дата выполнения расчета", "выполнение расчета"],
        "fallbacks": [],
    },
    {
        "id": "sketch",
        "label": "Выполнение эскизов/предварительное проектирование",
        "env": "VIP_STAGE_DATE_SKETCH",
        "candidates": ["дата выполнения эскизов", "предварительного проектирования", "эскиз"],
        "fallbacks": [],
    },
    {
        "id": "approval",
        "label": "Согласование с заказчиком",
        "env": "VIP_STAGE_DATE_APPROVAL",
        "candidates": ["дата согласования с заказчиком", "согласование с заказчиком"],
        "fallbacks": [],
    },
    {
        "id": "materials",
        "label": "Заказ материалов",
        "env": "VIP_STAGE_DATE_MATERIALS",
        "candidates": ["дата заказа материалов", "заказ материалов"],
        "fallbacks": [],
    },
    {
        "id": "production",
        "label": "Изготовление на производстве",
        "env": "VIP_STAGE_DATE_PRODUCTION",
        "candidates": ["дата изготовления на производстве", "изготовление на производстве"],
        "fallbacks": [],
    },
    {
        "id": "installation",
        "label": "Монтаж",
        "env": "VIP_STAGE_DATE_INSTALLATION",
        "candidates": ["дата монтажа", "монтаж"],
        "fallbacks": [],
    },
]


class AppConfigurationError(RuntimeError):
    pass


class BitrixApiError(RuntimeError):
    pass


def normalized(text: Any) -> str:
    value = str(text or "").casefold().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", " ", value).strip()


def parse_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def get_webhook_url() -> str:
    webhook = os.getenv("BITRIX_WEBHOOK_URL", "").strip()
    if not webhook:
        raise AppConfigurationError("BITRIX_WEBHOOK_URL is not configured")
    return webhook if webhook.endswith("/") else f"{webhook}/"


def portal_url_from_webhook(webhook: str) -> str:
    configured = os.getenv("BITRIX_PORTAL_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    parsed = urlparse(webhook)
    return f"{parsed.scheme}://{parsed.netloc}"


def wants_demo_data() -> bool:
    return os.getenv("USE_DEMO_DATA", "").strip().lower() in {"1", "true", "yes", "y"}


def bitrix_timeout() -> int:
    return parse_int_env("BITRIX_TIMEOUT_SECONDS", 15)


def cache_ttl() -> int:
    return parse_int_env("CACHE_TTL_SECONDS", 45)


def max_items() -> int:
    return parse_int_env("BITRIX_MAX_ITEMS", 500)


def work_stage_name() -> str:
    return os.getenv("BITRIX_WORK_STAGE_NAME", DEFAULT_WORK_STAGE_NAME).strip()


def completed_stage_name() -> str:
    return os.getenv("BITRIX_COMPLETED_STAGE_NAME", DEFAULT_COMPLETED_STAGE_NAME).strip()


def completed_visible_days() -> int:
    return parse_int_env("BITRIX_COMPLETED_VISIBLE_DAYS", DEFAULT_COMPLETED_VISIBLE_DAYS)


def configured_work_stage_ids() -> set[str]:
    raw_value = os.getenv("BITRIX_WORK_STAGE_IDS", "").strip()
    if not raw_value:
        return DEFAULT_WORK_STAGE_IDS
    return {part.strip() for part in re.split(r"[,;]", raw_value) if part.strip()}


def configured_completed_stage_ids() -> set[str]:
    raw_value = os.getenv("BITRIX_COMPLETED_STAGE_IDS", "").strip()
    if not raw_value:
        return set()
    configured = {part.strip() for part in re.split(r"[,;]", raw_value) if part.strip()}
    if any(stage_id == "PREPARATION" or stage_id.endswith(":PREPARATION") for stage_id in configured):
        return configured | DEFAULT_COMPLETED_STAGE_IDS
    return configured


def require_basic_auth() -> Response | None:
    username = os.getenv("APP_AUTH_USERNAME", "")
    password = os.getenv("APP_AUTH_PASSWORD", "")
    if not username or not password:
        return None

    auth = request.authorization
    if auth and hmac.compare_digest(auth.username or "", username) and hmac.compare_digest(auth.password or "", password):
        return None

    return Response(
        "Authentication required",
        401,
        {"WWW-Authenticate": 'Basic realm="VIP Orders"'},
    )


@app.before_request
def authenticate() -> Response | None:
    return require_basic_auth()


class BitrixClient:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
        self.portal_url = portal_url_from_webhook(webhook_url)

    def call_full(self, method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.webhook_url}{method}.json"
        response = requests.post(url, json=payload or {}, timeout=bitrix_timeout())
        response.raise_for_status()
        data = response.json()
        if data.get("error"):
            description = data.get("error_description") or data.get("error")
            raise BitrixApiError(str(description))
        return data

    def call(self, method: str, payload: dict[str, Any] | None = None) -> Any:
        return self.call_full(method, payload).get("result")

    def discover_entity_type_id(self) -> int:
        configured = os.getenv("BITRIX_ENTITY_TYPE_ID", "").strip()
        if configured:
            return int(configured)

        expected_title = normalized(os.getenv("BITRIX_PROCESS_TITLE", DEFAULT_PROCESS_TITLE))
        result = self.call("crm.type.list", {}) or {}
        types = result.get("types", result if isinstance(result, list) else [])

        for item in types:
            labels = [
                item.get("title"),
                item.get("titlePlural"),
                item.get("name"),
                item.get("code"),
            ]
            if any(expected_title and expected_title in normalized(label) for label in labels):
                return int(item["entityTypeId"])

        available = ", ".join(filter(None, [item.get("title") for item in types[:20]]))
        raise AppConfigurationError(f"Smart process '{DEFAULT_PROCESS_TITLE}' was not found. Available: {available}")

    def get_fields(self, entity_type_id: int) -> dict[str, dict[str, Any]]:
        result = self.call("crm.item.fields", {"entityTypeId": entity_type_id}) or {}
        return result.get("fields", result)

    def list_items(self, entity_type_id: int) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        start: int | None = 0
        limit = max_items()

        while start is not None and len(items) < limit:
            payload = {
                "entityTypeId": entity_type_id,
                "select": ["*", "UF_*"],
                "order": {"updatedTime": "DESC", "id": "DESC"},
                "start": start,
            }
            data = self.call_full("crm.item.list", payload)
            result = data.get("result") or {}
            chunk = result.get("items") or []
            items.extend(chunk)

            next_value = data.get("next") or result.get("next")
            start = int(next_value) if next_value is not None and len(items) < limit else None

        return items[:limit]

    def category_ids(self, entity_type_id: int) -> list[int]:
        result = self.call("crm.category.list", {"entityTypeId": entity_type_id}) or {}
        categories = result.get("categories", result if isinstance(result, list) else [])

        ids: list[int] = []
        for category in categories:
            value = category.get("id")
            if value is not None:
                try:
                    ids.append(int(value))
                except (TypeError, ValueError):
                    continue

        return ids

    def status_list(self, entity_type_id: int, category_id: int) -> list[dict[str, Any]]:
        entity_id = f"DYNAMIC_{entity_type_id}_STAGE_{category_id}"
        result = self.call(
            "crm.status.list",
            {
                "filter": {"ENTITY_ID": entity_id},
                "order": {"SORT": "ASC"},
            },
        )
        return result if isinstance(result, list) else []

    def user_name(self, user_id: Any) -> str:
        if user_id in (None, "", []):
            return ""
        user_key = str(user_id)
        if user_key in USER_CACHE:
            return USER_CACHE[user_key]

        try:
            result = self.call("user.get", {"ID": user_id}) or []
            user = result[0] if result else {}
            name_parts = [user.get("LAST_NAME"), user.get("NAME"), user.get("SECOND_NAME")]
            display = " ".join(part for part in name_parts if part).strip()
            if not display:
                display = user.get("EMAIL") or user_key
        except Exception:
            display = user_key

        USER_CACHE[user_key] = display
        return display


def field_label(field_key: str, meta: dict[str, Any]) -> str:
    return " ".join(
        str(meta.get(key) or "")
        for key in ("title", "listLabel", "formLabel", "filterLabel", "upperName", "name", "caption")
    )


def field_matches(meta: dict[str, Any], candidates: list[str]) -> bool:
    label = normalized(field_label("", meta))
    return any(normalized(candidate) and normalized(candidate) in label for candidate in candidates)


def select_field(fields: dict[str, dict[str, Any]], definition: dict[str, Any]) -> str | None:
    configured = os.getenv(definition["env"], "").strip()
    if configured and configured in fields:
        return configured

    custom_matches = [
        key
        for key, meta in fields.items()
        if key.lower().startswith("ufcrm") and field_matches(meta, definition["candidates"])
    ]
    if custom_matches:
        return custom_matches[0]

    standard_matches = [
        key
        for key, meta in fields.items()
        if not key.lower().startswith("ufcrm") and field_matches(meta, definition["candidates"])
    ]
    if standard_matches:
        return standard_matches[0]

    for fallback in definition["fallbacks"]:
        if fallback in fields:
            return fallback

    return None


def build_columns(fields: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    columns = []
    for definition in COLUMN_DEFINITIONS:
        field_key = select_field(fields, definition)
        meta = fields.get(field_key or "", {})
        columns.append(
            {
                "id": definition["id"],
                "label": definition["label"],
                "field": field_key,
                "sourceLabel": meta.get("title") or field_key or "",
            }
        )
    return columns


def build_stage_date_fields(fields: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    stage_date_fields = []
    for definition in STAGE_DATE_DEFINITIONS:
        field_key = select_field(fields, definition)
        meta = fields.get(field_key or "", {})
        stage_date_fields.append(
            {
                "id": definition["id"],
                "label": definition["label"],
                "field": field_key,
                "sourceLabel": meta.get("title") or field_key or "",
            }
        )
    return stage_date_fields


def enum_map(meta: dict[str, Any]) -> dict[str, str]:
    values: dict[str, str] = {}
    for item in meta.get("items") or []:
        item_id = item.get("ID") or item.get("id")
        item_value = item.get("VALUE") or item.get("value") or item.get("NAME") or item.get("name")
        if item_id is not None and item_value:
            values[str(item_id)] = str(item_value)
    return values


def enum_items(meta: dict[str, Any]) -> list[dict[str, str]]:
    values = []
    for item in meta.get("items") or []:
        item_id = item.get("ID") or item.get("id")
        item_value = item.get("VALUE") or item.get("value") or item.get("NAME") or item.get("name")
        if item_id is not None and item_value:
            values.append({"id": str(item_id), "label": str(item_value)})
    return values


def sort_stage_date_fields(
    stage_date_fields: list[dict[str, Any]],
    calculation_stage_meta: dict[str, Any],
) -> list[dict[str, Any]]:
    indexed: list[tuple[int, int, dict[str, Any]]] = []
    used_ids: set[str] = set()
    enum_stages = enum_items(calculation_stage_meta)

    for enum_index, enum_stage in enumerate(enum_stages):
        enum_label = normalized(enum_stage["label"])
        for definition_index, field in enumerate(stage_date_fields):
            if field["id"] in used_ids:
                continue
            if enum_label == normalized(field["label"]):
                indexed.append((enum_index, definition_index, {**field, "stageValue": enum_stage["id"]}))
                used_ids.add(field["id"])
                break

    for definition_index, field in enumerate(stage_date_fields):
        if field["id"] not in used_ids:
            indexed.append((len(enum_stages) + definition_index, definition_index, field))

    return [field for _, _, field in sorted(indexed, key=lambda item: (item[0], item[1]))]


def stage_index_for_item(
    stage_date_fields: list[dict[str, Any]],
    calculation_stage_raw: Any,
    calculation_stage_label: str,
) -> int | None:
    raw_values = calculation_stage_raw if isinstance(calculation_stage_raw, list) else [calculation_stage_raw]
    raw_ids = {str(value) for value in raw_values if value not in (None, "")}
    label = normalized(calculation_stage_label)

    for index, field in enumerate(stage_date_fields):
        if field.get("stageValue") and str(field["stageValue"]) in raw_ids:
            return index
        if label and normalized(field["label"]) == label:
            return index

    return None


def has_value(value: Any) -> bool:
    return value not in (None, "", [])


def stage_category_ids_from_items(items: list[dict[str, Any]]) -> set[int]:
    category_ids: set[int] = set()
    for item in items:
        match = re.match(r"^DT\d+_(\d+):", str(item.get("stageId") or ""))
        if match:
            category_ids.add(int(match.group(1)))
    return category_ids


def stage_id_variants(stage_id: Any) -> set[str]:
    raw = str(stage_id or "").strip()
    if not raw:
        return set()

    variants = {raw}
    if ":" in raw:
        variants.add(raw.rsplit(":", 1)[1])
    return variants


def expanded_stage_ids(stage_ids: set[str]) -> set[str]:
    expanded: set[str] = set()
    for stage_id in stage_ids:
        expanded |= stage_id_variants(stage_id)
    return expanded


def item_matches_stage_ids(item: dict[str, Any], stage_ids: set[str]) -> bool:
    return bool(stage_id_variants(item.get("stageId")) & expanded_stage_ids(stage_ids))


def status_id(status: dict[str, Any]) -> str:
    return str(
        status.get("STATUS_ID")
        or status.get("statusId")
        or status.get("ID")
        or status.get("id")
        or ""
    ).strip()


def status_name(status: dict[str, Any]) -> str:
    return str(
        status.get("NAME")
        or status.get("name")
        or status.get("VALUE")
        or status.get("value")
        or status.get("TITLE")
        or status.get("title")
        or ""
    ).strip()


def stage_labels(
    client: BitrixClient,
    entity_type_id: int,
    fields: dict[str, dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, str]:
    labels = enum_map(fields.get("stageId", {}))
    try:
        category_ids = set(client.category_ids(entity_type_id))
    except Exception:
        category_ids = set()
    category_ids |= stage_category_ids_from_items(items)

    if not category_ids:
        category_ids.add(0)

    for category_id in sorted(category_ids):
        try:
            statuses = client.status_list(entity_type_id, category_id)
        except Exception:
            continue

        for status in statuses:
            key = status_id(status)
            name = status_name(status)
            if key and name:
                labels[key] = name
                if ":" not in key:
                    labels[f"DT{entity_type_id}_{category_id}:{key}"] = name

    return labels


def resolve_work_stage_ids(labels: dict[str, str]) -> set[str]:
    configured = configured_work_stage_ids()
    if configured:
        return expanded_stage_ids(configured)

    return stage_ids_by_name(labels, work_stage_name())


def resolve_completed_stage_ids(labels: dict[str, str]) -> set[str]:
    configured = configured_completed_stage_ids()
    if configured:
        return expanded_stage_ids(configured)

    by_name = stage_ids_by_name(labels, completed_stage_name())
    if by_name:
        return by_name | expanded_stage_ids(DEFAULT_COMPLETED_STAGE_IDS)

    return expanded_stage_ids(DEFAULT_COMPLETED_STAGE_IDS)


def stage_ids_by_name(labels: dict[str, str], target: str) -> set[str]:
    if not target:
        return set()

    target_normalized = normalized(target)
    if not target_normalized:
        return set()

    exact = {stage_id for stage_id, label in labels.items() if normalized(label) == target_normalized}
    if exact:
        return expanded_stage_ids(exact)

    partial = {stage_id for stage_id, label in labels.items() if target_normalized in normalized(label)}
    return expanded_stage_ids(partial)


def format_datetime(value: Any) -> str:
    if not value:
        return ""
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    return parsed.astimezone().strftime("%d.%m.%Y %H:%M")


def format_date(value: Any) -> str:
    if not value:
        return ""
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone()
    return parsed.strftime("%d.%m.%Y")


def iso_datetime(value: Any) -> str:
    if not value:
        return ""
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return text


def parse_datetime_value(value: Any) -> datetime | None:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def completed_reference_time(item: dict[str, Any]) -> Any:
    return item.get("movedTime") or item.get("updatedTime") or item.get("createdTime")


def completed_visible_until(item: dict[str, Any]) -> datetime | None:
    changed_at = parse_datetime_value(completed_reference_time(item))
    if not changed_at:
        return None
    return changed_at + timedelta(days=completed_visible_days())


def is_recent_completed_item(item: dict[str, Any], completed_stage_ids: set[str]) -> bool:
    if not item_matches_stage_ids(item, completed_stage_ids):
        return False

    visible_until = completed_visible_until(item)
    if not visible_until:
        return False

    return datetime.now(timezone.utc) <= visible_until.astimezone(timezone.utc)


def item_sort_time(item: dict[str, Any]) -> datetime:
    return (
        parse_datetime_value(item.get("updatedTime") or item.get("createdTime"))
        or datetime.min.replace(tzinfo=timezone.utc)
    )


def display_scalar(value: Any) -> str:
    if value in (None, "", []):
        return ""
    if isinstance(value, bool):
        return "Да" if value else "Нет"
    if isinstance(value, dict):
        for key in ("title", "name", "VALUE", "value", "text", "label"):
            if value.get(key):
                return str(value[key])
        return ", ".join(f"{key}: {val}" for key, val in value.items() if val not in (None, ""))
    return str(value)


def display_value(client: BitrixClient, value: Any, meta: dict[str, Any], field_key: str | None) -> str:
    if value in (None, "", []):
        return ""

    field_type = str(meta.get("type") or "").lower()
    if field_type in {"user", "employee"}:
        if isinstance(value, list):
            return ", ".join(client.user_name(item) for item in value if item not in (None, ""))
        return client.user_name(value)

    if field_type == "enumeration":
        labels = enum_map(meta)
        if isinstance(value, list):
            return ", ".join(labels.get(str(item), str(item)) for item in value if item not in (None, ""))
        return labels.get(str(value), str(value))

    if field_type == "datetime":
        return format_datetime(value)

    if field_type == "date":
        return format_date(value)

    if isinstance(value, list):
        return ", ".join(display_scalar(item) for item in value if item not in (None, ""))

    if field_key and field_key.lower().endswith("byid"):
        return client.user_name(value)

    return display_scalar(value)


def build_item_stage_dates(
    item: dict[str, Any],
    fields: dict[str, dict[str, Any]],
    stage_date_fields: list[dict[str, Any]],
    calculation_stage_raw: Any,
    calculation_stage_label: str,
) -> list[dict[str, Any]]:
    current_index = stage_index_for_item(stage_date_fields, calculation_stage_raw, calculation_stage_label)
    result = []

    for index, stage_field in enumerate(stage_date_fields):
        field_key = stage_field.get("field")
        meta = fields.get(field_key or "", {})
        raw_value = item.get(field_key) if field_key else ""
        field_type = str(meta.get("type") or "").lower()
        date_label = format_date(raw_value) if field_type == "date" else format_datetime(raw_value)
        completed_by_date = has_value(raw_value)
        completed_by_stage = current_index is not None and current_index > index
        is_current = current_index == index

        result.append(
            {
                "id": stage_field["id"],
                "label": stage_field["label"],
                "field": field_key,
                "sourceLabel": stage_field.get("sourceLabel", ""),
                "date": iso_datetime(raw_value),
                "dateLabel": date_label,
                "completed": completed_by_date or completed_by_stage,
                "completedByDate": completed_by_date,
                "current": is_current,
            }
        )

    return result


def item_url(portal_url: str, entity_type_id: int, item: dict[str, Any]) -> str:
    item_id = item.get("id")
    if not item_id:
        return ""
    return f"{portal_url}/crm/type/{entity_type_id}/details/{item_id}/"


def status_tone(status: str) -> str:
    text = normalized(status)
    if any(marker in text for marker in ("монтаж", "изготовление", "заказ материалов")):
        return "success"
    if any(marker in text for marker in ("согласование", "эскиз", "расчет", "замер")):
        return "warning"
    if any(marker in text for marker in ("срочно", "критично", "горит", "просроч")):
        return "danger"
    return "neutral"


def build_payload() -> dict[str, Any]:
    if wants_demo_data():
        return demo_payload("Demo mode is enabled")

    webhook = get_webhook_url()
    client = BitrixClient(webhook)
    entity_type_id = client.discover_entity_type_id()
    fields = client.get_fields(entity_type_id)
    columns = build_columns(fields)
    calculation_stage_field = next((column.get("field") for column in columns if column["id"] == "calculationStage"), None)
    calculation_stage_meta = fields.get(calculation_stage_field or "", {})
    stage_date_fields = sort_stage_date_fields(build_stage_date_fields(fields), calculation_stage_meta)
    all_bitrix_items = client.list_items(entity_type_id)
    stage_name_by_id = stage_labels(client, entity_type_id, fields, all_bitrix_items)
    work_stage_ids = resolve_work_stage_ids(stage_name_by_id)
    completed_stage_ids = resolve_completed_stage_ids(stage_name_by_id)

    stage_filter_warning = ""
    if work_stage_name() and not work_stage_ids:
        bitrix_items = all_bitrix_items
        stage_filter_warning = (
            f"Стадия Bitrix «{work_stage_name()}» не найдена. "
            "Временно показаны все карточки; проверьте название стадии или задайте BITRIX_WORK_STAGE_IDS."
        )
    elif work_stage_ids:
        bitrix_items = [item for item in all_bitrix_items if item_matches_stage_ids(item, work_stage_ids)]
        if all_bitrix_items and not bitrix_items:
            name_stage_ids = stage_ids_by_name(stage_name_by_id, work_stage_name())
            name_filtered_items = [
                item for item in all_bitrix_items if item_matches_stage_ids(item, name_stage_ids)
            ]
            if name_filtered_items:
                bitrix_items = name_filtered_items
                work_stage_ids = name_stage_ids
                stage_filter_warning = "BITRIX_WORK_STAGE_IDS не совпали с карточками; стадия найдена по названию."
            else:
                bitrix_items = all_bitrix_items
                stage_filter_warning = (
                    f"Фильтр стадии Bitrix «{work_stage_name()}» не совпал с карточками. "
                    "Временно показаны все карточки; проверьте BITRIX_WORK_STAGE_IDS."
                )
    else:
        bitrix_items = all_bitrix_items

    recent_completed_items = [
        item for item in all_bitrix_items if is_recent_completed_item(item, completed_stage_ids)
    ]
    known_item_ids = {str(item.get("id")) for item in bitrix_items}
    bitrix_items.extend(
        item for item in recent_completed_items if str(item.get("id")) not in known_item_ids
    )
    bitrix_items.sort(key=item_sort_time, reverse=True)

    items = []
    for index, item in enumerate(bitrix_items, start=1):
        values = {}
        raw_values = {}
        for column in columns:
            field_key = column.get("field")
            meta = fields.get(field_key or "", {})
            raw_value = item.get(field_key) if field_key else ""
            raw_values[column["id"]] = raw_value
            values[column["id"]] = display_value(client, raw_value, meta, field_key)

        updated_raw = item.get("updatedTime") or item.get("createdTime")
        calculation_stage = values.get("calculationStage", "")
        calculation_stage_raw = raw_values.get("calculationStage")
        process_stage_id = str(item.get("stageId") or "").strip()
        is_completed = item_matches_stage_ids(item, completed_stage_ids)
        completed_until = completed_visible_until(item) if is_completed else None
        items.append(
            {
                "rowNumber": index,
                "id": item.get("id"),
                "url": item_url(client.portal_url, entity_type_id, item),
                "processStageId": process_stage_id,
                "processStage": stage_name_by_id.get(process_stage_id, process_stage_id),
                "processStageTone": "completed" if is_completed else "active",
                "isCompleted": is_completed,
                "completedSince": iso_datetime(completed_reference_time(item)) if is_completed else "",
                "completedVisibleUntil": completed_until.isoformat() if completed_until else "",
                "updatedTime": iso_datetime(updated_raw),
                "updatedLabel": format_datetime(updated_raw),
                "statusTone": status_tone(calculation_stage),
                "values": values,
                "rawValues": raw_values,
                "stageDates": build_item_stage_dates(
                    item,
                    fields,
                    stage_date_fields,
                    calculation_stage_raw,
                    calculation_stage,
                ),
            }
        )

    return response_payload(
        items=items,
        columns=columns,
        entity_type_id=entity_type_id,
        portal_url=client.portal_url,
        fields=fields,
        stage_date_fields=stage_date_fields,
        warning=stage_filter_warning,
        demo=False,
        stage_filter={
            "name": work_stage_name(),
            "ids": sorted(work_stage_ids),
            "completedName": completed_stage_name(),
            "completedIds": sorted(completed_stage_ids),
            "completedVisibleDays": completed_visible_days(),
            "available": stage_name_by_id,
        },
    )


def response_payload(
    *,
    items: list[dict[str, Any]],
    columns: list[dict[str, Any]],
    entity_type_id: int | None,
    portal_url: str,
    fields: dict[str, dict[str, Any]],
    warning: str,
    demo: bool,
    stage_filter: dict[str, Any] | None = None,
    stage_date_fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    stage_counter = Counter(item["values"].get("calculationStage") or "Без стадии" for item in items)
    responsible_counter = Counter(item["values"].get("responsible") or "Без ответственного" for item in items)
    updated_today = sum(1 for item in items if item.get("updatedTime") and is_today(item["updatedTime"]))

    return {
        "ok": True,
        "demo": demo,
        "warning": warning,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "processTitle": os.getenv("BITRIX_PROCESS_TITLE", DEFAULT_PROCESS_TITLE),
        "entityTypeId": entity_type_id,
        "portalUrl": portal_url,
        "columns": columns,
        "items": items,
        "stats": {
            "total": len(items),
            "projects": len({item["values"].get("project") for item in items if item["values"].get("project")}),
            "updatedToday": updated_today,
        },
        "filters": {
            "stages": [{"label": label, "count": count} for label, count in stage_counter.most_common()],
            "responsibles": [{"label": label, "count": count} for label, count in responsible_counter.most_common()],
        },
        "diagnostics": {
            "mappedFields": {column["id"]: column.get("field") for column in columns},
            "stageDateFields": {
                field["id"]: field.get("field")
                for field in stage_date_fields or []
            },
            "fieldTitles": {key: value.get("title") for key, value in fields.items() if key in {c.get("field") for c in columns}},
            "stageFilter": stage_filter or {},
        },
    }


def is_today(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return False
    today = datetime.now().astimezone().date()
    return parsed.date() == today


def demo_payload(warning: str) -> dict[str, Any]:
    fields = {
        "project": {"title": "Проект", "type": "string"},
        "responsible": {"title": "Ответственный", "type": "string"},
        "customer": {"title": "Заказчик", "type": "string"},
        "subject": {"title": "Предмет", "type": "string"},
        "calculationStage": {"title": "Стадия расчета", "type": "string"},
    }
    for definition in STAGE_DATE_DEFINITIONS:
        fields[definition["id"]] = {"title": definition["label"], "type": "date"}

    columns = [
        {"id": key, "label": meta["title"], "field": key, "sourceLabel": meta["title"]}
        for key, meta in fields.items()
        if key in {"project", "responsible", "customer", "subject", "calculationStage"}
    ]
    stage_date_fields = build_stage_date_fields(fields)
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        ("1017-2025", "Лукьянцева М.А.", "Нагасова Н.", "Замена уплотнителя", "Заказ материалов"),
        ("1024-2025", "Смирнов И.П.", "Давыдова А.", "Нестандартные створки", "Выполнение расчета"),
        ("1031-2025", "Кузнецова Е.", "Петров В.", "Входная группа", "Согласование с заказчиком"),
    ]
    items = []
    for index, row in enumerate(rows, start=1):
        values = dict(zip([column["id"] for column in columns], row, strict=True))
        current_stage_index = stage_index_for_item(stage_date_fields, values["calculationStage"], values["calculationStage"])
        item_stage_date_values = {}
        for stage_index, stage_field in enumerate(stage_date_fields):
            if current_stage_index is not None and stage_index < current_stage_index:
                item_stage_date_values[stage_field["field"]] = (
                    datetime.now(timezone.utc) - timedelta(days=current_stage_index - stage_index + index)
                ).isoformat()
        is_completed = index == len(rows)
        completed_until = datetime.now(timezone.utc) + timedelta(days=completed_visible_days())
        items.append(
            {
                "rowNumber": index,
                "id": index,
                "url": "",
                "processStageId": "demo-completed" if is_completed else "demo-work",
                "processStage": completed_stage_name() if is_completed else work_stage_name() or DEFAULT_WORK_STAGE_NAME,
                "processStageTone": "completed" if is_completed else "active",
                "isCompleted": is_completed,
                "completedSince": now if is_completed else "",
                "completedVisibleUntil": completed_until.isoformat() if is_completed else "",
                "updatedTime": now,
                "updatedLabel": datetime.now().strftime("%d.%m.%Y %H:%M"),
                "statusTone": status_tone(values["calculationStage"]),
                "values": values,
                "rawValues": values,
                "stageDates": build_item_stage_dates(
                    item_stage_date_values,
                    fields,
                    stage_date_fields,
                    values["calculationStage"],
                    values["calculationStage"],
                ),
            }
        )

    return response_payload(
        items=items,
        columns=columns,
        entity_type_id=1158,
        portal_url="",
        fields=fields,
        warning=warning,
        demo=True,
        stage_filter={
            "name": work_stage_name(),
            "ids": ["demo-work"],
            "completedName": completed_stage_name(),
            "completedIds": ["demo-completed"],
            "completedVisibleDays": completed_visible_days(),
            "available": {
                "demo-work": work_stage_name(),
                "demo-completed": completed_stage_name(),
            },
        },
        stage_date_fields=stage_date_fields,
    )


@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/api/orders")
def orders() -> Response:
    refresh = request.args.get("refresh") == "1"
    now = time.time()
    if not refresh and CACHE["payload"] and CACHE["expires_at"] > now:
        return jsonify(CACHE["payload"])

    try:
        payload = build_payload()
    except AppConfigurationError as exc:
        payload = demo_payload(str(exc))
    except Exception as exc:
        app.logger.exception("Could not load VIP orders")
        return jsonify({"ok": False, "message": str(exc)}), 502

    CACHE["payload"] = payload
    CACHE["expires_at"] = now + cache_ttl()
    return jsonify(payload)


@app.get("/api/health")
def health() -> Response:
    return jsonify({"ok": True, "time": datetime.now(timezone.utc).isoformat()})


@app.get("/assets/<path:filename>")
def assets(filename: str) -> Response:
    return send_from_directory(PUBLIC_DIR / "assets", filename)


@app.get("/icons/<path:filename>")
def icons(filename: str) -> Response:
    return send_from_directory(PUBLIC_DIR / "icons", filename)


@app.get("/manifest.webmanifest")
def manifest() -> Response:
    return send_from_directory(PUBLIC_DIR, "manifest.webmanifest")


@app.get("/sw.js")
def service_worker() -> Response:
    response = send_from_directory(PUBLIC_DIR, "sw.js")
    response.headers["Cache-Control"] = "no-cache"
    return response


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "y"}
    app.run(host="0.0.0.0", port=parse_int_env("PORT", 5000), debug=debug)
