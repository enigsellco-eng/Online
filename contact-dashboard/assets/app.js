const API = `${window.ENIGSELL_MARKETING_API}/api/marketing`;

const state = {
  csrfToken: "",
  user: null,
  overview: null,
  currentView: "overview",
  historyTab: "runs",
};

const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const content = document.querySelector("#content");
const toast = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("fa-IR");
}

function formatDate(value) {
  if (!value) return "هنوز ثبت نشده";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status) {
  const labels = {
    running: "در حال اجرا",
    completed: "تکمیل‌شده",
    stopped: "متوقف‌شده",
    failed: "ناموفق",
    idle: "آماده",
    paused: "متوقف",
    unavailable: "در دسترس نیست",
  };
  return labels[status] || "در حال بررسی";
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (state.csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("نشست شما پایان یافته است.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "درخواست ناموفق بود.");
  return data;
}

async function downloadRequest(path, payload) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": state.csrfToken,
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("نشست شما پایان یافته است.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "ساخت فایل خروجی ناموفق بود.");
  }
  return response.blob();
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 4200);
}

function showLogin() {
  state.user = null;
  state.csrfToken = "";
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  document.querySelector("#user-name").textContent =
    state.user.display_name || "مدیر مارکتینگ";
  document.querySelector("#user-email").textContent = state.user.email;
  document.querySelector("#user-avatar").textContent = (
    state.user.display_name ||
    state.user.email ||
    "م"
  ).trim()[0];
}

function setHeader(eyebrow, title, subtitle) {
  const eyebrowElement = document.querySelector("#page-eyebrow");
  eyebrowElement.textContent = eyebrow || "";
  eyebrowElement.classList.toggle("hidden", !eyebrow);
  document.querySelector("#page-title").textContent = title;
  const subtitleElement = document.querySelector("#page-subtitle");
  subtitleElement.textContent = subtitle || "";
  subtitleElement.classList.toggle("hidden", !subtitle);
}

function sourceCard(source) {
  const disabled = !source.configuration_enabled;
  return `
    <article class="source-card">
      <div class="source-card-head">
        <span class="source-badge ${source.key}">${escapeHtml(source.name[0])}</span>
        <h3>${escapeHtml(source.name)}</h3>
        <span class="availability ${source.available ? "" : "off"}">
          ${source.available ? "متصل" : "قطع"}
        </span>
      </div>
      <div class="source-number">${formatNumber(source.contacts)}</div>
      <div class="source-meta">کانتکت یونیک ثبت‌شده</div>
      <div class="source-card-footer">
        <span>${formatNumber(source.records)} رکورد استخراج‌شده</span>
        <span class="status-pill ${source.available ? "" : "muted"}">
          ${disabled ? "غیرفعال" : statusLabel(source.status)}
        </span>
      </div>
    </article>
  `;
}

