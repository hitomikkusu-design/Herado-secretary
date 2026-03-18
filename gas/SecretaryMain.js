// ============================================================
// 月詠（つきよみ）LINE AI 秘書 — Google Apps Script
// ============================================================
// Script Properties に以下を設定してください:
//   LINE_ACCESS_TOKEN  : LINE チャンネルアクセストークン
//   LINE_USER_ID       : あなたの LINE User ID
//   SPREADSHEET_ID     : Google スプレッドシート ID
//   SHEET_NAME         : タスクシート名（省略時: Tasks）
//   OPENAI_API_KEY     : OpenAI API キー
//   WEATHER_CITY       : 天気取得都市（例: Susaki,Kochi）
//   TIMEZONE           : タイムゾーン（例: Asia/Tokyo）
// ============================================================

// ============================================================
// 設定取得
// ============================================================
function getConfig(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function tz() {
  return getConfig('TIMEZONE') || 'Asia/Tokyo';
}

// ============================================================
// 1. WEBHOOK — LINE からのメッセージを受け取る
// ============================================================
function doGet(e) {
  return ContentService.createTextOutput('OK');
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK');
    }
    const body   = JSON.parse(e.postData.contents);
    const events = body.events || [];
    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        handleIncomingMessage(event);
      }
    });
  } catch (err) {
    Logger.log('doPost error: ' + err);
  }
  return ContentService.createTextOutput('OK');
}

function handleIncomingMessage(event) {
  const replyToken = event.replyToken;
  const text       = event.message.text.trim();

  // ✅ タスク完了（例: ✅1 または done 1）
  if (/^✅\s*\d+$/.test(text) || /^done\s*\d+$/i.test(text)) {
    const num = parseInt(text.replace(/[^\d]/g, ''));
    replyLine(replyToken, completeTaskByNumber(num));
    return;
  }

  const commands = {
    '/briefing': () => buildMorningBriefing(),
    'ブリーフィング': () => buildMorningBriefing(),
    '/evening':  () => buildEveningBriefing(),
    '夜':        () => buildEveningBriefing(),
    '/tasks':    () => formatTaskList(),
    'タスク':    () => formatTaskList(),
    '/calendar': () => getTodayCalendar(),
    '予定':      () => getTodayCalendar(),
    '今日の予定': () => getTodayCalendar(),
    '明日の予定': () => getTomorrowCalendar(),
    '/help':     () => HELP_TEXT,
    'ヘルプ':    () => HELP_TEXT,
  };

  if (commands[text]) {
    replyLine(replyToken, commands[text]());
    return;
  }

  if (text.startsWith('/add ') || text.startsWith('追加 ')) {
    const taskText = text.replace(/^\/add |^追加 /, '').trim();
    addTask(taskText);
    replyLine(replyToken, '✅ タスク追加しました！\n「' + taskText + '」');
    return;
  }

  // 自由入力 → AI
  replyLine(replyToken, callOpenAI(buildAIPrompt(text)));
}

const HELP_TEXT = `📋 コマンド一覧
/briefing — 朝のブリーフィング
/evening  — 夜のブリーフィング
/tasks    — タスク一覧
/calendar — 今日の予定
明日の予定 — 明日の予定
/add [内容] — タスク追加
✅1       — タスク1番を完了・削除
/help     — このヘルプ
または自由に話しかけてね！`;

// ============================================================
// 2. 朝6時トリガー
// ============================================================
function scheduledMorningBriefing() {
  const userId = getConfig('LINE_USER_ID');
  if (!userId) return;
  pushLine(userId, buildMorningBriefing());
}

// ============================================================
// 3. 夜18時トリガー
// ============================================================
function scheduledEveningBriefing() {
  const userId = getConfig('LINE_USER_ID');
  if (!userId) return;
  pushLine(userId, buildEveningBriefing());
}

// ============================================================
// 4. 朝のブリーフィング
// ============================================================
function buildMorningBriefing() {
  const dateStr = Utilities.formatDate(new Date(), tz(), 'M月d日(E)');
  const weather  = getWeather();
  const calendar = getTodayCalendar();
  const tasks    = getTasksByPriority();

  return [
    `🌅 おはよう！${dateStr}`,
    '',
    `🌤 天気・服装\n${weather}`,
    '',
    `📅 今日の予定\n${calendar}`,
    '',
    `📋 今日のタスク\n${tasks}`,
  ].join('\n');
}

