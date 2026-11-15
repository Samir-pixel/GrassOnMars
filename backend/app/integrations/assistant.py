"""Stage 12 mission assistant: Gemini picks read-only MARSWALK tools; every number comes from a tool result."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any, Literal, NamedTuple

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.integrations import gemini, hazard_detection, terrain_analysis as ta
from app.schemas.common import MarsCoord
from app.schemas.routing import RoutePlanRequest
from app.services import catalogue as svc

NO_GUARANTEE = "Modelled risk from orbital data only; no route is guaranteed safe. Not a certified astronaut safety system."
MAX_TOOL_ROUNDS = 5
MAX_RESULT_CHARS = 12_000

Lat = Field(ge=-90, le=90, allow_inf_nan=False)
Lon = Field(ge=-180, le=360, allow_inf_nan=False)


# ---- tool arguments (flat, so Gemini gets a plain JSON schema) ----


class NoArgs(BaseModel):
    pass


class DatasetArgs(BaseModel):
    dataset_id: str | None = Field(default=None, max_length=128, description="Omit to list every dataset")


class ProfileArgs(BaseModel):
    start_lat: float = Lat
    start_lon: float = Lon
    end_lat: float = Lat
    end_lon: float = Lon


class Window(BaseModel):
    west: float = Field(default=77.3, ge=-180, le=360)
    south: float = Field(default=18.3, ge=-90, le=90)
    east: float = Field(default=77.6, ge=-180, le=360)
    north: float = Field(default=18.55, ge=-90, le=90)
    step: int = Field(default=3, ge=1, le=50)


class HazardArgs(Window):
    mode: Literal["features", "point", "coverage"] = Field(
        default="features",
        description="features: mapped hazards near lat/lon; point: risk score explanation at lat/lon; coverage: share of cells without terrain data in the window",
    )
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=360)
    radius_m: float = Field(default=1000, gt=0, le=20_000)


class RouteArgs(Window):
    start_lat: float = Lat
    start_lon: float = Lon
    dest_lat: float = Lat
    dest_lon: float = Lon
    modes: list[Literal["SHORTEST", "LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY"]] = Field(
        default=["SHORTEST", "LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY"], min_length=1
    )
    max_slope_deg: float | None = Field(default=None, gt=0, le=90)


class TargetArgs(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=360)
    radius_m: float | None = Field(default=None, gt=0, le=20_000)
    category: str | None = Field(default=None, max_length=64)
    evidence_level: Literal["direct_observation", "scientific_interpretation", "candidate_target", "hypothesis"] | None = None
    limit: int = Field(default=20, ge=1, le=50)


class EnvArgs(BaseModel):
    sol: int | None = Field(default=None, ge=0, le=10_000)


class ReportArgs(Window):
    start_lat: float = Lat
    start_lon: float = Lon
    dest_lat: float = Lat
    dest_lon: float = Lon
    sol: int | None = Field(default=None, ge=0, le=10_000)


# ---- tools: each calls an existing backend service and never writes ----


def _layers(db: Session, a: NoArgs) -> dict[str, Any]:
    page = svc.list_layers(db, 200, 0)
    keep = ("id", "dataset_id", "title_ru", "kind", "data_class", "resolution_m", "observed_at", "source_name", "processing_status", "limitations_ru")
    items = [{k: getattr(x, k) for k in keep} for x in page.items]
    return {"layers": items, "sources": sorted({x["dataset_id"] for x in items}), "uncertainty": []}


def _datasets(db: Session, a: DatasetArgs) -> dict[str, Any]:
    rows = svc.list_datasets(db, 200, 0, None, None).items
    if a.dataset_id is not None:
        rows = [r for r in rows if r.id == a.dataset_id]
        if not rows:
            raise AppError(404, "DATASET_NOT_FOUND", f"Набор данных {a.dataset_id} не зарегистрирован.")
    items = [r.model_dump(mode="json", exclude={"native_crs_wkt", "metadata"}) for r in rows]
    return {"datasets": items, "sources": [r.id for r in rows], "uncertainty": []}


def _profile(db: Session, a: ProfileArgs) -> dict[str, Any]:
    p = svc.terrain_profile(MarsCoord(lat=a.start_lat, lon=a.start_lon), MarsCoord(lat=a.end_lat, lon=a.end_lon))
    elevs = [x.elevation_m for x in p.points if x.elevation_m is not None]
    slopes = [x.slope_deg for x in p.points if x.slope_deg is not None]
    missing = len(p.points) - len(elevs)
    return {
        "data_class": p.data_class,
        "resolution_m": p.resolution_m,
        "straight_line_distance_m": round(p.total_distance_m, 1),
        "ascent_m": p.ascent_m,
        "descent_m": p.descent_m,
        "min_elevation_m": min(elevs, default=None),
        "max_elevation_m": max(elevs, default=None),
        "max_slope_deg": max(slopes, default=None),
        "samples": len(p.points),
        "samples_without_data": missing,
        "sources": p.provenance_ids,
        "uncertainty": [f"Profile sampled from a {p.resolution_m:g} m DTM: features smaller than that are not resolved."]
        + ([f"{missing} of {len(p.points)} samples have no elevation data."] if missing else []),
    }


def _hazards(db: Session, a: HazardArgs) -> dict[str, Any]:
    cfg = hazard_detection.RiskConfig().validated()
    if a.mode == "point" and (a.lat is None or a.lon is None):
        raise AppError(422, "COORDINATES_REQUIRED", "Для оценки риска в точке нужны lat и lon.")
    if a.mode == "point":
        r = svc.assess_hazard_point(a.lat, a.lon, cfg)
        return {**r.model_dump(), "uncertainty": [f"Confidence {r.confidence:.2f}.", r.disclaimer]}
    if a.mode == "coverage":
        g = svc.hazard_grid(a.west, a.south, a.east, a.north, a.step, cfg)
        total = g.rows * g.cols
        unknown = g.class_counts.get("UNKNOWN", 0)
        return {
            "data_class": g.data_class,
            "window": [g.west, g.south, g.east, g.north],
            "cell_m": g.cell_m,
            "class_counts": g.class_counts,
            "cells_without_terrain_data": unknown,
            "share_without_terrain_data": round(unknown / total, 4) if total else None,
            "sources": g.provenance_ids,
            "uncertainty": [g.disclaimer],
        }
    page = svc.list_hazards(db, 50, 0, include_demo=False, lat=a.lat, lon=a.lon, radius_m=a.radius_m if a.lat is not None else None)
    items = [
        {
            "title": h.title_ru,
            "hazard_class": h.hazard_class,
            "lat": h.lat,
            "lon": h.lon,
            "dataset_id": h.dataset_id,
            "hazard_type": h.factors.get("hazard_type"),
            "confidence": h.factors.get("confidence"),
            "observation_date": h.factors.get("observation_date"),
        }
        for h in page.items
    ]
    return {
        "hazards": items,
        "total": page.total,
        "sources": sorted({i["dataset_id"] for i in items if i["dataset_id"]}),
        "uncertainty": [] if items else [f"No mapped hazards within {a.radius_m:g} m; absence of mapped hazards is not proof of safety."],
    }


def _plan(db: Session, a: RouteArgs | ReportArgs, modes: list[str]) -> Any:
    return svc.plan_route(
        db,
        RoutePlanRequest(
            start=MarsCoord(lat=a.start_lat, lon=a.start_lon),
            destination=MarsCoord(lat=a.dest_lat, lon=a.dest_lon),
            modes=modes,
            max_slope_deg=getattr(a, "max_slope_deg", None),
            west=a.west, south=a.south, east=a.east, north=a.north, step=a.step,
        ),
    )


def _route_summary(plan: Any) -> dict[str, Any]:
    alts = []
    for x in plan.alternatives:
        prof = [p["elevation_m"] for p in x.elevation_profile]
        alts.append(
            {
                "mode": x.mode,
                "status": x.status,
                "reason": x.reason,
                "same_route_as": x.same_route_as,
                "total_distance_m": x.total_distance_m,
                "extra_distance_vs_shortest_m": x.extra_distance_vs_shortest_m,
                "ascent_m": x.ascent_m,
                "descent_m": x.descent_m,
                "min_elevation_m": min(prof, default=None),
                "max_elevation_m": max(prof, default=None),
                "max_slope_deg": x.max_slope_deg,
                "mean_slope_deg": x.mean_slope_deg,
                "hazard": x.hazard,
                "data_quality": x.data_quality,
                "science_targets": [t.name for t in x.science_targets],
                "explanation": x.explanation,
            }
        )
    found = [x for x in alts if x["status"] == "found"]
    lowest = min(found, key=lambda x: (x["hazard"]["mean_risk"], x["hazard"]["high_cells"]), default=None)
    return {
        "data_class": plan.data_class,
        "start": plan.start.model_dump(),
        "destination": plan.destination.model_dump(),
        "alternatives": alts,
        "lowest_modelled_risk_mode": lowest["mode"] if lowest else None,
        "cost_model": plan.cost_model,
        "warnings": plan.warnings,
        "sources": plan.provenance_ids,
        "uncertainty": [NO_GUARANTEE, *plan.limitations],
    }


def _route(db: Session, a: RouteArgs) -> dict[str, Any]:
    return _route_summary(_plan(db, a, a.modes))


def _compare(db: Session, a: RouteArgs) -> dict[str, Any]:
    out = _route_summary(_plan(db, a, a.modes))
    found = [x for x in out["alternatives"] if x["status"] == "found"]
    keys = ("total_distance_m", "ascent_m", "descent_m", "max_slope_deg", "min_elevation_m", "max_elevation_m")
    out["comparison"] = [
        {
            "a": x["mode"],
            "b": y["mode"],
            **{f"{k}_b_minus_a": round(y[k] - x[k], 2) for k in keys if x[k] is not None and y[k] is not None},
            "mean_risk_b_minus_a": round(y["hazard"]["mean_risk"] - x["hazard"]["mean_risk"], 3),
        }
        for i, x in enumerate(found)
        for y in found[i + 1 :]
    ]
    if len(found) < 2:
        out["uncertainty"].append("Fewer than two routes were found, nothing to compare.")
    return out


def _targets(db: Session, a: TargetArgs) -> dict[str, Any]:
    near = a.lat is not None and a.lon is not None
    page = svc.list_targets(
        db, a.limit, 0, a.category, include_demo=False, evidence_level=a.evidence_level,
        lat=a.lat if near else None, lon=a.lon if near else None, radius_m=(a.radius_m or 500) if near else None,
    )
    items = [
        {
            "id": t.id, "name": t.name, "category": t.category, "lat": t.lat, "lon": t.lon,
            "distance_m": round(ta._mars_dist_m(a.lat, a.lon, t.lat, t.lon), 1) if near else None,
            "evidence_level": t.evidence_level, "confidence": t.confidence, "instrument": t.instrument,
            "observed_at": t.observed_at, "source_citation": t.source_citation, "dataset_id": t.dataset_id,
        }
        for t in page.items
    ]
    if near:
        items.sort(key=lambda t: t["distance_m"])
    return {
        "targets": items,
        "total": page.total,
        "sources": sorted({t["dataset_id"] for t in items if t["dataset_id"]}),
        "uncertainty": ["evidence_level and confidence describe how strong the published evidence is; candidate_target and hypothesis are not confirmed findings."],
    }


def _environment(db: Session, a: EnvArgs) -> dict[str, Any]:
    e = svc.get_environment_summary(db, a.sol)
    return {
        **e.model_dump(mode="json"),
        "historical": True,
        "sources": e.provenance_ids,
        "uncertainty": [
            f"Perseverance MEDA measurements from sol {e.sol} ({e.observed_at_start} to {e.observed_at_end}); "
            "these are historical observations, not current conditions or a forecast."
        ],
    }


def _report(db: Session, a: ReportArgs) -> dict[str, Any]:
    sections: dict[str, Any] = {}
    missing: list[str] = []
    calls: list[tuple[str, Callable[[], dict[str, Any]]]] = [
        ("routes", lambda: _route_summary(_plan(db, a, ["SHORTEST", "LOWEST_TERRAIN_RISK"]))),
        ("destination_hazard", lambda: _hazards(db, HazardArgs(mode="point", lat=a.dest_lat, lon=a.dest_lon))),
        ("science_near_destination", lambda: _targets(db, TargetArgs(lat=a.dest_lat, lon=a.dest_lon, radius_m=500))),
        ("environment", lambda: _environment(db, EnvArgs(sol=a.sol))),
    ]
    for name, call in calls:
        try:
            sections[name] = call()
        except AppError as exc:
            missing.append(f"{name}: {exc.code} {exc.message_ru}")
    return {
        "report": sections,
        "missing": missing,
        "read_only": True,
        "sources": sorted({s for sec in sections.values() for s in sec.get("sources", [])}),
        "uncertainty": [NO_GUARANTEE, *{u for sec in sections.values() for u in sec.get("uncertainty", [])}],
    }


class Tool(NamedTuple):
    description: str
    args: type[BaseModel]
    run: Callable[[Session, Any], dict[str, Any]]


TOOLS: dict[str, Tool] = {
    "get_available_layers": Tool("List map layers with data class, resolution, observation date and limitations.", NoArgs, _layers),
    "get_dataset_metadata": Tool("Provenance of registered NASA/USGS datasets: product id, instrument, resolution, dates, source URL.", DatasetArgs, _datasets),
    "get_terrain_profile": Tool("Straight-line elevation and slope profile between two points from the CTX DTM (MOLA outside CTX).", ProfileArgs, _profile),
    "get_hazards": Tool("Mapped hazards near a point, the explained risk score at a point, or terrain-data coverage of a window.", HazardArgs, _hazards),
    "calculate_route": Tool("Plan SHORTEST / LOWEST_TERRAIN_RISK / SCIENCE_PRIORITY routes on the CTX terrain grid.", RouteArgs, _route),
    "search_scientific_targets": Tool("Science targets from the catalogue, optionally within radius_m of a point, with evidence levels.", TargetArgs, _targets),
    "get_environmental_observations": Tool("Historical Perseverance MEDA sol summary (temperature, pressure, wind, humidity).", EnvArgs, _environment),
    "compare_routes": Tool("Plan route variants and compare distance, elevation profile, slope and modelled risk pairwise.", RouteArgs, _compare),
    "generate_mission_report": Tool("Read-only mission brief: routes, destination hazard, nearby science, environment, and what is missing.", ReportArgs, _report),
}


def declarations() -> list[dict[str, Any]]:
    return [{"name": n, "description": t.description, "parametersJsonSchema": t.args.model_json_schema()} for n, t in TOOLS.items()]


def execute(db: Session, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Validate structured arguments and run one tool; failures come back as data, never as invented values."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"ok": False, "error": "UNKNOWN_TOOL", "missing": f"No tool named {name}."}
    try:
        args = tool.args.model_validate(arguments or {})
    except ValidationError as exc:
        return {"ok": False, "error": "INVALID_ARGUMENTS", "missing": exc.errors(include_url=False, include_context=False)}
    try:
        return {"ok": True, **tool.run(db, args)}
    except AppError as exc:
        return {"ok": False, "error": exc.code, "missing": exc.message_ru, "details": exc.details}


# ---- intent detection: drives the no-LLM fallback and hints the model ----

INTENTS: list[tuple[str, str]] = [
    ("compare_routes", r"compar|сравн|two routes|двух маршрут|vs\b"),
    ("generate_mission_report", r"report|отч[её]т|brief|сводк"),
    ("calculate_route", r"route|path|маршрут|путь|safest|безопасн"),
    ("get_terrain_profile", r"profile|профил|elevation|высот"),
    ("search_scientific_targets", r"scien|target|науч|цел[ьи]|sample|образ"),
    ("get_hazards", r"hazard|risk|danger|опасн|риск|coverage|покрыт|insufficient"),
    ("get_environmental_observations", r"weather|temperat|pressure|wind|погод|температур|давлен|ветер|meda"),
    ("get_available_layers", r"layer|слой|слои"),
    ("get_dataset_metadata", r"dataset|набор|данн|source|источник"),
]


def classify_intent(text: str) -> list[str]:
    low = text.lower()
    return [name for name, pattern in INTENTS if re.search(pattern, low)]


def default_arguments(name: str, text: str, ctx: dict[str, Any]) -> dict[str, Any]:
    start, target = ctx.get("start"), ctx.get("target")
    pair = {"start_lat": start["lat"], "start_lon": start["lon"], "dest_lat": target["lat"], "dest_lon": target["lon"]} if start and target else {}
    point = target or start
    pair = {**pair, **(ctx.get("region") or {})} if pair else pair  # plan in the region open on the map, not the Jezero default
    if name == "calculate_route" and pair and re.search(r"safe|low|безопасн|риск", text.lower()):
        return {**pair, "modes": ["SHORTEST", "LOWEST_TERRAIN_RISK"]}
    if name in ("calculate_route", "compare_routes"):
        return pair
    if name == "generate_mission_report":
        return {**pair, "sol": ctx.get("sol")}
    if name == "get_terrain_profile":
        return {"start_lat": start["lat"], "start_lon": start["lon"], "end_lat": target["lat"], "end_lon": target["lon"]} if pair else {}
    if name == "search_scientific_targets":
        m = re.search(r"(\d+(?:\.\d+)?)\s*(m|м|km|км)\b", text.lower())
        radius = (float(m.group(1)) * (1000 if m.group(2) in ("km", "км") else 1)) if m else 500
        return {"lat": point["lat"], "lon": point["lon"], "radius_m": radius} if point else {}
    if name == "get_hazards":
        if re.search(r"coverage|покрыт|insufficient", text.lower()):
            return {"mode": "coverage", **(ctx.get("region") or {})}
        return {"mode": "point" if re.search(r"why|почему|explain|объясн", text.lower()) else "features", **({"lat": point["lat"], "lon": point["lon"]} if point else {})}
    if name == "get_environmental_observations":
        return {"sol": ctx.get("sol")}
    return {}


# ---- the conversation loop ----

SYSTEM = """You are Zyro, the MARSWALK mission assistant (NASA Space Apps 2026, team Grass on Mars).
Answer only about Mars, Mars missions, EVA planning and this app; politely refuse other topics in one sentence.
Use the tools to get data. Rules:
- Never invent scientific measurements: every number you state must come from a tool result in this conversation or from CONTEXT.page (values the app already shows, e.g. the site ranking).
- Never invent dataset references: cite only ids from the tools' "sources" fields.
- Never claim a route is guaranteed safe; say "lowest modelled risk" and mention the main uncertainty.
- MEDA environment data is historical (state the sol and dates); never present it as current conditions or a forecast.
- If a tool returns ok=false or something is missing, say exactly what is missing instead of guessing.
- Distinguish REAL source measurements from DERIVED values computed by MARSWALK (data_class).
- Explain the data behind a recommendation (slope, hazard risk, distance, data uncertainty).
- When CONTEXT.region is present, pass its west, south, east, north and step to the route, report and coverage tools: that is the region open on the map. Outside Jezero the terrain is the 463 m MOLA grid (regional planning only), and MEDA weather was measured at Jezero, not there.
- Coordinates: planetocentric latitude, east longitude in degrees. Use CONTEXT coordinates when the user says "selected target" or "start".
Be concise: at most 6 short sentences, plain text, no markdown. Reply in the language of the user's last message."""


