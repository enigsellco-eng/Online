from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


APP_NAME = "Enigsell Marketing Dashboard API"
DATABASE_PATH = Path(
    os.getenv(
        "MARKETING_DATABASE_PATH",
        "/home/agmentic/enigsell-marketing-dashboard-api/data/marketing.sqlite3",
    )
)
ALLOWED_ORIGIN = os.getenv("MARKETING_ALLOWED_ORIGIN", "https://enigsell.com")
COOKIE_NAME = os.getenv("MARKETING_SESSION_COOKIE", "enigsell_marketing_session")
SESSION_HOURS = int(os.getenv("MARKETING_SESSION_HOURS", "12"))
BEHTARINO_API = os.getenv("MARKETING_BEHTARINO_API", "http://127.0.0.1:8031")
TAKHFIFAN_API = os.getenv("MARKETING_TAKHFIFAN_API", "http://127.0.0.1:8051")
DIVAR_API = os.getenv("MARKETING_DIVAR_API", "http://127.0.0.1:8032")
SENFYAB_API = os.getenv("MARKETING_SENFYAB_API", "http://127.0.0.1:8061")
FOODKEYS_API = os.getenv("MARKETING_FOODKEYS_API", "http://127.0.0.1:8071")
TOROB_API = os.getenv("MARKETING_TOROB_API", "http://127.0.0.1:8040")
UPSTREAM_TIMEOUT = float(os.getenv("MARKETING_UPSTREAM_TIMEOUT_SECONDS", "5"))

