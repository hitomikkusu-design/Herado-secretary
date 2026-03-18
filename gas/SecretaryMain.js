// ============================================================
// LINE AI Secretary — Google Apps Script (Code_v7)
// 脳みそ: OpenAI gpt-4o-mini
// 朝6時ブリーフィング（天気・世界情勢・カレンダー予定・タスク）
// 夜18時ブリーフィング（タスク進捗・残りタスク・夜の予定）
// Googleカレンダー連携
// タスク管理（✅で完了削除）
// ============================================================
// ---- Script Properties に入っている値 ----------------------
// LINE_ACCESS_TOKEN      : LINEチャンネルアクセストークン
// LINE_USER_ID           : あなたのLINE User ID
// SPREADSHEET_ID         : GoogleシートのID
// SHEET_NAME             : シートのタブ名（例: Tasks）
// OPENAI_API_KEY         : OpenAI APIキー
// WEATHER_CITY           : 例) Susaki,Kochi
// TIMEZONE               : Asia/Tokyo
// ------------------------------------------------------------
function getConfig(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
// ============================================================
// 1. WEBHOOK — LINEからのメッセージを受け取る
// ============================================================
function doGet(e) {
  return ContentService.createTextOutput("OK");
}
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("OK");
    }
    const body   = JSON.parse(e.postData.contents);
    const events = body.events || [];
    events.forEach(event => {
      if (event.type === "message" && event.message.type === "text") {
        handleIncomingMessage(event);
      }
    });
  } catch (err) {
    Logger.log("doPost error: " + err);
  }
  return ContentService.createTextOutput("OK");
}
function handleIncomingMessage(event) {
  const replyToken = event.replyToken;
  const text       = event.message.text.trim();
  // ✅ タスク完了（番号指定）
  if (text.match(/^✅\s*\d+$/) || text.match(/^done\s*\d+$/i)) {
    const num = parseInt(text.replace(/[^\d]/g, ""));
    const result = completeTaskByNumber(num);
    replyLine(replyToken, result);
    return;
  }
  // コマンド
  if (text === "/briefing" || text === "ブリーフィング") {
    replyLine(replyToken, buildMorningBriefing());
    return;
  }
  if (text === "/evening" || text === "夜") {
    replyLine(replyToken, buildEveningBriefing());
    return;
  }
  if (text === "/tasks" || text === "タスク") {
    replyLine(replyToken, formatTaskList());
    return;
  }
  if (text === "/calendar" || text === "予定") {
    replyLine(replyToken, getTodayCalendar());
    return;
  }
  if (text.startsWith("/add ") || text.startsWith("追加 ")) {
    const taskText = text.replace(/^\/add |^追加 /, "").trim();
    addTask(taskText);
    replyLine(replyToken, "✅ タスク追加しました！\n「" + taskText + "」");
    return;
  }
  if (text === "/help" || text === "ヘルプ") {
    replyLine(replyToken, HELP_TEXT);
    return;
  }
  // 自由入力 → AI
  const aiReply = callOpenAI(buildAIPrompt(text));
  replyLine(replyToken, aiReply);
}
const HELP_TEXT = `📋 コマンド一覧
/briefing — 朝のブリーフィング
/evening  — 夜のブリーフィング
/tasks    — タスク一覧
/calendar — 今日の予定
/add [内容] — タスク追加
✅1 — タスク1番を完了・削除
/help     — このヘルプ
または自由に話しかけてね！`;
// ============================================================
// 2. 朝6時トリガー
// ============================================================
function scheduledMorningBriefing() {
  const userId = getConfig("LINE_USER_ID");
  if (!userId) return;
  pushLine(userId, buildMorningBriefing());
}
// ============================================================
// 3. 夜18時トリガー
// ============================================================
function scheduledEveningBriefing() {
  const userId = getConfig("LINE_USER_ID");
  if (!userId) return;
  pushLine(userId, buildEveningBriefing());
}
// ============================================================
// 4. 朝のブリーフィング
// ============================================================
function buildMorningBriefing() {
  const tz      = getConfig("TIMEZONE") || "Asia/Tokyo";
  const now     = new Date();
  const dateStr = Utilities.formatDate(now, tz, "M月d日(E)");
  const weather  = getWeather();
  const news     = getWorldNews();
  const calendar = getTodayCalendar();
  const tasks    = getTasksByPriority();
  let msg = `🌅 おはよう！${dateStr}\n\n`;
  msg += `🌤 天気・服装\n${weather}\n\n`;
  msg += `🌍 世界情勢\n${news}\n\n`;
  msg += `📅 今日の予定\n${calendar}\n\n`;
  msg += `📋 今日のタスク\n${tasks}`;
  return msg;
}
// ============================================================
// 5. 夜のブリーフィング
// ============================================================
function buildEveningBriefing() {
  const tz      = getConfig("TIMEZONE") || "Asia/Tokyo";
  const now     = new Date();
  const dateStr = Utilities.formatDate(now, tz, "M月d日(E)");
  const tasks       = getTasks();
  const doneTasks   = tasks.filter(t => t.done);
  const remaining   = tasks.filter(t => !t.done);
  const eveningCal  = getEveningCalendar();
  let msg = `🌙 ${dateStr} 夜のブリーフィング\n\n`;
  // 完了タスク
  if (doneTasks.length > 0) {
    msg += `✅ 今日完了したタスク（${doneTasks.length}件）\n`;
    doneTasks.forEach((t, i) => { msg += `  · ${t.text}\n`; });
    msg += "\n";
  }
  // 残りタスク
  if (remaining.length > 0) {
    msg += `📋 残りタスク（${remaining.length}件）\n`;
    remaining.forEach((t, i) => {
      const priority = t.priority === "HIGH" ? "🔴" : t.priority === "LOW" ? "⚪" : "🟡";
      msg += `  ${i + 1}. ${priority} ${t.text}\n`;
    });
    msg += "\n";
  } else {
    msg += `🎉 全タスク完了！お疲れさま！\n\n`;
  }
  // 夜の予定
  msg += `📅 今夜の予定\n${eveningCal}`;
  return msg;
}
// ============================================================
// 6. 天気
// ============================================================
function getWeather() {
  try {
    const city = encodeURIComponent(getConfig("WEATHER_CITY") || "Susaki,Kochi");
    const url  = `https://wttr.in/${city}?format=3&lang=ja`;
    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const raw  = res.getContentText().trim();
    const tempMatch = raw.match(/([+-]?\d+)°C/);
    const temp = tempMatch ? parseInt(tempMatch[1]) : null;
    let clothing = "";
    if (temp !== null) {
      if      (temp < 5)  clothing = "🧥 かなり寒い！厚手コート必須";
      else if (temp < 10) clothing = "🧥 コートを忘れずに";
      else if (temp < 15) clothing = "🧤 ジャケット＋インナーで";
      else if (temp < 20) clothing = "👕 長袖がちょうどいい";
      else if (temp < 25) clothing = "👕 軽い服装でOK";
      else                clothing = "🩴 暑い！薄着で";
    }
    return raw + (clothing ? "\n👗 服装：" + clothing : "");
  } catch (e) {
    return "天気情報を取得できませんでした";
  }
}
// ============================================================
// 7. 世界情勢（AI生成）
// ============================================================
function getWorldNews() {
  const prompt = `今日の世界の重要なニュースを3つ、ビジネス・経済・地政学に影響するものを中心に、それぞれ2文で日本語で簡潔にまとめてください。
形式：
1. 【見出し】内容
2. 【見出し】内容
3. 【見出し】内容`;
  return callOpenAI(prompt);
}
// ============================================================
// 8. Googleカレンダー連携（修正版）
// ============================================================
function getTodayCalendar() {
  try {
    const tz    = getConfig("TIMEZONE") || "Asia/Tokyo";
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // 修正: getDefaultCalendar() を先頭に追加して重複除去
    const seenIds = {};
    const allCals = [CalendarApp.getDefaultCalendar(), ...CalendarApp.getAllCalendars()];
    let events = [];

    allCals.forEach(cal => {
      const calEvents = cal.getEvents(start, end);
      calEvents.forEach(ev => {
        if (seenIds[ev.getId()]) return; // 重複スキップ
        seenIds[ev.getId()] = true;
        const startTime = ev.isAllDayEvent()
          ? "終日"
          : Utilities.formatDate(ev.getStartTime(), tz, "HH:mm");
        events.push({ time: startTime, title: ev.getTitle(), allDay: ev.isAllDayEvent() });
      });
    });

    if (events.length === 0) return "予定なし";
    // 時間順ソート
    events.sort((a, b) => {
      if (a.allDay) return -1;
      if (b.allDay) return 1;
      return a.time.localeCompare(b.time);
    });
    return events.map(ev => `  ${ev.time} ${ev.title}`).join("\n");
  } catch (e) {
    return "カレンダー取得エラー: " + e.message;
  }
}

