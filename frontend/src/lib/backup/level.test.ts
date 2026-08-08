// 催促のしきい値。歯車バッジと BackupCard が同じ判定を使っていることを、ここで固定する。
import { describe, expect, it } from 'bun:test';
import { BACKUP_STALE_CHANGES, BACKUP_STALE_DAYS, backupLevel, daysSinceBackup } from './level';

/** 「いま」を固定して、N日前に出したバックアップの状態を作る。 */
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0); // ミリ秒
const daysAgo = (days: number, changes = 0) => ({
	last_backup_at: Math.round(NOW / 1000 - days * 86400),
	changes_since_backup: changes
});

describe('さいごのバックアップからの日数', () => {
	it('切り捨てて数える（画面の「N日前」と同じ）', () => {
		expect(daysSinceBackup(daysAgo(0.5), NOW)).toBe(0);
		expect(daysSinceBackup(daysAgo(7.9), NOW)).toBe(7);
	});

	it('まだ一度も出していなければ null', () => {
		expect(daysSinceBackup({ last_backup_at: null, changes_since_backup: 3 }, NOW)).toBeNull();
	});

	it('端末の時計が巻き戻っても「-1日前」とは出さない', () => {
		expect(daysSinceBackup(daysAgo(-3), NOW)).toBe(0);
	});
});

describe('催促の強さ', () => {
	it('まだ一度も出していなければ danger', () => {
		expect(backupLevel({ last_backup_at: null, changes_since_backup: 0 }, NOW)).toBe('danger');
	});

	it('しきい値の日数に届くまでは ok', () => {
		expect(backupLevel(daysAgo(BACKUP_STALE_DAYS - 0.1), NOW)).toBe('ok');
	});

	it('件数がしきい値を越えたら warn', () => {
		expect(backupLevel(daysAgo(1, BACKUP_STALE_CHANGES), NOW)).toBe('ok');
		expect(backupLevel(daysAgo(1, BACKUP_STALE_CHANGES + 1), NOW)).toBe('warn');
	});

	// これが元の不具合。バッジは小数日で `> 7`、カードは切り捨て日で `> 7` を見ていたので、
	// 7.0〜8.0日のあいだは「歯車だけ赤く、開いたカードは普通」という状態になっていた。
	it('表示が「7日前」に変わる日と、強調に上がる日が同じ', () => {
		for (const days of [7, 7.5, 7.99]) {
			const status = daysAgo(days);
			expect(daysSinceBackup(status, NOW), `${days}日前の表示`).toBe(BACKUP_STALE_DAYS);
			expect(backupLevel(status, NOW), `${days}日前の強さ`).toBe('warn');
		}
		const justBefore = daysAgo(6.99);
		expect(daysSinceBackup(justBefore, NOW)).toBe(BACKUP_STALE_DAYS - 1);
		expect(backupLevel(justBefore, NOW)).toBe('ok');
	});
});
