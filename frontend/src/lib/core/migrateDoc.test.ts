// 旧形式（practice_homework＝くりかえしの宿題）の畳み込み。
//
// ゴールデンは新形式の doc しか通らないので（サンプル定義から practice_homework は消えた）、
// 旧形式の取り込みはここで押さえる。backend/tests/test_admin_store.py の
// test_assign_keys_旧形式のくりかえし宿題はまいにちへ畳まれキーは変わらない と対になる。
import { describe, expect, it } from 'bun:test';
import { SummerDefinitionError, migrateDoc, parseDefinition } from './definition';
import { assignKeys } from './keys';
import { loadSampleDoc } from './golden';

describe('旧形式の practice_homework', () => {
	it('daily_homework の後ろへ、key を変えずに移る', () => {
		const doc = migrateDoc({
			daily_homework: [{ key: 'dh_ondoku', label: 'おんどく' }],
			practice_homework: [{ key: 'ph_keisan', label: 'けいさん' }]
		});

		expect('practice_homework' in doc).toBe(false);
		// key が記録の同一性そのもの。ここが変わると過去のチェックが切れる。
		expect(doc.daily_homework).toEqual([
			{ key: 'dh_ondoku', label: 'おんどく' },
			{ key: 'ph_keisan', label: 'けいさん' }
		]);
	});

	it('daily_homework が無くても落ちない', () => {
		const doc: Record<string, unknown> = {
			practice_homework: [{ key: 'ph_keisan', label: 'けいさん' }]
		};
		expect(migrateDoc(doc)).toEqual({
			daily_homework: [{ key: 'ph_keisan', label: 'けいさん' }]
		});
	});

	it('空・欠落のときはキーだけ落として何も移さない', () => {
		const fold = (doc: Record<string, unknown>) => migrateDoc(doc);
		expect(fold({ daily_homework: [], practice_homework: [] })).toEqual({ daily_homework: [] });
		expect(fold({ daily_homework: [] })).toEqual({ daily_homework: [] });
		// null は「キーが無い」と同じ扱い（asEntries と揃える）
		expect(fold({ daily_homework: [], practice_homework: null })).toEqual({ daily_homework: [] });
	});

	it('畳めない形は黙って捨てず、いつもの検証エラーにする', () => {
		// 統合前は「項目の配列で書いてください」で弾かれていた。畳むついでに落とすと、
		// 手書き JSON の書き損じが「宿題がまるごと消えた定義」として保存できてしまう。
		for (const broken of ['もじ', { key: 'x' }, 0, true]) {
			const doc = loadSampleDoc() as Record<string, unknown>;
			doc.practice_homework = broken;
			expect(() => parseDefinition(doc)).toThrow(SummerDefinitionError);
		}
	});

	it('畳み先（daily_homework）が壊れていても弾く', () => {
		const doc = loadSampleDoc() as Record<string, unknown>;
		doc.daily_homework = 'もじ';
		doc.practice_homework = [{ key: 'ph_a', label: 'あ' }];
		expect(() => parseDefinition(doc)).toThrow(SummerDefinitionError);
	});

	it('採番も畳んだあとに走る（新規項目は daily の接頭辞）', () => {
		const doc = assignKeys({
			daily_homework: [{ key: 'dh_ondoku', label: 'おんどく' }],
			practice_homework: [{ key: 'ph_keisan', label: 'けいさん' }, { label: 'しんき' }]
		}) as Record<string, { key: string; label: string }[]>;

		expect(doc.daily_homework.map((i) => i.label)).toEqual(['おんどく', 'けいさん', 'しんき']);
		expect(doc.daily_homework.slice(0, 2).map((i) => i.key)).toEqual(['dh_ondoku', 'ph_keisan']);
		expect(doc.daily_homework[2].key.startsWith('dh_')).toBe(true);
	});

	it('旧形式の定義がそのまま読め、宿題は1区分にまとまる', () => {
		// サンプル定義（新形式）を旧形式へ巻き戻してから読む＝取り込み経路の再現
		const doc = loadSampleDoc() as Record<string, unknown>;
		const daily = doc.daily_homework as { key: string }[];
		doc.daily_homework = daily.slice(0, 2);
		doc.practice_homework = daily.slice(2);

		const definition = parseDefinition(doc);
		expect(definition.daily_homework.map((i) => i.key)).toEqual(daily.map((i) => i.key));
	});
});
