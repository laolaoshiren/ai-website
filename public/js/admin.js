/**
 * 后台管理交互
 */

// 测试 AI 连接
async function testConnection() {
  var resultEl = document.getElementById('connectionResult');
  if (!resultEl) return;

  var form = document.getElementById('settingsForm');
  var baseUrl = form.querySelector('[name="ai_base_url"]').value;
  var apiKey = form.querySelector('[name="ai_api_key"]').value;
  var model = form.querySelector('[name="ai_model"]').value;

  if (!apiKey) {
    resultEl.style.display = 'block';
    resultEl.className = 'connection-result error';
    resultEl.textContent = '❌ 请先填写 API Key';
    return;
  }

  resultEl.style.display = 'block';
  resultEl.className = 'connection-result';
  resultEl.style.background = '#fef3c7';
  resultEl.style.color = '#92400e';
  resultEl.textContent = '⏳ 正在测试连接...';

  try {
    var resp = await fetch('/admin/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_base_url: baseUrl, ai_api_key: apiKey, ai_model: model })
    });
    var data = await resp.json();

    if (data.success) {
      resultEl.className = 'connection-result success';
      resultEl.innerHTML = '✅ 连接成功！模型: ' + data.model + '<br>回复: ' + data.message;
    } else {
      resultEl.className = 'connection-result error';
      resultEl.innerHTML = '❌ 连接失败: ' + data.error;
    }
  } catch (err) {
    resultEl.className = 'connection-result error';
    resultEl.textContent = '❌ 请求失败: ' + err.message;
  }
}
