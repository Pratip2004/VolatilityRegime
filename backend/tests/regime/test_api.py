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
    assert {"p_calm", "smoothed_label", "baseline_label", "vix", "uvxy_close"} <= set(rows[0])
    assert client.get("/api/regime/history", params={"start": "2010-13"}).status_code == 422
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
