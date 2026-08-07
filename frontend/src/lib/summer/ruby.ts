// ルビ処理の実体は $lib/core/ruby へ移した（採点前の文言生成でも使うため）。
// 画面側からの import を全部書き換えると差分が読めなくなるので、ここは入口として残す。
export * from '$lib/core/ruby';
