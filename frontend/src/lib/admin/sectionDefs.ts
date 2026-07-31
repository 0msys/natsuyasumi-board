// セクションエディタのタブ定義と、validate issue の path → タブの対応。

export type SectionId =
	| 'basic'
	| 'habits'
	| 'daily'
	| 'practice'
	| 'challenges'
	| 'rewards'
	| 'oneshot'
	| 'choice'
	| 'schoolstart'
	| 'away';

export const SECTIONS: { id: SectionId; label: string }[] = [
	{ id: 'basic', label: 'きほん' },
	{ id: 'habits', label: 'せいかつ' },
	{ id: 'daily', label: 'まいにち' },
	{ id: 'practice', label: 'くりかえし' },
	{ id: 'challenges', label: 'チャレンジ' },
	{ id: 'rewards', label: 'ごほうび' },
	{ id: 'oneshot', label: 'いっかいもの' },
	{ id: 'choice', label: 'えらぶ宿題' },
	{ id: 'schoolstart', label: '新学期' },
	{ id: 'away', label: 'おでかけ' }
];

export function sectionLabel(id: SectionId): string {
	return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** タブへのリンク（同一ページ遷移）。編集中の年を必ず連れて行く.
 *
 * 相対 href の `?...` はクエリを**まるごと置き換える**ので、year を書かないと落ちる。
 * 落ちると load はサーバ既定の年（いま子どもページに出ている年）を読み、2027年ぶんを
 * 直していたのにタブを切り替えた瞬間 2026年ぶんの画面に化ける——しかも同じ URL に
 * 見えるので気づけない。リンクを作る場所は必ずここを通すこと。
 */
export function sectionHref(id: SectionId, year?: number | null): string {
	return `?section=${id}` + (year ? `&year=${year}` : '');
}

/** その遷移が「同じ定義の中のタブ切替」か（＝未保存の変更を持ったまま通してよいか）.
 *
 * 年が変わる遷移は別の定義を開く＝ドラフトが作り直されるので、同一ページでも
 * 離脱ガードを効かせる（黙って編集内容が消えないように）。
 */
export function isSameEditTarget(
	from: URL | null | undefined,
	to: URL | null | undefined,
	editingYear: number | null | undefined
): boolean {
	if (!from || !to || from.pathname !== to.pathname) return false;
	const toYear = to.searchParams.get('year');
	if (toYear !== null) return Number(toYear) === editingYear;
	// 年を書いていない行き先が着くのは「サーバ既定の年」で、それがどの年かは
	// クライアントでは分からない。遷移元も年を書いていなければ同じ既定に着く＝同じ定義。
	// 年を書いていた側から年なしへ戻る（ブラウザの戻る・手打ちの URL）のは別の定義に
	// なりうるので、同じとは言えない＝未保存なら確認する。
	return from.searchParams.get('year') === null;
}

/** validate issue の path（JSON Pointer 風）の先頭区画 → タブ id。全体系（key_dup 等）は null. */
export function sectionForPath(path: string): SectionId | null {
	const head = path.split('/')[1] ?? '';
	switch (head) {
		case 'child':
		case 'child_kana':
		case 'year':
		case 'grade':
		case 'period':
		case 'voice':
			return 'basic';
		case 'habits':
		case 'card_rules':
		case 'media_timer':
			return 'habits';
		case 'daily_homework':
			return 'daily';
		case 'practice_homework':
			return 'practice';
		case 'special_challenges':
			return 'challenges';
		case 'rewards':
			return 'rewards';
		case 'one_shot_homework':
			return 'oneshot';
		case 'choice_homework':
			return 'choice';
		case 'school_start_items':
			return 'schoolstart';
		case 'away':
			return 'away';
		default:
			return null;
	}
}
