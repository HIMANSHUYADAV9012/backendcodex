"""
SkillBridge AI — FastAPI Backend
Single-file backend: auth, assessments, gaps, learning, matching, industry.
AI: OpenRouter (deepseek/deepseek-chat by default)
DB: Supabase Postgres
"""

import os
import json
import random
import asyncio
import time
from typing import List, Dict, Any, Optional
from datetime import datetime

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

# =========================================================
# ENV & CLIENTS
# =========================================================
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-chat")
OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "http://localhost:8000")
OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "SkillBridge AI")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL / SUPABASE_KEY in .env")
if not OPENROUTER_API_KEY:
    raise RuntimeError("Missing OPENROUTER_API_KEY in .env")

# Shared Supabase client (thread-safe, connection pooling)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Shared HTTP client — reused for all AI calls (much faster than per-call)
_http_client: Optional[httpx.AsyncClient] = None

def get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(45.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": OPENROUTER_SITE_URL,
                "X-Title": OPENROUTER_APP_NAME,
            },
        )
    return _http_client


# =========================================================
# APP
# =========================================================
app = FastAPI(title="SkillBridge AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5500", "http://127.0.0.1:5500",
        "http://localhost:8000", "http://127.0.0.1:8000",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEMO_OTP = "123456"


# =========================================================
# SCHEMAS
# =========================================================
class OTPRequest(BaseModel):
    phone: str
    role: str  # 'student' | 'industry'

class OTPVerify(BaseModel):
    phone: str
    otp: str
    role: str

class StudentProfile(BaseModel):
    user_id: str
    name: str
    email: Optional[str] = None
    college: Optional[str] = None
    degree: Optional[str] = None
    graduation_year: Optional[int] = None
    target_role: Optional[str] = None
    bio: Optional[str] = None

class CompanyProfile(BaseModel):
    user_id: str
    name: str
    industry: Optional[str] = None
    website: Optional[str] = None
    location: Optional[str] = None
    about: Optional[str] = None

class AnswerIn(BaseModel):
    student_id: str
    answers: List[Dict[str, Any]]

class AssessmentIn(BaseModel):
    student_id: str
    skills: Dict[str, int]

class GapIn(BaseModel):
    student_id: str
    target_role: str

class MatchIn(BaseModel):
    student_id: str

class JobIn(BaseModel):
    company_id: str
    title: str
    description: Optional[str] = None
    required_skills: Dict[str, int]
    location: Optional[str] = None
    type: Optional[str] = "Internship"
    stipend: Optional[str] = None
    duration: Optional[str] = None

class FindStudentsIn(BaseModel):
    company_id: str
    job_id: Optional[str] = None
    required_skills: Optional[Dict[str, int]] = None

class RecommendIn(BaseModel):
    student_id: str
    skills: List[str]


# =========================================================
# DEEPSEEK (OpenRouter) CALL — FAST, CACHED, RETRY-ABLE
# =========================================================
_ai_cache: Dict[str, Dict[str, Any]] = {}
_AI_CACHE_TTL = 300  # 5 minutes


def _cache_key(messages: List[Dict[str, str]], temp: float) -> str:
    return json.dumps({"m": messages, "t": temp}, sort_keys=True)


def _strip_markdown(content: str) -> str:
    content = content.strip()
    if content.startswith("```"):
        # remove first fence line
        parts = content.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            if inner.startswith("json"):
                inner = inner[4:]
            content = inner.strip()
    return content


async def _call_openrouter(
    client: httpx.AsyncClient,
    payload: Dict[str, Any],
) -> httpx.Response:
    """Single HTTP attempt to OpenRouter."""
    return await client.post(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        json=payload,
    )


async def deepseek_chat(
    messages: List[Dict[str, str]],
    json_mode: bool = True,
    temperature: float = 0.4,
    use_cache: bool = True,
) -> str:
    """
    Fast wrapper around OpenRouter chat completions.
    - Reuses a shared HTTP client (connection pooling)
    - Caches identical requests for 5 minutes
    - Retries once on 429/5xx with backoff
    - Auto-retries without response_format if model rejects it
    """
    cache_k = _cache_key(messages, temperature)
    if use_cache:
        hit = _ai_cache.get(cache_k)
        if hit and (time.time() - hit["t"]) < _AI_CACHE_TTL:
            return hit["v"]

    payload: Dict[str, Any] = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    client = get_http()

    # Attempt 1
    r = await _call_openrouter(client, payload)

    # Fallback: model doesn't support response_format
    if r.status_code == 400 and json_mode:
        payload.pop("response_format", None)
        payload["messages"] = [
            {"role": "system",
             "content": "You MUST return ONLY valid JSON. No markdown, no prose, no explanations."}
        ] + messages
        r = await _call_openrouter(client, payload)

    # Retry on transient errors
    if r.status_code in (429, 500, 502, 503, 504):
        await asyncio.sleep(1.2)
        r = await _call_openrouter(client, payload)

    if r.status_code != 200:
        print("❌ OpenRouter error:", r.status_code, r.text[:400])
        raise HTTPException(
            status_code=500,
            detail=f"OpenRouter error ({r.status_code}): {r.text[:300]}",
        )

    data = r.json()

    if "error" in data:
        msg = data["error"].get("message", str(data["error"]))
        raise HTTPException(status_code=500, detail=f"OpenRouter: {msg}")

    if not data.get("choices"):
        raise HTTPException(
            status_code=500,
            detail=f"OpenRouter returned no choices: {json.dumps(data)[:300]}",
        )

    content = data["choices"][0]["message"]["content"]
    content = _strip_markdown(content)

    if use_cache:
        _ai_cache[cache_k] = {"t": time.time(), "v": content}

    return content


async def deepseek_chat_safe(
    messages: List[Dict[str, str]],
    json_mode: bool = True,
    temperature: float = 0.4,
    fallback: Optional[Dict[str, Any]] = None,
) -> str:
    """Never raises — returns fallback JSON on failure."""
    try:
        return await deepseek_chat(messages, json_mode, temperature)
    except Exception as e:
        print("⚠️ AI call failed, using fallback:", str(e)[:200])
        return json.dumps(fallback or {})


def safe_json(text: str) -> Any:
    """Robust JSON parsing — handles fences, extra prose, etc."""
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    # Extract outer { ... }
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except Exception:
            pass
    return {}


# =========================================================
# HEALTH + DIAGNOSTICS
# =========================================================
@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/api/diagnostics")
def diagnostics():
    tables = ["users", "sessions", "students", "companies", "jobs",
              "questions", "test_answers", "gaps", "recommendations", "matches"]
    status = {}
    for t in tables:
        try:
            r = supabase.table(t).select("id").limit(1).execute()
            status[t] = {"ok": True, "sample": len(r.data)}
        except Exception as e:
            status[t] = {"ok": False, "error": str(e)[:200]}
    return {
        "supabase_url": SUPABASE_URL,
        "key_prefix": (SUPABASE_KEY or "")[:20] + "..." if SUPABASE_KEY else "MISSING",
        "model": OPENROUTER_MODEL,
        "ai_base": OPENROUTER_BASE_URL,
        "all_ok": all(v["ok"] for v in status.values()),
        "tables": status,
    }


# =========================================================
# AUTH — MOBILE OTP (demo)
# =========================================================
@app.post("/api/auth/send-otp")
def send_otp(payload: OTPRequest):
    if len(payload.phone) < 10:
        raise HTTPException(400, "Invalid phone")
    supabase.table("sessions").insert({
        "phone": payload.phone, "otp": DEMO_OTP, "used": False
    }).execute()
    return {
        "ok": True,
        "message": f"Demo OTP sent to {payload.phone}",
        "demo_otp": DEMO_OTP,
    }


@app.post("/api/auth/verify-otp")
def verify_otp(payload: OTPVerify):
    if payload.otp != DEMO_OTP:
        raise HTTPException(400, "Invalid OTP")

    existing = supabase.table("users").select("*").eq("phone", payload.phone).execute()
    if existing.data:
        user = existing.data[0]
        if user["role"] != payload.role and not user.get("onboarded"):
            supabase.table("users").update({"role": payload.role}).eq("id", user["id"]).execute()
            user["role"] = payload.role
    else:
        res = supabase.table("users").insert({
            "phone": payload.phone, "role": payload.role
        }).execute()
        user = res.data[0]

    profile = None
    if user["role"] == "student":
        p = supabase.table("students").select("*").eq("user_id", user["id"]).execute()
        profile = p.data[0] if p.data else None
    else:
        p = supabase.table("companies").select("*").eq("user_id", user["id"]).execute()
        profile = p.data[0] if p.data else None

    return {"user": user, "profile": profile, "onboarded": user.get("onboarded", False)}


# =========================================================
# STUDENT PROFILE
# =========================================================
@app.post("/api/students/profile")
def create_student_profile(payload: StudentProfile):
    u = supabase.table("users").select("*").eq("id", payload.user_id).execute()
    if not u.data:
        raise HTTPException(404, "User not found")

    existing = supabase.table("students").select("*").eq("user_id", payload.user_id).execute()
    data = payload.model_dump()
    if existing.data:
        supabase.table("students").update(data).eq("id", existing.data[0]["id"]).execute()
        student = supabase.table("students").select("*").eq("id", existing.data[0]["id"]).execute().data[0]
    else:
        data["skills"] = {}
        data["ai_scores"] = {}
        data["match_scores"] = {}
        student = supabase.table("students").insert(data).execute().data[0]

    supabase.table("users").update({
        "onboarded": True,
        "name": payload.name,
        "email": payload.email,
    }).eq("id", payload.user_id).execute()

    return {"student": student}


@app.get("/api/students/{student_id}")
def get_student(student_id: str):
    res = supabase.table("students").select("*").eq("id", student_id).execute()
    if not res.data:
        raise HTTPException(404, "Student not found")
    return res.data[0]


# =========================================================
# QUESTIONS / TEST
# =========================================================
@app.get("/api/questions/by-skills")
def questions_by_skills(skills: str):
    skill_list = [s.strip() for s in skills.split(",") if s.strip()]
    if not skill_list:
        raise HTTPException(400, "No skills")
    res = supabase.table("questions").select("*").in_("skill", skill_list).execute()
    qs = res.data or []
    random.shuffle(qs)
    grouped: Dict[str, List[dict]] = {}
    for q in qs:
        grouped.setdefault(q["skill"], []).append(q)
    final = []
    for s in skill_list:
        final.extend(grouped.get(s, [])[:4])
    for q in final:
        q.pop("correct_index", None)
        q.pop("explanation", None)
    return {"questions": final}


@app.post("/api/test/submit")
def submit_test(payload: AnswerIn):
    if not payload.answers:
        raise HTTPException(400, "No answers")

    # Batch fetch all questions in one query (fast)
    qids = [a.get("question_id") for a in payload.answers if a.get("question_id")]
    if not qids:
        raise HTTPException(400, "No valid question ids")
    qmap = {}
    # supabase .in_ has URL length limits — chunk by 50
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        rows = supabase.table("questions").select("*").in_("id", chunk).execute().data or []
        for r in rows:
            qmap[r["id"]] = r

    correct_count: Dict[str, int] = {}
    total_count: Dict[str, int] = {}
    rows_to_insert = []

    for a in payload.answers:
        qid = a.get("question_id")
        sel = a.get("selected_index")
        q = qmap.get(qid)
        if not q:
            continue
        skill = q["skill"]
        total_count[skill] = total_count.get(skill, 0) + 1
        is_correct = (sel == q["correct_index"])
        if is_correct:
            correct_count[skill] = correct_count.get(skill, 0) + 1
        rows_to_insert.append({
            "student_id": payload.student_id,
            "question_id": qid,
            "selected_index": sel,
            "correct": is_correct,
            "skill": skill,
        })

    if rows_to_insert:
        supabase.table("test_answers").insert(rows_to_insert).execute()

    skill_scores: Dict[str, int] = {}
    for skill in total_count:
        pct = correct_count.get(skill, 0) / total_count[skill]
        skill_scores[skill] = max(1, min(5, round(pct * 5)))

    student = supabase.table("students").select("*").eq("id", payload.student_id).execute()
    if not student.data:
        raise HTTPException(404, "Student not found")
    student = student.data[0]
    current_skills = student.get("skills") or {}
    current_skills.update(skill_scores)

    supabase.table("students").update({
        "skills": current_skills,
        "ai_scores": skill_scores,
    }).eq("id", payload.student_id).execute()

    return {
        "skill_scores": skill_scores,
        "raw": {s: {"correct": correct_count.get(s, 0), "total": total_count[s]} for s in total_count},
    }


# =========================================================
# AI SKILL ASSESSMENT (parallel)
# =========================================================
ASSESSMENT_SYSTEM = """You are a strict, expert technical skill assessor.
Given a self-reported skill and level (1-5), produce an objective evaluation.
Return STRICT JSON with shape:
{
  "skill": "<name>",
  "self_level": <int>,
  "ai_level": <int 1-5>,
  "confidence": <0-100>,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "next_step": "<one line>"
}
Only JSON, no prose."""


@app.post("/api/assess")
async def assess_skills(payload: AssessmentIn):
    """Evaluate all skills in parallel for speed."""

    async def evaluate(skill: str, level: int) -> Dict[str, Any]:
        messages = [
            {"role": "system", "content": ASSESSMENT_SYSTEM},
            {"role": "user", "content": f"Skill: {skill}\nSelf-level: {level}"},
        ]
        fallback = {"skill": skill, "self_level": level, "ai_level": level,
                    "confidence": 60, "strengths": [], "weaknesses": [],
                    "next_step": "Keep practicing."}
        raw = await deepseek_chat_safe(messages, fallback=fallback)
        parsed = safe_json(raw) or fallback
        parsed.setdefault("skill", skill)
        parsed.setdefault("self_level", level)
        return parsed

    results = await asyncio.gather(*[
        evaluate(skill, level) for skill, level in payload.skills.items()
    ])

    overall = sum(r.get("ai_level", 0) for r in results) / max(len(results), 1)
    return {"assessments": list(results), "overall_score": round(overall, 2)}


# =========================================================
# GAP ANALYSIS
# =========================================================
GAP_SYSTEM = """You are a career skill-gap analyst.
Given a target role and the candidate's current skills (name -> level 1-5),
identify the required skills for the target role, the gaps, and a match score.
Return STRICT JSON:
{
  "target_role": "...",
  "required_skills": [{"skill":"...","required_level":<1-5>}],
  "gaps": [{"skill":"...","current_level":<int>,"required_level":<int>,"priority":"high|medium|low"}],
  "match_score": <0-100>,
  "summary": "<2-3 sentence analysis>"
}
Only JSON."""


@app.post("/api/gap-analysis")
async def gap_analysis(payload: GapIn):
    student = supabase.table("students").select("*").eq("id", payload.student_id).execute()
    if not student.data:
        raise HTTPException(404, "Student not found")
    student = student.data[0]
    skills = student.get("skills") or {}

    messages = [
        {"role": "system", "content": GAP_SYSTEM},
        {"role": "user", "content":
            f"Target role: {payload.target_role}\nCurrent skills: {json.dumps(skills)}"},
    ]
    fallback = {
        "target_role": payload.target_role,
        "required_skills": [],
        "gaps": [],
        "match_score": 50,
        "summary": "AI temporarily unavailable; showing baseline.",
    }
    raw = await deepseek_chat_safe(messages, fallback=fallback)
    data = safe_json(raw) or fallback

    supabase.table("gaps").insert({
        "student_id": payload.student_id,
        "target_role": payload.target_role,
        "missing_skills": data.get("gaps", []),
        "match_score": data.get("match_score", 0),
        "summary": data.get("summary", ""),
    }).execute()

    ms = student.get("match_scores") or {}
    ms[payload.target_role] = data.get("match_score", 0)
    supabase.table("students").update({"match_scores": ms}).eq("id", payload.student_id).execute()

    return data


# =========================================================
# RECOMMENDATIONS
# =========================================================
REC_SYSTEM = """You are a learning-path curator.
For each given skill produce curated learning resources.
Return STRICT JSON:
{
  "recommendations": [
    {
      "skill": "...",
      "priority": "high|medium|low",
      "estimated_weeks": <int>,
      "resources": [
        {"type":"course|book|project|doc","title":"...","provider":"...","url":"..."}
      ],
      "milestone_project": "..."
    }
  ]
}
Only JSON. Provide 3-4 real, well-known resources per skill."""


@app.post("/api/recommend")
async def recommend(payload: RecommendIn):
    if not payload.skills:
        raise HTTPException(400, "No skills provided")

    messages = [
        {"role": "system", "content": REC_SYSTEM},
        {"role": "user", "content": f"Skills to learn: {', '.join(payload.skills)}"},
    ]
    fallback = {"recommendations": []}
    raw = await deepseek_chat_safe(messages, fallback=fallback)
    data = safe_json(raw) or fallback

    recs = data.get("recommendations", [])
    if recs:
        rows = [{
            "student_id": payload.student_id,
            "skill": r.get("skill", ""),
            "priority": r.get("priority", "medium"),
            "estimated_weeks": r.get("estimated_weeks", 4),
            "resources": r.get("resources", []),
            "milestone_project": r.get("milestone_project", ""),
        } for r in recs]
        supabase.table("recommendations").insert(rows).execute()

    return data


# =========================================================
# MATCHING ENGINE
# =========================================================
def _student_job_score(
    student_skills: Dict[str, int],
    required: Dict[str, int],
) -> Dict[str, Any]:
    """Weighted overlap score 0-100."""
    if not required:
        return {"score": 0, "missing": []}
    total_w = sum(required.values()) or 1
    earned = 0
    missing = []
    for skill, req_lvl in required.items():
        cur = student_skills.get(skill, 0)
        earned += min(cur, req_lvl)
        if cur < req_lvl:
            missing.append(skill)
    score = round((earned / total_w) * 100)
    return {"score": score, "missing": missing}


@app.post("/api/match/student")
async def match_student(payload: MatchIn):
    """Given a student, return top matching jobs ranked by score."""
    student = supabase.table("students").select("*").eq("id", payload.student_id).execute()
    if not student.data:
        raise HTTPException(404, "Student not found")
    student = student.data[0]
    skills = student.get("skills") or {}

    # Fetch jobs + companies in one join
    jobs = supabase.table("jobs").select("*, companies(*)").execute().data or []

    ranked = []
    for j in jobs:
        sc = _student_job_score(skills, j.get("required_skills") or {})
        ranked.append({
            "job_id": j["id"],
            "title": j["title"],
            "company": (j.get("companies") or {}).get("name", "Company"),
            "industry": (j.get("companies") or {}).get("industry"),
            "location": j.get("location"),
            "type": j.get("type"),
            "stipend": j.get("stipend"),
            "duration": j.get("duration"),
            "required_skills": j.get("required_skills"),
            "match_score": sc["score"],
            "missing_skills": sc["missing"],
        })

    ranked.sort(key=lambda x: x["match_score"], reverse=True)

    # Persist top matches in a single batched insert
    top_for_db = [{
        "student_id": payload.student_id,
        "job_id": r["job_id"],
        "match_score": r["match_score"],
        "reason": f"Matched via skill overlap. Missing: {', '.join(r['missing_skills']) or 'none'}",
        "missing_skills": r["missing_skills"],
    } for r in ranked[:10]]
    if top_for_db:
        supabase.table("matches").insert(top_for_db).execute()

    # AI reasons for top 5 (best effort)
    top = ranked[:5]
    if top:
        try:
            reasons = await asyncio.wait_for(_ai_match_reasons(student, top), timeout=25)
            for r in top:
                if r["job_id"] in reasons:
                    r["reason"] = reasons[r["job_id"]]
        except Exception as e:
            print("⚠️ match reasons failed:", str(e)[:150])

    return {"matches": ranked}


async def _ai_match_reasons(student: dict, top_jobs: list) -> Dict[str, str]:
    sys = """You are a recruiter. For each job, write a 1-2 sentence reason why this candidate is a good fit.
Return STRICT JSON: {"reasons": {"<job_id>": "..."}}"""
    payload = {
        "student_name": student.get("name"),
        "skills": student.get("skills"),
        "jobs": [
            {
                "job_id": j["job_id"], "title": j["title"], "company": j["company"],
                "required": j.get("required_skills"), "match": j["match_score"],
            }
            for j in top_jobs
        ],
    }
    raw = await deepseek_chat_safe(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(payload)},
        ],
        fallback={"reasons": {}},
    )
    data = safe_json(raw)
    return data.get("reasons", {})


