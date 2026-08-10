#!/bin/bash
# PR のレビュー往復を1行1イベントで流す（Monitor 用）。
#
# usage: watch-pr.sh <owner/repo> <pr-number> <state-dir> [reviewer-login] [self-login]
#
# 起動時に「いま在るもの」を既読としてシードするため、**必ず現状を確認してから**起動すること。
# 先に届いていたレビューを黙って飲み込む。
#
# 出す行:
#   CLEAN       … 要約が「指摘なし」で、対象コミットが現在の HEAD と一致した（＝完了）
#   CLEAN-STALE … 要約は「指摘なし」だが、対象が HEAD ではない（追い越し。まだ通っていない）
#   SUMMARY     … 要約が投稿された（指摘あり。REVIEW/COMMENT が続く）
#   THUMBSUP  … PR 本体に 👍 が付いた（補助シグナル）
#   UNLIKED   … 👍 が外れた
#   ACK       … 依頼コメントに 👀 が付いた（受理。付かないまま処理されることもある）
#   REVIEW    … 新しいレビューが出た（指摘件数つき）
#   COMMENT   … 新しいインライン指摘
#   CI-FAIL   … CI ジョブが失敗・中止
#   QUIET     … 依頼から QUIET_AFTER_S 応答なし。判断材料を並べるだけで、合否は断定しない
#
# ■ 合否の読み方（ここを間違えると未着手を合格と誤読する）
#   合否は要約コメント（issue コメント。本文に「Reviewed commit: <sha>」を含む）で決まる。
#   sha と HEAD の照合はこのスクリプトが行い、CLEAN と CLEAN-STALE に分けて出す。
#   完了と言ってよいのは CLEAN だけ。CLEAN-STALE は「古いコミットが通っただけ」。
#
#   👍 は補助にとどめる。(user, content) で一意なので、2ラウンド続けて指摘なしでも増えない。
#   「👍 が在る」だけでは今回のラウンドの合格を意味しない。
#
# ■ 通信失敗の扱い
#   取得に失敗した周期は、その判定を丸ごと見送って次の周期で再試行する。
#   失敗を「無かった」と解釈して確定させない（QUIET の印を付けない）。

set -u
set -o pipefail # apiall | jq で gh 側の失敗を拾うため

REPO="${1:?owner/repo}"
PR="${2:?pr number}"
DIR="${3:?state dir}"
BOT="${4:-chatgpt-codex-connector[bot]}"
SELF="${5:-$(gh api user --jq .login 2>/dev/null || echo '')}"

POLL_S="${POLL_S:-60}"
QUIET_AFTER_S="${QUIET_AFTER_S:-720}" # 12分。従来の所要は4〜10分

mkdir -p "$DIR"
SEEN_C="$DIR/seen-comments"
SEEN_R="$DIR/seen-reviews"
SEEN_X="$DIR/seen-reactions"
SEEN_S="$DIR/seen-summaries"
SEEN_G="$DIR/seen-gone"
SEEN_A="$DIR/seen-acks"
SEEN_F="$DIR/seen-failures"
SEEN_Q="$DIR/seen-quiet"

# 成功時だけ結果を返す。失敗（ネットワーク・制限・404）は非ゼロで返し、
# 呼び出し側がその周期の判定を丸ごと見送れるようにする。空の応答と失敗を混同しない。
api() { gh api "$@" 2>/dev/null; }

# 全ページを1つの JSON 配列（配列の配列）にして返す。
#
# `--paginate` に `--jq` を付けると **ページごとに** フィルタが走るので、
# `[...] | length` や `.[-1]` のような集約はページ単位の答えになる。件数が過少になったり、
# ID が複数行で返って後続の API 呼び出しが必ず失敗したりする。
# 集約するときは必ずこちらを使い、jq は外で通すこと（`--slurp` は `--jq` と併用できない）。
# 逆に、各要素をそのまま流すだけのフィルタは `api --paginate --jq` のままでよい。
apiall() { gh api "$@" --paginate --slurp 2>/dev/null; }

to_epoch() {
	date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null ||
		date -u -d "$1" +%s 2>/dev/null || echo 0
}
# ISO8601 は辞書順で時系列順になる
newer() { if [[ "$1" > "$2" ]]; then echo "$1"; else echo "$2"; fi; }

note() { grep -qxF "$1" "$2" 2>/dev/null; }
mark() { echo "$1" >>"$2"; }