// ============================================================
// 5. 夜のブリーフィング
// ============================================================
function buildEveningBriefing() {
  const dateStr   = Utilities.formatDate(new Date(), tz(), 'M月d日(E)');
  const tasks     = getTasks();
  const doneTasks = tasks.filter(t => t.done);
  const remaining = tasks.filter(t => !t.done);
  const eveningCal = getEveningCalendar();

  let msg = `🌙 ${dateStr} 夜のブリーフィング\n\n`;

  if (doneTasks.length > 0) {
    msg += `✅ 今日完了したタスク（${doneTasks.length}件）\n`;
    doneTasks.forEach(t => { msg += `  · ${t.text}\n`; });
    msg += '\n';
  }

  if (remaining.length > 0) {
    msg += `📋 残りタスク（${remaining.length}件）\n`;
    remaining.forEach((t, i) => {
      const icon = t.priority === 'HIGH' ? '🔴' : t.priority === 'LOW' ? '⚪' : '🟡';
      msg += `  ${i + 1}. ${icon} ${t.text}\n`;
    });
    msg += '\n';
  } else {
    msg += '🎉 全タスク完了！お疲れさま！\n\n';
  }

  msg += `📅 今夜の予定\n${eveningCal}`;
  return msg;
}

// ============================================================
// 6. 天気（wttr.in）
// ============================================================
function getWeather() {
  try {
    const city = encodeURIComponent(getConfig('WEATHER_CITY') || 'Susaki,Kochi');
    const url  = `https://wttr.in/${city}?format=3&lang=ja`;
    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const raw  = res.getContentText().trim();

    const tempMatch = raw.match(/([+-]?\d+)°C/);
    const temp = tempMatch ? parseInt(tempMatch[1]) : null;

    let clothing = '';
    if (temp !== null) {
      if      (temp < 5)  clothing = '🧥 かなり寒い！厚手コート必須';
      else if (temp < 10) clothing = '🧥 コートを忘れずに';
      else if (temp < 15) clothing = '🧤 ジャケット＋インナーで';
      else if (temp < 20) clothing = '👕 長袖がちょうどいい';
      else if (temp < 25) clothing = '👕 軽い服装でOK';
      else                clothing = '🩴 暑い！薄着で';
    }

    return raw + (clothing ? '\n👗 服装：' + clothing : '');
  } catch (e) {
    return '天気情報を取得できませんでした';
  }
}

// ============================================================
// 7. カレンダー取得
// ============================================================

/**
 * 全カレンダーから指定期間のイベントを重複なしで取得する
 */
function fetchCalendarEvents(start, end) {
  const seenIds = {};
  const events  = [];

  // デフォルト（プライマリ）カレンダー
  try {
    const defCal = CalendarApp.getDefaultCalendar();
    Logger.log('デフォルトカレンダー: ' + defCal.getName() + ' / ' + defCal.getId());
    defCal.getEvents(start, end).forEach(ev => {
      seenIds[ev.getId()] = true;
      events.push(ev);
    });
  } catch (e) {
    Logger.log('getDefaultCalendar エラー: ' + e.message);
  }

  // その他のカレンダー
  try {
    CalendarApp.getAllCalendars().forEach(cal => {
      cal.getEvents(start, end).forEach(ev => {
        if (!seenIds[ev.getId()]) {
          seenIds[ev.getId()] = true;
          events.push(ev);
        }
      });
    });
  } catch (e) {
    Logger.log('getAllCalendars エラー: ' + e.message);
  }

  // 開始時刻順でソート（終日イベントを先頭に）
  events.sort((a, b) => {
    if (a.isAllDayEvent() && !b.isAllDayEvent()) return -1;
    if (!a.isAllDayEvent() && b.isAllDayEvent()) return 1;
    return a.getStartTime() - b.getStartTime();
  });

  Logger.log('取得イベント数: ' + events.length + ' (期間: ' + start + ' 〜 ' + end + ')');
  return events;
}

/**
 * イベント配列をテキストに整形
 */
function formatEvents(events) {
  if (events.length === 0) return '予定なし';
  return events.map(ev => {
    const timeStr = ev.isAllDayEvent()
      ? '終日'
      : Utilities.formatDate(ev.getStartTime(), tz(), 'HH:mm')
        + '〜'
        + Utilities.formatDate(ev.getEndTime(), tz(), 'HH:mm');
    return `  ${timeStr}　${ev.getTitle() || '（タイトルなし）'}`;
  }).join('\n');
}

/**
 * 今日の予定
 */
function getTodayCalendar() {
  try {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return formatEvents(fetchCalendarEvents(start, end));
  } catch (e) {
    Logger.log('getTodayCalendar エラー: ' + e.message);
    return 'カレンダー取得エラー: ' + e.message;
  }
}

/**
 * 明日の予定
 */
function getTomorrowCalendar() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
    const end   = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59);
    return formatEvents(fetchCalendarEvents(start, end));
  } catch (e) {
    Logger.log('getTomorrowCalendar エラー: ' + e.message);
    return 'カレンダー取得エラー: ' + e.message;
  }
}

/**
 * 今夜（18:00〜23:59）の予定
 */
function getEveningCalendar() {
  try {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return formatEvents(fetchCalendarEvents(start, end));
  } catch (e) {
    Logger.log('getEveningCalendar エラー: ' + e.message);
    return 'カレンダー取得エラー: ' + e.message;
  }
}

