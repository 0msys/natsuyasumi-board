// SvelteKit のランタイム（$app/navigation・$app/state）を、テスト全体で1回だけ差し替える。
//
// apiMock.ts / browserMocks.ts と同じ理由（bun の mock.module はプロセス全体に効く）。
// beforeNavigate に登録されたガードはここで捕まえておき、テストから
// runBeforeNavigate() で「その遷移が起きたこと」を再現する——離脱ガードは
// 実際にページ遷移させないと確かめられないが、テストでは遷移そのものは起こせない。
import { mock } from 'bun:test';

type NavGuard = (nav: unknown) => void;

let navGuards: NavGuard[] = [];
let currentUrl = new URL('http://localhost/');

/** goto() に渡された行き先（呼ばれた順）. */
export const gotoCalls: string[] = [];
/** confirm() に渡された文言（呼ばれた順）. */
export const confirmMessages: string[] = [];
let confirmAnswer = true;

mock.module('$app/navigation', () => ({
	beforeNavigate: (fn: NavGuard) => navGuards.push(fn),
	goto: async (href: string) => {
		gotoCalls.push(href);
	},
	invalidateAll: async () => {}
}));

// リンクの組み立て（$app/paths の resolve）。テストでは base なしで動かす。
// 本物はルート ID の [param] を params で埋めるだけで、URL エンコードはしない
// （呼ぶ側が encodeURIComponent 済みの値を渡す約束）。ここも同じにしておく。
mock.module('$app/paths', () => ({
	base: '',
	assets: '',
	asset: (file: string) => file,
	resolve: (route: string, params?: Record<string, string>) =>
		route.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, name: string) => params?.[name] ?? '')
}));

mock.module('$app/state', () => ({
	page: {
		get url() {
			return currentUrl;
		}
	}
}));

/** ページが見ている URL（?section= / ?year= の読み取り先）. */
export function setPageUrl(href: string): void {
	currentUrl = new URL(href, 'http://localhost');
}

/** confirm() の答えを決める（既定は「はい」）. */
export function setConfirmAnswer(answer: boolean): void {
	confirmAnswer = answer;
}

/** 各テストの beforeEach から呼ぶ（共有モジュールの afterEach は当てにしない）. */
export function resetAppMocks(): void {
	navGuards = [];
	gotoCalls.length = 0;
	confirmMessages.length = 0;
	confirmAnswer = true;
	globalThis.confirm = ((message?: string) => {
		confirmMessages.push(message ?? '');
		return confirmAnswer;
	}) as typeof globalThis.confirm;
}

/** 登録済みの beforeNavigate ガードに遷移を流す。cancel されたら true. */
export function runBeforeNavigate(from: string, to: string, type = 'link'): boolean {
	let cancelled = false;
	const nav = {
		type,
		from: { url: new URL(from, 'http://localhost') },
		to: { url: new URL(to, 'http://localhost') },
		cancel: () => {
			cancelled = true;
		}
	};
	for (const guard of navGuards) guard(nav);
	return cancelled;
}
