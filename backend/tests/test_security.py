"""Kiểm thử phân quyền, IDOR, đường dẫn file, hạn mức tạo vector, ghi nhật ký khi stream bị ngắt, webhook."""
from sqlalchemy import select

from app.config import get_settings
from app.db import session_factory
from app.models import CustomerConversation, CustomerMessage, Document, UsageLog
from app.services.storage import files_dir
from tests.conftest import login
from tests.test_modules import PRICE_DOC, _run_jobs, _upload_doc


def _user(client, h, email, role="staff", branch_id=1, **kw):
    r = client.post("/api/admin/users", json={"email": email, "name": email.split("@")[0], "password": "matkhau-123456",
                                              "role": role, "branch_id": branch_id, **kw}, headers=h)
    assert r.status_code == 200, r.text
    return login(client, email, "matkhau-123456")


def test_api_key_cannot_use_web_endpoints(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "n8n"}, headers=h).json()["key"]
    for kh in ({"Authorization": "Bearer " + key}, {"x-api-key": key}):
        assert client.get("/api/me", headers=kh).status_code == 403
        assert client.post("/api/keys", json={"name": "khac"}, headers=kh).status_code == 403  # không tự tạo key mới
        assert client.get("/api/admin/users", headers=kh).status_code == 403  # key của admin không mở trang quản trị
        assert client.get("/api/inbox/conversations", headers=kh).status_code == 403
    assert client.get("/api/me", params={"token": key}).status_code == 403
    # /v1 vẫn dùng key bình thường
    r = client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "hi"}]}, headers={"Authorization": "Bearer " + key})
    assert r.status_code == 200, r.text


def test_staff_cannot_read_documents_via_dot_segments(client):
    h = login(client)
    _upload_doc(client, h)
    with session_factory()() as db:
        path = db.execute(select(Document.path)).scalar_one()
    name = path.split("/", 1)[1]
    sh = _user(client, h, "nv1@test.vn")
    assert client.get(f"/api/files/{path}", headers=h).status_code == 200  # admin tải được
    assert client.get(f"/api/files/{path}", headers=sh).status_code == 403
    for rel in (f"uploads/%2e%2e/documents/{name}", f"./documents/{name}", f"tts/%2E%2E/documents/{name}"):
        r = client.get(f"/api/files/{rel}", headers=sh)
        assert r.status_code == 403, (rel, r.status_code)
    # thư mục cạnh files/ có tên bắt đầu bằng "files" không được lọt qua
    sibling = files_dir().parent / "files-khac"
    sibling.mkdir(parents=True, exist_ok=True)
    (sibling / "bi-mat.txt").write_text("bi mat")
    assert client.get("/api/files/%2e%2e/files-khac/bi-mat.txt", headers=h).status_code == 400


def test_manager_without_branch_sees_no_other_data(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "k"}, headers=h).json()["key"]
    client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "nội dung riêng của admin"}]},
                headers={"Authorization": "Bearer " + key})
    mh = _user(client, h, "ql@test.vn", role="manager", branch_id=None)
    assert client.get("/api/admin/logs", headers=mh).json() == []
    assert client.get("/api/admin/usage?group=user", headers=mh).json()["rows"] == []
    emails = [u["email"] for u in client.get("/api/admin/users", headers=mh).json()]
    assert "admin@test.vn" not in emails
    # quản lý có cơ sở vẫn thấy cơ sở mình
    mh1 = _user(client, h, "ql1@test.vn", role="manager", branch_id=1)
    assert [u["email"] for u in client.get("/api/admin/users", headers=mh1).json()] == ["ql1@test.vn"]


def test_inbox_staff_cannot_access_other_branch(client):
    h = login(client)
    with session_factory()() as db:
        c1 = CustomerConversation(channel="messenger", external_user_id="u1", name="Khách 1", branch_id=1)
        c2 = CustomerConversation(channel="messenger", external_user_id="u2", name="Khách 2", branch_id=2)
        db.add_all([c1, c2])
        db.flush()
        db.add(CustomerMessage(conversation_id=c2.id, sender="customer", text="số điện thoại 0909"))
        db.commit()
        id1, id2 = c1.id, c2.id
    sh = _user(client, h, "nv-b1@test.vn", branch_id=1)
    assert [c["id"] for c in client.get("/api/inbox/conversations", headers=sh).json()] == [id1]
    assert client.get("/api/inbox/conversations?q=0909", headers=sh).json() == []
    assert client.get("/api/inbox/conversations?branch_id=2", headers=sh).json() == []
    assert client.get(f"/api/inbox/conversations/{id2}", headers=sh).status_code == 404
    for action in ("takeover", "release", "done"):
        assert client.post(f"/api/inbox/conversations/{id2}/{action}", headers=sh).status_code == 404
    assert client.post(f"/api/inbox/conversations/{id2}/reply", json={"text": "x"}, headers=sh).status_code == 404
    assert client.post(f"/api/inbox/conversations/{id2}/branch", json={"branch_id": 1}, headers=sh).status_code == 404
    nobranch = _user(client, h, "nv-0@test.vn", branch_id=None)
    assert client.get("/api/inbox/conversations", headers=nobranch).json() == []


