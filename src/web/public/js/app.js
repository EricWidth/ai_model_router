let latestModelsPayload = null
let pauseAutoRefresh = false
let refreshInFlight = false
let revealAccessKey = false
let currentTab = 'models'
let eventStream = null
const MODEL_TYPES = ['llm', 'visual', 'multimodal', 'voice', 'vector']
let gatewayFormDraft = {
  port: '8080',
  host: '0.0.0.0',
  cors: true,
  publicModelName: 'custom-model',
  accessApiKey: '',
  adminApiKey: '',
  maxRetries: '3',
  cooldown: '60000',
  healthCheckInterval: '300000'
}
let modelFormDraft = {
  type: 'llm',
  name: '',
  provider: 'aliyun',
  baseUrl: '',
  priority: '1',
  maxTokens: '',
  quota: '',
  jsonConfig: '',
  apiKey: ''
}
let quickAddFormDraft = {
  type: 'llm',
  names: '',
  provider: 'aliyun',
  baseUrl: '',
  priority: '1',
  maxTokens: '',
  quota: '',
  jsonConfig: '',
  apiKey: ''
}

function showUiError(message) {
  const el = document.getElementById('models-error')
  if (!el) return
  el.textContent = message || ''
  el.classList.toggle('hidden', !message)
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    const message =
      payload && payload.error && typeof payload.error.message === 'string'
        ? payload.error.message
        : text || `Request failed: ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.payload = payload
    throw error
  }
  if (response.status === 204) return null
  return response.json()
}

function modelCard(type, model, state, activeModelName) {
  const status = state?.status || 'unknown'
  const isCurrent = activeModelName && model.name === activeModelName
  const quota = Number(model.quota ?? state?.quota ?? 0)
  const used = Number(state?.usedTokens ?? 0)
  const usageClass = getQuotaUsageClass(used, quota)
  const usageText = quota > 0 ? `${used} / ${quota} tokens (${Math.floor((used / quota) * 100)}%)` : `${used} / unlimited tokens`
  return `
    <div class="model-card ${isCurrent ? 'model-card-active' : ''}">
      ${isCurrent ? '<div class="active-badge">当前使用</div>' : ''}
      <h3>${model.name}</h3>
      <div class="meta">provider: ${model.provider}</div>
      <div class="meta">priority: ${model.priority}</div>
      <div class="meta">maxTokens: ${model.maxTokens || '未设置'}${formatMaxTokensSource(model.maxTokensSource)}</div>
      <div class="meta quota-usage ${usageClass}">quota: ${usageText}</div>
      <div class="meta">apiKey: ${model.apiKey || '未设置'}</div>
      <span class="status ${status}">${status}</span>
      <div class="actions">
        <button data-action="activate" data-type="${type}" data-name="${model.name}">立即启用</button>
        <button data-action="update-quota" data-name="${model.name}">更新限额</button>
        <button data-action="update-max-tokens" data-name="${model.name}">更新maxTokens</button>
        <button data-action="update-key" data-name="${model.name}">更新Key</button>
        <button data-action="delete" data-name="${model.name}" class="danger">删除</button>
      </div>
    </div>
  `
}

function renderModels(payload) {
  latestModelsPayload = payload
  const root = document.getElementById('models')
  const sections = MODEL_TYPES

  const sectionHtml = sections
    .map((type) => {
      const models = payload.models[type] || []
      const states = new Map((payload.states[type] || []).map((s) => [s.name, s]))
      const activeModelName = payload.activeModels?.[type] || null
      const cards = models.map((m) => modelCard(type, m, states.get(m.name), activeModelName)).join('')
      return `<h2>${type.toUpperCase()} Models</h2><div class="grid">${cards || '<p>暂无模型</p>'}</div>`
    })
    .join('')

  root.innerHTML = `
    <h2>模型管理</h2>
    <p id="models-error" class="error-banner hidden"></p>
    <form id="add-model-form" class="form-grid">
      <select name="type" required>
        <option value="llm" ${modelFormDraft.type === 'llm' ? 'selected' : ''}>llm</option>
        <option value="visual" ${modelFormDraft.type === 'visual' ? 'selected' : ''}>visual</option>
        <option value="multimodal" ${modelFormDraft.type === 'multimodal' ? 'selected' : ''}>multimodal</option>
        <option value="voice" ${modelFormDraft.type === 'voice' ? 'selected' : ''}>voice</option>
        <option value="vector" ${modelFormDraft.type === 'vector' ? 'selected' : ''}>vector</option>
      </select>
      <input name="name" placeholder="model name" value="${escapeHtml(modelFormDraft.name)}" required />
      <select name="provider" id="provider-select" required>
        <option value="aliyun" ${modelFormDraft.provider === 'aliyun' ? 'selected' : ''}>aliyun</option>
        <option value="openai" ${modelFormDraft.provider === 'openai' ? 'selected' : ''}>openai</option>
      </select>
      <input name="baseUrl" id="base-url-input" placeholder="baseUrl (可选)" value="${escapeHtml(modelFormDraft.baseUrl)}" />
      <input type="number" name="priority" min="1" value="${escapeHtml(modelFormDraft.priority || '1')}" required />
      <input type="number" name="maxTokens" min="1" placeholder="maxTokens (可选)" value="${escapeHtml(modelFormDraft.maxTokens || '')}" />
      <input type="number" name="quota" min="1" placeholder="quota tokens (可选)" value="${escapeHtml(modelFormDraft.quota || '')}" />
      <input name="apiKey" placeholder="API Key" value="${escapeHtml(modelFormDraft.apiKey)}" required />
      <input name="jsonConfig" placeholder='扩展JSON(可选), 如 {"timeout":30000,"enabled":true}' value="${escapeHtml(modelFormDraft.jsonConfig || '')}" />
      <button type="submit">新增模型</button>
    </form>
    ${sectionHtml}
  `

  bindModelActions()
  bindAddModelForm()
  showUiError('')
}

function renderGatewaySettings(settings) {
  const root = document.getElementById('settings')
  if (!root) return
  if (!gatewayFormDraft.port) {
    gatewayFormDraft.port = String(settings.port || 8080)
  }
  if (!gatewayFormDraft.host) {
    gatewayFormDraft.host = String(settings.host || '0.0.0.0')
  }
  if (!gatewayFormDraft.maxRetries) {
    gatewayFormDraft.maxRetries = String(settings.switch?.maxRetries || 3)
  }
  if (!gatewayFormDraft.cooldown) {
    gatewayFormDraft.cooldown = String(settings.switch?.cooldown || 60000)
  }
  if (!gatewayFormDraft.healthCheckInterval) {
    gatewayFormDraft.healthCheckInterval = String(settings.switch?.healthCheckInterval || 300000)
  }
  if (!gatewayFormDraft.publicModelName) {
    gatewayFormDraft.publicModelName = String(settings.publicModelName || 'custom-model')
  }
  gatewayFormDraft.cors = gatewayFormDraft.cors ?? Boolean(settings.cors)

  root.innerHTML = `
    <h2>网关设置</h2>
    <p id="gateway-error" class="error-banner hidden"></p>
    <form id="gateway-form" class="settings-form">
      <label>
        <span>当前端口</span>
        <input type="number" name="port" min="1" max="65535" value="${escapeHtml(gatewayFormDraft.port || settings.port || 8080)}" required />
      </label>
      <label>
        <span>监听主机（host）</span>
        <input name="host" value="${escapeHtml(gatewayFormDraft.host || settings.host || '0.0.0.0')}" required />
      </label>
      <label>
        <span>启用 CORS</span>
        <select name="cors">
          <option value="true" ${(gatewayFormDraft.cors ?? settings.cors) ? 'selected' : ''}>true</option>
          <option value="false" ${!(gatewayFormDraft.cors ?? settings.cors) ? 'selected' : ''}>false</option>
        </select>
      </label>
      <label>
        <span>对外模型名（publicModelName）</span>
        <input name="publicModelName" value="${escapeHtml(gatewayFormDraft.publicModelName || settings.publicModelName || 'custom-model')}" required />
      </label>
      <label>
        <span>Access Key（用于 /v1/* 鉴权）</span>
        <div class="inline-input-group">
          <input id="gateway-access-key" type="${revealAccessKey ? 'text' : 'password'}" name="accessApiKey" value="${escapeHtml(gatewayFormDraft.accessApiKey)}" placeholder="留空表示不修改当前值" />
          <button type="button" id="toggle-access-key-visibility">${revealAccessKey ? '隐藏' : '显示'}</button>
        </div>
      </label>
      <div class="meta">当前密钥：${settings.hasAccessApiKey ? settings.accessApiKey : '未配置'}</div>
      <label>
        <span>Admin Key（用于 /_internal/* 鉴权）</span>
        <input type="password" name="adminApiKey" value="${escapeHtml(gatewayFormDraft.adminApiKey)}" placeholder="留空表示不修改当前值" />
      </label>
      <div class="meta">当前管理密钥：${settings.hasAdminApiKey ? settings.adminApiKey : '未配置'}</div>
      <label>
        <span>自动切换 maxRetries</span>
        <input type="number" name="maxRetries" min="1" value="${escapeHtml(gatewayFormDraft.maxRetries || settings.switch?.maxRetries || 3)}" required />
      </label>
      <label>
        <span>故障冷却 cooldown(ms)</span>
        <input type="number" name="cooldown" min="0" value="${escapeHtml(gatewayFormDraft.cooldown || settings.switch?.cooldown || 60000)}" required />
      </label>
      <label>
        <span>健康检查间隔 healthCheckInterval(ms)</span>
        <input type="number" name="healthCheckInterval" min="0" value="${escapeHtml(gatewayFormDraft.healthCheckInterval || settings.switch?.healthCheckInterval || 300000)}" required />
      </label>
      <button type="submit">保存网关设置</button>
    </form>
  `

  bindGatewayForm()
}

function renderStats(payload) {
  const root = document.getElementById('stats')
  const rows = (payload.metrics || [])
    .map((m) => `<div class="stat-row"><span>${m.type}/${m.modelName}</span><span>total ${m.total} | success ${m.successRate}% | avg ${m.avgResponseMs}ms | tokens ${m.totalTokens} | avgTokens ${m.avgTokensPerCall}</span></div>`)
    .join('')
  root.innerHTML = `<h2>调用统计</h2>${rows || '<p>暂无数据</p>'}`
}

function renderQuickAdd() {
  const root = document.getElementById('quick-add')
  if (!root) return

  root.innerHTML = `
    <h2>快速添加模型</h2>
    <p class="meta">一次输入多个模型名（换行或逗号分隔），其余配置将统一应用到所有模型。</p>
    <p id="quick-add-error" class="error-banner hidden"></p>
    <form id="quick-add-form" class="form-grid">
      <select name="type" required>
        <option value="llm" ${quickAddFormDraft.type === 'llm' ? 'selected' : ''}>llm</option>
        <option value="visual" ${quickAddFormDraft.type === 'visual' ? 'selected' : ''}>visual</option>
        <option value="multimodal" ${quickAddFormDraft.type === 'multimodal' ? 'selected' : ''}>multimodal</option>
        <option value="voice" ${quickAddFormDraft.type === 'voice' ? 'selected' : ''}>voice</option>
        <option value="vector" ${quickAddFormDraft.type === 'vector' ? 'selected' : ''}>vector</option>
      </select>
      <textarea name="names" placeholder="model-A&#10;model-B&#10;model-C" required>${escapeHtml(quickAddFormDraft.names)}</textarea>
      <select name="provider" id="quick-provider-select" required>
        <option value="aliyun" ${quickAddFormDraft.provider === 'aliyun' ? 'selected' : ''}>aliyun</option>
        <option value="openai" ${quickAddFormDraft.provider === 'openai' ? 'selected' : ''}>openai</option>
      </select>
      <input name="baseUrl" id="quick-base-url-input" placeholder="baseUrl (可选)" value="${escapeHtml(quickAddFormDraft.baseUrl)}" />
      <input type="number" name="priority" min="1" value="${escapeHtml(quickAddFormDraft.priority || '1')}" required />
      <input type="number" name="maxTokens" min="1" placeholder="maxTokens (可选)" value="${escapeHtml(quickAddFormDraft.maxTokens || '')}" />
      <input type="number" name="quota" min="1" placeholder="quota tokens (可选)" value="${escapeHtml(quickAddFormDraft.quota || '')}" />
      <input name="apiKey" placeholder="API Key" value="${escapeHtml(quickAddFormDraft.apiKey)}" required />
      <input name="jsonConfig" placeholder='扩展JSON(可选), 如 {"timeout":30000,"enabled":true}' value="${escapeHtml(quickAddFormDraft.jsonConfig || '')}" />
      <button type="submit">批量新增</button>
    </form>
  `

  bindQuickAddForm()
}

function bindAddModelForm() {
  const form = document.getElementById('add-model-form')
  if (!form) return
  const providerSelect = document.getElementById('provider-select')
  const baseUrlInput = document.getElementById('base-url-input')

  const fillDefaultBaseUrl = () => {
    if (!providerSelect || !baseUrlInput) return
    if (baseUrlInput.value.trim()) return
    if (providerSelect.value === 'aliyun') {
      baseUrlInput.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      return
    }
    if (providerSelect.value === 'openai') {
      baseUrlInput.value = 'https://api.openai.com/v1'
    }
  }

  providerSelect?.addEventListener('change', fillDefaultBaseUrl)
  fillDefaultBaseUrl()
  syncDraftFromForm(form)
  form.addEventListener('input', () => syncDraftFromForm(form))
  form.addEventListener('change', () => syncDraftFromForm(form))
  form.addEventListener('focusin', () => {
    pauseAutoRefresh = true
  })
  form.addEventListener('focusout', () => {
    pauseAutoRefresh = false
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    showUiError('')
    const fd = new FormData(form)
    const payload = {
      type: String(fd.get('type')),
      model: {
        name: String(fd.get('name')),
        provider: String(fd.get('provider')),
        apiKey: String(fd.get('apiKey')),
        baseUrl: String(fd.get('baseUrl') || ''),
        priority: Number(fd.get('priority')) || 1,
        maxTokens: Number(fd.get('maxTokens')) || undefined,
        quota: Number(fd.get('quota')) || undefined,
        jsonConfig: String(fd.get('jsonConfig') || '').trim() || undefined
      }
    }

    try {
      await fetchJson('/_internal/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      form.reset()
      modelFormDraft = {
        type: 'llm',
        name: '',
        provider: 'aliyun',
        baseUrl: '',
        priority: '1',
        maxTokens: '',
        quota: '',
        jsonConfig: '',
        apiKey: ''
      }
      await refresh()
    } catch (error) {
      showUiError(`新增失败: ${error.message}`)
    }
  })
}

function bindModelActions() {
  for (const btn of document.querySelectorAll('button[data-action]')) {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action
      const name = btn.dataset.name
      const type = btn.dataset.type

      if (!name) return

      if (action === 'activate') {
        if (!type) return
        try {
          await fetchJson(`/_internal/models/${encodeURIComponent(type)}/${encodeURIComponent(name)}/activate`, {
            method: 'POST'
          })
          await refresh()
        } catch (error) {
          showUiError(`立即启用失败: ${error.message}`)
        }
        return
      }

      if (action === 'delete') {
        if (!confirm(`确认删除模型 ${name} ?`)) return
        try {
          await fetchJson(`/_internal/models/${encodeURIComponent(name)}`, { method: 'DELETE' })
          await refresh()
        } catch (error) {
          showUiError(`删除失败: ${error.message}`)
        }
        return
      }

      if (action === 'update-key') {
        const apiKey = prompt(`请输入 ${name} 的新 API Key`) || ''
        if (!apiKey.trim()) return

        try {
          await fetchJson(`/_internal/models/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: apiKey.trim() })
          })
          await refresh()
        } catch (error) {
          showUiError(`更新失败: ${error.message}`)
        }
        return
      }

      if (action === 'update-max-tokens') {
        const currentModel = findModelByName(name)
        const currentValue = currentModel?.maxTokens ? String(currentModel.maxTokens) : ''
        const maxTokensInput = prompt(`请输入 ${name} 的 maxTokens（清空则移除）`, currentValue)
        if (maxTokensInput === null) return
        const trimmed = maxTokensInput.trim()
        const maxTokens = trimmed ? Number.parseInt(trimmed, 10) : undefined
        if (trimmed && (!Number.isFinite(maxTokens) || maxTokens < 1)) {
          showUiError('maxTokens 必须是大于等于 1 的整数')
          return
        }

        try {
          const body = trimmed
            ? { maxTokens, maxTokensSource: 'manual' }
            : { maxTokens: null, maxTokensSource: null }
          await fetchJson(`/_internal/models/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
          await refresh()
        } catch (error) {
          showUiError(`更新失败: ${error.message}`)
        }
        return
      }

      if (action === 'update-quota') {
        const currentModel = findModelByName(name)
        const currentValue = currentModel?.quota !== undefined ? String(currentModel.quota) : ''
        const quotaInput = prompt(`请输入 ${name} 的限额 quota（清空则移除限额）`, currentValue)
        if (quotaInput === null) return
        const trimmed = quotaInput.trim()
        const quota = trimmed ? Number.parseInt(trimmed, 10) : undefined
        if (trimmed && (!Number.isFinite(quota) || quota < 0)) {
          showUiError('quota 必须是大于等于 0 的整数')
          return
        }

        try {
          await fetchJson(`/_internal/models/${encodeURIComponent(name)}/quota`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quota: trimmed ? quota : null })
          })
          await refresh()
        } catch (error) {
          showUiError(`更新失败: ${error.message}`)
        }
      }
    })
  }
}

function findModelByName(name) {
  if (!latestModelsPayload?.models) return null
  for (const type of MODEL_TYPES) {
    const models = latestModelsPayload.models[type] || []
    const found = models.find((model) => model.name === name)
    if (found) return found
  }
  return null
}

function formatMaxTokensSource(source) {
  if (source === 'manual') return ' (手动设置)'
  if (source === 'learned') return ' (自学习锁定)'
  return ''
}

function bindGatewayForm() {
  const form = document.getElementById('gateway-form')
  if (!form) return
  const errorEl = document.getElementById('gateway-error')
  const toggleBtn = document.getElementById('toggle-access-key-visibility')
  const accessInput = document.getElementById('gateway-access-key')

  toggleBtn?.addEventListener('click', () => {
    revealAccessKey = !revealAccessKey
    if (accessInput) {
      accessInput.type = revealAccessKey ? 'text' : 'password'
    }
    if (toggleBtn) {
      toggleBtn.textContent = revealAccessKey ? '隐藏' : '显示'
    }
  })

  form.addEventListener('input', () => syncGatewayDraft(form))
  form.addEventListener('change', () => syncGatewayDraft(form))
  form.addEventListener('focusin', () => {
    pauseAutoRefresh = true
  })
  form.addEventListener('focusout', () => {
    pauseAutoRefresh = false
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (errorEl) {
      errorEl.textContent = ''
      errorEl.classList.add('hidden')
    }

    const fd = new FormData(form)
    const payload = {
      port: Number(fd.get('port')),
      host: String(fd.get('host') || '').trim(),
      cors: String(fd.get('cors') || '').trim().toLowerCase() === 'true',
      publicModelName: String(fd.get('publicModelName') || '').trim()
    }
    const accessApiKey = String(fd.get('accessApiKey') || '').trim()
    if (accessApiKey) {
      payload.accessApiKey = accessApiKey
    }
    const adminApiKey = String(fd.get('adminApiKey') || '').trim()
    if (adminApiKey) {
      payload.adminApiKey = adminApiKey
    }
    payload.maxRetries = Number(fd.get('maxRetries'))
    payload.cooldown = Number(fd.get('cooldown'))
    payload.healthCheckInterval = Number(fd.get('healthCheckInterval'))

    try {
      const result = await fetchJson('/_internal/settings/gateway', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (result.restartRequired && errorEl) {
        errorEl.textContent = '端口已更新，需重启服务后生效。'
        errorEl.classList.remove('hidden')
      }
      gatewayFormDraft = {
        port: String(result.port || payload.port || ''),
        host: String(result.host || payload.host || ''),
        cors: Boolean(result.cors ?? payload.cors),
        publicModelName: String(result.publicModelName || payload.publicModelName || 'custom-model'),
        accessApiKey: '',
        adminApiKey: '',
        maxRetries: String(result.switch?.maxRetries || payload.maxRetries || 3),
        cooldown: String(result.switch?.cooldown || payload.cooldown || 60000),
        healthCheckInterval: String(result.switch?.healthCheckInterval || payload.healthCheckInterval || 300000)
      }
      await refresh()
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = `保存失败: ${error.message}`
        errorEl.classList.remove('hidden')
      }
    }
  })
}

function bindQuickAddForm() {
  const form = document.getElementById('quick-add-form')
  if (!form) return
  const providerSelect = document.getElementById('quick-provider-select')
  const baseUrlInput = document.getElementById('quick-base-url-input')
  const errorEl = document.getElementById('quick-add-error')

  const fillDefaultBaseUrl = () => {
    if (!providerSelect || !baseUrlInput) return
    if (baseUrlInput.value.trim()) return
    if (providerSelect.value === 'aliyun') {
      baseUrlInput.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      return
    }
    if (providerSelect.value === 'openai') {
      baseUrlInput.value = 'https://api.openai.com/v1'
    }
  }

  providerSelect?.addEventListener('change', fillDefaultBaseUrl)
  fillDefaultBaseUrl()
  syncQuickAddDraft(form)
  form.addEventListener('input', () => syncQuickAddDraft(form))
  form.addEventListener('change', () => syncQuickAddDraft(form))
  form.addEventListener('focusin', () => {
    pauseAutoRefresh = true
  })
  form.addEventListener('focusout', () => {
    pauseAutoRefresh = false
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    showQuickAddMessage('')
    const fd = new FormData(form)
    const names = parseModelNames(String(fd.get('names') || ''))
    if (names.length === 0) {
      showQuickAddMessage('请至少输入一个模型名')
      return
    }

    const payload = {
      type: String(fd.get('type')),
      names,
      model: {
        provider: String(fd.get('provider')),
        apiKey: String(fd.get('apiKey')),
        baseUrl: String(fd.get('baseUrl') || ''),
        priority: Number(fd.get('priority')) || 1,
        maxTokens: Number(fd.get('maxTokens')) || undefined,
        quota: Number(fd.get('quota')) || undefined,
        jsonConfig: String(fd.get('jsonConfig') || '').trim() || undefined
      }
    }

    try {
      const result = await fetchJson('/_internal/models/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const failedNames = Array.isArray(result?.failedNames) ? result.failedNames : []
      if (failedNames.length > 0) {
        if (result.createdCount > 0) {
          showQuickAddFailure(`部分成功：新增 ${result.createdCount} 个，以下模型已存在并跳过`, failedNames)
        } else {
          showQuickAddFailure('未新增：以下模型已存在', failedNames)
        }
      } else {
        showQuickAddMessage(`新增成功：${result.createdCount} 个模型`, true)
      }
      quickAddFormDraft = {
        type: String(fd.get('type') || 'llm'),
        names: '',
        provider: String(fd.get('provider') || 'aliyun'),
        baseUrl: String(fd.get('baseUrl') || ''),
        priority: String(fd.get('priority') || '1'),
        maxTokens: String(fd.get('maxTokens') || ''),
        quota: String(fd.get('quota') || ''),
        jsonConfig: String(fd.get('jsonConfig') || ''),
        apiKey: String(fd.get('apiKey') || '')
      }
      const namesInput = form.querySelector('textarea[name="names"]')
      if (namesInput) namesInput.value = ''
      await refresh()
    } catch (error) {
      const failedNames = error?.payload?.error?.details?.failedNames
      const message = errorEl ? `批量新增失败: ${error.message}` : '批量新增失败'
      showQuickAddFailure(message, failedNames)
    }
  })
}

async function refresh() {
  if (refreshInFlight) return
  refreshInFlight = true
  try {
    const [models, stats, gateway] = await Promise.all([
      fetchJson('/_internal/models'),
      fetchJson('/_internal/stats'),
      fetchJson('/_internal/settings/gateway')
    ])
    renderModels(models)
    renderQuickAdd()
    renderStats(stats)
    renderGatewaySettings(gateway)
  } catch (error) {
    document.getElementById('models').innerHTML = `<p>加载失败: ${error.message}</p>`
  } finally {
    refreshInFlight = false
  }
}

for (const btn of document.querySelectorAll('nav button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    const tab = btn.dataset.tab
    currentTab = tab
    toggleTab('models', tab === 'models')
    toggleTab('quick-add', tab === 'quick-add')
    toggleTab('stats', tab === 'stats')
    toggleTab('settings', tab === 'settings')
  })
}

const manualRefreshBtn = document.getElementById('manual-refresh-btn')
manualRefreshBtn?.addEventListener('click', () => {
  void refresh()
})

refresh()
setupRealtimeRefresh()

function syncDraftFromForm(form) {
  const fd = new FormData(form)
  modelFormDraft = {
    type: String(fd.get('type') || 'llm'),
    name: String(fd.get('name') || ''),
    provider: String(fd.get('provider') || 'aliyun'),
    baseUrl: String(fd.get('baseUrl') || ''),
    priority: String(fd.get('priority') || '1'),
    maxTokens: String(fd.get('maxTokens') || ''),
    quota: String(fd.get('quota') || ''),
    jsonConfig: String(fd.get('jsonConfig') || ''),
    apiKey: String(fd.get('apiKey') || '')
  }
}

function syncGatewayDraft(form) {
  const fd = new FormData(form)
  gatewayFormDraft = {
    port: String(fd.get('port') || gatewayFormDraft.port || '8080'),
    host: String(fd.get('host') || gatewayFormDraft.host || '0.0.0.0'),
    cors: String(fd.get('cors') || String(gatewayFormDraft.cors)) === 'true',
    publicModelName: String(fd.get('publicModelName') || gatewayFormDraft.publicModelName || 'custom-model'),
    accessApiKey: String(fd.get('accessApiKey') || ''),
    adminApiKey: String(fd.get('adminApiKey') || ''),
    maxRetries: String(fd.get('maxRetries') || gatewayFormDraft.maxRetries || '3'),
    cooldown: String(fd.get('cooldown') || gatewayFormDraft.cooldown || '60000'),
    healthCheckInterval: String(fd.get('healthCheckInterval') || gatewayFormDraft.healthCheckInterval || '300000')
  }
}

function syncQuickAddDraft(form) {
  const fd = new FormData(form)
  quickAddFormDraft = {
    type: String(fd.get('type') || 'llm'),
    names: String(fd.get('names') || ''),
    provider: String(fd.get('provider') || 'aliyun'),
    baseUrl: String(fd.get('baseUrl') || ''),
    priority: String(fd.get('priority') || '1'),
    maxTokens: String(fd.get('maxTokens') || ''),
    quota: String(fd.get('quota') || ''),
    jsonConfig: String(fd.get('jsonConfig') || ''),
    apiKey: String(fd.get('apiKey') || '')
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\"', '&quot;')
}

function getQuotaUsageClass(used, quota) {
  if (!quota || quota <= 0 || used <= 0) return ''
  const percent = (used / quota) * 100
  if (percent >= 90) return 'quota-danger'
  if (percent > 80 && percent < 90) return 'quota-warning'
  if (percent >= 70 && percent < 80) return 'quota-light-warning'
  if (percent <= 70) return 'quota-ok'
  return ''
}

function setupRealtimeRefresh() {
  if (eventStream) return
  const connect = () => {
    if (eventStream) {
      eventStream.close()
    }

    eventStream = new EventSource('/events')
    eventStream.onmessage = () => {
      if (pauseAutoRefresh) return
      void refresh()
    }
    eventStream.onerror = () => {
      eventStream?.close()
      eventStream = null
      setTimeout(() => {
        connect()
      }, 2000)
    }
  }

  connect()
}

function parseModelNames(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function showQuickAddMessage(message, success = false) {
  const el = document.getElementById('quick-add-error')
  if (!el) return
  el.textContent = message || ''
  el.classList.toggle('hidden', !message)
  el.classList.toggle('success', Boolean(success))
}

function showQuickAddFailure(message, failedNames = []) {
  const el = document.getElementById('quick-add-error')
  if (!el) return
  const names = Array.isArray(failedNames) ? failedNames.filter(Boolean) : []
  if (names.length === 0) {
    showQuickAddMessage(message)
    return
  }
  const escaped = names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')
  el.innerHTML = `${escapeHtml(message)}<ul class="failed-list">${escaped}</ul>`
  el.classList.remove('hidden')
  el.classList.remove('success')
}

function toggleTab(tabId, active) {
  const el = document.getElementById(tabId)
  if (!el) return
  el.classList.toggle('hidden', !active)
}
