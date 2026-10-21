import os

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:5432/hub_test")
os.environ["MOCK_LLM"] = "1"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"  # không có Redis → dùng bộ nhớ tạm
os.environ["DATA_DIR"] = "/tmp/hub-test-data"
os.environ["ADMIN_EMAIL"] = "admin@test.vn"
os.environ["ADMIN_PASSWORD"] = "matkhau-admin-1"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import get_settings

get_settings.cache_clear()

from app.db import Base, engine, reset_engine  # noqa: E402
from app.services.kv import reset_kv  # noqa: E402


@pytest.fixture()
def client():
    reset_engine()
    reset_kv(memory=True)
    with engine().begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine())
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def login(c, email="admin@test.vn", password="matkhau-admin-1"):
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}
