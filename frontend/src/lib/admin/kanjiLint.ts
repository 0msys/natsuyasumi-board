// 学年配当漢字のライブ lint（/api/admin/kanji を初回1回だけ取得してモジュールにキャッシュ）。
// 判定基準はサーバ validate（backend/app/summer/kanji.py）と同じ:
//   - 《よみ》注記と ｜ だけを除去し、基底の漢字は残して走査する
//     （$lib/summer/ruby の stripRuby はよみ側へ畳むので使わない＝ルビを付けても配当外は配当外）
//   - その学年まで（1..gradeLevel の累積）＋名前の字 以外の漢字を報告する
import { api } from '$lib/api';

export type KanjiHit = { char: string; grade: number | null };

let gradeMap: Map<string, number> | null = null;
let pending: Promise<void> | null = null;

/** 配当表を1回だけ取得する（失敗時は次回呼び出しで再試行）. */
export function ensureKanjiGrades(): Promise<void> {
	if (gradeMap) return Promise.resolve();
	if (!pending) {
		pending = api
			.adminKanji()
			.then((res) => {
				const map = new Map<string, number>();
				for (const [grade, chars] of Object.entries(res.grades)) {
					const n = Number(grade);
					for (const ch of chars) map.set(ch, n);
				}
				gradeMap = map;
			})
			.catch(() => {
				pending = null;
			});
	}
	return pending;
}

const KANJI_RE = /[㐀-鿿々〆〇ヶ]/;
const RUBY_NOTE_RE = /《[^》]*》/g;

/**
 * 配当外漢字を返す（配当表が未取得・学年が壊れているときは空＝lint オフ）。
 * nameExceptions は子どもの名前（含まれる漢字は学年に関係なく許可）。
 */
export function lintText(text: string, gradeLevel: number, nameExceptions: string): KanjiHit[] {
	if (!gradeMap || !text || gradeLevel < 1) return [];
	const exceptions = new Set(nameExceptions);
	const seen = new Set<string>();
	const hits: KanjiHit[] = [];
	for (const ch of text.replace(RUBY_NOTE_RE, '').replace(/｜/g, '')) {
		if (!KANJI_RE.test(ch) || seen.has(ch) || exceptions.has(ch)) continue;
		seen.add(ch);
		const grade = gradeMap.get(ch) ?? null;
		if (grade !== null && grade <= gradeLevel) continue;
		hits.push({ char: ch, grade });
	}
	return hits;
}
