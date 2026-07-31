import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// FastAPI バックエンド。/api/* をここへ中継する（Docker では API_UPSTREAM=http://backend:8000）。
const API_UPSTREAM = env.API_UPSTREAM || 'http://127.0.0.1:8000';

// 中継しないホップ単位ヘッダ（接続制御はこのプロキシ側で完結させる）。
const HOP = new Set([
	'connection',
	'keep-alive',
	'transfer-encoding',
	'upgrade',
	'proxy-connection',
	'te',
	'trailer'
]);

// /api/* をバックエンドへ中継するリバースプロキシ。
// SvelteKit の server-side fetch は同一オリジン相対 URL を内部ディスパッチで処理し handle を
// 通すため、この 1 分岐で SSR（+page.ts の初期データ取得）と CSR（ブラウザ fetch）の双方を
// まかなえる。dev でも本番（node build）でもこれが唯一の中継（vite の proxy は置かない＝
// dev だけ別経路になって x-real-client が落ちる、という食い違いを作らない）。
async function proxyApi(request: Request, clientAddress: string): Promise<Response> {
	const url = new URL(request.url);
	const headers = new Headers();
	for (const [k, v] of request.headers) if (!HOP.has(k.toLowerCase())) headers.set(k, v);
	// 上流には非圧縮を要求する。fetch は応答ボディを透過解凍する一方 Content-Encoding ヘッダは
	// 残すため、圧縮上流だと解凍済みボディに圧縮ヘッダが付いてブラウザが二重解凍で壊れる。
	headers.set('accept-encoding', 'identity');
	// 管理 PIN のスロットルを端末ごとに掛けるため、実際の接続元を渡す。
	// 呼び出し元が同名ヘッダを送ってきても必ず上書きする（詐称してスロットルを分散させない）。
	headers.set('x-real-client', clientAddress);

	const isBodyless = request.method === 'GET' || request.method === 'HEAD';
	const init: RequestInit = {
		method: request.method,
		headers,
		redirect: 'manual'
	};
	if (!isBodyless) {
		// ボディはストリームのまま流さず読み切ってから渡す。ストリーム（duplex:'half'）だと
		// dev サーバ経由の POST で上流が 4xx を返したときに fetch が投げ、本来の 401 が
		// 502 になってしまう。/api はどれも小さな JSON なので読み切りで困らない。
		init.body = await request.arrayBuffer();
	}

	let resp: Response;
	try {
		resp = await fetch(API_UPSTREAM + url.pathname + url.search, init);
	} catch {
		return new Response('upstream unreachable', { status: 502 });
	}

	const outHeaders = new Headers();
	for (const [k, v] of resp.headers) {
		const lk = k.toLowerCase();
		if (HOP.has(lk) || lk === 'content-encoding' || lk === 'content-length') continue;
		outHeaders.set(k, v);
	}
	// Set-Cookie は複数を保全（管理画面の PIN セッションクッキーが通る経路）。
	const getSetCookie = (resp.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
	if (getSetCookie) {
		const cookies = getSetCookie.call(resp.headers);
		outHeaders.delete('set-cookie');
		for (const c of cookies) outHeaders.append('set-cookie', c);
	}

	return new Response(resp.body, {
		status: resp.status,
		statusText: resp.statusText,
		headers: outHeaders
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api'))
		return proxyApi(event.request, event.getClientAddress());

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
