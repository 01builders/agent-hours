"""
Email ingestion for Mark.
Connects to IMAP inbox, finds TLDR newsletter emails, parses them,
and stores structured data in the database.

IMPORTANT: Mark only ingests emails from TLDR Founders, TLDR Fintech,
and TLDR Crypto. All other emails are ignored.

Usage:
    python3 -m src.ingestion.ingest
"""

import imaplib
import email
from email.header import decode_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

from src.config import Config
from src.utils.logger import get_logger
from src.utils.models import Newsletter, NewsletterItem, EnrichedLink, get_session
from src.utils.helpers import detect_newsletter_source, now_utc, days_ago
from src.ingestion.parser import parse_newsletter_html, parse_newsletter_text

logger = get_logger("mark.ingest")


def decode_header_value(value: str) -> str:
    """Decode an email header value that might be encoded."""
    if not value:
        return ""
    decoded_parts = decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(part)
    return " ".join(result)


def get_email_body(msg: email.message.Message) -> tuple[str, str]:
    """
    Extract HTML and plain-text body from an email message.
    Returns (html_body, text_body).
    """
    html_body = ""
    text_body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))

            # Skip attachments
            if "attachment" in content_disposition:
                continue

            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except Exception as e:
                logger.warning(f"Failed to decode email part: {e}")
                continue

            if content_type == "text/html":
                html_body = decoded
            elif content_type == "text/plain":
                text_body = decoded
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if msg.get_content_type() == "text/html":
                    html_body = decoded
                else:
                    text_body = decoded
        except Exception as e:
            logger.warning(f"Failed to decode email body: {e}")

    return html_body, text_body


def ingest_emails():
    """
    Main ingestion function.
    Connects to IMAP, finds TLDR newsletters, parses them, stores in DB.
    """
    # Validate configuration
    errors = Config.validate()
    if errors:
        for err in errors:
            logger.error(err)
        raise RuntimeError("Configuration errors. Check your .env file.")

    Config.ensure_dirs()
    session = get_session()

    logger.info("Connecting to IMAP server...")

    try:
        # Connect to IMAP
        mail = imaplib.IMAP4_SSL(Config.IMAP_SERVER, Config.IMAP_PORT)
        mail.login(Config.IMAP_EMAIL, Config.IMAP_PASSWORD)
        mail.select("INBOX")
        logger.info("Connected to IMAP successfully.")
    except imaplib.IMAP4.error as e:
        logger.error(f"IMAP login failed: {e}")
        logger.error("Check IMAP_EMAIL and IMAP_PASSWORD in .env. For Gmail, use an App Password.")
        raise

    # Search for TLDR emails
    # We search broadly and filter in Python for better control
    cutoff_date = days_ago(Config.INITIAL_INGEST_DAYS)
    date_str = cutoff_date.strftime("%d-%b-%Y")

    try:
        # Search for emails from TLDR senders since cutoff
        all_uids = set()
        for sender in Config.TLDR_SENDERS:
            _, data = mail.search(None, f'(FROM "{sender}" SINCE "{date_str}")')
            if data[0]:
                all_uids.update(data[0].split())

        # Also search by subject as backup
        for pattern in Config.TLDR_SUBJECT_PATTERNS:
            _, data = mail.search(None, f'(SUBJECT "{pattern}" SINCE "{date_str}")')
            if data[0]:
                all_uids.update(data[0].split())

        logger.info(f"Found {len(all_uids)} potential TLDR emails.")

    except imaplib.IMAP4.error as e:
        logger.error(f"IMAP search failed: {e}")
        mail.logout()
        raise

    # Get existing message IDs to avoid duplicates
    existing_ids = {
        row[0] for row in session.query(Newsletter.message_id).all()
    }

    ingested_count = 0

    for uid in sorted(all_uids):
        try:
            # Fetch the email
            _, msg_data = mail.fetch(uid, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue

            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)

            # Get message ID for dedup
            message_id = msg.get("Message-ID", "").strip()
            if not message_id:
                message_id = f"uid-{uid.decode()}"

            if message_id in existing_ids:
                continue

            # Decode headers
            subject = decode_header_value(msg.get("Subject", ""))
            sender = decode_header_value(msg.get("From", ""))

            # Determine newsletter source
            source = detect_newsletter_source(subject, sender)
            if source is None:
                # Not a TLDR newsletter we care about
                continue

            # Parse date
            date_str_raw = msg.get("Date", "")
            try:
                email_date = parsedate_to_datetime(date_str_raw)
                if email_date.tzinfo is None:
                    email_date = email_date.replace(tzinfo=timezone.utc)
            except Exception:
                email_date = now_utc()

            # Extract body
            html_body, text_body = get_email_body(msg)

            logger.info(f"Parsing: {source} — {subject[:60]} — {email_date:%Y-%m-%d}")

            # Parse into structured items
            if html_body:
                parsed = parse_newsletter_html(html_body)
            else:
                parsed = parse_newsletter_text(text_body)

            # Store newsletter record
            newsletter = Newsletter(
                message_id=message_id,
                source=source,
                subject=subject,
                date=email_date,
                raw_text=text_body[:50000] if text_body else None,
                raw_html=html_body[:200000] if html_body else None,
            )
            session.add(newsletter)
            session.flush()  # Get the ID

            # Store parsed items
            for item in parsed.items:
                db_item = NewsletterItem(
                    newsletter_id=newsletter.id,
                    section=item.section,
                    headline=item.headline,
                    summary=item.summary,
                    url=item.url,
                    position=item.position,
                )
                session.add(db_item)
                session.flush()

                # Create placeholder for link enrichment if URL exists
                if item.url:
                    link = EnrichedLink(
                        item_id=db_item.id,
                        url=item.url,
                        fetch_status="pending",
                    )
                    session.add(link)

            existing_ids.add(message_id)
            ingested_count += 1

        except Exception as e:
            logger.error(f"Error processing email UID {uid}: {e}")
            session.rollback()
            continue

    session.commit()
    session.close()
    mail.logout()

    logger.info(f"Ingestion complete. {ingested_count} new newsletters processed.")
    return ingested_count


if __name__ == "__main__":
    count = ingest_emails()
    print(f"✓ Ingested {count} new newsletter(s).")
