# API نگارش (Negaresh API)

این API همان خط پردازش رابط وب را اجرا می‌کند و هیچ قاعده یا پرامپتی تغییر نکرده است. مراحل به ترتیب این‌هاست: نویسنده، بازبین، اصلاح‌گر، تحلیل E-E-A-T و بررسی آمادگی انتشار. رابط وب مثل قبل کار می‌کند و این API کنار آن اضافه شده است.

> ⏱ هر درخواست معمولاً **۱ تا چند دقیقه** طول می‌کشد، چون پایپ‌لاین ۲ تا ۴ بار مدل را صدا می‌زند.

## احراز هویت

همهٔ مسیرها به جز `/api/v1/health` کلید لازم دارند:

```
Authorization: Bearer <NEGARESH_API_KEY>
```

هدر `X-API-Key: <key>` هم پذیرفته می‌شود. این کلید با کلید اوپن‌روتر و رمز رابط وب فرق دارد.

---

## دو حالت استفاده

### ۱) حالت ساده (همزمان): `POST /api/v1/humanize`

درخواست می‌دهید و منتظر می‌مانید تا متن نهایی برگردد. **timeout کلاینت را حداقل ۱۰ دقیقه بگذارید.**

```bash
curl -X POST https://negaresh.caravansanat.com/api/v1/humanize \
  -H "Authorization: Bearer $NEGARESH_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 600 \
  -d '{
    "text": "متن تولیدشده توسط هوش مصنوعی ...",
    "voice": "standard",
    "quality": "readable",
    "contentType": "general"
  }'
```

پاسخ موفق (`200`):

```json
{
  "ok": true,
  "text": "متن نهایی هیومنایزشده (Markdown)",
  "publication": { "status": "ready-for-human-review", "blockers": [] },
  "humanReviewRequired": false,
  "warning": "توضیح اختیاری",
  "details": { "metrics": {}, "analysis": {}, "quality": {}, "validation": {}, "lint": {} },
  "durationMs": 74210
}
```

خروجی اصلی فیلد **`text`** است. بقیهٔ فیلدها گزارش کیفیت هستند و همان چیزی‌اند که رابط وب نشان می‌دهد.

### ۲) حالت دو مرحله‌ای (Job): `POST /api/v1/jobs`

این حالت برای n8n، Make، اسکریپت‌ها و هر جایی که درخواست طولانی قطع می‌شود مناسب‌تر است.

**گام ۱: ثبت کار** (پاسخ فوری `202`)

```bash
curl -X POST https://negaresh.caravansanat.com/api/v1/jobs \
  -H "Authorization: Bearer $NEGARESH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "متن ورودی ..."}'
```

```json
{ "ok": true, "id": "dc7c36db-...", "status": "queued", "url": "https://negaresh.caravansanat.com/api/v1/jobs/dc7c36db-..." }
```

**گام ۲: پیگیری** (هر ۱۰ ثانیه)

```bash
curl https://negaresh.caravansanat.com/api/v1/jobs/<id> -H "Authorization: Bearer $NEGARESH_API_KEY"
```

| `status` | معنی |
|---|---|
| `queued` | در صف انتظار |
| `running` | در حال پردازش (`currentStep` مرحلهٔ فعلی را نشان می‌دهد) |
| `succeeded` | تمام شد؛ نتیجه در `result` است (`result.text`) |
| `failed` | ناموفق؛ علت در `error` است |
| `canceled` | لغو شد |

**لغو:** `DELETE /api/v1/jobs/<id>`

> نتیجه تا `API_JOB_TTL_MINUTES` دقیقه (پیش‌فرض ۶۰) نگه داشته می‌شود. کارها در حافظهٔ سرور هستند و با ری‌استارت سرور پاک می‌شوند.

---

## فیلدهای ورودی

| فیلد | الزامی | مقادیر | پیش‌فرض |
|---|---|---|---|
| `text` | ✅ | رشته، حداکثر ۴۰٬۰۰۰ نویسه | — |
| `voice` | | `formal`, `standard`, `casual`, `roughcut` | `standard` |
| `quality` | | `simple`, `readable`, `precise`, `strict` | `readable` |
| `contentType` | | `general`, `howto`, `commercial`, `news`, `ymyl_health`, `ymyl_money`, `ymyl_legal_civic`, `opinion` | `general` |
| `perspective` | | `third_person`, `first_person_singular`, `first_person_plural` | `third_person` |
| `targetWords` | | عدد صحیح ۱۰۰ تا ۳۰۰۰ | — |
| `wordTolerance` | | ۰٫۰۵ تا ۰٫۲۵ (فقط همراه `targetWords`) | ۰٫۱ |
| `keywords` | | آرایه یا رشتهٔ جداشده با کاما، حداکثر ۳۰ مورد | — |
| `articleGoal`, `audience`, `sources`, `notes`, `authorProfile`, `writerSample` | | رشته، هر کدام حداکثر ۶۰۰۰ نویسه، مجموعاً حداکثر ۱۸٬۰۰۰ | — |

