// API 応答の型定義（/api/summer/*・/api/tts/*・/api/admin/*）。

// ── 子どもページ ──
// 日次3値記録: status は 'done'（やった）/'not_done'（やらなかった）/null（未記入）。
export type SummerCheckStatus = 'done' | 'not_done' | 'cancelled' | null;
export type SummerDecision = 'do' | 'skip' | null;

// 日次項目の追加メモ（「やった」日に開く入力欄）。type ごとに描き分ける。
export type SummerMetaFieldType = 'text' | 'choice' | 'duration';
export type SummerMetaOption = { key: string; label: string };
export type SummerMetaField = {
	key: string;
	type: SummerMetaFieldType;
	label: string;
	placeholder: string | null;
	options: SummerMetaOption[]; // choice のときのみ
};
// 保存済みメモ値: { field_key: 値 }（text=文字列・choice=option key・duration=秒）
export type SummerMeta = Record<string, string | number>;

export type SummerHabit = {
	key: string;
	label: string;
	window: string | null; // 'edges'＝初終n日 / 'range'＝window_start〜window_end のみ記録欄
	window_start: string | null;
	window_end: string | null;
	cancelable: boolean; // 中止（雨天等）を記録でき、中止日は満点扱い
	window_active: boolean; // 今日その記録欄があるか
	status: SummerCheckStatus;
};
export type SummerDailyHomework = {
	key: string;
	label: string;
	status: SummerCheckStatus;
	done_days: number;
	meta_fields: SummerMetaField[]; // メモの定義（空なら入力欄なし）
	meta: SummerMeta | null; // 今日の保存済みメモ
};
export type SummerOneShot = {
	key: string;
	label: string;
	type: 'flag' | 'count';
	required: boolean;
	value: number;
	target: number | null;
	done: boolean;
	decision: SummerDecision;
};
export type SummerChoiceOption = {
	key: string;
	label: string;
	category: string | null;
	decision: SummerDecision;
	done: boolean;
};
export type SummerChoiceGroup = {
	key: string;
	label: string;
	min_required: number;
	satisfied: boolean;
	options: SummerChoiceOption[];
};
export type SummerSchoolStartItem = { key: string; label: string; due: string; done: boolean };
export type SummerHistoryDay = {
	day: string;
	weekday: string;
	statuses: Record<string, 'done' | 'not_done' | 'cancelled'>;
	meta: Record<string, SummerMeta>; // item_key ごとの保存済みメモ
	away: string | null;
	edges_window: boolean;
	is_future: boolean;
	is_today: boolean;
	score: number | null; // 日別スコア base(0-100)＝満点Star・ストリークの基準（未来/未記録は null）
	total: number | null; // チャレンジ込みの合計＝グラフ数値・点数スタンプの表示値
};
// 連続満点ストリーク（履歴グリッドのスタンプラリー表示）.
export type SummerStreaks = { perfect_current: number; perfect_best: number; perfect_total: number };
export type SummerScorePart = {
	name: string;
	label: string;
	points: number;
	max_points: number;
	done: number;
	total: number;
};
export type SummerScore = {
	score: number; // base(0-100)＝宿題の満点・満点花火/ストリークの基準
	parts: SummerScorePart[];
	bonus: number; // スペシャルチャレンジの加点（base==100 のときのみ、else 0）
	total: number; // base + bonus＝見出し数字・虹色/王冠の基準
	unlocked: boolean; // base==100＝チャレンジ枠のロック解除
	challenge_done: number;
	challenge_max: number; // 25 × チャレンジ項目数
};
// スペシャルチャレンジ1項目（宿題で100点をとると解放されるごほうび枠）.
export type SummerSpecialChallenge = {
	key: string;
	label: string;
	status: SummerCheckStatus;
	done_days: number;
};
// ごほうびランク1段の当日状態（総積み上げ点数で決まる段位。threshold=avg×日数は導出済み）.
export type SummerRewardRank = {
	key: string;
	label: string;
	avg: number; // 1日平均点の目安（単一真実源）
	threshold: number; // 到達に必要な総積み上げ点数（avg × days_total）
	prize: string | null; // ごほうびの中身（未登録なら null）
	achieved: boolean; // total >= threshold（今日の途中経過を含む）
};
// 総積み上げ点数によるごほうびランクの進捗。定義に rewards が無ければ null.
export type SummerRewards = {
	total: number; // 今日までの積み上げ合計（今日の途中経過を含む）
	cumulative: (number | null)[]; // history と同順同長の積み上げ推移（未来日は null）
	ranks: SummerRewardRank[];
	achieved_key: string | null; // 達成中の最大ランク
	pace_key: string | null; // 完了日ペースで到達見込みの最大ランク
	projected_total: number; // 完了日ペースを期間全体へ引き伸ばした予測総点（今日を除外）
	max_total: number; // score_max × days_total＝y軸上限
};
export type SummerRemaining = { kind: string; key: string; label: string; note: string | null };
// 褒めメッセージ（定型・決定的。サーバの praise.build_praise が組み立てる）.
export type SummerComment = {
	score: number;
	bonus: number;
	total: number;
	band: string;
	text: string;
};
// 画面の固定文言（backend/app/summer/ui_text.py が単一真実源）。
// 学年ごとに漢字の開き具合だけが変わる（読みは全学年で同じ）ので、
// 属性・読み上げは stripRuby() を通せば学年によらず同じかなになる。
export type SummerUiKey =
	| 'header_title'
	| 'period_range'
	| 'period_ended'
	| 'away_today'
	| 'rank_achieved_title'
	| 'rank_achieved_sub'
	| 'rank_achieved_speech'
	| 'celebration_title'
	| 'celebration_sub'
	| 'today_checks_title'
	| 'todo_speech_ask'
	| 'todo_speech_busy'
	| 'section_habits'
	| 'section_daily'
	| 'check_done'
	| 'check_not_done'
	| 'check_cancelled'
	| 'check_cancelled_aria'
	| 'comment_title'
	| 'score_of_max'
	| 'score_homework_label'
	| 'score_challenge_label'
	| 'listen_aria'
	| 'challenge_title'
	| 'challenge_bonus'
	| 'challenge_all'
	| 'challenge_now'
	| 'challenge_locked_hint'
	| 'challenge_locked_overlay'
	| 'school_start_title'
	| 'school_start_done'
	| 'school_start_next'
	| 'school_start_due'
	| 'homework_title'
	| 'homework_progress_days'
	| 'homework_optional'
	| 'homework_done_days_title'
	| 'homework_done_days'
	| 'decide_do'
	| 'decide_skip'
	| 'done_aria'
	| 'count_minus_aria'
	| 'count_plus_aria'
	| 'choice_satisfied'
	| 'choice_unsatisfied'
	| 'reward_title'
	| 'reward_now'
	| 'reward_achieved'
	| 'reward_next'
	| 'reward_pace'
	| 'reward_hint'
	| 'reward_chart_aria'
	| 'reward_chart_aria_pace'
	| 'chart_away'
	| 'chart_points'
	| 'chart_tooltip_future'
	| 'history_title'
	| 'history_streak_current'
	| 'history_streak_total'
	| 'history_streak_best'
	| 'history_hint'
	| 'history_score_row'
	| 'day_edit_aria'
	| 'day_edit_title'
	| 'day_edit_editing'
	| 'day_edit_button'
	| 'day_edit_away'
	| 'day_edit_view_only'
	| 'close'
	| 'close_aria'
	| 'timer_title'
	| 'timer_watched_today'
	| 'timer_over_limit'
	| 'timer_remaining'
	| 'timer_stop'
	| 'timer_resume'
	| 'timer_start'
	| 'timer_error_load'
	| 'timer_error_start'
	| 'timer_error_pause'
	| 'stopwatch_label'
	| 'stopwatch_start'
	| 'stopwatch_stop'
	| 'unit_minutes'
	| 'unit_seconds';
