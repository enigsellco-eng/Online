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
  const classifiedSource = ["senfyab", "omdbox"].includes(sourceKey);
  const title = classifiedSource
    ? item.name || "تنظیمات منبع"
    : sourceKey === "foodkeys"
      ? item.query || "دسته‌بندی فودکیز"
      : item.query || "بدون Keyword";
  const details = classifiedSource
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

async function renderClassifiedSource(sourceKey, displayName, subcategoryRequired) {
  setHeader("", displayName, "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات ${escapeHtml(displayName)}…</div>`;
  try {
    const source = await request(`/sources/${sourceKey}`);
    const input = source.input || { name: "", category: "", subcategory: "" };
    content.innerHTML = `
      <div class="behtarino-layout">
        <div class="two-column">
          <section class="panel">
            <div class="panel-header">
              <div><h2>ورودی‌های استخراج</h2></div>
              <span class="status-pill">${statusLabel(source.status)}</span>
            </div>
            <form id="${sourceKey}-form">
              <div class="form-grid">
                <label>
                  نام جستجو
                  <input id="${sourceKey}-name"
                    value="${escapeHtml(input.name || "")}"
                    minlength="1" maxlength="200" required />
                </label>
                <label>
                  دسته‌بندی
                  <input id="${sourceKey}-category"
                    value="${escapeHtml(input.category)}"
                    minlength="2" maxlength="120" required />
                </label>
                <label>
                  زیردسته
                  <input id="${sourceKey}-subcategory"
                    value="${escapeHtml(input.subcategory)}"
                    maxlength="160" ${subcategoryRequired ? 'minlength="1" required' : ''} />
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
            <div><h2>خروجی Excel مستقل ${escapeHtml(displayName)}</h2></div>
            <span id="${sourceKey}-export-new-badge" class="status-pill">در حال بررسی…</span>
          </div>
          <div id="${sourceKey}-export-metrics" class="export-metrics">
            <div><span>آخرین کانتکت</span><strong>—</strong></div>
            <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
            <div><span>شروع پیشنهادی</span><strong>—</strong></div>
            <div><span>کانتکت جدید</span><strong>—</strong></div>
          </div>
          <div class="export-grid">
            <div class="export-controls">
              <div class="form-grid">
                ${classifiedFields(`${sourceKey}-export`, input, subcategoryRequired)}
                <label>از شماره<input id="${sourceKey}-export-from" type="number" min="1" value="1" /></label>
                <label>تا شماره<input id="${sourceKey}-export-to" type="number" min="1" value="1" /></label>
              </div>
              <div class="form-actions export-actions">
                <button id="apply-${sourceKey}-export-filter" class="button secondary" type="button">اعمال فیلتر</button>
                <button id="preview-${sourceKey}-export" class="button secondary" type="button">دانلود آزمایشی</button>
                <button id="confirm-${sourceKey}-export" class="button primary" type="button">دانلود و ثبت تحویل</button>
                <button id="download-all-${sourceKey}" class="button secondary" type="button">دانلود کل دیتابیس</button>
              </div>
            </div>
            <div>
              <h3 class="export-history-title">تاریخچه تحویل ${escapeHtml(displayName)}</h3>
              <div id="${sourceKey}-export-history" class="history-list compact">
                <div class="loading">در حال دریافت تاریخچه…</div>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document
      .querySelector(`#${sourceKey}-form`)
      .addEventListener("submit", (event) =>
        saveClassifiedSource(event, sourceKey, displayName, subcategoryRequired));
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-history]").forEach((item) =>
          item.classList.remove("active"));
        button.classList.add("active");
        loadHistory(sourceKey, button.dataset.history);
      });
    });
    loadHistory(sourceKey, "settings");
    document.querySelector(`#apply-${sourceKey}-export-filter`)
      .addEventListener("click", () => loadClassifiedExport(sourceKey, displayName, subcategoryRequired));
    document.querySelector(`#preview-${sourceKey}-export`)
      .addEventListener("click", () => downloadClassifiedExport(sourceKey, displayName, subcategoryRequired, false));
    document.querySelector(`#confirm-${sourceKey}-export`)
      .addEventListener("click", () => downloadClassifiedExport(sourceKey, displayName, subcategoryRequired, true));
    document.querySelector(`#download-all-${sourceKey}`)
      .addEventListener("click", () => downloadAllContacts(sourceKey));
    loadClassifiedExport(sourceKey, displayName, subcategoryRequired);
    loadClassifiedExportHistory(sourceKey);
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function saveClassifiedSource(event, sourceKey, displayName, subcategoryRequired) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request(`/sources/${sourceKey}/input`, {
      method: "PUT",
      body: JSON.stringify({
        name: document.querySelector(`#${sourceKey}-name`).value.trim(),
        category: document.querySelector(`#${sourceKey}-category`).value.trim(),
        subcategory: document
          .querySelector(`#${sourceKey}-subcategory`).value.trim(),
      }),
    });
    showToast(`ورودی‌های ${displayName} با موفقیت ذخیره شدند.`);
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    const saved = data.input || classifiedValues(sourceKey, subcategoryRequired);
    ["name", "category", "subcategory"].forEach((field) => {
      const exportInput = document.querySelector(`#${sourceKey}-export-${field}`);
      if (exportInput) exportInput.value = saved[field] || "";
    });
    await loadClassifiedExport(sourceKey, displayName, subcategoryRequired);
    await loadHistory(sourceKey, "settings");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function renderSenfyab() {
  return renderClassifiedSource("senfyab", "صنفیاب", true);
}

