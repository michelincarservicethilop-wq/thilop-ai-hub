# Thi Lốp AI Hub

Cổng AI nội bộ của Thi Lốp: một chỗ cho cả đội dùng nhiều model AI (Claude, GPT, Gemini, DeepSeek) bằng key chính hãng, có hạn mức theo người và cơ sở, kèm hộp thư tự trả lời khách trên Messenger và Zalo OA.

Cài lên server: xem **[INSTALL.md](INSTALL.md)**.

## Có gì

| Mảng | Chức năng |
| --- | --- |
| Cổng API | Một key `tl-...` gọi mọi model; chuẩn OpenAI (`/v1/chat/completions`) cho n8n, Cursor và chuẩn Anthropic (`/v1/messages`) cho Claude Code; router `auto` chọn model rẻ nhất đủ tốt; tự chuyển model dự phòng khi hãng lỗi; cache câu trả lời trùng; prompt caching cho Claude |
| Hạn mức & quản trị | Hạn mức ngày/tháng theo công ty, cơ sở, người dùng, key; chặn khi chạm trần; cảnh báo Telegram ở 80% và 100%; báo cáo chi phí theo cơ sở/người/mảng/model/ngày; nhật ký từng lượt |
| Chat AI | Hội thoại, chọn model hoặc auto, câu lệnh mẫu Thi Lốp, gửi ảnh, trả lời dạng chạy chữ |
| Ứng dụng AI | Hỏi tài liệu nội bộ (kèm nguồn), trích hoá đơn ra Excel, soạn báo giá, biên bản cuộc họp từ ghi âm, phân tích doanh thu |
| Studio | Kịch bản video & caption cho TikTok/fanpage, giọng đọc tiếng Việt (FPT.AI). Không tạo ảnh, không ghép video |
| Hộp thư khách hàng | Messenger + Zalo OA về một chỗ; bot trả lời câu thường gặp từ bảng giá/chính sách; khiếu nại, giá ngoài bảng, khách đòi gặp người thì chuyển CSKH đúng cơ sở và báo Telegram; nhân viên tiếp quản/trả lại cho bot |

## Cấu trúc

```
backend/    FastAPI + SQLAlchemy + LiteLLM (Python 3.12)
  app/api/        các endpoint (/api, /v1, /webhooks)
  app/services/   lõi cổng AI (llm.py), hạn mức, router, cache, tài liệu, giọng đọc, bot
  app/channels/   Messenger, Zalo OA
  app/worker.py   việc chạy nền (lập chỉ mục tài liệu, ghi âm cuộc họp, làm mới token Zalo)
  app/seed/       model, router, cơ sở, câu lệnh mẫu tạo lần đầu
frontend/   React + TypeScript (Vite)
deploy/     Caddy (HTTPS, chia đường), sinh .env, sao lưu
docs/API.md hợp đồng API giữa backend và giao diện
```

## Chạy để phát triển

Cần Python 3.12+, Node 22, PostgreSQL 16 có pgvector, Redis.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:5432/hub MOCK_LLM=1 uvicorn app.main:app --port 8000
# cửa sổ khác:
cd frontend && npm install && npm run dev
```

`MOCK_LLM=1` không gọi hãng AI thật, dùng để thử giao diện khi chưa có key.

Kiểm thử backend (cần CSDL `hub_test`):

```bash
cd backend && python -m pytest -q
```

## Model mặc định

Giá kiểm tra trên trang chính thức các hãng ngày 22/10/2026, quy đổi 26.000đ/$, sửa được trong Quản trị › Model.

| Loại việc (router auto) | Model chính | Dự phòng |
| --- | --- | --- |
| Việc dễ: trả lời khách, tóm tắt, dịch | Claude Haiku 5.5 | GPT 6 Luna |
| Đọc ảnh hoá đơn | Gemini 3.8 Flash | Claude Haiku 5.5 |
| Viết bài, kịch bản | Claude Sonnet 5.5 | GPT 6.1 Sol |
| Hợp đồng, phân tích, code | Claude Opus 5.5 | GPT 6.1 Sol |

Lưu ý: Google tăng giá Gemini Flash từ 01/01/2027; OpenAI ngừng các model giọng đọc `tts-1`, `gpt-4o-mini-tts` từ 06/01/2027 (Hub dùng FPT.AI làm giọng đọc chính).

## Chưa kiểm tra với dịch vụ thật

- Gửi/nhận tin thật qua Messenger Graph API và Zalo OA API (chữ ký webhook Zalo, khung giờ trả lời, cách làm mới token cần đối chiếu tài liệu chính thức của Zalo).
- Giọng đọc FPT.AI (danh sách giọng, cách lấy file).
- Chất lượng JSON trả về từ model thật cho hoá đơn, kịch bản, bot (đã có xử lý khi model trả sai định dạng).