async function renderOverview() {
  setHeader(
    "",
    "نمای کلی",
    "",
  );
  content.innerHTML = `<div class="loading">در حال دریافت آمار…</div>`;
  try {
    state.overview = await request("/overview");
    const sources = state.overview.sources;
    const available = sources.filter((source) => source.available).length;
    const running = sources.filter((source) => source.status === "running").length;
    content.innerHTML = `
      <section class="metrics-grid">
        <article class="metric">
          <span>کانتکت‌های یونیک</span>
          <strong>${formatNumber(state.overview.total_contacts)}</strong>
        </article>
        <article class="metric">
          <span>اتصال‌های فعال</span>
          <strong>${formatNumber(available)}</strong>
          <small>از ${formatNumber(sources.length)} منبع</small>
        </article>
        <article class="metric">
          <span>در حال اجرا</span>
          <strong>${formatNumber(running)}</strong>
        </article>
        <article class="metric">
          <span>آخرین به‌روزرسانی</span>
          <strong style="font-size:18px">${formatDate(state.overview.updated_at)}</strong>
        </article>
      </section>
      <section class="source-grid">
        ${sources.map(sourceCard).join("")}
      </section>
    `;
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function historyItem(item, type) {
  if (type === "runs") {
    return `
      <article class="history-item">
        <div class="history-item-head">
          <strong>${statusLabel(item.status)}</strong>
          <time>${formatDate(item.started_at || item.created_at)}</time>
        </div>
        <p>
          پردازش‌شده: ${formatNumber(item.processed_count)} ·
          ذخیره‌شده: ${formatNumber(item.saved_count)} ·
          خطا: ${formatNumber(item.error_count)}
        </p>
      </article>
    `;
  }
  return `
    <article class="history-item">
      <div class="history-item-head">
        <strong>${escapeHtml(item.query || "بدون Keyword")}</strong>
        <time>${formatDate(item.archived_at || item.updated_at)}</time>
      </div>
      <p>شهر: ${escapeHtml(item.city || "—")}</p>
    </article>
  `;
}

async function loadHistory(sourceKey, type) {
  const holder = document.querySelector("#history-list");
  if (!holder) return;
  holder.innerHTML = `<div class="loading">در حال دریافت تاریخچه…</div>`;
  try {
    const data = await request(
      `/sources/${sourceKey}/${type === "runs" ? "runs" : "settings-history"}`,
    );
    holder.innerHTML = data.items.length
      ? data.items.map((item) => historyItem(item, type)).join("")
      : `<div class="empty">تاریخچه‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function renderBehtarino() {
  setHeader(
    "",
    "بهترینو",
    "",
  );
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات بهترینو…</div>`;
  try {
    const source = await request("/sources/behtarino");
    const input = source.input || { keyword: "", city: "" };
    content.innerHTML = `
      <div class="behtarino-layout">
      <div class="two-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>ورودی‌های استخراج</h2>
            </div>
            <span class="status-pill">${statusLabel(source.status)}</span>
          </div>
          <form id="behtarino-form">
            <div class="form-grid">
              <label>
                Keyword
                <input id="behtarino-keyword" value="${escapeHtml(input.keyword)}"
                  minlength="2" maxlength="120" required />
              </label>
              <label>
                شهر
                <input id="behtarino-city" value="${escapeHtml(input.city)}"
                  minlength="2" maxlength="80" required />
              </label>
            </div>
            <div class="form-actions">
              <button class="button primary" type="submit">ذخیره ورودی‌ها</button>
              <p class="form-hint">
                آخرین تغییر: ${formatDate(input.updated_at)}
              </p>
            </div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>تاریخچه</h2>
            </div>
          </div>
          <div class="tabs">
            <button class="tab-button active" data-history="runs">اجراها</button>
            <button class="tab-button" data-history="settings">تغییر ورودی‌ها</button>
          </div>
          <div id="history-list" class="history-list"></div>
        </section>
      </div>
      <section class="panel export-panel">
        <div class="panel-header">
          <div>
            <h2>خروجی Excel تیم</h2>
            <p>شماره کانتکت دائمی است؛ دانلود آزمایشی وضعیت تحویل را تغییر نمی‌دهد.</p>
          </div>
          <span id="export-new-badge" class="status-pill">در حال بررسی…</span>
        </div>
        <div id="export-metrics" class="export-metrics">
          <div><span>آخرین کانتکت</span><strong>—</strong></div>
          <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
          <div><span>شروع پیشنهادی</span><strong>—</strong></div>
          <div><span>کانتکت جدید</span><strong>—</strong></div>
        </div>
        <div class="export-grid">
          <div class="export-controls">
            <div class="form-grid">
              <label>
                Keyword خروجی
                <input id="export-keyword" value="${escapeHtml(input.keyword)}"
                  minlength="2" maxlength="120" required />
              </label>
              <label>
                شهر خروجی
                <input id="export-city" value="${escapeHtml(input.city)}"
                  minlength="2" maxlength="80" required />
              </label>
              <label>
                از شماره
                <input id="export-from" type="number" min="1" value="1" />
              </label>
              <label>
                تا شماره
                <input id="export-to" type="number" min="1" value="1" />
              </label>
            </div>
            <div class="form-actions export-actions">
              <button id="apply-export-filter" class="button secondary" type="button">
                اعمال فیلتر
              </button>
              <button id="preview-export" class="button secondary" type="button">
                دانلود آزمایشی
              </button>
              <button id="confirm-export" class="button primary" type="button">
                دانلود و ثبت تحویل
              </button>
            </div>
          </div>
          <div>
            <h3 class="export-history-title">تاریخچه تحویل</h3>
            <div id="export-history" class="history-list compact">
              <div class="loading">در حال دریافت تاریخچه…</div>
            </div>
          </div>
        </div>
      </section>
      </div>
    `;
    document
      .querySelector("#behtarino-form")
      .addEventListener("submit", saveBehtarino);
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document
          .querySelectorAll("[data-history]")
          .forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        loadHistory("behtarino", button.dataset.history);
      });
    });
    loadHistory("behtarino", "runs");
    document
      .querySelector("#apply-export-filter")
      .addEventListener("click", loadBehtarinoExport);
    document
      .querySelector("#preview-export")
      .addEventListener("click", () => downloadBehtarinoExport(false));
    document
      .querySelector("#confirm-export")
      .addEventListener("click", () => downloadBehtarinoExport(true));
    loadBehtarinoExport();
    loadBehtarinoExportHistory();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadBehtarinoExport() {
  const keyword = document.querySelector("#export-keyword").value.trim();
  const city = document.querySelector("#export-city").value.trim();
  if (keyword.length < 2 || city.length < 2) {
    showToast("Keyword و شهر خروجی را کامل وارد کنید.", true);
    return;
  }
  const metrics = document.querySelector("#export-metrics");
  const badge = document.querySelector("#export-new-badge");
  try {
    const params = new URLSearchParams({ keyword, city });
    const summary = await request(
      `/sources/behtarino/exports/summary?${params.toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    metrics.querySelectorAll("strong").forEach((element, index) => {
      element.textContent = formatNumber(values[index]);
    });
    badge.textContent = `${formatNumber(summary.new_count)} جدید`;
    document.querySelector("#export-from").value =
      summary.suggested_from_contact_no;
    document.querySelector("#export-to").value = summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadBehtarinoExportHistory() {
  const holder = document.querySelector("#export-history");
  if (!holder) return;
  try {
    const data = await request("/sources/behtarino/exports/history");
    holder.innerHTML = data.items.length
      ? data.items
          .map(
            (item) => `
              <article class="history-item">
                <div class="history-item-head">
                  <strong>#${formatNumber(item.from_contact_no)} تا #${formatNumber(item.to_contact_no)}</strong>
                  <time>${formatDate(item.created_at)}</time>
                </div>
                <p>${formatNumber(item.row_count)} کانتکت تحویل‌شده</p>
              </article>`,
          )
          .join("")
      : `<div class="empty">هنوز خروجی تحویل‌شده‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function downloadBehtarinoExport(confirmDelivery) {
  const payload = {
    keyword: document.querySelector("#export-keyword").value.trim(),
    city: document.querySelector("#export-city").value.trim(),
    from_contact_no: Number(document.querySelector("#export-from").value),
    to_contact_no: Number(document.querySelector("#export-to").value),
    confirm_delivery: confirmDelivery,
  };
  if (
    payload.keyword.length < 2 ||
    payload.city.length < 2 ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast("فیلتر یا بازه خروجی معتبر نیست.", true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest(
      "/sources/behtarino/exports/xlsx",
      payload,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `behtarino-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(
      confirmDelivery
        ? "فایل دانلود و بازه به‌عنوان تحویل‌شده ثبت شد."
        : "فایل آزمایشی دانلود شد؛ وضعیت تحویل تغییر نکرد.",
    );
    if (confirmDelivery) {
      await loadBehtarinoExport();
      await loadBehtarinoExportHistory();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function saveBehtarino(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request("/sources/behtarino/input", {
      method: "PUT",
      body: JSON.stringify({
        keyword: document.querySelector("#behtarino-keyword").value,
        city: document.querySelector("#behtarino-city").value,
      }),
    });
    showToast("Keyword و شهر بهترینو با موفقیت ذخیره شدند.");
    event.currentTarget.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderLocked(sourceKey) {
  const isTorob = sourceKey === "torob";
  setHeader(
    "",
    isTorob ? "ترب" : "دیوار",
    "",
  );
  content.innerHTML = `
    <section class="panel locked-panel">
      <div class="locked-content">
        <div class="lock-icon">◇</div>
        <h2>${isTorob ? "Keyword ترب فعلاً غیرفعال است" : "ورودی‌های دیوار هنوز تعریف نشده‌اند"}</h2>
        <p class="muted">
          ${
            isTorob
              ? "ویرایش Keyword در فاز بعدی فعال می‌شود."
              : "فرم ورودی پس از نهایی‌شدن پارامترهای مارکتینگ اضافه می‌شود."
          }
        </p>
        ${
          isTorob
            ? `<div class="disabled-preview">
                <label>Keyword<input value="" placeholder="به‌زودی" disabled /></label>
                <button class="button primary" disabled>ذخیره Keyword</button>
              </div>`
            : ""
        }
      </div>
    </section>
  `;
}

async function switchView(view) {
  state.currentView = view;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  if (view === "overview") return renderOverview();
  if (view === "behtarino") return renderBehtarino();
  renderLocked(view);
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorHolder = document.querySelector("#login-error");
  const button = event.currentTarget.querySelector("button");
  errorHolder.textContent = "";
  button.disabled = true;
  try {
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#email").value,
        password: document.querySelector("#password").value,
      }),
    });
    state.user = data.user;
    state.csrfToken = data.csrf_token;
    showApp();
    switchView("overview");
  } catch (error) {
    errorHolder.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document
  .querySelector("#refresh-button")
  .addEventListener("click", () => switchView(state.currentView));

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/auth/logout", { method: "POST" });
  } catch {
    // The local session is cleared even if the server is unavailable.
  }
  showLogin();
});

(async function bootstrap() {
  try {
    const data = await request("/auth/me");
    state.user = data.user;
    state.csrfToken = data.csrf_token;
    showApp();
    switchView("overview");
  } catch {
    showLogin();
  }
})();
