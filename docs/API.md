# Thi Lốp AI Hub — API (hợp đồng giữa backend và giao diện)

Tất cả trả JSON. Lỗi: HTTP 4xx/5xx với `{"detail": "thông báo tiếng Việt"}`.
Xác thực web: header `Authorization: Bearer <token>` (token từ `/api/auth/login`).
Thẻ `<audio>`/link tải file: thêm `?token=<token>` vào URL.
Tiền luôn là VND (số), thời gian hiển thị giờ Việt Nam.

Vai trò: `admin` (toàn quyền), `manager` (quản lý cơ sở), `staff` (nhân viên), `machine` (chỉ gọi API).

## Đăng nhập
- `POST /api/auth/login` `{email, password}` → `{token, user}`
- `GET /api/me` → `{user, quota:{month_used, month_limit, day_used, day_limit}}`
  - `user = {id, email, name, role, branch_id, branch_name, monthly_limit_vnd, daily_limit_vnd, active}`
- `POST /api/me/password` `{old_password, new_password}`

## Tổng quan
- `GET /api/overview` →
```
{scope, month_used_vnd, month_limit_vnd, calls_today, calls_by_app:{chat:12, api:3,...},
 cache_rate_today, active_users_7d, total_users,
 by_app:[{app, cost_vnd}], by_branch:[{id,name,limit_vnd,used_vnd}],
 recent:[{time,user,app,feature,model,tokens,cost_vnd,cache_hit,status}],
 inbox:{messages_today, bot_replies, handoffs}, alerts:[{time,level,message}]}
```
`app` ∈ `api | chat | inbox | apps | studio` (hiển thị: Cổng API, Chat AI, Hộp thư, Ứng dụng AI, Studio).

## Chat AI
- `GET /api/models` → `[{id, label, vision, note}]` (phần tử đầu là `auto`)
- `GET /api/prompts?scope=chat|studio` → `[{id,title,text}]`
- `GET /api/chat/conversations` → `[{id,title,model,updated_at}]`
- `POST /api/chat/conversations` `{title?, model?}` → conversation
- `GET /api/chat/conversations/{id}` → `{id,title,model,updated_at, messages:[{id,role,content,model_used,tokens,cost_vnd,time}]}`
- `DELETE /api/chat/conversations/{id}`
- `POST /api/chat/conversations/{id}/messages` `{content, model, images?:[dataURL]}` → **SSE** (`text/event-stream`), mỗi dòng `data: {...}`:
  - `{"delta": "chữ"}` nhiều lần
  - cuối: `{"done": true, "message_id", "model_used", "task", "tokens", "cost_vnd"}`
  - lỗi giữa chừng: `{"error": "..."}`. Lỗi trước khi stream (hết hạn mức 402, quá tốc độ 429) trả HTTP thường.

## Hộp thư khách hàng (Messenger, Zalo OA)
- `GET /api/inbox/conversations?status=bot|human|done&branch_id=&q=` →
  `[{id, channel:"messenger"|"zalo", name, branch_id, branch_name, status, handoff_reason, last_message, last_message_at, unread_human:bool}]`
  (manager/staff chỉ thấy cơ sở mình; admin thấy hết)
- `GET /api/inbox/conversations/{id}` →
  `{id, channel, name, branch_id, branch_name, status, handoff_reason, window:{bot_can_reply:bool, staff_can_reply:bool, note:"còn 21 giờ để bot trả lời"}, messages:[{id, sender:"customer"|"bot"|"staff"|"system", text, staff_name, time}]}`
- `POST /api/inbox/conversations/{id}/takeover` → conversation (status=human, bot dừng)
- `POST /api/inbox/conversations/{id}/release` → status=bot
- `POST /api/inbox/conversations/{id}/done` → status=done
- `POST /api/inbox/conversations/{id}/branch` `{branch_id}` → đổi cơ sở phụ trách
- `POST /api/inbox/conversations/{id}/reply` `{text}` → gửi tin của nhân viên ra kênh; trả message
- `GET /api/inbox/settings` / `PUT /api/inbox/settings` (manager trở lên đọc, admin sửa):
  `{messenger_enabled, zalo_enabled, night_reply, business_hours:{start:"07:30", end:"18:00"}, default_branch_id, greeting, handoff_message, rules:{complaint, offprice, askhuman, unsure}, bot_model}`
- `POST /api/inbox/simulate` `{channel, external_user_id, name, text}` (admin) → chạy bot như tin khách thật nhưng không gửi ra kênh; trả `{conversation_id, replies:[...]}` — để thử bot khi chưa nối fanpage.
- Webhook (do Meta/Zalo gọi, không dùng token): `GET/POST /webhooks/messenger`, `POST /webhooks/zalo`

