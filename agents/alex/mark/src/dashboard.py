import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

"""
Mark Dashboard — Streamlit app for strategic intelligence visualization.

Usage:
    streamlit run src/dashboard.py
"""

import json
from datetime import datetime, timedelta, timezone

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from sqlalchemy import func, and_, desc

from src.config import Config
from src.utils.models import (
    Newsletter, NewsletterItem, Category, TrendSnapshot,
    DailySummary, WeeklySummary, EnrichedLink,
    item_category, get_session,
)
from src.utils.helpers import days_ago

# ── Page Config ───────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Mark — Strategic Intelligence",
    page_icon="🔍",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Styling ───────────────────────────────────────────────────────────────────

st.markdown("""
<style>
    .stApp { background-color: #0e1117; }
    h1 { color: #e0e0e0; font-weight: 300; letter-spacing: -0.5px; }
    h2 { color: #c0c0c0; font-weight: 400; }
    h3 { color: #a0a0a0; }
    .metric-card {
        background: #1a1d23;
        border: 1px solid #2a2d35;
        border-radius: 8px;
        padding: 16px;
        margin: 4px 0;
    }
    .standout-card {
        background: #1a2332;
        border-left: 3px solid #4a9eff;
        padding: 12px 16px;
        margin: 8px 0;
        border-radius: 4px;
    }
</style>
""", unsafe_allow_html=True)


# ── Data Loading ──────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_newsletters():
    """Load all newsletters."""
    session = get_session()
    data = session.query(Newsletter).order_by(Newsletter.date.desc()).all()
    result = [{
        "id": n.id, "source": n.source, "subject": n.subject,
        "date": n.date, "ingested_at": n.ingested_at,
    } for n in data]
    session.close()
    return pd.DataFrame(result) if result else pd.DataFrame()


@st.cache_data(ttl=300)
def load_items(days: int = 30, source_filter: str = "all"):
    """Load newsletter items with scores and categories."""
    session = get_session()
    cutoff = days_ago(days)
    query = (
        session.query(NewsletterItem, Newsletter)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(Newsletter.date >= cutoff)
    )
    if source_filter != "all":
        query = query.filter(Newsletter.source == source_filter)

    query = query.order_by(NewsletterItem.importance_score.desc().nullslast())
    results = query.all()

    items = []
    for item, nl in results:
        cats = [c.display_name or c.name for c in item.categories]
        items.append({
            "id": item.id,
            "date": nl.date,
            "source": nl.source,
            "headline": item.headline,
            "summary": (item.summary or "")[:200],
            "url": item.url or "",
            "importance": item.importance_score or 0,
            "attention": item.attention_score or 0,
            "is_standout": item.is_standout,
            "standout_reason": item.standout_reason or "",
            "categories": ", ".join(cats),
            "explanation": item.scoring_explanation or "",
        })
    session.close()
    return pd.DataFrame(items) if items else pd.DataFrame()


@st.cache_data(ttl=300)
def load_trends(window_days: int = 7):
    """Load trend snapshots."""
    session = get_session()
    snapshots = (
        session.query(TrendSnapshot, Category)
        .join(Category, Category.id == TrendSnapshot.category_id)
        .filter(TrendSnapshot.window_days == window_days)
        .order_by(TrendSnapshot.snapshot_date.desc())
        .all()
    )
    data = [{
        "date": s.snapshot_date,
        "category": c.display_name or c.name,
        "mentions": s.mention_count,
        "avg_importance": s.avg_importance,
        "avg_attention": s.avg_attention,
        "momentum": s.momentum_score,
        "window": s.window_days,
    } for s, c in snapshots]
    session.close()
    return pd.DataFrame(data) if data else pd.DataFrame()


@st.cache_data(ttl=300)
def load_latest_briefing():
    """Load the most recent daily briefing."""
    session = get_session()
    briefing = (
        session.query(DailySummary)
        .order_by(DailySummary.summary_date.desc())
        .first()
    )
    result = briefing.content if briefing else None
    session.close()
    return result


@st.cache_data(ttl=300)
def load_latest_weekly():
    """Load the most recent weekly memo."""
    session = get_session()
    memo = (
        session.query(WeeklySummary)
        .order_by(WeeklySummary.week_end.desc())
        .first()
    )
    result = memo.content if memo else None
    session.close()
    return result


# ── Sidebar ───────────────────────────────────────────────────────────────────

st.sidebar.title("🔍 Mark")
st.sidebar.caption("Strategic News Synthesizer")

page = st.sidebar.radio(
    "Navigate",
    ["Overview", "Daily Briefing", "Weekly Memo", "Themes & Trends",
     "Items Explorer", "Standout Items", "Recommendations"],
)