def _sources_and_uncertainty(results: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    sources = sorted({s for r in results for s in r.get("sources", []) if isinstance(s, str)})
    uncertainty = list(dict.fromkeys(u for r in results for u in r.get("uncertainty", []) if isinstance(u, str)))
    for r in results:
        if not r.get("ok"):
            uncertainty.append(f"Missing data: {r.get('error')}: {r.get('missing')}")
    return sources, uncertainty


def _fallback_text(calls: list[dict[str, Any]], results: list[dict[str, Any]]) -> str:
    if not calls:
        return "The language model is unavailable and I could not match the question to a MARSWALK tool."
    lines = ["The language model is unavailable, so here are the raw MARSWALK tool results."]
    for c, r in zip(calls, results, strict=True):
        if not r["ok"]:
            lines.append(f"{c['name']}: no data ({r['error']}: {r['missing']}).")
        elif "alternatives" in r:
            mode = r["lowest_modelled_risk_mode"]
            alt = next((x for x in r["alternatives"] if x["mode"] == mode), None)
            lines.append(
                f"{c['name']}: lowest modelled risk {mode}, {alt['total_distance_m']:.0f} m, max slope {alt['max_slope_deg']:.1f} deg, "
                f"mean risk {alt['hazard']['mean_risk']:.2f}." if alt else f"{c['name']}: no route found."
            )
        else:
            facts = {k: v for k, v in r.items() if k != "ok" and v is not None and not isinstance(v, (list, dict))}
            items = next((v for v in r.values() if isinstance(v, list) and v and isinstance(v[0], dict)), None)
            if items:
                facts["items"] = [x.get("name") or x.get("title") or x.get("id") for x in items[:5]]
            lines.append(f"{c['name']}: " + json.dumps(facts, ensure_ascii=False, default=str)[:700])
    return "\n".join(lines)


def _trim(result: dict[str, Any]) -> dict[str, Any]:
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) <= MAX_RESULT_CHARS:
        return json.loads(text)
    # shortcut: oversized results are cut as text for the model only, upgrade to per-tool pagination if answers lose detail
    return {"truncated_json": text[:MAX_RESULT_CHARS], "sources": result.get("sources", []), "ok": result.get("ok")}


