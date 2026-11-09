"""API happy-path tests on synthetic fixture data. No network."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import RegimeConfig, Settings, get_settings
from app.main import create_app
from app.regime import service
from tests.conftest import make_panel


@pytest.fixture(scope="module")
def settings(tmp_path_factory) -> Settings:
    data_dir = tmp_path_factory.mktemp("data")
    s = Settings(
        data_dir=data_dir,
        regime=RegimeConfig(n_restarts=2, n_iter=100, first_train_end="2009-12-31"),
    )
    s.processed_dir.mkdir(parents=True)
    panel = make_panel(n=1400, seed=4)
    panel.attrs = {}
    panel.to_parquet(s.panel_path, index=False)
    return s


@pytest.fixture(scope="module")
def client(settings, monkeypatch_module) -> TestClient:
    monkeypatch_module.setattr(service, "load_panel", _panel_loader(settings))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def _panel_loader(settings: Settings):
    import pandas as pd

    def load() -> pd.DataFrame:
        df = pd.read_parquet(settings.panel_path)
        df["date"] = pd.to_datetime(df["date"])
        return df

    return load


@pytest.fixture(scope="module")
def trained(client) -> dict:
    r = client.post("/api/regime/train")
    assert r.status_code == 200, r.text
    return r.json()


def test_untrained_returns_404(settings, monkeypatch_module, tmp_path) -> None:
    empty = Settings(data_dir=tmp_path)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: empty
    c = TestClient(app)
    for path in ("latest", "history", "diagnostics", "folds", "hindsight", "vix-params"):
        assert c.get(f"/api/regime/{path}").status_code == 404
    assert c.get("/api/regime/status").json() == {
        "trained": False,
        "training": False,
        "trained_at": None,
        "data_end": None,
        "runtime_s": None,
    }


def test_train_summary(trained) -> None:
    assert trained["n_folds"] == 3
    assert [f["fold_id"] for f in trained["folds"]] == ["2009-12-31", "2010-12-31", "2011-12-31"]
    assert trained["live"]["log_likelihood"] < 0
    assert trained["features"] == RegimeConfig().features


def test_status_after_training(client, trained) -> None:
    s = client.get("/api/regime/status").json()
    assert s["trained"] and not s["training"]
    assert s["trained_at"] == trained["trained_at"]


def test_latest(client, trained) -> None:
    r = client.get("/api/regime/latest")
    assert r.status_code == 200
    d = r.json()
    assert d["smoothed_label"] in ("Calm", "Stressed", "Panic")
    assert d["date"] == trained["data_end"]
    assert sum(d["probabilities"].values()) == pytest.approx(1.0)
    assert [f["horizon"] for f in d["forecast"]] == [1, 5, 20]
    for f in d["forecast"]:
        assert sum(f["probabilities"].values()) == pytest.approx(1.0)
    assert len(d["features"]) == 6
    assert all(len(f["history"]) == 60 for f in d["features"])
    assert d["expected_remaining_duration"] >= 1
    assert d["days_in_regime"] >= 1
    assert d["changed_today"] == (d["previous_label"] != d["smoothed_label"])
    assert "p25" in d["risk"] and "p99" in d["risk"]


def test_history_filters(client, trained) -> None:
    full = client.get("/api/regime/history").json()
    assert len(full["rows"]) > 500
    r = client.get("/api/regime/history", params={"start": "2010-03-01", "end": "2010-06-30"})
    rows = r.json()["rows"]
    assert rows[0]["date"] >= "2010-03-01" and rows[-1]["date"] <= "2010-06-30"
    assert {"probabilities", "smoothed_label", "baseline_label", "vix", "uvxy_close"} <= set(
        rows[0]
    )
    assert set(rows[0]["probabilities"]) == {"Calm", "Stressed", "Panic"}
    assert client.get("/api/regime/history", params={"start": "2010-13"}).status_code == 422
    for bad_date in ("2024-02-30", "2024-13-01"):
        r = client.get("/api/regime/history", params={"start": bad_date})
        assert r.status_code == 422
        assert client.get("/api/regime/hindsight", params={"start": bad_date}).status_code == 422
    bad = client.get("/api/regime/history", params={"start": "2011-01-01", "end": "2010-01-01"})
    assert bad.status_code == 422


def test_diagnostics(client, trained) -> None:
    d = client.get("/api/regime/diagnostics").json()
    assert d["names"] == ["Calm", "Stressed", "Panic"]
    assert len(d["transition_matrix"]) == 3
    for row in d["transition_matrix"]:
        assert sum(row) == pytest.approx(1.0)
    assert d["state_means"]["Calm"]["contango"] > d["state_means"]["Panic"]["contango"]
    assert len(d["restarts"]) == 2
    assert len(d["validation"]["known_episodes"]) == 7
    assert {"hmm", "baseline"} == set(d["risk_stats"])
    assert d["vix_params"]["by_regime"]


def test_folds_and_hindsight_and_vix_params(client, trained) -> None:
    folds = client.get("/api/regime/folds").json()
    assert len(folds) == 3
    assert all(f["train_end"] < f["test_start"] for f in folds)
    h = client.get("/api/regime/hindsight", params={"start": "2011-01-01"}).json()
    assert "Not usable for trading" in h["note"]
    assert h["rows"][0]["date"] >= "2011-01-01"
    v = client.get("/api/regime/vix-params").json()
    assert v["current_regime"] in ("Calm", "Stressed", "Panic")
    assert v["as_of"] == trained["data_end"]
    sim = v["simulator"]
    if sim is not None:
        assert sim["model"] == "one_factor"
        assert set(sim["overrides"]) == {"kappa", "theta", "sigma", "lam", "mu_j", "sigma_j"}
        assert sim["overrides"]["kappa"] == v["by_regime"][v["current_regime"]]["kappa"]


def test_simulator_overrides_need_complete_fit() -> None:
    from app.api.routes.regime import simulator_overrides

    full = {"kappa": 5, "theta": 18, "sigma": 1, "lam": 4, "mu_j": 0.2, "sigma_j": 0.05}
    assert simulator_overrides(full)["overrides"]["theta"] == 18.0
    assert simulator_overrides(full | {"kappa": None}) is None


def test_train_conflict_returns_409(client, settings, trained) -> None:
    import fcntl

    lock = settings.processed_dir / ".regime_train.lock"
    with open(lock, "w") as fh:  # simulate another process (e.g. the CLI) training
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            r = client.post("/api/regime/train")
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    assert r.status_code == 409


def test_train_without_panel_returns_503(tmp_path) -> None:
    from app.regime import service as svc

    empty = Settings(data_dir=tmp_path)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: empty
    mp = pytest.MonkeyPatch()
    mp.setattr(svc, "load_panel", _missing_panel)
    try:
        r = TestClient(app).post("/api/regime/train")
    finally:
        mp.undo()
    assert r.status_code == 503
    assert not list(empty.processed_dir.glob("regime.staging-*"))  # staging cleaned up


def _missing_panel():
    raise FileNotFoundError("panel.parquet not found")


def test_latest_risk_matches_risk_stats(client, settings, trained) -> None:
    import json

    d = client.get("/api/regime/latest").json()
    risk = json.loads((settings.regime_dir / "risk_stats.json").read_text())
    assert d["risk"]["count"] == risk["hmm"][d["smoothed_label"]]["count"]


def test_history_with_two_states(tmp_path, monkeypatch_module) -> None:
    s = Settings(
        data_dir=tmp_path,
        regime=RegimeConfig(n_states=2, n_restarts=1, n_iter=50, first_train_end="2009-12-31"),
    )
    s.processed_dir.mkdir(parents=True)
    panel = make_panel(n=1400, seed=4)
    panel.attrs = {}
    panel.to_parquet(s.panel_path, index=False)
    monkeypatch_module.setattr(service, "load_panel", _panel_loader(s))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: s
    c = TestClient(app)
    assert c.post("/api/regime/train").status_code == 200
    h = c.get("/api/regime/history").json()
    assert h["names"] == ["Calm", "Panic"]
    assert set(h["rows"][0]["probabilities"]) == {"Calm", "Panic"}
    assert c.get("/api/regime/latest").status_code == 200


def test_insights_endpoint(client, trained) -> None:
    r = client.get("/api/regime/insights")
    assert r.status_code == 200
    d = r.json()
    assert d["names"] == ["Calm", "Stressed", "Panic"]
    assert set(d["profiles"]) == {"Calm", "Stressed", "Panic"}
    assert d["current"]["ongoing"] is True
    assert sum(e["days"] for e in d["episodes"]) == len(
        client.get("/api/regime/history").json()["rows"]
    )
    assert all(abs(sum(y["shares"].values()) - 1) < 1e-9 for y in d["yearly"])


def test_history_rows_have_outcome_fields(client, trained) -> None:
    rows = client.get("/api/regime/history").json()["rows"]
    assert rows[0]["days_in_regime"] >= 1
    assert rows[-1]["uvxy_next_ret"] is None  # no next day yet
    assert any(r["uvxy_next_ret"] is not None for r in rows)