export type SummerUiText = Record<SummerUiKey, string>;
export type SummerState = {
	child: string;
	child_kana: string;
	grade: string; // 小1〜小6
	grade_level: number; // 1〜6（壊れた学年はサーバが弾く）
	ui: SummerUiText; // その学年で表示する固定文言一式
	today: string;
	in_period: boolean;
	period: { start: string; end: string; first_day_of_school: string };
	away_today: string | null;
	away: { start: string; end: string; label: string }[];
	habits: SummerHabit[];
	daily_homework: SummerDailyHomework[];
	special_challenges: SummerSpecialChallenge[];
	rewards: SummerRewards | null; // 定義に rewards が無ければ null＝カード非表示
	score_max: number; // 満点の上限（チャレンジ込み）
	one_shot: SummerOneShot[];
	choice_groups: SummerChoiceGroup[];
	school_start_items: SummerSchoolStartItem[];
	history: SummerHistoryDay[];
	streaks: SummerStreaks;
	today_score: SummerScore | null;
	remaining_today: SummerRemaining[];
	comment: SummerComment | null;
	progress: { days_elapsed: number; days_total: number };
};
// GET /api/summer/todo-speech の戻り（text を /api/tts へ渡して読み上げる）.
export type SummerTodoSpeech = { day: string; text: string; remaining: SummerRemaining[] };
// アウトメディア視聴タイマー（採点と独立・毎日0）。server_now 基準で補間する.
// 上限は子どもごと（定義の media_timer.limit_minutes・既定2時間）。
export type SummerMediaTimerState = {
	child: string;
	day: string;
	running: boolean;
	resumed_at: number | null;
	accumulated_seconds: number;
	elapsed_seconds: number; // accumulated + 走行中区間（server_now 時点）
	server_now: number; // サーバ現在 epoch秒（端末時計のズレ吸収の基準）
	limit_seconds: number; // その子の上限（既定 7200＝2時間）
	limit_label: string; // 上限の表示文字列（学年で開いたルビ記法。例「2時間《じかん》」）
	over_limit: boolean;
};
// GET /api/summer/children の1件（壊れた定義は valid=false・error つき）.
export type ChildInfo = {
	child: string;
	child_kana: string;
	year: number; // いま子どもページに出ている年
	years: number[]; // 登録されている年（複数年ぶん持てる。管理画面の年タブ用）
	grade: string | null;
	period: { start: string; end: string; first_day_of_school: string } | null;
	valid: boolean;
	error: string | null;
	revision: number;
	updated_at: number;
};