# =========================================================
# INDUSTRY
# =========================================================
@app.post("/api/companies/profile")
def create_company_profile(payload: CompanyProfile):
    u = supabase.table("users").select("*").eq("id", payload.user_id).execute()
    if not u.data:
        raise HTTPException(404, "User not found")

    existing = supabase.table("companies").select("*").eq("user_id", payload.user_id).execute()
    data = payload.model_dump()
    data["logo_color"] = random.choice(["#6c8cff", "#a86bff", "#35d28f", "#ffb02e", "#ff5c72"])
    if existing.data:
        supabase.table("companies").update(data).eq("id", existing.data[0]["id"]).execute()
        company = supabase.table("companies").select("*").eq("id", existing.data[0]["id"]).execute().data[0]
    else:
        company = supabase.table("companies").insert(data).execute().data[0]

    supabase.table("users").update({
        "onboarded": True, "name": payload.name,
    }).eq("id", payload.user_id).execute()

    return {"company": company}


@app.get("/api/companies/{company_id}")
def get_company(company_id: str):
    res = supabase.table("companies").select("*").eq("id", company_id).execute()
    if not res.data:
        raise HTTPException(404, "Company not found")
    return res.data[0]


@app.post("/api/jobs")
def create_job(payload: JobIn):
    data = payload.model_dump()
    job = supabase.table("jobs").insert(data).execute().data[0]
    return {"job": job}


