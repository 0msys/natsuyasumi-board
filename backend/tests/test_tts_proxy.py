"""VOICEVOX 読み上げプロキシ（app/routers/tts.py）の縮退動作テスト.

VOICEVOX 不在（到達不能な VOICEVOX_URL）で /api/tts/status が available:false・
/api/tts が 503 になること、死活 probe の 30秒キャッシュ（_status_cache）の TTL を固定する。
後半は「子どもごとの話者」（定義の voice.speaker）の解決規則
——その子の設定 → 居ない話者IDなら既定へフォールバック → 試聴の speaker 指定は最優先——を固定する。
"""

from __future__ import annotations

import copy
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routers import tts as tts_module

UNREACHABLE = "http://127.0.0.1:1"  # 到達不能ポート（接続拒否が即時に返る）
FAKE_URL = "http://voicevox.test"  # フェイク VOICEVOX（httpx を差し替えるので実接続はしない）

# フェイク VOICEVOX の話者一覧（歌唱スタイル sing を1つ混ぜてある＝読み上げ用に落とされる）
SPEAKERS_JSON = [
    {
        "name": "ずんだもん",
        "styles": [{"name": "ノーマル", "id": 3, "type": "talk"}, {"name": "うた", "id": 300, "type": "sing"}],
    },
    {"name": "春日部つむぎ", "styles": [{"name": "ノーマル", "id": 8, "type": "talk"}]},
]


@pytest.fixture
def client(tmp_db, monkeypatch):
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", tmp_db)
    monkeypatch.setattr(tts_module, "VOICEVOX_URL", UNREACHABLE)
    monkeypatch.setattr(tts_module, "_status_cache", {"at": float("-inf"), "available": False})
    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    with TestClient(create_app()) as c:
        yield c


def test_status_不在はavailable_false(client):
    r = client.get("/api/tts/status")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert isinstance(body["speaker"], int)


def test_tts_不在は503(client):
    r = client.post("/api/tts", json={"text": "こんにちは"})
    assert r.status_code == 503
    # 合成失敗はキャッシュも available=False へ倒す（直後の status は probe せず false）
    assert client.get("/api/tts/status").json()["available"] is False


def test_tts_空テキストは400(client):
    assert client.post("/api/tts", json={"text": ""}).status_code == 400
    assert client.post("/api/tts", json={"text": "   "}).status_code == 400


def test_tts_長すぎるテキストは400(client):
    # 10,000 バイト超（日本語1文字=3バイト × 3,400 = 10,200 バイト）
    assert client.post("/api/tts", json={"text": "あ" * 3400}).status_code == 400


def test_status_キャッシュTTL(client, monkeypatch):
    # 数えるのは死活 probe（/version）だけ。話者一覧（/speakers）は別キャッシュなので
    # フェイクにまとめて答えさせる（話者の実在検査は子ども・既定どちらの経路でも走る）。
    calls: list[str] = []

    def fake_get(url, timeout):
        if url.endswith("/version"):
            calls.append(url)
        return _fake_get(url, timeout)

    monkeypatch.setattr("app.routers.tts.httpx.get", fake_get)

    # 1回目: キャッシュ未取得（at=-inf）→ probe が走り available=True
    assert client.get("/api/tts/status").json()["available"] is True
    assert len(calls) == 1
    # 2回目: TTL 内 → probe しない（キャッシュ命中）
    assert client.get("/api/tts/status").json()["available"] is True
    assert len(calls) == 1
    # 期限切れを模擬（30秒より過去へ）→ 再 probe
    tts_module._status_cache["at"] = time.monotonic() - (tts_module._STATUS_CACHE_TTL_S + 1)
    assert client.get("/api/tts/status").json()["available"] is True
    assert len(calls) == 2


def test_status_probe失敗もキャッシュされる(client, monkeypatch):
    calls: list[str] = []
    real_get = tts_module.httpx.get

    def counting_get(url, timeout):
        calls.append(url)
        return real_get(url, timeout=timeout)  # 到達不能 → httpx.HTTPError

    monkeypatch.setattr("app.routers.tts.httpx.get", counting_get)

    assert client.get("/api/tts/status").json()["available"] is False
    assert len(calls) == 1
    # 失敗も TTL 内はキャッシュ（不在 VOICEVOX へ毎回タイムアウト待ちしない）
    assert client.get("/api/tts/status").json()["available"] is False
    assert len(calls) == 1


