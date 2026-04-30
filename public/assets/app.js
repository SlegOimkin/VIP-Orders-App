const state = {
  payload: null,
  query: "",
  responsible: "",
  stage: "",
  sort: "updated-desc",
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
  metricTotal: document.querySelector("#metricTotal"),
  metricProjects: document.querySelector("#metricProjects"),
  metricToday: document.querySelector("#metricToday"),
};

const columnIds = ["project", "responsible", "customer", "subject", "calculationStage"];

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

function formatGeneratedAt(value) {
  if (!value) return "нет данных";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
    state.payload = { items: [], stats: {}, filters: { stages: [], responsibles: [] }, generatedAt: new Date().toISOString() };
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
  const stats = payload?.stats || {};

  els.metricTotal.textContent = stats.total ?? 0;
  els.metricProjects.textContent = stats.projects ?? 0;
  els.metricToday.textContent = stats.updatedToday ?? 0;
  els.lastUpdated.textContent = formatGeneratedAt(payload.generatedAt);

  showNotice(payload.warning || (payload.demo ? "Включен демонстрационный режим. Добавьте BITRIX_WEBHOOK_URL для живых данных." : ""));
  renderFilters(payload.filters || { stages: [], responsibles: [] });
  renderRows();
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

  return `<tr>
    <td>${index + 1}</td>
    <td>${projectCell}</td>
    <td>${escapeHtml(values.responsible || "Не указан")}</td>
    <td>${escapeHtml(values.customer || "Не указан")}</td>
    <td>${escapeHtml(values.subject || "Не указан")}</td>
    <td>${stagePill(values.calculationStage, item.statusTone)}</td>
    <td class="muted">${escapeHtml(item.updatedLabel || "")}</td>
  </tr>`;
}

function renderCard(item, index) {
  const values = item.values || {};
  const project = escapeHtml(values.project || "Без проекта");
  const projectTitle = item.url
    ? `<a class="project-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${project}</a>`
    : `<span class="project-link">${project}</span>`;

  return `<article class="order-card">
    <div class="order-card__top">
      <div>
        <span class="order-card__number">№ ${index + 1}</span>
        <div>${projectTitle}</div>
      </div>
      ${stagePill(values.calculationStage, item.statusTone)}
    </div>
    <dl>
      <dt>Ответственный</dt><dd>${escapeHtml(values.responsible || "Не указан")}</dd>
      <dt>Заказчик</dt><dd>${escapeHtml(values.customer || "Не указан")}</dd>
      <dt>Предмет</dt><dd>${escapeHtml(values.subject || "Не указан")}</dd>
      <dt>Обновлено</dt><dd class="muted">${escapeHtml(item.updatedLabel || "")}</dd>
    </dl>
  </article>`;
}

function stagePill(value, tone = "neutral") {
  return `<span class="status-pill status-pill--${escapeHtml(tone || "neutral")}">${escapeHtml(value || "Без стадии")}</span>`;
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
