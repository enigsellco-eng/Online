# Enigsell — سایت اصلی

لندینگ‌پیج انیگسل، به‌صورت **استاتیک** روی GitHub Pages منتشر می‌شود.

- آدرس: <https://enigsell.com/>
- انتشار: GitHub Pages از شاخه `main` و مسیر `/` (ریشه ریپو)
- داشبورد بازاریابی (جدا و بدون تغییر): <https://enigsell.com/contact-dashboard/>

## فایل‌ها

| فایل | توضیح |
| --- | --- |
| `index.html` | کل ساختار و محتوای صفحه |
| `styles.css` | طراحی کامل، RTL و responsive |
| `app.js` | انتخاب تم رنگی + ارسال فرم تماس |
| `fonts/` | فونت فارسی Vazirmatn (۴ وزن، woff2) |
| `enigsell-mark.png`, `enigsell-logo-full.png`, `favicon.svg` | هویت بصری |
| `hero-market-flow.webp` / `.jpg` | تصویر هدر (webp با fallback به jpg) |
| `CNAME` | دامنه اختصاصی |
| `.nojekyll` | غیرفعال‌کردن پردازش Jekyll در GitHub Pages |

منبع اصلی طراحی: پوشه `enigsell-yellow-source` (نسخه Next.js/Cloudflare). این ریپو
نسخه استاتیک همان صفحه است، چون GitHub Pages بک‌اند اجرا نمی‌کند.

## اتصال فرم تماس

GitHub Pages فقط فایل استاتیک سرو می‌کند و هیچ کد سمت‌سروری اجرا نمی‌کند، پس مسیر
`/api/contact` نسخه اصلی اینجا کار نمی‌کند. فرم باید به یک endpoint بیرونی وصل شود.

فرم به Worker زیر وصل است (سورس در `contact-worker/`):

```js
var CONTACT_ENDPOINT = "https://form.enigsell.com";
```

Worker لید را در دیتابیس D1 ذخیره می‌کند و سپس به کانال تلگرام
«Enigsell Webform» می‌فرستد. جزئیات در `contact-worker/README.md`.

فرم یک `POST` با بدنه JSON می‌فرستد:

```json
{ "name": "...", "company": "...", "phone": "...", "message": "..." }
```

و انتظار پاسخ `{"ok": true}` را دارد. در صورت خطا، اگر `{"ok": false, "error": "..."}`
برگردد همان متن به کاربر نمایش داده می‌شود.

سمت سرور باید:

- هدر CORS بدهد: `Access-Control-Allow-Origin: https://enigsell.com`
- به `OPTIONS` (preflight) پاسخ بدهد
- ورودی را دوباره validate و sanitize کند
- rate limit داشته باشد

اگر `CONTACT_ENDPOINT` خالی شود، فرم وانمود نمی‌کند که ثبت شده و به کاربر
می‌گوید با شماره تماس بگیرد.

> ⚠️ **توکن ربات تلگرام هرگز نباید داخل این ریپو یا `app.js` قرار بگیرد.**
> این فایل‌ها عمومی هستند. توکن باید فقط سمت سرور (یا Cloudflare Worker) بماند و
> Worker پیام را به تلگرام بفرستد.

## مقادیر جایگزین‌شدنی (هنوز placeholder هستند)

در `index.html` هرکدام با کامنت `<!-- PLACEHOLDER: ... -->` علامت خورده‌اند:

| مورد | مقدار فعلی | جای استفاده |
| --- | --- | --- |
| شماره تماس | `tel:+989120000000` و متن `۰۹۱۲ ۰۰۰ ۰۰۰۰` | هدر و بخش تماس (۲ جا) |
| اینستاگرام | `#` | هدر |
| لینکدین | `#` | هدر |
| تلگرام | `#` | هدر |
| واتس‌اپ | `https://wa.me/989120000000` | هدر |

## اجرای محلی

```bash
python3 -m http.server 4321
```

سپس <http://localhost:4321>
