// 学年別漢字配当と「その学年で読める形に開く」処理。
// backend/app/summer/kanji.py の移植（配当表そのものは generated/kanjiTable.ts）。
//
// 方針: 文言は「最大漢字＋総ルビ」で1回だけ書き、学年ごとの表示は openForGrade() が導く。
// ルビ単位に1字でも未習の漢字が入っていれば、その単位ごと よみ（かな）へ畳む。
//   例: 新学期《しんがっき》のじゅんび → 小1・小2「しんがっきのじゅんび」/ 小3〜「新学期《しんがっき》…」
// 単位ごと畳むのが要で、字ごとに畳むと「音どく」「日き」のような交ぜ書きになる。
import { GRADE_KANJI_SOURCE } from './generated/kanjiTable';
import { KANJI, parseRuby, stripRubyMarkup } from './ruby';

export const GRADE_MIN = 1;
export const GRADE_MAX = 6;

/** 学年 → その学年で習う漢字の集合（累積ではない）。 */
export const GRADE_KANJI: ReadonlyMap<number, ReadonlySet<string>> = new Map(
	GRADE_KANJI_SOURCE.map((chars, i) => [i + 1, new Set(chars)] as const)
);

// 学年までの累積集合は毎回作ると無駄なので覚えておく（名前例外が無い素の場合だけ）。
const cumulative = new Map<number, ReadonlySet<string>>();

function cumulativeFor(grade: number): ReadonlySet<string> {
	const g = Math.min(Math.max(grade, GRADE_MIN), GRADE_MAX);
	const hit = cumulative.get(g);
	if (hit) return hit;
	const set = new Set<string>();
	for (let i = GRADE_MIN; i <= g; i++) for (const ch of GRADE_KANJI.get(i)!) set.add(ch);
	cumulative.set(g, set);
	return set;
}

/** その学年までに習う漢字＋名前例外（自分の名前の字は学年に関係なく許可）。 */
export function allowedForGrade(
	grade: number,
	nameExceptions: ReadonlySet<string> = new Set()
): ReadonlySet<string> {
	if (nameExceptions.size === 0) return cumulativeFor(grade);
	return new Set([...cumulativeFor(grade), ...nameExceptions]);
}

/** 子どもの名前に含まれる漢字（配当外でも表示・警告除外の対象にする）。 */
export const nameExceptionsFor = (name: string): ReadonlySet<string> =>
	new Set([...name].filter((ch) => KANJI.test(ch)));

/** 表示テキスト中の「配当外」の漢字（空なら適合）。ルビを除いた基底だけを見る。 */
export function nonconformingKanji(
	text: string,
	grade: number,
	nameExceptions: ReadonlySet<string> = new Set()
): Set<string> {
	const allowed = allowedForGrade(grade, nameExceptions);
	const out = new Set<string>();
	for (const ch of stripRubyMarkup(text)) {
		if (KANJI.test(ch) && !allowed.has(ch)) out.add(ch);
	}
	return out;
}

/** 1字の配当学年（1〜6）。配当外なら null。 */
export function gradeOf(kanji: string): number | null {
	for (let g = GRADE_MIN; g <= GRADE_MAX; g++) {
		if (GRADE_KANJI.get(g)!.has(kanji)) return g;
	}
	return null;
}

// ---- 学年帯（褒めメッセージの「口調」の単位） ----
// 漢字の開き具合は学年ごと（openForGrade）に決まるので、帯は配当の基準ではない。
// 残っているのは「小1-2 にはやさしく短く、小5-6 には少し大人びた言い回しで」という
// 語り口の切り替えのため。
export const GRADE_BANDS: Record<string, readonly [number, number]> = {
	low: [1, 2],
	mid: [3, 4],
	high: [5, 6]
};

/** 学年（1〜6）→ 口調の帯（low/mid/high）。 */
export function gradeBand(gradeLevel: number): string {
	for (const [band, [lo, hi]] of Object.entries(GRADE_BANDS)) {
		if (lo <= gradeLevel && gradeLevel <= hi) return band;
	}
	return gradeLevel > GRADE_MAX ? 'high' : 'low';
}

// 繰り返し記号。直前の漢字を繰り返すので、配当判定は直前の字に肩代わりさせる
// （どの配当にも入っていないため、素直に判定すると「時々」が小6でも開いてしまう）。
const ITERATION_MARK = '々';

/** このルビ単位を、その学年で漢字のまま出してよいか（1字でも駄目なら単位ごと不可）。 */
function baseShownAt(
	base: string,
	grade: number,
	allowed: ReadonlySet<string>,
	showFrom: Record<string, number>
): boolean {
	let prev = '';
	for (const ch of base) {
		const target = ch === ITERATION_MARK ? prev : ch;
		if (!target || !KANJI.test(target)) return false; // 基底にかなが混ざる等の壊れた形
		if (!allowed.has(target)) return false;
		if (grade < (showFrom[target] ?? 0)) return false; // 配当上は出せるが語として出したくない字
		prev = target;
	}
	return true;
}

/**
 * その学年でまだ読めない漢字を含むルビ単位を、よみ（かな）へ畳む。
 *
 * 配当外の漢字は構成上いっさい出ない。配当内を漢字で出すかは、ルビの区切りかた
 * （＝どこを1単位にしたか）と showFrom の個別指定で決まる。
 */
export function openForGrade(
	text: string,
	grade: number,
	opts: { nameExceptions?: ReadonlySet<string>; showFrom?: Record<string, number> } = {}
): string {
	const allowed = allowedForGrade(grade, opts.nameExceptions);
	const showFrom = opts.showFrom ?? {};
	let out = '';
	for (const seg of parseRuby(text)) {
		if (seg.kind === 'text') out += seg.text;
		else if (baseShownAt(seg.base, grade, allowed, showFrom)) out += `${seg.base}《${seg.rt}》`;
		else out += seg.rt;
	}
	return out;
}

const KANA_ONLY = /^[ぁ-んァ-ヴーゝゞ]+$/;

/**
 * コード定数用の厳格検証。違反理由を並べて返す（空なら適合）。
 *
 * 画面表示と親が入れた定義データは寛容パースのままにする（壊さない方針）。
 * ここで縛るのは openForGrade() に通す「アプリが用意した文言」だけ。
 */
export function validateRubySource(text: string): string[] {
	const problems: string[] = [];
	if (text.includes('｜')) problems.push('｜ は使わない（基底は漢字だけにする）');
	const opens = (text.match(/《/g) ?? []).length;
	const closes = (text.match(/》/g) ?? []).length;
	if (opens !== closes) problems.push('《》 の対応が取れていない');

	for (const seg of parseRuby(text)) {
		if (seg.kind === 'text') {
			if (seg.text.includes('《') || seg.text.includes('》')) {
				problems.push(`ルビにならない《》がある: ${JSON.stringify(seg.text)}`);
			}
			const bare = [...new Set([...seg.text].filter((ch) => KANJI.test(ch)))].sort();
			if (bare.length) problems.push(`ルビの付いていない漢字がある: ${bare.join('')}`);
			continue;
		}
		if (!seg.rt) problems.push(`よみが空: ${JSON.stringify(seg.base)}《》`);
		else if (!KANA_ONLY.test(seg.rt)) problems.push(`よみがかなだけでない: ${seg.base}《${seg.rt}》`);
		for (const ch of seg.base) {
			if (ch !== ITERATION_MARK && !KANJI.test(ch)) {
				problems.push(`基底に漢字以外がある: ${seg.base}《${seg.rt}》`);
				break;
			}
		}
	}
	return problems;
}