st.sidebar.divider()

# Global filters
date_range = st.sidebar.selectbox(
    "Time window",
    [7, 14, 30, 60, 90],
    index=0,
    format_func=lambda x: f"Last {x} days",
)

source_filter = st.sidebar.selectbox(
    "Newsletter source",
    ["all", "founders", "fintech", "crypto"],
    format_func=lambda x: x.title() if x != "all" else "All Sources",
)


# ── Pages ─────────────────────────────────────────────────────────────────────

if page == "Overview":
    st.title("Mark — Strategic Intelligence Overview")

    items_df = load_items(date_range, source_filter)
    newsletters_df = load_newsletters()

    # Key metrics
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Newsletters Ingested", len(newsletters_df) if not newsletters_df.empty else 0)
    with col2:
        st.metric("Items Tracked", len(items_df) if not items_df.empty else 0)
    with col3:
        standout_count = items_df["is_standout"].sum() if not items_df.empty and "is_standout" in items_df.columns else 0
        st.metric("Standout Items", int(standout_count))
    with col4:
        avg_imp = items_df["importance"].mean() if not items_df.empty and "importance" in items_df.columns else 0
        st.metric("Avg Importance", f"{avg_imp:.1f}/10")

    st.divider()

    if not items_df.empty:
        # Top items
        st.subheader("Highest Importance Items")
        top = items_df.nlargest(10, "importance")
        for _, row in top.iterrows():
            with st.container():
                cols = st.columns([6, 1, 1])
                with cols[0]:
                    label = f"**{row['headline'][:80]}**"
                    if row.get("url"):
                        label += f" [↗]({row['url']})"
                    st.markdown(label)
                    st.caption(f"{row['source'].upper()} · {row.get('categories', '')}")
                with cols[1]:
                    st.metric("Importance", f"{row['importance']:.1f}")
                with cols[2]:
                    st.metric("Attention", f"{row['attention']:.1f}")

        st.divider()

        # Source distribution
        if "source" in items_df.columns:
            st.subheader("Items by Source")
            source_counts = items_df["source"].value_counts()
            fig = px.pie(
                values=source_counts.values,
                names=source_counts.index,
                color_discrete_sequence=["#4a9eff", "#ff6b6b", "#51cf66"],
            )
            fig.update_layout(
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font_color="#c0c0c0",
            )
            st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No items found. Run ingestion and analysis first.")


elif page == "Daily Briefing":
    st.title("Daily Executive Briefing")
    briefing = load_latest_briefing()
    if briefing:
        st.markdown(briefing)
    else:
        st.info("No briefing generated yet. Run: `python3 -m src.output.daily_briefing`")


elif page == "Weekly Memo":
    st.title("Weekly Strategic Memo")
    memo = load_latest_weekly()
    if memo:
        st.markdown(memo)
    else:
        st.info("No weekly memo generated yet. Run: `python3 -m src.output.weekly_memo`")


elif page == "Themes & Trends":
    st.title("Themes & Trends")

    trends_df = load_trends(window_days=date_range if date_range in [7, 30, 90] else 7)

    if not trends_df.empty:
        # Latest snapshot
        latest_date = trends_df["date"].max()
        latest = trends_df[trends_df["date"] == latest_date].copy()

        if not latest.empty:
            # Top themes by importance
            st.subheader(f"Top Themes (last {date_range} days)")
            top_themes = latest.nlargest(15, "avg_importance")

            fig = px.bar(
                top_themes,
                x="avg_importance",
                y="category",
                orientation="h",
                color="momentum",
                color_continuous_scale=["#ff6b6b", "#ffd43b", "#51cf66"],
                labels={"avg_importance": "Avg Importance", "category": "", "momentum": "Momentum"},
            )
            fig.update_layout(
                yaxis=dict(autorange="reversed"),
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font_color="#c0c0c0",
                height=500,
            )
            st.plotly_chart(fig, use_container_width=True)

            # Momentum chart
            st.subheader("Momentum by Category")
            momentum_sorted = latest.sort_values("momentum", ascending=False)
            fig2 = px.bar(
                momentum_sorted,
                x="momentum",
                y="category",
                orientation="h",
                color="momentum",
                color_continuous_scale=["#ff6b6b", "#868e96", "#51cf66"],
                color_continuous_midpoint=0,
            )
            fig2.update_layout(
                yaxis=dict(autorange="reversed"),
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font_color="#c0c0c0",
                height=500,
            )
            st.plotly_chart(fig2, use_container_width=True)

            # Attention vs Importance scatter
            st.subheader("Attention vs Strategic Importance")
            fig3 = px.scatter(
                latest,
                x="avg_attention",
                y="avg_importance",
                size="mentions",
                color="momentum",
                text="category",
                color_continuous_scale=["#ff6b6b", "#ffd43b", "#51cf66"],
                labels={
                    "avg_attention": "Attention (buzz)",
                    "avg_importance": "Strategic Importance",
                },
            )
            fig3.update_traces(textposition="top center", textfont_size=10)
            fig3.update_layout(
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font_color="#c0c0c0",
                height=500,
            )
            st.plotly_chart(fig3, use_container_width=True)

        # Trend over time (if multiple snapshots exist)
        if len(trends_df["date"].unique()) > 1:
            st.subheader("Theme Mentions Over Time")
            # Top 8 categories by recent mentions
            top_cats = latest.nlargest(8, "mentions")["category"].tolist()
            time_data = trends_df[trends_df["category"].isin(top_cats)]

            fig4 = px.line(
                time_data,
                x="date",
                y="mentions",
                color="category",
                labels={"mentions": "Mention Count", "date": "Date"},
            )
            fig4.update_layout(
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font_color="#c0c0c0",
                height=400,
            )
            st.plotly_chart(fig4, use_container_width=True)

    else:
        st.info("No trend data yet. Run analysis first.")


