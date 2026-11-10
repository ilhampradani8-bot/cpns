#!/usr/bin/env python3
"""
Google Alerts IMAP Fetcher for CPNS Bot
Strictly reads ONLY emails from 'googlealerts-noreply@google.com'.
Extracts Title, Summary (Rangkuman), and Original Direct Link.
Maintains sent history in data/processed_alerts.json to prevent duplicates.
"""

import os
import sys
import json
import imaplib
import email
from email.header import decode_header
import re
import urllib.parse
import urllib.request
from html import unescape

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, ".env")

# Dynamic .env loader
def load_env_vars():
    env = {}
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip("'\"")
        except Exception:
            pass
    return env

_local_env = load_env_vars()

EMAIL_USER = os.getenv("GOOGLE_ALERT_EMAIL", _local_env.get("GOOGLE_ALERT_EMAIL", "algojodua2@gmail.com"))
EMAIL_PASS = os.getenv("GOOGLE_ALERT_PASS", _local_env.get("GOOGLE_ALERT_PASS", "dvspqcgoetvpovuc"))

GROQ_KEYS = [
    k for k in [
        os.getenv("GROQ_API_KEY_1", _local_env.get("GROQ_API_KEY_1")),
        os.getenv("GROQ_API_KEY_2", _local_env.get("GROQ_API_KEY_2")),
    ] if k
]
GROQ_MODEL = "qwen/qwen3.8-27b"

DATA_DIR = os.path.join(BASE_DIR, "data")
PROCESSED_FILE = os.path.join(DATA_DIR, "processed_alerts.json")


def load_processed_urls():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(PROCESSED_FILE):
        try:
            with open(PROCESSED_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data.get("urls", [])), set(data.get("message_ids", []))
        except Exception:
            pass
    return set(), set()


def save_processed(processed_urls, processed_msg_ids):
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)
    tmp = f"{PROCESSED_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(
            {
                "urls": list(processed_urls)[-1000:],
                "message_ids": list(processed_msg_ids)[-500:],
            },
            f,
            indent=2,
            ensure_ascii=False,
        )
    os.replace(tmp, PROCESSED_FILE)


def unwrap_google_url(raw_url):
    try:
        p = urllib.parse.urlparse(raw_url)
        qs = urllib.parse.parse_qs(p.query)
        if "url" in qs:
            return qs["url"][0]
        if "q" in qs:
            return qs["q"][0]
    except Exception:
        pass
    return raw_url


def clean_html(text):
    if not text:
        return ""
    # remove html tags
    text = re.sub(r"<[^>]+>", " ", text)
    # unescape html entities like &amp;, &quot;, &#39;
    text = unescape(text)
    # clean extra spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def scrape_article_text(url):
    """
    Scrape isi artikel berita asli agar Groq AI bisa mengindeks seluruh isi dan detail formasi
    """
    if not url or "youtube.com" in url or "youtu.be" in url or "instagram.com" in url:
        return ""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
            paragraphs = re.findall(r"<p[^>]*>([\s\S]*?)</p>", html)
            clean_text = " ".join(
                [
                    unescape(re.sub(r"<[^>]+>", " ", p)).strip()
                    for p in paragraphs
                    if len(p.strip()) > 20
                ]
            )
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            return clean_text[:4000]
    except Exception:
        return ""


def summarize_with_groq(title, raw_desc, article_url=""):
    """
    Rangkum berita menjadi poin-poin informatif & konkret dengan web scraping artikel asli
    """
    if not title:
        return raw_desc

    # Scrape web asli jika ada URL
    full_text = ""
    if article_url:
        full_text = scrape_article_text(article_url)

    if full_text and len(full_text) > 200:
        content_source = f"Isi Lengkap Artikel Web:\n{full_text}"
    else:
        content_source = f"Kutipan Awal:\n{raw_desc}"

    prompt = (
        f"Kamu adalah AI asisten CPNS perangkum berita resmi yang SANGAT INFORMATIF, SPESIFIK, dan DETAIL.\n"
        f"Tugasmu merangkum fakta konkret dari berita berikut ke dalam Bahasa Indonesia.\n"
        f"WAJIB: Jika dalam berita ada penyebutan angka atau bidang formasi (contoh: '4 bidang' atau bocoran formasi), "
        f"kamu WAJIB MENJELASKAN RINCI SATU PER SATU bidang/formasi apa saja yang dimaksud beserta instansi/syarat/jadwalnya!\n\n"
        f"Judul: {title}\n"
        f"{content_source}\n\n"
        f"Format balasan (singkat, padat, dan langsung to-the-point tanpa kalimat pembuka basa-basi):\n"
        f"• *Jadwal / Waktu:* [Penjelasan jadwal/waktu]\n"
        f"• *Daftar Formasi:* [Sebutkan detail konkret nama formasi yang dibocorkan, contoh: 1. ..., 2. ...]\n"
        f"• *Catatan / Syarat:* [Poin penting lainnya jika ada]"
    )

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Kamu AI perangkum berita CPNS. Berikan fakta konkret dan rincian formasi yang jelas "
                    "langsung to-the-point tanpa kalimat pembuka basa-basi."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 400,
        "temperature": 0.2,
    }

    for key in GROQ_KEYS:
        try:
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/chat/completions",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0",
                },
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                res = json.loads(response.read().decode("utf-8"))
                content = res["choices"][0]["message"]["content"].strip()
                if content:
                    return content
        except Exception:
            continue

    return raw_desc


