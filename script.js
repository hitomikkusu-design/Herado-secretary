/**
 * 月音香 Tsukineka — script.js
 *
 * 1. フェードイン（スクロール連動）
 * 2. セッション申し込みフォーム送信 → 完了表示 → LINE ボタン表示
 */

'use strict';

/* -----------------------------------------------
   1. フェードイン（IntersectionObserver）
----------------------------------------------- */
(function initFadeIn() {
  const targets = document.querySelectorAll('.fade-in');

  if (!('IntersectionObserver' in window)) {
    // 非対応ブラウザは全て即表示
    targets.forEach(function (el) { el.classList.add('visible'); });
    return;
  }

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach(function (el) { observer.observe(el); });
})();


/* -----------------------------------------------
   2. セッション申し込みフォーム送信処理
      実装方式：B — Formspree（fetch 送信）
      フォームの action に Formspree の URL をセットしてください。
----------------------------------------------- */
(function initSessionForm() {
  var form    = document.getElementById('session-form');
  var success = document.getElementById('form-success');
  var submitBtn = document.getElementById('submit-btn');

  if (!form || !success) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var action = form.getAttribute('action');

    // 未設定チェック（開発時のフォールバック）
    if (!action || action.indexOf('YOUR_FORMSPREE_ID') !== -1) {
      showSuccess();
      return;
    }

    // ボタンを送信中に変更
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中…';

    var data = new FormData(form);

    fetch(action, {
      method: 'POST',
      body: data,
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) {
        if (res.ok) {
          showSuccess();
        } else {
          return res.json().then(function (json) {
            throw new Error(json.error || '送信エラー');
          });
        }
      })
      .catch(function (err) {
        console.error('[TsuninekaForm] 送信失敗:', err);
        submitBtn.disabled = false;
        submitBtn.textContent = '申し込む';
        alert('送信に失敗しました。時間をおいて再度お試しいただくか、直接ご連絡ください。');
      });
  });

  /**
   * 送信完了後の表示切り替え
   * - フォームを非表示
   * - 完了メッセージ（LINE ボタン含む）を表示
   */
  function showSuccess() {
    form.setAttribute('hidden', '');
    success.removeAttribute('hidden');

    // スムーズスクロールで完了メッセージへ
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
})();
