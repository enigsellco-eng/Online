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
DIVAR_API = os.getenv("MARKETING_DIVAR_API", "http://127.0.0.1:8030")
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

    base = BEHTARINO_API if source_key == "behtarino" else DIVAR_API
    name = "بهترینو" if source_key == "behtarino" else "دیوار"
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
            "configuration_enabled": source_key == "behtarino",
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
            source_summary("torob"),
            source_summary("divar"),
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
    if source_key not in {"behtarino", "torob", "divar"}:
        raise HTTPException(404, "منبع پیدا نشد.")
    summary = await source_summary(source_key)
    if source_key == "behtarino" and summary["available"]:
        jobs = await upstream_json(
            "GET", f"{BEHTARINO_API}/api/sources/behtarino/jobs"
        )
        job = jobs[0] if jobs else None
        summary["input"] = (
            {
                "keyword": job.get("query") or "",
                "city": job.get("city") or "",
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
    if source_key not in {"behtarino", "torob", "divar"}:
        raise HTTPException(404, "منبع پیدا نشد.")
    summary = await source_summary(source_key)
    return {"items": summary["recent_runs"]}


@app.get("/api/marketing/sources/{source_key}/settings-history")
async def settings_history(
    source_key: str, _: dict[str, Any] = Depends(current_session)
) -> dict[str, Any]:
    if source_key not in {"behtarino", "torob", "divar"}:
        raise HTTPException(404, "منبع پیدا نشد.")
    if source_key == "torob":
        return {"items": []}
    base = BEHTARINO_API if source_key == "behtarino" else DIVAR_API
    jobs = await upstream_json("GET", f"{base}/api/sources/{source_key}/jobs")
    if not jobs:
        return {"items": []}
    items = await upstream_json(
        "GET",
        f"{base}/api/sources/{source_key}/jobs/{jobs[0]['id']}/history?limit=30",
    )
    return {"items": items}


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