login_attempts: dict[str, list[float]] = {}


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso_now() -> str:
    return utc_now().isoformat()


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def migrate() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                csrf_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                action TEXT NOT NULL,
                source_key TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                remote_ip TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
                ON audit_log(created_at DESC);
            """
        )
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (iso_now(),))


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**15,
        r=8,
        p=1,
        dklen=32,
        maxmem=64 * 1024 * 1024,
    )
    return f"scrypt$32768$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, expected_hex = encoded.split("$")
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(bytes.fromhex(expected_hex)),
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(derived.hex(), expected_hex)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)


class BehtarinoInput(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=80)


class TakhfifanInput(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=80)
    category: str = Field(min_length=2, max_length=120)


class TakhfifanExportInput(TakhfifanInput):
    from_contact_no: int = Field(gt=0)
    to_contact_no: int = Field(gt=0)
    confirm_delivery: bool = False


class BehtarinoExportInput(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=80)
    from_contact_no: int = Field(gt=0)
    to_contact_no: int = Field(gt=0)
    confirm_delivery: bool = False


class DivarInput(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=80)
    category: str = Field(min_length=2, max_length=120)
    subcategory: str = Field(min_length=2, max_length=160)


class DivarExportInput(DivarInput):
    from_contact_no: int = Field(gt=0)
    to_contact_no: int = Field(gt=0)
    confirm_delivery: bool = False


class SenfyabInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=120)
    subcategory: str = Field(min_length=1, max_length=160)


class FoodkeysInput(BaseModel):
    category: str = Field(
        min_length=1,
        max_length=120,
        pattern=r"^[A-Za-z0-9_-]+$",
    )


class FoodkeysExportInput(FoodkeysInput):
    from_contact_no: int = Field(gt=0)
    to_contact_no: int = Field(gt=0)
    confirm_delivery: bool = False


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("CF-Connecting-IP")
    return forwarded or (request.client.host if request.client else "unknown")


def enforce_login_rate_limit(request: Request) -> None:
    ip = client_ip(request)
    now = time.monotonic()
    recent = [stamp for stamp in login_attempts.get(ip, []) if now - stamp < 900]
    if len(recent) >= 10:
        raise HTTPException(429, "تعداد تلاش‌های ورود بیش از حد مجاز است.")
    recent.append(now)
    login_attempts[ip] = recent


def current_session(
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict[str, Any]:
    if not session_token:
        raise HTTPException(401, "ورود به حساب لازم است.")
    with connect() as db:
        row = db.execute(
            """
            SELECT sessions.*, users.email, users.display_name, users.enabled
            FROM sessions JOIN users ON users.id=sessions.user_id
            WHERE sessions.token_hash=? AND sessions.expires_at>?
            """,
            (token_hash(session_token), iso_now()),
        ).fetchone()
        if not row or not row["enabled"]:
            raise HTTPException(401, "نشست معتبر نیست.")
        db.execute(
            "UPDATE sessions SET last_seen_at=? WHERE token_hash=?",
            (iso_now(), token_hash(session_token)),
        )
        return dict(row)


def require_csrf(
    session: dict[str, Any] = Depends(current_session),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    if not csrf_token or not hmac.compare_digest(csrf_token, session["csrf_token"]):
        raise HTTPException(403, "توکن امنیتی معتبر نیست.")
    return session


async def upstream_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
            response = await client.request(method, url, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(503, "سرویس منبع در دسترس نیست.") from error
    if response.status_code >= 400:
        raise HTTPException(502, "پاسخ سرویس منبع معتبر نبود.")
    return response.json()


async def upstream_file(
    method: str,
    url: str,
    payload: dict[str, Any],
) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(method, url, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(503, "سرویس خروجی بهترینو در دسترس نیست.") from error
    if response.status_code >= 400:
        detail = "ساخت فایل خروجی ناموفق بود."
        try:
            detail = response.json().get("detail", detail)
        except ValueError:
            pass
        raise HTTPException(response.status_code, detail)
    return response


async def source_summary(source_key: str) -> dict[str, Any]:
    if source_key == "torob":
        try:
            data = await upstream_json("GET", f"{TOROB_API}/api/status")
            runtime = data.get("runtime") or {}
            return {
                "key": "torob",
                "name": "ترب",
                "available": True,
                "configuration_enabled": False,
                "contacts": (data.get("counts") or {}).get("leads", 0),
                "records": (data.get("counts") or {}).get("products", 0),
                "status": runtime.get("state", "unknown"),
                "last_run": None,
                "recent_runs": [],
            }
        except HTTPException:
            return unavailable_source("torob", "ترب")

    bases = {
        "behtarino": BEHTARINO_API,
        "takhfifan": TAKHFIFAN_API,
        "divar": DIVAR_API,
        "senfyab": SENFYAB_API,
        "foodkeys": FOODKEYS_API,
    }
    names = {
        "behtarino": "بهترینو",
        "takhfifan": "تخفیفان",
        "divar": "دیوار",
        "senfyab": "صنفیاب",
        "foodkeys": "فودکیز",
    }
    base = bases[source_key]
    name = names[source_key]
    try:
        data = await upstream_json(
            "GET", f"{base}/api/sources/{source_key}/dashboard"
        )
        runs = data.get("recent_runs") or []
        counts = data.get("counts") or {}
        return {
            "key": source_key,
            "name": name,
            "available": True,
            "configuration_enabled": source_key
            in {"behtarino", "takhfifan", "divar", "senfyab", "foodkeys"},
            "contacts": counts.get("contacts", 0),
            "records": counts.get("listings", 0),
            "status": runs[0].get("status", "idle") if runs else "idle",
            "last_run": runs[0] if runs else None,
            "recent_runs": runs,
        }
    except HTTPException:
        return unavailable_source(source_key, name)


def unavailable_source(key: str, name: str) -> dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "available": False,
        "configuration_enabled": False,
        "contacts": None,
        "records": None,
        "status": "unavailable",
        "last_run": None,
        "recent_runs": [],
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    migrate()
    yield


app = FastAPI(
    title=APP_NAME,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.get("/api/marketing/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "enigsell-marketing-dashboard"}


@app.post("/api/marketing/auth/login")
def login(payload: LoginInput, request: Request, response: Response) -> dict[str, Any]:
    enforce_login_rate_limit(request)
    email = payload.email.strip().lower()
    with connect() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email=? AND enabled=1", (email,)
        ).fetchone()
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(401, "ایمیل یا رمز عبور نادرست است.")

        raw_token = secrets.token_urlsafe(48)
        csrf_token = secrets.token_urlsafe(32)
        expires_at = utc_now() + timedelta(hours=SESSION_HOURS)
        db.execute(
            """
            INSERT INTO sessions
                (token_hash,user_id,csrf_token,expires_at,created_at,last_seen_at)
            VALUES (?,?,?,?,?,?)
            """,
            (
                token_hash(raw_token),
                user["id"],
                csrf_token,
                expires_at.isoformat(),
                iso_now(),
                iso_now(),
            ),
        )

    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api/marketing",
    )
    return {
        "user": {"email": user["email"], "display_name": user["display_name"]},
        "csrf_token": csrf_token,
    }


@app.get("/api/marketing/auth/me")
def me(session: dict[str, Any] = Depends(current_session)) -> dict[str, Any]:
    return {
        "user": {
            "email": session["email"],
            "display_name": session["display_name"],
        },
        "csrf_token": session["csrf_token"],
    }


@app.post("/api/marketing/auth/logout")
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    _: dict[str, Any] = Depends(require_csrf),
) -> dict[str, bool]:
    if session_token:
        with connect() as db:
            db.execute(
                "DELETE FROM sessions WHERE token_hash=?", (token_hash(session_token),)
            )
    response.delete_cookie(COOKIE_NAME, path="/api/marketing")
    return {"ok": True}


@app.get("/api/marketing/overview")
async def overview(_: dict[str, Any] = Depends(current_session)) -> dict[str, Any]:
    sources = list(
        await asyncio.gather(
            source_summary("behtarino"),
            source_summary("takhfifan"),
            source_summary("torob"),
            source_summary("divar"),
            source_summary("senfyab"),
            source_summary("foodkeys"),
        )
    )
    return {
        "sources": sources,
        "total_contacts": sum(
            source["contacts"] or 0 for source in sources if source["available"]
        ),
        "updated_at": iso_now(),
    }


@app.get("/api/marketing/sources/{source_key}")
async def source_detail(
    source_key: str, _: dict[str, Any] = Depends(current_session)
) -> dict[str, Any]:
    if source_key not in {
        "behtarino", "takhfifan", "torob", "divar", "senfyab", "foodkeys"
    }:
        raise HTTPException(404, "منبع پیدا نشد.")
    summary = await source_summary(source_key)
    if source_key in {
        "behtarino", "takhfifan", "divar", "senfyab", "foodkeys"
    } and summary["available"]:
        base = {
            "behtarino": BEHTARINO_API,
            "takhfifan": TAKHFIFAN_API,
            "divar": DIVAR_API,
            "senfyab": SENFYAB_API,
            "foodkeys": FOODKEYS_API,
        }[source_key]
        jobs = await upstream_json(
            "GET", f"{base}/api/sources/{source_key}/jobs"
        )
        job = jobs[0] if jobs else None
        summary["input"] = (
            {
                "name": job.get("name") or "",
                "keyword": job.get("query") or "",
                "city": job.get("city") or "",
                "category": job.get("category") or "",
                "subcategory": job.get("subcategory") or "",
                "updated_at": job.get("updated_at"),
            }
            if job
            else None
        )
    elif source_key == "torob":
        try:
            status = await upstream_json("GET", f"{TOROB_API}/api/status")
            summary["input"] = {
                "keyword": (status.get("settings") or {}).get("search_term", "")
            }
        except HTTPException:
            summary["input"] = {"keyword": ""}
    return summary


@app.get("/api/marketing/sources/{source_key}/runs")
async def run_history(
    source_key: str, _: dict[str, Any] = Depends(current_session)
) -> dict[str, Any]:
    if source_key not in {
        "behtarino", "takhfifan", "torob", "divar", "senfyab", "foodkeys"
    }:
        raise HTTPException(404, "منبع پیدا نشد.")
    summary = await source_summary(source_key)
    return {"items": summary["recent_runs"]}


@app.get("/api/marketing/sources/{source_key}/settings-history")
async def settings_history(
    source_key: str, _: dict[str, Any] = Depends(current_session)
) -> dict[str, Any]:
    if source_key not in {
        "behtarino", "takhfifan", "torob", "divar", "senfyab", "foodkeys"
    }:
        raise HTTPException(404, "منبع پیدا نشد.")
    if source_key == "torob":
        return {"items": []}
    base = {
        "behtarino": BEHTARINO_API,
        "takhfifan": TAKHFIFAN_API,
        "divar": DIVAR_API,
        "senfyab": SENFYAB_API,
        "foodkeys": FOODKEYS_API,
    }[source_key]
    jobs = await upstream_json("GET", f"{base}/api/sources/{source_key}/jobs")
    if not jobs:
        return {"items": []}
    items = await upstream_json(
        "GET",
        f"{base}/api/sources/{source_key}/jobs/{jobs[0]['id']}/history?limit=30",
    )
    return {"items": items}


@app.put("/api/marketing/sources/senfyab/input")
async def update_senfyab_input(
    payload: SenfyabInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> dict[str, Any]:
    values = {
        key: " ".join(value.split())
        for key, value in payload.model_dump().items()
    }
    jobs = await upstream_json(
        "GET", f"{SENFYAB_API}/api/sources/senfyab/jobs"
    )
    before: dict[str, Any] = {}
    if jobs:
        job = jobs[0]
        before = {
            "name": job.get("name") or "",
            "category": job.get("category") or "",
            "subcategory": job.get("subcategory") or "",
        }
        try:
            settings = json.loads(job.get("settings_json") or "{}")
        except json.JSONDecodeError:
            settings = {}
        updated = await upstream_json(
            "PUT",
            f"{SENFYAB_API}/api/sources/senfyab/jobs/{job['id']}",
            {
                "name": values["name"],
                "city": job.get("city") or "",
                "category": values["category"],
                "subcategory": values["subcategory"],
                "query": job.get("query") or "",
                "enabled": bool(job.get("enabled", True)),
                "schedule": job.get("schedule") or "batch",
                "result_limit": job.get("result_limit") or 24,
                "destination_sheet": job.get("destination_sheet") or "Senfyab",
                "settings": settings,
            },
        )
    else:
        updated = await upstream_json(
            "POST",
            f"{SENFYAB_API}/api/sources/senfyab/jobs",
            {
                "name": values["name"],
                "source_key": "senfyab",
                "city": "",
                "category": values["category"],
                "subcategory": values["subcategory"],
                "query": "",
                "enabled": True,
                "schedule": "batch",
                "result_limit": 24,
                "destination_sheet": "Senfyab",
                "settings": {},
            },
        )
    with connect() as db:
        db.execute(
            """
            INSERT INTO audit_log
                (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                "update_marketing_input",
                "senfyab",
                json.dumps(before, ensure_ascii=False),
                json.dumps(values, ensure_ascii=False),
                client_ip(request),
                iso_now(),
            ),
        )
    return {
        "input": {
            "name": updated.get("name") or values["name"],
            "category": updated.get("category") or values["category"],
            "subcategory": updated.get("subcategory") or values["subcategory"],
            "updated_at": updated.get("updated_at"),
        }
    }


