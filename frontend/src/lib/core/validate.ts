// 定義ドキュメントの全件収集バリデータ（管理画面の UX 層）。
// backend/app/admin/validate.py の移植。
//
// parseDefinition（最終ゲート）は最初のエラーで投げるが、こちらは全部の問題を path つきで
// 集めて返す＝フォームの該当欄にアンカーできる。「parseDefinition が拒むものは
// こちらも必ず検出する」ことをテストが恒常検査する（乖離ドリフト防止）。
//
//   errors   … 保存できない
//   warnings … 保存はできるが利用者に見せる（配当外漢字・期間中の追加・記録つき削除・
//              どうやっても届かないごほうびなど）
import { isDay, type DayString } from './dates';
import {
	EDGES_WINDOW_DAYS_DEFAULT,
	EDGES_WINDOW_DAYS_MAX,
	MEDIA_LIMIT_MINUTES_DEFAULT,
	MEDIA_LIMIT_MINUTES_MAX,
	intLike,
	isText,
	migrateDoc
} from './definition';
import { dayScoreMax } from './judge';
import { gradeOf, nameExceptionsFor, nonconformingKanji } from './kanji';

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6'];
const WINDOWS = ['edges', 'range'];
const META_TYPES = ['text', 'choice', 'duration'];

export type Issue = {
	path: string;
	code: string;
	message: string;
	detail?: Record<string, unknown>;
};
export type ValidationResult = { ok: boolean; errors: Issue[]; warnings: Issue[] };

type Doc = Record<string, unknown>;
const isMap = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 配列として取り出す（配列でなければ空）。キー収集など、報告しない場所で使う。 */
const asList = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);