فهرست زندهٔ مقادیر مجاز را از `GET /api/v1/options` بگیرید. مقدار نامعتبر با خطای `400` رد می‌شود و API بی‌صدا مقدار پیش‌فرض را جایگزین نمی‌کند.

---

## خطاها

همهٔ خطاها این شکل را دارند:

```json
{ "ok": false, "error": { "code": "invalid_option", "message": "توضیح فارسی" } }
```

| HTTP | `code` | علت |
|---|---|---|
| 400 | `invalid_json`, `invalid_body`, `empty_text`, `invalid_option`, `invalid_length`, `invalid_keywords`, `context_too_long` | ورودی نامعتبر |
| 401 | `unauthorized` | کلید API ارسال نشده یا اشتباه است |
| 404 | `job_not_found` | شناسهٔ کار پیدا نشد یا منقضی شده |
| 413 | `text_too_long`, `body_too_large` | متن خیلی بلند است |
| 429 | `queue_full` | صف پر است؛ بعد از `Retry-After` ثانیه دوباره بفرستید |
| 502 | `provider_error` | خطا از سمت اوپن‌روتر یا مدل |
| 503 | `api_disabled`, `not_configured` | `NEGARESH_API_KEY` یا `API_KEY` روی سرور تنظیم نشده |
| 504 | `timeout` | پردازش از سقف ۹٫۵ دقیقه گذشت |

---

## نمونهٔ Python

```python
import os, time, requests

BASE = "https://negaresh.caravansanat.com"
HEADERS = {"Authorization": f"Bearer {os.environ['NEGARESH_API_KEY']}"}

def humanize(text: str, **options) -> str:
    job = requests.post(f"{BASE}/api/v1/jobs", json={"text": text, **options}, headers=HEADERS, timeout=30)
    job.raise_for_status()
    job_id = job.json()["id"]
    while True:
        time.sleep(10)
        state = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=30).json()
        if state["status"] == "succeeded":
            return state["result"]["text"]
        if state["status"] in ("failed", "canceled"):
            raise RuntimeError(state.get("error"))

print(humanize("متن ورودی ...", voice="casual", quality="precise"))
```

## نمونهٔ JavaScript (Node 18+)

```js
const res = await fetch('https://negaresh.caravansanat.com/api/v1/humanize', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.NEGARESH_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'متن ورودی ...', voice: 'standard' }),
  signal: AbortSignal.timeout(600_000),
});
const data = await res.json();
if (!data.ok) throw new Error(data.error.message);
console.log(data.text);
```

---

## تنظیمات سرور (متغیرهای محیطی)

| متغیر | توضیح |
|---|---|
| `API_KEY` | کلید اوپن‌روتر (**الزامی**) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` (**الزامی**) |
| `NEGARESH_API_KEY` | کلید API خودتان. چند کلید را با کاما جدا کنید (**الزامی برای API**) |
| `BETA_ACCESS_SECRET` | رمز ورود رابط وب |
| `LLM_WRITER_MODEL` / `LLM_CRITIC_MODEL` / `LLM_REFINER_MODEL` / `LLM_FALLBACK_MODEL` | مدل هر مرحله (پیش‌فرض‌ها در `.env.example`) |
| `API_MAX_CONCURRENT` | تعداد پردازش هم‌زمان (پیش‌فرض ۲). بقیهٔ درخواست‌ها منتظر می‌مانند |
| `API_MAX_PENDING_JOBS` | سقف کارهای در صف (پیش‌فرض ۵۰) |
| `API_JOB_TTL_MINUTES` | مدت نگهداری نتیجهٔ کارها (پیش‌فرض ۶۰ دقیقه) |
| `LLM_MAX_INPUT_PRICE` / `LLM_MAX_OUTPUT_PRICE` | سقف قیمت مدل به دلار برای هر یک میلیون توکن (پیش‌فرض ۱ و ۵). مدل گران‌تر از این سقف رد می‌شود |
| `LLM_BUDGET_USD` | سقف کل هزینه (اختیاری) |

## اجرا

```bash
npm install
cp .env.example .env.local   # مقادیر را پر کنید
npm run build && npm start   # http://localhost:3000
```

یا با Docker:

```bash
docker build -t negaresh .
docker run -p 3000:3000 --env-file .env.local -v negaresh-data:/data negaresh
```

بررسی سلامت سرویس: `GET /api/v1/health`