@app.get("/api/jobs/by-company/{company_id}")
def jobs_by_company(company_id: str):
    res = supabase.table("jobs").select("*").eq("company_id", company_id).order("created_at", desc=True).execute()
    return {"jobs": res.data}


@app.post("/api/match/industry")
def match_industry(payload: FindStudentsIn):
    required: Dict[str, int] = {}
    if payload.job_id:
        j = supabase.table("jobs").select("*").eq("id", payload.job_id).execute()
        if not j.data:
            raise HTTPException(404, "Job not found")
        required = j.data[0].get("required_skills") or {}
    elif payload.required_skills:
        required = payload.required_skills
    else:
        raise HTTPException(400, "Provide job_id or required_skills")

    students = supabase.table("students").select("*").execute().data or []

    ranked = []
    for s in students:
        skills = s.get("skills") or {}
        sc = _student_job_score(skills, required)
        if sc["score"] <= 0:
            continue
        ranked.append({
            "student_id": s["id"],
            "name": s.get("name"),
            "college": s.get("college"),
            "degree": s.get("degree"),
            "graduation_year": s.get("graduation_year"),
            "target_role": s.get("target_role"),
            "skills": skills,
            "match_score": sc["score"],
            "missing_skills": sc["missing"],
        })

    ranked.sort(key=lambda x: x["match_score"], reverse=True)
    return {"candidates": ranked, "required_skills": required}


