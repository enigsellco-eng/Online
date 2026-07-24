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
  return Number(value).toLocaleString("en-US");
}

function formatDate(value) {
  if (!value) return "Not recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status) {
  const labels = {
    running: "Running",
    completed: "Completed",
    stopped: "Stopped",
    failed: "Failed",
    idle: "Ready",
    paused: "Paused",
    unavailable: "Unavailable",
  };
  return labels[status] || "Checking";
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
    throw new Error("Your session has expired.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed.");
  return data;
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
    state.user.display_name || "Marketing Manager";
  document.querySelector("#user-email").textContent = state.user.email;
  document.querySelector("#user-avatar").textContent = (
    state.user.display_name ||
    state.user.email ||
    "M"
  ).trim()[0];
}

function setHeader(eyebrow, title, subtitle) {
  document.querySelector("#page-eyebrow").textContent = eyebrow;
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
          ${source.available ? "Connected" : "Offline"}
        </span>
      </div>
      <div class="source-number">${formatNumber(source.contacts)}</div>
      <div class="source-meta">Unique contacts collected</div>
      <div class="source-card-footer">
        <span>${formatNumber(source.records)} records extracted</span>
        <span class="status-pill ${source.available ? "" : "muted"}">
          ${disabled ? "Read only" : statusLabel(source.status)}
        </span>
      </div>
    </article>
  `;
}

async function renderOverview() {
  setHeader(
    "MARKETING OVERVIEW",
    "Source Overview",
    "",
  );
  content.innerHTML = `<div class="loading">Loading source metrics…</div>`;
  try {
    state.overview = await request("/overview");
    const sources = state.overview.sources;
    const available = sources.filter((source) => source.available).length;
    const running = sources.filter((source) => source.status === "running").length;
    content.innerHTML = `
      <section class="metrics-grid">
        <article class="metric">
          <span>Unique contacts</span>
          <strong>${formatNumber(state.overview.total_contacts)}</strong>
          <small>Total across independent sources</small>
        </article>
        <article class="metric">
          <span>Connected sources</span>
          <strong>${formatNumber(available)}</strong>
          <small>Out of ${formatNumber(sources.length)} sources</small>
        </article>
        <article class="metric">
          <span>Currently running</span>
          <strong>${formatNumber(running)}</strong>
          <small>Live worker status</small>
        </article>
        <article class="metric">
          <span>Last updated</span>
          <strong style="font-size:18px">${formatDate(state.overview.updated_at)}</strong>
          <small>API response time</small>
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
          Processed: ${formatNumber(item.processed_count)} ·
          Saved: ${formatNumber(item.saved_count)} ·
          Errors: ${formatNumber(item.error_count)}
        </p>
      </article>
    `;
  }
  return `
    <article class="history-item">
      <div class="history-item-head">
        <strong>${escapeHtml(item.query || "No keyword")}</strong>
        <time>${formatDate(item.archived_at || item.updated_at)}</time>
      </div>
      <p>City: ${escapeHtml(item.city || "—")}</p>
    </article>
  `;
}

async function loadHistory(sourceKey, type) {
  const holder = document.querySelector("#history-list");
  if (!holder) return;
  holder.innerHTML = `<div class="loading">Loading history…</div>`;
  try {
    const data = await request(
      `/sources/${sourceKey}/${type === "runs" ? "runs" : "settings-history"}`,
    );
    holder.innerHTML = data.items.length
      ? data.items.map((item) => historyItem(item, type)).join("")
      : `<div class="empty">No history has been recorded.</div>`;
  } catch (error) {
    holder.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function renderBehtarino() {
  setHeader(
    "SOURCE / BEHTARINO",
    "Behtarino",
    "",
  );
  content.innerHTML = `<div class="loading">Loading Behtarino…</div>`;
  try {
    const source = await request("/sources/behtarino");
    const input = source.input || { keyword: "", city: "" };
    content.innerHTML = `
      <div class="two-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Extraction Inputs</h2>
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
                City
                <input id="behtarino-city" value="${escapeHtml(input.city)}"
                  minlength="2" maxlength="80" required />
              </label>
            </div>
            <div class="form-actions">
              <button class="button primary" type="submit">Save inputs</button>
              <p class="form-hint">
                Last updated: ${formatDate(input.updated_at)}
              </p>
            </div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>History</h2>
            </div>
            <span class="read-only">READ ONLY</span>
          </div>
          <div class="tabs">
            <button class="tab-button active" data-history="runs">Runs</button>
            <button class="tab-button" data-history="settings">Input changes</button>
          </div>
          <div id="history-list" class="history-list"></div>
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
  } catch (error) {
    content.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
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
    showToast("Behtarino keyword and city were saved.");
    event.currentTarget.querySelector(".form-hint").textContent =
      `Last updated: ${formatDate(data.input.updated_at)}`;
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderLocked(sourceKey) {
  const isTorob = sourceKey === "torob";
  setHeader(
    `SOURCE / ${sourceKey.toUpperCase()}`,
    isTorob ? "Torob" : "Divar",
    "",
  );
  content.innerHTML = `
    <section class="panel locked-panel">
      <div class="locked-content">
        <div class="lock-icon">◇</div>
        <h2>${isTorob ? "Torob keyword is not available yet" : "Divar inputs are not defined yet"}</h2>
        <p class="muted">
          ${
            isTorob
              ? "Keyword editing will be enabled in a future phase."
              : "The input form will be added after the marketing parameters are finalized."
          }
        </p>
        ${
          isTorob
            ? `<div class="disabled-preview">
                <label>Keyword<input value="" placeholder="Coming soon" disabled /></label>
                <button class="button primary" disabled>Save keyword</button>
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