# ---- 子どもごとの話者（定義の voice.speaker） ----


class _FakeResponse:
    """httpx.Response の代わり（status / JSON / 本文だけ持つ最小のフェイク）."""

    def __init__(self, status_code: int = 200, payload: object = None, content: bytes = b""):
        self.status_code = status_code
        self._payload = payload
        self.content = content

    def json(self) -> object:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", FAKE_URL)
            raise httpx.HTTPStatusError(
                "ng", request=request, response=httpx.Response(self.status_code, request=request)
            )


def _fake_get(url: str, timeout: float) -> _FakeResponse:
    """/version（死活）と /speakers（一覧）に答えるフェイク VOICEVOX."""
    if url.endswith("/version"):
        return _FakeResponse(200, payload="0.16.0")
    if url.endswith("/speakers"):
        return _FakeResponse(200, payload=SPEAKERS_JSON)
    raise AssertionError(f"想定外の GET: {url}")


class _FakeClient:
    """audio_query → synthesis の2段呼び出しを受けるフェイク（params を calls に積む）."""

    def __init__(self, calls: list, query_status: int = 200):
        self.calls = calls
        self.query_status = query_status

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False

    def post(self, url: str, params: dict | None = None, json: dict | None = None) -> _FakeResponse:
        self.calls.append((url.rsplit("/", 1)[-1], params))
        if url.endswith("/audio_query"):
            return _FakeResponse(self.query_status, payload={"accent_phrases": []})
        return _FakeResponse(200, content=b"RIFF....WAVE")


@pytest.fixture
def voice_db(tmp_db, sample_doc):
    """「はな」＝春日部つむぎ(8)・「そら」＝VOICEVOX に居ない話者(999) の2人を入れた DB."""
    from app.admin import definition_store

    hana = copy.deepcopy(sample_doc)
    hana["voice"] = {"speaker": 8, "label": "春日部つむぎ（ノーマル）"}
    sora = copy.deepcopy(sample_doc)
    sora["child"] = "そら"
    sora["child_kana"] = "そら"
    sora["voice"] = {"speaker": 999, "label": "よその家の声"}
    for doc in (hana, sora):  # create_definition は doc をミューテートするので個別のコピーを渡す
        definition_store.create_definition(doc, db_path=tmp_db)
    return tmp_db


@pytest.fixture
def voice_client(voice_db, monkeypatch):
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", voice_db)
    monkeypatch.setattr(tts_module, "VOICEVOX_URL", FAKE_URL)
    monkeypatch.setattr(tts_module, "_status_cache", {"at": float("-inf"), "available": False})
    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    monkeypatch.setattr("app.routers.tts.httpx.get", _fake_get)
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def synth_calls(monkeypatch):
    """合成の呼び出し記録（[(エンドポイント名, params), ...]）を返すフィクスチャ."""
    calls: list = []
    monkeypatch.setattr(
        "app.routers.tts.httpx.Client", lambda timeout: _FakeClient(calls)
    )
    return calls


def test_合成はその子の話者で行う(voice_client, synth_calls):
    r = voice_client.post("/api/tts", json={"text": "こんにちは", "child": "はな"})
    assert r.status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [8, 8]


def test_childなしは既定の話者(voice_client, synth_calls):
    assert voice_client.post("/api/tts", json={"text": "こんにちは"}).status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [3, 3]


def test_VOICEVOXに居ない話者は既定へフォールバック(voice_client, synth_calls):
    # 別の家からインポートした定義（話者999）でも、読み上げ自体は既定の声で必ず動く
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "そら"}).status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [3, 3]


def test_speaker指定は試聴用にそのまま使う(voice_client, synth_calls):
    # 管理画面の試聴。保存前の声を試すので child の設定より優先し、実在検査もしない
    r = voice_client.post("/api/tts", json={"text": "やあ", "child": "はな", "speaker": 999})
    assert r.status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [999, 999]


