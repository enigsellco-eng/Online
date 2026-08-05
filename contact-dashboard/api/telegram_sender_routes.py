import json
from typing import Any

import httpx
from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


class LoginStart(BaseModel):
    slot: int = Field(ge=1, le=3)
    label: str = Field(min_length=1, max_length=80)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")


class LoginConfirm(BaseModel):
    slot: int = Field(ge=1, le=3)
    code: str = Field(min_length=3, max_length=12)
    password: str | None = Field(default=None, max_length=200)


class StopInput(BaseModel):
    stopped: bool


def install(app, current_session, require_csrf, upstream_json, sender_url: str):
    async def sender_json(method: str, path: str, payload: dict | None = None):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.request(method, f"{sender_url}{path}", json=payload)
        except httpx.HTTPError as error:
            raise HTTPException(503, "سرویس ارسال تلگرام در دسترس نیست.") from error
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", "پاسخ سرویس معتبر نبود.")
            except ValueError:
                detail = "پاسخ سرویس معتبر نبود."
            raise HTTPException(response.status_code, detail)
        return response.json()

    @app.get("/api/marketing/telegram-sender")
    async def dashboard(_: dict[str, Any] = Depends(current_session)):
        return await upstream_json("GET", f"{sender_url}/api/sender/dashboard")

    @app.post("/api/marketing/telegram-sender/accounts/request-code")
    async def request_code(payload: LoginStart, _: dict = Depends(require_csrf)):
        return await sender_json(
            "POST", "/api/sender/accounts/request-code", payload.model_dump()
        )

    @app.post("/api/marketing/telegram-sender/accounts/confirm")
    async def confirm(payload: LoginConfirm, _: dict = Depends(require_csrf)):
        return await sender_json("POST", "/api/sender/accounts/confirm", payload.model_dump())

    @app.post("/api/marketing/telegram-sender/campaigns")
    async def create_campaign(
        name: str = Form(...), message: str = Form(...), batch_size: int = Form(20),
        daily_limit_per_account: int = Form(30), min_delay_seconds: int = Form(300),
        max_delay_seconds: int = Form(900), start_time: str = Form("09:00"),
        end_time: str = Form("18:00"), max_recipients: int = Form(100),
        attachment: UploadFile | None = File(default=None), _: dict = Depends(require_csrf),
    ):
        data = {"name": name, "message": message, "batch_size": str(batch_size),
                "daily_limit_per_account": str(daily_limit_per_account),
                "min_delay_seconds": str(min_delay_seconds),
                "max_delay_seconds": str(max_delay_seconds), "start_time": start_time,
                "end_time": end_time, "max_recipients": str(max_recipients)}
        files = None
        if attachment and attachment.filename:
            content = await attachment.read(25 * 1024 * 1024 + 1)
            if len(content) > 25 * 1024 * 1024:
                raise HTTPException(413, "فایل بیش از ۲۵ مگابایت است.")
            files = {"attachment": (attachment.filename, content, attachment.content_type)}
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{sender_url}/api/sender/campaigns", data=data, files=files
                )
        except httpx.HTTPError as error:
            raise HTTPException(503, "سرویس ارسال تلگرام در دسترس نیست.") from error
        if response.status_code >= 400:
            raise HTTPException(response.status_code, response.json().get("detail", "خطا"))
        return response.json()

    @app.post("/api/marketing/telegram-sender/campaigns/{campaign_id}/{action}")
    async def action(campaign_id: int, action: str, _: dict = Depends(require_csrf)):
        return await sender_json("POST", f"/api/sender/campaigns/{campaign_id}/{action}")

    @app.post("/api/marketing/telegram-sender/emergency-stop")
    async def stop(payload: StopInput, _: dict = Depends(require_csrf)):
        return await sender_json("POST", "/api/sender/emergency-stop", payload.model_dump())

    @app.get("/api/marketing/telegram-sender/ui", response_class=HTMLResponse)
    async def ui(session: dict = Depends(current_session)):
        csrf = json.dumps(session["csrf_token"])
        page = f"""<!doctype html><html lang=fa dir=rtl><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>ارسال تلگرام</title><style>
body{{font-family:system-ui;background:#f4f7fb;color:#172033;margin:0}}main{{max-width:1100px;margin:auto;padding:28px}}section{{background:white;border:1px solid #dfe5ef;border-radius:14px;padding:20px;margin:16px 0}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}}.card{{background:#eef5ff;padding:12px;border-radius:10px}}label{{display:block;margin:8px 0}}input,textarea{{box-sizing:border-box;width:100%;padding:9px;margin:3px 0;border:1px solid #bbc6d8;border-radius:8px}}textarea{{min-height:100px}}button,a{{padding:9px 13px;border:0;border-radius:8px;background:#1769e0;color:white;text-decoration:none;cursor:pointer;margin:3px}}table{{width:100%;border-collapse:collapse}}td,th{{padding:8px;border-bottom:1px solid #e8ecf2;text-align:right}}</style></head><body><main><h1>ارسال کمپین تلگرام</h1><div id=msg></div>
<section><h2>اتصال سه حساب</h2><div id=accounts class=grid></div></section><section><h2>کمپین جدید</h2><form id=campaign><div class=grid><label>نام<input name=name required></label><label>تعداد مخاطب<input name=max_recipients type=number value=100></label><label>اندازه بسته<input name=batch_size type=number value=20></label><label>سقف روزانه هر حساب<input name=daily_limit_per_account type=number value=30></label><label>کمترین فاصله<input name=min_delay_seconds type=number value=300></label><label>بیشترین فاصله<input name=max_delay_seconds type=number value=900></label><label>شروع<input name=start_time type=time value=09:00></label><label>پایان<input name=end_time type=time value=18:00></label></div><label>متن<textarea name=message required></textarea></label><label>فایل<input name=attachment type=file></label><button>ساخت پیش‌نویس</button></form></section>
<section><h2>کمپین‌ها</h2><button onclick='halt(true)'>توقف اضطراری</button><button onclick='halt(false)'>رفع توقف</button><table><thead><tr><th>نام</th><th>وضعیت</th><th>کل</th><th>ارسال</th><th>خطا</th><th>عملیات</th></tr></thead><tbody id=campaigns></tbody></table></section><section><h2>گزارش</h2><div id=sheet>هنوز همگام نشده است.</div></section><script>
const csrf={csrf};const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]));async function api(u,o={{}}){{o.headers={{...(o.headers||{{}}),'X-CSRF-Token':csrf,'Content-Type':'application/json'}};let r=await fetch(u,o),d=await r.json();if(!r.ok)throw Error(d.detail||'خطا');return d}}async function refresh(){{let d=await api('/api/marketing/telegram-sender');accounts.innerHTML=[1,2,3].map(s=>{{let a=d.accounts.find(x=>x.id===s)||{{}};return `<div class=card><b>حساب ${{s}}</b><p>${{esc(a.label)}} — ${{esc(a.phone)}}<br>${{esc(a.status)}}</p><input id=l${{s}} placeholder='نام فروشنده'><input id=p${{s}} placeholder='+989...'><button onclick='code(${{s}})'>دریافت کد</button><input id=c${{s}} placeholder=کد><input id=w${{s}} type=password placeholder='رمز دومرحله‌ای'><button onclick='confirmAccount(${{s}})'>تأیید</button></div>`}}).join('');campaigns.innerHTML=d.campaigns.map(c=>`<tr><td>${{esc(c.name)}}</td><td>${{esc(c.status)}}</td><td>${{c.total||0}}</td><td>${{c.sent||0}}</td><td>${{c.failed||0}}</td><td><button onclick="act(${{c.id}},'start')">شروع</button><button onclick="act(${{c.id}},'pause')">توقف</button><button onclick="act(${{c.id}},'resume')">ادامه</button></td></tr>`).join('');if(d.spreadsheet_url)sheet.innerHTML=`<a target=_blank href='${{esc(d.spreadsheet_url)}}'>Google Sheet</a>`}}async function code(s){{try{{await api('/api/marketing/telegram-sender/accounts/request-code',{{method:'POST',body:JSON.stringify({{slot:s,label:document.getElementById('l'+s).value||('Account '+s),phone:document.getElementById('p'+s).value}})}});msg.textContent='کد ارسال شد';refresh()}}catch(e){{msg.textContent=e.message}}}}async function confirmAccount(s){{try{{await api('/api/marketing/telegram-sender/accounts/confirm',{{method:'POST',body:JSON.stringify({{slot:s,code:document.getElementById('c'+s).value,password:document.getElementById('w'+s).value||null}})}});msg.textContent='حساب متصل شد';refresh()}}catch(e){{msg.textContent=e.message}}}}async function act(i,a){{await api(`/api/marketing/telegram-sender/campaigns/${{i}}/${{a}}`,{{method:'POST',body:'{{}}'}});refresh()}}async function halt(v){{await api('/api/marketing/telegram-sender/emergency-stop',{{method:'POST',body:JSON.stringify({{stopped:v}})}});refresh()}}campaign.onsubmit=async e=>{{e.preventDefault();let r=await fetch('/api/marketing/telegram-sender/campaigns',{{method:'POST',headers:{{'X-CSRF-Token':csrf}},body:new FormData(e.target)}}),d=await r.json();msg.textContent=r.ok?`پیش‌نویس با ${{d.recipients}} مخاطب ساخته شد`:(d.detail||'خطا');refresh()}};refresh();</script></main></body></html>"""
        return HTMLResponse(page, headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})
