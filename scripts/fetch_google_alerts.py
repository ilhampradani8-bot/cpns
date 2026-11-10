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
from html import unescape

EMAIL_USER = os.getenv("GOOGLE_ALERT_EMAIL", "algojodua2@gmail.com")
EMAIL_PASS = os.getenv("GOOGLE_ALERT_PASS", "dvspqcgoetvpovuc")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
                if art_url not in processed_urls:
                    art["email_date"] = email_date
                    art["subject"] = subject
                    new_articles.append(art)
                    if not preview_only:
                        processed_urls.add(art_url)

            if not preview_only:
                processed_msg_ids.add(mid_str)

        mail.logout()

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