async function renderOmdbox() {
  return renderClassifiedSource("omdbox", "عمده‌باکس", false);
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

function classifiedFields(prefix, input, subcategoryRequired) {
  return `
    <label>نام جستجو<input id="${prefix}-name" value="${escapeHtml(input.name)}" minlength="1" maxlength="200" required /></label>
    <label>دسته‌بندی<input id="${prefix}-category" value="${escapeHtml(input.category)}" minlength="1" maxlength="120" required /></label>
    <label>زیردسته<input id="${prefix}-subcategory" value="${escapeHtml(input.subcategory)}" maxlength="160" ${subcategoryRequired ? 'minlength="1" required' : ''} /></label>`;
}

function classifiedValues(prefix, subcategoryRequired) {
  return {
    name: document.querySelector(`#${prefix}-name`).value.trim(),
    category: document.querySelector(`#${prefix}-category`).value.trim(),
    subcategory: document.querySelector(`#${prefix}-subcategory`).value.trim(),
  };
}

async function loadClassifiedExport(sourceKey, displayName, subcategoryRequired) {
  const filters = classifiedValues(`${sourceKey}-export`, subcategoryRequired);
  if (!filters.name || !filters.category || (subcategoryRequired && !filters.subcategory)) {
    showToast(`فیلترهای خروجی ${displayName} را کامل وارد کنید.`, true);
    return;
  }
  try {
    const summary = await request(
      `/sources/${sourceKey}/exports/summary?${new URLSearchParams(filters).toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll(`#${sourceKey}-export-metrics strong`)
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector(`#${sourceKey}-export-new-badge`).textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector(`#${sourceKey}-export-from`).value =
      summary.suggested_from_contact_no;
    document.querySelector(`#${sourceKey}-export-to`).value =
      summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadClassifiedExportHistory(sourceKey) {
  const holder = document.querySelector(`#${sourceKey}-export-history`);
  try {
    const data = await request(`/sources/${sourceKey}/exports/history`);
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

async function downloadClassifiedExport(sourceKey, displayName, subcategoryRequired, confirmDelivery) {
  const filters = classifiedValues(`${sourceKey}-export`, subcategoryRequired);
  const payload = {
    ...filters,
    from_contact_no: Number(
      document.querySelector(`#${sourceKey}-export-from`).value,
    ),
    to_contact_no: Number(
      document.querySelector(`#${sourceKey}-export-to`).value,
    ),
    confirm_delivery: confirmDelivery,
  };
  if (
    !filters.name || !filters.category || (subcategoryRequired && !filters.subcategory) ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast(`فیلتر یا بازه خروجی ${displayName} معتبر نیست.`, true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest(`/sources/${sourceKey}/exports/xlsx`, payload);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `${sourceKey}-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? `فایل ${displayName} دانلود و بازه به‌عنوان تحویل‌شده ثبت شد.`
      : `فایل آزمایشی ${displayName} دانلود شد؛ وضعیت تحویل تغییر نکرد.`);
    if (confirmDelivery) {
      await loadClassifiedExport(sourceKey, displayName, subcategoryRequired);
      await loadClassifiedExportHistory(sourceKey);
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function renderMarketplaceSource(sourceKey, displayName) {
  setHeader("", displayName, "");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات ${escapeHtml(displayName)}…</div>`;
  try {
    const source = await request(`/sources/${sourceKey}`);
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
              <div><h2>ورودی‌های استخراج ${escapeHtml(displayName)}</h2></div>
              <span class="status-pill">${statusLabel(source.status)}</span>
            </div>
            <form id="${sourceKey}-form">
              <div class="form-grid">
                ${marketplaceFields(sourceKey, input)}
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
              <h2>خروجی Excel مستقل ${escapeHtml(displayName)}</h2>
              <p>شماره کانتکت دائمی است و با اضافه‌شدن داده‌های جدید تغییر نمی‌کند.</p>
            </div>
            <span id="${sourceKey}-export-new-badge" class="status-pill">در حال بررسی…</span>
          </div>
          <div id="${sourceKey}-export-metrics" class="export-metrics">
            <div><span>آخرین کانتکت</span><strong>—</strong></div>
            <div><span>آخرین تحویل این فیلتر</span><strong>—</strong></div>
            <div><span>شروع پیشنهادی</span><strong>—</strong></div>
            <div><span>کانتکت جدید</span><strong>—</strong></div>
          </div>
          <div class="export-grid">
            <div class="export-controls">
              <div class="form-grid">
                ${marketplaceFields(`${sourceKey}-export`, input)}
                <label>از شماره<input id="${sourceKey}-export-from" type="number" min="1" value="1" /></label>
                <label>تا شماره<input id="${sourceKey}-export-to" type="number" min="1" value="1" /></label>
              </div>
              <div class="form-actions export-actions">
                <button id="apply-${sourceKey}-export-filter" class="button secondary" type="button">اعمال فیلتر</button>
                <button id="preview-${sourceKey}-export" class="button secondary" type="button">دانلود آزمایشی</button>
                <button id="confirm-${sourceKey}-export" class="button primary" type="button">دانلود و ثبت تحویل</button>
                <button id="download-all-${sourceKey}" class="button secondary" type="button">دانلود کل دیتابیس</button>
              </div>
            </div>
            <div>
              <h3 class="export-history-title">تاریخچه تحویل ${escapeHtml(displayName)}</h3>
              <div id="${sourceKey}-export-history" class="history-list compact">
                <div class="loading">در حال دریافت تاریخچه…</div>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document.querySelector(`#${sourceKey}-form`).addEventListener("submit", (event) =>
      saveMarketplaceSource(event, sourceKey, displayName));
    document.querySelectorAll("[data-history]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-history]").forEach((item) =>
          item.classList.remove("active"));
        button.classList.add("active");
        loadHistory(sourceKey, button.dataset.history);
      });
    });
    document.querySelector(`#apply-${sourceKey}-export-filter`)
      .addEventListener("click", () => loadMarketplaceExport(sourceKey, displayName));
    document.querySelector(`#preview-${sourceKey}-export`)
      .addEventListener("click", () => downloadMarketplaceExport(sourceKey, displayName, false));
    document.querySelector(`#confirm-${sourceKey}-export`)
      .addEventListener("click", () => downloadMarketplaceExport(sourceKey, displayName, true));
    document.querySelector(`#download-all-${sourceKey}`)
      .addEventListener("click", () => downloadAllContacts(sourceKey));
    loadHistory(sourceKey, "settings");
    loadMarketplaceExport(sourceKey, displayName);
    loadMarketplaceExportHistory(sourceKey);
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function marketplaceFields(prefix, input) {
  return `
    <label>Keyword<input id="${prefix}-keyword" value="${escapeHtml(input.keyword)}" minlength="2" maxlength="120" required /></label>
    <label>شهر<input id="${prefix}-city" value="${escapeHtml(input.city)}" minlength="2" maxlength="80" required /></label>
    <label>دسته‌بندی<input id="${prefix}-category" value="${escapeHtml(input.category)}" minlength="2" maxlength="120" required /></label>
    <label>زیردسته<input id="${prefix}-subcategory" value="${escapeHtml(input.subcategory)}" minlength="2" maxlength="160" required /></label>`;
}

function marketplaceValues(prefix) {
  return {
    keyword: document.querySelector(`#${prefix}-keyword`).value.trim(),
    city: document.querySelector(`#${prefix}-city`).value.trim(),
    category: document.querySelector(`#${prefix}-category`).value.trim(),
    subcategory: document.querySelector(`#${prefix}-subcategory`).value.trim(),
  };
}

async function saveMarketplaceSource(event, sourceKey, displayName) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await request(`/sources/${sourceKey}/input`, {
      method: "PUT",
      body: JSON.stringify(marketplaceValues(sourceKey)),
    });
    showToast(`ورودی‌های ${displayName} با موفقیت ذخیره شدند.`);
    form.querySelector(".form-hint").textContent =
      `آخرین تغییر: ${formatDate(data.input.updated_at)}`;
    const saved = data.input || marketplaceValues(sourceKey);
    ["keyword", "city", "category", "subcategory"].forEach((field) => {
      const exportInput = document.querySelector(`#${sourceKey}-export-${field}`);
      if (exportInput) exportInput.value = saved[field] || "";
    });
    await loadMarketplaceExport(sourceKey, displayName);
    await loadHistory(sourceKey, "settings");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadMarketplaceExport(sourceKey, displayName) {
  const filters = marketplaceValues(`${sourceKey}-export`);
  if (Object.values(filters).some((value) => value.length < 2)) {
    showToast(`چهار فیلتر خروجی ${displayName} را کامل وارد کنید.`, true);
    return;
  }
  try {
    const summary = await request(
      `/sources/${sourceKey}/exports/summary?${new URLSearchParams(filters).toString()}`,
    );
    const values = [
      summary.latest_contact_no,
      summary.last_delivered_contact_no,
      summary.suggested_from_contact_no,
      summary.new_count,
    ];
    document.querySelectorAll(`#${sourceKey}-export-metrics strong`)
      .forEach((element, index) => {
        element.textContent = formatNumber(values[index]);
      });
    document.querySelector(`#${sourceKey}-export-new-badge`).textContent =
      `${formatNumber(summary.new_count)} جدید`;
    document.querySelector(`#${sourceKey}-export-from`).value =
      summary.suggested_from_contact_no;
    document.querySelector(`#${sourceKey}-export-to`).value = summary.latest_contact_no;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadMarketplaceExportHistory(sourceKey) {
  const holder = document.querySelector(`#${sourceKey}-export-history`);
  try {
    const data = await request(`/sources/${sourceKey}/exports/history`);
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

async function downloadMarketplaceExport(sourceKey, displayName, confirmDelivery) {
  const payload = {
    ...marketplaceValues(`${sourceKey}-export`),
    from_contact_no: Number(document.querySelector(`#${sourceKey}-export-from`).value),
    to_contact_no: Number(document.querySelector(`#${sourceKey}-export-to`).value),
    confirm_delivery: confirmDelivery,
  };
  if (
    Object.values(marketplaceValues(`${sourceKey}-export`)).some((value) => value.length < 2) ||
    payload.from_contact_no < 1 ||
    payload.to_contact_no < payload.from_contact_no
  ) {
    showToast(`فیلتر یا بازه خروجی ${displayName} معتبر نیست.`, true);
    return;
  }
  const buttons = document.querySelectorAll(".export-actions button");
  buttons.forEach((button) => (button.disabled = true));
  try {
    const blob = await downloadRequest(`/sources/${sourceKey}/exports/xlsx`, payload);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `${sourceKey}-contacts-${payload.from_contact_no}-to-${payload.to_contact_no}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(confirmDelivery
      ? `فایل ${displayName} دانلود و بازه به‌عنوان تحویل‌شده ثبت شد.`
      : `فایل آزمایشی ${displayName} دانلود شد؛ وضعیت تحویل تغییر نکرد.`);
    if (confirmDelivery) {
      await loadMarketplaceExport(sourceKey, displayName);
      await loadMarketplaceExportHistory(sourceKey);
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function renderDivar() {
  return renderMarketplaceSource("divar", "دیوار");
}

async function renderSheypoor() {
  return renderMarketplaceSource("sheypoor", "شیپور");
}

async function downloadTelegram(format) {
  const response = await fetch(`${API}/sources/telegram/exports/found.${format}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("نشست شما پایان یافته است.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "دریافت خروجی تلگرام ناموفق بود.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `telegram-found.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function uploadTelegramCsv(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const body = new FormData(form);
    const response = await fetch(`${API}/sources/telegram/uploads/csv`, {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": state.csrfToken },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "ورود CSV ناموفق بود.");
    showToast(
      `${formatNumber(data.added)} شماره اضافه شد؛ ${formatNumber(data.invalid)} نامعتبر و ${formatNumber(data.duplicates)} تکراری.`,
    );
    form.reset();
    document.querySelector("#telegram-phone-column").value = "phone";
    await renderTelegram();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function renderTelegram() {
  setHeader("", "تلگرام", "ورودی و خروجی آداپتر مستقل بررسی موبایل");
  content.innerHTML = `<div class="loading">در حال دریافت اطلاعات تلگرام…</div>`;
  try {
    const [source, results] = await Promise.all([
      request("/sources/telegram"),
      request("/sources/telegram/results"),
    ]);
    const telegram = source.telegram || {};
    const counts = telegram.counts || {};
    const validation = telegram.validation || {};
    const usage = telegram.daily_usage || {};
    const rows = (results.items || []).slice(0, 50);
    content.innerHTML = `
      <div class="telegram-layout">
        <section class="telegram-metrics">
          <article class="telegram-metric"><span>موبایل معتبر</span><strong>${formatNumber(validation.valid_mobile || 0)}</strong></article>
          <article class="telegram-metric"><span>در انتظار</span><strong>${formatNumber((counts.pending || 0) + (counts.retry_later || 0))}</strong></article>
          <article class="telegram-metric"><span>پیدا شده</span><strong>${formatNumber(counts.telegram_found || 0)}</strong></article>
          <article class="telegram-metric"><span>قابل تشخیص نبود</span><strong>${formatNumber(counts.telegram_not_resolved || 0)}</strong></article>
          <article class="telegram-metric"><span>مصرف امروز</span><strong>${formatNumber(usage.request_count || 0)}</strong></article>
        </section>
        <div class="two-column">
          <section class="panel">
            <div class="panel-header"><div><h2>ورودی CSV</h2><p>شماره‌های جدید به صف مستقل تلگرام افزوده می‌شوند.</p></div><span class="status-pill">${statusLabel(source.status)}</span></div>
            <form id="telegram-upload-form">
              <div class="form-grid">
                <label>فایل CSV<input id="telegram-file" name="file" type="file" accept=".csv,text/csv" required /></label>
                <label>نام ستون شماره<input id="telegram-phone-column" name="phone_column" value="phone" required /></label>
              </div>
              <div class="form-actions"><button class="button primary" type="submit">افزودن به صف بررسی</button></div>
            </form>
            <p class="privacy-note">قبل از Telegram، ارقام فارسی/عربی تبدیل، شماره به +98 استاندارد و فقط موبایل معتبر ایران وارد صف می‌شود.</p>
          </section>
          <section class="panel">
            <div class="panel-header"><div><h2>خروجی نتایج مثبت</h2><p>فقط حساب‌هایی که Telegram رسماً برگردانده است.</p></div></div>
            <div class="telegram-actions">
              <button class="button primary" data-telegram-export="xlsx">دانلود Excel</button>
              <button class="button secondary" data-telegram-export="csv">دانلود CSV</button>
              <button class="button secondary" data-telegram-export="json">دانلود JSON</button>
            </div>
            <p class="privacy-note">«قابل تشخیص نبود» نتیجه منفی قطعی نیست و ممکن است ناشی از Privacy باشد.</p>
          </section>
        </div>
        <section class="panel">
          <div class="panel-header"><div><h2>نتایج پیدا شده</h2><p>نمایش ۵۰ نتیجه آخر از خروجی مستقل تلگرام</p></div><span class="status-pill">${formatNumber(results.items?.length || 0)} نتیجه</span></div>
          <div class="telegram-table-wrap"><table class="telegram-table"><thead><tr><th>شماره استاندارد</th><th>User ID</th><th>Username</th><th>نام عمومی</th><th>زمان بررسی</th><th>منبع</th></tr></thead><tbody>
            ${rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.standard_phone)}</td><td>${escapeHtml(row.telegram_user_id || "—")}</td><td>${escapeHtml(row.username || "—")}</td><td>${escapeHtml(row.public_name || "—")}</td><td>${formatDate(row.checked_at)}</td><td>${escapeHtml(row.source_keys || "—")}</td></tr>`).join("") : `<tr><td colspan="6">هنوز نتیجه مثبتی ثبت نشده است.</td></tr>`}
          </tbody></table></div>
        </section>
      </div>`;
    document.querySelector("#telegram-upload-form")
      .addEventListener("submit", uploadTelegramCsv);
    document.querySelectorAll("[data-telegram-export]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await downloadTelegram(button.dataset.telegramExport);
          showToast("خروجی تلگرام آماده و دانلود شد.");
        } catch (error) {
          showToast(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function senderFormRequest(path, formData) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "X-CSRF-Token": state.csrfToken },
    body: formData,
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("نشست شما پایان یافته است.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "درخواست ناموفق بود.");
  return data;
}

function summarizeSenderFiles(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  const holder = input.closest("label")?.querySelector(".sender-file-summary");
  const tooLarge = files.find((file) => file.size > 25 * 1024 * 1024);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (tooLarge || totalBytes > 200 * 1024 * 1024) {
    const message = tooLarge
      ? `فایل «${tooLarge.name}» بیشتر از ۲۵ مگابایت است.`
      : "مجموع فایل‌ها بیشتر از ۲۰۰ مگابایت است.";
    input.value = "";
    if (holder) holder.textContent = message;
    showToast(message, true);
    initializeSenderSequence(input.closest("form"));
    return;
  }
  if (holder) {
    holder.textContent = files.length
      ? `${formatNumber(files.length)} فایل انتخاب شد · ${(totalBytes / 1024 / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`
      : "هنوز فایلی انتخاب نشده است.";
  }
  initializeSenderSequence(input.closest("form"));
}

function senderSequenceLabel(token, form) {
  if (token === "text") {
    const textValue = form.querySelector("textarea[name='message']")?.value.trim() || "متن هنوز وارد نشده است";
    return { kind: isSenderAlbumForm(form) ? "کپشن مشترک آلبوم" : "متن", detail: textValue.slice(0, 80) };
  }
  const index = Number(token.split(":", 2)[1]);
  const file = form.querySelector(".sender-files-input")?.files?.[index];
  const kind = file?.type.startsWith("image/") ? "عکس"
    : file?.type.startsWith("video/") ? "ویدئو"
      : file?.type.startsWith("audio/") ? "فایل صوتی" : "فایل";
  return { kind, detail: file?.name || `فایل ${index + 1}` };
}

function isSenderAlbumForm(form) {
  const files = Array.from(form.querySelector(".sender-files-input")?.files || []);
  return files.length > 0 && files.every((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
}

function renderSenderSequence(form) {
  const hidden = form.querySelector("[name='content_order']");
  const holder = form.querySelector(".sender-sequence-list");
  if (!hidden || !holder) return;
  let tokens;
  try { tokens = JSON.parse(hidden.value); } catch { tokens = ["text"]; }
  const albumMode = isSenderAlbumForm(form);
  const mediaCount = tokens.filter((token) => token.startsWith("file:")).length;
  const description = form.querySelector(".sender-sequence-builder > p");
  if (description) {
    description.textContent = albumMode
      ? `${formatNumber(mediaCount)} رسانه با ترتیب زیر در یک آلبوم تلگرام و متن به‌عنوان کپشن همان پیام ارسال می‌شود${mediaCount > 10 ? "؛ تلگرام آلبوم‌های بیشتر از ۱۰ رسانه را تقسیم می‌کند" : ""}.`
      : "متن و فایل‌های غیرتصویری با ترتیب زیر به‌صورت پیام‌های جدا ارسال می‌شوند.";
  }
  holder.innerHTML = tokens.map((token, index) => {
    const item = senderSequenceLabel(token, form);
    const lockedCaption = albumMode && token === "text";
    const lastMovableIndex = albumMode ? tokens.length - 2 : tokens.length - 1;
    return `<div class="sender-sequence-item" data-token="${escapeHtml(token)}">
      <span class="sender-sequence-number">${formatNumber(index + 1)}</span>
      <div><strong>${escapeHtml(item.kind)}</strong><small>${escapeHtml(item.detail)}</small></div>
      <div class="sender-sequence-controls">
        <button type="button" class="icon-button sender-sequence-move" data-direction="up" aria-label="انتقال به بالا" ${lockedCaption || index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="icon-button sender-sequence-move" data-direction="down" aria-label="انتقال به پایین" ${lockedCaption || index === lastMovableIndex ? "disabled" : ""}>↓</button>
      </div>
    </div>`;
  }).join("");
  holder.querySelectorAll(".sender-sequence-move").forEach((button) => button.addEventListener("click", moveSenderSequence));
}

function initializeSenderSequence(form) {
  if (!form) return;
  const hidden = form.querySelector("[name='content_order']");
  const files = Array.from(form.querySelector(".sender-files-input")?.files || []);
  if (!hidden) return;
  const fileTokens = files.map((_, index) => `file:${index}`);
  hidden.value = JSON.stringify(isSenderAlbumForm(form) ? [...fileTokens, "text"] : ["text", ...fileTokens]);
  renderSenderSequence(form);
}

function moveSenderSequence(event) {
  const form = event.currentTarget.closest("form");
  const hidden = form.querySelector("[name='content_order']");
  const token = event.currentTarget.closest(".sender-sequence-item").dataset.token;
  const tokens = JSON.parse(hidden.value);
  const index = tokens.indexOf(token);
  const nextIndex = event.currentTarget.dataset.direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= tokens.length) return;
  if (isSenderAlbumForm(form) && (token === "text" || tokens[nextIndex] === "text")) return;
  [tokens[index], tokens[nextIndex]] = [tokens[nextIndex], tokens[index]];
  hidden.value = JSON.stringify(tokens);
  renderSenderSequence(form);
}

function senderStatusLabel(status) {
  const labels = {
    connected: "متصل",
    pending_code: "در انتظار کد",
    disconnected: "قطع‌شده",
    waiting: "انتظار محدودیت تلگرام",
    draft: "پیش‌نویس",
    running: "در حال ارسال",
    paused: "متوقف",
    completed: "تکمیل‌شده",
    cancelled: "لغوشده",
  };
  return labels[status] || statusLabel(status);
}

async function requestSenderCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await request("/telegram-sender/accounts/request-code", {
      method: "POST",
      body: JSON.stringify({
        slot: Number(form.dataset.slot),
        label: form.querySelector("[name='label']").value,
        phone: form.querySelector("[name='phone']").value,
      }),
    });
    showToast("کد ورود تلگرام ارسال شد.");
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function confirmSenderAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await request("/telegram-sender/accounts/confirm", {
      method: "POST",
      body: JSON.stringify({
        slot: Number(form.dataset.slot),
        code: form.querySelector("[name='code']").value,
        password: form.querySelector("[name='password']").value || null,
      }),
    });
    showToast("حساب تلگرام با موفقیت متصل شد.");
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function logoutSenderAccount(event) {
  const button = event.currentTarget;
  const slot = Number(button.dataset.slot);
  const label = button.dataset.label || `حساب ${slot}`;
  if (!window.confirm(`از «${label}» خارج می‌شوید و این جایگاه برای شماره جدید آزاد می‌شود. ادامه می‌دهید؟`)) return;
  button.disabled = true;
  try {
    const data = await request(`/telegram-sender/accounts/${slot}/logout`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast(data.revoke_warning
      ? "حساب از سیستم حذف شد؛ تلگرام هنگام باطل‌کردن نشست پاسخ کامل نداد."
      : "خروج از حساب انجام شد؛ اکنون می‌توانید شماره جدید را وارد کنید.");
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function createSenderCampaign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const includesPrevious = form.querySelector("[name='include_previously_sent']:checked")?.value === "true";
  if (includesPrevious && !window.confirm("این حالت شماره‌هایی را که قبلاً پیام موفق گرفته‌اند نیز دوباره وارد کمپین می‌کند. ادامه می‌دهید؟")) return;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await senderFormRequest(
      "/telegram-sender/campaigns",
      new FormData(form),
    );
    showToast(`پیش‌نویس کمپین با ${formatNumber(data.recipients)} مخاطب ساخته شد.`);
    form.reset();
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function refreshSenderAudiencePreview() {
  const form = document.querySelector("#sender-campaign-form");
  const holder = document.querySelector("#sender-audience-preview");
  if (!form || !holder) return;
  const includePrevious = form.querySelector("[name='include_previously_sent']:checked")?.value === "true";
  holder.innerHTML = `<div class="loading">در حال محاسبه مخاطبان…</div>`;
  try {
    const data = await request(`/telegram-sender/campaigns/audience-preview?include_previously_sent=${includePrevious}`);
    holder.innerHTML = `
      <article class="sender-metric"><span>کل دیتابیس تلگرام</span><strong>${formatNumber(data.total)}</strong></article>
      <article class="sender-metric"><span>بدون ارسال موفق قبلی</span><strong>${formatNumber(data.new)}</strong></article>
      <article class="sender-metric"><span>قبلاً پیام‌گرفته</span><strong>${formatNumber(data.previously_sent)}</strong></article>
      <article class="sender-metric"><span>در صف کمپین دیگر</span><strong>${formatNumber(data.reserved)}</strong></article>
      <article class="sender-metric"><span>انتخاب نهایی این کمپین</span><strong>${formatNumber(data.selected)}</strong></article>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function sendSenderTest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const resultHolder = document.querySelector("#sender-test-result");
  button.disabled = true;
  resultHolder.textContent = "در حال ارسال پیام آزمایشی…";
  try {
    const data = await senderFormRequest(
      "/telegram-sender/test-message",
      new FormData(form),
    );
    resultHolder.textContent = `پیام آزمایشی از «${data.account_label}» به ${data.phone} ارسال شد. شناسه پیام: ${data.telegram_message_id || "—"}`;
    resultHolder.classList.remove("error-text");
    showToast("پیام آزمایشی با موفقیت ارسال شد.");
  } catch (error) {
    resultHolder.textContent = error.message;
    resultHolder.classList.add("error-text");
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function senderCampaignAction(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request(
      `/telegram-sender/campaigns/${button.dataset.campaignId}/${button.dataset.action}`,
      { method: "POST", body: JSON.stringify({}) },
    );
    showToast("وضعیت کمپین به‌روزرسانی شد.");
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function senderEmergencyStop(stopped) {
  try {
    await request("/telegram-sender/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ stopped }),
    });
    showToast(stopped ? "ارسال همه حساب‌ها متوقف شد." : "توقف اضطراری برداشته شد.");
    await renderTelegramSender();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function renderTelegramSender() {
  setHeader("", "ارسال تلگرام", "مدیریت مستقل سه حساب، کمپین‌ها و نتایج ارسال");
  content.innerHTML = `<div class="loading">در حال دریافت وضعیت ارسال تلگرام…</div>`;
  try {
    const data = await request("/telegram-sender");
    const accounts = data.accounts || [];
    const campaigns = data.campaigns || [];
    const runtime = data.runtime || {};
    const connected = accounts.filter((account) => account.status === "connected").length;
    const totalSent = campaigns.reduce((sum, campaign) => sum + Number(campaign.sent || 0), 0);
    content.innerHTML = `
      <div class="telegram-layout">
        <section class="sender-metrics">
          <article class="sender-metric"><span>مخاطبان آماده</span><strong>${formatNumber(data.available_contacts || 0)}</strong></article>
          <article class="sender-metric"><span>حساب‌های متصل</span><strong>${formatNumber(connected)} از ۳</strong></article>
          <article class="sender-metric"><span>ارسال‌های ثبت‌شده</span><strong>${formatNumber(totalSent)}</strong></article>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>اتصال حساب‌ها</h2><p>برای هر جایگاه، شماره را ثبت و کد ورود را تأیید کنید.</p></div></div>
          <div class="sender-accounts">
            ${[1, 2, 3].map((slot) => {
              const account = accounts.find((item) => item.id === slot) || {};
              return `<article class="sender-account">
                <h3>حساب ${formatNumber(slot)}</h3>
                <p class="account-state">${escapeHtml(account.label || "ثبت‌نشده")} · ${escapeHtml(account.phone || "—")}<br>${escapeHtml(senderStatusLabel(account.status || "disconnected"))}</p>
                <form class="sender-code-form" data-slot="${slot}">
                  <label>عنوان حساب<input name="label" value="${escapeHtml(account.label || `فروشنده ${slot}`)}" required /></label>
                  <label>شماره بین‌المللی<input name="phone" dir="ltr" value="${escapeHtml(account.phone || "+98")}" required /></label>
                  <button class="button secondary wide" type="submit">دریافت کد</button>
                </form>
                <form class="sender-confirm-form" data-slot="${slot}">
                  <label>کد ورود<input name="code" inputmode="numeric" required /></label>
                  <label>رمز دومرحله‌ای<input name="password" type="password" /></label>
                  <button class="button primary wide" type="submit">تأیید و اتصال</button>
                </form>
                ${["connected", "pending_code", "waiting"].includes(account.status) ? `<button class="button secondary wide sender-logout" type="button" data-slot="${slot}" data-label="${escapeHtml(account.label || `حساب ${slot}`)}">خروج از حساب و جایگزینی شماره</button>` : ""}
              </article>`;
            }).join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>ارسال آزمایشی</h2><p>قبل از ساخت یا شروع کمپین، یک پیام را فقط به شماره‌ای که خودتان وارد می‌کنید بفرستید.</p></div></div>
          <form id="sender-test-form">
            <div class="form-grid">
              <label>حساب فرستنده<select name="slot" required>
                <option value="">انتخاب حساب متصل</option>
                ${accounts.map((account) => `<option value="${account.id}" ${account.status === "connected" ? "" : "disabled"}>${escapeHtml(account.label || `حساب ${account.id}`)} — ${escapeHtml(senderStatusLabel(account.status))}</option>`).join("")}
              </select></label>
              <label>شماره مقصد آزمایشی<input name="phone" dir="ltr" placeholder="+98912..." required /></label>
              <label>رسانه‌ها و فایل‌های اختیاری<input class="sender-files-input" name="attachments" type="file" multiple /><small class="sender-file-summary">می‌توانید چند عکس، ویدئو، فایل صوتی یا فایل عمومی انتخاب کنید.</small></label>
            </div>
            <label>متن آزمایشی<textarea name="message" rows="5" placeholder="متنی که می‌خواهید دقیقاً بررسی کنید"></textarea></label>
            <input type="hidden" name="content_order" value='["text"]' />
            <section class="sender-sequence-builder" aria-label="ترتیب ارسال محتوای آزمایشی"><h3>ترتیب نهایی ارسال</h3><p>متن و فایل‌ها را با فلش‌ها دقیقاً به ترتیب دلخواه بچینید.</p><div class="sender-sequence-list"></div></section>
            <p class="privacy-note">این عملیات فقط یک پیام می‌فرستد؛ کمپین ایجاد نمی‌شود و هیچ مخاطب دیگری در صف قرار نمی‌گیرد.</p>
            <div class="form-actions"><button class="button primary" type="submit">ارسال فقط برای تست</button></div>
            <p id="sender-test-result" class="account-state" aria-live="polite"></p>
          </form>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>کمپین جدید</h2><p>مخاطبان تأییدشده در بسته‌های مستقل بین حساب‌های آزاد توزیع می‌شوند. تمام ساعت‌ها بر اساس زمان ایران است.</p></div></div>
          <form id="sender-campaign-form">
            <div class="form-grid">
              <label>نام کمپین<input name="name" required /></label>
              <label>اندازه بسته<input name="batch_size" type="number" min="1" value="20" required /></label>
              <label>سقف روزانه هر حساب<input name="daily_limit_per_account" type="number" min="1" value="30" required /></label>
              <label>کمترین فاصله (ثانیه)<input name="min_delay_seconds" type="number" min="60" value="300" required /></label>
              <label>بیشترین فاصله (ثانیه)<input name="max_delay_seconds" type="number" min="60" value="900" required /></label>
              <label>شروع ارسال (به وقت ایران)<input name="start_time" type="time" value="09:00" required /></label>
              <label>پایان ارسال (به وقت ایران)<input name="end_time" type="time" value="18:00" required /></label>
              <label>رسانه‌ها و فایل‌های اختیاری<input class="sender-files-input" name="attachments" type="file" multiple /><small class="sender-file-summary">می‌توانید چند عکس، ویدئو، فایل صوتی یا فایل عمومی انتخاب کنید.</small></label>
            </div>
            <fieldset class="sender-audience-mode">
              <legend>انتخاب مخاطبان</legend>
              <label><input type="radio" name="include_previously_sent" value="false" checked /> فقط مخاطبانی که تاکنون ارسال موفق نداشته‌اند</label>
              <label><input type="radio" name="include_previously_sent" value="true" /> شامل مخاطبانی که قبلاً پیام گرفته‌اند (ارسال مجدد)</label>
            </fieldset>
            <div id="sender-audience-preview" class="sender-audience-preview"></div>
            <label>متن پیام<textarea name="message" rows="6" required></textarea></label>
            <input type="hidden" name="content_order" value='["text"]' />
            <section class="sender-sequence-builder" aria-label="ترتیب ارسال محتوای کمپین"><h3>ترتیب نهایی ارسال</h3><p>متن و فایل‌ها برای هر مخاطب دقیقاً با این ترتیب فرستاده می‌شوند.</p><div class="sender-sequence-list"></div></section>
            <div class="form-actions"><button class="button primary" type="submit">ساخت پیش‌نویس کمپین</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>کمپین‌ها</h2><p>شروع، توقف و ادامه ارسال از این بخش کنترل می‌شود.</p></div>
            <div class="sender-actions"><button id="sender-stop" class="button secondary">توقف اضطراری</button><button id="sender-resume" class="button secondary">رفع توقف</button></div>
          </div>
          ${runtime.emergency_stop ? `<p class="privacy-note">توقف اضطراری فعال است و هیچ حسابی پیام ارسال نمی‌کند.</p>` : ""}
          <div class="sender-table-wrap"><table class="sender-table"><thead><tr><th>کمپین</th><th>وضعیت</th><th>کل</th><th>ارسال‌شده</th><th>ناموفق</th><th>عملیات</th></tr></thead><tbody>
            ${campaigns.length ? campaigns.map((campaign) => `<tr><td>${escapeHtml(campaign.name)}</td><td>${escapeHtml(senderStatusLabel(campaign.status))}</td><td>${formatNumber(campaign.total || 0)}</td><td>${formatNumber(campaign.sent || 0)}</td><td>${formatNumber(campaign.failed || 0)}</td><td class="sender-actions"><button class="button primary" data-sender-action="start" data-campaign-id="${campaign.id}">شروع</button><button class="button secondary" data-sender-action="pause" data-campaign-id="${campaign.id}">توقف</button><button class="button secondary" data-sender-action="resume" data-campaign-id="${campaign.id}">ادامه</button></td></tr>`).join("") : `<tr><td colspan="6">هنوز کمپینی ساخته نشده است.</td></tr>`}
          </tbody></table></div>
          ${data.spreadsheet_url ? `<div class="form-actions"><a class="button secondary" href="${escapeHtml(data.spreadsheet_url)}" target="_blank" rel="noopener">باز کردن گزارش Google Sheet</a></div>` : ""}
        </section>
      </div>`;
    document.querySelectorAll(".sender-code-form").forEach((form) => form.addEventListener("submit", requestSenderCode));
    document.querySelectorAll(".sender-confirm-form").forEach((form) => form.addEventListener("submit", confirmSenderAccount));
    document.querySelectorAll(".sender-logout").forEach((button) => button.addEventListener("click", logoutSenderAccount));
    document.querySelectorAll(".sender-files-input").forEach((input) => input.addEventListener("change", summarizeSenderFiles));
    document.querySelectorAll("#sender-test-form, #sender-campaign-form").forEach((form) => {
      initializeSenderSequence(form);
      form.querySelector("textarea[name='message']")?.addEventListener("input", () => renderSenderSequence(form));
    });
    document.querySelector("#sender-test-form").addEventListener("submit", sendSenderTest);
    document.querySelector("#sender-campaign-form").addEventListener("submit", createSenderCampaign);
    document.querySelectorAll("[name='include_previously_sent']").forEach((input) => input.addEventListener("change", refreshSenderAudiencePreview));
    document.querySelectorAll("[data-sender-action]").forEach((button) => button.addEventListener("click", senderCampaignAction));
    document.querySelector("#sender-stop").addEventListener("click", () => senderEmergencyStop(true));
    document.querySelector("#sender-resume").addEventListener("click", () => senderEmergencyStop(false));
    await refreshSenderAudiencePreview();
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
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
  if (view === "omdbox") return renderOmdbox();
  if (view === "foodkeys") return renderFoodkeys();
  if (view === "divar") return renderDivar();
  if (view === "sheypoor") return renderSheypoor();
  if (view === "telegram") return renderTelegram();
  if (view === "telegram-sender") return renderTelegramSender();
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
