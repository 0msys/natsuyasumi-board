"""学年別漢字配当（app/summer/kanji.py）のロックと表示ラベルの配当 lint.

- 配当表ロック: 学年別字数 80/160/200/202/193/191・学年間重複なし・合計1,026字
  （文部科学省 学習指導要領（平成29年告示）別表と一致することの恒常検証）
- サンプル定義・標準テンプレート・褒めメッセージ定型文の全表示文字列を機械照合し、
  配当外漢字の混入を防ぐ（安全網）
"""

from __future__ import annotations

from itertools import combinations

import pytest

from app.admin.template import standard_template
from app.summer import kanji, praise
from app.summer.definition import SummerDefinition

EXPECTED_COUNTS = {1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191}


# ---- 配当表ロック ----


def test_配当表ロック_学年別字数():
    assert {g: len(chars) for g, chars in kanji.GRADE_KANJI.items()} == EXPECTED_COUNTS


def test_配当表ロック_学年間の重複なし():
    for g1, g2 in combinations(sorted(kanji.GRADE_KANJI), 2):
        overlap = kanji.GRADE_KANJI[g1] & kanji.GRADE_KANJI[g2]
        assert not overlap, f"小{g1}と小{g2}で重複: {sorted(overlap)}"


def test_配当表ロック_合計1026字():
    union: set[str] = set()
    for chars in kanji.GRADE_KANJI.values():
        union |= chars
    assert len(union) == 1026
    assert sum(EXPECTED_COUNTS.values()) == 1026


# ---- allowed_for_grade（累積性） ----


def test_allowed_for_grade_累積性():
    assert kanji.allowed_for_grade(1) == kanji.GRADE_KANJI[1]
    for g in range(2, 7):
        assert kanji.allowed_for_grade(g) == kanji.allowed_for_grade(g - 1) | kanji.GRADE_KANJI[g]
    assert len(kanji.allowed_for_grade(6)) == 1026


def test_allowed_for_grade_範囲外はクランプ():
    assert kanji.allowed_for_grade(0) == kanji.allowed_for_grade(1)
    assert kanji.allowed_for_grade(99) == kanji.allowed_for_grade(6)


def test_allowed_for_grade_名前例外を含む():
    allowed = kanji.allowed_for_grade(1, name_exceptions=frozenset({"梨"}))
    assert "梨" in allowed  # 小4配当だが名前例外として許可
    assert "梨" not in kanji.allowed_for_grade(1)


# ---- name_exceptions_for ----


def test_name_exceptions_for():
    assert kanji.name_exceptions_for("はな") == frozenset()
    assert kanji.name_exceptions_for("海斗") == frozenset({"海", "斗"})
    assert kanji.name_exceptions_for("美月ちゃん") == frozenset({"美", "月"})


# ---- strip_ruby / nonconforming_kanji / grade_of ----


def test_strip_ruby():
    assert kanji.strip_ruby("食《た》べた") == "食べた"
    assert kanji.strip_ruby("国語《こくご》か図工《ずこう》") == "国語か図工"
    assert kanji.strip_ruby("お｜手《て》つだい") == "お手つだい"
    assert kanji.strip_ruby("はみがき（あさ）") == "はみがき（あさ）"


def test_nonconforming_kanji():
    assert kanji.nonconforming_kanji("朝《あさ》ごはん", grade=2) == set()  # 朝=小2 は適合
    assert kanji.nonconforming_kanji("宿題", grade=2) == {"宿", "題"}  # 小3 は非適合
    assert kanji.nonconforming_kanji("宿題", grade=3) == set()
    # ルビのよみ（仮名）は判定対象外・基底のみを見る
    assert kanji.nonconforming_kanji("秒《びょう》", grade=2) == {"秒"}  # 基底の秒=小3
    # 名前例外
    assert kanji.nonconforming_kanji("斗《と》", grade=1, name_exceptions=frozenset({"斗"})) == set()


def test_grade_of():
    assert kanji.grade_of("本") == 1
    assert kanji.grade_of("朝") == 2
    assert kanji.grade_of("宿") == 3
    assert kanji.grade_of("圧") == 5
    assert kanji.grade_of("凜") is None  # 配当外


# ---- サンプル定義の全表示ラベル lint ----