def parse_articles_from_html(html):
    articles = []
    seen = set()

    # 1. Primary method: parse Google InboxMarkup JSON (<script type="application/json">)
    json_match = re.search(
        r'<script\s+[^>]*type=[\"\']application/json[\"\'][^>]*>([\s\S]*?)</script>',
        html,
    )
    if json_match:
        try:
            data = json.loads(json_match.group(1))
            cards = data.get("cards", [])
            for card in cards:
                for widget in card.get("widgets", []):
                    if widget.get("type") == "LINK":
                        title = clean_html(widget.get("title", ""))
                        summary = clean_html(widget.get("description", ""))
                        raw_url = widget.get("url", "")
                        clean_url = unwrap_google_url(raw_url)

                        if title and len(title) > 10 and clean_url not in seen:
                            seen.add(clean_url)
                            articles.append(
                                {
                                    "title": title,
                                    "summary": summary,
                                    "url": clean_url,
                                }
                            )
        except Exception:
            pass

    # 2. Fallback regex parser for HTML markup if JSON is missing or incomplete
    if not articles:
        blocks = re.findall(
            r'<a\s+[^>]*href=[\"\'](https?://[^\"]+google\.com/url[^\"]*)[\"\'][^>]*>([\s\S]*?)</a>([\s\S]*?)(?=<table|<tr|<a|$)',
            html,
        )
        for raw_url, raw_title, raw_desc in blocks:
            clean_url = unwrap_google_url(raw_url)
            title = clean_html(raw_title)
            summary = clean_html(raw_desc)
            if title and len(title) > 12 and clean_url not in seen:
                seen.add(clean_url)
                articles.append(
                    {
                        "title": title,
                        "summary": summary,
                        "url": clean_url,
                    }
                )

    return articles


def fetch_alerts(preview_only=False, max_emails=3):
    processed_urls, processed_msg_ids = load_processed_urls()

    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(EMAIL_USER, EMAIL_PASS)
        mail.select("INBOX")
    except Exception as e:
        return {"success": False, "error": f"Gagal login IMAP: {e}", "items": []}

    try:
        # STRICT FILTER: Only from googlealerts-noreply@google.com
        status, messages = mail.search(
            None, '(FROM "googlealerts-noreply@google.com")'
        )
        if status != "OK" or not messages[0]:
            mail.logout()
            return {"success": True, "count": 0, "items": []}

        msg_ids = messages[0].split()
        # Process latest emails (up to max_emails)
        recent_ids = msg_ids[-max_emails:]
        new_articles = []

        for mid in reversed(recent_ids):
            mid_str = mid.decode("utf-8")
            res, data = mail.fetch(mid, "(RFC822)")
            if res != "OK" or not data or not data[0]:
                continue

            msg = email.message_from_bytes(data[0][1])

            # Verify sender strictly
            sender = msg.get("From", "").lower()
            if "googlealerts-noreply@google.com" not in sender:
                continue

            # Verify subject
            subject_header = decode_header(msg.get("Subject", ""))[0]
            subject = subject_header[0]
            if isinstance(subject, bytes):
                subject = subject.decode(
                    subject_header[1] or "utf-8", errors="ignore"
                )

            # Extract date
            email_date = msg.get("Date", "")

            # Extract HTML body
            html_content = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/html":
                        payload = part.get_payload(decode=True)
                        if payload:
                            html_content = payload.decode(
                                "utf-8", errors="ignore"
                            )
                            break
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    html_content = payload.decode("utf-8", errors="ignore")

            if not html_content:
                continue

            parsed_list = parse_articles_from_html(html_content)
            for art in parsed_list:
                art_url = art["url"]
                if preview_only or (art_url not in processed_urls):
                    art["email_date"] = email_date
                    art["subject"] = subject
                    new_articles.append(art)
                    if not preview_only:
                        processed_urls.add(art_url)

            if not preview_only:
                processed_msg_ids.add(mid_str)

        mail.logout()

        # Enrich articles with Groq AI bullet-point executive summaries (with deep web scraping)
        for art in new_articles[:6]:
            try:
                art["ai_summary"] = summarize_with_groq(art["title"], art["summary"], art["url"])
            except Exception:
                art["ai_summary"] = art["summary"]

        if not preview_only and new_articles:
            save_processed(processed_urls, processed_msg_ids)

        return {"success": True, "count": len(new_articles), "items": new_articles}

    except Exception as e:
        try:
            mail.logout()
        except Exception:
            pass
        return {
            "success": False,
            "error": f"Error memproses email alert: {e}",
            "items": [],
        }


if __name__ == "__main__":
    preview = "--preview" in sys.argv
    res = fetch_alerts(preview_only=preview)
    print(json.dumps(res, indent=2, ensure_ascii=False))