# =========================================================
# DASHBOARD
# =========================================================
@app.get("/api/dashboard/student/{student_id}")
def dashboard_student(student_id: str):
    s = supabase.table("students").select("*").eq("id", student_id).execute()
    if not s.data:
        raise HTTPException(404, "Student not found")
    sid = student_id
    gaps = supabase.table("gaps").select("*").eq("student_id", sid).order("created_at", desc=True).limit(5).execute().data or []
    recs = supabase.table("recommendations").select("*").eq("student_id", sid).order("created_at", desc=True).limit(20).execute().data or []
    matches_ = supabase.table("matches").select("*").eq("student_id", sid).order("match_score", desc=True).limit(10).execute().data or []
    return {"student": s.data[0], "gaps": gaps, "recommendations": recs, "matches": matches_}


@app.get("/api/dashboard/industry/{company_id}")
def dashboard_industry(company_id: str):
    c = supabase.table("companies").select("*").eq("id", company_id).execute()
    if not c.data:
        raise HTTPException(404, "Company not found")
    jobs = supabase.table("jobs").select("*").eq("company_id", company_id).execute().data or []
    return {"company": c.data[0], "jobs": jobs}


# =========================================================
# SEED (idempotent)
# =========================================================
@app.post("/api/seed")
def seed_all():
    """Idempotent: creates 20 students, 20 companies, 3 jobs each, 66 questions."""
    random.seed(42)

    # sanity: tables exist?
    try:
        supabase.table("questions").select("id").limit(1).execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                "❌ Supabase tables not found. Run schema.sql in Supabase SQL Editor. "
                f"Original error: {e}"
            ),
        )

    if not supabase.table("questions").select("id").limit(1).execute().data:
        _seed_questions()
    if not supabase.table("students").select("id").limit(1).execute().data:
        _seed_students()
    if not supabase.table("companies").select("id").limit(1).execute().data:
        _seed_companies()

    return {"ok": True, "message": "Seed complete (existing data preserved)"}