def chat(db: Session, messages: list[dict[str, str]], ctx: dict[str, Any]) -> dict[str, Any]:
    question = messages[-1]["text"]
    intent = classify_intent(question)
    calls: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    contents = [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["text"]}]} for m in messages[:-1]]
    contents.append(
        {"role": "user", "parts": [{"text": f"CONTEXT (map selection, JSON): {json.dumps(ctx)}\nDetected intent: {intent or 'none'}\n\n{question}"}]}
    )
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            content = gemini.candidate_content(gemini.generate(contents, SYSTEM, declarations(), max_tokens=1024))
            fcalls = [p["functionCall"] for p in content.get("parts", []) if isinstance(p, dict) and "functionCall" in p]
            if not fcalls:
                text = gemini._reply_text({"candidates": [{"content": content}]})
                if not text:
                    raise AppError(502, "GEMINI_EMPTY", "Gemini вернул пустой ответ.")
                break
            contents.append(content)
            responses = []
            for fc in fcalls:
                result = execute(db, fc.get("name", ""), fc.get("args"))
                calls.append({"name": fc.get("name", ""), "arguments": fc.get("args") or {}})
                results.append(result)
                responses.append({"functionResponse": {"name": fc.get("name", ""), "response": _trim(result)}})
            contents.append({"role": "user", "parts": responses})
        else:
            text = "I stopped after too many tool calls; please narrow the question."
        mode = "gemini"
    except AppError as exc:
        if not exc.code.startswith("GEMINI_"):
            raise
        calls = [{"name": n, "arguments": default_arguments(n, question, ctx)} for n in intent[:2]]
        results = [execute(db, c["name"], c["arguments"]) for c in calls]
        text, mode = _fallback_text(calls, results), "deterministic"
    sources, uncertainty = _sources_and_uncertainty(results)
    return {
        "text": text,
        "mode": mode,
        "intent": intent,
        "tool_calls": [{**c, "ok": r["ok"], "error": r.get("error")} for c, r in zip(calls, results, strict=True)],
        "sources": sources,
        "uncertainty": uncertainty,
    }
