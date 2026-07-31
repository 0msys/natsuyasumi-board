// 夏休みページの効果音（Web Audio 合成・音声ファイル資産なし）。
// iOS Safari はジェスチャ外で AudioContext が suspended のままになるため、
// unlockSummerSfx() をクリックハンドラの同期部で呼んで resume しておく
// （speakText.ts の unlockSummerSpeech と同じ配置パターン。あちらは HTMLAudioElement 用で別機構）。
// 一度 running になれば、refresh 後の花火など非ジェスチャ文脈の再生も鳴る。
// 音は演出と独立（prefers-reduced-motion では動きだけ止め、音は鳴らす）。

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** クリックハンドラの同期部で呼ぶ（iOS の AudioContext 解放）。 */
export function unlockSummerSfx(): void {
	if (typeof window === 'undefined' || !('AudioContext' in window)) return;
	ctx ??= new AudioContext();
	if (ctx.state === 'suspended') void ctx.resume();
}

/** 再生可能な AudioContext を返す（未解放・非対応なら null＝黙ってスキップ）。 */
function audio(): { ctx: AudioContext; out: GainNode } | null {
	if (!ctx) return null;
	if (ctx.state === 'suspended') void ctx.resume();
	if (!master) {
		master = ctx.createGain();
		master.gain.value = 0.3; // 家庭内で耳障りにならない控えめ音量
		master.connect(ctx.destination);
	}
	return { ctx, out: master };
}

/** ◯チェックの「ポンッ」。ピッチを±10%揺らして連打が単調にならないようにする。 */
export function playPop(): void {
	const a = audio();
	if (!a) return;
	const t = a.ctx.currentTime;
	const jitter = 0.9 + Math.random() * 0.2;
	const osc = a.ctx.createOscillator();
	const gain = a.ctx.createGain();
	osc.type = 'triangle';
	osc.frequency.setValueAtTime(700 * jitter, t);
	osc.frequency.exponentialRampToValueAtTime(300 * jitter, t + 0.06);
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.linearRampToValueAtTime(1, t + 0.005);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
	osc.connect(gain).connect(a.out);
	osc.start(t);
	osc.stop(t + 0.15);
}

/** 花火の打ち上げ「ヒュー」（上昇グライド＋軽いビブラート）。 */
export function playWhistle(): void {
	const a = audio();
	if (!a) return;
	const t = a.ctx.currentTime;
	const osc = a.ctx.createOscillator();
	const gain = a.ctx.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(400, t);
	osc.frequency.exponentialRampToValueAtTime(1200, t + 0.4);
	const lfo = a.ctx.createOscillator();
	const lfoGain = a.ctx.createGain();
	lfo.frequency.value = 20;
	lfoGain.gain.value = 25;
	lfo.connect(lfoGain).connect(osc.frequency);
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.linearRampToValueAtTime(0.5, t + 0.05);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
	osc.connect(gain).connect(a.out);
	osc.start(t);
	lfo.start(t);
	osc.stop(t + 0.5);
	lfo.stop(t + 0.5);
}

/** 花火の破裂「ドン」（ノイズの lowpass スイープ＋低音の thump）。 */
export function playBoom(): void {
	const a = audio();
	if (!a) return;
	const t = a.ctx.currentTime;
	const dur = 0.6;
	const buf = a.ctx.createBuffer(1, Math.ceil(a.ctx.sampleRate * dur), a.ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	const noise = a.ctx.createBufferSource();
	noise.buffer = buf;
	const lp = a.ctx.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.setValueAtTime(600, t);
	lp.frequency.exponentialRampToValueAtTime(150, t + dur);
	const noiseGain = a.ctx.createGain();
	noiseGain.gain.setValueAtTime(0.8, t);
	noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	noise.connect(lp).connect(noiseGain).connect(a.out);
	const thump = a.ctx.createOscillator();
	const thumpGain = a.ctx.createGain();
	thump.type = 'sine';
	thump.frequency.setValueAtTime(120, t);
	thump.frequency.exponentialRampToValueAtTime(50, t + 0.3);
	thumpGain.gain.setValueAtTime(1, t);
	thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
	thump.connect(thumpGain).connect(a.out);
	noise.start(t);
	thump.start(t);
	noise.stop(t + dur);
	thump.stop(t + 0.4);
}

/** 200点満点（王冠）のファンファーレ（C5→E5→G5→C6 の上昇アルペジオ・すこし華やか）。 */
export function playFanfare(): void {
	const a = audio();
	if (!a) return;
	const t = a.ctx.currentTime;
	// C5 E5 G5 C6 を軽快に上昇 → 最後の C6 は少し伸ばす
	const notes: [number, number][] = [
		[523, 0],
		[659, 0.11],
		[784, 0.22],
		[1047, 0.35]
	];
	for (const [freq, at] of notes) {
		const osc = a.ctx.createOscillator();
		const gain = a.ctx.createGain();
		osc.type = 'triangle';
		osc.frequency.value = freq;
		const start = t + at;
		const dur = freq === 1047 ? 0.55 : 0.28;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
		osc.connect(gain).connect(a.out);
		osc.start(start);
		osc.stop(start + dur + 0.05);
	}
}

/** 「まんてん！」バナーのタダーン（G5→C6 の2音・控えめ）。 */
export function playTada(): void {
	const a = audio();
	if (!a) return;
	const t = a.ctx.currentTime;
	for (const [i, freq] of [784, 1047].entries()) {
		const osc = a.ctx.createOscillator();
		const gain = a.ctx.createGain();
		osc.type = 'square';
		osc.frequency.value = freq;
		const start = t + i * 0.15;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
		osc.connect(gain).connect(a.out);
		osc.start(start);
		osc.stop(start + 0.4);
	}
}