elif page == "Items Explorer":
    st.title("Newsletter Items Explorer")

    items_df = load_items(date_range, source_filter)

    if not items_df.empty:
        # Sort options
        sort_by = st.selectbox("Sort by", ["importance", "attention", "date"], index=0)
        ascending = sort_by == "date"
        sorted_df = items_df.sort_values(sort_by, ascending=ascending)

        # Display table
        display_cols = ["date", "source", "headline", "importance", "attention", "categories"]
        available_cols = [c for c in display_cols if c in sorted_df.columns]
        st.dataframe(
            sorted_df[available_cols].head(100),
            use_container_width=True,
            column_config={
                "date": st.column_config.DateColumn("Date"),
                "importance": st.column_config.ProgressColumn("Importance", min_value=0, max_value=10),
                "attention": st.column_config.ProgressColumn("Attention", min_value=0, max_value=10),
            },
        )

        # Item detail expander
        st.divider()
        st.subheader("Item Details")
        selected_idx = st.number_input("Item row #", 0, len(sorted_df) - 1, 0)
        if selected_idx < len(sorted_df):
            row = sorted_df.iloc[selected_idx]
            st.markdown(f"### {row['headline']}")
            if row.get("url"):
                st.markdown(f"[Open article ↗]({row['url']})")
            st.markdown(f"**Source:** {row['source'].upper()} · **Date:** {row['date']}")
            st.markdown(f"**Categories:** {row.get('categories', 'N/A')}")
            st.markdown(f"**Importance:** {row['importance']:.1f}/10 · **Attention:** {row['attention']:.1f}/10")
            if row.get("explanation"):
                st.markdown(f"**Scoring rationale:** {row['explanation']}")
            if row.get("summary"):
                st.markdown(f"**Summary:** {row['summary']}")
    else:
        st.info("No items found. Run ingestion and analysis first.")


elif page == "Standout Items":
    st.title("🔥 Read This Now")
    st.caption("Items flagged as unusually worth reading in full")

    items_df = load_items(date_range, source_filter)

    if not items_df.empty and "is_standout" in items_df.columns:
        standouts = items_df[items_df["is_standout"] == True].sort_values("importance", ascending=False)

        if not standouts.empty:
            for _, row in standouts.iterrows():
                st.markdown(f"""
<div class="standout-card">
    <strong>{row['headline']}</strong><br>
    <small>{row['source'].upper()} · Importance: {row['importance']:.1f}/10</small><br>
    <em>{row.get('standout_reason', '')}</em>
</div>
""", unsafe_allow_html=True)
                if row.get("url"):
                    st.markdown(f"[Read full article ↗]({row['url']})")
                st.divider()
        else:
            st.info("No standout items in this time window.")
    else:
        st.info("No data available. Run ingestion and analysis first.")


elif page == "Recommendations":
    st.title("Strategic Recommendations")

    # Load latest briefing recommendations
    briefing = load_latest_briefing()
    memo = load_latest_weekly()

    if briefing:
        st.subheader("From Latest Daily Briefing")
        st.markdown(briefing)

    st.divider()

    if memo:
        st.subheader("From Latest Weekly Memo")
        st.markdown(memo)

    if not briefing and not memo:
        st.info("No recommendations yet. Generate a daily briefing or weekly memo first.")


# ── Footer ────────────────────────────────────────────────────────────────────

st.sidebar.divider()
st.sidebar.caption(
    "Mark reads ONLY TLDR Founders, Fintech, and Crypto newsletters. "
    "No other sources."
)
