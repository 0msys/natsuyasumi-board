"""子ども向け画面の固定文言（見出し・ボタン・説明文）の単一真実源.

方針: 文言は「最大漢字＋総ルビ」で1回だけ書き、学年ごとの表示は
kanji.open_for_grade() が導出する（まだ習っていない漢字を含むルビ単位は
まるごと よみ（かな）へ畳まれる）。したがって

- 配当外の漢字は構成上いっさい画面に出ない
- どの学年でも「読み」は同じ＝ aria-label / title / 読み上げは学年によらず同一

書きかたの規約（kanji.validate_ruby_source() がテストで強制する）:

1. 基底は漢字だけ・よみはその基底の読みだけ・送り仮名は基底の外
   （「終《お》わる」は可、「終《おわる》わる」は不可）
2. 区切りは語単位が原則。字ごとに割ると「日き」「音どく」のような交ぜ書きになる。
   部分開きは「朝《あさ》ご飯《はん》」のように元から送り仮名・接辞で切れている場合だけ
3. 熟字訓・当て字（今日・明日・一日）は不可分の1単位にする
4. 教育漢字1,026字に無い字（寝・塗・褒など）はどの学年でもかな書きのまま

プレースホルダは praise.py と同じ `{name}` 形式（フロントの $lib/summer/uiText fmt() が埋める）。
"""

from __future__ import annotations

from app.summer import kanji

# 配当上は出せるが、語として出したくない字。既定は配当どおりで、
# 6学年の実表示スナップショットを見て不自然なものだけをここに足す。
_SHOW_FROM: dict[str, int] = {}

UI_TEXT: dict[str, str] = {
    # ---- ページ全体（routes/+page.svelte） ----
    "header_title": "{name}の夏休《なつやす》み",
    "period_range": "{start}〜{end}（始業式《しぎょうしき》は {first}）",
    "period_ended": "夏休《なつやす》みのきかんが終《お》わったよ。記録《きろく》は下《した》の表《ひょう》で見《み》られるよ。",
    "away_today": "今日《きょう》はお出《で》かけの日《ひ》（{away}）。できたぶんだけ記録《きろく》しよう。",
    "rank_achieved_title": "{rank} たっせい！",
    "rank_achieved_sub": "つみあげ点《てん》が ランクに とどいたよ！",
    "rank_achieved_speech": "ランク{rank}、たっせい！",
    # ---- 満点の花火（SummerCelebration.svelte） ----
    "celebration_title": "満点《まんてん》！",
    "celebration_sub": "今日《きょう》のチェックが 全部《ぜんぶ》 できたよ",
    # ---- きょうのチェック（SummerTodayChecks.svelte） ----
    "today_checks_title": "今日《きょう》のチェック",
    "todo_speech_ask": "今日《きょう》やることをきく",
    "todo_speech_busy": "じゅんびちゅう…",
    "section_habits": "生活《せいかつ》",
    "section_daily": "宿題《しゅくだい》",
    # ---- 3値チェックのボタン（SummerCheckButtons.svelte） ----
    "check_done": "やった",
    "check_not_done": "やらなかった",
    "check_cancelled": "中止《ちゅうし》",
    "check_cancelled_aria": "中止《ちゅうし》（雨《あめ》などでおやすみ）",
    # ---- きょうのがんばり（SummerCommentCard.svelte） ----
    "comment_title": "今日《きょう》のがんばり",
    "score_of_max": "点《てん》 / {max}点《てん》",
    "score_homework_label": "宿題《しゅくだい》",
    "score_challenge_label": "スペシャルチャレンジ",
    "listen_aria": "読《よ》みあげる",
    # ---- スペシャルチャレンジ（SummerSpecialChallenge.svelte） ----
    "challenge_title": "スペシャルチャレンジ",
    "challenge_bonus": "1つできると +25点《てん》",
    "challenge_all": "全部《ぜんぶ》できたら 200点《てん》 満点《まんてん》！",
    "challenge_now": "いま +{bonus}点《てん》",
    "challenge_locked_hint": "宿題《しゅくだい》を 100点《てん》 にしたら チャレンジできるよ！",
    "challenge_locked_overlay": "宿題《しゅくだい》を 100点《てん》 にしたら あけられるよ",
    # ---- 新学期じゅんび（SummerSchoolStartItems.svelte） ----
    "school_start_title": "新学期《しんがっき》のじゅんび",
    "school_start_done": "{done}/{total} できたよ",
    "school_start_next": "つぎは {due}までに {item}",
    "school_start_due": "{due}まで",
    # ---- しゅくだいのすすみぐあい（SummerHomeworkProgress.svelte） ----
    "homework_title": "宿題《しゅくだい》のすすみぐあい",
    "homework_progress_days": "夏休《なつやす》み {elapsed}日《にち》め / {total}日《にち》",
    "homework_optional": "やってもやらなくてもいい 宿題《しゅくだい》",
    "homework_done_days_title": "やった日《ひ》のかず",
    "homework_done_days": "{days}日《にち》",
    "decide_do": "やる",
    "decide_skip": "やらない",
    "done_aria": "終《お》わった",
    "count_minus_aria": "へらす",
    "count_plus_aria": "ふやす",
    "choice_satisfied": "できたよ",
    "choice_unsatisfied": "どれか1つはえらんでね",
    # ---- ごほうびランク（SummerRewardChart.svelte） ----
    "reward_title": "ごほうびランク",
    "reward_now": "いま {total} 点《てん》",
    "reward_achieved": "たっせい: {rank}",
    "reward_next": "つぎは {rank}（あと{rest}点《てん》）",
    "reward_pace": "このペースなら → {rank}",
    "reward_hint": "毎日《まいにち》の点数《てんすう》をつみあげて、ランクをめざそう",
    "reward_chart_aria": "いま{total}点《てん》",
    # {rank} はごほうび定義のラベル（既定「ランクC」など）なので、ここで「ランク」を足すと二重になる
    "reward_chart_aria_pace": "。このペースなら{rank}",
    "chart_away": "お出《で》かけ",
    "chart_points": "{points}点《てん》",
    "chart_tooltip_future": "これから",
    # ---- なつやすみのきろく（SummerHistoryGrid.svelte） ----
    "history_title": "夏休《なつやす》みの記録《きろく》",
    "history_streak_current": "れんぞく満点《まんてん》 {days}日《にち》",
    "history_streak_total": "満点《まんてん》 {times}回《かい》",
    "history_streak_best": "さいこう {days}日《にち》",
    "history_hint": "日《ひ》にちをタップすると、前《まえ》の日《ひ》の記録《きろく》を変《か》えられるよ",
    "history_score_row": "点数《てんすう》",
    # ---- 過去日の修正（SummerDayEditModal.svelte） ----
    "day_edit_aria": "記録《きろく》のへんしゅう",
    "day_edit_title": "{date}の記録《きろく》",
    "day_edit_editing": "へんしゅうちゅう",
    "day_edit_button": "へんしゅう",
    "day_edit_away": "お出《で》かけの日《ひ》（{away}）",
    "day_edit_view_only": "記録《きろく》を見《み》ています。なおすときは「へんしゅう」をおしてね。",
    "close": "とじる",
    "close_aria": "とじる",
    # ---- アウトメディア視聴タイマー（SummerMediaTimerChip / Overlay） ----
    "timer_title": "テレビタイマー",
    "timer_watched_today": "今日《きょう》 見《み》た 時間《じかん》",
    # {limit} は子どもごとの上限（media_limit_label() が学年ぶんだけ開いて入れる）
    "timer_over_limit": "{limit}を こえたよ",
    "timer_remaining": "{limit}まで（のこり {left}）",
    "timer_stop": "ストップ（けした）",
    "timer_resume": "さいかい（またつけた）",
    "timer_start": "スタート（つけた）",
    "timer_error_load": "テレビタイマーが よみこめなかったよ",
    "timer_error_start": "スタートできなかったよ",
    "timer_error_pause": "ストップできなかったよ",
    # ---- ストップウォッチ・メモ欄（SummerStopwatch / SummerMetaInputs） ----
    "stopwatch_label": "ストップウォッチ",
    "stopwatch_start": "スタート",
    "stopwatch_stop": "ストップ",
    "unit_minutes": "分《ふん》",
    "unit_seconds": "秒《びょう》",
}