def test_負のspeakerは400(voice_client, synth_calls):
    assert voice_client.post("/api/tts", json={"text": "やあ", "speaker": -1}).status_code == 400
    assert synth_calls == []


def test_status_childでその子の話者を返す(voice_client):
    assert voice_client.get("/api/tts/status").json() == {"available": True, "speaker": 3}
    assert voice_client.get("/api/tts/status", params={"child": "はな"}).json() == {
        "available": True,
        "speaker": 8,
    }
    # 定義が無い子どもでも既定の声を返す（読み上げは止めない）
    assert voice_client.get("/api/tts/status", params={"child": "だれ"}).json()["speaker"] == 3


def test_speakers一覧は歌唱スタイルを落とす(voice_client):
    body = voice_client.get("/api/tts/speakers").json()
    assert body["available"] is True
    assert body["default_speaker"] == 3
    assert body["speakers"] == [
        {"name": "ずんだもん", "styles": [{"id": 3, "name": "ノーマル"}]},
        {"name": "春日部つむぎ", "styles": [{"id": 8, "name": "ノーマル"}]},
    ]


def test_speakers_VOICEVOX不在はavailable_false(client):
    body = client.get("/api/tts/speakers").json()
    assert body == {"available": False, "speakers": [], "default_speaker": tts_module.VOICEVOX_SPEAKER}


def test_合成の4xxは400_死活キャッシュは倒さない(voice_client, monkeypatch):
    # 居ない話者IDの試聴など「頼みかたが悪い」ケース。VOICEVOX は生きているので、
    # ここで available を false にすると画面から音声ボタンごと消えてしまう。
    calls: list = []
    monkeypatch.setattr(
        "app.routers.tts.httpx.Client", lambda timeout: _FakeClient(calls, query_status=422)
    )
    r = voice_client.post("/api/tts", json={"text": "やあ", "speaker": 12345})
    assert r.status_code == 400
    assert voice_client.get("/api/tts/status").json()["available"] is True


# ---- 話者一覧が「取れない」「古い」ときのフォールバック ----


def _get_that_fails_speakers(calls: list):
    """/version は 200・/speakers だけ落ちるフェイク（一覧だけ引けない状況）."""

    def fake_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        if url.endswith("/version"):
            return _FakeResponse(200, payload="0.16.0")
        raise httpx.ConnectTimeout("speakers timeout")

    return fake_get


def test_一覧が取れないときは設定どおりの話者で読む(voice_client, synth_calls, monkeypatch):
    # 「居ないと分かった」ではなく「居るか不明」。ここで既定へ落とすと、VOICEVOX が
    # 一瞬詰まった隙にその子の声が別人になってしまう。
    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    monkeypatch.setattr("app.routers.tts.httpx.get", _get_that_fails_speakers([]))
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "そら"}).status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [999, 999]


def test_一覧取得の失敗は短いTTLでキャッシュする(voice_client, synth_calls, monkeypatch):
    # 合成のたびに /speakers のタイムアウトを待たされないこと（＝失敗も覚える）
    calls: list[str] = []
    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    monkeypatch.setattr("app.routers.tts.httpx.get", _get_that_fails_speakers(calls))
    for _ in range(3):
        voice_client.post("/api/tts", json={"text": "やあ", "child": "そら"})
    assert len([u for u in calls if u.endswith("/speakers")]) == 1


def test_一覧だけ取れないときはavailable_true_speakers空(voice_client, monkeypatch):
    # VOICEVOX は動いているので available は true のまま（画面が「VOICEVOX が居ない」と
    # 誤った案内を出さないため）。一覧は空で、えらべないことだけを伝える。
    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    monkeypatch.setattr("app.routers.tts.httpx.get", _get_that_fails_speakers([]))
    assert voice_client.get("/api/tts/speakers").json() == {
        "available": True,
        "speakers": [],
        "default_speaker": 3,
    }