export function validateDocument(
	doc: unknown,
	opts: {
		prevDoc?: Doc | null;
		usage?: Record<string, number> | null;
		recordDays?: [DayString, DayString] | null;
		today?: DayString | null;
	} = {}
): ValidationResult {
	const errors: Issue[] = [];
	const warnings: Issue[] = [];
	const err = (path: string, code: string, message: string) =>
		errors.push({ path, code, message });
	const warn = (path: string, code: string, message: string, detail: Record<string, unknown> = {}) =>
		warnings.push({ path, code, message, detail });

	if (!isMap(doc)) {
		return {
			ok: false,
			errors: [{ path: '', code: 'type', message: '定義がマップではありません' }],
			warnings: []
		};
	}
	// 旧形式（practice_homework）の取り込み JSON を新形式で検査する（parseDefinition と同じ畳み方）
	migrateDoc(doc);
	if (opts.prevDoc) migrateDoc(opts.prevDoc);

	/** 区画を「項目の配列」として取り出す。配列でなければ errors に積んで空を返す。
	 *  ここで弾かないと下のループが素の例外で落ちる＝「常に結果を返す」はずの検証が壊れる。 */
	const entries = (raw: unknown, path: string): unknown[] => {
		if (raw === undefined || raw === null) return [];
		if (!Array.isArray(raw)) {
			err(path, 'type', '項目の配列で書いてください');
			return [];
		}
		return raw;
	};

	const checkDate = (data: Doc, key: string, path: string, required = true): DayString | null => {
		const value = data[key];
		if (value === undefined || value === null) {
			if (required) err(`${path}/${key}`, 'required', '日付を入れてください');
			return null;
		}
		if (typeof value !== 'string' || !isDay(value)) {
			err(`${path}/${key}`, 'date_format', '日付（YYYY-MM-DD）で書いてください');
			return null;
		}
		return value;
	};

	// ---- 基本情報 ----
	const child = doc.child;
	if (!isText(child)) err('/child', 'required', '名前を入れてください');
	const year = doc.year;
	if (year === undefined || year === null) err('/year', 'required', '年（西暦）がありません');
	else if (intLike(year) === null) err('/year', 'type', '年は数字で入れてください');

	let gradeLevel: number | null = null;
	const grade = doc.grade;
	if (typeof grade !== 'string' || !GRADES.includes(grade)) {
		err('/grade', 'grade', '学年は 小1〜小6 からえらんでください');
	} else {
		gradeLevel = Number(grade[1]);
	}
	const nameExceptions = nameExceptionsFor(typeof child === 'string' ? child : '');

	/** 表示文字列の配当外漢字を warning に積む（学年が壊れているときは見ない）。 */
	const lintKanji = (text: unknown, path: string) => {
		if (gradeLevel === null || typeof text !== 'string' || !text) return;
		const bad = nonconformingKanji(text, gradeLevel, nameExceptions);
		if (!bad.size) return;
		const chars = [...bad].sort();
		const grades: Record<string, number | null> = {};
		const parts: string[] = [];
		for (const c of chars) {
			const g = gradeOf(c);
			grades[c] = g;
			parts.push(g ? `「${c}」（${g}年生でならう）` : `「${c}」（小学校ではならわない）`);
		}
		warn(path, 'kanji_grade', 'まだならっていない漢字があります: ' + parts.join('、'), {
			chars,
			grades
		});
	};

	// ---- 期間 ----
	let start: DayString | null = null;
	let end: DayString | null = null;
	const period = doc.period;
	if (!isMap(period)) {
		err('/period', 'required', '期間を入れてください');
	} else {
		start = checkDate(period, 'start', '/period');
		end = checkDate(period, 'end', '/period');
		const firstDay = checkDate(period, 'first_day_of_school', '/period');
		if (start && end && firstDay && !(start < end && end < firstDay)) {
			err('/period', 'period_order', 'はじまり < おわり < 始業式 の順にしてください');
		}
	}

	// ---- おでかけ ----
	entries(doc.away, '/away').forEach((entry, i) => {
		const path = `/away/${i}`;
		if (!isMap(entry)) {
			err(path, 'type', 'おでかけの項目が壊れています');
			return;
		}
		const aStart = checkDate(entry, 'start', path);
		const aEnd = checkDate(entry, 'end', path);
		if (aStart && aEnd && aStart > aEnd) {
			err(path, 'period_order', 'はじまりがおわりより後になっています');
		}
		if (!isText(entry.label)) {
			err(`${path}/label`, 'required', '名前（例: おばあちゃんのいえ）を入れてください');
		}
		lintKanji(entry.label, `${path}/label`);
	});

	// ---- カード規則（「はじめとおわりだけ」の記録欄の日数） ----
	const card = doc.card_rules;
	if (card !== undefined && card !== null && !isMap(card)) {
		err('/card_rules', 'type', 'カードの設定が壊れています');
	} else if (isMap(card)) {
		const raw = 'edges_window_days' in card ? card.edges_window_days : EDGES_WINDOW_DAYS_DEFAULT;
		const edgesDays = intLike(raw);
		if (edgesDays === null || edgesDays < 1 || edgesDays > EDGES_WINDOW_DAYS_MAX) {
			err(
				'/card_rules/edges_window_days',
				'type',
				`日数は 1〜${EDGES_WINDOW_DAYS_MAX} の整数で入れてください`
			);
		}
	}

	// ---- 読み上げの声 ----
	const voice = doc.voice;
	if (voice !== undefined && voice !== null && !isMap(voice)) {
		err('/voice', 'type', 'こえの設定が壊れています');
	} else if (isMap(voice)) {
		const speaker = voice.speaker;
		if (typeof speaker !== 'number' || !Number.isInteger(speaker) || speaker < 0) {
			err('/voice/speaker', 'voice_speaker', 'こえは一覧からえらんでください');
		}
	}

	// ---- テレビタイマー ----
	const media = doc.media_timer;
	if (media !== undefined && media !== null && !isMap(media)) {
		err('/media_timer', 'type', 'テレビタイマーの設定が壊れています');
	} else if (isMap(media)) {
		const limit = 'limit_minutes' in media ? media.limit_minutes : MEDIA_LIMIT_MINUTES_DEFAULT;
		if (
			typeof limit !== 'number' ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > MEDIA_LIMIT_MINUTES_MAX
		) {
			err(
				'/media_timer/limit_minutes',
				'media_limit',
				`テレビの時間は 1〜${MEDIA_LIMIT_MINUTES_MAX}分 のあいだで入れてください`
			);
		}
	}

	// ---- 日次セクション（habits / daily / challenges） ----
	const checkDailyItems = (section: string) => {
		entries(doc[section], `/${section}`).forEach((item, i) => {
			const path = `/${section}/${i}`;
			if (!isMap(item)) {
				err(path, 'type', '項目が壊れています');
				return;
			}
			if (!isText(item.label)) err(`${path}/label`, 'required', '名前を入れてください');
			lintKanji(item.label, `${path}/label`);
			const window = item.window;
			if (window !== undefined && window !== null && !WINDOWS.includes(String(window))) {
				err(`${path}/window`, 'window', `window は ${WINDOWS.join('/')} のいずれかです`);
			}
			if (window === 'range') {
				const wStart = checkDate(item, 'window_start', path);
				const wEnd = checkDate(item, 'window_end', path);
				if (wStart && wEnd && wStart > wEnd) {
					err(path, 'window_order', 'きかんのはじまりがおわりより後になっています');
				}
			}
			const metaKeys: string[] = [];
			entries(item.meta, `${path}/meta`).forEach((field, j) => {
				const fpath = `${path}/meta/${j}`;
				if (!isMap(field)) {
					err(fpath, 'type', 'メモ欄の定義が壊れています');
					return;
				}
				if (field.key) metaKeys.push(String(field.key));
				const ftype = field.type;
				if (typeof ftype !== 'string' || !META_TYPES.includes(ftype)) {
					err(`${fpath}/type`, 'meta_type', `メモの種類は ${META_TYPES.join('/')} のいずれかです`);
				}
				if (ftype === 'choice') {
					const options = entries(field.options, `${fpath}/options`);
					if (!options.length) {
						err(`${fpath}/options`, 'meta_options', 'えらぶ式のメモには選択肢が必要です');
					}
					options.forEach((opt, k) => {
						if (!isMap(opt) || !isText(opt.label)) {
							err(`${fpath}/options/${k}`, 'meta_options', '選択肢に名前が必要です');
						} else {
							lintKanji(opt.label, `${fpath}/options/${k}/label`);
						}
					});
				}
				if ('label' in field && !isText(field.label)) {
					err(`${fpath}/label`, 'required', 'メモ欄の名前を入れてください');
				}
				lintKanji(field.label, `${fpath}/label`);
				lintKanji(field.placeholder, `${fpath}/placeholder`);
			});
			if (metaKeys.length !== new Set(metaKeys).size) {
				err(`${path}/meta`, 'key_dup', 'メモ欄の key が重複しています');
			}
		});
	};
	for (const section of ['habits', 'daily_homework', 'special_challenges']) {
		checkDailyItems(section);
	}

	// ---- 採点区分が空（judge.dailyScore の配点50+50が片肺になる） ----
	// 空の区分は0点固定。片方が空なら満点が50点になり、両方空なら0点から動かない。
	// どちらも満点スタンプもれんぞく満点もスペシャルチャレンジの加点も永久に出ない。
	// 「相手の区分に項目がある」を条件にしていたころは、いちばん警告が要る両方空
	// ——初回ウィザードの「からっぽ」で作った直後——だけが素通りしていた（issue #34）。
	// 区分ごとに1本ずつ出す＝画面のタブ別件数と、該当タブへのリンクがそのまま効く。
	for (const [section, label] of [
		['habits', 'せいかつ'],
		['daily_homework', 'しゅくだい']
	]) {
		if (asList(doc[section]).length === 0) {
			warn(
				`/${section}`,
				'empty_score_section',
				`「${label}」の項目が1つもないと、どんなにがんばっても100点になりません` +
					'（満点のスタンプ・れんぞく満点・スペシャルチャレンジの加点が出なくなります）'
			);
		}
	}

	// ---- 一回もの ----
	entries(doc.one_shot_homework, '/one_shot_homework').forEach((item, i) => {
		const path = `/one_shot_homework/${i}`;
		if (!isMap(item)) {
			err(path, 'type', '項目が壊れています');
			return;
		}
		if (!isText(item.label)) err(`${path}/label`, 'required', '名前を入れてください');
		lintKanji(item.label, `${path}/label`);
		const itemType = 'type' in item ? item.type : 'flag';
		if (itemType !== 'flag' && itemType !== 'count') {
			err(`${path}/type`, 'one_shot_type', 'しゅるいは flag か count です');
		}
		if (itemType === 'count') {
			const target = item.target;
			if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
				err(`${path}/target`, 'target', '目標の数は1以上の整数で入れてください');
			}
		}
	});

	// ---- 選択宿題 ----
	entries(doc.choice_homework, '/choice_homework').forEach((group, i) => {
		const path = `/choice_homework/${i}`;
		if (!isMap(group)) {
			err(path, 'type', 'グループが壊れています');
			return;
		}
		if (!isText(group.label)) err(`${path}/label`, 'required', 'グループの名前を入れてください');
		lintKanji(group.label, `${path}/label`);
		const options = entries(group.options, `${path}/options`);
		if (!options.length) err(`${path}/options`, 'required', '選択肢を1つ以上入れてください');
		options.forEach((opt, j) => {
			const opath = `${path}/options/${j}`;
			if (!isMap(opt) || !isText(opt.label)) {
				err(`${opath}/label`, 'required', '選択肢の名前を入れてください');
				return;
			}
			lintKanji(opt.label, `${opath}/label`);
			lintKanji(opt.category, `${opath}/category`);
		});
		const minRequired = intLike('min_required' in group ? group.min_required : 1);
		if (minRequired === null) {
			err(`${path}/min_required`, 'min_required', 'さいてい数は整数で入れてください');
		} else if (options.length && (minRequired < 1 || minRequired > options.length)) {
			err(`${path}/min_required`, 'min_required', `さいてい数は 1〜${options.length} にしてください`);
		}
	});

	// ---- 新学期じゅんび ----
	entries(doc.school_start_items, '/school_start_items').forEach((item, i) => {
		const path = `/school_start_items/${i}`;
		if (!isMap(item)) {
			err(path, 'type', '項目が壊れています');
			return;
		}
		if (!isText(item.label)) err(`${path}/label`, 'required', '名前を入れてください');
		lintKanji(item.label, `${path}/label`);
		checkDate(item, 'due', path);
	});

	// ---- ごほうびランク ----
	// 1日にとれる最大点。画面（buildState）と同じ dayScoreMax を使う——空の区分は0点固定で
	// ボーナスも付かないので、片方でも空なら1日50点が上限。ここだけ 100+チャレンジ で決め打つと、
	// しゅくだいが空の定義で avg 80 のランクが「届かないのに無警告」になり、画面の
	// 「全部できたら◯点」とも食い違う。
	//
	// ランクの到達点は avg × 日数、上限は scoreMax × 日数で日数が両辺に等しくかかるので、
	// 1日あたりで比べれば足りる＝期間が壊れていても判定できる。
	// これは上限値なので「必ず届かない」ものだけを拾う（見逃しは許すが、誤検知は出さない）。
	const scoreMax = dayScoreMax(
		asList(doc.habits).length,
		asList(doc.daily_homework).length,
		asList(doc.special_challenges).length
	);
	let prevAvg: number | null = null;
	const rewardKeys: string[] = [];
	entries(doc.rewards, '/rewards').forEach((rank, i) => {
		const path = `/rewards/${i}`;
		if (!isMap(rank)) {
			err(path, 'type', 'ランクが壊れています');
			return;
		}
		if (rank.key) rewardKeys.push(String(rank.key));
		if (!isText(rank.label)) err(`${path}/label`, 'required', 'ランクの名前を入れてください');
		lintKanji(rank.label, `${path}/label`);
		lintKanji(rank.prize, `${path}/prize`);
		const avg = rank.avg;
		if (typeof avg !== 'number' || !Number.isInteger(avg) || avg <= 0) {
			err(`${path}/avg`, 'rewards_avg', '1日の平均点は1以上の整数で入れてください');
			return;
		}
		if (prevAvg !== null && avg <= prevAvg) {
			err(`${path}/avg`, 'rewards_order', 'ランクは平均点の小さい→大きい順にしてください');
		}
		prevAvg = avg;
		// ちょうど scoreMax（＝全日満点で到達）は正当な設計なので鳴らさない。超えたときだけ。
		if (avg > scoreMax) {
			warn(
				`${path}/avg`,
				'rewards_unreachable',
				`1日にとれるのは最大${scoreMax}点なので、平均${avg}点のこのランクは` +
					'毎日ぜんぶできても届きません' +
					'（平均点を下げるか、せいかつ・しゅくだい・スペシャルチャレンジの項目を見直してください）',
				{ avg, score_max: scoreMax }
			);
		}
	});
	if (rewardKeys.length !== new Set(rewardKeys).size) {
		err('/rewards', 'key_dup', 'ランクの key が重複しています');
	}

	// ---- キー一意性（日次系と flags 系は別空間） ----
	const DAILY_SECTIONS = ['habits', 'daily_homework', 'special_challenges'];
	const dailyKeys: string[] = [];
	for (const section of DAILY_SECTIONS) {
		for (const item of asList(doc[section])) {
			if (isMap(item) && item.key) dailyKeys.push(String(item.key));
		}
	}
	if (dailyKeys.length !== new Set(dailyKeys).size) {
		err('', 'key_dup_daily', '習慣・宿題・チャレンジの key が重複しています');
	}
	const flagKeys: string[] = [];
	for (const section of ['one_shot_homework', 'school_start_items']) {
		for (const item of asList(doc[section])) {
			if (isMap(item) && item.key) flagKeys.push(String(item.key));
		}
	}
	for (const group of asList(doc.choice_homework)) {
		if (!isMap(group)) continue;
		const gkey = group.key;
		for (const opt of asList(group.options)) {
			if (isMap(opt) && opt.key && gkey) flagKeys.push(`${String(gkey)}.${String(opt.key)}`);
		}
	}
	if (flagKeys.length !== new Set(flagKeys).size) {
		err('', 'key_dup_flags', '一回もの・じゅんび・選択肢の key が重複しています');
	}

	// ---- 影響警告（過去の点数の見え方が変わる操作） ----
	const { prevDoc, usage, recordDays, today } = opts;
	if (prevDoc && today && start && end && start <= today && today <= end) {
		// 期間中の分母追加（daily は全過去日、habits は窓次第だがまとめて警告）
		const prevKeys = sectionKeys(prevDoc, ['habits', 'daily_homework']);
		for (const section of ['habits', 'daily_homework']) {
			asList(doc[section]).forEach((item, i) => {
				// key が空＝採番前の新規項目も「期間中の追加」なので警告する
				if (isMap(item) && (!item.key || !prevKeys.has(String(item.key)))) {
					warn(
						`/${section}/${i}`,
						'mid_period_add',
						'きかんの途中で足すと、前の日の点数が下がって見えます（きかん限定にできる習慣なら「きかん」を使ってください）'
					);
				}
			});
		}
	}
	if (prevDoc && usage && Object.keys(usage).length) {
		const newDaily = sectionKeys(doc, DAILY_SECTIONS);
		const newFlags = flagSpaceKeys(doc);
		const prevDaily = sectionKeys(prevDoc, DAILY_SECTIONS);
		const prevFlags = flagSpaceKeys(prevDoc);
		const removed = [
			...[...prevDaily].filter((k) => !newDaily.has(k)),
			...[...prevFlags].filter((k) => !newFlags.has(k))
		].sort();
		for (const key of removed) {
			const count = usage[key] ?? 0;
			if (count > 0) {
				warn(
					'',
					'delete_with_records',
					`けした項目に ${count}件の記録があります。記録は消えませんが、過去の点数が上がって見えます`,
					{ key, count }
				);
			}
		}
	}
	if (recordDays && start && end) {
		const [minDay, maxDay] = recordDays;
		if (minDay < start || maxDay > end) {
			warn(
				'/period',
				'records_outside_period',
				'新しいきかんの外に記録があります（画面には出なくなりますが、記録は消えません）',
				{ min_day: minDay, max_day: maxDay }
			);
		}
	}

	return { ok: errors.length === 0, errors, warnings };
}

function sectionKeys(doc: Doc, sections: readonly string[]): Set<string> {
	const keys = new Set<string>();
	for (const section of sections) {
		for (const item of asList(doc[section])) {
			if (isMap(item) && item.key) keys.add(String(item.key));
		}
	}
	return keys;
}

function flagSpaceKeys(doc: Doc): Set<string> {
	const keys = sectionKeys(doc, ['one_shot_homework', 'school_start_items']);
	for (const group of asList(doc.choice_homework)) {
		if (!isMap(group)) continue;
		const gkey = group.key;
		for (const opt of asList(group.options)) {
			if (isMap(opt) && opt.key && gkey) keys.add(`${String(gkey)}.${String(opt.key)}`);
		}
	}
	return keys;
}