def _seed_questions():
    bank = {
        "Python": [
            ("What does `len([1,2,3])` return?", ["2", "3", "4", "Error"], 1),
            ("Which keyword defines a function?", ["func", "def", "lambda_only", "function"], 1),
            ("Which is immutable?", ["list", "dict", "tuple", "set"], 2),
            ("What does `range(3)` yield?", ["1,2,3", "0,1,2", "0,1,2,3", "3"], 1),
            ("`pip` is used for?", ["Testing", "Packaging", "Debugging", "Typing"], 1),
            ("Which is a Python web framework?", ["Laravel", "Django", "Spring", "Rails"], 1),
        ],
        "JavaScript": [
            ("`typeof null` returns?", ["null", "object", "undefined", "number"], 1),
            ("Which is NOT a JS primitive?", ["string", "number", "array", "boolean"], 2),
            ("`===` checks?", ["Value only", "Type only", "Value and type", "Reference"], 2),
            ("`let` vs `var` — key difference?", ["None", "Block scope", "Hoisting", "Speed"], 1),
            ("Promise method to catch errors?", [".then", ".catch", ".finally", ".error"], 1),
            ("Which creates a React component?", ["function X(){}", "component X", "def X", "new X"], 0),
        ],
        "React": [
            ("Hook for side effects?", ["useState", "useEffect", "useMemo", "useRef"], 1),
            ("Props are?", ["Mutable", "Read-only", "Global", "Private"], 1),
            ("Keys help React?", ["Style", "Diff efficiently", "Fetch", "Route"], 1),
            ("Context is used for?", ["Styling", "Global state", "Fetching", "Testing"], 1),
            ("Which is a hook?", ["useFetch", "useState", "getState", "stateHook"], 1),
            ("JSX is compiled by?", ["Webpack only", "Babel", "Node", "TS"], 1),
        ],
        "SQL": [
            ("Which retrieves data?", ["GET", "SELECT", "FETCH", "PULL"], 1),
            ("JOIN returns rows where?", ["Only left", "Only right", "Matching both", "All"], 2),
            ("Primary key is?", ["Nullable", "Unique", "Optional", "Foreign"], 1),
            ("`GROUP BY` is used with?", ["ORDER", "Aggregates", "JOIN", "WHERE"], 1),
            ("Which is DDL?", ["SELECT", "CREATE", "INSERT", "UPDATE"], 1),
            ("Index improves?", ["Writes", "Reads", "Storage", "Nothing"], 1),
        ],
        "Data Science": [
            ("Which library for dataframes?", ["numpy", "pandas", "matplotlib", "scipy"], 1),
            ("Mean of [1,2,3,4]?", ["2", "2.5", "3", "3.5"], 1),
            ("Overfitting means?", ["Underfit", "Fit noise", "Perfect", "None"], 1),
            ("Which is supervised?", ["K-means", "Linear Regression", "PCA", "DBSCAN"], 1),
            ("Train-test split purpose?", ["Faster", "Evaluate generalization", "Save memory", "None"], 1),
            ("P-value < 0.05 typically?", ["Accept null", "Reject null", "Ignore", "None"], 1),
        ],
        "Java": [
            ("JVM stands for?", ["Java Virtual Machine", "Java Very Much", "Just Virtual Machine", "None"], 0),
            ("Which is not primitive?", ["int", "boolean", "String", "double"], 2),
            ("Java is?", ["Compiled only", "Interpreted only", "Both", "Neither"], 2),
            ("`final` means?", ["Private", "Cannot override", "Static", "Volatile"], 1),
            ("Collections: List is?", ["Unordered", "Ordered", "Set", "None"], 1),
            ("Keyword for inheritance?", ["implements", "extends", "inherits", "super"], 1),
        ],
        "Machine Learning": [
            ("Sigmoid is used in?", ["Regression", "Logistic Regression", "KNN", "PCA"], 1),
            ("Gradient descent minimizes?", ["Variance", "Loss", "Bias", "None"], 1),
            ("Random Forest is?", ["Bagging", "Boosting", "Stacking", "None"], 0),
            ("CNN used for?", ["Text", "Images", "Audio only", "None"], 1),
            ("Regularization fights?", ["Underfit", "Overfit", "Both", "None"], 1),
            ("KNN is?", ["Parametric", "Non-parametric", "Linear", "None"], 1),
        ],
        "Docker": [
            ("Dockerfile defines?", ["Image", "Container state", "Volume", "Network"], 0),
            ("Which runs container?", ["docker run", "docker ps", "docker build", "docker exec"], 0),
            ("Layer caching speeds?", ["Build", "Run", "Stop", "Pull"], 0),
            ("Compose is for?", ["Multi-container", "Single container", "Swarm only", "None"], 0),
            ("Volume persists?", ["Data", "Image", "Container", "None"], 0),
            ("Base image keyword?", ["FROM", "BASE", "ROOT", "INIT"], 0),
        ],
        "Node.js": [
            ("Node runs on?", ["V8", "SpiderMonkey", "Chakra", "Nashorn"], 0),
            ("Non-blocking means?", ["Sync", "Async", "Threaded", "None"], 1),
            ("`npm` installs?", ["Python", "Node packages", "Java", "None"], 1),
            ("Express is a?", ["DB", "Framework", "CLI", "Editor"], 1),
            ("Event loop uses?", ["Threads only", "Single thread + callbacks", "GPU", "None"], 1),
            ("`package.json` holds?", ["Binaries", "Metadata+deps", "Logs", "Certs"], 1),
        ],
        "System Design": [
            ("CAP stands for?", ["Consistency Availability Partition", "Code API Product", "Cache API Proxy", "None"], 0),
            ("Load balancer at?", ["Client", "Server", "Both", "None"], 1),
            ("Cache reduces?", ["Latency", "Storage", "Cost", "None"], 0),
            ("Horizontal scaling means?", ["Bigger machine", "More machines", "More RAM", "None"], 1),
            ("Sharding splits?", ["Data", "Code", "Users", "None"], 0),
            ("Message queue helps?", ["Sync calls", "Decoupling", "Logging", "None"], 1),
        ],
        "HTML/CSS": [
            ("CSS stands for?", ["Cascading Style Sheets", "Computer Style Sheets", "Creative Style System", "None"], 0),
            ("Flexbox main axis default?", ["Row", "Column", "Both", "None"], 0),
            ("Semantic tag?", ["<div>", "<section>", "<span>", "<b>"], 1),
            ("Box model excludes?", ["margin", "padding", "border", "content"], 0),
            ("Grid is for?", ["1D", "2D", "3D", "None"], 1),
            ("Selector for id?", ["#", ".", "*", "@"], 0),
        ],
    }
    rows = []
    for skill, qs in bank.items():
        for i, (q, opts, correct) in enumerate(qs):
            rows.append({
                "skill": skill,
                "difficulty": (i % 5) + 1,
                "question": q,
                "options": opts,
                "correct_index": correct,
                "explanation": f"Correct answer: {opts[correct]}",
            })
    supabase.table("questions").insert(rows).execute()