def test_既定の話者すら居ないときは実在する話者へ落とす(voice_client, synth_calls, monkeypatch):
    # VOICEVOX_SPEAKER の指定ミス・モデル構成ちがい。落とし先が鳴らないのでは意味がない
    monkeypatch.setattr(tts_module, "VOICEVOX_SPEAKER", 777)
    r = voice_client.post("/api/tts", json={"text": "やあ", "child": "そら"})  # 話者999
    assert r.status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [3, 3]  # 一覧の先頭


def test_合成が4xxなら古い一覧を捨てて引き直す(voice_client, monkeypatch):
    # 実在検査を通した話者で断られた＝一覧が古い。捨てないと、本当は居る話者を
    # 「居ない」と誤判定したまま最大5分、その子の設定を無視し続ける。
    calls: list[str] = []
    real_get = _fake_get

    def counting_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        return real_get(url, timeout)

    monkeypatch.setattr("app.routers.tts.httpx.get", counting_get)
    ok_calls: list = []
    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient(ok_calls))
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"}).status_code == 200
    assert len([u for u in calls if u.endswith("/speakers")]) == 1

    ng_calls: list = []
    monkeypatch.setattr(
        "app.routers.tts.httpx.Client", lambda timeout: _FakeClient(ng_calls, query_status=422)
    )
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"}).status_code == 400

    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient(ok_calls))
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"}).status_code == 200
    assert len([u for u in calls if u.endswith("/speakers")]) == 2  # TTL 内でも引き直した


def test_試聴の4xxでは一覧を捨てない(voice_client, monkeypatch):
    # 試聴（speaker 直接指定）は実在検査を通していない＝一覧の鮮度とは無関係
    calls: list[str] = []

    def counting_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        return _fake_get(url, timeout)

    monkeypatch.setattr("app.routers.tts.httpx.get", counting_get)
    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient([]))
    voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"})  # 一覧を1回引く
    monkeypatch.setattr(
        "app.routers.tts.httpx.Client", lambda timeout: _FakeClient([], query_status=422)
    )
    assert voice_client.post("/api/tts", json={"text": "やあ", "speaker": 12345}).status_code == 400
    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient([]))
    voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"})
    assert len([u for u in calls if u.endswith("/speakers")]) == 1  # 捨てていない


def test_既定の話者が居ないときは声未設定の子も実在する話者で読む(voice_client, synth_calls, monkeypatch):
    # 「設定ミスの子は救われるのに、声を設定していない子だけ鳴らない」を作らない。
    # 実在検査は子どもの設定でも既定でも同じ道を通す。
    monkeypatch.setattr(tts_module, "VOICEVOX_SPEAKER", 777)
    assert voice_client.post("/api/tts", json={"text": "やあ"}).status_code == 200
    assert [params["speaker"] for _name, params in synth_calls] == [3, 3]  # 一覧の先頭
    assert voice_client.get("/api/tts/status").json() == {"available": True, "speaker": 3}


# ---- 「VOICEVOX を名乗る何か」からの異常な応答（版ちがい・プロキシのエラーページ・取り違え） ----
#
# /speakers の中身は素の JSON。ここで型を確かめずに回すと素の TypeError が漏れ、
# /api/tts/speakers だけでなく、話者解決を通る /api/tts/status と合成まで 500 になる
# ＝「読み上げはオプション」で済まなくなる（音声を切っている家の画面まで巻き添え）。


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ([{"name": "こわれ", "styles": 1}], []),  # styles が数値
        ([{"name": "こわれ", "styles": "ab"}], []),  # styles が文字列（for で回せてしまう）
        ([{"name": "こわれ", "styles": {"id": 1}}], []),  # styles がマップ
        ([{"name": "こわれ", "styles": [1, "x", None]}], []),  # 要素がマップでない
        ([{"name": "こわれ", "styles": [{"name": "id無し"}]}], []),  # id が無い
        (["ただの文字列", 1, None], []),  # 要素がマップでない
        (
            # 負のIDは合成に渡せず定義にも保存できない＝「えらべるのに使えない声」を出さない
            [{"name": "まざり", "styles": [{"id": -1, "name": "ng"}, {"id": 8, "name": "ok"}]}],
            [{"name": "まざり", "styles": [{"id": 8, "name": "ok"}]}],
        ),
    ],
)
def test_speakers_の異常な応答でも500にしない(voice_client, monkeypatch, payload, expected):
    def broken_get(url: str, timeout: float) -> _FakeResponse:
        if url.endswith("/version"):
            return _FakeResponse(200, payload="0.16.0")
        if url.endswith("/speakers"):
            return _FakeResponse(200, payload=payload)
        raise AssertionError(f"想定外の GET: {url}")

    monkeypatch.setattr(tts_module, "_speakers_cache", {"at": 0.0, "ttl": 0.0, "speakers": None})
    monkeypatch.setattr("app.routers.tts.httpx.get", broken_get)
    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient([]))

    r = voice_client.get("/api/tts/speakers")
    assert r.status_code == 200
    assert r.json() == {"available": True, "speakers": expected, "default_speaker": 3}
    # 話者解決を通る2経路も巻き添えで 500 にならない
    assert voice_client.get("/api/tts/status", params={"child": "そら"}).status_code == 200
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "そら"}).status_code == 200