// ── TTS（VOICEVOX オプション） ──
// speaker は「その子の声」（child を渡したときはその子の設定。定義に無ければ既定の話者）.
export type TtsStatus = { available: boolean; speaker: number };
// 管理画面の「こえ」えらび用。styles の id が定義に保存する話者ID（読み上げ用のみ）.
// available は VOICEVOX 自体の死活で、一覧だけ取れないとき（available かつ speakers 空）が
// ある。この2つを混ぜると「一覧が引けなかっただけ」を「VOICEVOX が居ない」と誤って案内する。
export type TtsStyle = { id: number; name: string };
export type TtsSpeaker = { name: string; styles: TtsStyle[] };
// supported は「この版に読み上げ機能があるか」。available（VOICEVOX の死活）とは別で、
// lite 版だけが false になる。両方を1つにまとめると、機能ごと無い lite で
// 「VOICEVOX がうごいていません（--profile voice で起動してください）」という
// 嘘の案内が出てしまう（lite に docker は無い）。
export type TtsSpeakers = {
	available: boolean;
	supported?: boolean;
	speakers: TtsSpeaker[];
	default_speaker: number;
};

// ── 管理画面 ──
// admin_disabled: ADMIN_PIN も ADMIN_NO_AUTH も未設定＝管理 API が丸ごと無効。
// pin_required=false かつ authenticated=false なので、この旗が無いと「PIN 不要で入れる」と
// 誤読して管理 UI を出してしまう（保存時にだけ 403 になる）。
export type AdminSession = { pin_required: boolean; authenticated: boolean; admin_disabled: boolean };
// 編集用ドキュメント（サーバの JSON をそのまま持つ。key は自動採番・UI には出さない）.
export type AdminDocument = Record<string, unknown>;
export type AdminDefinitionEntry = {
	child: string;
	year: number; // 編集中の年
	years: number[];
	revision: number;
	updated_at: number;
	doc: AdminDocument;
};
export type ValidationIssue = {
	path: string; // JSON Pointer 風（例 /habits/2/label）。フォームの該当欄にアンカーする
	code: string;
	message: string;
	detail?: Record<string, unknown>;
};
export type ValidationResult = { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };
// GET /api/admin/kanji（学年→配当漢字の文字列）。フロントのライブ lint 用.
export type KanjiGrades = { grades: Record<string, string> };