for f in "$SEEN_G" "$SEEN_F" "$SEEN_Q"; do : >"$f"; done
# 依頼への 👀 は「リアクションID」で既読管理する。
#
# 「その依頼に反応が在るか」で既読にしてはいけない。シードは依頼ごとに1回 API を叩くので
# 数秒かかり、その最中に付いた 👀 を吸い込んで以後永久に鳴らせなくなる（起動時の競合）。
# 見た時刻ではなく、リアクション自身の created_at で切る。
#
# 切り口は「起動より少し前」に置く。ローカル時計が GitHub より進んでいると、起動後に
# 付いた 👀 まで既読にしてしまうため、余裕を取って取りこぼしより重複に倒す。
: >"$SEEN_A"
seed_cut=$(date -u -v-60S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
	date -u -d '60 seconds ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
if [ -n "${seed_cut:-}" ] && seed_reqs=$(apiall "repos/$REPO/issues/$PR/comments" |
	jq -r "[.[][] | select(.user.login == \"$SELF\") | select(.body | test(\"^\\\\s*@codex review\\\\s*$\"))] | .[-3:] | .[].id"); then
	while read -r seed_rid; do
		[ -z "${seed_rid:-}" ] && continue
		# 取得に失敗したら既読にしない（あとで重複して鳴る方が、取りこぼすより良い）。
		seed_x=$(api "repos/$REPO/issues/comments/$seed_rid/reactions" \
			--jq ".[] | select(.user.login == \"$BOT\") | \"\(.id)\t\(.created_at)\"") || continue
		[ -z "${seed_x:-}" ] && continue
		while IFS=$'\t' read -r aid acreated; do
			[ -z "${aid:-}" ] && continue
			[[ "$acreated" < "$seed_cut" ]] && mark "$aid" "$SEEN_A"
		done <<<"$seed_x"
	done <<<"$seed_reqs"
fi
api "repos/$REPO/pulls/$PR/comments" --paginate --jq '.[].id' >"$SEEN_C" || : >"$SEEN_C"
api "repos/$REPO/pulls/$PR/reviews" --paginate --jq '.[].id' >"$SEEN_R" || : >"$SEEN_R"
api "repos/$REPO/issues/$PR/reactions" --paginate --jq '.[].id' >"$SEEN_X" || : >"$SEEN_X"
api "repos/$REPO/issues/$PR/comments" --paginate \
	--jq ".[] | select(.user.login == \"$BOT\") | .id" >"$SEEN_S" || : >"$SEEN_S"

head_fail=0
head_warned=0

while true; do
	sleep "$POLL_S"
	newest_at="" # この周期で見えたレビュアー側の最新活動（要約・レビュー・指摘）

	# HEAD はこの周期の全判定で使う。取れなければ照合できないことを明示する（推測しない）。
	head_sha=""
	head_short="?"
	if hs=$(api "repos/$REPO/pulls/$PR" --jq '.head.sha') && [ -n "${hs:-}" ]; then
		head_sha="$hs"
		head_short="${hs:0:7}"
		if [ "$head_warned" -eq 1 ]; then
			echo "RECOVERED: HEAD を再取得できました。保留していた判定を再開します"
		fi
		head_fail=0
		head_warned=0
	else
		# HEAD が無いと合否を照合できないので、要約・CI・QUIET の判定を見送る。
		# 見送りが続くと沈黙するため、一定回数で1度だけ知らせる（沈黙＝異常なし、ではない）。
		head_fail=$((head_fail + 1))
		if [ "$head_fail" -ge 5 ] && [ "$head_warned" -eq 0 ]; then
			echo "WARN: HEAD を ${head_fail} 回続けて取得できません。合否判定を保留しています"
			head_warned=1
		fi
	fi

	# 要約の sha が HEAD を指しているか。取れていないときは "unknown" を返し、
	# 呼び出し側に「照合できなかった」と言わせる。
	covers_head() {
		[ -z "${head_sha:-}" ] && { echo unknown; return; }
		[ -z "${1:-}" ] && { echo unknown; return; }
		if [ "${head_sha:0:${#1}}" = "$1" ]; then echo yes; else echo no; fi
	}
	head_note() {
		case "$(covers_head "${1:-}")" in
		yes) echo "HEAD と一致" ;;
		no) echo "HEAD ${head_short} ではない・追い越し" ;;
		*) echo "HEAD と照合できず" ;;
		esac
	}

	# 1) PR 本体のリアクション。👍 は補助シグナル。合否は要約コメントで決める。
	#    取得に失敗した周期は、追加も削除も判定しない（空応答を全削除と誤読しないため）。
	if reactions=$(api "repos/$REPO/issues/$PR/reactions" --paginate \
		--jq '.[] | "\(.id)\t\(.content)\t\(.user.login)\t\(.created_at)"'); then

		while IFS=$'\t' read -r xid content who at; do
			[ -z "${xid:-}" ] && continue
			note "$xid" "$SEEN_X" && continue
			[ "$who" = "$BOT" ] || { mark "$xid" "$SEEN_X"; continue; }
			case "$content" in
			"+1" | "hooray" | "heart" | "rocket")
				echo "THUMBSUP: $BOT が PR に $content を付けました（${at}・補助シグナル。要約コメントで確認すること）"
				;;
			*) echo "REACTION: $BOT が PR に $content を付けました（${at}）" ;;
			esac
			mark "$xid" "$SEEN_X" # 出してから印を付ける（間で落ちても取りこぼさない）
		done <<<"$reactions"

		live=$(printf '%s\n' "$reactions" | cut -f1 | grep -v '^$' | sort -u)
		while read -r gone; do
			[ -z "${gone:-}" ] && continue
			note "$gone" "$SEEN_G" && continue
			echo "UNLIKED: PR 本体のリアクション $gone が外れました"
			mark "$gone" "$SEEN_G"
		done < <(comm -23 <(sort -u "$SEEN_X") <(printf '%s\n' "$live"))
	fi

	# 2) 「指摘なし」の要約。これは issue コメントとして届く（pulls/*/reviews には現れない）。
	#    指摘ありのラウンドは review レコード側に要約が入るので、ここには来ない。
	#    合格を知る経路はここだけなので、issue コメントを見ないと永久に気づけない。
	#
	#    HEAD が取れていない周期はこの節を丸ごと見送る。照合できないまま CLEAN-STALE を出して
	#    既読にすると、次の周期で HEAD が取れても本物の CLEAN を二度と出せなくなる
	#    ＝一時的な通信失敗で合格通知を永久に落とす。遅らせてでも正しく出す。
	if [ -n "${head_sha:-}" ] && sums=$(api "repos/$REPO/issues/$PR/comments" --paginate \
		--jq ".[] | select(.user.login == \"$BOT\") | \"\(.id)\t\(.created_at)\""); then
		while IFS=$'\t' read -r sid sat; do
			[ -z "${sid:-}" ] && continue
			newest_at=$(newer "$sat" "${newest_at:-}")
			note "$sid" "$SEEN_S" && continue
			body=$(api "repos/$REPO/issues/comments/$sid" --jq '.body') || continue
			sha=$(printf '%s' "$body" | grep -o 'Reviewed commit:[^`]*`[0-9a-f]\{7,40\}`' |
				grep -o '[0-9a-f]\{7,40\}' | head -1)
			if printf '%s' "$body" |
				grep -qi "didn't find any major issues\|no major issues\|looking forward to the next diff"; then
				case "$(covers_head "${sha:-}")" in
				yes) echo "CLEAN: ${BOT} が ${sha} をレビューし指摘なし。HEAD と一致（${sat}）" ;;
				no) echo "CLEAN-STALE: ${BOT} は ${sha} に指摘なしと報告。HEAD ${head_short} ではない（${sat}）" ;;
				# 本文に Reviewed commit が無い。再試行しても変わらないので、ここは確定させる。
				*) echo "CLEAN-STALE: ${BOT} が指摘なしと報告。対象コミットを本文から読めず（${sat}）" ;;
				esac
			else
				echo "SUMMARY: ${BOT} が ${sha:-?} のレビュー要約を投稿しました（${sat}・HEAD 照合=$(covers_head "${sha:-}")）"
			fi
			mark "$sid" "$SEEN_S"
		done <<<"$sums"
	fi

	# 3) 依頼コメントと、それへの 👀
	#    著者と本文完全一致で絞る。Codex の定型文にも "@codex review" が入っており、
	#    部分一致で拾うと bot のコメントを自分の依頼と取り違える。
	last_req_at=""
	last_req_id=""
	if req=$(apiall "repos/$REPO/issues/$PR/comments" |
		jq -r "[.[][] | select(.user.login == \"$SELF\") | select(.body | test(\"^\\\\s*@codex review\\\\s*$\"))] | .[-3:] | .[] | \"\(.id)\t\(.created_at)\""); then
		while IFS=$'\t' read -r cid cat; do
			[ -z "${cid:-}" ] && continue
			last_req_at=$(newer "$cat" "${last_req_at:-}")
			[ "$last_req_at" = "$cat" ] && last_req_id="$cid"
			acks=$(api "repos/$REPO/issues/comments/$cid/reactions" \
				--jq ".[] | select(.user.login == \"$BOT\") | \"\(.id)\t\(.content)\"") || continue
			[ -z "${acks:-}" ] && continue
			while IFS=$'\t' read -r aid acontent; do
				[ -z "${aid:-}" ] && continue
				note "$aid" "$SEEN_A" && continue
				echo "ACK: $BOT が依頼 $cid に $acontent を付けました（受理）"
				mark "$aid" "$SEEN_A"
			done <<<"$acks"
		done <<<"$req"
	fi

	# 4) 新しいレビュー。件数取得はネットワークを叩くので、印より先に済ませる。
	if reviews=$(api "repos/$REPO/pulls/$PR/reviews" --paginate \
		--jq ".[] | select(.user.login != \"$SELF\") | \"\(.id)\t\(.user.login)\t\(.commit_id[0:7])\t\(.submitted_at)\""); then
		while IFS=$'\t' read -r rid who sha at; do
			[ -z "${rid:-}" ] && continue
			newest_at=$(newer "$at" "${newest_at:-}") # 上書きでなく最大値を取る
			note "$rid" "$SEEN_R" && continue
			n=$(apiall "repos/$REPO/pulls/$PR/comments" |
				jq -r "[.[][] | select(.pull_request_review_id == $rid)] | length")
			echo "REVIEW: $who がコミット $sha をレビュー、指摘 ${n:-?} 件・$(head_note "$sha") (review=$rid)"
			mark "$rid" "$SEEN_R"
		done <<<"$reviews"
	fi

	# 5) 新しいインライン指摘（自分の返信は除く）
	if comments=$(api "repos/$REPO/pulls/$PR/comments" --paginate \
		--jq ".[] | select(.user.login != \"$SELF\") | \"\(.id)\t\(.user.login)\t\(.path):\(.line // .original_line)\t\(.created_at)\""); then
		while IFS=$'\t' read -r cid who where at; do
			[ -z "${cid:-}" ] && continue
			newest_at=$(newer "$at" "${newest_at:-}")
			note "$cid" "$SEEN_C" && continue
			echo "COMMENT: $who が $where に指摘 (comment=$cid)"
			mark "$cid" "$SEEN_C"
		done <<<"$comments"
	fi

	# 6) CI 失敗（同じ HEAD の同じジョブは1回だけ）。HEAD 不明の周期は見送る。
	if [ -n "${head_sha:-}" ] &&
		fails=$(gh pr checks "$PR" --repo "$REPO" --json name,bucket \
			--jq '.[] | select(.bucket == "fail" or .bucket == "cancel") | .name' 2>/dev/null); then
		while IFS= read -r job; do
			[ -z "${job:-}" ] && continue
			note "$head_short|$job" "$SEEN_F" && continue
			echo "CI-FAIL: $head_short の「${job}」が失敗しました"
			mark "$head_short|$job" "$SEEN_F"
		done <<<"$fails"
	fi

	# 7) 依頼したのに静か。事実だけ並べ、合否は断定しない。
	if [ -n "${last_req_at:-}" ] && ! note "$last_req_at" "$SEEN_Q"; then
		req_e=$(to_epoch "$last_req_at")
		act_e=0
		[ -n "${newest_at:-}" ] && act_e=$(to_epoch "$newest_at")
		if [ "$req_e" -gt 0 ] && [ "$act_e" -le "$req_e" ] &&
			[ $(($(date -u +%s) - req_e)) -ge "$QUIET_AFTER_S" ]; then
			# 最新の要約が「いまの HEAD」を対象にしているかが決め手。
			# ここでの取得が1つでも失敗したら、何も出さず印も付けずに次の周期へ回す。
			# 失敗を「要約が無い」と読んで確定させると、通信が戻っても二度と言い直せない。
			if [ -z "${head_sha:-}" ]; then
				: # HEAD が取れていない周期。次で再試行する
			elif last_sid=$(apiall "repos/$REPO/issues/$PR/comments" |
				jq -r "[.[][] | select(.user.login == \"$BOT\")] | .[-1].id // \"\""); then

				sum_sha=""
				body_ok=1
				if [ -n "${last_sid:-}" ] && [ "$last_sid" != "null" ]; then
					if sbody=$(api "repos/$REPO/issues/comments/$last_sid" --jq '.body'); then
						sum_sha=$(printf '%s' "$sbody" |
							grep -o 'Reviewed commit:[^`]*`[0-9a-f]\{7,40\}`' |
							grep -o '[0-9a-f]\{7,40\}' | head -1)
					else
						body_ok=0 # 本文が読めなかった。判定を作らない
					fi
				fi

				if [ "$body_ok" -eq 1 ]; then
					case "$(covers_head "${sum_sha:-}")" in
					yes) verdict="最新の要約は HEAD（${sum_sha}）が対象 → その判定が最新" ;;
					no) verdict="最新の要約の対象は ${sum_sha}。HEAD ${head_short} は未レビュー" ;;
					*) verdict="要約が無い、または対象コミットを読めない → 未レビュー扱い" ;;
					esac
					echo "QUIET: 依頼 ${last_req_id}（${last_req_at}）から $((QUIET_AFTER_S / 60)) 分、新しい応答なし。$verdict"
					mark "$last_req_at" "$SEEN_Q" # 判定を出せた周期でだけ確定させる
				fi
			fi
		fi
	fi
done