def _seed_students():
    first = ["Aarav", "Isha", "Rohan", "Priya", "Vikram", "Ananya", "Karthik", "Sneha", "Rahul", "Meera",
             "Arjun", "Diya", "Aditya", "Kavya", "Nikhil", "Tanvi", "Siddharth", "Riya", "Manav", "Neha"]
    last = ["Sharma", "Patel", "Kumar", "Reddy", "Singh", "Iyer", "Nair", "Gupta", "Mehta", "Joshi",
            "Verma", "Bose", "Chopra", "Kapoor", "Rao", "Pillai", "Das", "Khan", "Sinha", "Yadav"]
    colleges = ["IIT Bombay", "IIT Delhi", "NIT Trichy", "BITS Pilani", "VIT Vellore", "IIIT Hyderabad",
                "DTU Delhi", "NSIT Delhi", "PES Bangalore", "SRM Chennai"]
    roles = ["Full-Stack Developer", "Data Scientist", "ML Engineer", "Backend Developer",
             "Frontend Developer", "DevOps Engineer", "Android Developer", "Data Analyst"]
    skill_pool = ["Python", "JavaScript", "React", "SQL", "Data Science", "Java",
                  "Machine Learning", "Docker", "Node.js", "System Design", "HTML/CSS"]

    rows_u = []
    for i in range(20):
        name = f"{first[i]} {last[i]}"
        phone = f"90000{10000 + i}"
        email = f"{first[i].lower()}.{last[i].lower()}@example.com"
        rows_u.append({
            "phone": phone, "role": "student", "name": name,
            "email": email, "onboarded": True,
        })

    users_res = supabase.table("users").insert(rows_u).execute().data

    rows_s = []
    for i, u in enumerate(users_res):
        skills = {}
        picked = random.sample(skill_pool, k=random.randint(3, 6))
        for sk in picked:
            skills[sk] = random.randint(2, 5)
        rows_s.append({
            "user_id": u["id"],
            "name": u["name"],
            "email": u["email"],
            "phone": u["phone"],
            "college": random.choice(colleges),
            "degree": random.choice(["B.Tech CSE", "B.Tech IT", "B.Tech ECE", "BCA", "MCA", "B.Sc CS"]),
            "graduation_year": random.choice([2025, 2026, 2027]),
            "target_role": random.choice(roles),
            "skills": skills,
            "ai_scores": skills,
            "match_scores": {},
            "bio": f"{random.choice(roles)} aspirant passionate about {picked[0]}.",
        })
    supabase.table("students").insert(rows_s).execute()