def test_embedding_respects_quota(client):
    import pytest

    from app.models import User
    from app.services import llm
    from app.services.principal import Principal

    h = login(client)
    _upload_doc(client, h, data=PRICE_DOC)
    assert _run_jobs() == 1
    sh = _user(client, h, "nv-q@test.vn", daily_limit_vnd=1000)
    with session_factory()() as db:  # giả lập nhân viên đã tiêu hết hạn mức ngày
        u = db.execute(select(User).where(User.email == "nv-q@test.vn")).scalar_one()
        db.add(UsageLog(app="chat", user_id=u.id, branch_id=u.branch_id, cost_vnd=1000))
        db.commit()
        with pytest.raises(llm.GatewayError) as e:  # chặn ngay ở bước tạo vector, trước khi gọi hãng
            llm.embed(db, Principal(user=u), ["Giá đảo lốp?"], app="apps", feature="ask")
        assert e.value.status_code == 402
    assert client.post("/api/apps/ask", json={"question": "Giá đảo lốp?"}, headers=sh).status_code == 402


def test_stream_abort_still_logs_usage(client):
    from app.services import llm
    from app.services.principal import Principal

    login(client)
    with session_factory()() as db:
        from app.models import User

        p = Principal(user=db.execute(select(User).where(User.email == "admin@test.vn")).scalar_one())
        gen = llm.chat_stream(db, p, app="api", feature="v1", model="claude-sonnet",
                              messages=[{"role": "user", "content": "Viết một đoạn văn dài " * 20}])
        first = next(gen)
        assert isinstance(first, dict)
        gen.close()  # người gọi ngắt kết nối trước khi stream xong
        rows = db.execute(select(UsageLog).where(UsageLog.feature == "v1")).scalars().all()
        assert len(rows) == 1 and rows[0].input_tokens > 0 and rows[0].cost_vnd > 0


def test_messenger_webhook_requires_secret_when_page_connected(client, monkeypatch):
    monkeypatch.setenv("MESSENGER_PAGE_TOKEN", "page-token")
    monkeypatch.delenv("MESSENGER_APP_SECRET", raising=False)
    get_settings.cache_clear()
    try:
        payload = {"object": "page", "entry": [{"messaging": [{"sender": {"id": "P1"}, "message": {"mid": "m", "text": "hi"}}]}]}
        assert client.post("/webhooks/messenger", json=payload).status_code == 403
        monkeypatch.setenv("MESSENGER_APP_SECRET", "s")
        get_settings.cache_clear()
        r = client.post("/webhooks/messenger", json=payload, headers={"X-Hub-Signature-256": "sha256=é".encode("latin-1")})
        assert r.status_code == 403  # chữ ký có ký tự lạ → 403, không phải lỗi 500
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_bad_inputs_return_4xx(client):
    h = login(client)
    key = client.post("/api/keys", json={"name": "k"}, headers=h).json()["key"]
    kh = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    assert client.post("/v1/chat/completions", content=b"{khong-phai-json", headers=kh).status_code == 400
    assert client.post("/v1/chat/completions", json={"messages": "hi"}, headers=kh).status_code == 400
    assert client.post("/v1/messages", content=b"[", headers=kh).status_code == 400
    assert client.get("/api/admin/usage?frm=hom-qua", headers=h).status_code == 400
    r = client.post("/api/admin/users", json={"email": "x@test.vn", "name": "x", "password": "matkhau-123456", "branch_id": 999}, headers=h)
    assert r.status_code == 400
    _user(client, h, "a@test.vn")
    b = _user(client, h, "b@test.vn")  # noqa: F841
    with session_factory()() as db:
        from app.models import User

        bid = db.execute(select(User.id).where(User.email == "b@test.vn")).scalar_one()
    r = client.put(f"/api/admin/users/{bid}", json={"email": "a@test.vn", "name": "b", "role": "staff", "branch_id": 1}, headers=h)
    assert r.status_code == 400
