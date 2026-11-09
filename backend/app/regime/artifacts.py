"""Strict-JSON artifact writing shared by the regime modules."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, pd.Timestamp):
        return o.date().isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not JSON serialisable: {type(o)}")


def _clean(o):
    """Replace non-finite floats with None so the JSON is strict."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list | tuple):
        return [_clean(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(_clean(obj), indent=2, default=_json_default))
