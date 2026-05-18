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
