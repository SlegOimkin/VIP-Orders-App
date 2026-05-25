const state = {
  payload: null,
  query: "",
  responsible: "",
  stage: "",
  sort: "updated-desc",
  filterOpen: false,
  detailOpen: false,
  selectedOrderKey: "",
  previousFocus: null,
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  exportExcelButton: document.querySelector("#exportExcelButton"),
  searchInput: document.querySelector("#searchInput"),
  responsibleFilter: document.querySelector("#responsibleFilter"),
  stageFilter: document.querySelector("#stageFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  resetButton: document.querySelector("#resetButton"),
  stageChips: document.querySelector("#stageChips"),
  ordersBody: document.querySelector("#ordersBody"),
  cards: document.querySelector("#cards"),
  tableWrap: document.querySelector("#tableWrap"),
  loading: document.querySelector("#loading"),
  emptyState: document.querySelector("#emptyState"),
  resultCount: document.querySelector("#resultCount"),
  activeFilters: document.querySelector("#activeFilters"),
  lastUpdated: document.querySelector("#lastUpdated"),
  notice: document.querySelector("#notice"),
  filterDrawer: document.querySelector("#filterDrawer"),
  filterBackdrop: document.querySelector("#filterBackdrop"),
  filterToggle: document.querySelector("#filterToggle"),
  filterClose: document.querySelector("#filterClose"),
  filterApply: document.querySelector("#filterApply"),
  orderDetail: document.querySelector("#orderDetail"),
  orderDetailBackdrop: document.querySelector("#orderDetailBackdrop"),
  orderDetailContent: document.querySelector("#orderDetailContent"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .trim();
}

function pluralOrders(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} заказ`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} заказа`;
  return `${count} заказов`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatGeneratedAt(value) {
  if (!value) return "нет данных";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет данных";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function activeFilterCount() {
  return [state.query, state.responsible, state.stage].filter(Boolean).length;
}

function displayText(value, fallback = "Не указан") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function orderKey(item) {
  return String(item?.id ?? item?.rowNumber ?? "");
}

function findOrderByKey(key) {
  return (state.payload?.items || []).find((item) => orderKey(item) === key);
}

function closestElement(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

function isInteractiveTarget(target) {
  return Boolean(closestElement(target, "a, button, input, select, textarea, label"));
}

function setLoading(isLoading) {
  els.loading.hidden = !isLoading;
  els.refreshButton.disabled = isLoading;
  if (isLoading) {
    els.exportExcelButton.disabled = true;
  } else {
    renderExportButton();
  }
}

async function loadOrders({ refresh = false } = {}) {
  setLoading(true);
  els.emptyState.classList.add("empty--hidden");

  try {
    const response = await fetch(`/api/orders${refresh ? "?refresh=1" : ""}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Не удалось загрузить данные");
    }
    state.payload = payload;
    renderAll();
  } catch (error) {
    showNotice(error.message || "Ошибка загрузки данных", true);
    state.payload = { items: [], filters: { stages: [], responsibles: [] }, generatedAt: new Date().toISOString() };
    renderAll();
  } finally {
    setLoading(false);
  }
}

function showNotice(message, isError = false) {
  if (!message) {
    els.notice.classList.add("notice--hidden");
    els.notice.textContent = "";
    return;
  }
  els.notice.classList.remove("notice--hidden");
  els.notice.textContent = isError ? `Ошибка: ${message}` : message;
}

function renderAll() {
  const payload = state.payload;
  els.lastUpdated.textContent = formatGeneratedAt(payload.generatedAt);

  showNotice(payload.warning || (payload.demo ? "Включен демонстрационный режим. Добавьте BITRIX_WEBHOOK_URL для живых данных." : ""));
  renderFilters(payload.filters || { stages: [], responsibles: [] });
  renderRows();
  renderFilterButton();
}

function renderFilters(filters) {
  fillSelect(els.responsibleFilter, filters.responsibles || [], state.responsible);
  fillSelect(els.stageFilter, filters.stages || [], state.stage);

  els.stageChips.innerHTML = [
    `<button class="chip" type="button" data-stage="" aria-pressed="${state.stage === ""}">Все</button>`,
    ...(filters.stages || []).map((item) => {
      const active = item.label === state.stage;
      return `<button class="chip" type="button" data-stage="${escapeHtml(item.label)}" aria-pressed="${active}">${escapeHtml(item.label)} · ${item.count}</button>`;
    }),
  ].join("");
}

function fillSelect(select, options, selected) {
  const current = selected || "";
  select.innerHTML = `<option value="">Все</option>${options
    .map((item) => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)} · ${item.count}</option>`)
    .join("")}`;
  select.value = current;
}

function filteredItems() {
  const payload = state.payload || { items: [] };
  const query = normalize(state.query);

  return payload.items
    .filter((item) => {
      const values = item.values || {};
      const haystack = normalize(Object.values(values).join(" "));
      const matchesQuery = !query || haystack.includes(query);
      const matchesResponsible = !state.responsible || values.responsible === state.responsible;
      const matchesStage = !state.stage || values.calculationStage === state.stage;
      return matchesQuery && matchesResponsible && matchesStage;
    })
    .sort(sortItems);
}

function sortItems(a, b) {
  const av = a.values || {};
  const bv = b.values || {};
  if (state.sort === "project-asc") return normalize(av.project).localeCompare(normalize(bv.project), "ru");
  if (state.sort === "customer-asc") return normalize(av.customer).localeCompare(normalize(bv.customer), "ru");
  if (state.sort === "stage-asc") return normalize(av.calculationStage).localeCompare(normalize(bv.calculationStage), "ru");
  return new Date(b.updatedTime || 0) - new Date(a.updatedTime || 0);
}

function renderRows() {
  const items = filteredItems();
  els.resultCount.textContent = pluralOrders(items.length);
  els.activeFilters.textContent = activeFilterText();
  renderFilterButton();
  renderExportButton(items);

  if (!items.length) {
    els.tableWrap.hidden = true;
    els.cards.hidden = true;
    els.emptyState.classList.remove("empty--hidden");
    els.ordersBody.innerHTML = "";
    els.cards.innerHTML = "";
    return;
  }

  els.emptyState.classList.add("empty--hidden");
  els.tableWrap.hidden = false;
  els.cards.hidden = false;
  els.ordersBody.innerHTML = items.map(renderTableRow).join("");
  els.cards.innerHTML = items.map(renderCard).join("");
}

function renderExportButton(items = filteredItems()) {
  const unfinishedCount = items.filter((item) => !item.isCompleted).length;
  els.exportExcelButton.disabled = !unfinishedCount || !state.payload;
  els.exportExcelButton.title = unfinishedCount
    ? `Скачать сводку: ${pluralOrders(unfinishedCount)}`
    : "Нет незавершенных заказов для сводки";
}

function activeFilterText() {
  const parts = [];
  if (state.query) parts.push(`поиск: ${state.query}`);
  if (state.responsible) parts.push(`ответственный: ${state.responsible}`);
  if (state.stage) parts.push(`стадия: ${state.stage}`);
  return parts.length ? parts.join(" · ") : "без фильтров";
}

function renderTableRow(item, index) {
  const values = item.values || {};
  const project = escapeHtml(values.project || "Без проекта");
  const projectCell = item.url
    ? `<a class="project-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${project}</a>`
    : `<span class="project-link">${project}</span>`;
  const rowClass = item.isCompleted ? "order-row order-row--completed" : "order-row";
  const label = `Открыть карточку заказа ${displayText(values.project, "Без проекта")}`;

  return `<tr class="${rowClass}" data-order-key="${escapeHtml(orderKey(item))}" tabindex="0" aria-label="${escapeHtml(label)}">
    <td>${index + 1}</td>
    <td><div class="project-stack">${projectCell}${completionBadge(item)}</div></td>
    <td>${escapeHtml(values.responsible || "Не указан")}</td>
    <td>${escapeHtml(values.customer || "Не указан")}</td>
    <td>${escapeHtml(values.subject || "Не указан")}</td>
    <td>${stagePill(values.calculationStage, item.statusTone)}</td>
    <td class="muted">${escapeHtml(item.updatedLabel || "")}</td>
  </tr>`;
}

function renderCard(item) {
  const values = item.values || {};
  const project = escapeHtml(values.project || "Без проекта");
  const projectTitle = item.url
    ? `<a class="project-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${project}</a>`
    : `<span class="project-link">${project}</span>`;
  const cardClass = item.isCompleted ? "order-card order-card--completed" : "order-card";
  const label = `Открыть карточку заказа ${displayText(values.project, "Без проекта")}`;

  return `<article class="${cardClass}" data-order-key="${escapeHtml(orderKey(item))}" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
    <div class="order-card__primary">
      <span class="order-card__label">Заказчик</span>
      <strong>${escapeHtml(values.customer || "Не указан")}</strong>
      ${completionBadge(item)}
    </div>
    <div class="order-card__project">
      <span class="order-card__label">Номер проекта</span>
      <div>${projectTitle}</div>
    </div>
    <div class="order-card__status">
      ${stagePill(values.calculationStage, item.statusTone)}
    </div>
    <dl>
      <dt>Ответственный</dt><dd>${escapeHtml(values.responsible || "Не указан")}</dd>
      <dt>Предмет</dt><dd>${escapeHtml(values.subject || "Не указан")}</dd>
      <dt>Обновлено</dt><dd class="muted">${escapeHtml(item.updatedLabel || "")}</dd>
    </dl>
  </article>`;
}

function stagePill(value, tone = "neutral") {
  return `<span class="status-pill status-pill--${escapeHtml(tone || "neutral")}">${escapeHtml(value || "Без стадии")}</span>`;
}

function completionBadge(item) {
  if (!item.isCompleted) return "";
  return `<span class="process-badge process-badge--completed">Завершена</span>`;
}

function renderDetailField(label, value, content = null) {
  const resolvedContent = content ?? escapeHtml(displayText(value));
  return `<div class="detail-field">
    <dt>${escapeHtml(label)}</dt>
    <dd>${resolvedContent}</dd>
  </div>`;
}

function renderStageTimeline(stageDates) {
  if (!stageDates?.length) return "";

  const rows = stageDates
    .map((stage, index) => {
      const classes = [
        "stage-timeline__item",
        stage.completed ? "stage-timeline__item--done" : "",
        stage.current ? "stage-timeline__item--current" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const marker = stage.completed ? "✓" : index + 1;
      const state = stage.completed ? "Завершено" : stage.current ? "Текущий этап" : "Ожидает";
      const date = stage.dateLabel || "Дата не указана";

      return `<li class="${classes}">
        <span class="stage-timeline__marker" aria-label="${escapeHtml(state)}">${escapeHtml(marker)}</span>
        <div class="stage-timeline__body">
          <strong class="stage-timeline__title">${escapeHtml(stage.label || "Этап")}</strong>
          <span class="stage-timeline__date">${escapeHtml(date)}</span>
          <span class="stage-timeline__state">${escapeHtml(state)}</span>
        </div>
      </li>`;
    })
    .join("");

  return `<section class="detail-card__section">
    <h3>Этапы и даты</h3>
    <ol class="stage-timeline">${rows}</ol>
  </section>`;
}

function renderOrderComment(comment) {
  const text = displayText(comment, "");
  if (!text) return "";

  return `<section class="detail-card__section">
    <h3>Комментарий</h3>
    <div class="detail-comment">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>
  </section>`;
}

function excelCell(value) {
  return escapeHtml(String(value ?? "")).replace(/\r?\n/g, "<br>");
}

function excelDateStamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function collectStageLabels(items) {
  const labels = [];
  const seen = new Set();
  items.forEach((item) => {
    (item.stageDates || []).forEach((stage) => {
      const label = stage.label || "";
      if (!label || seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    });
  });
  return labels;
}

const stageExportLabels = {
  "Поступила задача": "Поступило",
  "Замер": "Замер",
  "Выполнение расчета": "Расчет",
  "Выполнение эскизов/предварительное проектирование": "Проект.",
  "Согласование с заказчиком": "Соглас.",
  "Заказ материалов": "Закупка",
  "Изготовление на производстве": "Произв.",
  "Монтаж": "Монтаж",
};

function exportStageLabel(label) {
  return stageExportLabels[label] || label;
}

function excelStageCell(stage) {
  if (!stage) return { value: "", className: "col-stage", style: "", bgcolor: "" };
  if (stage.current) {
    return {
      value: stage.dateLabel || "",
      className: "col-stage stage-current",
      style: "background-color:#fff0d5;color:#7b510f;font-weight:700;",
      bgcolor: "#fff0d5",
    };
  }
  if (stage.completed) {
    return {
      value: stage.dateLabel || "",
      className: "col-stage stage-done",
      style: "background-color:#dcefe7;color:#1f664f;font-weight:700;",
      bgcolor: "#dcefe7",
    };
  }
  return { value: stage.dateLabel || "", className: "col-stage", style: "", bgcolor: "" };
}

function buildExcelHtml(items) {
  const generatedAt = formatGeneratedAt(state.payload?.generatedAt || new Date().toISOString());
  const stageLabels = collectStageLabels(items);
  const baseColumns = [
    { label: "Проект", className: "col-project", width: 96 },
    { label: "Заказчик", className: "col-customer", width: 150 },
    { label: "Ответственный", className: "col-responsible", width: 138 },
    { label: "Предмет", className: "col-subject", width: 118 },
    { label: "Стадия расчета", className: "col-calc-stage", width: 92 },
    { label: "Комментарий", className: "col-comment", width: 120 },
  ];
  const columns = [
    ...baseColumns,
    ...stageLabels.map((label) => ({ label: exportStageLabel(label), className: "col-stage", width: 90 })),
  ];
  const colgroup = columns.map((column) => `<col width="${column.width}" style="width:${column.width}px">`).join("");
  const rows = items.map((item) => {
    const values = item.values || {};
    const stagesByLabel = new Map((item.stageDates || []).map((stage) => [stage.label, stage]));
    const cells = [
      { value: values.project || "Без проекта", className: "col-project" },
      { value: values.customer || "", className: "col-customer" },
      { value: values.responsible || "", className: "col-responsible" },
      { value: values.subject || "", className: "col-subject" },
      { value: values.calculationStage || "", className: "col-calc-stage" },
      { value: item.comment || "", className: "col-comment" },
      ...stageLabels.map((label) => excelStageCell(stagesByLabel.get(label))),
    ];
    return `<tr>${cells
      .map((cell, cellIndex) => {
        const width = columns[cellIndex]?.width || 90;
        const style = `width:${width}px;font-size:11pt;${cell.style || ""}`;
        const bgcolor = cell.bgcolor ? ` bgcolor="${cell.bgcolor}"` : "";
        return `<td class="${cell.className}" width="${width}" style="${style}"${bgcolor}>${excelCell(cell.value)}</td>`;
      })
      .join("")}</tr>`;
  });

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
  <head>
    <meta charset="utf-8">
    <!--[if gte mso 9]>
    <xml>
      <x:ExcelWorkbook>
        <x:ExcelWorksheets>
          <x:ExcelWorksheet>
            <x:Name>Сводка</x:Name>
            <x:WorksheetOptions>
              <x:FitToPage />
              <x:PageSetup>
                <x:Layout x:Orientation="Landscape" />
                <x:PaperSizeIndex>8</x:PaperSizeIndex>
                <x:FitWidth>1</x:FitWidth>
                <x:FitHeight>0</x:FitHeight>
              </x:PageSetup>
            </x:WorksheetOptions>
          </x:ExcelWorksheet>
        </x:ExcelWorksheets>
      </x:ExcelWorkbook>
    </xml>
    <![endif]-->
    <style>
      @page { size: 420mm 297mm; margin: 10mm 8mm; mso-page-orientation: landscape; }
      body { font-family: Arial, sans-serif; color: #222322; font-size: 11pt; }
      table { border-collapse: collapse; width: 100%; font-size: 11pt; }
      th { background: #484643; color: #ffffff; font-size: 11pt; font-weight: 700; text-align: left; white-space: nowrap; mso-wrap-style: none; }
      th, td { border: 1px solid #bfc4c7; padding: 6px 8px; vertical-align: top; mso-number-format: "\\@"; white-space: normal; font-size: 11pt; }
      .col-stage { text-align: center; }
      .stage-done { background: #dcefe7; color: #1f664f; font-weight: 700; }
      .stage-current { background: #fff0d5; color: #7b510f; font-weight: 700; }
      .title { background: #252525; color: #ffffff; font-size: 11pt; font-weight: 700; }
      .meta { background: #eef0f1; color: #676a68; font-weight: 700; }
      .accent { background: #e94141; height: 4px; padding: 0; }
    </style>
  </head>
  <body>
    <table>
      <colgroup>${colgroup}</colgroup>
      <tr><td class="title" colspan="${columns.length}">Сводка по незавершенным VIP-заказам</td></tr>
      <tr><td class="meta" colspan="${columns.length}">Сформировано: ${excelCell(generatedAt)} · ${pluralOrders(items.length)}</td></tr>
      <tr><td class="accent" colspan="${columns.length}"></td></tr>
      <tr>${columns
        .map((column) => `<th class="${column.className}" width="${column.width}" style="width:${column.width}px;font-size:11pt;white-space:nowrap;mso-wrap-style:none;">${excelCell(column.label)}</th>`)
        .join("")}</tr>
      ${rows.join("")}
    </table>
  </body>
</html>`;
}

function downloadExcelSummary() {
  const items = filteredItems().filter((item) => !item.isCompleted);
  if (!items.length) {
    showNotice("Нет незавершенных заказов для сводки.", true);
    return;
  }

  const html = buildExcelHtml(items);
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vip-orders-unfinished-${excelDateStamp()}.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice(`Сводка Excel сформирована: ${pluralOrders(items.length)}.`);
}

function renderOrderDetail(item) {
  const values = item.values || {};
  const columns = state.payload?.columns || [];
  const project = displayText(values.project, "Без проекта");
  const customer = displayText(values.customer);
  const responsible = displayText(values.responsible);
  const subject = displayText(values.subject);
  const calculationStage = displayText(values.calculationStage, "Без стадии");
  const processStage = displayText(item.processStage, "Без стадии процесса");
  const updatedLabel = displayText(item.updatedLabel, "Нет данных");
  const bitrixLink = item.url
    ? `<a class="detail-action detail-action--primary" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Открыть в Bitrix24</a>`
    : "";
  const detailFields = columns
    .map((column) => {
      const value = values[column.id];
      if (column.id === "calculationStage") {
        return renderDetailField(column.label, value, stagePill(calculationStage, item.statusTone));
      }
      return renderDetailField(column.label, value);
    })
    .join("");
  const completedMeta = item.isCompleted
    ? `<div class="detail-meta detail-meta--success">
        <span>Видна до</span>
        <strong>${escapeHtml(formatGeneratedAt(item.completedVisibleUntil))}</strong>
      </div>`
    : "";

  return `<article class="detail-card${item.isCompleted ? " detail-card--completed" : ""}">
    <button class="order-detail__close" type="button" data-detail-close aria-label="Закрыть карточку">×</button>
    <header class="detail-card__hero">
      <span class="detail-card__eyebrow">VIP-заказ</span>
      <h2 id="orderDetailTitle">${escapeHtml(project)}</h2>
      <div class="detail-card__badges">
        ${stagePill(calculationStage, item.statusTone)}
        ${completionBadge(item)}
      </div>
    </header>

    <div class="detail-card__summary">
      <div>
        <span>Заказчик</span>
        <strong>${escapeHtml(customer)}</strong>
      </div>
      <div>
        <span>Ответственный</span>
        <strong>${escapeHtml(responsible)}</strong>
      </div>
      <div>
        <span>Обновлено</span>
        <strong>${escapeHtml(updatedLabel)}</strong>
      </div>
    </div>

    <section class="detail-card__section">
      <h3>Данные заказа</h3>
      <dl class="detail-fields">${detailFields}</dl>
    </section>

    ${renderOrderComment(item.comment)}

    ${renderStageTimeline(item.stageDates || [])}

    <section class="detail-card__section detail-card__section--muted">
      <h3>Статус процесса</h3>
      <div class="detail-meta-grid">
        <div class="detail-meta">
          <span>Стадия</span>
          <strong>${escapeHtml(processStage)}</strong>
        </div>
        <div class="detail-meta">
          <span>Предмет</span>
          <strong>${escapeHtml(subject)}</strong>
        </div>
        ${completedMeta}
      </div>
    </section>

    <footer class="detail-card__actions">
      ${bitrixLink}
      <button class="detail-action" type="button" data-detail-close>Закрыть</button>
    </footer>
  </article>`;
}

function openOrderDetail(item) {
  if (!item) return;
  if (state.filterOpen) closeFilter();

  state.detailOpen = true;
  state.selectedOrderKey = orderKey(item);
  state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.orderDetailContent.innerHTML = renderOrderDetail(item);
  els.orderDetail.hidden = false;
  els.orderDetailBackdrop.hidden = false;
  els.orderDetail.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
  requestAnimationFrame(() => {
    els.orderDetail.classList.add("order-detail--open");
    els.orderDetail.querySelector("[data-detail-close]")?.focus();
  });
}

function closeOrderDetail() {
  state.detailOpen = false;
  state.selectedOrderKey = "";
  els.orderDetail.classList.remove("order-detail--open");
  els.orderDetail.setAttribute("aria-hidden", "true");
  els.orderDetailBackdrop.hidden = true;
  document.body.classList.remove("detail-open");

  setTimeout(() => {
    if (state.detailOpen) return;
    els.orderDetail.hidden = true;
    els.orderDetailContent.innerHTML = "";
    state.previousFocus?.focus?.();
    state.previousFocus = null;
  }, 240);
}

function openOrderFromEvent(event) {
  if (isInteractiveTarget(event.target)) return;
  const row = closestElement(event.target, "[data-order-key]");
  const item = findOrderByKey(row?.dataset.orderKey || "");
  openOrderDetail(item);
}

function openOrderFromKeyboard(event) {
  if (!["Enter", " "].includes(event.key) || isInteractiveTarget(event.target)) return;
  const row = closestElement(event.target, "[data-order-key]");
  if (!row) return;
  event.preventDefault();
  openOrderDetail(findOrderByKey(row.dataset.orderKey || ""));
}

function resetFilters() {
  state.query = "";
  state.responsible = "";
  state.stage = "";
  state.sort = "updated-desc";
  els.searchInput.value = "";
  els.responsibleFilter.value = "";
  els.stageFilter.value = "";
  els.sortSelect.value = state.sort;
  renderAll();
}

function renderFilterButton() {
  const count = activeFilterCount();
  const badge = count ? `<span class="filter-toggle__badge">${count}</span>` : "";
  els.filterToggle.innerHTML = `${state.filterOpen ? "Скрыть параметры" : "Параметры отбора"}${badge}`;
  els.filterToggle.setAttribute("aria-expanded", String(state.filterOpen));
}

function openFilter() {
  state.filterOpen = true;
  els.filterDrawer.hidden = false;
  els.filterDrawer.setAttribute("aria-hidden", "false");
  els.filterBackdrop.hidden = false;
  renderFilterButton();
  requestAnimationFrame(() => els.filterDrawer.classList.add("filter-sheet--open"));
}

function closeFilter() {
  state.filterOpen = false;
  els.filterDrawer.classList.remove("filter-sheet--open");
  els.filterDrawer.setAttribute("aria-hidden", "true");
  els.filterBackdrop.hidden = true;
  renderFilterButton();
  setTimeout(() => {
    if (!state.filterOpen) els.filterDrawer.hidden = true;
  }, 260);
}

function toggleFilter() {
  if (state.filterOpen) {
    closeFilter();
  } else {
    openFilter();
  }
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadOrders({ refresh: true }));
  els.exportExcelButton.addEventListener("click", downloadExcelSummary);
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderRows();
  });
  els.responsibleFilter.addEventListener("change", (event) => {
    state.responsible = event.target.value;
    renderRows();
  });
  els.stageFilter.addEventListener("change", (event) => {
    state.stage = event.target.value;
    renderFilters(state.payload.filters || {});
    renderRows();
  });
  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderRows();
  });
  els.resetButton.addEventListener("click", resetFilters);
  els.filterToggle.addEventListener("click", toggleFilter);
  els.filterClose.addEventListener("click", closeFilter);
  els.filterApply.addEventListener("click", closeFilter);
  els.filterBackdrop.addEventListener("click", closeFilter);
  els.orderDetailBackdrop.addEventListener("click", closeOrderDetail);
  els.orderDetail.addEventListener("click", (event) => {
    if (closestElement(event.target, "[data-detail-close]")) closeOrderDetail();
  });
  els.ordersBody.addEventListener("click", openOrderFromEvent);
  els.ordersBody.addEventListener("keydown", openOrderFromKeyboard);
  els.cards.addEventListener("click", openOrderFromEvent);
  els.cards.addEventListener("keydown", openOrderFromKeyboard);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.detailOpen) {
      closeOrderDetail();
    } else if (state.filterOpen) {
      closeFilter();
    }
  });
  els.stageChips.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-stage]");
    if (!button) return;
    state.stage = button.dataset.stage || "";
    els.stageFilter.value = state.stage;
    renderFilters(state.payload.filters || {});
    renderRows();
  });
}

bindEvents();
loadOrders();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => {});
  });
}