@app.put("/api/marketing/sources/foodkeys/input")
async def update_foodkeys_input(
    payload: FoodkeysInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> dict[str, Any]:
    category = payload.category.strip()
    jobs = await upstream_json(
        "GET", f"{FOODKEYS_API}/api/sources/foodkeys/jobs"
    )
    if not jobs:
        raise HTTPException(409, "Job فودکیز هنوز ساخته نشده است.")
    job = jobs[0]
    try:
        settings = json.loads(job.get("settings_json") or "{}")
    except json.JSONDecodeError:
        settings = {}
    before = {"category": job.get("query") or ""}
    updated = await upstream_json(
        "PUT",
        f"{FOODKEYS_API}/api/sources/foodkeys/jobs/{job['id']}",
        {
            "name": job.get("name") or "FoodKeys",
            "city": job.get("city") or "",
            "category": job.get("category"),
            "subcategory": job.get("subcategory"),
            "query": category,
            "enabled": bool(job.get("enabled", True)),
            "schedule": job.get("schedule") or "batch",
            "result_limit": job.get("result_limit") or 24,
            "destination_sheet": job.get("destination_sheet") or "Businesses",
            "settings": settings,
        },
    )
    after = {"category": category}
    with connect() as db:
        db.execute(
            """
            INSERT INTO audit_log
                (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                "update_marketing_input",
                "foodkeys",
                json.dumps(before, ensure_ascii=False),
                json.dumps(after, ensure_ascii=False),
                client_ip(request),
                iso_now(),
            ),
        )
    return {
        "input": {
            "category": updated.get("query") or category,
            "updated_at": updated.get("updated_at"),
        }
    }


@app.put("/api/marketing/sources/behtarino/input")
async def update_behtarino_input(
    payload: BehtarinoInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> dict[str, Any]:
    keyword = " ".join(payload.keyword.split())
    city = " ".join(payload.city.split())
    jobs = await upstream_json(
        "GET", f"{BEHTARINO_API}/api/sources/behtarino/jobs"
    )
    if not jobs:
        raise HTTPException(409, "Job بهترینو هنوز ساخته نشده است.")
    job = jobs[0]
    try:
        settings = json.loads(job.get("settings_json") or "{}")
    except json.JSONDecodeError:
        settings = {}

    before = {"keyword": job.get("query") or "", "city": job.get("city") or ""}
    update_payload = {
        "name": job["name"],
        "city": city,
        "category": job.get("category"),
        "subcategory": job.get("subcategory"),
        "query": keyword,
        "enabled": bool(job.get("enabled", True)),
        "schedule": job.get("schedule"),
        "result_limit": job["result_limit"],
        "destination_sheet": job["destination_sheet"],
        "settings": settings,
    }
    updated = await upstream_json(
        "PUT",
        f"{BEHTARINO_API}/api/sources/behtarino/jobs/{job['id']}",
        update_payload,
    )
    after = {"keyword": keyword, "city": city}
    with connect() as db:
        db.execute(
            """
            INSERT INTO audit_log
                (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                "update_marketing_input",
                "behtarino",
                json.dumps(before, ensure_ascii=False),
                json.dumps(after, ensure_ascii=False),
                client_ip(request),
                iso_now(),
            ),
        )
    return {
        "input": {
            "keyword": updated.get("query") or keyword,
            "city": updated.get("city") or city,
            "updated_at": updated.get("updated_at"),
        }
    }


@app.put("/api/marketing/sources/divar/input")
async def update_divar_input(
    payload: DivarInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> dict[str, Any]:
    values = {
        key: " ".join(value.split())
        for key, value in payload.model_dump().items()
    }
    jobs = await upstream_json("GET", f"{DIVAR_API}/api/sources/divar/jobs")
    if not jobs:
        raise HTTPException(409, "Job دیوار هنوز ساخته نشده است.")
    job = jobs[0]
    try:
        settings = json.loads(job.get("settings_json") or "{}")
    except json.JSONDecodeError:
        settings = {}
    before = {
        "keyword": job.get("query") or "",
        "city": job.get("city") or "",
        "category": job.get("category") or "",
        "subcategory": job.get("subcategory") or "",
    }
    updated = await upstream_json(
        "PUT",
        f"{DIVAR_API}/api/sources/divar/jobs/{job['id']}",
        {
            "name": job["name"],
            "city": values["city"],
            "category": values["category"],
            "subcategory": values["subcategory"],
            "query": values["keyword"],
            "enabled": bool(job.get("enabled", True)),
            "schedule": job.get("schedule"),
            "result_limit": job["result_limit"],
            "destination_sheet": job["destination_sheet"],
            "settings": settings,
        },
    )
    with connect() as db:
        db.execute(
            """
            INSERT INTO audit_log
                (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                "update_marketing_input",
                "divar",
                json.dumps(before, ensure_ascii=False),
                json.dumps(values, ensure_ascii=False),
                client_ip(request),
                iso_now(),
            ),
        )
    return {
        "input": {
            "keyword": updated.get("query") or values["keyword"],
            "city": updated.get("city") or values["city"],
            "category": updated.get("category") or values["category"],
            "subcategory": updated.get("subcategory") or values["subcategory"],
            "updated_at": updated.get("updated_at"),
        }
    }


@app.put("/api/marketing/sources/takhfifan/input")
async def update_takhfifan_input(
    payload: TakhfifanInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> dict[str, Any]:
    values = {
        key: " ".join(value.split())
        for key, value in payload.model_dump().items()
    }
    jobs = await upstream_json(
        "GET", f"{TAKHFIFAN_API}/api/sources/takhfifan/jobs"
    )
    if not jobs:
        raise HTTPException(409, "Job تخفیفان هنوز ساخته نشده است.")
    job = jobs[0]
    try:
        settings = json.loads(job.get("settings_json") or "{}")
    except json.JSONDecodeError:
        settings = {}
    before = {
        "keyword": job.get("query") or "",
        "city": job.get("city") or "",
        "category": job.get("category") or "",
    }
    updated = await upstream_json(
        "PUT",
        f"{TAKHFIFAN_API}/api/sources/takhfifan/jobs/{job['id']}",
        {
            "name": job["name"],
            "city": values["city"],
            "category": values["category"],
            "subcategory": job.get("subcategory"),
            "query": values["keyword"],
            "enabled": bool(job.get("enabled", True)),
            "schedule": job.get("schedule"),
            "result_limit": job["result_limit"],
            "destination_sheet": job["destination_sheet"],
            "settings": settings,
        },
    )
    with connect() as db:
        db.execute(
            """
            INSERT INTO audit_log
                (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                "update_marketing_input",
                "takhfifan",
                json.dumps(before, ensure_ascii=False),
                json.dumps(values, ensure_ascii=False),
                client_ip(request),
                iso_now(),
            ),
        )
    return {
        "input": {
            "keyword": updated.get("query") or values["keyword"],
            "city": updated.get("city") or values["city"],
            "category": updated.get("category") or values["category"],
            "updated_at": updated.get("updated_at"),
        }
    }


@app.get("/api/marketing/sources/behtarino/exports/summary")
async def behtarino_export_summary(
    keyword: str,
    city: str,
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    filters = urlencode(
        {
            "query": " ".join(keyword.split()),
            "city": " ".join(city.split()),
        }
    )
    return await upstream_json(
        "GET",
        f"{BEHTARINO_API}/api/sources/behtarino/exports/summary?{filters}",
    )


@app.get("/api/marketing/sources/behtarino/exports/history")
async def behtarino_export_history(
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    items = await upstream_json(
        "GET",
        f"{BEHTARINO_API}/api/sources/behtarino/exports/history?limit=30",
    )
    return {"items": items}


@app.post("/api/marketing/sources/behtarino/exports/xlsx")
async def behtarino_export_xlsx(
    payload: BehtarinoExportInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> Response:
    if payload.to_contact_no < payload.from_contact_no:
        raise HTTPException(400, "بازه شماره کانتکت معتبر نیست.")
    upstream = await upstream_file(
        "POST",
        f"{BEHTARINO_API}/api/sources/behtarino/exports/xlsx",
        {
            "query": " ".join(payload.keyword.split()),
            "city": " ".join(payload.city.split()),
            "from_contact_no": payload.from_contact_no,
            "to_contact_no": payload.to_contact_no,
            "confirm_delivery": payload.confirm_delivery,
        },
    )
    if payload.confirm_delivery:
        with connect() as db:
            db.execute(
                """
                INSERT INTO audit_log
                    (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    session["user_id"],
                    "deliver_contact_export",
                    "behtarino",
                    None,
                    json.dumps(payload.model_dump(), ensure_ascii=False),
                    client_ip(request),
                    iso_now(),
                ),
            )
    return Response(
        content=upstream.content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": upstream.headers.get(
                "content-disposition",
                'attachment; filename="behtarino-contacts.xlsx"',
            ),
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/marketing/sources/foodkeys/exports/summary")
async def foodkeys_export_summary(
    category: str,
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    filters = urlencode({"query": category.strip()})
    return await upstream_json(
        "GET",
        f"{FOODKEYS_API}/api/sources/foodkeys/exports/summary?{filters}",
    )


@app.get("/api/marketing/sources/foodkeys/exports/history")
async def foodkeys_export_history(
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    items = await upstream_json(
        "GET",
        f"{FOODKEYS_API}/api/sources/foodkeys/exports/history?limit=30",
    )
    return {"items": items}


@app.post("/api/marketing/sources/foodkeys/exports/xlsx")
async def foodkeys_export_xlsx(
    payload: FoodkeysExportInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> Response:
    if payload.to_contact_no < payload.from_contact_no:
        raise HTTPException(400, "بازه شماره کانتکت معتبر نیست.")
    upstream = await upstream_file(
        "POST",
        f"{FOODKEYS_API}/api/sources/foodkeys/exports/xlsx",
        {
            "query": payload.category.strip(),
            "from_contact_no": payload.from_contact_no,
            "to_contact_no": payload.to_contact_no,
            "confirm_delivery": payload.confirm_delivery,
        },
    )
    if payload.confirm_delivery:
        with connect() as db:
            db.execute(
                """
                INSERT INTO audit_log
                    (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    session["user_id"],
                    "deliver_contact_export",
                    "foodkeys",
                    None,
                    json.dumps(payload.model_dump(), ensure_ascii=False),
                    client_ip(request),
                    iso_now(),
                ),
            )
    return Response(
        content=upstream.content,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": upstream.headers.get(
                "content-disposition",
                'attachment; filename="foodkeys-contacts.xlsx"',
            ),
            "Cache-Control": "no-store",
        },
    )


def takhfifan_filters(values: dict[str, Any]) -> dict[str, str]:
    return {
        "query": " ".join(values["keyword"].split()),
        "city": " ".join(values["city"].split()),
        "category": " ".join(values["category"].split()),
    }


@app.get("/api/marketing/sources/takhfifan/exports/summary")
async def takhfifan_export_summary(
    keyword: str,
    city: str,
    category: str,
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    filters = urlencode(
        takhfifan_filters(
            {"keyword": keyword, "city": city, "category": category}
        )
    )
    return await upstream_json(
        "GET",
        f"{TAKHFIFAN_API}/api/sources/takhfifan/exports/summary?{filters}",
    )


@app.get("/api/marketing/sources/takhfifan/exports/history")
async def takhfifan_export_history(
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    items = await upstream_json(
        "GET",
        f"{TAKHFIFAN_API}/api/sources/takhfifan/exports/history?limit=30",
    )
    return {"items": items}


@app.post("/api/marketing/sources/takhfifan/exports/xlsx")
async def takhfifan_export_xlsx(
    payload: TakhfifanExportInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> Response:
    if payload.to_contact_no < payload.from_contact_no:
        raise HTTPException(400, "بازه شماره کانتکت معتبر نیست.")
    upstream = await upstream_file(
        "POST",
        f"{TAKHFIFAN_API}/api/sources/takhfifan/exports/xlsx",
        {
            **takhfifan_filters(payload.model_dump()),
            "from_contact_no": payload.from_contact_no,
            "to_contact_no": payload.to_contact_no,
            "confirm_delivery": payload.confirm_delivery,
        },
    )
    if payload.confirm_delivery:
        with connect() as db:
            db.execute(
                """
                INSERT INTO audit_log
                    (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    session["user_id"],
                    "deliver_contact_export",
                    "takhfifan",
                    None,
                    json.dumps(payload.model_dump(), ensure_ascii=False),
                    client_ip(request),
                    iso_now(),
                ),
            )
    return Response(
        content=upstream.content,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": upstream.headers.get(
                "content-disposition",
                'attachment; filename="takhfifan-contacts.xlsx"',
            ),
            "Cache-Control": "no-store",
        },
    )


def divar_filters(values: dict[str, Any]) -> dict[str, str]:
    return {
        "query": " ".join(values["keyword"].split()),
        "city": " ".join(values["city"].split()),
        "category": " ".join(values["category"].split()),
        "subcategory": " ".join(values["subcategory"].split()),
    }


@app.get("/api/marketing/sources/divar/exports/summary")
async def divar_export_summary(
    keyword: str,
    city: str,
    category: str,
    subcategory: str,
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    filters = urlencode(
        divar_filters(
            {
                "keyword": keyword,
                "city": city,
                "category": category,
                "subcategory": subcategory,
            }
        )
    )
    return await upstream_json(
        "GET", f"{DIVAR_API}/api/sources/divar/exports/summary?{filters}"
    )


@app.get("/api/marketing/sources/divar/exports/history")
async def divar_export_history(
    _: dict[str, Any] = Depends(current_session),
) -> dict[str, Any]:
    items = await upstream_json(
        "GET", f"{DIVAR_API}/api/sources/divar/exports/history?limit=30"
    )
    return {"items": items}


@app.post("/api/marketing/sources/divar/exports/xlsx")
async def divar_export_xlsx(
    payload: DivarExportInput,
    request: Request,
    session: dict[str, Any] = Depends(require_csrf),
) -> Response:
    if payload.to_contact_no < payload.from_contact_no:
        raise HTTPException(400, "بازه شماره کانتکت معتبر نیست.")
    upstream = await upstream_file(
        "POST",
        f"{DIVAR_API}/api/sources/divar/exports/xlsx",
        {
            **divar_filters(payload.model_dump()),
            "from_contact_no": payload.from_contact_no,
            "to_contact_no": payload.to_contact_no,
            "confirm_delivery": payload.confirm_delivery,
        },
    )
    if payload.confirm_delivery:
        with connect() as db:
            db.execute(
                """
                INSERT INTO audit_log
                    (user_id,action,source_key,before_json,after_json,remote_ip,created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    session["user_id"],
                    "deliver_contact_export",
                    "divar",
                    None,
                    json.dumps(payload.model_dump(), ensure_ascii=False),
                    client_ip(request),
                    iso_now(),
                ),
            )
    return Response(
        content=upstream.content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": upstream.headers.get(
                "content-disposition", 'attachment; filename="divar-contacts.xlsx"'
            ),
            "Cache-Control": "no-store",
        },
    )