def test_死活キャッシュはプロセス起動直後でも必ずprobeする(voice_client, monkeypatch):
    """at の初期値が 0.0 だと、time.monotonic() の原点（Linux ではホスト起動）から
    30秒以内に立ち上がったサーバが probe せず available=False を返す
    ＝電源投入と同時に docker が起動する家の機械で、最初の30秒だけ音声ボタンが消える。
    """
    calls: list[str] = []

    def counting_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        return _fake_get(url, timeout)

    monkeypatch.setattr("app.routers.tts.httpx.get", counting_get)
    # ホスト起動から3秒後にプロセスが立ち上がった状況を模す
    monkeypatch.setattr(tts_module.time, "monotonic", lambda: 3.0)
    monkeypatch.setattr(tts_module, "_status_cache", dict(tts_module._status_cache))
    assert voice_client.get("/api/tts/status").json()["available"] is True
    assert [u for u in calls if u.endswith("/version")]


def test_試聴の話者IDは緩い変換をしない(voice_client, synth_calls):
    """定義の voice.speaker は bool・文字列・小数を拒む（_parse_voice）。
    素の int だと Pydantic の変換で true→1・"3"→3・3.0→3 まで通り、同じ話者IDなのに
    入口によって受け付ける型が変わる。
    """
    for bad in (True, False, "3", 3.5):
        r = voice_client.post("/api/tts", json={"text": "やあ", "speaker": bad})
        assert r.status_code == 422, f"{bad!r} が通ってしまった"
    assert voice_client.post("/api/tts", json={"text": "やあ", "speaker": -1}).status_code == 400
    assert voice_client.post("/api/tts", json={"text": "やあ", "speaker": 8}).status_code == 200


def test_一覧が引けず素通しした話者の4xxでは一覧を捨てない(voice_client, monkeypatch):
    """実在検査を通していない話者の 4xx は「一覧が古い」証拠にならない.

    捨ててしまうと、有効な一覧を持っていても合成のたびに引き直すことになる
    （_forget_speakers は TTL ごと 0 にするため）。
    """
    calls: list[str] = []

    def counting_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        return _fake_get(url, timeout)

    monkeypatch.setattr("app.routers.tts.httpx.get", counting_get)
    # まず一覧を1回引かせる（「はな」＝実在する話者8）
    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient([]))
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"}).status_code == 200
    assert len([u for u in calls if u.endswith("/speakers")]) == 1

    # 試聴（実在検査を通さない直接指定）で 4xx。一覧の鮮度とは無関係なので捨てない
    monkeypatch.setattr(
        "app.routers.tts.httpx.Client", lambda timeout: _FakeClient([], query_status=422)
    )
    assert voice_client.post("/api/tts", json={"text": "やあ", "speaker": 12345}).status_code == 400

    monkeypatch.setattr("app.routers.tts.httpx.Client", lambda timeout: _FakeClient([]))
    assert voice_client.post("/api/tts", json={"text": "やあ", "child": "はな"}).status_code == 200
    assert len([u for u in calls if u.endswith("/speakers")]) == 1  # 引き直していない