## Tài liệu & Ứng dụng AI
- `GET /api/documents` → `[{id,title,filename,public_kb,status,error,pages,chunks,created_at}]`
- `POST /api/documents` multipart `file`, `title`, `public_kb` (true/false) → document (status `queued`, worker xử lý)
- `PATCH /api/documents/{id}` `{title?, public_kb?}`; `DELETE /api/documents/{id}` (manager trở lên)
- `POST /api/apps/ask` `{question}` → `{answer, sources:[{document_id, title, page, excerpt}], cost_vnd}`
- `POST /api/apps/invoice` multipart `file` (ảnh/PDF) → `{fields:{supplier, invoice_no, date, total, tax}, items:[{name, quantity, unit_price, amount}], xlsx_url, cost_vnd}`
- `POST /api/apps/quote` `{customer?, vehicle, tire_size?, services:[str], branch_id?, notes?}` → `{text, cost_vnd}`
- `POST /api/apps/meeting` multipart `file` (mp3/m4a/wav) → `{job_id}`; theo dõi `GET /api/jobs/{id}` → `{status: queued|running|done|error, result:{transcript, summary, decisions:[str], actions:[{task, owner, due}]}, error}`
- `POST /api/apps/revenue` multipart `file` (csv/xlsx) → `{columns:[str], group_by, value_col, total, groups:[{name,total,share}], by_period:[{period,total}], commentary, cost_vnd}`

## Studio
- `POST /api/studio/script` `{service, platform:"tiktok"|"fanpage"|"zalo", length_sec?, branch_id?, notes?}` → `{script, caption, hashtags:[str], cost_vnd}`
- `GET /api/studio/voices` → `[{id:"fpt:banmai", label:"Ban Mai · Nữ miền Bắc", provider:"fpt", available:bool}]`
- `POST /api/studio/tts` `{text, voice}` → `{url, chars, cached, cost_vnd}` (`url` dạng `/api/files/...`)

## Key API
- `GET /api/keys?all=1` → `[{id,name,prefix,user_id,user_name,daily_limit_vnd,rpm_limit,allowed_models,active,today_used_vnd,last_used_at,created_at}]`
- `POST /api/keys` `{name, daily_limit_vnd?, rpm_limit?, allowed_models?, user_id?}` → key + `key` (chuỗi đầy đủ, chỉ hiện 1 lần)
- `PATCH /api/keys/{id}` `{name?, daily_limit_vnd?, clear_daily_limit?, rpm_limit?, active?}`; `DELETE /api/keys/{id}` (thu hồi)

## Quản trị
- `GET/POST /api/admin/users`, `PUT /api/admin/users/{id}`:
  `{email, name, password?, role, branch_id, monthly_limit_vnd, daily_limit_vnd, active}`; list kèm `month_used_vnd`
- `GET/POST /api/admin/branches`, `PUT /api/admin/branches/{id}`:
  `{name, address, phone, hours, keywords, monthly_limit_vnd, daily_limit_vnd, telegram_chat_id, active}`; list kèm `month_used_vnd, today_used_vnd`
- `GET /api/admin/models`, `PUT /api/admin/models/{id}`:
  `{id,label,provider_model,kind:"chat"|"embedding"|"stt",vision,enabled,admin_only,note,price_in_vnd,price_out_vnd,price_cache_vnd,price_per_minute_vnd,fallback_id,sort}` (giá VND / 1 triệu token)
- `POST /api/admin/models/{id}/test` → `{ok, message}`
- `GET /api/admin/routes`, `PUT /api/admin/routes` (gửi cả danh sách) `[{task,label,primary_model,fallback_model}]`
- `POST/PUT/DELETE /api/admin/prompts[/{id}]` `{scope,title,text,sort}`
- `GET /api/admin/settings` → `{values:{usd_vnd_rate, company_monthly_limit_vnd, company_daily_limit_vnd, store_content, cache_ttl_hours, web_rpm_limit, telegram_admin_chat_id, alert_levels, inbox:{...}, tts:{default_voice}}, secrets_configured:{anthropic,openai,gemini,deepseek,fpt_tts,telegram,messenger,zalo}, webhooks:{messenger,zalo}, public_base_url}`
- `PUT /api/admin/settings` `{<key>: value}` (chỉ các khoá trong `values`)
- `GET /api/admin/usage?group=branch|user|app|model|day|feature&frm=YYYY-MM-DD&to=YYYY-MM-DD` → `{from,to,group,rows:[{name,calls,input_tokens,output_tokens,cost_vnd,cache_hits}]}`
- `GET /api/admin/logs?limit=&offset=&user_id=&app=&status=` → `[{id,time,user,branch,app,feature,model_requested,model_used,task,input_tokens,output_tokens,cached_tokens,units,cost_vnd,cache_hit,latency_ms,status,error,excerpt}]`

## Cổng cho công cụ ngoài
- Chuẩn OpenAI: `POST /v1/chat/completions` (model `auto` hoặc id model; header tuỳ chọn `x-task: easy|vision|writing|hard`), `GET /v1/models`. Phản hồi có thêm `x_hub:{task,cost_vnd,cache_hit}`.
- Chuẩn Anthropic (Claude Code): `POST /v1/messages`, `POST /v1/messages/count_tokens`.
- Key: `Authorization: Bearer tl-...` hoặc `x-api-key: tl-...`.
