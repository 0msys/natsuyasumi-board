// 定義パーサの「受理するか」を、バックエンドの敵対的入力スイープと突き合わせる。
//
// サンプル定義の全パスを None / 文字列 / 0 / -1 / true / 1.5 / [] / {} / 削除 …に
// 差し替えた 2,000 件超。比べるのは accepted の真偽だけで、エラー文言は比べない
// （文言はこちらを真実源にする。子どもや親に見せる日本語は TS 側で決める）。
import { expect, test } from 'bun:test';
import { SummerDefinitionError, parseDefinition } from './definition';
import {
	runGolden,
	applyMutation,
	loadGolden,
	loadSampleDoc,
	type GoldenFile,
	type Mutation
} from './golden';
const golden = loadGolden('definition.json');
const sampleDoc = loadSampleDoc();

// 金型に入っているのは定義全文ではなく「サンプル定義のどこをどう壊したか」だけ
// （全文を焼き込むと 2,000 件で数十MBになる）。ここで組み立て直す。
type Input = { mutation: Mutation | null };

runGolden(golden as unknown as GoldenFile<Input, unknown>, '定義パース', (input) => {
	try {
		parseDefinition(applyMutation(sampleDoc, input.mutation));
		return { accepted: true };
	} catch (e) {
		// 契約: 壊れた定義に対して投げるのは SummerDefinitionError だけ。
		// それ以外はパーサ自身のバグなので、握りつぶさずそのまま外へ出す。
		if (e instanceof SummerDefinitionError) return { accepted: false };
		throw e;
	}
});

test('サンプル定義は読めて、主要な欄が入っている', () => {
	const d = parseDefinition(sampleDoc);
	expect(d.child).toBe('はな');
	expect(d.grade_level).toBeGreaterThanOrEqual(1);
	expect(d.habits.length).toBeGreaterThan(0);
	expect(d.rewards.length).toBeGreaterThan(0);
	// 選択宿題の key は「グループ.選択肢」に連結される
	for (const group of d.choice_homework) {
		for (const option of group.options) expect(option.key.startsWith(`${group.key}.`)).toBe(true);
	}
});
