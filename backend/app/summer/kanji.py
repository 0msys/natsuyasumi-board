"""学年別漢字配当（小1〜小6・計1,026字）とルビ処理の単一真実源。

方針: 子どもが自分で読めるよう、表示ラベルは「その学年までの配当漢字＋総ルビ（ふりがな）」で
書き、まだ習わない漢字はひらがなで書く。総ルビ記法は「漢字《よみ》」（青空文庫式）。
このモジュールは (1) ルビ除去 (2) 配当外漢字の検出 を提供し、テストが定義ドキュメントの
全表示ラベルを機械照合する（配当外の漢字混入を防ぐ安全網）。

配当表の出典＝文部科学省 小学校学習指導要領（平成29年告示）別表「学年別漢字配当表」
（2020年度施行・計1,026字。小1=80字・小2=160字・小3=200字・小4=202字・小5=193字・小6=191字）。
学習指導要領は告示（著作権法13条により権利の目的にならない）。収録内容は独立した複数の
公開ソースから機械抽出して相互照合済み（tests/test_summer_kanji.py の字数ロックが恒常検証）。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

# 小学1年（80字）
_GRADE1 = (
    "一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森"
    "人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六"
)
# 小学2年（160字）
_GRADE2 = (
    "引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸"
    "古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少"
    "場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当"
    "東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話"
)
# 小学3年（200字）
_GRADE3 = (
    "悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局"
    "銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州"
    "拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題"
    "炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆"
    "氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和"
)
# 小学4年（202字）
_GRADE4 = (
    "愛案以衣位茨印英栄媛塩岡億加果貨課芽賀改械害街各覚潟完官管関観願岐希季旗器機議求"
    "泣給挙漁共協鏡競極熊訓軍郡群径景芸欠結建健験固功好香候康佐差菜最埼材崎昨札刷察参"
    "産散残氏司試児治滋辞鹿失借種周祝順初松笑唱焼照城縄臣信井成省清静席積折節説浅戦選"
    "然争倉巣束側続卒孫帯隊達単置仲沖兆低底的典伝徒努灯働特徳栃奈梨熱念敗梅博阪飯飛必"
    "票標不夫付府阜富副兵別辺変便包法望牧末満未民無約勇要養浴利陸良料量輪類令冷例連老"
    "労録"
)
# 小学5年（193字）
_GRADE5 = (
    "圧囲移因永営衛易益液演応往桜可仮価河過快解格確額刊幹慣眼紀基寄規喜技義逆久旧救居"
    "許境均禁句型経潔件険検限現減故個護効厚耕航鉱構興講告混査再災妻採際在財罪殺雑酸賛"
    "士支史志枝師資飼示似識質舎謝授修述術準序招証象賞条状常情織職制性政勢精製税責績接"
    "設絶祖素総造像増則測属率損貸態団断築貯張停提程適統堂銅導得毒独任燃能破犯判版比肥"
    "非費備評貧布婦武復複仏粉編弁保墓報豊防貿暴脈務夢迷綿輸余容略留領歴"
)
# 小学6年（191字）
_GRADE6 = (
    "胃異遺域宇映延沿恩我灰拡革閣割株干巻看簡危机揮貴疑吸供胸郷勤筋系敬警劇激穴券絹権"
    "憲源厳己呼誤后孝皇紅降鋼刻穀骨困砂座済裁策冊蚕至私姿視詞誌磁射捨尺若樹収宗就衆従"
    "縦縮熟純処署諸除承将傷障蒸針仁垂推寸盛聖誠舌宣専泉洗染銭善奏窓創装層操蔵臓存尊退"
    "宅担探誕段暖値宙忠著庁頂腸潮賃痛敵展討党糖届難乳認納脳派拝背肺俳班晩否批秘俵腹奮"
    "並陛閉片補暮宝訪亡忘棒枚幕密盟模訳郵優預幼欲翌乱卵覧裏律臨朗論"
)

GRADE_MIN = 1
GRADE_MAX = 6
GRADE_KANJI: dict[int, frozenset[str]] = {
    1: frozenset(_GRADE1),
    2: frozenset(_GRADE2),
    3: frozenset(_GRADE3),
    4: frozenset(_GRADE4),
    5: frozenset(_GRADE5),
    6: frozenset(_GRADE6),
}

# CJK 漢字（教育漢字は U+4E00-9FFF に収まるが、拡張・繰り返し記号も広めに拾う）
_KANJI_RE = re.compile(r"[㐀-鿿々〆〇ヶ]")
# ルビ注記「漢字《よみ》」の《…》部分（基底の漢字は残す）
_RUBY_RE = re.compile(r"《[^》]*》")


def strip_ruby(text: str) -> str:
    """ルビ注記を落として基底テキストに戻す（漢字《よみ》→漢字。｜ も除去）."""
    return _RUBY_RE.sub("", text).replace("｜", "")


def allowed_for_grade(grade: int, name_exceptions: frozenset[str] = frozenset()) -> frozenset[str]:
    """その学年までに習う漢字の累積集合＋名前例外（自分の名前の字は学年に関係なく許可）."""
    allowed: set[str] = set(name_exceptions)
    for g in range(GRADE_MIN, min(max(grade, GRADE_MIN), GRADE_MAX) + 1):
        allowed |= GRADE_KANJI[g]
    return frozenset(allowed)


def name_exceptions_for(name: str) -> frozenset[str]:
    """子どもの名前に含まれる漢字（配当外でも表示・警告除外の対象にする）."""
    return frozenset(ch for ch in name if _KANJI_RE.match(ch))


def nonconforming_kanji(
    text: str, *, grade: int, name_exceptions: frozenset[str] = frozenset()
) -> set[str]:
    """表示テキスト中の「配当外（その学年まで＋例外の外）」の漢字を返す（空なら適合）.

    ルビを除いた基底の漢字だけを見る（＝ルビのよみに含まれる仮名は対象外）。
    """
    allowed = allowed_for_grade(grade, name_exceptions)
    return {ch for ch in _KANJI_RE.findall(strip_ruby(text)) if ch not in allowed}


def grade_of(kanji: str) -> int | None:
    """1字の配当学年（1〜6）。配当外なら None."""
    for grade, chars in GRADE_KANJI.items():
        if kanji in chars:
            return grade
    return None


# ---- 学年帯（褒めメッセージの「口調」の単位） ----
# 漢字の開き具合は学年ごと（open_for_grade）に決まるので、帯は配当の基準ではない。
# 残っているのは「小1-2 にはやさしく短く、小5-6 には少し大人びた言い回しで」という
# 語り口の切り替えのため（summer/praise.py の MESSAGES）。
GRADE_BANDS: dict[str, tuple[int, int]] = {"low": (1, 2), "mid": (3, 4), "high": (5, 6)}


def grade_band(grade_level: int) -> str:
    """学年（1〜6）→ 口調の帯（low/mid/high）."""
    for band, (lo, hi) in GRADE_BANDS.items():
        if lo <= grade_level <= hi:
            return band
    return "high" if grade_level > GRADE_MAX else "low"


# ---- ルビ記法の解析と、学年別の「開き」 ----
# アプリが用意する文言（画面の固定文言・標準テンプレ・褒めメッセージ）は
# 「最大漢字＋総ルビ」で1回だけ書き、学年ごとの表示は open_for_grade() が導出する。
# ルビ単位に1字でも未習の漢字が入っていれば、その単位ごと よみ（かな）へ畳む。
#   例: 新学期《しんがっき》のじゅんび → 小1・小2「しんがっきのじゅんび」/ 小3〜「新学期《しんがっき》…」
#
# 解析規則は frontend/src/lib/summer/ruby.ts の parseRuby() と同じ（寛容パース）。
# 「その単位ごと畳む」ため、部分的に開いた交ぜ書き（「日き」「音どく」）は起きない。
# 逆に、どこを1単位にするかで出力が決まるので、コード定数は validate_ruby_source() で
# 正規形（基底は漢字だけ・よみはその基底の読みだけ・送り仮名は基底の外）を強制する。


@dataclass(frozen=True)
class TextSegment:
    """ルビの付かない素のテキスト片."""

    text: str


@dataclass(frozen=True)
class RubySegment:
    """「基底《よみ》」1単位（base は漢字の連続、rt はその読み）."""

    base: str
    rt: str


Segment = TextSegment | RubySegment

# 繰り返し記号。直前の漢字を繰り返すので、配当判定は直前の字に肩代わりさせる
# （どの GRADE_KANJI にも入っていないため、素直に判定すると「時々」が小6でも開いてしまう）。
_ITERATION_MARK = "々"
# ルビ基底として認識する文字集合は _KANJI_RE（ruby.ts の KANJI と同一定義）。
# 配当を判定する文字集合はそれとは別で、々 は直前の字に読み替え、〆〇ヶ は配当外のまま
# （コード定数では validate_ruby_source() が弾く）。


def parse_ruby(text: str) -> list[Segment]:
    """「漢字《よみ》」をセグメント列に分解する（frontend/src/lib/summer/ruby.ts と同じ寛容規則）.

    《》は直前の漢字の連続ランに付く。｜ で基底の開始を明示できる。
    対応しない括弧・基底の無い《》はリテラル扱い（壊さない）。
    """
    segs: list[Segment] = []
    buf = ""  # まだ確定出力していないプレーンテキスト
    explicit_start: int | None = None  # ｜ で明示された基底開始位置（buf 内インデックス）
    i = 0

    def push_text(s: str) -> None:
        if not s:
            return
        if segs and isinstance(segs[-1], TextSegment):
            segs[-1] = TextSegment(segs[-1].text + s)
        else:
            segs.append(TextSegment(s))

    while i < len(text):
        ch = text[i]
        if ch == "｜":
            explicit_start = len(buf)
            i += 1
            continue
        if ch == "《":
            close = text.find("》", i + 1)
            if close == -1:
                buf += ch  # 閉じが無い＝リテラル
                i += 1
                continue
            rt = text[i + 1 : close]
            if explicit_start is not None:
                base_start = explicit_start
            else:
                base_start = len(buf)
                while base_start > 0 and _KANJI_RE.match(buf[base_start - 1]):
                    base_start -= 1
            base = buf[base_start:]
            push_text(buf[:base_start])
            if base:
                segs.append(RubySegment(base, rt))
            else:
                push_text("《" + rt + "》")  # 基底が無い＝ルビにできないのでリテラル
            buf = ""
            explicit_start = None
            i = close + 1
            continue
        buf += ch  # 「》」単独もここでリテラルとして積まれる
        i += 1
    push_text(buf)
    return segs


def ruby_reading(text: str) -> str:
    """ルビをよみ（かな）へ畳んだ読み上げ用テキスト（frontend の stripRuby 相当）.

    strip_ruby() は逆向き（基底の漢字を残す）なので取り違えないこと。
    こちらは発音を確定させる用途（属性・TTS・「学年で読みが変わっていない」検証）に使う。
    """
    return "".join(seg.text if isinstance(seg, TextSegment) else seg.rt for seg in parse_ruby(text))


def _base_shown_at(base: str, grade: int, allowed: frozenset[str], show_from: Mapping[str, int]) -> bool:
    """このルビ単位を、その学年で漢字のまま出してよいか（1字でも駄目なら単位ごと不可）."""
    prev_kanji = ""
    for ch in base:
        target = prev_kanji if ch == _ITERATION_MARK else ch
        if not target or not _KANJI_RE.match(target):
            return False  # 基底にかなが混ざる等の壊れた形（validate_ruby_source が弾く）
        if target not in allowed:
            return False
        if grade < show_from.get(target, 0):
            return False  # 配当上は出せるが、語として出したくない字（個別指定）
        prev_kanji = target
    return True


def open_for_grade(
    text: str,
    grade: int,
    *,
    name_exceptions: frozenset[str] = frozenset(),
    show_from: Mapping[str, int] | None = None,
) -> str:
    """その学年でまだ読めない漢字を含むルビ単位を、よみ（かな）へ畳む.

    配当外の漢字は構成上いっさい出ない。配当内を漢字で出すかは、
    ルビの区切りかた（＝どこを1単位にしたか）と show_from の個別指定で決まる。
    """
    allowed = allowed_for_grade(grade, name_exceptions)
    show = show_from or {}
    out: list[str] = []
    for seg in parse_ruby(text):
        if isinstance(seg, TextSegment):
            out.append(seg.text)
        elif _base_shown_at(seg.base, grade, allowed, show):
            out.append(f"{seg.base}《{seg.rt}》")
        else:
            out.append(seg.rt)
    return "".join(out)


_KANA_RE = re.compile(r"^[ぁ-んァ-ヴーゝゞ]+$")


def validate_ruby_source(text: str) -> list[str]:
    """コード定数用の厳格検証。違反理由を並べて返す（空なら適合）.

    画面表示と親が入れた定義データは寛容パースのままにする（壊さない方針）。
    ここで縛るのは open_for_grade() に通す「アプリが用意した文言」だけ。
    """
    problems: list[str] = []
    if "｜" in text:
        # 正規形では基底は漢字だけなので ｜ は要らない（使うと基底にかなが入りうる）
        problems.append("｜ は使わない（基底は漢字だけにする）")
    if text.count("《") != text.count("》"):
        problems.append("《》 の対応が取れていない")

    # 送り仮名がよみ側に入り込んだ形（例「進《すすめ》める」→ 開くと「すすめめる」）は
    # ここでは見ない。文字の重なりで推測すると「今日《きょう》うれしい」を誤検知するし、
    # そもそも ruby_reading() を現行文言と突き合わせるスナップショットで厳密に落ちる。
    for seg in parse_ruby(text):
        if isinstance(seg, TextSegment):
            if "《" in seg.text or "》" in seg.text:
                problems.append(f"ルビにならない《》がある: {seg.text!r}")
            bare = sorted({ch for ch in _KANJI_RE.findall(seg.text)})
            if bare:
                problems.append(f"ルビの付いていない漢字がある: {''.join(bare)}")
            continue
        if not seg.rt:
            problems.append(f"よみが空: {seg.base!r}《》")
        elif not _KANA_RE.match(seg.rt):
            problems.append(f"よみがかなだけでない: {seg.base}《{seg.rt}》")
        for ch in seg.base:
            if ch != _ITERATION_MARK and not _KANJI_RE.match(ch):
                problems.append(f"基底に漢字以外がある: {seg.base}《{seg.rt}》")
                break
    return problems
