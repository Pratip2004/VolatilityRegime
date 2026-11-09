from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


def make_panel(n: int = 1400, seed: int = 0, start: str = "2007-01-03") -> pd.DataFrame:
    """Synthetic daily panel with three alternating volatility regimes.

    Regime blocks (calm → stressed → panic) make features separable so models fit quickly.
    No network, deterministic for a given seed.
    """
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n)
    # Persistent regime path: 0 calm, 1 stressed, 2 panic.
    states = np.zeros(n, dtype=int)
    trans = np.array([[0.98, 0.018, 0.002], [0.04, 0.94, 0.02], [0.02, 0.10, 0.88]])
    for t in range(1, n):
        states[t] = rng.choice(3, p=trans[states[t - 1]])
    vix_level = np.array([13.0, 22.0, 40.0])[states]
    vix = vix_level * np.exp(rng.normal(0, 0.05, n))
    vix3m = vix / np.array([0.85, 0.97, 1.15])[states] * np.exp(rng.normal(0, 0.02, n))
    vvix = np.array([85.0, 105.0, 140.0])[states] * np.exp(rng.normal(0, 0.05, n))
    vx1 = vix * np.array([1.05, 1.0, 0.92])[states]
    vx2 = vx1 * (1 + np.array([0.08, 0.02, -0.08])[states] + rng.normal(0, 0.01, n))
    spx_ret = rng.normal(0, np.array([0.006, 0.012, 0.03])[states])
    spx = 1500 * np.exp(np.cumsum(spx_ret))
    uvxy_mu = np.array([-0.006, 0.0, 0.02])[states]
    uvxy_ret = rng.normal(uvxy_mu, np.array([0.03, 0.06, 0.15])[states])
    uvxy = 1000 * np.exp(np.cumsum(uvxy_ret))
    panel = pd.DataFrame(
        {
            "date": dates,
            "vix": vix,
            "vix3m": vix3m,
            "vvix": vvix,
            "vx1": vx1,
            "vx2": vx2,
            "spx_close": spx,
            "uvxy_close": uvxy,
        }
    )
    panel.attrs["true_states"] = states
    return panel


@pytest.fixture
def panel() -> pd.DataFrame:
    return make_panel()
