// 自動生成。手で編集しないこと。
// 生成元: backend/app/summer/speech.py
// 作り直す: cd backend && uv run python tools/dump_core_data.py

/** 「きょうやること」読み上げ文の定型（最大漢字＋総ルビ）。 */
export const SPEECH_LINES: Record<string, string> = {
  "away": "今日《きょう》はお出《で》かけの日《ひ》だね。楽《たの》しんでね。",
  "all_done": "今日《きょう》の記録《きろく》と宿題《しゅくだい》は、全部《ぜんぶ》できているよ。すごいね。",
  "habit_daily": "今日《きょう》はまだ、{labels}の 記録《きろく》がないよ。わすれずにやろうね。",
  "practice": "くり返《かえ》しの宿題《しゅくだい》も、どれかひとつやろうね。",
  "one_shot": "夏休《なつやす》みのおわりが近《ちか》いから、{labels}も 進《すす》めようね。",
  "prep": "新学期《しんがっき》のじゅんび、{label}{note}も わすれずにね。",
  "more": "、そのほかも少《すこ》し"
};

/** 読み上げで項目名を並べる上限。 */
export const SPEECH_LIST_MAX = 5;