function getEveningCalendar() {
  try {
    const tz    = getConfig("TIMEZONE") || "Asia/Tokyo";
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // 修正: getDefaultCalendar() を先頭に追加して重複除去
    const seenIds = {};
    const allCals = [CalendarApp.getDefaultCalendar(), ...CalendarApp.getAllCalendars()];
    let events = [];

    allCals.forEach(cal => {
      const calEvents = cal.getEvents(start, end);
      calEvents.forEach(ev => {
        if (seenIds[ev.getId()]) return; // 重複スキップ
        seenIds[ev.getId()] = true;
        const startTime = Utilities.formatDate(ev.getStartTime(), tz, "HH:mm");
        events.push({ time: startTime, title: ev.getTitle() });
      });
    });

    if (events.length === 0) return "予定なし";
    events.sort((a, b) => a.time.localeCompare(b.time));
    return events.map(ev => `  ${ev.time} ${ev.title}`).join("\n");
  } catch (e) {
    return "カレンダー取得エラー: " + e.message;
  }
}
// ============================================================
// 9. タスク管理（Google Sheets）
// ============================================================
function getSheet() {
  const ss        = SpreadsheetApp.openById(getConfig("SPREADSHEET_ID"));
  const sheetName = getConfig("SHEET_NAME") || "Tasks";
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}
function initSheet() {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["ID", "タスク", "優先度", "期限", "状態", "作成日", "カテゴリ"]);
  }
}
function addTask(text, priority, deadline, category) {
  initSheet();
  priority = priority || "MEDIUM";
  deadline = deadline || "";
  category = category || "仕事";
  const sheet = getSheet();
  const id    = new Date().getTime();
  const now   = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  sheet.appendRow([id, text, priority, deadline, "未完了", now, category]);
}
function getTasks() {
  initSheet();
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map((r, i) => ({
    rowIndex: i + 2,
    id: r[0], text: r[1], priority: r[2],
    deadline: r[3], done: r[4] === "完了", category: r[6]
  }));
}
function getTasksByPriority() {
  const tasks = getTasks().filter(t => !t.done);
  if (tasks.length === 0) return "タスクなし 🎉";
  const order = { "HIGH": 0, "MEDIUM": 1, "LOW": 2 };
  tasks.sort((a, b) => (order[a.priority] || 1) - (order[b.priority] || 1));
  let out = "";
  tasks.forEach((t, i) => {
    const priority = t.priority === "HIGH" ? "🔴" : t.priority === "LOW" ? "⚪" : "🟡";
    out += `${i + 1}. ${priority} ${t.text}${t.deadline ? " (〆" + t.deadline + ")" : ""}\n`;
  });
  out += "\n完了は「✅1」のように番号で送ってね！";
  return out.trim();
}
function formatTaskList() {
  return "📋 現在のタスク\n\n" + getTasksByPriority();
}
// ✅ 番号でタスク完了・削除
function completeTaskByNumber(num) {
  const tasks = getTasks().filter(t => !t.done);
  const order = { "HIGH": 0, "MEDIUM": 1, "LOW": 2 };
  tasks.sort((a, b) => (order[a.priority] || 1) - (order[b.priority] || 1));
  if (num < 1 || num > tasks.length) {
    return `⚠️ タスク${num}番は存在しません。\n/tasks で確認してね！`;
  }
  const task = tasks[num - 1];
  const sheet = getSheet();
  sheet.deleteRow(task.rowIndex);
  return `✅ 完了！「${task.text}」を削除しました！\nお疲れさま！`;
}
// ============================================================
// 10. AI プロンプト生成
// ============================================================
function buildAIPrompt(userMessage) {
  const tasks = getTasksByPriority();
  const now   = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  return `あなたは梶永瞳さんの専属AI相棒「月詠」です。
現在日時：${now}
現在のタスク状況：
${tasks}
ユーザーのメッセージ：${userMessage}`;
}
// ============================================================
// 11. OpenAI API呼び出し
// ============================================================
function callOpenAI(prompt) {
  const apiKey = getConfig("OPENAI_API_KEY");
  if (!apiKey) return "⚠️ OPENAI_API_KEY が未設定です";
  const systemInstruction = "あなたは梶永瞳さんの専属AI相棒「月詠」です。気さくで的確。月音香ブランド（エネルギー調整・音響ヒーリング・祈り米）と地域おこしの両方を深く理解しています。LINEでのやりとりなので簡潔に、でも本質をついた返答をしてください。";
  const payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user",   content: prompt }
    ],
    max_tokens: 1024,
    temperature: 0.7
  };
  try {
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
      method: "post",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type":  "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText());
    if (data.error) return "⚠️ OpenAI APIエラー: " + data.error.message;
    return data.choices?.[0]?.message?.content || "（応答なし）";
  } catch (e) {
    return "通信エラー: " + e.message;
  }
}
// ============================================================
// 12. LINE メッセージ送信
// ============================================================
function replyLine(replyToken, message) {
  const token = getConfig("LINE_ACCESS_TOKEN");
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type":  "application/json"
    },
    payload: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: truncate(message, 5000) }]
    }),
    muteHttpExceptions: true
  });
}
function pushLine(userId, message) {
  const token = getConfig("LINE_ACCESS_TOKEN");
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type":  "application/json"
    },
    payload: JSON.stringify({
      to:       userId,
      messages: [{ type: "text", text: truncate(message, 5000) }]
    }),
    muteHttpExceptions: true
  });
}
function truncate(str, max) {
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}
