# enigsell-contact — Worker فرم تماس

فرم تماس سایت را می‌گیرد، در D1 ذخیره می‌کند و به کانال تلگرام می‌فرستد.

- آدرس: `https://form.enigsell.com`
- دیتابیس D1: `enigsell-leads` (جدول `leads`)
- حساب Cloudflare: `em.ameri94@gmail.com`

## چرا اینجاست

GitHub Pages فقط فایل استاتیک سرو می‌کند. توکن ربات تلگرام نباید داخل مرورگر
برود، چون هر بازدیدکننده‌ای می‌تواند آن را بخواند. این Worker واسطه است: توکن
پیش او می‌ماند و سایت فقط یک درخواست بدون اعتبارنامه به آن می‌زند.

## ترتیب کار (مهم)

لید **اول** در D1 نوشته می‌شود، **بعد** به تلگرام می‌رود. اگر تلگرام قطع باشد،
فقط اعلان از دست می‌رود، نه لید. ردیف با `telegram_ok = 0` می‌ماند تا بعداً
مشخص باشد کدام اعلان‌ها نرسیده‌اند.

## secrets

داخل این ریپو نیستند و نباید باشند. با این دستورها ست می‌شوند:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

## محافظت‌ها

| مورد | رفتار |
| --- | --- |
| CORS | فقط `https://enigsell.com`؛ بقیه `403` |
| متد | فقط `POST` و `OPTIONS`؛ بقیه `405` |
| حجم بدنه | حداکثر ۸ کیلوبایت |
| ولیدیشن | نام حداقل ۲ نویسه، شماره با الگوی مجاز |
| محدودیت نرخ | حداکثر ۵ ثبت از هر IP در ۱۰ دقیقه → `429` |
| فیلد تله | فیلد پنهان `website`؛ اگر پر باشد `ok:true` برمی‌گرداند ولی ذخیره نمی‌کند |

## دستورهای مفید

```bash
# دیدن لیدها
npx wrangler d1 execute enigsell-leads --remote \
  --command "SELECT id,name,phone,company,telegram_ok,created_at FROM leads ORDER BY id DESC LIMIT 20"

# لیدهایی که اعلان تلگرامشان نرفته
npx wrangler d1 execute enigsell-leads --remote \
  --command "SELECT * FROM leads WHERE telegram_ok = 0"

# لاگ زنده
npx wrangler tail

# دیپلوی
npx wrangler deploy
```

## اعمال schema روی دیتابیس

```bash
npx wrangler d1 execute enigsell-leads --remote --file=schema.sql
```