def _display_strings(defn: SummerDefinition) -> list[tuple[str, str]]:
    """表示に出る全文字列を (どこか, 文字列) で列挙する（key/type 等の非表示メタは除く）."""
    out: list[tuple[str, str]] = []
    out.append(("child", defn.child))
    for rng in defn.away:
        out.append(("away.label", rng.label))
    for section, items in (
        ("habits", defn.habits),
        ("daily_homework", defn.daily_homework),
        ("practice_homework", defn.practice_homework),
        ("special_challenges", defn.special_challenges),
    ):
        for item in items:
            out.append((f"{section}.label", item.label))
            for field in item.meta:
                out.append((f"{section}.meta.label", field.label))
                if field.placeholder:
                    out.append((f"{section}.meta.placeholder", field.placeholder))
                for opt in field.options:
                    out.append((f"{section}.meta.option", opt.label))
    for item in defn.one_shot_homework:
        out.append(("one_shot_homework.label", item.label))
    for group in defn.choice_homework:
        out.append(("choice_homework.group.label", group.label))
        for opt in group.options:
            out.append(("choice_homework.option.label", opt.label))
            if opt.category:
                out.append(("choice_homework.option.category", opt.category))
    for rank in defn.rewards:
        out.append(("rewards.label", rank.label))
        if rank.prize:
            out.append(("rewards.prize", rank.prize))
    for item in defn.school_start_items:
        out.append(("school_start_items.label", item.label))
    return out


def test_サンプル定義の全表示ラベルが配当内(definition):
    labels = _display_strings(definition)
    assert len(labels) > 40, "表示文字列の収集が空振り＝テストが空虚（収集ロジックを確認）"
    exceptions = kanji.name_exceptions_for(definition.child)
    offenders = []
    for where, text in labels:
        bad = kanji.nonconforming_kanji(text, grade=definition.grade_level, name_exceptions=exceptions)
        if bad:
            offenders.append((where, text, bad))
    assert not offenders, "配当外の漢字が混入しています:\n" + "\n".join(
        f"  [{where}] {text!r} → {sorted(bad)}" for where, text, bad in offenders
    )


# ---- 標準テンプレートのラベル lint（子どもの学年そのものの配当で書く） ----

PERIOD = {"start": "2026-07-18", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}


def test_学年帯をリテラルで固定():
    """帯は褒めメッセージの「口調」の単位（漢字の基準ではない。漢字は学年ごと）.

    帯がずれると褒めメッセージの語り口が黙って変わるので、直値で押さえる。
    """
    assert kanji.GRADE_BANDS == {"low": (1, 2), "mid": (3, 4), "high": (5, 6)}
    assert [kanji.grade_band(g) for g in range(1, 7)] == ["low", "low", "mid", "mid", "high", "high"]


def _template_texts(doc: dict) -> list[str]:
    """テンプレートの全表示文字列（ラベル・meta・ごほうび名）を集める."""
    texts: list[str] = []
    for section in ("habits", "daily_homework", "practice_homework", "special_challenges"):
        for item in doc[section]:
            texts.append(item["label"])
            for field in item.get("meta") or []:
                texts.append(field["label"])
                if field.get("placeholder"):
                    texts.append(field["placeholder"])
                for opt in field.get("options") or []:
                    texts.append(opt["label"])
    for rank in doc["rewards"]:
        texts.append(rank["label"])
    return texts


@pytest.mark.parametrize("grade", ["小1", "小2", "小3", "小4", "小5", "小6"])
def test_標準テンプレートのラベルが学年の配当内(grade):
    doc = standard_template("はな", "はな", grade, 2026, PERIOD)
    lint_grade = int(grade[1])
    texts = _template_texts(doc)
    assert len(texts) > 10
    offenders = [(t, sorted(bad)) for t in texts if (bad := kanji.nonconforming_kanji(t, grade=lint_grade))]
    assert not offenders, f"{grade} の標準テンプレートに配当外の漢字（{lint_grade}年基準）: {offenders}"


def test_標準テンプレートは学年で漢字の量が変わる():
    grades = ["小1", "小2", "小3", "小4", "小5", "小6"]
    labels = {
        g: [h["label"] for h in standard_template("はな", "はな", g, 2026, PERIOD)["habits"]] for g in grades
    }
    # 低学年ほどかな書き（連鎖比較は a != c を見ないので個別に押さえる）
    assert labels["小1"] != labels["小3"]
    assert labels["小3"] != labels["小5"]
    assert labels["小1"] != labels["小5"]
    assert "はやおきできた" in labels["小1"]
    assert "早起《はやお》きできた" in labels["小3"]
    # 学年が上がって漢字が減ることはない
    counts = [sum(len(kanji._KANJI_RE.findall(t)) for t in labels[g]) for g in grades]
    assert counts == sorted(counts), f"学年で漢字が減っている: {dict(zip(grades, counts))}"
    # 読み（発音）は全学年で同じ＝変わるのは漢字の開き具合だけ
    readings = {tuple(kanji.ruby_reading(t) for t in labels[g]) for g in grades}
    assert len(readings) == 1, "学年で読みが変わっている"


