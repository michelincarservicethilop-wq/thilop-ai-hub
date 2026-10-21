from decimal import Decimal

from app.services.router import classify
from tests.conftest import login


def test_login_and_me(client):
    h = login(client)
    r = client.get("/api/me", headers=h)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"
    assert client.post("/api/auth/login", json={"email": "admin@test.vn", "password": "sai"}).status_code == 401


def test_classify():
    assert classify([{"role": "user", "content": "Cơ sở mở cửa mấy giờ?"}]) == "easy"
    assert classify([{"role": "user", "content": "Viết bài đăng fanpage về keo chống đinh"}]) == "writing"
    assert classify([{"role": "user", "content": "Phân tích hợp đồng thuê mặt bằng này"}]) == "hard"
    img = [{"role": "user", "content": [{"type": "text", "text": "đọc hoá đơn"}, {"type": "image_url", "image_url": {"url": "data:x"}}]}]
    assert classify(img) == "vision"


def test_v1_chat_with_key_logs_usage_and_cost(client):
    h = login(client)
    r = client.post("/api/keys", json={"name": "n8n", "rpm_limit": 100}, headers=h)
    assert r.status_code == 200, r.text
    key = r.json()["key"]
    assert key.startswith("tl-")
    kh = {"Authorization": "Bearer " + key}
    r = client.post("/v1/chat/completions", json={"model": "auto", "messages": [{"role": "user", "content": "Xin chào"}]}, headers=kh)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["model"] == "claude-haiku"  # việc dễ → model rẻ
    assert body["choices"][0]["message"]["content"]
    assert body["x_hub"]["cost_vnd"] > 0
    # lần 2 trùng câu hỏi → cache, không tốn tiền
    r2 = client.post("/v1/chat/completions", json={"model": "auto", "messages": [{"role": "user", "content": "Xin chào"}]}, headers=kh)
    assert r2.json()["x_hub"]["cache_hit"] is True
    logs = client.get("/api/admin/logs", headers=h).json()
    assert len(logs) == 2 and logs[0]["cache_hit"] is True and logs[1]["cost_vnd"] > 0


def test_v1_stream(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "s"}, headers=h).json()["key"]
    with client.stream("POST", "/v1/chat/completions", headers={"Authorization": "Bearer " + key},
                       json={"model": "claude-sonnet", "stream": True, "messages": [{"role": "user", "content": "Viết caption"}]}) as r:
        assert r.status_code == 200
        text = "".join(r.iter_text())
    assert "[DONE]" in text and "chat.completion.chunk" in text


def test_quota_blocks_when_exceeded(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "k", "daily_limit_vnd": 1}, headers=h).json()["key"]
    kh = {"Authorization": "Bearer " + key}
    ok = client.post("/v1/chat/completions", json={"model": "claude-opus", "messages": [{"role": "user", "content": "a"}], "cache": False}, headers=kh)
    assert ok.status_code == 200  # lượt đầu được phép (có thể vượt trần một lượt)
    blocked = client.post("/v1/chat/completions", json={"model": "claude-opus", "messages": [{"role": "user", "content": "b"}], "cache": False}, headers=kh)
    assert blocked.status_code == 402
    assert "hạn mức" in blocked.json()["error"]["message"]


def test_admin_only_model_and_staff(client):
    h = login(client)
    r = client.post("/api/admin/users", json={"email": "nv@test.vn", "name": "NV", "password": "matkhau-nv-1", "role": "staff", "branch_id": 1}, headers=h)
    assert r.status_code == 200, r.text
    sh = login(client, "nv@test.vn", "matkhau-nv-1")
    models = [m["id"] for m in client.get("/api/models", headers=sh).json()]
    assert "claude-opus" not in models and "auto" in models
    key = client.post("/api/keys", json={"name": "nv"}, headers=sh).json()["key"]
    r = client.post("/v1/chat/completions", json={"model": "claude-opus", "messages": [{"role": "user", "content": "x"}]},
                    headers={"Authorization": "Bearer " + key})
    assert r.status_code == 403
    assert client.get("/api/admin/models", headers=sh).status_code == 403


def test_rate_limit(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "rl", "rpm_limit": 2}, headers=h).json()["key"]
    kh = {"Authorization": "Bearer " + key}
    codes = [client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": f"q{i}"}]}, headers=kh).status_code for i in range(3)]
    assert codes == [200, 200, 429]


def test_chat_conversation_stream(client):
    h = login(client)
    c = client.post("/api/chat/conversations", json={}, headers=h).json()
    with client.stream("POST", f"/api/chat/conversations/{c['id']}/messages", json={"content": "Giờ mở cửa?", "model": "auto"}, headers=h) as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())
    assert '"done": true' in body
    conv = client.get(f"/api/chat/conversations/{c['id']}", headers=h).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert conv["title"] == "Giờ mở cửa?"


def test_overview_and_reports(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "r"}, headers=h).json()["key"]
    client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "hi"}]}, headers={"Authorization": "Bearer " + key})
    ov = client.get("/api/overview", headers=h).json()
    assert ov["calls_today"] == 1 and ov["month_used_vnd"] > 0 and len(ov["by_branch"]) == 2
    for g in ("branch", "user", "app", "model", "day", "feature"):
        r = client.get(f"/api/admin/usage?group={g}", headers=h)
        assert r.status_code == 200, (g, r.text)
    assert client.get("/api/admin/usage?group=day", headers=h).json()["rows"][0]["calls"] == 1


def test_settings_and_routes(client):
    h = login(client)
    s = client.get("/api/admin/settings", headers=h).json()
    assert s["values"]["usd_vnd_rate"] == 26000
    client.put("/api/admin/settings", json={"company_monthly_limit_vnd": 5000000}, headers=h)
    assert client.get("/api/admin/settings", headers=h).json()["values"]["company_monthly_limit_vnd"] == 5000000
    routes = client.get("/api/admin/routes", headers=h).json()
    routes[0]["primary_model"] = "gpt-luna"
    assert client.put("/api/admin/routes", json=routes, headers=h).json()[0]["primary_model"] == "gpt-luna"
    t = client.post("/api/admin/models/claude-haiku/test", headers=h).json()
    assert t["ok"] is True


def test_cost_uses_admin_prices(client):
    from app.db import session_factory
    from app.models import AIModel
    from app.services.pricing import token_cost_vnd

    with session_factory()() as db:
        m = db.get(AIModel, "claude-sonnet")
        # 1 triệu token vào (trong đó 500k cache) + 100k ra
        cost = token_cost_vnd(db, m, 1_000_000, 100_000, 500_000)
        assert cost == Decimal("26000.00") + Decimal("1300.00") + Decimal("26000.00")
