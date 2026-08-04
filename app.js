/* Enigsell landing page — static build for GitHub Pages */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * پیکربندی
   * ------------------------------------------------------------------
   * CONTACT_ENDPOINT: آدرس کامل endpointی که فرم تماس را دریافت می‌کند.
   * GitHub Pages فقط فایل استاتیک سرو می‌کند و بک‌اند ندارد، پس این آدرس
   * باید به یک سرویس بیرونی اشاره کند (مثلاً همان api.enigsell.com یا یک
   * Cloudflare Worker که پیام را به ربات تلگرام می‌فرستد).
   *
   * تا وقتی این مقدار خالی باشد، فرم وانمود نمی‌کند که ثبت شده؛ به کاربر
   * می‌گوید با شماره تماس بگیرد.
   *
   * ⚠️ هیچ‌وقت توکن ربات تلگرام را اینجا نگذارید — این فایل عمومی است.
   * توکن باید در سمت سرور/Worker بماند.
   * ------------------------------------------------------------------ */
  var CONTACT_ENDPOINT = "";

  /* ---------------------------- تم رنگی ---------------------------- */
  var main = document.querySelector("main");
  var themeButtons = document.querySelectorAll(".theme-picker button");

  Array.prototype.forEach.call(themeButtons, function (button) {
    button.addEventListener("click", function () {
      main.setAttribute("data-theme", button.dataset.color);
      Array.prototype.forEach.call(themeButtons, function (other) {
        other.classList.toggle("selected", other === button);
      });
    });
  });

  /* --------------------------- فرم تماس ---------------------------- */
  var form = document.getElementById("lead-form");
  if (!form) return;

  var statusEl = document.getElementById("form-status");
  var submitButton = form.querySelector("button[type=submit]");
  var buttonLabel = submitButton.querySelector(".btn-label");
  var PHONE_PATTERN = /^[۰-۹0-9+()\-\s]{7,40}$/;

  function setStatus(kind, text) {
    statusEl.className = "form-status " + kind;
    statusEl.textContent = text;
    statusEl.hidden = false;
  }

  function setSending(sending) {
    submitButton.disabled = sending;
    buttonLabel.textContent = sending ? "در حال ثبت…" : "ثبت درخواست تماس";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var data = {
      name: (form.elements.name.value || "").trim().slice(0, 100),
      company: (form.elements.company.value || "").trim().slice(0, 160),
      phone: (form.elements.phone.value || "").trim().slice(0, 40),
      message: (form.elements.message.value || "").trim().slice(0, 1000)
    };

    if (data.name.length < 2 || !PHONE_PATTERN.test(data.phone)) {
      setStatus("error", "لطفاً نام و شماره تماس را درست وارد کنید.");
      return;
    }

    if (!CONTACT_ENDPOINT) {
      setStatus(
        "error",
        "ارسال آنلاین فرم هنوز فعال نشده است. لطفاً با شماره بالا تماس بگیرید."
      );
      return;
    }

    setSending(true);
    setStatus("sending", "در حال ثبت درخواست…");

    fetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (result) {
            if (!response.ok || result.ok === false) {
              throw new Error(result.error || "ثبت درخواست انجام نشد.");
            }
          });
      })
      .then(function () {
        form.reset();
        setStatus("success", "درخواست شما ثبت شد. به‌زودی با شما تماس می‌گیریم.");
      })
      .catch(function (error) {
        setStatus(
          "error",
          error && error.message ? error.message : "ثبت درخواست انجام نشد. دوباره تلاش کنید."
        );
      })
      .then(function () {
        setSending(false);
      });
  });
})();