def test_標準テンプレートのキーと採点構造は全学年共通():
    """学年で変わるのは表示文字列だけ＝どの学年で作っても採点の挙動は同じ."""
    docs = [standard_template("はな", "はな", g, 2026, PERIOD) for g in ("小1", "小3", "小5")]
    for section in ("habits", "daily_homework", "practice_homework", "special_challenges", "rewards"):
        keys = [[item["key"] for item in doc[section]] for doc in docs]
        assert keys[0] == keys[1] == keys[2], f"{section} のキーが学年で変わっている"
    avgs = [[r["avg"] for r in doc["rewards"]] for doc in docs]
    assert avgs[0] == avgs[1] == avgs[2], "ごほうびの閾値が学年で変わっている"
    windows = [[h.get("window") for h in doc["habits"]] for doc in docs]
    assert windows[0] == windows[1] == windows[2]


@pytest.mark.parametrize("bad", ["小9", "小0", "", "3年", "小三", "小3\n", "小3 ", " 小3"])
def test_読めない学年はいちばんやさしい文言に倒す(bad):
    """壊れた学年でもテンプレは作れる（不正な学年はこの先の parse_definition が弾く）.

    「小3\\n」のような末尾の空白・改行つきも読めない学年として扱う（正規表現の $ ではなく
    fullmatch で弾く＝改行つきの学年が表示用にそのまま保存されない）。
    """
    low = [h["label"] for h in standard_template("はな", "はな", "小1", 2026, PERIOD)["habits"]]
    assert [h["label"] for h in standard_template("はな", "はな", bad, 2026, PERIOD)["habits"]] == low


# ---- 褒めメッセージ定型文の lint（各学年帯の下限学年の配当で書く） ----


def _praise_texts() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for gband in kanji.GRADE_BANDS:
        out.append((gband, praise.SCORE_LINE[gband]))
        out.append((gband, praise.CHALLENGE_LINE[gband]))
        out.append((gband, praise.AWAY_LINE[gband]))
        for variants in praise.MESSAGES[gband].values():
            out.extend((gband, v) for v in variants)
    return out


def test_褒めメッセージ定型文が最大漢字の正規形():
    """定型文は最大漢字＋総ルビで書く（学年ごとの開きは build_praise が行う）."""
    texts = _praise_texts()
    assert len(texts) > 40, "定型文が集まっていない＝テストが空虚"
    offenders = [(b, t, p) for b, t in texts if (p := kanji.validate_ruby_source(t))]
    assert not offenders, "褒めメッセージのルビ記法が正規形でない:\n" + "\n".join(
        f"  [{b}] {t!r} → {p}" for b, t, p in offenders
    )
    outside = [(b, t, sorted(bad)) for b, t in texts if (bad := kanji.nonconforming_kanji(t, grade=kanji.GRADE_MAX))]
    assert not outside, f"教育漢字の配当外の字が使われている: {outside}"


@pytest.mark.parametrize("grade", [1, 2, 3, 4, 5, 6])
def test_褒めメッセージが各学年の配当内(grade):
    offenders = [
        (b, opened, sorted(bad))
        for b, t in _praise_texts()
        if (bad := kanji.nonconforming_kanji(opened := kanji.open_for_grade(t, grade), grade=grade))
    ]
    assert not offenders, f"小{grade} の褒めメッセージに配当外の漢字: {offenders}"


# ---- ルビ解析・学年別の開き（アプリが用意する文言を1本のソースから導出する仕組み） ----

# 開きの検証に使う代表例（最大漢字＋総ルビの正規形で書く）
OPEN_CASES = [
    "新学期《しんがっき》のじゅんび",  # 新2 学1 期3 → 小3から漢字
    "今日《きょう》のチェック",  # 今2 日1 → 小2から（熟字訓なので1単位固定）
    "生活《せいかつ》",  # 生1 活2 → 小2から
    "記録《きろく》をつける",  # 記2 録4 → 小4から（混在配当は語ごと開く）
    "早起《はやお》きできた",  # 早1 起3 → 小3から（送り仮名は基底の外）
    "朝《あさ》ご飯《はん》をたべた",  # 朝2 飯4 → 単位ごとに別々に開く
]