def _seed_companies():
    companies = [
        ("TechNova Solutions", "Software", "Bangalore", "https://technova.example"),
        ("DataMinds AI", "AI/ML", "Hyderabad", "https://dataminds.example"),
        ("CloudPeak Systems", "Cloud", "Pune", "https://cloudpeak.example"),
        ("FinEdge Capital", "Fintech", "Mumbai", "https://finedge.example"),
        ("HealthSync Labs", "HealthTech", "Delhi", "https://healthsync.example"),
        ("RetailRocket", "E-commerce", "Gurgaon", "https://retailrocket.example"),
        ("EduSpark", "EdTech", "Chennai", "https://eduspark.example"),
        ("CyberShield", "Cybersecurity", "Noida", "https://cybershield.example"),
        ("GreenGrid Energy", "EnergyTech", "Ahmedabad", "https://greengrid.example"),
        ("LogiChain", "Logistics", "Kolkata", "https://logichain.example"),
        ("PixelWorks Studio", "Gaming", "Pune", "https://pixelworks.example"),
        ("VoiceAI Labs", "AI/ML", "Bangalore", "https://voiceai.example"),
        ("QuantumLeap", "DeepTech", "Hyderabad", "https://quantumleap.example"),
        ("NexaCommerce", "E-commerce", "Mumbai", "https://nexacommerce.example"),
        ("BrightPath Analytics", "Data", "Chennai", "https://brightpath.example"),
        ("SwiftRoute", "Mobility", "Bangalore", "https://swiftroute.example"),
        ("MediCare Cloud", "HealthTech", "Delhi", "https://medicarecloud.example"),
        ("InsureTech One", "Insurtech", "Pune", "https://insuretechone.example"),
        ("AgriNext", "AgriTech", "Nagpur", "https://agrinext.example"),
        ("SpaceFold", "Aerospace", "Bangalore", "https://spacefold.example"),
    ]
    skill_pool = ["Python", "JavaScript", "React", "SQL", "Data Science", "Java",
                  "Machine Learning", "Docker", "Node.js", "System Design", "HTML/CSS"]

    rows_u = []
    for i, (name, *_rest) in enumerate(companies):
        rows_u.append({
            "phone": f"80000{10000 + i}",
            "role": "industry",
            "name": name,
            "email": f"hr{i + 1}@{name.lower().replace(' ', '')}.com",
            "onboarded": True,
        })

    users_res = supabase.table("users").insert(rows_u).execute().data

    rows_c = []
    for i, u in enumerate(users_res):
        name, industry, location, website = companies[i]
        rows_c.append({
            "user_id": u["id"],
            "name": name,
            "industry": industry,
            "website": website,
            "location": location,
            "logo_color": random.choice(["#6c8cff", "#a86bff", "#35d28f", "#ffb02e", "#ff5c72"]),
            "about": f"{name} is a fast-growing {industry} company based in {location}.",
        })
    companies_res = supabase.table("companies").insert(rows_c).execute().data

    rows_j = []
    titles = ["Software Engineer Intern", "Data Analyst Intern", "Full-Stack Intern",
              "ML Intern", "Backend Intern", "Frontend Intern", "DevOps Intern"]
    for c in companies_res:
        for _ in range(3):
            req = {}
            picked = random.sample(skill_pool, k=random.randint(2, 4))
            for sk in picked:
                req[sk] = random.randint(2, 5)
            rows_j.append({
                "company_id": c["id"],
                "title": random.choice(titles),
                "description": f"Work on real projects at {c['name']}.",
                "required_skills": req,
                "location": c["location"],
                "type": random.choice(["Internship", "Internship", "Full-time"]),
                "stipend": random.choice(["₹15,000/mo", "₹25,000/mo", "₹40,000/mo", "₹60,000/mo"]),
                "duration": random.choice(["3 months", "6 months", "12 months"]),
            })
    supabase.table("jobs").insert(rows_j).execute()


# =========================================================
# LIFECYCLE — close HTTP client on shutdown
# =========================================================
@app.on_event("shutdown")
async def _shutdown():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()


# =========================================================
# STATIC
# =========================================================
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)