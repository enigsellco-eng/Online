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
  if (Number(value) === 0) return "0";
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
    cache: "no-store",
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

async function downloadAllContacts(sourceKey) {
  const button = document.querySelector(`#download-all-${sourceKey}`);
  if (button) button.disabled = true;
  try {
    const blob = await downloadRequest(
      `/sources/${sourceKey}/exports/all/xlsx`,
      {},
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sourceKey}-all-contacts.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("خروجی کل دیتابیس دانلود شد.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
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

function historyItem(item, type, sourceKey = "") {
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
  let settings = {};
  try {
    settings = JSON.parse(item.settings_json || "{}");
  } catch {
    settings = {};
  }
  const category = item.category || settings.category_slug || "";
  const subcategory = item.subcategory || "";
  const versionLabel = item.is_current ? "فعلی" : "قبلی";
  const title = sourceKey === "senfyab"
    ? item.name || "تنظیمات صنفیاب"
    : sourceKey === "foodkeys"
      ? item.query || "دسته‌بندی فودکیز"
      : item.query || "بدون Keyword";
  const details = sourceKey === "senfyab"
    ? [
        category ? `دسته‌بندی: ${escapeHtml(category)}` : "",
        subcategory ? `زیردسته: ${escapeHtml(subcategory)}` : "",
      ].filter(Boolean).join(" · ")
    : sourceKey === "foodkeys"
      ? `دسته‌بندی: ${escapeHtml(item.query || "—")}`
      : `
        شهر: ${escapeHtml(item.city || "—")}
        ${category ? ` · دسته‌بندی: ${escapeHtml(category)}` : ""}
        ${subcategory ? ` · زیردسته: ${escapeHtml(subcategory)}` : ""}
      `;
  return `
    <article class="history-item">
      <div class="history-item-head">
        <strong>
          ${escapeHtml(title)}
          <span class="history-version ${item.is_current ? "current" : ""}">
            ${versionLabel}
          </span>
        </strong>
        <time>${formatDate(
          item.archived_at || item.updated_at || item.active_from,
        )}</time>
      </div>
      <p>${details}</p>
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
      ? data.items.map((item) => historyItem(item, type, sourceKey)).join("")
      : `<div class="empty">تاریخچه‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function renderDirectorySource(sourceKey, displayName) {
  setHeader(
    "",
    displayName,
    "",
  );
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات ${escapeHtml(displayName)}…</div>`;
  try {
    const source = await request(`/sources/${sourceKey}`);
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
          <form id="directory-source-form">
            <div class="form-grid">
              <label>
                Keyword
                <input id="directory-source-keyword" value="${escapeHtml(input.keyword)}"
                  minlength="2" maxlength="120" required />
              </label>
              <label>
                شهر
                <input id="directory-source-city" value="${escapeHtml(input.city)}"
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
            <button class="tab-button" data-history="runs">اجراها</button>
            <button class="tab-button active" data-history="settings">تغییر ورودی‌ها</button>
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
              <button id="download-all-${sourceKey}" class="button secondary" type="button">
                دانلود کل دیتابیس
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
      .querySelector("#directory-source-form")
      .addEventListener("submit", (event) =>
        saveDirectorySource(event, sourceKey, displayName));
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document
          .querySelectorAll("[data-history]")
          .forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        loadHistory(sourceKey, button.dataset.history);
      });
    });
    loadHistory(sourceKey, "settings");
    document
      .querySelector("#apply-export-filter")
      .addEventListener("click", () => loadDirectoryExport(sourceKey));
    document
      .querySelector("#preview-export")
      .addEventListener("click", () =>
        downloadDirectoryExport(sourceKey, displayName, false));
    document
      .querySelector("#confirm-export")
      .addEventListener("click", () =>
        downloadDirectoryExport(sourceKey, displayName, true));
    document
      .querySelector(`#download-all-${sourceKey}`)
      .addEventListener("click", () => downloadAllContacts(sourceKey));
    loadDirectoryExport(sourceKey);
    loadDirectoryExportHistory(sourceKey);
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadDirectoryExport(sourceKey) {
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
      `/sources/${sourceKey}/exports/summary?${params.toString()}`,
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

async function loadDirectoryExportHistory(sourceKey) {
  const holder = document.querySelector("#export-history");
  if (!holder) return;
  try {
    const data = await request(`/sources/${sourceKey}/exports/history`);
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

async function downloadDirectoryExport(sourceKey, displayName, confirmDelivery) {
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
      `/sources/${sourceKey}/exports/xlsx`,
      payload,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `${sourceKey}-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
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
      await loadDirectoryExport(sourceKey);
      await loadDirectoryExportHistory(sourceKey);
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function saveDirectorySource(event, sourceKey, displayName) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request(`/sources/${sourceKey}/input`, {
      method: "PUT",
      body: JSON.stringify({
        keyword: document.querySelector("#directory-source-keyword").value,
        city: document.querySelector("#directory-source-city").value,
      }),
    });
    showToast(`Keyword و شهر ${displayName} با موفقیت ذخیره شدند.`);
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function renderBehtarino() {
  return renderDirectorySource("behtarino", "بهترینو");
}

async function renderAvval() {
  return renderDirectorySource("avval", "کتاب اول");
}

async function renderTakhfifan() {
  setHeader("", "تخفیفان", "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات تخفیفان…</div>`;
  try {
    const source = await request("/sources/takhfifan");
    const input = source.input || {
      keyword: "",
      city: "",
      category: "",
    };
    content.innerHTML = `
      <div class="behtarino-layout">
      <div class="two-column">
        <section class="panel">
          <div class="panel-header">
            <div><h2>ورودی‌های استخراج</h2></div>
            <span class="status-pill">${statusLabel(source.status)}</span>
          </div>
          <form id="takhfifan-form">
            <div class="form-grid">
              <label>
                Keyword
                <input id="takhfifan-keyword" value="${escapeHtml(input.keyword)}"
                  minlength="2" maxlength="120" required />
              </label>
              <label>
                شهر
                <input id="takhfifan-city" value="${escapeHtml(input.city)}"
                  minlength="2" maxlength="80" required />
              </label>
              <label>
                دسته‌بندی
                <input id="takhfifan-category" value="${escapeHtml(input.category)}"
                  minlength="2" maxlength="120" required />
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
            <div><h2>تاریخچه</h2></div>
          </div>
          <div class="tabs">
            <button class="tab-button" data-history="runs">اجراها</button>
            <button class="tab-button active" data-history="settings">تغییر ورودی‌ها</button>
          </div>
          <div id="history-list" class="history-list"></div>
        </section>
      </div>
      <section class="panel export-panel">
        <div class="panel-header">
          <div>
            <h2>خروجی Excel مستقل تخفیفان</h2>
            <p>شماره کانتکت دائمی است و خروجی تخفیفان هیچ داده مشترکی با سایر منابع ندارد.</p>
          </div>
          <span id="takhfifan-export-new-badge" class="status-pill">در حال بررسی…</span>
        </div>
        <div id="takhfifan-export-metrics" class="export-metrics">
          <div><span>آخرین کانتکت</span><strong>—</strong></div>
          <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
          <div><span>شروع پیشنهادی</span><strong>—</strong></div>
          <div><span>کانتکت جدید</span><strong>—</strong></div>
        </div>
        <div class="export-grid">
          <div class="export-controls">
            <div class="form-grid">
              ${takhfifanFields("takhfifan-export", input)}
              <label>از شماره<input id="takhfifan-export-from" type="number" min="1" value="1" /></label>
              <label>تا شماره<input id="takhfifan-export-to" type="number" min="1" value="1" /></label>
            </div>
            <div class="form-actions export-actions">
              <button id="apply-takhfifan-export-filter" class="button secondary" type="button">اعمال فیلتر</button>
              <button id="preview-takhfifan-export" class="button secondary" type="button">دانلود آزمایشی</button>
              <button id="confirm-takhfifan-export" class="button primary" type="button">دانلود و ثبت تحویل</button>
              <button id="download-all-takhfifan" class="button secondary" type="button">دانلود کل دیتابیس</button>
            </div>
          </div>
          <div>
            <h3 class="export-history-title">تاریخچه تحویل تخفیفان</h3>
            <div id="takhfifan-export-history" class="history-list compact">
              <div class="loading">در حال دریافت تاریخچه…</div>
            </div>
          </div>
        </div>
      </section>
      </div>
    `;
    document
      .querySelector("#takhfifan-form")
      .addEventListener("submit", saveTakhfifan);
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document
          .querySelectorAll("[data-history]")
          .forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        loadHistory("takhfifan", button.dataset.history);
      });
    });
    loadHistory("takhfifan", "settings");
    document.querySelector("#apply-takhfifan-export-filter")
      .addEventListener("click", loadTakhfifanExport);
    document.querySelector("#preview-takhfifan-export")
      .addEventListener("click", () => downloadTakhfifanExport(false));
    document.querySelector("#confirm-takhfifan-export")
      .addEventListener("click", () => downloadTakhfifanExport(true));
    document.querySelector("#download-all-takhfifan")
      .addEventListener("click", () => downloadAllContacts("takhfifan"));
    loadTakhfifanExport();
    loadTakhfifanExportHistory();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function saveTakhfifan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request("/sources/takhfifan/input", {
      method: "PUT",
      body: JSON.stringify({
        keyword: document.querySelector("#takhfifan-keyword").value,
        city: document.querySelector("#takhfifan-city").value,
        category: document.querySelector("#takhfifan-category").value,
      }),
    });
    showToast("ورودی‌های تخفیفان با موفقیت ذخیره شدند.");
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    const saved = data.input || takhfifanValues("takhfifan");
    ["keyword", "city", "category"].forEach((field) => {
      const exportInput = document.querySelector(`#takhfifan-export-${field}`);
      if (exportInput) exportInput.value = saved[field] || "";
    });
    await loadTakhfifanExport();
    loadHistory("takhfifan", "settings");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function takhfifanFields(prefix, input) {
  return `
    <label>Keyword<input id="${prefix}-keyword" value="${escapeHtml(input.keyword)}" minlength="2" maxlength="120" required /></label>
    <label>شهر<input id="${prefix}-city" value="${escapeHtml(input.city)}" minlength="2" maxlength="80" required /></label>
    <label>دسته‌بندی<input id="${prefix}-category" value="${escapeHtml(input.category)}" minlength="2" maxlength="120" required /></label>`;
}

function takhfifanValues(prefix) {
  return {
    keyword: document.querySelector(`#${prefix}-keyword`).value.trim(),
    city: document.querySelector(`#${prefix}-city`).value.trim(),
    category: document.querySelector(`#${prefix}-category`).value.trim(),
  };
}

async function loadTakhfifanExport() {
  const filters = takhfifanValues("takhfifan-export");
  if (Object.values(filters).some((value) => value.length < 2)) {
    showToast("فیلترهای خروجی تخفیفان را کامل وارد کنید.", true);
    return;
  }
  try {
    const summary = await request(
      `/sources/takhfifan/exports/summary?${new URLSearchParams(filters).toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll("#takhfifan-export-metrics strong")
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector("#takhfifan-export-new-badge").textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector("#takhfifan-export-from").value =
      summary.suggested_from_contact_no;
    document.querySelector("#takhfifan-export-to").value =
      summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadTakhfifanExportHistory() {
  const holder = document.querySelector("#takhfifan-export-history");
  try {
    const data = await request("/sources/takhfifan/exports/history");
    holder.innerHTML = data.items.length
      ? data.items.map((item) => `
          <article class="history-item">
            <div class="history-item-head">
              <strong>#${formatNumber(item.from_contact_no)} تا #${formatNumber(item.to_contact_no)}</strong>
              <time>${formatDate(item.created_at)}</time>
            </div>
            <p>${formatNumber(item.row_count)} کانتکت تحویل‌شده</p>
          </article>`).join("")
      : `<div class="empty">هنوز خروجی تحویل‌شده‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function downloadTakhfifanExport(confirmDelivery) {
  const filters = takhfifanValues("takhfifan-export");
  const payload = {
    ...filters,
    from_contact_no: Number(
      document.querySelector("#takhfifan-export-from").value,
    ),
    to_contact_no: Number(
      document.querySelector("#takhfifan-export-to").value,
    ),
    confirm_delivery: confirmDelivery,
  };
  if (
    Object.values(filters).some((value) => value.length < 2) ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast("فیلتر یا بازه خروجی تخفیفان معتبر نیست.", true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest(
      "/sources/takhfifan/exports/xlsx",
      payload,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `takhfifan-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? "فایل تخفیفان دانلود و بازه به‌عنوان تحویل‌شده ثبت شد."
      : "فایل آزمایشی تخفیفان دانلود شد؛ وضعیت تحویل تغییر نکرد.");
    if (confirmDelivery) {
      await loadTakhfifanExport();
      await loadTakhfifanExportHistory();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function renderSenfyab() {
  setHeader("", "صنفیاب", "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات صنفیاب…</div>`;
  try {
    const source = await request("/sources/senfyab");
    const input = source.input || { name: "", category: "", subcategory: "" };
    content.innerHTML = `
      <div class="behtarino-layout">
        <div class="two-column">
          <section class="panel">
            <div class="panel-header">
              <div><h2>ورودی‌های استخراج</h2></div>
              <span class="status-pill">${statusLabel(source.status)}</span>
            </div>
            <form id="senfyab-form">
              <div class="form-grid">
                <label>
                  نام جستجو
                  <input id="senfyab-name"
                    value="${escapeHtml(input.name || "")}"
                    minlength="1" maxlength="200" required />
                </label>
                <label>
                  دسته‌بندی
                  <input id="senfyab-category"
                    value="${escapeHtml(input.category)}"
                    minlength="2" maxlength="120" required />
                </label>
                <label>
                  زیردسته
                  <input id="senfyab-subcategory"
                    value="${escapeHtml(input.subcategory)}"
                    minlength="2" maxlength="160" required />
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
            <div class="panel-header"><div><h2>تاریخچه</h2></div></div>
            <div class="tabs">
              <button class="tab-button" data-history="runs">اجراها</button>
              <button class="tab-button active" data-history="settings">
                تغییر ورودی‌ها
              </button>
            </div>
            <div id="history-list" class="history-list"></div>
          </section>
        </div>
        <section class="panel export-panel">
          <div class="panel-header">
            <div><h2>خروجی Excel مستقل صنفیاب</h2></div>
            <span id="senfyab-export-new-badge" class="status-pill">در حال بررسی…</span>
          </div>
          <div id="senfyab-export-metrics" class="export-metrics">
            <div><span>آخرین کانتکت</span><strong>—</strong></div>
            <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
            <div><span>شروع پیشنهادی</span><strong>—</strong></div>
            <div><span>کانتکت جدید</span><strong>—</strong></div>
          </div>
          <div class="export-grid">
            <div class="export-controls">
              <div class="form-grid">
                ${senfyabFields("senfyab-export", input)}
                <label>از شماره<input id="senfyab-export-from" type="number" min="1" value="1" /></label>
                <label>تا شماره<input id="senfyab-export-to" type="number" min="1" value="1" /></label>
              </div>
              <div class="form-actions export-actions">
                <button id="apply-senfyab-export-filter" class="button secondary" type="button">اعمال فیلتر</button>
                <button id="preview-senfyab-export" class="button secondary" type="button">دانلود آزمایشی</button>
                <button id="confirm-senfyab-export" class="button primary" type="button">دانلود و ثبت تحویل</button>
                <button id="download-all-senfyab" class="button secondary" type="button">دانلود کل دیتابیس</button>
              </div>
            </div>
            <div>
              <h3 class="export-history-title">تاریخچه تحویل صنفیاب</h3>
              <div id="senfyab-export-history" class="history-list compact">
                <div class="loading">در حال دریافت تاریخچه…</div>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document
      .querySelector("#senfyab-form")
      .addEventListener("submit", saveSenfyab);
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-history]").forEach((item) =>
          item.classList.remove("active"));
        button.classList.add("active");
        loadHistory("senfyab", button.dataset.history);
      });
    });
    loadHistory("senfyab", "settings");
    document.querySelector("#apply-senfyab-export-filter")
      .addEventListener("click", loadSenfyabExport);
    document.querySelector("#preview-senfyab-export")
      .addEventListener("click", () => downloadSenfyabExport(false));
    document.querySelector("#confirm-senfyab-export")
      .addEventListener("click", () => downloadSenfyabExport(true));
    document.querySelector("#download-all-senfyab")
      .addEventListener("click", () => downloadAllContacts("senfyab"));
    loadSenfyabExport();
    loadSenfyabExportHistory();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function saveSenfyab(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request("/sources/senfyab/input", {
      method: "PUT",
      body: JSON.stringify({
        name: document.querySelector("#senfyab-name").value.trim(),
        category: document.querySelector("#senfyab-category").value.trim(),
        subcategory: document
          .querySelector("#senfyab-subcategory").value.trim(),
      }),
    });
    showToast("ورودی‌های صنفیاب با موفقیت ذخیره شدند.");
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    const saved = data.input || senfyabValues("senfyab");
    ["name", "category", "subcategory"].forEach((field) => {
      const exportInput = document.querySelector(`#senfyab-export-${field}`);
      if (exportInput) exportInput.value = saved[field] || "";
    });
    await loadSenfyabExport();
    await loadHistory("senfyab", "settings");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function renderFoodkeys() {
  setHeader("", "فودکیز", "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات فودکیز…</div>`;
  try {
    const source = await request("/sources/foodkeys");
    const category = source.input?.keyword || "wholesale_trade";
    content.innerHTML = `
      <div class="behtarino-layout">
        <div class="two-column">
          <section class="panel">
            <div class="panel-header">
              <div><h2>ورودی استخراج</h2></div>
              <span class="status-pill">${statusLabel(source.status)}</span>
            </div>
            <form id="foodkeys-form">
              <div class="form-grid">
                <label>
                  دسته‌بندی
                  <input id="foodkeys-category" value="${escapeHtml(category)}"
                    minlength="1" maxlength="120"
                    pattern="[A-Za-z0-9_-]+" required />
                </label>
              </div>
              <div class="form-actions">
                <button class="button primary" type="submit">ذخیره ورودی</button>
                <p class="form-hint">
                  آخرین تغییر: ${formatDate(source.input?.updated_at)}
                </p>
              </div>
            </form>
          </section>
          <section class="panel">
            <div class="panel-header"><div><h2>تاریخچه</h2></div></div>
            <div class="tabs">
              <button class="tab-button" data-history="runs">اجراها</button>
              <button class="tab-button active" data-history="settings">
                تغییر ورودی‌ها
              </button>
            </div>
            <div id="history-list" class="history-list"></div>
          </section>
        </div>
        <section class="panel export-panel">
          <div class="panel-header">
            <div><h2>خروجی Excel مستقل فودکیز</h2></div>
            <span id="foodkeys-export-new-badge" class="status-pill">
              در حال بررسی…
            </span>
          </div>
          <div id="foodkeys-export-metrics" class="export-metrics">
            <div><span>آخرین کانتکت</span><strong>—</strong></div>
            <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
            <div><span>شروع پیشنهادی</span><strong>—</strong></div>
            <div><span>کانتکت جدید</span><strong>—</strong></div>
          </div>
          <div class="export-grid">
            <div class="export-controls">
              <div class="form-grid">
                <label>
                  دسته‌بندی خروجی
                  <input id="foodkeys-export-category"
                    value="${escapeHtml(category)}"
                    pattern="[A-Za-z0-9_-]+" required />
                </label>
                <label>از شماره<input id="foodkeys-export-from"
                  type="number" min="1" value="1" /></label>
                <label>تا شماره<input id="foodkeys-export-to"
                  type="number" min="1" value="1" /></label>
              </div>
              <div class="form-actions export-actions">
                <button id="apply-foodkeys-export-filter"
                  class="button secondary" type="button">اعمال فیلتر</button>
                <button id="preview-foodkeys-export"
                  class="button secondary" type="button">دانلود آزمایشی</button>
                <button id="confirm-foodkeys-export"
                  class="button primary" type="button">دانلود و ثبت تحویل</button>
                <button id="download-all-foodkeys"
                  class="button secondary" type="button">دانلود کل دیتابیس</button>
              </div>
            </div>
            <div>
              <h3 class="export-history-title">تاریخچه تحویل فودکیز</h3>
              <div id="foodkeys-export-history" class="history-list compact">
                <div class="loading">در حال دریافت تاریخچه…</div>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document.querySelector("#foodkeys-form")
      .addEventListener("submit", saveFoodkeys);
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-history]").forEach((item) =>
          item.classList.remove("active"));
        button.classList.add("active");
        loadHistory("foodkeys", button.dataset.history);
      });
    });
    document.querySelector("#apply-foodkeys-export-filter")
      .addEventListener("click", loadFoodkeysExport);
    document.querySelector("#preview-foodkeys-export")
      .addEventListener("click", () => downloadFoodkeysExport(false));
    document.querySelector("#confirm-foodkeys-export")
      .addEventListener("click", () => downloadFoodkeysExport(true));
    document.querySelector("#download-all-foodkeys")
      .addEventListener("click", () => downloadAllContacts("foodkeys"));
    loadHistory("foodkeys", "settings");
    loadFoodkeysExport();
    loadFoodkeysExportHistory();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function saveFoodkeys(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const category = document.querySelector("#foodkeys-category").value.trim();
  button.disabled = true;
  try {
    const data = await request("/sources/foodkeys/input", {
      method: "PUT",
      body: JSON.stringify({ category }),
    });
    showToast("دسته‌بندی فودکیز با موفقیت ذخیره شد.");
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    document.querySelector("#foodkeys-export-category").value =
      data.input.category;
    await loadHistory("foodkeys", "settings");
    await loadFoodkeysExport();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadFoodkeysExport() {
  const category =
    document.querySelector("#foodkeys-export-category").value.trim();
  if (!category) return;
  try {
    const summary = await request(
      `/sources/foodkeys/exports/summary?${new URLSearchParams({ category })}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll("#foodkeys-export-metrics strong")
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector("#foodkeys-export-new-badge").textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector("#foodkeys-export-from").value =
      summary.suggested_from_contact_no;
    document.querySelector("#foodkeys-export-to").value =
      summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadFoodkeysExportHistory() {
  const holder = document.querySelector("#foodkeys-export-history");
  try {
    const data = await request("/sources/foodkeys/exports/history");
    holder.innerHTML = data.items.length
      ? data.items.map((item) => `
          <article class="history-item">
            <div class="history-item-head">
              <strong>#${formatNumber(item.from_contact_no)}
                تا #${formatNumber(item.to_contact_no)}</strong>
              <time>${formatDate(item.created_at)}</time>
            </div>
            <p>${formatNumber(item.row_count)} کانتکت تحویل‌شده</p>
          </article>`).join("")
      : `<div class="empty">هنوز خروجی تحویل‌شده‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function downloadFoodkeysExport(confirmDelivery) {
  const payload = {
    category: document
      .querySelector("#foodkeys-export-category").value.trim(),
    from_contact_no: Number(
      document.querySelector("#foodkeys-export-from").value,
    ),
    to_contact_no: Number(
      document.querySelector("#foodkeys-export-to").value,
    ),
    confirm_delivery: confirmDelivery,
  };
  if (
    !payload.category ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast("فیلتر یا بازه خروجی فودکیز معتبر نیست.", true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest(
      "/sources/foodkeys/exports/xlsx",
      payload,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `foodkeys-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? "فایل فودکیز دانلود و بازه به‌عنوان تحویل‌شده ثبت شد."
      : "فایل آزمایشی فودکیز دانلود شد؛ وضعیت تحویل تغییر نکرد.");
    if (confirmDelivery) {
      await loadFoodkeysExport();
      await loadFoodkeysExportHistory();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

function senfyabFields(prefix, input) {
  return `
    <label>نام جستجو<input id="${prefix}-name" value="${escapeHtml(input.name)}" minlength="1" maxlength="200" required /></label>
    <label>دسته‌بندی<input id="${prefix}-category" value="${escapeHtml(input.category)}" minlength="1" maxlength="120" required /></label>
    <label>زیردسته<input id="${prefix}-subcategory" value="${escapeHtml(input.subcategory)}" minlength="1" maxlength="160" required /></label>`;
}

function senfyabValues(prefix) {
  return {
    name: document.querySelector(`#${prefix}-name`).value.trim(),
    category: document.querySelector(`#${prefix}-category`).value.trim(),
    subcategory: document.querySelector(`#${prefix}-subcategory`).value.trim(),
  };
}

async function loadSenfyabExport() {
  const filters = senfyabValues("senfyab-export");
  if (Object.values(filters).some((value) => value.length < 1)) {
    showToast("فیلترهای خروجی صنفیاب را کامل وارد کنید.", true);
    return;
  }
  try {
    const summary = await request(
      `/sources/senfyab/exports/summary?${new URLSearchParams(filters).toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll("#senfyab-export-metrics strong")
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector("#senfyab-export-new-badge").textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector("#senfyab-export-from").value =
      summary.suggested_from_contact_no;
    document.querySelector("#senfyab-export-to").value =
      summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadSenfyabExportHistory() {
  const holder = document.querySelector("#senfyab-export-history");
  try {
    const data = await request("/sources/senfyab/exports/history");
    holder.innerHTML = data.items.length
      ? data.items.map((item) => `
          <article class="history-item">
            <div class="history-item-head">
              <strong>#${formatNumber(item.from_contact_no)} تا #${formatNumber(item.to_contact_no)}</strong>
              <time>${formatDate(item.created_at)}</time>
            </div>
            <p>${formatNumber(item.row_count)} کانتکت تحویل‌شده</p>
          </article>`).join("")
      : `<div class="empty">هنوز خروجی تحویل‌شده‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function downloadSenfyabExport(confirmDelivery) {
  const filters = senfyabValues("senfyab-export");
  const payload = {
    ...filters,
    from_contact_no: Number(
      document.querySelector("#senfyab-export-from").value,
    ),
    to_contact_no: Number(
      document.querySelector("#senfyab-export-to").value,
    ),
    confirm_delivery: confirmDelivery,
  };
  if (
    Object.values(filters).some((value) => value.length < 1) ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast("فیلتر یا بازه خروجی صنفیاب معتبر نیست.", true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest("/sources/senfyab/exports/xlsx", payload);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `senfyab-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? "فایل صنفیاب دانلود و بازه به‌عنوان تحویل‌شده ثبت شد."
      : "فایل آزمایشی صنفیاب دانلود شد؛ وضعیت تحویل تغییر نکرد.");
    if (confirmDelivery) {
      await loadSenfyabExport();
      await loadSenfyabExportHistory();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function renderDivar() {
  setHeader("", "دیوار", "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات دیوار…</div>`;
  try {
    const source = await request("/sources/divar");
    const input = source.input || {
      keyword: "",
      city: "",
      category: "",
      subcategory: "",
    };
    content.innerHTML = `
      <div class="behtarino-layout">
        <div class="two-column">
          <section class="panel">
            <div class="panel-header">
              <div><h2>ورودی‌های استخراج دیوار</h2></div>
              <span class="status-pill">${statusLabel(source.status)}</span>
            </div>
            <form id="divar-form">
              <div class="form-grid">
                ${divarFields("divar", input)}
              </div>
              <div class="form-actions">
                <button class="button primary" type="submit">ذخیره ورودی‌ها</button>
                <p class="form-hint">آخرین تغییر: ${formatDate(input.updated_at)}</p>
              </div>
            </form>
          </section>
          <section class="panel">
            <div class="panel-header"><div><h2>تاریخچه</h2></div></div>
            <div class="tabs">
              <button class="tab-button" data-history="runs">اجراها</button>
              <button class="tab-button active" data-history="settings">تغییر ورودی‌ها</button>
            </div>
            <div id="history-list" class="history-list"></div>
          </section>
        </div>
        <section class="panel export-panel">
          <div class="panel-header">
            <div>
              <h2>خروجی Excel مستقل دیوار</h2>
              <p>شماره کانتکت دائمی است و با اضافه‌شدن داده‌های جدید تغییر نمی‌کند.</p>
            </div>
            <span id="divar-export-new-badge" class="status-pill">در حال بررسی…</span>
          </div>
          <div id="divar-export-metrics" class="export-metrics">
            <div><span>آخرین کانتکت</span><strong>—</strong></div>
            <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
            <div><span>شروع پیشنهادی</span><strong>—</strong></div>
            <div><span>کانتکت جدید</span><strong>—</strong></div>
          </div>
          <div class="export-grid">
            <div class="export-controls">
              <div class="form-grid">
                ${divarFields("divar-export", input)}
                <label>از شماره<input id="divar-export-from" type="number" min="1" value="1" /></label>
                <label>تا شماره<input id="divar-export-to" type="number" min="1" value="1" /></label>
              </div>
              <div class="form-actions export-actions">
                <button id="apply-divar-export-filter" class="button secondary" type="button">اعمال فیلتر</button>
                <button id="preview-divar-export" class="button secondary" type="button">دانلود آزمایشی</button>
                <button id="confirm-divar-export" class="button primary" type="button">دانلود و ثبت تحویل</button>
                <button id="download-all-divar" class="button secondary" type="button">دانلود کل دیتابیس</button>
              </div>
            </div>
            <div>
              <h3 class="export-history-title">تاریخچه تحویل دیوار</h3>
              <div id="divar-export-history" class="history-list compact">
                <div class="loading">در حال دریافت تاریخچه…</div>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document.querySelector("#divar-form").addEventListener("submit", saveDivar);
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-history]").forEach((item) =>
          item.classList.remove("active"));
        button.classList.add("active");
        loadHistory("divar", button.dataset.history);
      });
    });
    document.querySelector("#apply-divar-export-filter")
      .addEventListener("click", loadDivarExport);
    document.querySelector("#preview-divar-export")
      .addEventListener("click", () => downloadDivarExport(false));
    document.querySelector("#confirm-divar-export")
      .addEventListener("click", () => downloadDivarExport(true));
    document.querySelector("#download-all-divar")
      .addEventListener("click", () => downloadAllContacts("divar"));
    loadHistory("divar", "settings");
    loadDivarExport();
    loadDivarExportHistory();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function divarFields(prefix, input) {
  return `
    <label>Keyword<input id="${prefix}-keyword" value="${escapeHtml(input.keyword)}" minlength="2" maxlength="120" required /></label>
    <label>شهر<input id="${prefix}-city" value="${escapeHtml(input.city)}" minlength="2" maxlength="80" required /></label>
    <label>دسته‌بندی<input id="${prefix}-category" value="${escapeHtml(input.category)}" minlength="2" maxlength="120" required /></label>
    <label>زیردسته<input id="${prefix}-subcategory" value="${escapeHtml(input.subcategory)}" minlength="2" maxlength="160" required /></label>`;
}

function divarValues(prefix) {
  return {
    keyword: document.querySelector(`#${prefix}-keyword`).value.trim(),
    city: document.querySelector(`#${prefix}-city`).value.trim(),
    category: document.querySelector(`#${prefix}-category`).value.trim(),
    subcategory: document.querySelector(`#${prefix}-subcategory`).value.trim(),
  };
}

async function saveDivar(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request("/sources/divar/input", {
      method: "PUT",
      body: JSON.stringify(divarValues("divar")),
    });
    showToast("ورودی‌های دیوار با موفقیت ذخیره شدند.");
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    const saved = data.input || divarValues("divar");
    ["keyword", "city", "category", "subcategory"].forEach((field) => {
      const exportInput = document.querySelector(`#divar-export-${field}`);
      if (exportInput) exportInput.value = saved[field] || "";
    });
    await loadDivarExport();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadDivarExport() {
  const filters = divarValues("divar-export");
  if (Object.values(filters).some((value) => value.length < 2)) {
    showToast("چهار فیلتر خروجی دیوار را کامل وارد کنید.", true);
    return;
  }
  try {
    const summary = await request(
      `/sources/divar/exports/summary?${new URLSearchParams(filters).toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll("#divar-export-metrics strong")
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector("#divar-export-new-badge").textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector("#divar-export-from").value =
      summary.suggested_from_contact_no;
    document.querySelector("#divar-export-to").value = summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadDivarExportHistory() {
  const holder = document.querySelector("#divar-export-history");
  try {
    const data = await request("/sources/divar/exports/history");
    holder.innerHTML = data.items.length
      ? data.items.map((item) => `
          <article class="history-item">
            <div class="history-item-head">
              <strong>#${formatNumber(item.from_contact_no)} تا #${formatNumber(item.to_contact_no)}</strong>
              <time>${formatDate(item.created_at)}</time>
            </div>
            <p>${formatNumber(item.row_count)} کانتکت تحویل‌شده</p>
          </article>`).join("")
      : `<div class="empty">هنوز خروجی تحویل‌شده‌ای ثبت نشده است.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function downloadDivarExport(confirmDelivery) {
  const payload = {
    ...divarValues("divar-export"),
    from_contact_no: Number(document.querySelector("#divar-export-from").value),
    to_contact_no: Number(document.querySelector("#divar-export-to").value),
    confirm_delivery: confirmDelivery,
  };
  if (
    Object.values(divarValues("divar-export")).some((value) => value.length < 2) ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast("فیلتر یا بازه خروجی دیوار معتبر نیست.", true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest("/sources/divar/exports/xlsx", payload);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `divar-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? "فایل دیوار دانلود و بازه به‌عنوان تحویل‌شده ثبت شد."
      : "فایل آزمایشی دیوار دانلود شد؛ وضعیت تحویل تغییر نکرد.");
    if (confirmDelivery) {
      await loadDivarExport();
      await loadDivarExportHistory();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
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
  if (view === "avval") return renderAvval();
  if (view === "takhfifan") return renderTakhfifan();
  if (view === "senfyab") return renderSenfyab();
  if (view === "foodkeys") return renderFoodkeys();
  if (view === "divar") return renderDivar();
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
