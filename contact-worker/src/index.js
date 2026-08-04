/**
 * Enigsell contact form → D1 + Telegram
 *
 * The lead is written to D1 first and only then pushed to Telegram, so a
 * Telegram outage costs us a notification, never the lead itself.
 *
 * Secrets (wrangler secret put):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

const PHONE_RE = /^[۰-۹٠-٩0-9+()\-\s]{7,40}$/;
const MAX_BODY = 8 * 1024;

/* Rate limit: at most 5 submissions per IP per 10 minutes. */
const RATE_MAX = 5;
const RATE_WINDOW_MIN = 10;

const FIELD_LIMITS = { name: 100, company: 160, phone: 40, message: 1000 };

function corsHeaders(env, request) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, status, env, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env, request) },
  });
}

/** Persian/Arabic-Indic digits → ASCII, so the number is dialable from Telegram. */
function latinDigits(value) {
  return value.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
              .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

/**
 * Collapse a phone number to one unbroken run of digits (keeping a leading +).
 *
 * Spaces inside a number are the whole problem: they are bidi-neutral, so in a
 * Persian message they take the paragraph's RTL direction and Telegram renders
 * "0912 887 6543" as "6543 887 0912". Directional isolates did not survive
 * Telegram's formatting, but a number with no separators has nothing to
 * reorder — and Telegram turns it into a tappable dial link.
 */
function normalizePhone(value) {
  const latin = latinDigits(value).trim();
  return (latin.startsWith("+") ? "+" : "") + latin.replace(/\D/g, "");
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function field(body, key) {
  const raw = body[key];
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, FIELD_LIMITS[key]);
}

function buildMessage(lead) {
  const lines = [
    "🟡 <b>درخواست تماس جدید</b>",
    "",
    `<b>نام:</b> ${escapeHtml(lead.name)}`,
    /* Plain text, not <code>: Telegram only auto-links a bare number. */
    `<b>تلفن:</b> ${escapeHtml(normalizePhone(lead.phone))}`,
  ];
  if (lead.company) lines.push(`<b>شرکت / محصول:</b> ${escapeHtml(lead.company)}`);
  if (lead.message) lines.push("", `<b>توضیح:</b>`, escapeHtml(lead.message));
  lines.push("", `<i>#${lead.id} — ${lead.localTime}</i>`);
  return lines.join("\n");
}

async function sendTelegram(env, text) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(`telegram ${response.status}: ${result.description || "unknown error"}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, env, request);
    }

    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim());
    if (!allowed.includes(origin)) {
      return json({ ok: false, error: "Forbidden" }, 403, env, request);
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) throw new Error("body too large");
      body = JSON.parse(raw);
      if (typeof body !== "object" || body === null) throw new Error("not an object");
    } catch {
      return json({ ok: false, error: "درخواست نامعتبر است." }, 400, env, request);
    }

    /* Honeypot: a hidden field no human ever fills in. Answer 200 so bots
       cannot tell they were caught, but drop the submission. */
    if (field(body, "website")) {
      return json({ ok: true }, 200, env, request);
    }

    const lead = {
      name: field(body, "name"),
      company: field(body, "company"),
      phone: field(body, "phone"),
      message: field(body, "message"),
    };

    if (lead.name.length < 2 || !PHONE_RE.test(lead.phone)) {
      return json({ ok: false, error: "اطلاعات واردشده کامل نیست." }, 400, env, request);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const userAgent = (request.headers.get("User-Agent") || "").slice(0, 300);
    const now = new Date();

    try {
      const since = new Date(now.getTime() - RATE_WINDOW_MIN * 60_000).toISOString();
      const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM leads WHERE ip = ? AND created_at > ?"
      ).bind(ip, since).first();

      if (recent && recent.count >= RATE_MAX) {
        return json(
          { ok: false, error: "تعداد درخواست‌ها زیاد بود. چند دقیقه دیگر تلاش کنید." },
          429, env, request
        );
      }

      const inserted = await env.DB.prepare(
        `INSERT INTO leads (name, company, phone, message, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(
        lead.name, lead.company || null, lead.phone, lead.message || null,
        ip, userAgent, now.toISOString()
      ).first();

      lead.id = inserted.id;
    } catch (error) {
      console.error("d1 insert failed", error);
      return json(
        { ok: false, error: "ثبت درخواست انجام نشد. دوباره تلاش کنید." },
        500, env, request
      );
    }

    /* The lead is safe in D1 from here on. Telegram is best-effort: a failure
       is logged and flagged in the row, but the visitor still gets a success. */
    lead.localTime = new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran",
    }).format(now);

    ctx.waitUntil(
      sendTelegram(env, buildMessage(lead))
        .then(() => env.DB.prepare("UPDATE leads SET telegram_ok = 1 WHERE id = ?").bind(lead.id).run())
        .catch((error) => console.error("telegram send failed", lead.id, error))
    );

    return json({ ok: true }, 200, env, request);
  },
};
