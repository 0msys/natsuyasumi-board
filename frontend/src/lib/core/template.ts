// 初回ウィザードのテンプレート。backend/app/admin/template.py の移植。
//
// 学年で変わるのは表示文字列だけで、項目キー・構造・ごほうびの閾値は全学年共通
// （＝どの学年で作っても採点の挙動は同じ）。ごほうびの avg は、1日にとれる最大点
// （100 + スペシャルチャレンジ数 × CHALLENGE_POINTS）以内にする——超えると、
// 夏休み中1日も欠かさず全部やっても届かないランクになる。宿題の中身は学校ごとに違うので、
// 標準テンプレートは「生活習慣＋毎日/くりかえしの代表例＋ごほうびランク」だけにして、
// 一回もの・えらぶ宿題・新学期じゅんびは管理画面で足してもらう。
import { MEDIA_LIMIT_MINUTES_DEFAULT, SummerDefinitionError, parseGrade } from './definition';
import { GRADE_MIN, openForGrade } from './kanji';
import { TEMPLATE_LABELS } from './generated/templateLabels';

type Doc = Record<string, unknown>;
export type Period = { start: string; end: string; first_day_of_school: string };

/** 学年表記（小1〜小6）→ その学年で開いた文言表。
 *
 *  読めない学年はいちばんやさしい小1に倒す。壊れた学年はこの先のパースが必ず弾くので、
 *  ここで例外にはしない（テンプレートは常に作れる）。 */
export function labelsFor(grade: string): Record<string, string> {
	let level = GRADE_MIN;
	try {
		[, level] = parseGrade(grade, 'template');
	} catch (e) {
		if (!(e instanceof SummerDefinitionError)) throw e;
	}
	const out: Record<string, string> = {};
	for (const [key, text] of Object.entries(TEMPLATE_LABELS)) out[key] = openForGrade(text, level);
	return out;
}

/** からっぽの定義（区画だけ揃えた最小構成）。 */
export function emptyTemplate(
	child: string,
	childKana: string,
	grade: string,
	year: number,
	period: Period
): Doc {
	return {
		child,
		child_kana: childKana,
		year,
		grade,
		period: { ...period },
		away: [],
		card_rules: { edges_window_days: 5 },
		media_timer: { limit_minutes: MEDIA_LIMIT_MINUTES_DEFAULT },
		habits: [],
		daily_homework: [],
		special_challenges: [],
		rewards: [],
		one_shot_homework: [],
		choice_homework: [],
		school_start_items: []
	};
}

/** 標準テンプレート（はみがき×3・生活習慣・宿題の代表例・ごほうびランク）。 */
export function standardTemplate(
	child: string,
	childKana: string,
	grade: string,
	year: number,
	period: Period
): Doc {
	const doc = emptyTemplate(child, childKana, grade, year, period);
	const t = labelsFor(grade);
	doc.habits = [
		{ key: 'hamigaki_asa', label: t.hamigaki_asa },
		{ key: 'hamigaki_hiru', label: t.hamigaki_hiru },
		{ key: 'hamigaki_yoru', label: t.hamigaki_yoru },
		{ key: 'hayaoki', label: t.hayaoki, window: 'edges' },
		{ key: 'asagohan', label: t.asagohan, window: 'edges' },
		{ key: 'hayane', label: t.hayane, window: 'edges' },
		{ key: 'outmedia', label: t.outmedia, window: 'edges' }
	];
	doc.daily_homework = [
		{
			key: 'ondoku',
			label: t.ondoku,
			meta: [
				{ key: 'book', type: 'text', label: t.ondoku_book, placeholder: t.ondoku_book_ph }
			]
		},
		{ key: 'nikki', label: t.nikki },
		{ key: 'keisan', label: t.keisan },
		{ key: 'drill', label: t.drill }
	];
	doc.special_challenges = [
		{ key: 'otetsudai', label: t.otetsudai },
		{ key: 'undou', label: t.undou }
	];
	// avg（1日の平均点の目安）は、上のチャレンジ2件から決まる1日の上限
	// 100 + CHALLENGE_POINTS × 2 = 150点 の中に収める（validate の rewards_unreachable と同じ規則）。
	// チャレンジを増減させたら、ここも合わせ直すこと。
	doc.rewards = [
		{ key: 'c', label: 'ランクC', avg: 60 },
		{ key: 'b', label: 'ランクB', avg: 90 },
		{ key: 'a', label: 'ランクA', avg: 110 },
		{ key: 's', label: 'ランクS', avg: 130 }
	];
	return doc;
}

export const TEMPLATES = { standard: standardTemplate, empty: emptyTemplate } as const;