/**
 * デバッグ用：カレンダー一覧と今日の予定をログ出力
 * GAS エディタで選択して「実行」すると実行ログに詳細が出ます
 */
function debugCalendar() {
  Logger.log('=== カレンダーデバッグ ===');
  Logger.log('現在時刻 (サーバー): ' + new Date());
  Logger.log('タイムゾーン設定: ' + tz());

  // カレンダー一覧
  try {
    const cals = CalendarApp.getAllCalendars();
    Logger.log('カレンダー数: ' + cals.length);
    cals.forEach((cal, i) => {
      Logger.log(`  [${i}] ${cal.getName()} (${cal.getId()})`);
    });
  } catch (e) {
    Logger.log('カレンダー一覧取得エラー: ' + e.message);
  }

  // 今日の予定
  const result = getTodayCalendar();
  Logger.log('今日の予定:\n' + result);
}

// ============================================================
// 8. タスク管理（Google Sheets）
// ============================================================
function getSheet() {
  const ss        = SpreadsheetApp.openById(getConfig('SPREADSHEET_ID'));
  const sheetName = getConfig('SHEET_NAME') || 'Tasks';
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function initSheet() {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['ID', 'タスク', '優先度', '期限', '状態', '作成日', 'カテゴリ']);
  }
}

function addTask(text, priority, deadline, category) {
  initSheet();
  const sheet = getSheet();
  const id    = new Date().getTime();
  const now   = Utilities.formatDate(new Date(), tz(), 'yyyy/MM/dd');
  sheet.appendRow([id, text, priority || 'MEDIUM', deadline || '', '未完了', now, category || '仕事']);
}

function getTasks() {
  initSheet();
  const rows = getSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map((r, i) => ({
    rowIndex: i + 2,
    id: r[0], text: r[1], priority: r[2],
    deadline: r[3], done: r[4] === '完了', category: r[6]
  }));
}

function getTasksByPriority() {
  const tasks = getTasks().filter(t => !t.done);
  if (tasks.length === 0) return 'タスクなし 🎉';
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  tasks.sort((a, b) => (order[a.priority] || 1) - (order[b.priority] || 1));
  let out = '';
  tasks.forEach((t, i) => {
    const icon = t.priority === 'HIGH' ? '🔴' : t.priority === 'LOW' ? '⚪' : '🟡';
    out += `${i + 1}. ${icon} ${t.text}${t.deadline ? ' (〆' + t.deadline + ')' : ''}\n`;
  });
  out += '\n完了は「✅1」のように番号で送ってね！';
  return out.trim();
}

function formatTaskList() {
  return '📋 現在のタスク\n\n' + getTasksByPriority();
}

function completeTaskByNumber(num) {
  const tasks = getTasks().filter(t => !t.done);
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  tasks.sort((a, b) => (order[a.priority] || 1) - (order[b.priority] || 1));
  if (num < 1 || num > tasks.length) {
    return `⚠️ タスク${num}番は存在しません。\n/tasks で確認してね！`;
  }
  const task = tasks[num - 1];
  getSheet().deleteRow(task.rowIndex);
  return `✅ 完了！「${task.text}」を削除しました！\nお疲れさま！`;
}

// ============================================================
// 9. AI（OpenAI gpt-4o-mini）
// ============================================================
function buildAIPrompt(userMessage) {
  const tasks = getTasksByPriority();
  const now   = Utilities.formatDate(new Date(), tz(), 'yyyy/MM/dd HH:mm');
  return `あなたは梶永瞳さんの専属AI相棒「月詠」です。
現在日時：${now}
現在のタスク状況：
${tasks}
ユーザーのメッセージ：${userMessage}`;
}

function callOpenAI(prompt) {
  const apiKey = getConfig('OPENAI_API_KEY');
  if (!apiKey) return '⚠️ OPENAI_API_KEY が未設定です';

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'あなたは梶永瞳さんの専属AI相棒「月詠」です。気さくで的確、LINEでのやりとりなので簡潔に、でも本質をついた返答をしてください。'
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1024,
    temperature: 0.7
  };

  try {
    const res  = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method:  'post',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText());
    if (data.error) return '⚠️ OpenAI APIエラー: ' + data.error.message;
    return data.choices?.[0]?.message?.content || '（応答なし）';
  } catch (e) {
    return '通信エラー: ' + e.message;
  }
}

// ============================================================
// 10. LINE メッセージ送信
// ============================================================
function replyLine(replyToken, message) {
  const token = getConfig('LINE_ACCESS_TOKEN');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method:  'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: truncate(message, 5000) }]
    }),
    muteHttpExceptions: true
  });
}

function pushLine(userId, message) {
  const token = getConfig('LINE_ACCESS_TOKEN');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method:  'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      to:       userId,
      messages: [{ type: 'text', text: truncate(message, 5000) }]
    }),
    muteHttpExceptions: true
  });
}

function truncate(str, max) {
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}
