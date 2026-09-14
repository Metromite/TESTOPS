"""
models/ai_config.py
----------------------
V1 kept the active AI provider/model/API-key selection in Streamlit's
session state (`st.session_state`), configured through a Settings tab.
That doesn't survive a server restart and isn't shared across users in a
real multi-user deployment. This is a one-row settings table instead -
Admin-configurable, applies to every user's chat session.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AIProviderConfig(Base):
    __tablename__ = "ai_provider_config"

    id: Mapped[int] = mapped_column(primary_key=True)  # always row id=1, singleton-by-convention
    provider: Mapped[str] = mapped_column(String(32), default="groq")
    model: Mapped[str] = mapped_column(String(128), default="")
    api_key: Mapped[str] = mapped_column(String(255), default="")  # or Ollama endpoint URL, per V1's convention

    fallback_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    fallback_provider: Mapped[str] = mapped_column(String(32), default="ollama")
    fallback_model: Mapped[str] = mapped_column(String(128), default="")
    fallback_key: Mapped[str] = mapped_column(String(255), default="")
    # Full cascade: JSON list of {"provider","model","api_key"} tried in
    # order after the primary fails, so hitting one provider's free-tier
    # quota falls through to the next, and the next, rather than stopping
    # at a single fallback. The three fields above are kept for backward
    # compatibility (first entry defaults from them if this is empty).
    fallback_chain_json: Mapped[str] = mapped_column(Text, default="[]")

    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