def ui_text_for(grade_level: int, media_limit_minutes: int | None = None) -> dict[str, str]:
    """その学年で表示する固定文言一式（/api/summer/state の ui 欄）.

    media_limit_minutes を渡すと、テレビタイマーの文言に残る {limit} をサーバ側で
    その子の上限へ差し替える。差し替えるのは「更新前に開いたままのタブレット」のため。
    子ども画面は60秒ごとに state を取り直すので、更新直後は古い JS が新しい state を
    受け取る——古い JS は {limit} を知らないので、置換しないと画面に生の「{limit}」が出る
    （card_guide の互換スタブと同じ事情。あちらだけ手当てしても意味がない）。
    新しい JS は fmt() でもう一度 {limit} を差し込もうとするが、既に消えているので no-op。
    引数を省いたときは記法のまま返す（ui_text_snapshot.json の生成はこちら）。
    """
    texts = {
        key: kanji.open_for_grade(text, grade_level, show_from=_SHOW_FROM)
        for key, text in UI_TEXT.items()
    }
    if media_limit_minutes is not None:
        limit = media_limit_label(media_limit_minutes, grade_level)
        texts = {key: text.replace("{limit}", limit) for key, text in texts.items()}
    return texts


# 「分」の助数詞の音便。1の位が 1/3/4/6/8 と、10の倍数（20分＝にじゅっぷん）は「ぷん」。
# 総ルビなので読みは実際に画面へ出るし、小1では漢字ごと かな へ畳まれて本文になる
# （「30ふん」と書かれてしまう）。プリセットの 30分・90分がそのまま該当する。
_PUN_ONES = frozenset({1, 3, 4, 6, 8})


def _minutes_yomi(mins: int) -> str:
    """その分数の「分」の読み（ぷん／ふん）."""
    ones = mins % 10
    if ones in _PUN_ONES or (ones == 0 and mins > 0):
        return "ぷん"
    return "ふん"


def media_limit_label(minutes: int, grade_level: int) -> str:
    """視聴タイマーの上限（分）を、その学年で読める表記にする（例「2時間《じかん》30分《ぷん》」）.

    上限は子どもごとに変えられるので、UI_TEXT のように文言を1本書いておけない。
    ルビ記法で組んでから UI_TEXT と同じ open_for_grade に通す＝配当外の漢字は出ず、
    読みは全学年で同じになる。0分だけは起こらない想定（定義は1以上）だが、
    念のため「0分」を返して空文字にはしない。
    """
    minutes = max(0, int(minutes))
    hours, mins = divmod(minutes, 60)
    parts = []
    if hours:
        parts.append(f"{hours}時間《じかん》")
    if mins or not hours:
        parts.append(f"{mins}分《{_minutes_yomi(mins)}》")
    return kanji.open_for_grade("".join(parts), grade_level, show_from=_SHOW_FROM)
