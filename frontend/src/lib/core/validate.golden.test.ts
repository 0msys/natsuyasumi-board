// 全件収集バリデータを突き合わせる。
//
// 比べるのは (path, code) の並びと warning の detail まで。メッセージの日本語は
// こちらを真実源にするので比較しない（画面に出るのは lite 側の文言）。
import { expect, test } from 'bun:test';
import { SummerDefinitionError, parseDefinition } from './definition';
import { assignKeys } from './keys';
import { validateDocument } from './validate';
import {
	runGolden,
	applyMutation,
	loadGolden,
	loadSampleDoc,
	type GoldenFile,
	type Mutation
} from './golden';
const golden = loadGolden('validate.json');
const definitionGolden = loadGolden('definition.json');
const sampleDoc = loadSampleDoc();

// 敵対的スイープの件は mutation（サンプル定義の壊しかた）だけ、影響警告の件は doc を直に持つ。
type Input = {
	mutation?: Mutation | null;
	doc?: unknown;
	prevDoc?: Record<string, unknown>;
	usage?: Record<string, number>;
	recordDays?: [string, string];
	today?: string;
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, '定義の検証', (input) => {
	const doc = 'mutation' in input ? applyMutation(sampleDoc, input.mutation) : input.doc;
	const r = validateDocument(doc, {
		prevDoc: input.prevDoc,
		usage: input.usage,
		recordDays: input.recordDays,
		today: input.today
	});
	return {
		ok: r.ok,
		errors: r.errors.map((e) => ({ path: e.path, code: e.code })),
		warnings: r.warnings.map((w) => ({ path: w.path, code: w.code, detail: w.detail ?? {} }))
	};
});

/** 敵対的スイープの doc を、金型の mutation から組み立て直す。 */
const hostileDocs = (): { name: string; doc: unknown }[] =>
	(definitionGolden as { cases: { name: string; input: { mutation: Mutation | null } }[] }).cases.map(
		(c) => ({ name: c.name, doc: applyMutation(sampleDoc, c.input.mutation) })
	);

// 乖離ドリフト防止。パーサが拒む定義は、検証も必ずエラーとして拾えていること。
//
// ここがずれると利用者に逃げ場が無くなる:
//   パーサが緩く検証が厳しい → 取り込めるのに保存できない
//   パーサが厳しく検証が緩い → 保存できたのに子どもの画面が出ない
//
// パーサには保存経路と同じ「採番済み」の doc を渡す。key の欠落は採番前の新規項目
// ＝正常な途中状態なので、検証がそれを許すのは正しい。
test('パーサが拒む定義は、検証もエラーを返す', () => {
	const missed: string[] = [];
	for (const c of hostileDocs()) {
		let rejected = false;
		try {
			// 採番は doc を書き換えるので、下の検証には元のまま渡せるよう写しを使う
			parseDefinition(assignKeys(structuredClone(c.doc) as Record<string, unknown>));
		} catch (e) {
			if (!(e instanceof SummerDefinitionError)) throw e;
			rejected = true;
		}
		if (!rejected) continue;
		if (validateDocument(c.doc).errors.length === 0) missed.push(c.name);
		if (missed.length >= 5) break;
	}
	expect(
		missed,
		'パーサは拒むのに検証が「保存できます」と言う定義がある（保存できたのに子ども画面が出ない）:\n  ' +
			missed.join('\n  ')
	).toEqual([]);
});

// 検証は「保存せず、必ず結果を返す」約束。doc は利用者が貼れる任意の JSON なので、
// 区画が配列でない等で素の例外が出ると、どこが悪いのかを画面に出せなくなる。
test('どんな壊れかたでも、検証は例外を投げず結果を返す', () => {
	const leaks: string[] = [];
	for (const c of hostileDocs()) {
		try {
			validateDocument(c.doc);
		} catch (e) {
			leaks.push(`${c.name} → ${e instanceof Error ? e.message : String(e)}`);
			if (leaks.length >= 5) break;
		}
	}
	expect(leaks, '検証が例外を投げた:\n  ' + leaks.join('\n  ')).toEqual([]);
});

// 採番は検証より前に走るので、ここで落ちると取り込みが「定義が壊れています」ではなく
// 素のエラーになる。
test('壊れた定義でも、キー採番は例外を投げない', () => {
	const leaks: string[] = [];
	for (const c of hostileDocs()) {
		try {
			assignKeys(c.doc as Record<string, unknown>);
		} catch (e) {
			leaks.push(`${c.name} → ${e instanceof Error ? e.message : String(e)}`);
			if (leaks.length >= 5) break;
		}
	}
	expect(leaks, 'キー採番が例外を投げた:\n  ' + leaks.join('\n  ')).toEqual([]);
});
