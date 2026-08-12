"""初回ウィザードの標準テンプレート（コード定数）。

ラベルは学年帯（kanji.GRADE_BANDS: low=小1-2 / mid=小3-4 / high=小5-6）ごとに用意し、
その帯の lint 基準学年までの配当漢字＋総ルビ（漢字《よみ》）で書く——褒めメッセージ
（summer/praise.py）と同じ方針で、同じ帯のどちらの学年でも自分で読める。
小1で「おんどく」、小5で「音読《おんどく》」のように、最初から学年相応の見た目で始まる。

学年で変わるのは表示文字列だけで、項目キー・構造・ごほうびの閾値は全学年共通
（＝どの学年で作っても採点の挙動は同じ）。ごほうびの avg は、1日にとれる最大点
（100 + スペシャルチャレンジ数 × CHALLENGE_POINTS）以内にする——超えると、
夏休み中1日も欠かさず全部やっても届かないランクになる。宿題の中身は学校ごとに違うので、
標準テンプレートは「生活習慣＋毎日/くりかえしの代表例＋ごほうびランク」だけを用意し、
一回もの・選択宿題・新学期じゅんびは管理画面で足してもらう。
"""

from __future__ import annotations

from app.summer import kanji
from app.summer.definition import MEDIA_LIMIT_MINUTES_DEFAULT, SummerDefinitionError, parse_grade

# 標準テンプレートの表示文言。最大漢字（小6配当まで）＋総ルビで1回だけ書き、
# 学年ごとの表示は kanji.open_for_grade() が導出する（まだ習っていない漢字を含む
# ルビ単位は まるごと よみ へ畳まれる）。キーは項目キー（*_ph は placeholder）。
# 「寝」は教育漢字1,026字に無いので、どの学年でも「ねる」はかな書きのままにする。
# ルビの区切りかたが出力を決める（例「お手《て》伝《つだ》い」は小1で「お手《て》つだい」、
# 小4から「お手《て》伝《つだ》い」。1単位の「お手伝《てつだ》い」だと小4まで丸ごと かな）。
_LABELS: dict[str, str] = {
    "hamigaki_asa": "はみがき（朝《あさ》）",
    "hamigaki_hiru": "はみがき（昼《ひる》）",
    "hamigaki_yoru": "はみがき（夜《よる》）",
    "hayaoki": "早起《はやお》きできた",
    "asagohan": "朝《あさ》ご飯《はん》を しっかり食《た》べた",
    "hayane": "早《はや》ねできた",
    "outmedia": "テレビ・ゲーム・タブレットは 2時間《じかん》まで",
    "ondoku": "音読《おんどく》",
    "ondoku_book": "読《よ》んだ本《ほん》",
    "ondoku_book_ph": "本《ほん》の題名《だいめい》を書《か》こう",
    "nikki": "日記《にっき》",
    "keisan": "計算《けいさん》の 練習《れんしゅう》",
    "drill": "ドリルを 進《すす》める",
    "otetsudai": "お手《て》伝《つだ》い",
    "undou": "運動《うんどう》",
}


def labels_for(grade: str) -> dict[str, str]:
    """学年表記（小1〜小6）→ その学年で開いた文言表。

    読めない学年はいちばんやさしい小1に倒す。壊れた学年はこの先の
    parse_definition が必ず弾くので、ここで例外にはしない（テンプレは常に作れる）。
    """
    try:
        _, level = parse_grade(grade, "template")
    except SummerDefinitionError:
        level = kanji.GRADE_MIN
    return {key: kanji.open_for_grade(text, level) for key, text in _LABELS.items()}


def empty_template(child: str, child_kana: str, grade: str, year: int, period: dict) -> dict:
    """からっぽの定義（区画だけ揃えた最小構成）."""
    return {
        "child": child,
        "child_kana": child_kana,
        "year": year,
        "grade": grade,
        "period": dict(period),
        "away": [],
        "card_rules": {"edges_window_days": 5},
        "media_timer": {"limit_minutes": MEDIA_LIMIT_MINUTES_DEFAULT},
        "habits": [],
        "daily_homework": [],
        "special_challenges": [],
        "rewards": [],
        "one_shot_homework": [],
        "choice_homework": [],
        "school_start_items": [],
    }


def standard_template(child: str, child_kana: str, grade: str, year: int, period: dict) -> dict:
    """標準テンプレート（はみがき×3・生活習慣・宿題の代表例・ごほうびランク）."""
    doc = empty_template(child, child_kana, grade, year, period)
    t = labels_for(grade)
    doc["habits"] = [
        {"key": "hamigaki_asa", "label": t["hamigaki_asa"]},
        {"key": "hamigaki_hiru", "label": t["hamigaki_hiru"]},
        {"key": "hamigaki_yoru", "label": t["hamigaki_yoru"]},
        {"key": "hayaoki", "label": t["hayaoki"], "window": "edges"},
        {"key": "asagohan", "label": t["asagohan"], "window": "edges"},
        {"key": "hayane", "label": t["hayane"], "window": "edges"},
        {"key": "outmedia", "label": t["outmedia"], "window": "edges"},
    ]
    doc["daily_homework"] = [
        {
            "key": "ondoku",
            "label": t["ondoku"],
            "meta": [
                {"key": "book", "type": "text", "label": t["ondoku_book"], "placeholder": t["ondoku_book_ph"]}
            ],
        },
        {"key": "nikki", "label": t["nikki"]},
        {"key": "keisan", "label": t["keisan"]},
        {"key": "drill", "label": t["drill"]},
    ]
    doc["special_challenges"] = [
        {"key": "otetsudai", "label": t["otetsudai"]},
        {"key": "undou", "label": t["undou"]},
    ]
    # avg（1日の平均点の目安）は、上のチャレンジ2件から決まる1日の上限
    # 100 + CHALLENGE_POINTS × 2 = 150点 の中に収める（validate.rewards_unreachable と同じ規則）。
    # チャレンジを増減させたら、ここも合わせ直すこと。
    doc["rewards"] = [
        {"key": "c", "label": "ランクC", "avg": 60},
        {"key": "b", "label": "ランクB", "avg": 90},
        {"key": "a", "label": "ランクA", "avg": 110},
        {"key": "s", "label": "ランクS", "avg": 130},
    ]
    return doc


TEMPLATES = {"standard": standard_template, "empty": empty_template}