def test_ルビ解析は基底とよみに分かれる():
    assert kanji.parse_ruby("音読《おんどく》カード") == [
        kanji.RubySegment("音読", "おんどく"),
        kanji.TextSegment("カード"),
    ]
    # 寛容パース: 閉じない《・基底の無い《》はリテラルのまま（既存データを壊さない）
    assert kanji.parse_ruby("あ《い》") == [kanji.TextSegment("あ《い》")]
    assert kanji.parse_ruby("音《おん") == [kanji.TextSegment("音《おん")]


def test_ruby_readingとstrip_rubyは逆向き():
    """同名の frontend stripRuby と取り違えると属性・TTS の発音が壊れるので方向を固定する."""
    assert kanji.ruby_reading("生活《せいかつ》しゅうかん") == "せいかつしゅうかん"
    assert kanji.strip_ruby("生活《せいかつ》しゅうかん") == "生活しゅうかん"


def test_学年別の開きは配当外の漢字を出さない():
    offenders = []
    for text in OPEN_CASES:
        for grade in range(kanji.GRADE_MIN, kanji.GRADE_MAX + 1):
            opened = kanji.open_for_grade(text, grade)
            bad = kanji.nonconforming_kanji(opened, grade=grade)
            if bad:
                offenders.append((grade, text, opened, sorted(bad)))
    assert not offenders, "開いた結果に配当外の漢字:\n" + "\n".join(
        f"  小{g} {src!r} → {out!r} {bad}" for g, src, out, bad in offenders
    )


def test_開いても読みは変わらない():
    """畳む先はそのルビ自身なので、発音（属性・TTS）は学年によらず同じでなければならない."""
    offenders = []
    for text in OPEN_CASES:
        readings = {kanji.ruby_reading(kanji.open_for_grade(text, g)) for g in range(1, 7)}
        if len(readings) != 1:
            offenders.append((text, sorted(readings)))
    assert not offenders, f"学年で読みが変わる文言: {offenders}"


def test_学年が上がると漢字は減らない():
    offenders = []
    for text in OPEN_CASES:
        counts = [len(kanji._KANJI_RE.findall(kanji.open_for_grade(text, g))) for g in range(1, 7)]
        if counts != sorted(counts):
            offenders.append((text, counts))
    assert not offenders, f"学年が上がって漢字が減る文言: {offenders}"


def test_繰り返し記号は直前の漢字の配当に従う():
    """々 はどの配当表にも無い。素直に判定すると「時々」が小6でも かな のままになる."""
    assert kanji.open_for_grade("時々《ときどき》あそぶ", 1) == "ときどきあそぶ"
    assert kanji.open_for_grade("時々《ときどき》あそぶ", 2) == "時々《ときどき》あそぶ"
    assert kanji.open_for_grade("時々《ときどき》あそぶ", 6) == "時々《ときどき》あそぶ"


def test_表示開始学年のoverrideが効く():
    """配当上は出せるが語として出したくない字を、個別に遅らせられる."""
    assert kanji.open_for_grade("赤《あか》", 1) == "赤《あか》"
    assert kanji.open_for_grade("赤《あか》", 1, show_from={"赤": 3}) == "あか"
    assert kanji.open_for_grade("赤《あか》", 3, show_from={"赤": 3}) == "赤《あか》"


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        ("音読《》", "よみが空"),
        ("音読《おんどく", "《》 の対応"),
        ("あ《い》", "ルビにならない"),
        ("記録をつける", "ルビの付いていない漢字"),
        ("お｜手伝《てつだ》い", "｜ は使わない"),
        ("音読《オンドク1》", "よみがかなだけでない"),
    ],
)
def test_正規形の検証が壊れた記法を弾く(text, reason):
    problems = kanji.validate_ruby_source(text)
    assert problems, f"{text!r} は弾かれるべき"
    assert any(reason in p for p in problems), f"{text!r} → {problems}（期待: {reason}）"


def test_正規形の検証は正しい記法を通す():
    for text in OPEN_CASES:
        assert kanji.validate_ruby_source(text) == [], f"{text!r} が誤って弾かれた"


def test_標準テンプレートの最大漢字ラベルが正規形():
    """テンプレの high は最大漢字ソースの雛形。ここが正規形でないと開きの土台が崩れる."""
    labels = [item["label"] for item in standard_template("はな", "はな", "小6", 2026, PERIOD)["habits"]]
    assert len(labels) > 3, "ラベルが集まっていない＝テストが空虚"
    offenders = [(t, p) for t in labels if (p := kanji.validate_ruby_source(t))]
    assert not offenders, f"標準テンプレのラベルが正規形でない: {offenders}"
