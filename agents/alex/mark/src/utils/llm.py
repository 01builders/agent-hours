"""
LLM abstraction layer for Mark.
Wraps the Anthropic API with retry logic and rate limiting.
Designed so swapping to OpenAI or another provider is straightforward.
"""

import time
import json
from pathlib import Path
from anthropic import Anthropic, APIError, RateLimitError

from src.config import Config
from src.utils.logger import get_logger

logger = get_logger("mark.llm")

# Initialize Anthropic client (lazy — only when first called)
_client = None


def _get_client() -> Anthropic:
    """Lazy-init the Anthropic client."""
    global _client
    if _client is None:
        if not Config.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY is not set. Check your .env file.")
        _client = Anthropic(api_key=Config.ANTHROPIC_API_KEY)
    return _client


def load_prompt(template_name: str) -> str:
    """Load a prompt template from the prompts/ directory."""
    path = Config.PROMPTS_DIR / template_name
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    return path.read_text().strip()


def call_llm(
    prompt: str,
    system: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.3,
    retries: int = 3,
) -> str:
    """
    Send a prompt to Claude and return the text response.

    Args:
        prompt: The user message content.
        system: Optional system prompt.
        max_tokens: Max response length.
        temperature: 0.0 = deterministic, 1.0 = creative.
        retries: Number of retry attempts on failure.

    Returns:
        The assistant's text response.
    """
    client = _get_client()

    for attempt in range(1, retries + 1):
        try:
            messages = [{"role": "user", "content": prompt}]
            kwargs = {
                "model": Config.ANTHROPIC_MODEL,
                "max_tokens": max_tokens,
                "messages": messages,
                "temperature": temperature,
            }
            if system:
                kwargs["system"] = system

            response = client.messages.create(**kwargs)
            text = response.content[0].text

            # Rate-limiting pause
            time.sleep(Config.API_CALL_DELAY)
            return text

        except RateLimitError:
            wait = 2 ** attempt * 5
            logger.warning(f"Rate limited. Waiting {wait}s before retry {attempt}/{retries}.")
            time.sleep(wait)

        except APIError as e:
            logger.error(f"Anthropic API error (attempt {attempt}/{retries}): {e}")
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)

    return ""


def call_llm_json(
    prompt: str,
    system: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.2,
) -> dict | list:
    """
    Call the LLM and parse the response as JSON.
    The prompt should instruct the model to return valid JSON.
    """
    text = call_llm(prompt, system=system, max_tokens=max_tokens, temperature=temperature)

    # Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Remove first and last lines (```json and ```)
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM JSON response: {e}\nRaw text:\n{text[:500]}")
        return {}
