import importlib.util
from pathlib import Path

import pytest

APP_PATH = Path(__file__).resolve().parents[1] / "app.py"


def load_app(monkeypatch, tmp_path):
    monkeypatch.setenv("MARKETING_DATABASE_PATH", str(tmp_path / "marketing.sqlite3"))
    spec = importlib.util.spec_from_file_location("marketing_dashboard_test", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_telegram_source_and_routes(monkeypatch, tmp_path):
    dashboard = load_app(monkeypatch, tmp_path)

    async def fake_upstream(method, url, payload=None):
        assert method == "GET"
        assert url.endswith("/api/sources/telegram/dashboard")
        return {
            "counts": {"contacts": 1_155, "telegram_found": 11},
            "recent_runs": [],
        }

    monkeypatch.setattr(dashboard, "upstream_json", fake_upstream)
    source = await dashboard.source_summary("telegram")
    assert source["available"] is True
    assert source["configuration_enabled"] is True
    assert source["status"] == "running"
    assert source["contacts"] == 1_155
    assert source["records"] == 11
    paths = {route.path for route in dashboard.app.routes}
    assert "/api/marketing/sources/{source_key}" in paths
    assert "/api/marketing/sources/telegram/results" in paths
    assert "/api/marketing/sources/telegram/uploads/csv" in paths
    assert "/api/marketing/sources/telegram/exports/found.{file_format}" in paths


@pytest.mark.asyncio
async def test_overview_excludes_telegram_from_contact_total(monkeypatch, tmp_path):
    dashboard = load_app(monkeypatch, tmp_path)

    async def fake_summary(source_key):
        return {
            "key": source_key,
            "available": True,
            "contacts": 1_155 if source_key == "telegram" else 10,
        }

    monkeypatch.setattr(dashboard, "source_summary", fake_summary)
    result = await dashboard.overview({})
    assert result["total_contacts"] == 90
