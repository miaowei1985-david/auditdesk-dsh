window.__ModuleLoader__.load({
  id: '@local/dsh-audit-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // DSH 原生 UI 原子组件；取不到时降级为等价原生元素，避免整个插件加载失败
    let primitiveModule = null
    try {
      primitiveModule = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (err) {
      try { console.error('[auditdesk] ui primitives unavailable, falling back:', err) } catch (e2) {}
    }
    const ui = primitiveModule || (function () {
      const Btn = function (p) {
        const base = { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', fontSize: '12px', padding: '6px 10px', borderRadius: '7px', cursor: 'pointer' }
        if (p.variant === 'primary') { base.border = '0'; base.background = 'var(--dsw-alias-brand-primary)'; base.color = 'var(--dsw-alias-label-primary-foreground)' }
        if (p.variant === 'ghost') { base.border = '0'; base.color = 'var(--dsw-alias-brand-primary)' }
        return h('button', { type: 'button', onClick: p.onClick, disabled: p.disabled, title: p.title, style: Object.assign(base, p.style || {}) }, p.children)
      }
      const Inp = function (p) {
        const rest = Object.assign({}, p)
        delete rest.children
        return h('input', Object.assign({ style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', fontSize: '13px' } }, rest))
      }
      const TagF = function (p) {
        return h('span', { title: p.title, style: { fontSize: '11px', padding: '1px 7px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, p.children)
      }
      const Dot = function (p) {
        const color = p.state === 'done' ? 'var(--dsw-alias-state-success-primary)'
          : p.state === 'warning' ? 'var(--dsw-alias-state-warn-primary)'
          : p.state === 'error' ? 'var(--dsw-alias-state-error-primary)'
          : 'var(--dsw-alias-label-secondary)'
        return h('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: color } })
      }
      const TabsF = function (p) {
        return h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, (p.items || []).map(function (it) {
          return h('button', { key: it.value, type: 'button', onClick: function () { if (p.onChange) p.onChange(it.value) },
            style: { border: '0', cursor: 'pointer', fontSize: '12px', padding: '6px 10px', borderRadius: '7px', color: 'inherit', background: p.value === it.value ? 'var(--dsw-alias-bg-layer-2)' : 'transparent' } }, it.label)
        }))
      }
      const ModalF = function (p) {
        if (!p.open) return null
        return h('div', { style: { position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)' } },
          h('div', { style: { background: 'var(--dsw-alias-bg-layer-1)', borderRadius: '14px', padding: '18px', width: 'min(920px,94vw)', maxHeight: '86vh', overflow: 'auto' } },
            p.title ? h('div', { style: { fontWeight: 600, fontSize: '18px', marginBottom: '10px' } }, p.title) : null,
            p.description ? h('div', { className: 'ad-sub', style: { marginBottom: '12px' } }, p.description) : null,
            p.children,
            p.footer ? h('div', { style: { marginTop: '14px' } }, p.footer) : null))
      }
      return { Button: Btn, Input: Inp, Tag: TagF, StateDot: Dot, SegmentedTabs: TabsF, Modal: ModalF }
    })()

    // 网关地址：直链优先，自动回退（链路本地 → 直链静态IP → Bonjour → Tailscale）
    const GATEWAY_KEY = 'auditdesk.gateway'
    const GATEWAY_CANDIDATES = [
      'http://169.254.163.107:8030',              // Thunderbolt/USB 直链（链路本地，最快）
      'http://192.168.2.2:8030',                  // 直链（如已配静态 IP）
      'http://macmini4prodemac-mini.local:8030',  // Bonjour 自动发现
      'http://100.101.170.7:8030',                // Tailscale（兜底）
    ]
    function readGatewayOverride() {
      try { return localStorage.getItem(GATEWAY_KEY) || '' } catch (e) { return '' }
    }
    let BASE = readGatewayOverride() || GATEWAY_CANDIDATES[0]
    let gatewayProbe = null
    let gatewayInfo = { url: BASE, via: '未探测' }
    function probeGateway(timeoutMs) {
      if (gatewayProbe) return gatewayProbe
      const override = readGatewayOverride()
      const candidates = override
        ? [override].concat(GATEWAY_CANDIDATES.filter(function (url) { return url !== override }))
        : GATEWAY_CANDIDATES.slice()
      gatewayProbe = Promise.all(candidates.map(function (url) {
        const controller = new AbortController()
        const timer = setTimeout(function () { controller.abort() }, timeoutMs || 1800)
        return fetch(url + '/health', { signal: controller.signal })
          .then(function (resp) { clearTimeout(timer); return resp.ok ? url : null })
          .catch(function () { clearTimeout(timer); return null })
      })).then(function (results) {
        const hit = results.filter(Boolean)[0]
        if (hit) {
          BASE = hit
          gatewayInfo = { url: hit, via: hit === GATEWAY_CANDIDATES[0] ? '直链' : hit === GATEWAY_CANDIDATES[3] ? 'Tailscale' : '备用地址' }
          try { localStorage.setItem(GATEWAY_KEY, hit) } catch (e) {}
        }
        return BASE
      })
      return gatewayProbe
    }
    probeGateway()
    const AUTH_KEY = 'auditdesk.auth'
    let authState = { token: null, user: null }
    try {
      const saved = localStorage.getItem(AUTH_KEY)
      if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.token && parsed.user) authState = parsed }
    } catch (e) {}
    const authListeners = new Set()
    function setAuth(token, user) {
      authState = { token: token || null, user: user || null }
      try {
        if (authState.token) localStorage.setItem(AUTH_KEY, JSON.stringify(authState))
        else localStorage.removeItem(AUTH_KEY)
      } catch (e) {}
      authListeners.forEach(function (listener) { try { listener() } catch (e) {} })
    }
    function currentToken() {
      if (!authState.token) throw new Error('未登录')
      return authState.token
    }
    function useAuth() {
      const version = React.useState(0)[1]
      React.useEffect(function () {
        const listener = function () { version(function (value) { return value + 1 }) }
        authListeners.add(listener)
        return function () { authListeners.delete(listener) }
      }, [])
      return {
        token: authState.token,
        user: authState.user,
        login: function (username, password) {
          return fetch(BASE + '/audit/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password }),
          }).then(function (resp) {
            return resp.json().then(function (data) {
              if (!resp.ok) throw new Error(data && data.detail ? data.detail : '登录失败')
              setAuth(data.token, data.user)
              return data.user
            })
          })
        },
        logout: function () {
          const token = authState.token
          setAuth(null, null)
          if (token) fetch(BASE + '/audit/logout', { method: 'POST', headers: { 'X-KB-Token': token } }).catch(function () {})
        },
      }
    }

    function LoginForm() {
      const auth = useAuth()
      const usernameState = React.useState('')
      const passwordState = React.useState('')
      const errorState = React.useState('')
      const loadingState = React.useState(false)
      const username = usernameState[0]; const setUsername = usernameState[1]
      const password = passwordState[0]; const setPassword = passwordState[1]
      const error = errorState[0]; const setError = errorState[1]
      const loading = loadingState[0]; const setLoading = loadingState[1]
      function submit(event) {
        if (event) event.preventDefault()
        if (loading) return
        setLoading(true); setError('')
        auth.login(username.trim(), password).catch(function (cause) { setError(String(cause.message || cause)) }).then(function () { setLoading(false) })
      }
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '13px', marginBottom: '10px' }
      return h('div', { style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.text } },
        h('form', { onSubmit: submit, style: { width: '320px', padding: '24px', borderRadius: '14px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
          h('div', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '6px' } }, '登录 AuditDesk'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '16px' } }, '用项目组账号登录；不同角色权限不同（演示账号见下）'),
          h(ui.Input, { className: 'ad-plain', value: username, onChange: function (e) { setUsername(e.target.value) }, placeholder: '用户名', autoFocus: true, style: inputStyle }),
          h(ui.Input, { className: 'ad-plain', value: password, onChange: function (e) { setPassword(e.target.value) }, placeholder: '密码', type: 'password', style: inputStyle }),
          error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '10px' } }, error) : null,
          h('button', { type: 'submit', disabled: loading, style: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '13px', cursor: 'pointer' } }, loading ? '登录中…' : '登录'),
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '12px', lineHeight: 1.7 } },
            '演示账号：auditor/auditor123（审计员）、manager/manager123（项目经理）、partner/partner123（合伙人）、admin/admin123（管理员）')))
    }

    function withAuth(PageComponent) {
      return function AuthenticatedPage(props) {
        ensureAuditUi()
        const auth = useAuth()
        if (!auth.user) return h(LoginForm, null)
        return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', padding: '5px 14px', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px', flexShrink: 0 } },
            h('span', { style: { color: COLORS.muted } }, auth.user.name + '（' + auth.user.role + '）'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: auth.logout, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '退出')),
          h('div', { style: { flex: 1, minHeight: 0 } }, h(PageComponent, Object.assign({}, props, { auth: auth }))))
      }
    }

    const CAT = {
      'K-01': '审计准则', 'K-02': '会计准则', 'K-03': '税法征管', 'K-04': '监管案例',
      'K-05': '职业道德', 'K-06': '质量控制', 'K-07': '底稿模板', 'K-08': '客户档案',
      'K-09': '历史经验', 'K-10': '行业专精', 'K-11': '银行函证', 'K-12': '法律法规', 'K-13': '重要性参数',
    }
    const COLORS = { text: 'var(--dsw-alias-label-primary)', muted: 'var(--dsw-alias-label-secondary)', line: 'var(--dsw-alias-border-l1)', accent: 'var(--dsw-alias-brand-primary)', bg: 'var(--dsw-alias-bg-layer-1)' }
    const AUDIT_UI_CSS = [
      '.ad-page{height:100%;overflow:auto;box-sizing:border-box;padding:20px 24px 56px;color:var(--dsw-alias-label-primary);background:transparent}',
      'body:not([data-ds-dark-theme]) .ad-page{background:var(--dsw-static-neutral-bluish-75)}',
      '.ad-page-inner{max-width:1080px}',
      '.ad-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:18px}',
      '.ad-title{margin:0;font-size:22px;font-weight:650;letter-spacing:-0.03em;line-height:1.15}',
      '.ad-sub{margin-top:6px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.ad-actions,.ad-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.ad-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin:0 0 16px}',
      '.ad-kpi{padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      '.ad-kpi-link{transition:border-color .15s ease,background .15s ease}',
      '.ad-kpi-link:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      'body:not([data-ds-dark-theme]) .ad-kpi{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-kpi-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
      '.ad-kpi-value{font-size:22px;font-weight:650;letter-spacing:-0.03em;font-variant-numeric:tabular-nums}',
      '.ad-kpi-hint{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ad-card{margin:0 0 14px;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      'body:not([data-ds-dark-theme]) .ad-card{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:16px;flex-wrap:wrap}',
      '.ad-tab{border:0;background:transparent;padding:8px 12px;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary);border-bottom:2px solid transparent;margin-bottom:-1px}',
      '.ad-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.ad-tab.on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.ad-btn{padding:7px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}',
      '.ad-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ad-btn.primary{border:0;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
      '.ad-btn.primary:hover{filter:brightness(1.06)}',
      '.ad-actions>.ad-btn,.ad-actions>.ad-btn.quiet{min-height:30px;display:inline-flex;align-items:center;box-sizing:border-box}',
      '.ad-actions>details{min-height:30px;display:inline-flex;align-items:center}',
      '.ad-actions>details>summary{margin-bottom:0}',
      '.ad-btn.quiet{border:0;background:transparent;color:var(--dsw-alias-brand-primary);padding:4px 8px}',
      '.ad-btn.quiet:hover{background:var(--dsw-alias-interactive-bg-hover);border-radius:6px}',
      '.ad-btn:disabled{opacity:.5;cursor:default}',
      '.ad-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font-size:13px}',
      '.ad-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.ad-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 12px;margin-bottom:8px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}',
      'body:not([data-ds-dark-theme]) .ad-form{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ad-form-actions{display:flex;align-items:flex-end}',
      '.ad-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 4px;border-bottom:.5px solid var(--dsw-alias-border-l3)}',
      '.ad-row:last-child{border-bottom:0}',
      '.ad-row-title{font-size:13px;font-weight:600}',
      '.ad-row-meta{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ad-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.ad-pill.ok{color:var(--dsw-alias-state-success-primary)}',
      '.ad-pill.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.ad-rail{width:248px;flex-shrink:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill)}',
      '.ad-rail-h{display:flex;justify-content:space-between;align-items:center;padding:16px 14px 8px;font-size:13px;font-weight:650}',
      '.ad-nav{margin:1px 8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px}',
      '.ad-nav:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ad-nav.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}',
      '.ad-doc{padding:28px 36px 56px;max-width:760px}',
      '.ad-doc-title{margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:-0.03em}',
      '.ad-chunk{margin:0 0 20px}',
      '.ad-chunk-h{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}',
      '.ad-note{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:1.5}',
      'body:not([data-ds-dark-theme]) .ad-note{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-zones{display:flex;gap:18px;padding:8px 16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;align-items:flex-end}',
      '.ad-zone-group{display:flex;align-items:flex-end;gap:2px}',
      '.ad-zone-group+.ad-zone-group{border-left:1px solid var(--dsw-alias-border-l2);padding-left:16px}',
      '.ad-zone-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:2px 9px;margin:0 8px 8px 0;white-space:nowrap;letter-spacing:0}',
      '.ad-next{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}',
      '.ad-next-card{padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
      'body:not([data-ds-dark-theme]) .ad-next-card{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-next-card:hover{box-shadow:var(--dsw-shadow-lv2)}',
      '.ad-split{display:flex;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}',
      '.ad-zone-page{height:100%;overflow:auto;box-sizing:border-box;padding:20px 24px 56px;background:transparent}',
      'body:not([data-ds-dark-theme]) .ad-zone-page{background:var(--dsw-static-neutral-bluish-75)}',
      '.ad-more{margin:0 0 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ad-more summary{list-style:none;cursor:pointer;margin-bottom:8px;display:inline-flex;align-items:center;gap:6px;user-select:none;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ad-more summary::-webkit-details-marker{display:none}',
      '.ad-more summary::before{content:"+";display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary)}',
      '.ad-more[open] summary::before{content:"\\2212"}',
      '.ad-more summary:hover{color:var(--dsw-alias-label-primary)}',
      '.ad-tile{flex:1 1 260px;min-width:260px;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      '.ad-iw{width:100%;box-sizing:border-box}',
      '.ad-iw input{width:100%;background:transparent;border:0;outline:none;color:inherit;font-size:13px}',
      '.ad-plain input{padding:0 !important;border:0 !important;background:transparent !important;color:inherit !important;font-size:13px !important;outline:none}',
      '.ad-ml6{margin-left:6px}',
      '.ad-tabs-fit{width:fit-content}',
      '.ad-flow{display:inline-flex;align-items:center;gap:12px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ad-flow-step{display:inline-flex;align-items:center;gap:4px}',
      '.ad-flow-step+.ad-flow-step::before{content:\'\';width:14px;height:1px;background:var(--dsw-alias-border-l3);margin-right:4px}',
      '.ad-client-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}',
      '.ad-client-card{padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      '.ad-ring{flex:none}',
      '.ad-bar-track{height:5px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden;margin-top:3px}',
      '.ad-bar-fill{height:100%;border-radius:3px}',
      '.ad-metric-head{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.ad-metric-val{font-variant-numeric:tabular-nums}',
      '.ad-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:10px}',
      '.ad-prog-grid{display:flex;align-items:flex-end;gap:3px;height:30px;margin-top:6px}',
      '.ad-prog-cell{flex:1;height:100%;display:flex;align-items:flex-end;background:var(--dsw-alias-bg-layer-2);border-radius:2px;overflow:hidden}',
      '.ad-prog-fill{width:100%;background:var(--dsw-alias-state-business-primary);border-radius:2px}',
      '.ad-prog-item{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;border-bottom:0.5px solid var(--dsw-alias-border-l3)}',
      '.ad-prog-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ad-prog-item-status{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.ad-th{font-size:11px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2);padding:3px 0 4px;margin-bottom:2px}',
      'mark{background:rgba(250,204,21,0.32);color:inherit;border-radius:2px;padding:0 1px}',
      '.ad-modal-wide{width:min(920px,94vw) !important}',
      '.ad-modal-wide .ad-form{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}',
      '.ad-cats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin-top:2px}',
      '.ad-modal-scroll{max-height:56vh;overflow:auto}',
      '.ad-cat-tree{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;margin-top:6px}',
      '.ad-cat-block{min-width:0}',
      '.ad-cat-name{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.ad-cat-items{margin:2px 0 0 22px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.ad-cat-item{display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
      '.ad-cat-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1.4}',
      '.ad-staff-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px}',
      '.ad-staff-label{width:64px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.ad-staff-x{width:44px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.ad-staff-unit{width:36px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.ad-staff-input{width:72px;flex:none}',
      '.ad-staff-input input{width:100%;box-sizing:border-box}',
      '.ad-tile.wide{flex:2 1 420px;min-width:420px}',
      'body:not([data-ds-dark-theme]) .ad-tile{box-shadow:var(--dsw-shadow-lv1),var(--dsw-shadow-lv1-blur)}',
      '.ad-card summary{list-style:none;cursor:pointer}',
      '.ad-card summary::-webkit-details-marker{display:none}',
    ].join('')
    function ensureAuditUi() {
      if (typeof document === 'undefined') return
      let style = document.getElementById('auditdesk-ui')
      if (!style) {
        style = document.createElement('style')
        style.id = 'auditdesk-ui'
        document.head.appendChild(style)
      }
      if (style.textContent !== AUDIT_UI_CSS) style.textContent = AUDIT_UI_CSS
    }

    // 角色分组：权限判断统一走这里，改规则只改一处
    const ROLE_GROUPS = {
      manage: ['manager', 'partner', 'kb-admin', 'admin'],   // 可审批、可确认重要性
      partner: ['partner', 'kb-admin', 'admin'],              // 可定稿、可解除归档
      admin: ['kb-admin', 'admin'],                           // 可管用户/系统/KB
    }
    function inRole(role, group) {
      const list = ROLE_GROUPS[group] || []
      return list.indexOf(String(role || '')) >= 0
    }

    function api(path, params, options) {
      const url = new URL(BASE + path)
      Object.keys(params || {}).forEach(function (key) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') url.searchParams.set(key, params[key])
      })
      const opts = options || {}
      const headers = { 'X-KB-Token': currentToken() }
      if (opts.body) headers['Content-Type'] = 'application/json'
      const doFetch = function () {
        return fetch(url.toString(), {
          method: opts.method || 'GET',
          headers: headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        })
      }
      return doFetch().catch(function (error) {
        // 网络层失败（如直链断开）→ 重新探测网关后重试一次
        gatewayProbe = null
        return probeGateway(1200).then(function () {
          const retry = new URL(BASE + path)
          Object.keys(params || {}).forEach(function (key) {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') retry.searchParams.set(key, params[key])
          })
          return fetch(retry.toString(), {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
          })
        }).catch(function () { throw error })
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (text) {
            // 后端一般会给中文 detail；没有时不要直接把状态码甩给用户
            let message = resp.status >= 500 ? '服务暂时不可用，请稍后重试'
              : resp.status === 403 ? '没有权限执行该操作'
              : resp.status === 404 ? '数据不存在或已被删除'
              : '请求未成功（' + resp.status + '）'
            try {
              const data = JSON.parse(text)
              const detail = data && data.detail
              if (typeof detail === 'string') message = detail
              else if (detail && typeof detail.message === 'string') message = detail.message
            } catch (e) {}
            throw new Error(message)
          })
        }
        return resp.json()
      })
    }

    function Badge(props) {
      const tone = props.tone === 'ok' ? 'success' : props.tone === 'warn' ? 'warning' : props.tone === 'bad' ? 'danger' : 'neutral'
      return h(ui.Tag, { tone: tone }, props.children)
    }

    // 三态复选框（全选/半选/未选）
    function CatCheck(props) {
      const ref = React.useRef(null)
      React.useEffect(function () {
        if (ref.current) ref.current.indeterminate = Boolean(props.indeterminate)
      }, [props.indeterminate])
      return h('input', { ref: ref, type: 'checkbox', checked: Boolean(props.checked), onChange: props.onChange })
    }

    // 状态胶囊：内部走 DSH 原生 Tag
    function AStatus(props) {
      const tone = props.tone === 'ok' ? 'success' : props.tone === 'warn' ? 'warning' : props.tone === 'bad' ? 'danger' : 'neutral'
      return h(ui.Tag, { tone: tone, className: props.className }, props.children)
    }

    const PROG_STATE = function (status) {
      return status === '已完成' ? 'done' : status === '进行中' ? 'warning' : status === '不适用' ? 'idle' : 'idle'
    }
    // 年报审计的 13 个科目循环（与后端 program_catalog 一致）
    const PROGRAM_CATEGORIES = [
      '计划与风险评估', '货币资金', '应收账款', '存货', '固定资产与无形资产', '收入与成本',
      '借款与利息', '应付及其他应付款', '应付职工薪酬', '应交税费', '所有者权益',
      '特殊项目', '完成阶段'
    ]

    // 环形进度（SVG，不依赖图表库）
    function Ring(props) {
      const pct = Math.max(0, Math.min(100, Math.round(props.value || 0)))
      const r = 20
      const c = 2 * Math.PI * r
      return h('svg', { className: 'ad-ring', width: 56, height: 56, viewBox: '0 0 56 56' },
        h('circle', { cx: 28, cy: 28, r: r, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 5 }),
        h('circle', { cx: 28, cy: 28, r: r, fill: 'none', stroke: 'var(--dsw-alias-state-business-primary)', strokeWidth: 5,
          strokeDasharray: String(c), strokeDashoffset: String(c * (1 - pct / 100)), strokeLinecap: 'round', transform: 'rotate(-90 28 28)' }),
        h('text', { x: 28, y: 32, textAnchor: 'middle', fontSize: 12, fill: 'var(--dsw-alias-label-primary)' }, pct + '%'))
    }

    // 单项指标条
    function MetricBar(props) {
      const pct = Math.max(0, Math.min(100, Math.round(props.value || 0)))
      return h('div', null,
        h('div', { className: 'ad-metric-head' },
          h('span', null, props.label),
          h('span', { className: 'ad-metric-val' }, pct + '%')),
        h('div', { className: 'ad-bar-track' },
          h('div', { className: 'ad-bar-fill', style: { width: pct + '%', background: props.color } })))
    }
    function ClientFlow(props) {
      const f = props.flow || {}
      const steps = [
        { label: '准入', state: f.admission || 'idle' },
        { label: '合同', state: f.contract || 'idle' },
        { label: '立项', state: f.engagement || 'idle' },
        { label: '执行', state: f.execution || 'idle' },
        { label: '归档', state: f.archive || 'idle' }
      ]
      return h('div', { className: 'ad-flow' }, steps.map(function (st) {
        return h('span', { key: st.label, className: 'ad-flow-step' },
          h(ui.StateDot, { state: st.state }),
          h('span', null, st.label))
      }))
    }

    function Section(props) {
      return h('div', { style: { borderBottom: '1px solid ' + COLORS.line, padding: '10px 14px' } }, props.children)
    }

    function Empty(props) {
      return h('div', { style: { padding: '24px', color: COLORS.muted, fontSize: '13px' } }, props.children)
    }

    // ---------- 客户与项目 ----------
    function basicProjectPrompt(company, project) {
      return '【审计项目】公司：' + company + '；项目：' + (project ? project.name : '') +
        (project && project.period ? '；期间：' + project.period : '') +
        '。请作为该项目的审计助手：先检索事务所知识库（准则/法规/模板），再给结论并标注出处；涉及底稿时说明索引号与数据来源。'
    }

    function projectPrompt(company, project) {
      if (!project || !project.name || !authState.token) return Promise.resolve(basicProjectPrompt(company, project))
      const headers = { 'X-KB-Token': authState.token }
      const projectQuery = encodeURIComponent(project.name)
      return Promise.all([
        fetch(BASE + '/audit/analysis/summary?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/dashboard', { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/report/versions?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/workpapers/generated?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/report/checklist?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/approvals?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/members?project=' + projectQuery, { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
        fetch(BASE + '/audit/events?project=' + projectQuery + '&limit=5', { headers: headers }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
      ]).then(function (results) {
        const summary = results[0]
        const dashboard = results[1]
        const reportVersions = (results[2] && results[2].items) || []
        const generatedFiles = (results[3] && results[3].items) || []
        const checklist = (results[4] && results[4].items) || []
        const approvals = (results[5] && results[5].items) || []
        const members = (results[6] && results[6].items) || []
        const recentEvents = (results[7] && results[7].events) || []
        const checklistTodo = checklist.filter(function (item) { return item.status !== 'OK' })
        const approvalPending = approvals.filter(function (item) { return item.status === '待审批' })
        const row = ((dashboard && dashboard.items) || []).filter(function (item) { return item.id === project.name })[0] || {}
        const materiality = summary && summary.materiality
        const risks = (summary && summary.risks) || []
        const lines = []
        lines.push('【审计项目上下文】')
        lines.push('公司：' + company + '；项目：' + project.name + '；期间：' + (project.period || '') + '；业务类型：' + (project.business_type || '年报审计') + '；状态：' + (project.status || '进行中'))
        if (materiality) {
          lines.push('重要性：基准 ' + (materiality.basis || '') + '；整体 ' + Number(materiality.overall || 0).toLocaleString() + '；执行 ' + Number(materiality.performance || 0).toLocaleString() + '；明显微小 ' + Number(materiality.trivial || 0).toLocaleString() + (materiality.confirmed ? '（已确认）' : '（自动测算待确认）'))
        }
        lines.push('进度：资料清单 ' + (row.pbc_percent || 0) + '%（' + (row.pbc_done || 0) + '/' + (row.pbc_total || 0) + '）；底稿执行 ' + (row.wp_percent || 0) + '%（待执行 ' + (row.wp_pending || 0) + '）；审计程序 ' + (row.program_percent || 0) + '%（' + (row.program_done || 0) + '/' + (row.program_total || 0) + '）；已生成底稿 ' + (row.generated_files || 0) + ' 个；待审批 ' + (row.approval_pending || 0) + ' 项')
        const latestVersion = reportVersions[0]
        lines.push('报告：' + reportVersions.length + ' 个版本' + (latestVersion ? '（最新：' + (latestVersion.status || '草稿') + '，' + (latestVersion.created_at || '') + '）' : '（尚未生成初稿）'))
        const kindNames = { currency: '货币资金', receivable: '应收账款', inventory: '存货', revenue: '营业收入成本' }
        const kinds = []
        generatedFiles.forEach(function (file) { const name = kindNames[file.kind] || file.kind; if (kinds.indexOf(name) < 0) kinds.push(name) })
        lines.push('已生成底稿类型：' + (kinds.length ? kinds.join('、') : '无'))
        if (checklistTodo.length) {
          lines.push('报告门禁：' + checklistTodo.length + ' 项未完成（' + checklistTodo.slice(0, 3).map(function (item) { return item.item }).join('；') + (checklistTodo.length > 3 ? ' 等' : '') + '）')
        } else if (checklist.length) {
          lines.push('报告门禁：检查清单全部完成')
        }
        lines.push('审批：' + approvals.length + ' 项' + (approvalPending.length ? '，其中待审批 ' + approvalPending.length + ' 项' : '，无待审批'))
        const me = (authState.user && authState.user.name) || ''
        const myApprovals = approvalPending.filter(function (item) { return item.assigned_name === me })
        const myNote = []
        if (myApprovals.length) myNote.push('指派给我的审批 ' + myApprovals.length + ' 项')
        if (row.pbc_percent !== undefined && row.pbc_percent < 100) myNote.push('资料清单未完成 ' + (100 - (row.pbc_percent || 0)) + '%')
        if (row.wp_pending) myNote.push('底稿待执行 ' + row.wp_pending + ' 项')
        lines.push('我的待办：' + (myNote.length ? myNote.join('；') : '暂无'))
        if (members.length) {
          lines.push('项目成员：' + members.slice(0, 6).map(function (member) { return member.name + '(' + member.role + ')' }).join('、') + (members.length > 6 ? ' 等 ' + members.length + ' 人' : ''))
        }
        if (recentEvents.length) {
          const eventText = recentEvents.slice(0, 3).map(function (event) { return (event.actor || '') + ' ' + (event.item_name || '') + ' ' + (event.old_status || '') + '→' + (event.new_status || '') }).join('；')
          lines.push('最近操作：' + eventText)
        }
        if (risks.length) lines.push('当前风险提示：' + risks.slice(0, 5).join('；') + (risks.length > 5 ? ' 等 ' + risks.length + ' 条' : ''))
        lines.push('')
        lines.push('要求：1）先检索事务所知识库（准则/法规/模板），结论标注出处（分类/文件名/段落）；2）涉及底稿时说明索引号（如 ZA/ZE/ZJ/SA）与数据来源；3）给可执行的下一步审计程序；4）数字与结论须可复核，不得编造。')
        let text = lines.join('\n')
        if (text.length > 2400) text = text.slice(0, 2300) + '\n（上下文较长已截断，更多细节请查看项目页面）'
        return text
      }).catch(function () { return basicProjectPrompt(company, project) })
    }

    // 「审计程序」主界面：读 /api/audit-fill/program-tables（86 张程序表）+ dict 附表连线
    function ProgramTablesZone(props) {
      const [list, setList] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [subject, setSubject] = React.useState('货币资金')
      const [detail, setDetail] = React.useState(null)
      const [dict, setDict] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [loadingDetail, setLoadingDetail] = React.useState(false)

      React.useEffect(function () {
        fetch('/api/audit-fill/program-tables')
          .then(function (r) { return r.json() })
          .then(function (d) { setList(d.subjects || []) })
          .catch(function (e) { setErr('加载程序表失败：' + String(e)); setList([]) })
      }, [])

      React.useEffect(function () {
        if (!subject) { setDetail(null); setDict(null); return }
        setLoadingDetail(true)
        const found = (list || []).filter(function (x) { return x.subject === subject })[0]
        const prefix = found && found.idx ? String(found.idx).split('-')[0] : ''
        fetch('/api/audit-fill/program-tables?subject=' + encodeURIComponent(subject))
          .then(function (r) { return r.json() })
          .then(function (d) { setDetail(d.program || null) })
          .catch(function () { setDetail(null) })
          .then(function () { setLoadingDetail(false) })
        if (prefix) {
          fetch('/api/audit-fill/dict?prefix=' + encodeURIComponent(prefix))
            .then(function (r) { return r.json() })
            .then(function (d) { setDict(d.dict || {}) })
            .catch(function () { setDict({}) })
        } else {
          setDict(null)
        }
      }, [subject])

      const visible = (list || []).filter(function (x) {
        const s = String(q || '').trim().toLowerCase()
        if (!s) return true
        return (String(x.subject || '') + ' ' + String(x.idx || '') + ' ' + String(x.proj || '')).toLowerCase().indexOf(s) >= 0
      })

      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '审计程序'),
            h('div', { className: 'ad-sub' }, list === null ? '加载程序表…' : (list.length + ' 张程序表 · 选中科目查看 5 项认定与实质性程序'))),
          h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onJumpZone) props.onJumpZone('程序执行') } }, '看项目执行进度'))),
        err ? h('div', { className: 'ad-note' }, err) : null,
        h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start' } },
          h('div', { style: { width: '296px', flexShrink: 0 } },
            h('div', { className: 'ad-toolbar', style: { marginBottom: '8px' } },
              h(ui.Input, { className: 'ad-iw', value: q, onChange: function (e) { setQ(e.target.value) }, placeholder: '搜索科目 / 索引号' })),
            h('div', { className: 'ad-card', style: { maxHeight: '64vh', overflow: 'auto', padding: '6px 8px' } },
              list === null ? h('div', { className: 'ad-row-meta' }, '加载中…') : null,
              visible.map(function (x) {
                return h('div', { key: x.subject, className: 'ad-nav' + (subject === x.subject ? ' on' : ''), style: { cursor: 'pointer' }, onClick: function () { setSubject(x.subject) } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
                    h('span', { style: { fontSize: '12.5px' } }, x.subject),
                    h('span', { className: 'ad-row-meta' }, x.idx || '—')),
                  h('div', { className: 'ad-row-meta' }, (x.objective_count || 0) + ' 认定 · ' + (x.proc_count || 0) + ' 程序'))
              }))),
          h('div', { style: { flex: 1, minWidth: 0 } },
            !subject ? h('div', { className: 'ad-note' }, '从左侧选择一个科目，查看该科目的审计目标（5 项认定）、实质性程序与关联底稿表。')
              : loadingDetail && detail === null ? h('div', { className: 'ad-row-meta' }, '加载程序表…')
              : detail === null ? h('div', { className: 'ad-note' }, '该科目暂无程序表数据')
              : h('div', null,
                  h('div', { className: 'ad-head', style: { marginBottom: '10px' } },
                    h('div', null,
                      h('h2', { className: 'ad-title', style: { fontSize: '17px' } }, detail.subject),
                      h('div', { className: 'ad-sub' }, (detail.idx || '—') + ' · ' + (detail.proj || ''))),
                    null),
                  h('div', { className: 'ad-card' },
                    h('div', { className: 'ad-row-title', style: { marginBottom: '8px' } }, '审计目标（' + ((detail.objectives || []).length) + ' 项认定）'),
                    (detail.objectives || []).map(function (o) {
                      return h('div', { key: o.id, className: 'ad-row', style: { alignItems: 'flex-start' } },
                        h('span', { className: 'ad-pill', style: { minWidth: '24px', textAlign: 'center' } }, o.id),
                        h('span', { style: { flex: 1, minWidth: 0 } }, o.text),
                        h('span', { className: 'ad-row-meta', style: { whiteSpace: 'nowrap' } }, o.a))
                    })),
                  h('div', { className: 'ad-card' },
                    h('div', { className: 'ad-row-title', style: { marginBottom: '8px' } }, '实质性程序（' + ((detail.procs || []).filter(function (p) { return p.no }).length) + ' 条）'),
                    (detail.procs || []).map(function (p, i) {
                      if (p.group) {
                        return h('div', { key: 'g-' + i, style: { margin: '12px 0 4px', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, p.group)
                      }
                      return h('div', { key: 'p-' + (p.no || i), className: 'ad-prog-item', style: { alignItems: 'flex-start' } },
                        h('span', { className: 'ad-row-meta', style: { minWidth: '26px', flexShrink: 0 } }, p.no + '.'),
                        h('span', { style: { flex: 1, minWidth: 0, lineHeight: 1.65 } }, p.text),
                        p.idx ? h('span', { className: 'ad-row-meta', style: { whiteSpace: 'nowrap' } }, p.idx) : null,
                        h('span', { className: 'ad-row-meta', style: { minWidth: '60px', whiteSpace: 'nowrap' } }, (p.a || []).join(' / ')))
                    })),
                  dict ? h('div', { className: 'ad-card' },
                    h('div', { className: 'ad-row-title', style: { marginBottom: '8px' } }, '关联底稿表（' + Object.keys(dict).length + '）'),
                    Object.keys(dict).map(function (name) {
                      const d = dict[name] || {}
                      return h('div', { key: name, className: 'ad-row' },
                        h('div', null,
                          h('div', { className: 'ad-row-title', style: { fontSize: '12.5px' } }, name),
                          h('div', { className: 'ad-row-meta' }, [d['表类'], d['索引号'], d['簿']].filter(Boolean).join(' · '))),
                        h('span', { className: 'ad-row-meta' }, d['索引号'] || ''))
                    })) : null))))
    }

    // 「审计底稿」顶部：本机引擎验数门禁 + 勾稽明细 + 填表明细（数据来自 /api/audit-fill/company）
    function WorkpaperGatePanel(props) {
      const [code, setCode] = React.useState(props.client || '')
      const [companies, setCompanies] = React.useState(null)
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      // 勾稽差异的处置状态：source 形如「勾稽!科目名」，按科目名索引
      const [disposals, setDisposals] = React.useState({})
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/misstatements', { project: props.projectId })
          .then(function (d) {
            if (cancelled) return
            const map = {}
            ;(d.items || []).forEach(function (it) {
              const src = String(it.source || '')
              if (src.indexOf('勾稽!') === 0) {
                map[src.slice(3)] = { category: it.category || '未更正', status: it.status || '', note: it.note || '' }
              }
            })
            setDisposals(map)
          })
          .catch(function () { if (!cancelled) setDisposals({}) })
        return function () { cancelled = true }
      }, [props.projectId])

      React.useEffect(function () {
        if (props.client) { setCode(props.client); return }
        fetch('/api/audit-fill/companies')
          .then(function (r) { return r.json() })
          .then(function (d) { setCompanies(d.companies || []) })
          .catch(function () { setCompanies([]) })
      }, [props.client])

      React.useEffect(function () {
        if (!code) { setData(null); return }
        setErr('')
        fetch('/api/audit-fill/company?name=' + encodeURIComponent(code))
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d && d.ok && d.gate) { setData(d) }
            else { setData(null) }
          })
          .catch(function (e) { setData(null); setErr(String(e)) })
      }, [code])

      const fmt = function (n) { return (n === null || n === undefined) ? '—' : Number(n).toLocaleString() }

      if (!code) {
        return h('div', { className: 'ad-card' },
          h('div', { className: 'ad-row-title', style: { marginBottom: '4px' } }, '验数门禁'),
          h('div', { className: 'ad-row-meta', style: { marginBottom: '8px' } }, '选择本机引擎里已有的公司，查看验数与勾稽结果'),
          h('div', { className: 'ad-toolbar' },
            h('select', { className: 'ad-input', style: { width: 'auto' }, value: code, onChange: function (e) { setCode(e.target.value) } },
              h('option', { value: '' }, '选择公司'),
              (companies || []).map(function (c) { return h('option', { key: c.name, value: c.name }, c.name + (c.client ? '（' + c.client + '）' : '')) }))))
      }

      if (data === null) {
        return h('div', { className: 'ad-card' },
          h('div', { className: 'ad-row-title', style: { marginBottom: '4px' } }, '验数门禁'),
          h('div', { className: 'ad-row-meta' }, err ? ('读取失败：' + err) : ('本机引擎还没有「' + code + '」的底稿数据。先生成底稿（/api/audit-fill/run），再回来看验数与勾稽。')))
      }

      const gate = data.gate || {}
      const lines = data.lines || []
      const workbooks = data.workbooks || []
      // 附表落位：程序表命中的实质性程序 → 附表自动填好（只处理带 supplements 的 plans）
      const SUP_SUBJECTS = ['货币资金', '应收账款', '其他应收款', '预付款项', '应付账款', '预收款项', '其他应付款']
      const supMap = {}
      ;(data.workbooks || []).forEach(function (w) {
        ;(w.plans || []).forEach(function (plan) {
          if (!plan.supplements) return
          const key = plan.subject || ''
          if (!key) return
          if (!supMap[key]) supMap[key] = { subject: key, program_idx: plan.program_idx || '', procs: plan.procs_executed || 0, tables: [] }
          Object.keys(plan.supplements).forEach(function (name) {
            supMap[key].tables.push(Object.assign({ name: name }, plan.supplements[name]))
          })
        })
      })
      const supTableState = function (t) {
        if (t.sampled) return 'sampled'
        if ((t.warnings || []).length) return 'overflow'
        if ((t.filled || 0) > 0 || (t.filled_rows || 0) > 0 || (t.cells || 0) > 0) return 'placed'
        return 'empty'
      }
      const supSubjectState = function (tables) {
        if (!tables.length) return 'empty'
        if (tables.some(function (t) { return supTableState(t) === 'overflow' })) return 'overflow'
        if (tables.some(function (t) { return supTableState(t) === 'sampled' })) return 'sampled'
        if (tables.some(function (t) { return supTableState(t) === 'placed' })) return 'placed'
        return 'empty'
      }
      const supDesc = function (t) {
        if (t.buckets) {
          const rows = t.filled_rows || 0
          const seg = (t.buckets || []).filter(function (b) { return Number(b) > 0 }).length
          return '账龄段 ' + rows + ' 行已填（非零段 ' + seg + '）· 已提 ' + fmt(t.provision)
        }
        if (t.book_total !== undefined) {
          if (t.sampled) return '函证抽样 ' + (t.filled || 0) + '/' + (t.accounts || 0) + ' 家 · 列示 ' + fmt(t.listed_total) + ' / 全额 ' + fmt(t.book_total)
          return '函证 ' + (t.filled || 0) + '/' + (t.accounts || 0) + ' 家 · 账面 ' + fmt(t.book_total)
        }
        if (t.accounts !== undefined) {
          return '账户 ' + (t.filled || 0) + '/' + (t.accounts || 0) + ' 户'
        }
        if (t.cash_book !== undefined) return '现金盘点落位 · 账面 ' + fmt(t.cash_book)
        return '已落位'
      }
      const supColor = function (st) { return st === 'placed' || st === 'sampled' ? '#22C55E' : st === 'overflow' ? '#F59E0B' : 'var(--dsw-alias-border-l2)' }
      const supPlaced = SUP_SUBJECTS.filter(function (x) { var st = supSubjectState((supMap[x] || {}).tables || []); return st === 'placed' || st === 'sampled' }).length
      const supOverflow = SUP_SUBJECTS.filter(function (x) { return supSubjectState((supMap[x] || {}).tables || []) === 'overflow' }).length
      const supEmptyCount = Object.keys(supMap).reduce(function (n, k) {
        return n + (supMap[k].tables || []).filter(function (t) { return supTableState(t) === 'empty' }).length
      }, 0)
      const supplementPanel = h('details', { className: 'ad-more ad-card' },
        h('summary', null, '附表落位 · ' + SUP_SUBJECTS.length + ' 科目 · 已落位 ' + supPlaced
          + (supOverflow ? ' · 溢出待补 ' + supOverflow : '')
          + (supEmptyCount ? ' · 未涉及 ' + supEmptyCount : '')),
        h('div', { className: 'ad-row-title', style: { marginTop: '6px', marginBottom: '8px' } }, '附表落位（程序表驱动）'),
        h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } },
          h(Ring, { value: SUP_SUBJECTS.length ? (supPlaced / SUP_SUBJECTS.length * 100) : 0 }),
          h('div', { className: 'ad-row-meta', style: { minWidth: '120px' } },
            '已落位 ' + supPlaced + ' / ' + SUP_SUBJECTS.length + ' 个科目' + (supOverflow ? ' · 溢出 ' + supOverflow : '')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', flex: 1, minWidth: '220px' } },
            SUP_SUBJECTS.map(function (x) {
              const st = supSubjectState((supMap[x] || {}).tables || [])
              return h('span', { key: 'lg-' + x, style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: supColor(st) } }),
                x)
            }))),
        SUP_SUBJECTS.map(function (x) {
          const item = supMap[x]
          if (!item || !item.tables.length) {
            return h('div', { key: 'sg-' + x, className: 'ad-row' },
              h('span', { style: { flex: 1, minWidth: 0 } }, x),
              h('span', { className: 'ad-row-meta' }, '未落位'))
          }
          return h('div', { key: 'sg-' + x, style: { marginBottom: '12px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
              h('span', { className: 'ad-row-title', style: { fontSize: '12.5px' } }, x + ' · ' + item.program_idx),
              h('span', { className: 'ad-row-meta' }, '执行 ' + item.procs + ' 条程序 · 命中 ' + item.tables.length + ' 张附表')),
            h('div', { className: 'ad-row ad-th', style: { paddingLeft: '10px' } },
              h('span', { style: { flex: 1, minWidth: 0 } }, '附表'),
              h('span', { style: { minWidth: '52px' } }, '索引号'),
              h('span', { style: { minWidth: '88px', textAlign: 'center' } }, '落位状态')),
            item.tables.map(function (t) {
              const st = supTableState(t)
              return h('div', { key: 'st-' + x + '-' + t.name, style: { paddingLeft: '10px', marginBottom: '4px' } },
                h('div', { className: 'ad-row' },
                  h('span', { style: { flex: 1, minWidth: 0 } }, t.sheet || t.name),
                  h('span', { className: 'ad-row-meta', style: { minWidth: '52px' } }, t.idx || ''),
                  h('span', { style: { minWidth: '88px', display: 'flex', justifyContent: 'center' } }, h(AStatus, { tone: st === 'placed' || st === 'sampled' ? 'ok' : st === 'overflow' ? 'warn' : '' }, st === 'placed' ? '已落位' : st === 'sampled' ? '已抽样' : st === 'overflow' ? '溢出待补' : '未涉及'))),
                h('div', { className: 'ad-row-meta' }, supDesc(t)),
                (t.warnings || []).length ? h('div', { className: 'ad-note', style: { margin: '4px 0 0', color: 'var(--dsw-alias-state-warn-primary)' } }, (t.warnings || []).join('；')) : null)
            }))
        }))
      const lineOk = lines.filter(function (l) { return l.diff === 0 }).length
      const lineNo = lines.filter(function (l) { return l.diff === null || l.diff === undefined }).length
      const lineBadAll = lines.filter(function (l) { return l.diff !== 0 && l.diff !== null && l.diff !== undefined })
      const lineReport = lineBadAll.filter(function (l) { return Boolean(l.hint) })
      const lineBad = lineBadAll.filter(function (l) { return !l.hint })
      const lineMagnitude = lineBad.filter(function (l) {
        const base = Math.max(Math.abs(l.calc || 0), Math.abs(l.fs || 0), 1)
        return Math.abs(l.diff) / base > 0.5 && Math.abs(l.diff) >= 10000
      })
      const wbCells = workbooks.reduce(function (a, w) { return a + (w.writes || 0) }, 0)
      return h('div', null,
        h('div', { className: 'ad-card' },
          h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
            h('div', null,
              h('div', { className: 'ad-row-title' }, '验数门禁'),
              h('div', { className: 'ad-row-meta' }, code + ' · 共 ' + (gate.accounts || 0) + ' 个科目')),
            h(AStatus, { tone: gate.ok ? 'ok' : 'bad' }, gate.ok ? '通过' : '不通过')),
          (gate.checks || []).map(function (c, i) {
            return h('div', { key: 'gc-' + i, className: 'ad-row', style: { alignItems: 'flex-start' } },
              h(ui.StateDot, { state: c.ok ? 'done' : 'error' }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { className: 'ad-row-title', style: { fontSize: '12.5px' } }, c.name),
                h('div', { className: 'ad-row-meta' }, c.detail || '')))
          }),
          (gate.blocked_by || []).length ? h('div', { className: 'ad-note', style: { marginTop: '8px' } }, '阻塞项：' + (gate.blocked_by || []).join('；')) : null),
        (lineMagnitude || []).length >= 3 ? h('div', { className: 'ad-note', style: { borderColor: '#b91c1c', color: '#b91c1c' } },
          h('div', { style: { marginBottom: '6px' } },
            '本项目有 ' + lineMagnitude.length + ' 项量级异常：差异超过较大一方的 50%，多为科目范围或报表口径不一致，不是分录错误。建议先核对科目映射，再看明细。'),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () {
            const el = document.getElementById('tieout-detail')
            if (el) { el.open = true; try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (e) {} }
          } }, '展开勾稽明细')) : null,
        h('details', { id: 'tieout-detail', className: 'ad-more ad-card' },
          h('summary', { style: lineBad.length ? { color: '#b91c1c', fontWeight: 600 } : (lineReport.length ? { color: '#b45309' } : undefined) },
            '勾稽明细 · ' + lines.length + ' 行'
            + (lineOk ? ' · 一致 ' + lineOk : '')
            + (lineBad.length ? ' · 待确认差异 ' + lineBad.length + (lineMagnitude.length ? '（量级异常 ' + lineMagnitude.length + '）' : '') : '')
            + (lineReport.length ? ' · 已解释 ' + lineReport.length : '')
            + (lineNo ? ' · 报表无此行 ' + lineNo : '')),
          h('div', { className: 'ad-row ad-th', style: { marginTop: '6px' } },
            h('span', { style: { flex: 1, minWidth: 0 } }, '科目'),
            h('span', { style: { minWidth: '112px', textAlign: 'right' } }, '计算数'),
            h('span', { style: { minWidth: '112px', textAlign: 'right' } }, '报表数'),
            h('span', { style: { minWidth: '88px', textAlign: 'center' } }, '差异')),
          lines.map(function (l, i) {
            const diff = l.diff
            const noRow = diff === null || diff === undefined
            const hasHint = Boolean(l.hint)
            // 量级异常：差异超过较大者的 50% 且金额显著，多半是科目范围/口径不一致，不是小差错
            const base = Math.max(Math.abs(l.calc || 0), Math.abs(l.fs || 0), 1)
            const magnitude = !noRow && diff !== 0 && !hasHint && Math.abs(diff) / base > 0.5 && Math.abs(diff) >= 10000
            const tone = noRow ? '' : (diff === 0 ? 'ok' : (hasHint ? 'warn' : 'bad'))
            const label = noRow ? '报表无此行'
              : (diff === 0 ? '一致'
                : (hasHint ? '已解释 ' + fmt(diff)
                  : (magnitude ? '量级异常 ' + fmt(diff) : '差 ' + fmt(diff))))
            return h('div', { key: 'ln-' + i, className: 'ad-row' },
              h('span', { style: { flex: 1, minWidth: 0 } }, l.line),
              h('span', { className: 'ad-row-meta', style: { minWidth: '112px', textAlign: 'right' } }, fmt(l.calc)),
              h('span', { className: 'ad-row-meta', style: { minWidth: '112px', textAlign: 'right' } }, fmt(l.fs)),
              h('span', { style: { minWidth: '88px', display: 'flex', justifyContent: 'center' } }, h(AStatus, { tone: tone }, label)),
              l.hint
                ? h('span', { className: 'ad-row-meta', style: { minWidth: '72px' } }, l.hint)
                : (!noRow && diff !== 0 && !hasHint
                    ? (function () {
                        const disp = disposals[l.line]
                        if (disp) {
                          const label = disp.category === '豁免' ? '已豁免'
                            : disp.category === '待补证据' ? '待补证据'
                              : (disp.status === '已调整' ? '已调整' : (disp.status === '已询问' ? '已询问' : '已记错报'))
                          const tip = [disp.category, disp.status, disp.note].filter(Boolean).join(' · ')
                          return h('span', { title: tip || label, className: 'ad-row-meta', style: { fontSize: '10px', padding: '1px 6px', borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap' } }, label)
                        }
                        const describe = function () {
                          return '勾稽差异：' + l.line + ' 计算 ' + fmt(l.calc) + ' vs 报表 ' + fmt(l.fs)
                        }
                        const record = function (category) {
                          if (!props.onAddMisstatement) return
                          let note = ''
                          if (category === '豁免') {
                            try { note = window.prompt('豁免理由（会记入留痕，不能为空）：') || '' } catch (e) { note = '' }
                            if (!note.trim()) return
                          }
                          props.onAddMisstatement({ sheet: '勾稽', cell: l.line, message: describe(), diff: Math.abs(diff), category: category, note: note })
                          setDisposals(function (prev) {
                            const next = Object.assign({}, prev)
                            next[l.line] = { category: category, status: '未处理', note: note }
                            return next
                          })
                        }
                        const btn = function (label, category, title) {
                          return h(ui.Button, { variant: 'ghost', size: 'sm', title: title,
                            style: { fontSize: '10px', padding: '1px 5px', minHeight: '20px' },
                            onClick: function () { record(category) } }, label)
                        }
                        return h('span', { style: { display: 'flex', gap: '2px' } },
                          btn('错报', '未更正', '认定为错报，进未更正错报汇总，在报告页处置'),
                          btn('豁免', '豁免', '不认定为错报，需填写理由并留痕'),
                          btn('待补', '待补证据', '暂不结论，标记待补证据'))
                      })()
                    : null))
          })),
        h('details', { className: 'ad-more ad-card' },
          h('summary', null, '填表明细 · ' + workbooks.length + ' 本 · 共 ' + wbCells + ' 格'),
          h('div', { className: 'ad-row ad-th', style: { marginTop: '6px' } },
            h('span', { style: { flex: 1, minWidth: 0 } }, '工作簿'),
            h('span', { style: { minWidth: '56px', textAlign: 'right' } }, '填写格数')),
          workbooks.map(function (w) {
            return h('div', { key: w.file, style: { marginBottom: '10px' } },
              h('div', { className: 'ad-row' },
                h('span', { style: { flex: 1, minWidth: 0 } }, w.file),
                h('span', { className: 'ad-row-meta', style: { minWidth: '56px', textAlign: 'right' } }, (w.writes || 0) + ' 格')),
              (w.plans || []).map(function (p, pi) {
                return (p.sections || []).map(function (s, si) {
                  return h('div', { key: 'ws-' + pi + '-' + si, className: 'ad-row-meta', style: { paddingLeft: '14px', lineHeight: 1.7 } },
                    (s.section || '') + '（' + (s.code || '') + '）· ' + (s.rows || 0) + ' 行 / 已填 ' + (s.filled || 0) + ' 行')
                })
              }))
          })),
        supplementPanel
      )
    }

    // 资料清单：凭证异常扫描（7 条校准规则，data 来自 /api/audit-fill/voucher-rules）
    function VoucherScanPanel(props) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [openRule, setOpenRule] = React.useState('')
      const code = props.client || ''

      React.useEffect(function () {
        if (!code) return
        setErr('')
        fetch('/api/audit-fill/voucher-rules?company=' + encodeURIComponent(code))
          .then(function (r) {
            if (r.status === 401 || r.status === 404) throw new Error('NEED_RELOAD')
            return r.json()
          })
          .then(function (d) {
            if (d && d.ok) { setData(d) }
            else { setData(null); setErr((d && d.error) || '扫描失败') }
          })
          .catch(function (e) {
            setData(null)
            setErr(String((e && e.message) || e) === 'NEED_RELOAD'
              ? '凭证扫描暂不可用，请联系管理员开启后重试'
              : ('扫描失败：' + String((e && e.message) || e)))
          })
      }, [code])

      if (!code) return null
      const RISK_LABEL = { high: '高', medium: '关注', low: '正常', unknown: '—' }
      const RISK_COLOR = { high: '#dc2626', medium: '#f59e0b' }
      const fmtAmt = function (v) { return (v === undefined || v === null) ? '' : Number(v).toLocaleString() }

      return h('div', { className: 'ad-card' },
        h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
          h('div', null,
            h('div', { className: 'ad-row-title' }, '凭证异常扫描（7 条规则）'),
            h('div', { className: 'ad-row-meta' }, data
              ? (code + ' · ' + data.entries + ' 条分录 · ' + ((data.summary || {}).headline || ''))
              : '正在扫描凭证…')),
          null),
        err ? h('div', { className: 'ad-note' }, err) : null,
        data ? h('div', null,
          h('div', { className: 'ad-row ad-th' },
            h('span', { style: { flex: 1 } }, '规则'),
            h('span', { style: { minWidth: '52px', textAlign: 'center' } }, '风险'),
            h('span', { style: { minWidth: '66px', textAlign: 'right' } }, '命中'),
            h('span', { style: { minWidth: '48px', textAlign: 'center' } }, '明细')),
          (data.results || []).map(function (r) {
            const open = openRule === r.rule
            const has = (r.samples || []).length > 0
            return h('div', { key: r.rule, style: { borderBottom: '0.5px solid var(--dsw-alias-border-l3)' } },
              h('div', { className: 'ad-row', style: { cursor: has ? 'pointer' : 'default' }, onClick: function () { if (has) setOpenRule(open ? '' : r.rule) } },
                h(ui.StateDot, { state: r.risk === 'high' ? 'error' : r.risk === 'medium' ? 'warning' : 'done' }),
                h('span', { style: { flex: 1, minWidth: 0 } }, r.name),
                h('span', { style: { minWidth: '52px', textAlign: 'center', fontSize: '11px', color: RISK_COLOR[r.risk] || 'var(--dsw-alias-label-secondary)' } }, RISK_LABEL[r.risk] || '—'),
                h('span', { className: 'ad-row-meta', style: { minWidth: '66px', textAlign: 'right' } }, r.count || 0),
                h('span', { className: 'ad-row-meta', style: { minWidth: '48px', textAlign: 'center' } }, has ? (open ? '收起' : (r.samples.length + ' 条')) : '')),
              h('div', { className: 'ad-row-meta', style: { paddingLeft: '20px', paddingBottom: '4px' } }, r.detail),
              open && has ? h('div', { style: { paddingLeft: '20px', paddingBottom: '8px' } },
                (r.samples || []).map(function (sm, i) {
                  const parts = [sm.kind, sm.date, sm.vno, sm.code, sm.name, sm.summary,
                    sm.amount !== undefined ? fmtAmt(sm.amount) : '',
                    sm.digit !== undefined ? ('首位 ' + sm.digit + '：' + sm.observed + '% vs 期望 ' + sm.expected + '%') : '',
                    sm.from !== undefined ? (sm.month + ' 月 ' + sm.from + '→' + sm.to + '（缺 ' + sm.missing + '）') : '']
                  return h('div', { key: 'sp-' + r.rule + '-' + i, className: 'ad-row-meta', style: { lineHeight: 1.75 } },
                    parts.filter(function (x) { return x !== '' && x !== undefined && x !== null }).join(' · '))
                })) : null)
          })) : null)
    }

    // 资料清单：引擎侧资料齐套检查（缺序时账 = 截止测试/凭证抽查/账龄/抽样都做不了）
    function EngineMaterialCheck(props) {
      const [row, setRow] = React.useState(null)
      React.useEffect(function () {
        let cancelled = false
        fetch('/api/audit-fill/companies')
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (cancelled) return
            const list = d.companies || []
            const hit = list.filter(function (c) { return c.name === props.client || c.client === props.client })[0]
            setRow(hit || null)
          })
          .catch(function () { if (!cancelled) setRow(null) })
        return function () { cancelled = true }
      }, [props.client])
      if (!row) return null
      const items = [
        { label: '科目余额表', ok: Boolean(row.tb), impact: '没有余额表就无法验数、无法生成底稿' },
        { label: '财务报表', ok: Boolean(row.fs), impact: '没有报表，勾稽没有比对对象' },
        { label: '序时账 / 凭证', ok: Boolean(row.voucher), impact: '没有凭证，截止测试、凭证抽查、账龄、抽样、凭证异常扫描全部做不了' }
      ]
      const missing = items.filter(function (i) { return !i.ok })
      if (!missing.length) return null
      return h('div', { className: 'ad-note', style: { borderColor: '#b45309', color: '#b45309', marginTop: '12px' } },
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '本机引擎资料不齐（' + missing.length + ' 项）：'),
        missing.map(function (i) {
          return h('div', { key: 'mc-' + i.label, style: { fontSize: '12px', lineHeight: 1.7 } }, '· 缺' + i.label + '——' + i.impact)
        }),
        h('div', { style: { fontSize: '11px', marginTop: '4px', color: 'var(--dsw-alias-label-secondary)' } },
          '资料补齐后重新放到客户资料目录即可，无需重装。'))
    }

    function Zone(props) {
      const readOnly = Boolean(props.readOnly)
      // 程序执行：65 项一次铺开太长，给一个状态筛选
      const progFilterState = React.useState('all'); const progFilter = progFilterState[0]; const setProgFilter = progFilterState[1]
      // 底稿台账：按科目循环筛选（状态在 CompaniesPage，便于留痕页预填）
      const wpCycle = props.wpCycle || 'all'
      const setWpCycle = props.onSetWpCycle || function () {}
      // 引擎实际填过哪些表（与台账状态是两套：台账靠人点，引擎按单元格填）
      const engineSheetState = React.useState({}); const engineSheets = engineSheetState[0]; const setEngineSheets = engineSheetState[1]
      React.useEffect(function () {
        const pid = props.project && props.project.id
        if (!pid) return
        let cancelled = false
        api('/audit/workpapers/engine-fills', { project: pid })
          .then(function (d) {
            if (cancelled) return
            const agg = {}
            ;((d && d.fills) || []).forEach(function (f) {
              const sh = String(f.sheet || '').trim()
              if (sh) agg[sh] = (agg[sh] || 0) + 1
            })
            setEngineSheets(agg)
          })
          .catch(function () { if (!cancelled) setEngineSheets({}) })
        return function () { cancelled = true }
      }, [props.project && props.project.id])
      const tmpElementsState = React.useState({}); const tmpElements = tmpElementsState[0]; const setTmpElements = tmpElementsState[1]
      const matEditState = React.useState(false); const matEditing = matEditState[0]; const setMatEditing = matEditState[1]
      const matOverallState = React.useState(''); const matOverall = matOverallState[0]; const setMatOverall = matOverallState[1]
      const matPerfState = React.useState(''); const matPerf = matPerfState[0]; const setMatPerf = matPerfState[1]
      const matTrivialState = React.useState(''); const matTrivial = matTrivialState[0]; const setMatTrivial = matTrivialState[1]
      const matNoteState = React.useState(''); const matNote = matNoteState[0]; const setMatNote = matNoteState[1]
      const sampleSizeState = React.useState('5'); const sampleSize = sampleSizeState[0]; const setSampleSize = sampleSizeState[1]
      const sampleSeedState = React.useState('42'); const sampleSeed = sampleSeedState[0]; const setSampleSeed = sampleSeedState[1]
      const sampleResultState = React.useState(null); const sampleResult = sampleResultState[0]; const setSampleResult = sampleResultState[1]
      const samplingState = React.useState(false); const sampling = samplingState[0]; const setSampling = samplingState[1]
      const replyItemState = React.useState(null); const replyItem = replyItemState[0]; const setReplyItem = replyItemState[1]
      const cutoffAsOfState = React.useState(''); const cutoffAsOf = cutoffAsOfState[0]; const setCutoffAsOf = cutoffAsOfState[1]
      const cutoffDaysState = React.useState('5'); const cutoffDays = cutoffDaysState[0]; const setCutoffDays = cutoffDaysState[1]
      const cutoffResultState = React.useState(null); const cutoffResult = cutoffResultState[0]; const setCutoffResult = cutoffResultState[1]
      const replyAmountState = React.useState(''); const replyAmount = replyAmountState[0]; const setReplyAmount = replyAmountState[1]
      const replyNoteState = React.useState(''); const replyNote = replyNoteState[0]; const setReplyNote = replyNoteState[1]
      const wpKindState = React.useState('currency'); const wpKind = wpKindState[0]; const setWpKind = wpKindState[1]
      React.useEffect(function () {
        const mat = props.analysis && props.analysis.materiality
        if (!mat) return
        setMatOverall(String(mat.overall))
        setMatPerf(String(mat.performance))
        setMatTrivial(String(mat.trivial))
        setMatNote(String(mat.note || ''))
      }, [props.analysis])
      const approversState = React.useState({})
      const approvers = approversState[0]
      const setApprovers = approversState[1]
      const opinionsState = React.useState({})
      const opinions = opinionsState[0]
      const setOpinions = opinionsState[1]
      const eventsOf = function (type) {
        return (props.events || []).filter(function (item) { return item.item_type === type }).slice(0, 5)
      }
      const eventsBlock = function (type) {
        const items = eventsOf(type)
        if (!items.length) return null
        return h('div', { style: { marginTop: '16px', borderTop: '1px solid ' + COLORS.line, paddingTop: '10px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, '最近操作'),
          items.map(function (item) {
            return h('div', { key: item.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '4px 0', fontSize: '11px', color: COLORS.muted } },
              h('span', null, (item.actor || '未知') + '：' + (item.item_name || '') + ' ' + (item.old_status || '') + ' → ' + (item.new_status || '')),
              h('span', null, item.created_at))
          }))
      }
      function runCutoff() {
        if (!props.project) return
        api('/audit/analysis/cutoff', { project: props.project.id, asof: cutoffAsOf || undefined, days: Number(cutoffDays) || 5 })
          .then(function (d) { setCutoffResult(d) })
          .catch(function () { setCutoffResult(null) })
      }
      function exportCutoff() {
        if (!props.project) return
        fetch(BASE + '/audit/workpapers/cutoff', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: props.project.id, asof: cutoffAsOf || undefined, days: Number(cutoffDays) || 5 }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '截止测试底稿.docx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); setTimeout(function () { if (props.onRefreshWorkpapers) props.onRefreshWorkpapers() }, 300) }).catch(function () {})
      }
      function exportInventoryCount() {
        if (!props.project) return
        fetch(BASE + '/audit/workpapers/inventory-sheet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: props.project.id }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '存货监盘表.docx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); setTimeout(function () { if (props.onRefreshWorkpapers) props.onRefreshWorkpapers() }, 300) }).catch(function () {})
      }
      function runSampling() {
        if (!props.project) return
        setSampling(true)
        api('/audit/analysis/sampling', { project: props.project.id, size: Number(sampleSize) || 5, seed: Number(sampleSeed) || 42 })
          .then(function (d) { setSampleResult(d) })
          .catch(function () { setSampleResult(null) })
          .then(function () { setSampling(false) })
      }
      function exportSamplingWorkpaper() {
        if (!props.project) return
        fetch(BASE + '/audit/workpapers/sampling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: props.project.id, size: Number(sampleSize) || 5, seed: Number(sampleSeed) || 42 }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '凭证抽样底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            setTimeout(function () { if (props.onRefreshWorkpapers) props.onRefreshWorkpapers() }, 300)
          }).catch(function () {})
      }
      function exportConfirmation() {
        if (!props.project) return
        fetch(BASE + '/audit/workpapers/confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: props.project.id }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '函证清单.docx'; setTimeout(function(){ if (props.onRefreshWorkpapers) props.onRefreshWorkpapers() }, 300); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function exportAging() {
        if (!props.project) return
        fetch(BASE + '/audit/workpapers/aging', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: props.project.id }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '账龄分析.docx'; setTimeout(function(){ if (props.onRefreshWorkpapers) props.onRefreshWorkpapers() }, 300); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      if (props.zone === '概览') {
        const role = ((props.auth && props.auth.user && props.auth.user.role) || 'auditor')
        const roleName = { auditor: '审计员', manager: '项目经理', partner: '合伙人', 'kb-admin': '管理员', admin: '管理员' }[role] || role
        const roleActions = {
          auditor: [['资料清单', '资料清单'], ['审计底稿', '审计底稿'], ['审计程序', '审计程序'], ['审批状态', '审批状态']],
          manager: [['审批状态', '审批状态'], ['审计底稿', '审计底稿'], ['报告', '报告'], ['风险评估', '风险评估']],
          partner: [['报告', '报告'], ['审批状态', '审批状态'], ['风险评估', '风险评估'], ['项目概览', '概览']],
          'kb-admin': [['审批状态', '审批状态'], ['审计底稿', '审计底稿'], ['报告', '报告'], ['资料清单', '资料清单']],
          admin: [['审批状态', '审批状态'], ['审计底稿', '审计底稿'], ['报告', '报告'], ['资料清单', '资料清单']],
        }[role] || [['资料清单', '资料清单'], ['审计底稿', '审计底稿']]
        const nextAction = roleActions[0]
        const pbcItems = props.pbc || []
        const wpItems = props.wp || []
        const approvalItems = props.approvals || []
        const generatedItems = props.generated || []
        const memberItems = props.members || []
        const programItems = props.programs || []
        const programDone = programItems.filter(function (item) { return item.status === '已完成' }).length
        const programPercent = programItems.length ? Math.round(programDone / programItems.length * 100) : 0
        const countBy = function (list, key) { const map = {}; list.forEach(function (item) { const value = item[key] || '未知'; map[value] = (map[value] || 0) + 1 }); return map }
        const pbcCounts = countBy(pbcItems, 'status')
        const wpCounts = countBy(wpItems, 'status')
        const approvalCounts = countBy(approvalItems, 'status')
        const finishedPbc = pbcCounts['已交'] || 0
        const pbcPercent = pbcItems.length ? Math.round(finishedPbc / pbcItems.length * 100) : 0
        const current = (props.auth && props.auth.user) || {}
        const myApprovals = approvalItems.filter(function (item) { return item.status === '待审批' && item.assigned_username === current.username && (!props.todoOverdueOnly || (item.overdue_days || 0) > 0) }).sort(function (a, b) {
          const overdueDiff = (b.overdue_days || 0) - (a.overdue_days || 0)
          if (overdueDiff !== 0) return overdueDiff
          return String(a.submitted_at || '').localeCompare(String(b.submitted_at || ''))
        })
        const jump = function (zoneName) {
          return function () { if (props.onJumpZone) props.onJumpZone(zoneName) }
        }
        const card = function (title, value, detail, onClick) {
          return h('div', { className: 'ad-kpi' + (onClick ? ' ad-kpi-link' : ''), title: onClick ? '点击进入' : undefined,
            style: onClick ? { cursor: 'pointer' } : undefined, onClick: onClick },
            h('div', { className: 'ad-kpi-label' }, title),
            h('div', { className: 'ad-kpi-value' }, String(value)),
            h('div', { className: 'ad-kpi-hint' }, detail))
        }
        const progress = function (percent) {
          return h('div', { style: { height: '6px', borderRadius: '3px', background: 'rgba(127,127,127,0.2)', marginTop: '8px', overflow: 'hidden' } },
            h('div', { style: { width: Math.max(0, Math.min(100, percent)) + '%', height: '100%', background: percent >= 100 ? '#16a34a' : COLORS.accent } }))
        }
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, props.company + ' / ' + (props.project ? props.project.name : '')),
              h('div', { className: 'ad-sub' }, roleName + ' · ' + (props.project ? props.project.period : '') + ' · ' + ((props.project && props.project.business_type) || '年报审计'))),
            h('div', { className: 'ad-actions' },
              nextAction ? h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onJumpZone) props.onJumpZone(nextAction[1]) } }, '下一步：' + nextAction[0]) : null,
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportArchive) props.onExportArchive() }, disabled: props.exporting }, props.exporting ? '打包中…' : '导出归档包'))),
          h('details', { className: 'ad-more' },
            h('summary', null, '项目操作'),
            h('div', { className: 'ad-actions' },
              readOnly ? null : h(ui.Button, { variant: 'outline', size: 'sm', title: '补齐资料清单/底稿台账/审批记录/项目成员（幂等，不覆盖已有状态）',
                onClick: function () { if (props.onInitStdProject) props.onInitStdProject() } }, '补全标准数据'),
              (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0 && !readOnly)
                ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onOpenRename) props.onOpenRename() } }, '重命名') : null,
              (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0)
                ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onOpenDelete) props.onOpenDelete() }, style: { color: 'var(--dsw-alias-state-error-primary)' } }, '删除项目') : null,
              h('label', { className: 'ad-btn' }, '校验归档包', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onVerifyArchiveFile) props.onVerifyArchiveFile(f); e.target.value = '' } })),
              readOnly ? h(AStatus, { tone: 'warn' }, '已归档 · 只读')
                : (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
                    ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onArchiveProject) props.onArchiveProject() } }, '归档项目') : null))),
          props.archiveVerifyMessage ? h('div', { className: 'ad-note' }, props.archiveVerifyMessage) : null,
          h(FlowPanel, { projectId: props.project ? props.project.id : '', client: (props.project && props.project.client) || '', onJumpZone: props.onJumpZone }),
          h(ProjectFieldsPanel, { projectId: props.project ? props.project.id : '' }),
          h(ArchivePackagePanel, { projectId: props.project ? props.project.id : '' }),
          h('div', { className: 'ad-kpis' },
            h('div', { className: 'ad-kpi ad-kpi-link', title: '点击进入', style: { cursor: 'pointer' }, onClick: jump('资料清单') },
              h('div', { className: 'ad-kpi-label' }, '资料清单完成率'),
              h('div', { className: 'ad-kpi-value' }, pbcPercent + '%'),
              h('div', { className: 'ad-kpi-hint' }, '已交 ' + finishedPbc + ' / 共 ' + pbcItems.length + ' 项'),
              progress(pbcPercent)),
            card('审计底稿', wpItems.length, '已生成 ' + (wpCounts['已生成'] || 0) + ' · 进行中 ' + (wpCounts['进行中'] || 0) + ' · 待执行 ' + (wpCounts['待执行'] || 0), jump('审计底稿')),
            card('已生成文件', generatedItems.length, '可预览/下载，按索引号回写台账', jump('审计底稿')),
            card('审批状态', approvalItems.length, '已通过 ' + (approvalCounts['已通过'] || 0) + ' · 待审批 ' + (approvalCounts['待审批'] || 0) + ' · 待提交 ' + (approvalCounts['待提交'] || 0), jump('审批状态')),
            card('审计程序', programPercent + '%', '已完成 ' + programDone + ' / ' + programItems.length + ' 项', jump('程序执行'))),
          h('div', { className: 'ad-card' },
            h('div', { className: 'ad-row-title', style: { marginBottom: '8px' } }, '项目成员（' + memberItems.length + '）'),
            memberItems.length ? memberItems.map(function (m) {
              return h('div', { key: 'mem-' + m.id, className: 'ad-row' },
                h('div', { className: 'ad-row-meta' }, m.name + '（' + m.role + '）'),
                h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onRemoveMember) props.onRemoveMember(m) } }, '移除'))
            }) : h('div', { className: 'ad-row-meta' }, '暂无成员'),
            h('div', { className: 'ad-form', style: { marginTop: '8px' } },
              h('label', { className: 'ad-field' }, '添加成员', h(ui.Input, { className: 'ad-iw', value: props.newMemberName || '', onChange: function (e) { if (props.onNewMemberNameChange) props.onNewMemberNameChange(e.target.value) }, placeholder: '用户名（如 partner）' })),
              h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onAddMember) props.onAddMember(props.newMemberName || '') } }, '添加')))),
          h('div', { className: 'ad-card' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 650 } }, '我的待办' + (props.todoOverdueOnly ? '（仅超期）' : '')),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onSetTodoOverdueOnly) props.onSetTodoOverdueOnly(!props.todoOverdueOnly) } }, props.todoOverdueOnly ? '查看全部' : '只看超期')),
            myApprovals.length
              ? myApprovals.map(function (item) {
                  const urgent = item.kind === '归档校验' || item.kind === '报告复核'
                  const tone = urgent ? { border: '1px solid #b91c1c', color: '#b91c1c' } : { border: '1px solid ' + COLORS.line, color: COLORS.muted }
                  return h('div', { key: 'todo-' + item.id, style: { fontSize: '12px', padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
                    h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                      h('span', { style: Object.assign({ padding: '1px 6px', borderRadius: '8px', fontSize: '10px', flexShrink: 0 }, tone) }, urgent ? '紧急' : '普通'),
                      item.overdue_days ? h(Badge, { tone: item.overdue_days > 7 ? 'bad' : 'warn' }, '超期 ' + item.overdue_days + ' 天') : null,
                      h('span', { style: { color: COLORS.accent, cursor: 'pointer' }, title: '跳转到相关分区', onClick: function () { if (props.onJumpTodoZone) props.onJumpTodoZone(item.kind) } }, '待你审批：' + item.title + (item.kind ? '（' + item.kind + '）' : ''))),
                    readOnly ? null : h('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'approve', '确认通过') },
                        style: { padding: '3px 8px', borderRadius: '6px', border: 0, background: '#16a34a', color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '通过'),
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'reject', '已驳回，请重新处理') },
                        style: { padding: '3px 8px', borderRadius: '6px', border: '1px solid #b91c1c', background: 'transparent', color: '#b91c1c', fontSize: '11px', cursor: 'pointer' } }, '驳回')))
                })
              : (function () {
                  const pendingPbc = pbcCounts['待补'] || 0
                  const undoPbc = pbcCounts['未交'] || 0
                  const todoWp = wpCounts['待执行'] || 0
                  const items = []
                  if (pendingPbc) items.push({ text: '资料待补 ' + pendingPbc + ' 项', zone: '资料清单' })
                  if (undoPbc) items.push({ text: '资料未交 ' + undoPbc + ' 项', zone: '资料清单' })
                  if (todoWp) items.push({ text: '底稿待执行 ' + todoWp + ' 项', zone: '审计底稿' })
                  if (!items.length) {
                    return h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '当前没有待办。底稿执行完提交审批后，待办会出现在这里。')
                  }
                  return h('div', { style: { fontSize: '12px', color: COLORS.muted, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                    h('span', null, '没有待审批，建议先处理：'),
                    items.map(function (it) { return h(ui.Button, { key: it.text, variant: 'ghost', size: 'sm', onClick: jump(it.zone) }, it.text) }))
                })()),
          eventsBlock('pbc'),
          h('div', { style: { marginTop: '6px' } }, eventsBlock('workpaper')),
          h('div', { style: { marginTop: '6px' } }, eventsBlock('approval')))
      }
      if (props.zone === '风险评估') {
        const analysis = props.analysis
        if (!analysis) return h('div', { style: { padding: '20px', fontSize: '12px', color: COLORS.muted } }, '正在加载风险评估…')
        const materiality = analysis.materiality
        const balance = analysis.balance
        const completeness = analysis.completeness || {}
        const canConfirmMateriality = inRole(((props.auth && props.auth.user) || {}).role, 'manage')
        const card = function (title, rows) {
          return h('div', { className: 'ad-tile' },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, title),
            rows.map(function (row, index) {
              return h('div', { key: index, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '3px 0' } },
                h('span', { style: { color: COLORS.muted } }, row[0]),
                h('span', { style: { fontWeight: row[2] ? 600 : 400, color: row[2] ? '#b45309' : 'inherit' } }, row[1]))
            }))
        }
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '风险评估'),
              h('div', { className: 'ad-sub' }, '数字来自客户报表。重要性须由经理或合伙人确认，不能把测算当成结论。')),
            readOnly ? null : h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onGenerateRiskDocx) props.onGenerateRiskDocx() } }, '生成风险评估底稿')),
          readOnly ? null : h('details', { className: 'ad-more' },
            h('summary', null, '检查表与后续程序'),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onAskAiNextSteps) props.onAskAiNextSteps() } }, 'AI 建议后续程序'),
              h('select', { className: 'ad-input', style: { width: 'auto' }, value: props.checklistKind, onChange: function (e) { if (props.onSetChecklistKind) props.onSetChecklistKind(e.target.value) } },
                h('option', { value: 'subsequent' }, '期后事项检查表'),
                h('option', { value: 'going' }, '持续经营评估'),
                h('option', { value: 'related' }, '关联方交易检查表'),
                h('option', { value: 'contingencies' }, '或有事项检查表'),
                h('option', { value: 'opening' }, '期初余额审计程序表'),
                h('option', { value: 'policies' }, '会计政策与估计检查表'),
                h('option', { value: 'fixed_assets' }, '固定资产审计底稿'),
                h('option', { value: 'payroll' }, '应付职工薪酬审计底稿'),
                h('option', { value: 'taxes' }, '应交税费审计底稿')),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onGenerateChecklist) props.onGenerateChecklist() } }, '生成检查表'))),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
            h('div', { className: 'ad-tile' },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '重要性水平'),
                materiality ? h(Badge, { tone: materiality.confirmed ? 'ok' : 'warn' }, materiality.confirmed ? '已确认' : '自动测算') : null),
              materiality ? (matEditing
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '基准：' + materiality.basis),
                    h(ui.Input, { className: 'ad-plain', value: matOverall, onChange: function (e) {
                        const value = e.target.value
                        setMatOverall(value)
                        const numeric = Number(value)
                        if (value !== '' && !isNaN(numeric) && numeric > 0) {
                          setMatPerf(String(Math.round(numeric * 0.75 * 100) / 100))
                          setMatTrivial(String(Math.round(numeric * 0.05 * 100) / 100))
                        }
                      }, placeholder: '整体重要性',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h(ui.Input, { className: 'ad-plain', value: matPerf, onChange: function (e) { setMatPerf(e.target.value) }, placeholder: '实际执行重要性',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h(ui.Input, { className: 'ad-plain', value: matTrivial, onChange: function (e) { setMatTrivial(e.target.value) }, placeholder: '明显微小错报',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h(ui.Input, { className: 'ad-plain', value: matNote, onChange: function (e) { setMatNote(e.target.value) }, placeholder: '确认说明（选填）',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h('div', { style: { display: 'flex', gap: '6px' } },
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onConfirmMateriality) props.onConfirmMateriality({ basis: materiality.basis, overall: Number(matOverall), performance: Number(matPerf), trivial: Number(matTrivial), note: matNote }); setMatEditing(false) },
                        style: { flex: 1, padding: '6px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '12px', cursor: 'pointer' } }, '确认'),
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setMatEditing(false) },
                        style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消')))
                : h('div', null,
                    [['基准', materiality.basis], ['整体重要性', materiality.overall.toLocaleString()], ['实际执行重要性（75%）', materiality.performance.toLocaleString()], ['明显微小错报（5%）', materiality.trivial.toLocaleString()]].map(function (row, index) {
                      return h('div', { key: index, style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' } },
                        h('span', { style: { color: COLORS.muted } }, row[0]), h('span', null, row[1]))
                    }),
                    materiality.confirmed ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, '确认人：' + (materiality.confirmed_by || '') + ' · ' + (materiality.confirmed_at || '') + (materiality.note ? ' · ' + materiality.note : '')) : null,
                    (readOnly || !canConfirmMateriality) ? null : h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setMatEditing(true) },
                      style: { marginTop: '8px', padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, materiality.confirmed ? '修改重要性' : '确认重要性')))
              : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '缺少可用基准，无法自动测算')),
            card('备选基准测算', (analysis.benchmarks || []).map(function (item) { return [item.name, item.amount.toLocaleString()] })),
            card('报表勾稽', balance
              ? [
                  ['资产总计', balance.assets.toLocaleString()],
                  ['负债+所有者权益', balance.liabilities_equity.toLocaleString()],
                  ['差额', balance.difference.toLocaleString(), !balance.ok],
                  ['结论', balance.ok ? '平衡' : '不平衡', !balance.ok],
                ]
              : [['状态', '缺少资产负债表数据', true]])),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            card('数据完整性', [
              ['科目余额表', completeness.has_trial_balance ? '已导入' : '未导入', !completeness.has_trial_balance],
              ['序时账/明细账', completeness.has_journal ? '已导入' : '未导入', !completeness.has_journal],
              ['财务报表', (completeness.tables || []).length + ' 张', false],
            ]),
            h('div', { className: 'ad-tile wide' },
              h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '风险提示（' + (analysis.risks || []).length + '）'),
              (analysis.risks || []).length
                ? (analysis.risks || []).map(function (risk, index) {
                    return h('div', { key: index, style: { fontSize: '12px', padding: '3px 0', color: '#b45309' } }, '· ' + risk)
                  })
                : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无自动识别风险'))),
          (function () {
            const trial = analysis.trial_balance
            if (!trial || !trial.available) return null
            const tb = trial.tb || {}
            const journal = trial.journal || {}
            return h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '试算平衡'),
                readOnly ? null : h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onGenerateTrialBalance) props.onGenerateTrialBalance() } }, '试算平衡底稿')),
              h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
                card('科目余额表', [
                  ['借方发生额合计', Number(tb.debit || 0).toLocaleString()],
                  ['贷方发生额合计', Number(tb.credit || 0).toLocaleString()],
                  ['平衡结论', tb.balanced ? '平衡' : '不平衡', !tb.balanced],
                ]),
                card('序时账勾稽', [
                  ['行数', journal.rows],
                  ['借方合计', Number(journal.debit || 0).toLocaleString()],
                  ['贷方合计', Number(journal.credit || 0).toLocaleString()],
                  ['平衡结论', journal.balanced ? '平衡' : '不平衡', !journal.balanced],
                ]),
                card('余额表 vs 序时账', [
                  ['差异科目数', trial.difference_count],
                  ['结论', trial.difference_count ? '存在差异，需核实' : '无差异', trial.difference_count > 0],
                ])))
          })(),
          h('div', { className: 'ad-card' },
            h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
              h('div', { className: 'ad-row-title' }, '凭证抽样'),
              (sampleResult && sampleResult.available && !readOnly) ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportSamplingWorkpaper,
                className: 'ad-btn quiet' }, '抽样底稿') : null),
            readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' } },
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '样本量'),
              h(ui.Input, { className: 'ad-plain', value: sampleSize, onChange: function (e) { setSampleSize(e.target.value) }, style: { width: '64px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '种子'),
              h(ui.Input, { className: 'ad-plain', value: sampleSeed, onChange: function (e) { setSampleSeed(e.target.value) }, style: { width: '64px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: runSampling, disabled: sampling }, sampling ? '抽样中…' : '执行抽样')),
            sampleResult && sampleResult.available ? h('details', { className: 'ad-more' },
              h('summary', null, '样本 ' + (sampleResult.samples || []).length + ' 笔 · 总体 '
                + sampleResult.population_count + ' 笔 · 覆盖率 ' + sampleResult.coverage + '%'),
              h('div', { style: { fontSize: '11px', color: '#b45309', marginBottom: '4px' } },
                '抽样结果不随项目保存，刷新即失；需点上方「导出抽样底稿」留痕，同一随机种子可复现同一组样本。'),
              h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '6px' } },
                '总体 ' + sampleResult.population_count + ' 笔 / 合计 ' + Number(sampleResult.total).toLocaleString() + ' · 间隔 ' + Number(sampleResult.interval).toLocaleString() + ' · 覆盖率 ' + sampleResult.coverage + '%'),
              (sampleResult.samples || []).map(function (item) {
                return h('div', { key: 'sample-' + item.index, className: 'ad-row' },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { className: 'ad-row-title' }, '#' + item.index + ' ' + (item.summary || item.voucher || '')),
                    h('div', { className: 'ad-row-meta' }, [item.date, item.voucher, item.name].filter(Boolean).join(' · '))),
                  h('span', { className: 'ad-row-title' }, Number(item.amount).toLocaleString()))
              })) : (sampleResult && !sampleResult.available ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, sampleResult.message || '抽样不可用') : null)),
          h('div', { className: 'ad-card' },
            h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
              h('div', { className: 'ad-row-title' }, '截止测试与存货监盘'),
              readOnly ? null : h('details', { className: 'ad-more', style: { margin: 0 } },
                h('summary', null, '导出'),
                h('div', { className: 'ad-actions' },
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportCutoff }, '截止测试底稿'),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportInventoryCount }, '存货监盘表')))),
            readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } },
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '截止日'),
              h(ui.Input, { className: 'ad-plain', value: cutoffAsOf, onChange: function (e) { setCutoffAsOf(e.target.value) }, placeholder: 'YYYY-MM-DD', style: { width: '110px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '前后'),
              h(ui.Input, { className: 'ad-plain', value: cutoffDays, onChange: function (e) { setCutoffDays(e.target.value) }, style: { width: '52px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '天'),
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: runCutoff }, '执行截止测试')),
            cutoffResult && cutoffResult.available ? h('div', { style: { fontSize: '12px', color: COLORS.muted } },
              '截止日 ' + cutoffResult.asof + '：日前 ' + cutoffResult.before_count + ' 笔 / 日后 ' + cutoffResult.after_count + ' 笔'
              + (cutoffResult.before_count + cutoffResult.after_count === 0 ? '（无临近凭证，调整截止日或天数）' : ''))
              : (cutoffResult && !cutoffResult.available ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, cutoffResult.message || '截止测试不可用') : null),
            (props.inventoryCounts || []).length ? h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed ' + COLORS.line } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
                h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '存货监盘录入（' + props.inventoryCounts.length + '）'),
                readOnly ? null : h('div', { className: 'ad-actions' },
                  h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onSaveInventoryCounts) props.onSaveInventoryCounts() } }, '保存录入'),
                  h('details', { className: 'ad-more', style: { margin: 0 } },
                    h('summary', null, '更多'),
                    h('div', { className: 'ad-actions' },
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportInventorySummary) props.onExportInventorySummary() } }, '导出汇总'),
                      h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onExportInventoryExceptions) props.onExportInventoryExceptions() } }, '差异清单'),
                      h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onConfirmInventory) props.onConfirmInventory() } }, '确认监盘'))))),
              h('div', { style: { display: 'grid', gridTemplateColumns: '60px 1fr 90px 70px 70px 70px 1fr 60px', gap: '6px', fontSize: '11px', color: COLORS.muted, padding: '3px 0' } },
                h('span', null, '编码'), h('span', null, '名称'), h('span', null, '账面金额'), h('span', null, '账面数量'), h('span', null, '实盘数量'), h('span', null, '差异'), h('span', null, '备注'), h('span', null, '状态')),
              (props.inventoryCounts || []).map(function (row) {
                return h('div', { key: 'inv-' + row.code, style: { display: 'grid', gridTemplateColumns: '60px 1fr 90px 70px 70px 70px 1fr 60px', gap: '6px', alignItems: 'center', fontSize: '12px', padding: '2px 0' } },
                  h('span', null, row.code), h('span', null, row.name), h('span', null, Number(row.book_amount).toLocaleString()),
                  h(ui.Input, { className: 'ad-plain', value: String(row.book_qty || ''), onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'book_qty', e.target.value) }, style: { width: '58px', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h(ui.Input, { className: 'ad-plain', value: String(row.counted_qty || ''), onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'counted_qty', e.target.value) }, style: { width: '58px', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h('span', { style: { color: Number(row.difference || 0) === 0 ? COLORS.muted : '#b45309' } }, String(row.difference || 0)),
                  h(ui.Input, { className: 'ad-plain', value: row.note || '', onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'note', e.target.value) }, style: { width: '100%', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h(Badge, { tone: row.status === '已确认' ? 'ok' : row.status === '已录入' ? 'warn' : 'muted' }, row.status))
              }),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '6px', fontSize: '11px' } },
                h('span', { style: { color: COLORS.muted } }, '监盘日期'),
                h(ui.Input, { className: 'ad-plain', value: (props.inventoryMeta && props.inventoryMeta.counted_at) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('counted_at', e.target.value) }, placeholder: 'YYYY-MM-DD', style: { width: '92px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h('span', { style: { color: COLORS.muted } }, '监盘人'),
                h(ui.Input, { className: 'ad-plain', value: (props.inventoryMeta && props.inventoryMeta.auditor_rep) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('auditor_rep', e.target.value) }, placeholder: '监盘人', style: { width: '80px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h('span', { style: { color: COLORS.muted } }, '陪同人'),
                h(ui.Input, { className: 'ad-plain', value: (props.inventoryMeta && props.inventoryMeta.client_rep) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('client_rep', e.target.value) }, placeholder: '客户陪同人', style: { width: '100px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h(ui.Input, { className: 'ad-plain', value: (props.inventoryMeta && props.inventoryMeta.note) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('note', e.target.value) }, placeholder: '监盘说明', style: { flex: 1, minWidth: '100px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                readOnly ? null : h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onSaveInventoryMeta) props.onSaveInventoryMeta() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '保存监盘信息')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', fontSize: '12px', flexWrap: 'wrap' } },
                h('span', { style: { color: COLORS.muted } }, '盘点表扫描件（' + (props.inventoryAttachments || []).length + '）'),
                readOnly ? null : h('label', { style: { color: COLORS.accent, cursor: 'pointer' } },
                  '上传扫描件', h('input', { type: 'file', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onUploadInventoryAttachment) props.onUploadInventoryAttachment(f); e.target.value = '' } })),
                (props.inventoryAttachments || []).map(function (item) {
                  return h(ui.Button, { variant: 'outline', size: 'sm', key: 'invatt-' + item.id, onClick: function () { if (props.onPreviewInventoryAttachment) props.onPreviewInventoryAttachment(item) },
                    style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '查看 ' + item.filename)
                }))) : null),
          (function () {
            const confirmation = analysis.confirmation || {}
            const aging = analysis.aging || {}
            if (!confirmation.available && !aging.available) return null
            return h('div', { className: 'ad-card' },
              h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
                h('div', { className: 'ad-row-title' }, '函证与账龄'),
                readOnly ? null : h('div', { className: 'ad-actions' },
                  confirmation.available ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportConfirmation }, '函证清单') : null,
                  aging.available ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: exportAging }, '账龄分析') : null)),
              h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
                h('div', { style: { flex: '1 1 260px', minWidth: '260px', fontSize: '12px' } },
                  h('div', { style: { color: COLORS.muted, marginBottom: '4px' } }, '函证清单'),
                  confirmation.available
                    ? h('div', null,
                        h('div', { style: { marginBottom: '4px' } }, '科目 ' + confirmation.count + ' 个，余额合计 ' + Number(confirmation.total).toLocaleString()),
                        (confirmation.items || []).map(function (item) {
                          return h('div', { key: 'cf-' + item.code, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
                            h('span', null, item.code + ' ' + item.name), h('span', null, Number(item.balance).toLocaleString()))
                        }))
                    : h('div', { style: { color: '#b45309' } }, confirmation.message || '不可用')),
                h('div', { style: { flex: '1 1 260px', minWidth: '260px', fontSize: '12px' } },
                  h('div', { style: { color: COLORS.muted, marginBottom: '4px' } }, '应收账龄（截止 ' + (aging.asof || '') + '）'),
                  aging.available
                    ? h('div', null, (aging.buckets || []).map(function (bucket) {
                        return h('div', { key: 'ag-' + bucket.label, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
                          h('span', null, bucket.label), h('span', null, Number(bucket.amount).toLocaleString()))
                      }))
                    : h('div', { style: { color: '#b45309' } }, aging.message || '不可用'))),
              h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed ' + COLORS.line } },
                h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
                  h('div', { className: 'ad-row-title' }, '回函跟踪'),
                  readOnly ? null : h('div', { className: 'ad-actions' },
                    h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onSyncConfirmations) props.onSyncConfirmations() } }, '同步台账'),
                    h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onExportConfirmationDifferences) props.onExportConfirmationDifferences() } }, '差异调节表'))),
                (props.confirmations || []).length
                  ? (props.confirmations || []).map(function (item) {
                      const replied = Math.abs(Number(item.replied_amount || 0)) > 0 || item.status === '已回函'
                      return h('div', { key: 'conf-' + item.id, className: 'ad-row', style: { alignItems: 'flex-start' } },
                        h('div', { style: { minWidth: 0, flex: 1 } },
                          h('div', { className: 'ad-row-title' }, item.code + ' ' + item.name),
                          h('div', { className: 'ad-row-meta' }, '账面 ' + Number(item.balance).toLocaleString() + (replied ? ' · 回函 ' + Number(item.replied_amount).toLocaleString() + ' · 差异 ' + Number(item.difference).toLocaleString() : '')),
                          h('div', { className: 'ad-actions', style: { marginTop: '6px' } },
                            (!readOnly && item.status !== '已回函') ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { setReplyItem(replyItem === item.id ? null : item.id); setReplyAmount(String(item.balance)); setReplyNote('') } }, '登记回函') : null,
                            item.attachment_name ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onPreviewConfirmationAttachment) props.onPreviewConfirmationAttachment(item) },
                              style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '查看扫描件') : null,
                            readOnly ? null : h('label', { style: { color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } },
                              '上传扫描件', h('input', { type: 'file', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onUploadConfirmationAttachment) props.onUploadConfirmationAttachment(item.id, f); e.target.value = '' } })),
                            h('span', { onClick: function () { if (!readOnly && props.onCycleConfirmation) props.onCycleConfirmation(item) }, title: '点击切换回函状态', style: { cursor: 'pointer' } },
                              h(Badge, { tone: item.status === '已回函' ? 'ok' : item.status === '未回函' ? 'bad' : item.status === '已发' ? 'warn' : 'muted' }, item.status)))),
                        replyItem === item.id ? h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
                          h(ui.Input, { className: 'ad-plain', value: replyAmount, onChange: function (e) { setReplyAmount(e.target.value) }, placeholder: '回函金额', style: { width: '110px', padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                          h(ui.Input, { className: 'ad-plain', value: replyNote, onChange: function (e) { setReplyNote(e.target.value) }, placeholder: '差异说明', style: { flex: 1, minWidth: '80px', padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                          h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onReplyConfirmation) props.onReplyConfirmation(item.id, Number(replyAmount) || 0, replyNote); setReplyItem(null) },
                            style: { padding: '4px 10px', borderRadius: '6px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '11px', cursor: 'pointer' } }, '保存')) : null)
                    })
                  : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '尚未同步，点击「同步台账」生成')))
          })(),
          (props.matHistory || []).length ? h('details', { className: 'ad-more', style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('summary', null, '重要性调整历史（' + props.matHistory.length + '）'),
            (props.matHistory || []).map(function (history) {
              return h('div', { key: 'mh-' + history.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '4px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('span', null, history.actor + '：整体 ' + Number(history.overall).toLocaleString() + ' / 执行 ' + Number(history.performance).toLocaleString() + ' / 微小 ' + Number(history.trivial).toLocaleString() + (history.note ? ' · ' + history.note : '')),
                h('span', { style: { color: COLORS.muted } }, history.created_at))
            })) : null)
      }
      if (props.zone === '资料清单') {
        const items = props.pbc === null ? null : props.pbc
        const toneOf = function (status) { return status === '已交' ? 'ok' : status === '待补' ? 'warn' : 'bad' }
        const fmtSize = function (size) {
          if (!size) return ''
          if (size > 1048576) return (size / 1048576).toFixed(1) + 'MB'
          if (size > 1024) return (size / 1024).toFixed(0) + 'KB'
          return size + 'B'
        }
        const rows = items === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载资料清单…')]
          : (items.length ? items.map(function (item) {
              const attachments = (item.attachments || []).map(function (att) {
                return h('span', { key: 'att-' + att.id, style: { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '6px', marginTop: '4px' } },
                  h('span', { onClick: function () { if (props.onPreviewAttachment) props.onPreviewAttachment(att) }, title: '点击预览',
                    style: { padding: '2px 8px', borderRadius: '8px', background: COLORS.bg, fontSize: '11px', cursor: 'pointer', color: COLORS.accent } },
                    att.filename + ' ' + fmtSize(att.size)),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onCheckAttachment) props.onCheckAttachment(att) },
                    title: '核对数字勾稽/公式/账面差异',
                    style: { padding: '2px 6px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '核对'))
              })
              return h('div', { key: item.id, className: 'ad-row', style: { alignItems: 'flex-start' } },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('div', { className: 'ad-row-title' }, item.name),
                  item.note ? h('div', { className: 'ad-row-meta' }, item.note) : null,
                  attachments.length ? h('div', { style: { marginTop: '6px' } }, attachments) : null),
                h('div', { className: 'ad-actions' },
                    readOnly ? null : h('label', { className: 'ad-btn quiet' }, '上传',
                      h('input', { type: 'file', style: { display: 'none' },
                        onChange: function (event) {
                          const file = event.target.files && event.target.files[0]
                          if (file && props.onUploadAttachment) props.onUploadAttachment(item, file)
                          event.target.value = ''
                        } })),
                    h(ui.Button, { variant: 'ghost', size: 'sm', title: '查看这份资料的变更历史（状态流转；附件记录按文件名另查）',
                      style: { fontSize: '11px', padding: '1px 6px', minHeight: '20px' },
                      onClick: function (e) { e.stopPropagation(); if (props.onOpenPbcHistory) props.onOpenPbcHistory(item) } }, '历史'),
                    readOnly ? null : h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onDeletePbc) props.onDeletePbc(item) }, 'data-pbc-delete': String(item.id) }, '删除'),
                    h('span', {
                      onClick: function () {
                        if (readOnly || !props.onCyclePbc) return
                        // 已交再点会退回未交，误点等于宣布"客户没交"，先确认
                        if (item.status === '已交') {
                          try { if (!window.confirm('「' + (item.name || '') + '」已交，再点会退回「未交」。确定吗？')) return } catch (e) { return }
                        }
                        props.onCyclePbc(item)
                      },
                      title: item.status === '已交' ? '已交——再点会退回未交（需确认）' : '点击切换：未交 → 待补 → 已交',
                      'data-pbc-id': String(item.id),
                      style: { cursor: 'pointer' },
                    }, h(Badge, { tone: toneOf(item.status) }, item.status))))
            }) : [h('div', { key: 'empty', className: 'ad-row-meta', style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', null, '暂无资料清单。可从业务类型模板生成标准清单，再逐项上传。'),
              readOnly ? null : h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onInitPbc) props.onInitPbc() } }, '按模板生成清单'))])
        const checkPanel = props.clientCheckMsg ? h('div', { style: { marginTop: '10px', padding: '10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, fontSize: '12px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, props.clientCheckMsg),
          props.clientCheck ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportClientCheck) props.onExportClientCheck() },
            style: { marginBottom: '6px', padding: '4px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '导出核对记录（Word）') : null,
          props.clientCheck ? h('div', null,
            h('div', { style: { color: COLORS.muted, marginBottom: '6px' } }, '文件：' + (props.clientCheck.filename || '') + ' · 共 ' + ((props.clientCheck.summary || {}).total || 0) + ' 项（高 ' + ((props.clientCheck.summary || {}).high || 0) + ' / 中 ' + ((props.clientCheck.summary || {}).medium || 0) + '）'),
            (props.clientCheck.findings || []).slice(0, 12).map(function (f, i) {
              return h('div', { key: 'cc-' + i, style: { padding: '3px 0', borderTop: i ? '1px dashed ' + COLORS.line : 'none' } },
                h('span', { style: { color: f.severity === 'high' ? '#b91c1c' : '#b45309', marginRight: '6px' } }, f.severity === 'high' ? '高' : '中'),
                f.sheet + '!' + f.cell + '：' + f.message,
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onAddMisstatement) props.onAddMisstatement(f) },
                  style: { marginLeft: '8px', padding: '1px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '记入未更正'))
            })) : null) : null
        const addForm = h('div', { className: 'ad-form', style: { marginTop: '12px' } },
          h('label', { className: 'ad-field' }, '新增资料', h(ui.Input, { className: 'ad-iw', value: props.newPbcName || '', onChange: function (event) { if (props.onPbcNameChange) props.onPbcNameChange(event.target.value) }, placeholder: '如：银行开户许可证' })),
          readOnly ? null : h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onAddPbc) props.onAddPbc(props.newPbcName || '') } }, '新增')))
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '资料清单'),
              h('div', { className: 'ad-sub' }, '点状态可切换未交 / 待补 / 已交；每行右侧上传或删除。'))),
          h(EngineMaterialCheck, { client: (props.project && props.project.client) || '' }),
          h('details', { className: 'ad-more ad-card', style: { marginTop: '12px' } },
            h('summary', null, '项目数据导入 · 科目余额表 / 序时账 / 财务报表'),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '8px' } }, '导入科目余额表与序时账后，可执行试算平衡、勾稽与抽样程序（支持 .xlsx / .xls / .csv）。'),
            readOnly ? h('div', { className: 'ad-row-meta' }, '项目已归档，不可导入') : h('div', { className: 'ad-form' },
              h('label', { className: 'ad-field' }, '科目余额表', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportData) props.onImportData('tb', f); e.target.value = '' } })),
              h('label', { className: 'ad-field' }, '序时账', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportData) props.onImportData('journal', f); e.target.value = '' } })),
              h('label', { className: 'ad-field' }, '财务报表', h('input', { type: 'file', accept: '.xlsx', onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportFinancialStatements) props.onImportFinancialStatements(f); e.target.value = '' } }))),
            h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px', fontSize: '11px' } },
              h('span', { style: { color: COLORS.muted } }, '标准模板：'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDownloadImportTemplate) props.onDownloadImportTemplate('tb') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载科目余额表模板'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDownloadImportTemplate) props.onDownloadImportTemplate('journal') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载序时账模板'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDownloadFinancialTemplate) props.onDownloadFinancialTemplate() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载财务报表模板')),
            readOnly ? null : h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' } },
              h('label', { style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, color: COLORS.muted, cursor: 'pointer' } },
                props.multiLoading ? '读取中…' : '多工作表文件', h('input', { type: 'file', accept: '.xlsx,.xls', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onChooseMultiSheetFile) props.onChooseMultiSheetFile(f); e.target.value = '' } })),
              (props.multiSheets || []).length ? h('select', { value: props.multiKind, onChange: function (e) { if (props.onSetMultiKind) props.onSetMultiKind(e.target.value) }, style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                h('option', { value: 'tb' }, '科目余额表'), h('option', { value: 'journal' }, '序时账')) : null,
              (props.multiSheets || []).length ? h('select', { value: props.multiSheetIndex, onChange: function (e) { if (props.onSetMultiSheetIndex) props.onSetMultiSheetIndex(e.target.value) }, style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                props.multiSheets.map(function (name, index) { return h('option', { key: name + index, value: String(index) }, name) })) : null,
              (props.multiSheets || []).length ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onSubmitMultiSheet) props.onSubmitMultiSheet('validate') }, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '校验所选') : null,
              (props.multiSheets || []).length ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onSubmitMultiSheet) props.onSubmitMultiSheet('import') }, style: { padding: '5px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '11px', cursor: 'pointer' } }, '导入所选') : null),
            props.importMessage ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' } },
              h('div', { style: { fontSize: '12px', color: props.importMessage.indexOf('失败') >= 0 ? '#b91c1c' : '#16a34a' } }, props.importMessage),
              (props.importMessage.indexOf('勾稽提示') >= 0 && !readOnly) ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onGenerateTrialBalance) props.onGenerateTrialBalance() },
                style: { padding: '4px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '生成试算平衡底稿') : null) : null,
            (props.dataEvents || []).length ? h('div', { style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } },
              h('div', { style: { marginBottom: '3px' } }, '最近导入：'),
              (props.dataEvents || []).slice(0, 5).map(function (event, index) {
                return h('div', { key: 'de-' + index, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
                  h('span', null, (event.item_name || '') + ' · ' + (event.actor || '') + (event.new_status ? ' · ' + event.new_status : '')),
                  h('span', null, event.created_at))
              })) : null),
          rows, checkPanel, h(VoucherScanPanel, { client: (props.project && props.project.client) || '' }), addForm, eventsBlock('pbc'))
      }
      if (props.zone === '审计底稿') {
        const WP_CYCLE = { ZA: '货币资金', ZE: '应收账款', ZJ: '存货', ZP: '固定资产', FE: '应付账款', FH: '应交税费', FG: '应付职工薪酬', QA: '所有者权益', SA: '营业收入' }
        const cycleOf = function (code) {
          const m = String(code || '').match(/^[A-Z]+/)
          return m ? m[0] : ''
        }
        const toneOfWp = function (status) { return status === '已完成' || status === '已执行' || status === '已预填' || status === '已生成' ? 'ok' : status === '进行中' ? 'warn' : status === '不适用' ? 'muted' : 'bad' }
        const items = props.wp === null ? null : props.wp
        const wpFilter = props.wpStatusFilter || 'all'
        const visibleItems = items === null ? null : items.filter(function (item) {
          if (wpCycle !== 'all' && cycleOf(item.index_no) !== wpCycle) return false
          if (wpFilter !== 'all' && item.status !== wpFilter) return false
          const query = String(props.wpSearch || '').trim().toLowerCase()
          if (!query) return true
          return (String(item.code || '') + ' ' + String(item.name || '') + ' ' + String(item.note || '')).toLowerCase().indexOf(query) >= 0
        })
        const rows = visibleItems === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载审计底稿…')]
          : (visibleItems.length ? visibleItems.map(function (item) {
              const generatedFile = item.note && /\.xlsx$/i.test(item.note)
              return h('div', { key: item.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + COLORS.line } },
                h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', minWidth: 0 } },
                  h('span', { onClick: function () { if (props.onOpenWorkpaperIndex) props.onOpenWorkpaperIndex(item.index_no) }, title: '打开已生成底稿',
                    style: { fontSize: '11px', color: COLORS.accent, minWidth: '44px', cursor: 'pointer' } }, item.index_no),
                  h('span', { onClick: function () { if (props.onOpenWorkpaperIndex) props.onOpenWorkpaperIndex(item.index_no) }, title: '打开已生成底稿',
                    style: { fontSize: '13px', cursor: 'pointer' } }, item.name),
                  generatedFile
                    ? h('span', { onClick: function () { if (props.onOpenWorkpaperIndex) props.onOpenWorkpaperIndex(item.index_no) }, title: '打开已生成底稿',
                        style: { fontSize: '11px', color: COLORS.accent, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.note)
                    : (item.note ? h('span', { style: { fontSize: '11px', color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.note) : null)),
                h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                  engineSheets[item.name]
                    ? h('span', { title: '引擎已向这张表写入 ' + engineSheets[item.name] + ' 格（与台账状态独立）',
                        style: { fontSize: '10px', padding: '1px 6px', borderRadius: '9px', border: '1px solid var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)', whiteSpace: 'nowrap' } }, '引擎已填')
                    : null,
                  h(ui.Button, { variant: 'ghost', size: 'sm', title: '查看这张底稿的变更历史', style: { fontSize: '11px', padding: '1px 6px', minHeight: '20px' },
                    onClick: function (e) { e.stopPropagation(); if (props.onOpenWorkpaperHistory) props.onOpenWorkpaperHistory(item) } }, '历史'),
                  h('span', { onClick: function () {
                      if (readOnly || !props.onCycleWp) return
                      // 循环到「已完成」再点会退回「待执行」——这是误操作最容易踩的一步，先确认
                      if (item.status === '已完成') {
                        try { if (!window.confirm('「' + (item.name || item.index_no) + '」已完成，再点会退回「待执行」。确定要退回吗？')) return } catch (e) { return }
                      }
                      props.onCycleWp(item)
                    }, title: item.status === '已完成' ? '已完成——再点会退回待执行（需确认）' : '点击推进：待执行→进行中→已生成→已完成',
                    'data-wp-id': String(item.id), style: { cursor: 'pointer' } },
                    h(Badge, { tone: toneOfWp(item.status) }, item.status))))
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无底稿，先从模板生成')])
        const generated = props.generated === null ? [] : props.generated
        const generatedStats = generated.reduce(function (acc, item) { const kind = item.kind || 'other'; acc[kind] = (acc[kind] || 0) + 1; return acc }, {})
        const KIND_LABELS = { currency: '货币资金', receivable: '应收账款', inventory: '存货', revenue: '营业收入成本', trial_balance: '试算平衡', subsequent_events: '期后事项', going_concern: '持续经营', related_parties: '关联方交易', contingencies: '或有事项', opening_balances: '期初余额', accounting_policies: '会计政策与估计', fixed_assets: '固定资产', payroll: '应付职工薪酬', taxes: '应交税费' }
        const kindOptions = Array.from(new Set(generated.map(function (item) { return item.kind }))).filter(Boolean)
        const filteredGenerated = props.generatedKind && props.generatedKind !== 'all' ? generated.filter(function (item) { return item.kind === props.generatedKind }) : generated
        const generatedRows = filteredGenerated.map(function (item) {
          return h('div', { key: 'gen-' + item.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', minWidth: 0 } },
              h('span', { style: { fontSize: '12px' } }, item.filename),
              h('span', { style: { fontSize: '11px', color: COLORS.muted } }, Math.round((item.size || 0) / 1024) + 'KB · ' + item.created_by + ' · ' + item.created_at)),
            h('div', { style: { display: 'flex', gap: '12px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onPreviewWorkpaper) props.onPreviewWorkpaper(item) },
                style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '预览'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDownloadWorkpaper) props.onDownloadWorkpaper(item) },
                style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载')))
        })
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '底稿'),
              h('div', { className: 'ad-sub' }, '按模板生成底稿。点状态只改执行进度，复核状态单独记录。')),
            h(ui.Button, { variant: 'primary', size: 'sm', disabled: props.generating || readOnly, onClick: function () { if (props.onGenerateAll) props.onGenerateAll() } }, props.generating ? '生成中…' : '生成常用底稿')),
          h(WorkpaperGatePanel, { client: (props.project && props.project.client) || '', projectId: props.project ? props.project.id : '', onAddMisstatement: props.onAddMisstatement }),
          h(EngineFillsPanel, { projectId: props.project ? props.project.id : '' }),
          h('div', { style: { padding: '8px 14px 0', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' } },
            h('span', { style: { color: COLORS.muted } }, '底稿统计：共 ' + generated.length + ' 份 · 台账 ' + (items ? items.length : 0) + ' 项'),
            readOnly ? null : h(ui.Button, { variant: 'ghost', size: 'sm', title: '把引擎实际填过的表标为「已生成」（不标已完成，复核仍需人工）',
              style: { fontSize: '11px', padding: '1px 6px', minHeight: '20px' },
              onClick: function () { if (props.onSyncEngine) props.onSyncEngine() } }, '同步引擎状态'),
            h(ui.Input, { className: 'ad-plain', value: props.wpSearch || '', placeholder: '搜索底稿名称/索引/说明', onChange: function (e) { if (props.onSetWpSearch) props.onSetWpSearch(e.target.value) },
              style: { width: '170px', padding: '4px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
            h('select', { value: wpCycle, onChange: function (e) { setWpCycle(e.target.value) },
              style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
              h('option', { value: 'all' }, '全部循环 ' + (items ? items.length : 0)),
              Object.keys(WP_CYCLE).map(function (prefix) {
                const n = (items || []).filter(function (it) { return cycleOf(it.index_no) === prefix }).length
                if (!n) return null
                return h('option', { key: 'cyc-' + prefix, value: prefix }, WP_CYCLE[prefix] + ' ' + prefix + ' · ' + n)
              })),
            h('select', { value: wpFilter, onChange: function (e) { if (props.onSetWpStatusFilter) props.onSetWpStatusFilter(e.target.value) },
              style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
              h('option', { value: 'all' }, '全部状态'),
              ['已生成', '进行中', '待执行', '已完成', '不适用'].map(function (status) { return h('option', { key: 'wpf-' + status, value: status }, status) })),
            Object.keys(generatedStats).map(function (kind) {
              const active = (props.generatedKind || 'all') === kind
              return h('span', { key: 'stat-' + kind, title: '点击按类型过滤', onClick: function () { if (props.onSetGeneratedKind) props.onSetGeneratedKind(active ? 'all' : kind) },
                style: { padding: '2px 8px', borderRadius: '10px', border: '1px solid ' + (active ? COLORS.accent : COLORS.line), color: active ? COLORS.accent : COLORS.muted, cursor: 'pointer' } },
                (KIND_LABELS[kind] || kind) + ' ' + generatedStats[kind])
            }),
            generated.length ? h('span', { title: '点击预览最新底稿', onClick: function () { if (props.onPreviewWorkpaper) props.onPreviewWorkpaper(generated[0]) },
              style: { color: COLORS.accent, cursor: 'pointer', textDecoration: 'underline' } }, '最新：' + generated[0].created_at) : null),
          h('div', { style: { padding: '6px 14px' } },
            h('div', { className: 'ad-row ad-th', style: { display: 'flex', justifyContent: 'space-between' } },
              h('span', null, '索引号 · 底稿名称 · 文件'),
              h('span', null, '执行状态')),
            rows),
          h('details', { className: 'ad-more' },
            h('summary', null, '按类生成、打包与校验'),
            h('div', { className: 'ad-actions', style: { marginBottom: '8px' } },
              h('select', { value: props.reviewerName || '待复核', onChange: function (e) { if (props.onReviewerNameChange) props.onReviewerNameChange(e.target.value) },
                style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
                h('option', { value: '待复核' }, '复核人：待复核'),
                (props.members || []).map(function (m) { return h('option', { key: m.id, value: m.name }, '复核人：' + m.name) })),
              h(ui.Input, { className: 'ad-plain', type: 'date', value: props.generatedDate || '', onChange: function (e) { if (props.onGeneratedDateChange) props.onGeneratedDateChange(e.target.value) },
                style: { padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h(ui.Button, { variant: 'outline', size: 'sm', disabled: props.generating || readOnly, onClick: function () { if (props.onGenerateLocal) props.onGenerateLocal() } }, '本机引擎生成'),
              ['tb', 'fs', 'voucher'].map(function (k) {
                const label = k === 'tb' ? '余额表' : k === 'fs' ? '报表' : '凭证'
                const list = props.localAtts || []
                const value = (props.localAtt && props.localAtt[k]) || ''
                return h('select', { key: k, value: value, onChange: function (e) { if (props.onLocalAttChange) props.onLocalAttChange(Object.assign({}, props.localAtt || {}, { [k]: e.target.value })) },
                  style: { padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', maxWidth: '160px' } },
                  h('option', { value: '' }, label + '：自动'), list.map(function (a) { return h('option', { key: k + a.id, value: a.id }, a.filename) }))
              }),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportWorkpapers) props.onExportWorkpapers() } }, '打包下载'),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onExportWorkpaperList) props.onExportWorkpaperList() } }, '导出台账'),
              h('label', { className: 'ad-btn' }, '校验底稿包', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onVerifyWorkpapersZip) props.onVerifyWorkpapersZip(f); e.target.value = '' } })),
              props.wpsVerifyMessage ? h('span', { style: { fontSize: '11px', color: props.wpsVerifyMessage.indexOf('通过') >= 0 && props.wpsVerifyMessage.indexOf('未') < 0 ? '#16a34a' : '#b45309' } }, props.wpsVerifyMessage) : null,
              h('select', { className: 'ad-input', style: { width: 'auto' }, value: wpKind, onChange: function (e) { setWpKind(e.target.value) } },
                h('option', { value: 'currency' }, '货币资金 ZA'),
                h('option', { value: 'receivable' }, '应收账款 ZE'),
                h('option', { value: 'inventory' }, '存货 ZJ'),
                h('option', { value: 'revenue' }, '营业收入成本 SA')),
              h(ui.Button, { variant: 'outline', size: 'sm', disabled: props.generating || readOnly, onClick: function () { if (props.onGenerateWorkpaper) props.onGenerateWorkpaper(wpKind) } }, '生成所选'),
              props.generateMessage ? h('span', { className: 'ad-row-meta' }, props.generateMessage) : null),
            generated.length ? h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' } },
                h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '已生成底稿（' + filteredGenerated.length + (props.generatedKind && props.generatedKind !== 'all' ? ' / ' + generated.length : '') + '）'),
                h('select', { value: props.generatedKind || 'all', onChange: function (e) { if (props.onSetGeneratedKind) props.onSetGeneratedKind(e.target.value) },
                  style: { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                  h('option', { value: 'all' }, '全部类型'),
                  kindOptions.map(function (kind) { return h('option', { key: kind, value: kind }, KIND_LABELS[kind] || kind) }))),
              generatedRows) : h('div', { className: 'ad-row-meta' }, '还没有生成底稿')),
          eventsBlock('workpaper'))
      }
      if (props.zone === '审计程序') {
        // 程序表主界面：86 张程序表 + 逐科目 5 认定 / 实质性程序 / 关联底稿表
        return h(ProgramTablesZone, { project: props.project, onJumpZone: props.onJumpZone })
      }
      if (props.zone === '程序执行') {
        const allRows = props.programs || []
        const rows = progFilter === 'all' ? allRows
          : allRows.filter(function (r) { return (r.status || '待执行') === progFilter })
        const cycle = ['待执行', '进行中', '已完成', '不适用']
        const sourceStyle = {
          账载: { label: '账载', color: '#2f7cf6', hint: '导科目余额表/序时账' },
          外部: { label: '外部', color: '#b45309', hint: '收资料/发函' },
          现场: { label: '现场', color: '#7c3aed', hint: '监盘/盘点' },
          程序: { label: '程序', color: '#6b7280', hint: '执行/判断' },
        }
        const GROUP_ORDER = ['计划与风险评估', '货币资金', '应收账款', '存货', '固定资产与无形资产',
          '应付及其他应付款', '应付职工薪酬', '应交税费', '借款与利息', '收入与成本',
          '所有者权益', '特殊项目', '完成阶段', '数据核对', '控制测试', '评价与报告', '计划与范围']
        function groupRank(category) {
          const index = GROUP_ORDER.indexOf(category)
          return index >= 0 ? index : 999  // 其他/未分类排最后
        }
        function sourceBadge(source) {
          const meta = sourceStyle[source]
          if (!meta) return null
          return h('span', { title: meta.hint, style: { display: 'inline-block', marginLeft: '6px', padding: '0 6px', borderRadius: '6px', border: '1px solid ' + meta.color, color: meta.color, fontSize: '10px', lineHeight: '16px', whiteSpace: 'nowrap' } }, meta.label)
        }
        // 负责人下拉：项目成员 + 保留已有自定义值
        const memberNames = []
        ;(props.members || []).forEach(function (m) {
          const name = m && (m.name || m.username)
          if (name && memberNames.indexOf(name) < 0) memberNames.push(name)
        })
        function ownerSelect(row) {
          if (readOnly) return h('span', { style: { fontSize: '12px', color: row.owner ? 'inherit' : COLORS.muted } }, row.owner || '—')
          const current = row.owner || ''
          const options = [''].concat(memberNames)
          if (current && options.indexOf(current) < 0) options.push(current)
          return h('select', {
            value: current,
            onChange: function (e) { if (props.onUpdateProgramRow) props.onUpdateProgramRow(row.id, 'owner', e.target.value) },
            style: { width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' },
          }, options.map(function (name) { return h('option', { key: 'owner-' + row.id + '-' + (name || 'none'), value: name }, name || '未指派') }))
        }
        const btnStyle = { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11.5px', cursor: 'pointer', whiteSpace: 'nowrap' }
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '程序执行'),
              h('div', { className: 'ad-sub' }, (((props.project || {}).business_type) || '年报审计') + ' · ' + rows.length + ' 项。改完点保存。')),
            h('div', { className: 'ad-actions' },
              h('select', { className: 'ad-input', style: { width: 'auto', fontSize: '11px' }, value: progFilter, onChange: function (e) { setProgFilter(e.target.value) } },
                h('option', { value: 'all' }, '全部 ' + allRows.length),
                ['待执行', '进行中', '已完成', '不适用'].map(function (st) {
                  const n = allRows.filter(function (r) { return (r.status || '待执行') === st }).length
                  return h('option', { key: st, value: st }, st + ' ' + n)
                })),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onJumpZone) props.onJumpZone('审计程序') } }, '看程序表模板'),
              readOnly ? null : h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onSavePrograms) props.onSavePrograms() } }, '保存'))),
          h('details', { className: 'ad-more' },
            h('summary', null, '导出与补全'),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportPrograms) props.onExportPrograms() } }, '导出 Word'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportProgramsXlsx) props.onExportProgramsXlsx() } }, '导出 Excel'),
              readOnly ? null : h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onCompletePrograms) props.onCompletePrograms() } }, '补全程序清单'))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0 2px', fontSize: '11px', color: COLORS.muted } },
            h('span', null, '数据来源：'),
            ['账载', '外部', '现场', '程序'].map(function (src) {
              return h('span', { key: 'legend-' + src, style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                h('span', { style: { padding: '0 6px', borderRadius: '6px', border: '1px solid ' + sourceStyle[src].color, color: sourceStyle[src].color, fontSize: '10px', lineHeight: '16px' } }, sourceStyle[src].label),
                sourceStyle[src].hint)
            })),
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, '提示：点状态可切换（待执行→进行中→已完成→不适用）；负责人从项目成员中选择；改完点「保存」。'),
          props.importMessage ? h('div', { style: { fontSize: '12px', color: '#16a34a', margin: '6px 0' } }, props.importMessage) : null,
          rows.length ? (function () {
            const groups = []
            const seen = {}
            rows.forEach(function (row) {
              const category = row.category || '其他'
              if (!seen[category]) { seen[category] = true; groups.push(category) }
            })
            groups.sort(function (a, b) { return groupRank(a) - groupRank(b) || a.localeCompare(b, 'zh') })
            return groups.map(function (category) {
              const items = rows.filter(function (row) { return (row.category || '其他') === category })
              const done = items.filter(function (row) { return row.status === '已完成' }).length
              return h('div', { key: 'cat-' + category, style: { marginBottom: '14px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0 4px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(47,124,246,0.06)', fontSize: '13px', fontWeight: 600 } },
                  h('span', null, category),
                  h('span', { style: { fontSize: '11px', color: COLORS.muted, fontWeight: 400 } }, items.length + ' 项 · 已完成 ' + done)),
                h('div', { style: { display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 88px 128px minmax(0,1fr)', gap: '8px', alignItems: 'center', padding: '2px 0 4px', fontSize: '11px', color: COLORS.muted, borderBottom: '1px solid ' + COLORS.line } },
                  h('span', null, '#'),
                  h('span', null, '审计程序'),
                  h('span', null, '状态'),
                  h('span', null, '负责人'),
                  h('span', null, '备注 / 证据')),
                items.map(function (row) {
                  return h('div', { key: 'prog-' + row.id, style: { display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 88px 128px minmax(0,1fr)', gap: '8px', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                    h('span', { style: { color: COLORS.muted } }, row.seq + '.'),
                    h('span', { style: { minWidth: 0 } }, row.name, sourceBadge(row.source)),
                    h('span', { onClick: function () { if (!readOnly && props.onUpdateProgramRow) props.onUpdateProgramRow(row.id, 'status', cycle[(cycle.indexOf(row.status || '待执行') + 1) % cycle.length]) }, title: '点击切换状态', style: { cursor: readOnly ? 'default' : 'pointer' } },
                      h(Badge, { tone: row.status === '已完成' ? 'ok' : row.status === '进行中' ? 'warn' : row.status === '不适用' ? 'muted' : 'bad' }, row.status || '待执行')),
                    ownerSelect(row),
                    h(ui.Input, { className: 'ad-plain', value: row.note || '', onChange: function (e) { if (props.onUpdateProgramRow) props.onUpdateProgramRow(row.id, 'note', e.target.value) }, placeholder: '备注/证据', style: { padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', minWidth: 0 } }))
                }))
            })
          })() : h('div', { style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无审计程序，点「补全程序清单」生成全量清单'),
          (props.programEvents || []).filter(function (event) { return event.old_status }).length ? h('details', { className: 'ad-more', style: { marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('summary', null, '最近变更（' + (props.programEvents || []).filter(function (event) { return event.old_status }).length + '）'),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportProgramHistory) props.onExportProgramHistory() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出变更历史 Excel')),
            (props.programEvents || []).filter(function (event) { return event.old_status }).slice(0, 10).map(function (event, index) {
              return h('div', { key: 'pe-' + index, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid ' + COLORS.line } },
                h('span', null, (event.item_name || '') + '：' + (event.old_status || '') + ' → ' + (event.new_status || '') + '（' + (event.actor || '') + '）'),
                h('span', { style: { color: COLORS.muted } }, event.created_at))
            })) : null)
      }

      if (props.zone === '项目对话') {
        const linked = props.linked === null ? null : props.linked
        const sessionRows = linked === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载项目对话…')]
          : (linked.length ? linked.map(function (item) {
              return h('div', { key: item.session_id, onClick: function () { if (props.onOpenSession) props.onOpenSession(item.session_id) },
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid ' + COLORS.line, cursor: 'pointer' } },
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', minWidth: 0 } },
                  h('span', { style: { fontSize: '13px', color: COLORS.accent } }, '会话'),
                  h('span', { style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || item.session_id)),
                h('span', { style: { fontSize: '11px', color: COLORS.muted } }, item.created_at))
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '还没有项目对话，点下面新建一个')])
        return h('div', { style: { padding: '20px', maxWidth: '720px' } },
          h('div', { style: { fontSize: '14px', marginBottom: '6px' } }, '项目对话'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, lineHeight: 1.8, marginBottom: '8px' } },
            '会话与当前公司/项目关联；列表只显示本项目的对话，点会话可直接回到历史。'),
          h('button', {
            onClick: function () { if (props.onNewSession) props.onNewSession(props.company, props.project) },
            style: { marginBottom: '12px', padding: '9px 16px', borderRadius: '8px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '13px', cursor: 'pointer' },
          }, '+ 新建项目对话'),
          h('div', null, sessionRows))
      }
      if (props.zone === '审批状态') {
        const items = props.approvals === null ? null : props.approvals
        const statusFilter = props.approvalFilter || 'all'
        const filteredItems = items === null ? null : (statusFilter === 'all' ? items : items.filter(function (item) { return item.status === statusFilter }))
        const user = (props.auth && props.auth.user) || { name: '未登录', role: 'auditor', username: '' }
        const canApprove = inRole(user.role, 'manage')
        const approverMembers = (props.members || []).filter(function (m) { return ['manager', 'partner', 'kb-admin', 'admin'].indexOf(m.role) >= 0 })
        const toneOf = function (status) { return status === '已通过' ? 'ok' : status === '待审批' ? 'warn' : status === '已驳回' ? 'bad' : 'muted' }
        const rows = items === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载审批状态…')]
          : (filteredItems.length ? filteredItems.map(function (item) {
              const actions = []
              if (item.status === '待提交' || item.status === '已驳回') {
                if (approverMembers.length) {
                  actions.push(h('select', { key: 'approver', value: approvers[item.id] || approverMembers[0].username,
                    onChange: function (event) { const value = event.target.value; setApprovers(function (prev) { const next = Object.assign({}, prev); next[item.id] = value; return next }) },
                    style: { marginTop: '8px', marginRight: '6px', padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
                    approverMembers.map(function (m) { return h('option', { key: m.id, value: m.username }, '审批人：' + m.name) })))
                }
                actions.push(h(ui.Button, { variant: 'outline', size: 'sm', key: 'submit', onClick: function () { if (props.onSubmitApproval) props.onSubmitApproval(item, approvers[item.id] || (approverMembers[0] && approverMembers[0].username)) },
                  style: { marginTop: '8px', padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '12px', cursor: 'pointer' } }, '提交审批'))
              }
              const isAssigned = !item.assigned_username || item.assigned_username === user.username || user.role === 'kb-admin' || user.role === 'admin'
              if (item.status === '待审批' && !canApprove) {
                actions.push(h('div', { key: 'denied', style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } }, '当前身份为「' + user.name + '」，无审批权限（需项目经理/合伙人）'))
              }
              if (item.status === '待审批' && canApprove && !isAssigned) {
                actions.push(h('div', { key: 'waiting', style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } }, '等待指派审批人「' + (item.assigned_name || item.assigned_username) + '」审批'))
              }
              if (item.status === '待审批' && canApprove && isAssigned) {
                actions.push(h(ui.Input, { className: 'ad-plain', key: 'op', placeholder: '审批意见', value: opinions[item.id] || '',
                  onChange: function (e) { const v = e.target.value; setOpinions(function (prev) { const next = Object.assign({}, prev); next[item.id] = v; return next }) },
                  style: { marginTop: '8px', width: '260px', padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }))
                actions.push(h(ui.Button, { variant: 'outline', size: 'sm', key: 'ok', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'approve', opinions[item.id] || '') },
                  style: { marginTop: '8px', marginLeft: '6px', padding: '6px 12px', borderRadius: '7px', border: 0, background: '#16a34a', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '通过'))
                actions.push(h(ui.Button, { variant: 'outline', size: 'sm', key: 'no', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'reject', opinions[item.id] || '') },
                  style: { marginTop: '8px', marginLeft: '6px', padding: '6px 12px', borderRadius: '7px', border: 0, background: '#dc2626', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '驳回'))
              }
              const meta = [
                item.submitter ? '提交：' + item.submitter : '',
                item.assigned_name ? '指派审批：' + item.assigned_name : '',
                item.approver ? '审批：' + item.approver : '',
                item.opinion ? '意见：' + item.opinion : '',
                item.decided_at || item.submitted_at || '',
              ].filter(Boolean).join(' · ')
              return h('div', { key: item.id, className: 'ad-row', style: { alignItems: 'flex-start' } },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('div', { className: 'ad-row-title' }, item.title),
                  h('div', { className: 'ad-row-meta' }, (item.kind === 'engagement' ? '立项' : item.kind === 'review' ? '成果复核' : item.kind) + (meta ? ' · ' + meta : '')),
                  item.overdue_days ? h('div', { style: { marginTop: '4px' } }, h(Badge, { tone: item.overdue_days > 7 ? 'bad' : 'warn' }, '超期 ' + item.overdue_days + ' 天')) : null,
                  actions.length ? h('div', { className: 'ad-actions', style: { marginTop: '8px' } }, actions) : null),
                h(Badge, { tone: toneOf(item.status) }, item.status))

            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无审批事项')])
        const identityBar = h('div', { className: 'ad-toolbar', style: { marginBottom: '12px' } },
          h(AStatus, { tone: canApprove ? 'ok' : 'warn' }, user.name + ' · ' + (canApprove ? '可审批' : '只读/提交')),
          h('select', { className: 'ad-input', style: { width: 'auto' }, value: statusFilter, onChange: function (e) { if (props.onSetApprovalFilter) props.onSetApprovalFilter(e.target.value) } },
            h('option', { value: 'all' }, '全部状态（' + (items ? items.length : 0) + '）'),
            h('option', { value: '待提交' }, '待提交'),
            h('option', { value: '待审批' }, '待审批'),
            h('option', { value: '已通过' }, '已通过'),
            h('option', { value: '已驳回' }, '已驳回')),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportApprovals) props.onExportApprovals() } }, '导出'))
        if (readOnly) {
          return h('div', { style: { padding: '20px', maxWidth: '720px' } },
            h('div', { style: { fontSize: '14px', marginBottom: '6px' } }, '审批状态'),
            h('div', { style: { fontSize: '12px', color: '#b45309', marginBottom: '10px' } }, '项目已归档，审批只读。'),
            (props.approvals || []).map(function (item) {
              return h('div', { key: item.id, style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '13px' } },
                h('span', null, item.title + '：' + (item.assigned_name ? '指派 ' + item.assigned_name : '')),
                h(Badge, { tone: item.status === '已通过' ? 'ok' : item.status === '待审批' ? 'warn' : 'muted' }, item.status))
            }))
        }
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '审批'),
              h('div', { className: 'ad-sub' }, '提交后等指派人通过或驳回。超期提醒不代替审批。')),
            canApprove ? h(ui.Button, { variant: 'outline', size: 'sm', title: '扫描超期 ≥2 天的审批，升级并留痕通知', onClick: function () { if (props.onEscalateApprovals) props.onEscalateApprovals() } }, '催办超期审批') : null),
          props.escalateMessage ? h('div', { className: 'ad-note' }, props.escalateMessage) : null,
          identityBar,
          (function () {
            const versions = (props.report && props.report.versions) || []
            const finalized = versions.filter(function (v) { return v.status === '已定稿' }).length
            const reviewPending = (items || []).filter(function (i) { return i.kind === 'review' && (i.status === '待提交' || i.status === '已驳回') })
            if (!reviewPending.length || finalized) return null
            return h('div', { className: 'ad-note', style: { borderColor: '#b45309', color: '#b45309' } },
              h('div', { style: { marginBottom: '6px' } }, '有 ' + reviewPending.length + ' 项成果复核待提交，但报告还没有已定稿版本。按流程应先在「报告」定稿，再提交复核。'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onJumpZone) props.onJumpZone('报告') } }, '去报告页定稿'))
          })(),
          h('div', null, rows), eventsBlock('approval'))
      }
      if (props.zone === '报告') {
        const report = props.report || {}
        const checklist = report.checklist || []
        const opinion = report.opinion || null
        const draft = report.draft || null
        const statusTone = function (status) { return status === 'OK' ? 'ok' : status === 'TODO' ? 'warn' : 'bad' }
        const button = function (label, onClick, disabled) {
          return h(ui.Button, { variant: 'outline', size: 'sm', onClick: onClick, disabled: disabled,
            style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, label)
        }
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '报告'),
              h('div', { className: 'ad-sub' }, '初稿来自项目数据。出具前必须人工复核，系统不代下审计结论。')),
            h(ui.Button, { variant: 'primary', size: 'sm', disabled: readOnly || props.reportLoading, onClick: function () { if (props.onGenerateDraft) props.onGenerateDraft() } }, props.reportLoading ? '生成中…' : '生成报告初稿')),
          h(ReportOverviewPanel, { projectId: props.project ? props.project.id : '' }),
          h('details', { className: 'ad-more' },
            h('summary', null, '报告要素 · 意见类型 / 强调事项段 / 其他事项段'),
            h('div', { className: 'ad-form' },
            h('label', { className: 'ad-field' }, '审计意见类型',
              h('select', { className: 'ad-input', value: (props.reportElements || {}).opinion_type || '', onChange: function (e) { if (props.onSaveReportElements) props.onSaveReportElements({ opinion_type: e.target.value, emphasis: (props.reportElements || {}).emphasis || '', other_matters: (props.reportElements || {}).other_matters || '' }) } },
                h('option', { value: '' }, '未选择'),
                h('option', { value: '标准无保留意见' }, '标准无保留意见'),
                h('option', { value: '带强调事项段的无保留意见' }, '带强调事项段的无保留意见'),
                h('option', { value: '保留意见' }, '保留意见'),
                h('option', { value: '否定意见' }, '否定意见'),
                h('option', { value: '无法表示意见' }, '无法表示意见'))),
            h('label', { className: 'ad-field' }, '强调事项段',
              h('textarea', { className: 'ad-input', value: (tmpElements.emphasis !== undefined ? tmpElements.emphasis : (props.reportElements || {}).emphasis) || '', rows: 2, onChange: function (e) { setTmpElements(function (p) { return Object.assign({}, p, { emphasis: e.target.value }) }) } })),
            h('label', { className: 'ad-field' }, '其他事项段',
              h('textarea', { className: 'ad-input', value: (tmpElements.other_matters !== undefined ? tmpElements.other_matters : (props.reportElements || {}).other_matters) || '', rows: 2, onChange: function (e) { setTmpElements(function (p) { return Object.assign({}, p, { other_matters: e.target.value }) }) } })),
            h('div', { className: 'ad-form-actions' },
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onSaveReportElements) props.onSaveReportElements(Object.assign({}, props.reportElements || {}, tmpElements)) } }, '保存'),
              props.reportElementsMsg ? h('span', { className: 'ad-row-meta' }, props.reportElementsMsg) : null))),
          props.completeness && !props.completeness.ready ? h('div', { style: { marginBottom: '10px', fontSize: '12px', color: '#b45309' } }, '⚠ 报告完整性未完成（' + props.completeness.ok_count + '/' + props.completeness.count + '）：建议先处理未完成项再定稿/出具。') : null,
          props.completeness ? h('div', { style: { marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', border: '1px solid ' + (props.completeness.ready ? '#16a34a' : COLORS.line), fontSize: '12px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
              h('div', { style: { fontWeight: 600 } }, '报告完整性（' + props.completeness.ok_count + '/' + props.completeness.count + '）'),
              h('span', { style: { color: props.completeness.ready ? '#16a34a' : '#b45309' } }, props.completeness.ready ? '可出具' : '存在未完成项')),
            (props.completeness.items || []).map(function (item) {
              return h('div', { key: 'cp-' + item.key, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: COLORS.muted } },
                h('span', null, (item.status === 'OK' ? '✓ ' : item.status === 'RISK' ? '✗ ' : '○ ') + item.label),
                h('span', null, item.detail))
            })) : null,
          report.message ? h('div', { style: { fontSize: '12px', color: '#b45309', marginBottom: '10px' } }, report.message) : null,
          h('div', { className: 'ad-actions', style: { marginBottom: '16px' } },
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onLoadChecklist) props.onLoadChecklist() } }, '检查清单'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onLoadOpinion) props.onLoadOpinion() } }, '审计意见'),
            draft ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportDocx) props.onExportDocx(draft.version_id) } }, '导出 Word') : null,
            draft ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportPdf) props.onExportPdf(draft.version_id) } }, '导出 PDF') : null,
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onGenerateLetter) props.onGenerateLetter() } }, '管理层声明书'),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { if (props.onLoadVersions) props.onLoadVersions() } }, '历史版本')),
          checklist.length ? h('div', { style: { marginBottom: '16px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '报告检查清单（' + checklist.length + '）'),
            checklist.map(function (item, index) {
              return h('div', { key: 'cl-' + index, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('div', null, h('span', null, item.item), item.detail ? h('span', { style: { color: COLORS.muted, marginLeft: '8px' } }, item.detail) : null),
                h(Badge, { tone: statusTone(item.status) }, item.status))
            })) : null,
          (function () {
            const mis = props.misstates || { items: [] }
            const items = mis.items || []
            if (!items.length) return null
            return h('div', { style: { marginBottom: '16px', padding: '12px', borderRadius: '10px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, '未更正错报汇总（' + (mis.uncorrected_count || items.length) + ' 项，合计 ' + (mis.uncorrected_total || 0) + '）'),
              h('div', { style: { fontSize: '11px', color: '#b45309', marginBottom: '6px' } }, '报告出具前须逐项询问/调整；未处理项会进入报告检查清单。'),
              items.slice(0, 12).map(function (item) {
                return h('div', { key: 'mis-' + item.id, style: { padding: '5px 0', borderTop: '1px solid ' + COLORS.line, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' } },
                  h('span', null, item.description + (item.source ? '（' + item.source + '）' : '') + ' · 金额 ' + (item.amount || 0)),
                  h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                    h(Badge, { tone: item.status === '已调整' ? 'ok' : item.status === '已询问' ? 'warn' : 'bad' }, item.status),
                    item.status !== '已询问' ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onUpdateMisstatement) props.onUpdateMisstatement(item.id, '已询问') }, style: { padding: '1px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '已询问') : null,
                    item.status !== '已调整' ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onUpdateMisstatement) props.onUpdateMisstatement(item.id, '已调整') }, style: { padding: '1px 6px', borderRadius: '6px', border: '1px solid #16a34a', background: 'transparent', color: '#16a34a', fontSize: '10px', cursor: 'pointer' } }, '已调整') : null))
              }))
          })(),
          h('details', { className: 'ad-more' },
            h('summary', null, '关键审计事项（KAM）'),
            h(KamPanel, { projectId: props.project ? props.project.id : '' })),
          h('details', { className: 'ad-more' },
            h('summary', null, '审计证据链'),
            h(EvidencePanel, { projectId: props.project ? props.project.id : '' })),
          opinion ? h('div', { style: { marginBottom: '16px', padding: '12px', borderRadius: '10px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, '审计意见：' + (opinion.level || '')),
            h('div', { style: { fontSize: '12px', lineHeight: 1.7 } }, opinion.text || ''),
            (opinion.limits || []).length ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '6px' } }, '限制事项：' + (opinion.limits || []).join('；')) : null) : null,
          draft ? h('div', null,
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '报告初稿：' + draft.filename),
            h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: 1.7, background: COLORS.bg, padding: '12px', borderRadius: '10px', maxHeight: '420px', overflow: 'auto' } }, draft.content)) : null,
          (report.versions || []).length ? h('details', { className: 'ad-more', style: { marginTop: '16px' } },
            h('summary', null, '历史版本（' + (report.versions || []).length + '）'),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '历史版本（' + report.versions.length + '）'),
              h('select', { value: props.reportVersionFilter || 'all', onChange: function (e) { if (props.onSetReportVersionFilter) props.onSetReportVersionFilter(e.target.value) },
                style: { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                h('option', { value: 'all' }, '全部状态'),
                h('option', { value: '草稿' }, '草稿'),
                h('option', { value: '复核中' }, '复核中'),
                h('option', { value: '已复核' }, '已复核'),
                h('option', { value: '已定稿' }, '已定稿'))),
            (props.reportVersionFilter && props.reportVersionFilter !== 'all' ? report.versions.filter(function (v) { return (v.status || '草稿') === props.reportVersionFilter }) : report.versions).map(function (version) {
              const canFinalize = inRole(((props.auth && props.auth.user) || {}).role, 'partner')
              return h('div', { key: 'v-' + version.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, version.filename + ' · ' + version.created_by + ' · ' + version.created_at + (version.status === '已复核' && version.reviewed_by ? (' · 复核：' + version.reviewed_by + (version.finalized_at ? '（' + version.finalized_at + '）' : '')) : '')),
                  h(Badge, { tone: (version.status === '已定稿' || version.status === '已复核') ? 'ok' : version.status === '复核中' ? 'warn' : 'muted' }, version.status || '草稿')),
                h('div', { style: { display: 'flex', gap: '10px' } },
                  version.status !== '已定稿' ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onSubmitReview) props.onSubmitReview(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '提交复核') : null,
                  (version.status !== '已定稿' && canFinalize) ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onFinalizeReport) props.onFinalizeReport(version.id) }, style: { border: 0, background: 'transparent', color: '#16a34a', fontSize: '12px', cursor: 'pointer' } }, '定稿') : null,
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onDownloadVersion) props.onDownloadVersion(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载 MD'),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportDocx) props.onExportDocx(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出 Word'),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportPdf) props.onExportPdf(version.id) }, style: { border: 0, background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '导出 PDF')))
            })) : null,
          h(ReportSealPanel, { projectId: props.project ? props.project.id : '' }),
          (function () {
            const versions = report.versions || []
            const finalized = versions.filter(function (v) { return v.status === '已定稿' })
            return h('div', { className: 'ad-card', style: { marginTop: '12px' } },
              h('div', { className: 'ad-row-title', style: { marginBottom: '4px' } }, '下一步'),
              h('div', { className: 'ad-row-meta' }, finalized.length
                ? ('报告已定稿 ' + finalized.length + ' 版。下一步提交审批，审批通过后归档。')
                : '报告尚未定稿。定稿后才能提交审批；审批通过后归档。'),
              finalized.length ? h('div', { className: 'ad-actions', style: { marginTop: '8px' } },
                h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onJumpZone) props.onJumpZone('审批状态') } }, '去提交审批')) : null)
          })())
      }
      if (props.zone === '归档') {
        return h('div', { className: 'ad-zone-page' },
          h('div', { className: 'ad-head' },
            h('div', null,
              h('h1', { className: 'ad-title' }, '归档'),
              h('div', { className: 'ad-sub' }, readOnly ? '项目已归档，只读。' : '归档后项目锁定，只能查看和下载。归档包可单独导出。')),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (props.onExportArchive) props.onExportArchive() }, disabled: props.exporting }, props.exporting ? '打包中…' : '导出归档包'),
              readOnly ? null : h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { if (props.onArchiveProject) props.onArchiveProject() } }, '归档项目'))),
          (function () {
            const list = props.approvals || []
            const pending = list.filter(function (a) { return a.status === '待审批' }).length
            const rejected = list.filter(function (a) { return a.status === '已驳回' }).length
            if (!pending && !rejected) return null
            return h('div', { className: 'ad-note', style: { borderColor: rejected ? '#b91c1c' : '#b45309', color: rejected ? '#b91c1c' : '#b45309' } },
              rejected
                ? ('有 ' + rejected + ' 项审批被驳回，归档前应先处理（见「审批状态」）。')
                : ('还有 ' + pending + ' 项审批进行中，建议完成后再归档（见「审批状态」）。'))
          })(),
          h(ArchivePackagePanel, { projectId: props.project ? props.project.id : '' }),
          h(ProjectFieldsPanel, { projectId: props.project ? props.project.id : '' }),
          readOnly ? h('div', { className: 'ad-note' }, '项目已归档：所有写操作已锁定，仅可查看/下载。') : null)
      }
      return h('div', null)
    }

    function CompaniesPage(props) {
      const state = React.useState({ loading: true, companies: [], error: '' })
      const companies = state[0].companies; const loading = state[0].loading; const error = state[0].error; const setData = state[1]
      const savedContext = (function () { try { return JSON.parse(localStorage.getItem('auditdesk.lastContext') || '{}') || {} } catch (e) { return {} } })()
      const companyState = React.useState(savedContext.company || null); const activeCompany = companyState[0]; const setActiveCompany = companyState[1]
      const projectState = React.useState(savedContext.project || null); const activeProject = projectState[0]; const setActiveProject = projectState[1]
      // 客户只有一个年度项目时自动选中，省掉再点一次（也保证依赖 activeProject 的接口能取到值）
      React.useEffect(function () {
        if (activeProject) return
        const cur = (companies || []).filter(function (c) { return c.name === activeCompany })[0]
        const list = (cur && cur.projects) || []
        if (list.length === 1) setActiveProject(list[0].id)
      }, [activeCompany, activeProject, companies])
      const roleCode = ((props.auth && props.auth.user && props.auth.user.role) || 'auditor')
      const roleLanding = { auditor: '资料清单', manager: '审批状态', partner: '报告', 'kb-admin': '概览', admin: '概览' }[roleCode] || '概览'
      const zoneState = React.useState(savedContext.zone || roleLanding); const zone = zoneState[0]; const setZone = zoneState[1]
      const recentState = React.useState(function () { try { return JSON.parse(localStorage.getItem('auditdesk.recentProjects') || '[]') || [] } catch (e) { return [] } })
      const recentProjects = recentState[0]; const setRecentProjects = recentState[1]
      React.useEffect(function () {
        if (!activeProject) return
        try {
          const company = activeCompany || ''
          const next = [{ company: company, project: activeProject, at: new Date().toISOString() }]
            .concat((recentProjects || []).filter(function (item) { return !(item.project === activeProject && item.company === company) }))
            .slice(0, 5)
          setRecentProjects(next)
          localStorage.setItem('auditdesk.recentProjects', JSON.stringify(next))
        } catch (e) {}
      }, [activeProject])
      const pendingCountsState = React.useState({}); const pendingCounts = pendingCountsState[0]; const setPendingCounts = pendingCountsState[1]
      React.useEffect(function () {
        refreshPendingCounts()
        const timer = setInterval(refreshPendingCounts, 60000)
        return function () { clearInterval(timer) }
      }, [])
      const pinnedState = React.useState(function () { try { return JSON.parse(localStorage.getItem('auditdesk.pinnedProjects') || '[]') || [] } catch (e) { return [] } })
      const pinnedProjects = pinnedState[0]; const setPinnedProjects = pinnedState[1]
      function togglePinProject(item) {
        const exists = (pinnedProjects || []).some(function (p) { return p.project === item.project })
        const next = exists ? (pinnedProjects || []).filter(function (p) { return p.project !== item.project }) : ([{ company: item.company, project: item.project }].concat(pinnedProjects || []).slice(0, 5))
        setPinnedProjects(next)
        try { localStorage.setItem('auditdesk.pinnedProjects', JSON.stringify(next)) } catch (e) {}
      }
      function removeRecentProject(project) {
        const next = (recentProjects || []).filter(function (item) { return item.project !== project })
        setRecentProjects(next)
        try { localStorage.setItem('auditdesk.recentProjects', JSON.stringify(next)) } catch (e) {}
      }
      function projectMeta(item) {
        try {
          const company = (companies || []).filter(function (c) { return c.name === item.company })[0]
          const project = company ? (company.projects || []).filter(function (p) { return p.id === item.project })[0] : null
          return project ? { status: project.status || '', period: project.period || '', business_type: project.business_type || '' } : null
        } catch (e) { return null }
      }
      const restoredRef = React.useRef(false)
      React.useEffect(function () {
        try { localStorage.setItem('auditdesk.lastContext', JSON.stringify({ company: activeCompany, project: activeProject, zone: zone })) } catch (e) {}
      }, [activeCompany, activeProject, zone])
      React.useEffect(function () {
        if (restoredRef.current || !companies.length) return
        restoredRef.current = true
        const saved = savedContext
        const target = companies.filter(function (c) { return c.name === saved.company })[0]
        if (!target) {
          if (activeCompany && !companies.some(function (c) { return c.name === activeCompany })) setActiveCompany(null)
          return
        }
        if (!activeCompany) setActiveCompany(target.name)
        const projectExists = (target.projects || []).some(function (p) { return p.id === saved.project })
        if (saved.project && projectExists && !activeProject) setActiveProject(saved.project)
      }, [companies])
      React.useEffect(function () {
        function onCycle(e) { setWpCycle((e && e.detail) || 'all') }
        try { window.addEventListener('auditdesk:wp-cycle', onCycle) } catch (e) {}
        return function () { try { window.removeEventListener('auditdesk:wp-cycle', onCycle) } catch (e) {} }
      }, [])
      const [wpCycle, setWpCycle] = React.useState(function () {
        // 留痕页「查看现状」留下的科目循环预填值（读一次即清）
        try {
          const v = localStorage.getItem('auditdesk.pendingWpCycle') || ''
          if (v) localStorage.removeItem('auditdesk.pendingWpCycle')
          return v || 'all'
        } catch (e) { return 'all' }
      })
      const pbcState = React.useState(null); const pbc = pbcState[0]; const setPbc = pbcState[1]
      const wpState = React.useState(null); const wp = wpState[0]; const setWp = wpState[1]
      const linkedState = React.useState(null); const linked = linkedState[0]; const setLinked = linkedState[1]
      const eventsState = React.useState([]); const events = eventsState[0]; const setEvents = eventsState[1]
      const approvalsState = React.useState(null); const approvals = approvalsState[0]; const setApprovals = approvalsState[1]
      const newPbcState = React.useState(''); const newPbcName = newPbcState[0]; const setNewPbcName = newPbcState[1]
      const previewState = React.useState(null); const preview = previewState[0]; const setPreview = previewState[1]
      const generatedState = React.useState(null); const generated = generatedState[0]; const setGenerated = generatedState[1]
      const exportingState = React.useState(false); const exporting = exportingState[0]; const setExporting = exportingState[1]
      const reportState = React.useState({}); const report = reportState[0]; const setReport = reportState[1]
      const analysisState = React.useState(null); const analysis = analysisState[0]; const setAnalysis = analysisState[1]
      const matHistoryState = React.useState([]); const matHistory = matHistoryState[0]; const setMatHistory = matHistoryState[1]
      const importMessageState = React.useState(''); const importMessage = importMessageState[0]; const setImportMessage = importMessageState[1]
      const confirmationsState = React.useState([]); const confirmations = confirmationsState[0]; const setConfirmations = confirmationsState[1]
      const inventoryCountsState = React.useState([]); const inventoryCounts = inventoryCountsState[0]; const setInventoryCounts = inventoryCountsState[1]
      const inventoryAttachmentsState = React.useState([]); const inventoryAttachments = inventoryAttachmentsState[0]; const setInventoryAttachments = inventoryAttachmentsState[1]
      const inventoryMetaState = React.useState({}); const inventoryMeta = inventoryMetaState[0]; const setInventoryMeta = inventoryMetaState[1]
      const programsState = React.useState([]); const programs = programsState[0]; const setPrograms = programsState[1]
      const newFsState = React.useState(null); const newFsFile = newFsState[0]; const setNewFsFile = newFsState[1]
      const newTbState = React.useState(null); const newTbFile = newTbState[0]; const setNewTbFile = newTbState[1]
      const newJournalState = React.useState(null); const newJournalFile = newJournalState[0]; const setNewJournalFile = newJournalState[1]
      const programEventsState = React.useState([]); const programEvents = programEventsState[0]; const setProgramEvents = programEventsState[1]
      const escalateState = React.useState(''); const escalateMessage = escalateState[0]; const setEscalateMessage = escalateState[1]
      const archiveVerifyState = React.useState(''); const archiveVerifyMessage = archiveVerifyState[0]; const setArchiveVerifyMessage = archiveVerifyState[1]
      const previewZoomState = React.useState(function () { try { const value = parseFloat(localStorage.getItem('auditdesk.previewZoom') || '1'); return Number.isFinite(value) && value >= 0.5 && value <= 3 ? value : 1 } catch (e) { return 1 } })
      const previewZoom = previewZoomState[0]; const setPreviewZoom = previewZoomState[1]
      React.useEffect(function () { try { localStorage.setItem('auditdesk.previewZoom', String(previewZoom)) } catch (e) {} }, [previewZoom])
      const wpStatusFilterState = React.useState(function () { try { return localStorage.getItem('auditdesk.wp.statusFilter') || 'all' } catch (e) { return 'all' } })
      const wpStatusFilter = wpStatusFilterState[0]; const setWpStatusFilter = wpStatusFilterState[1]
      const wpSearchState = React.useState(''); const wpSearch = wpSearchState[0]; const setWpSearch = wpSearchState[1]
      React.useEffect(function () { try { localStorage.setItem('auditdesk.wp.statusFilter', wpStatusFilter || 'all') } catch (e) {} }, [wpStatusFilter])
      const todoOverdueState = React.useState(function () { try { return localStorage.getItem('auditdesk.todo.overdueOnly') === '1' } catch (e) { return false } })
      const todoOverdueOnly = todoOverdueState[0]; const setTodoOverdueOnly = todoOverdueState[1]
      React.useEffect(function () { try { localStorage.setItem('auditdesk.todo.overdueOnly', todoOverdueOnly ? '1' : '0') } catch (e) {} }, [todoOverdueOnly])
      const approvalFilterState = React.useState('all'); const approvalFilter = approvalFilterState[0]; const setApprovalFilter = approvalFilterState[1]
      const approvalFilterRestored = React.useRef(false)
      React.useEffect(function () {
        if (!approvalFilterRestored.current) return
        try {
          localStorage.setItem('auditdesk.approvalFilter', approvalFilter || 'all')
          if (activeProject) localStorage.setItem('auditdesk.approvalFilter.' + activeProject, approvalFilter || 'all')
        } catch (e) {}
      }, [approvalFilter, activeProject])
      React.useEffect(function () {
        if (!activeProject) return
        try {
          const saved = localStorage.getItem('auditdesk.approvalFilter.' + activeProject)
          if (saved) setApprovalFilter(saved)
        } catch (e) {}
        approvalFilterRestored.current = true
      }, [activeProject])
      const reportVersionFilterState = React.useState(function () { try { return localStorage.getItem('auditdesk.report.versionFilter') || 'all' } catch (e) { return 'all' } })
      const reportVersionFilter = reportVersionFilterState[0]; const setReportVersionFilter = reportVersionFilterState[1]
      const reportVersionFilterRestored = React.useRef(false)
      React.useEffect(function () {
        if (!reportVersionFilterRestored.current) return
        try { localStorage.setItem('auditdesk.report.versionFilter', reportVersionFilter || 'all') } catch (e) {}
        if (activeProject) { try { localStorage.setItem('auditdesk.report.versionFilter.' + activeProject, reportVersionFilter || 'all') } catch (e) {} }
      }, [reportVersionFilter, activeProject])
      React.useEffect(function () {
        if (!activeProject) return
        try {
          const saved = localStorage.getItem('auditdesk.report.versionFilter.' + activeProject)
          if (saved) setReportVersionFilter(saved)
        } catch (e) {}
        reportVersionFilterRestored.current = true
      }, [activeProject])
      const completenessState = React.useState(null); const completeness = completenessState[0]; const setCompleteness = completenessState[1]
      const reportElementsState = React.useState({}); const reportElements = reportElementsState[0]; const setReportElements = reportElementsState[1]
      const reportElementsMsgState = React.useState(''); const reportElementsMsg = reportElementsMsgState[0]; const setReportElementsMsg = reportElementsMsgState[1]
      const misstatesState = React.useState({ items: [], uncorrected_count: 0, uncorrected_total: 0 }); const misstates = misstatesState[0]; const setMisstates = misstatesState[1]
      const clientCheckState = React.useState(null); const clientCheck = clientCheckState[0]; const setClientCheck = clientCheckState[1]
      const clientCheckMsgState = React.useState(''); const clientCheckMsg = clientCheckMsgState[0]; const setClientCheckMsg = clientCheckMsgState[1]
      const wpsVerifyState = React.useState(''); const wpsVerifyMessage = wpsVerifyState[0]; const setWpsVerifyMessage = wpsVerifyState[1]
      const generatedKindState = React.useState('all'); const generatedKind = generatedKindState[0]; const setGeneratedKind = generatedKindState[1]
      const checklistKindState = React.useState('subsequent'); const checklistKind = checklistKindState[0]; const setChecklistKind = checklistKindState[1]
      const dataEventsState = React.useState([]); const dataEvents = dataEventsState[0]; const setDataEvents = dataEventsState[1]
      const multiFileState = React.useState(null); const multiFile = multiFileState[0]; const setMultiFile = multiFileState[1]
      const multiSheetsState = React.useState([]); const multiSheets = multiSheetsState[0]; const setMultiSheets = multiSheetsState[1]
      const multiSheetIndexState = React.useState('0'); const multiSheetIndex = multiSheetIndexState[0]; const setMultiSheetIndex = multiSheetIndexState[1]
      const multiKindState = React.useState('tb'); const multiKind = multiKindState[0]; const setMultiKind = multiKindState[1]
      const multiLoadingState = React.useState(false); const multiLoading = multiLoadingState[0]; const setMultiLoading = multiLoadingState[1]
      const showCreateState = React.useState(false); const showCreate = showCreateState[0]; const setShowCreate = showCreateState[1]
      const searchState = React.useState(''); const search = searchState[0]; const setSearch = searchState[1]
      const statusFilterState = React.useState(''); const statusFilter = statusFilterState[0]; const setStatusFilter = statusFilterState[1]
      const newClientState = React.useState(''); const newClient = newClientState[0]; const setNewClient = newClientState[1]
      const newNameState = React.useState(''); const newName = newNameState[0]; const setNewName = newNameState[1]
      const newPeriodState = React.useState(''); const newPeriod = newPeriodState[0]; const setNewPeriod = newPeriodState[1]
      const contractIdState = React.useState(''); const contractId = contractIdState[0]; const setContractId = contractIdState[1]
      const contractsState = React.useState([]); const contracts = contractsState[0]; const setContracts = contractsState[1]
      const businessTypeState = React.useState('年报审计'); const businessType = businessTypeState[0]; const setBusinessType = businessTypeState[1]
      const creatingState = React.useState(false); const creating = creatingState[0]; const setCreating = creatingState[1]
      const renameOpenState = React.useState(false); const renameOpen = renameOpenState[0]; const setRenameOpen = renameOpenState[1]
      const deleteOpenState = React.useState(false); const deleteOpen = deleteOpenState[0]; const setDeleteOpen = deleteOpenState[1]
      const mgmtClientState = React.useState(''); const mgmtClient = mgmtClientState[0]; const setMgmtClient = mgmtClientState[1]
      const mgmtNameState = React.useState(''); const mgmtName = mgmtNameState[0]; const setMgmtName = mgmtNameState[1]
      const mgmtErrorState = React.useState(''); const mgmtError = mgmtErrorState[0]; const setMgmtError = mgmtErrorState[1]
      const createErrorState = React.useState(''); const createError = createErrorState[0]; const setCreateError = createErrorState[1]
      const reportLoadingState = React.useState(false); const reportLoading = reportLoadingState[0]; const setReportLoading = reportLoadingState[1]
      const generatingState = React.useState(false); const generating = generatingState[0]; const setGenerating = generatingState[1]
      const generateMessageState = React.useState(''); const generateMessage = generateMessageState[0]; const setGenerateMessage = generateMessageState[1]
      const reviewerState = React.useState('待复核'); const reviewerName = reviewerState[0]; const setReviewerName = reviewerState[1]
      const membersState = React.useState([]); const members = membersState[0]; const setMembers = membersState[1]
      const newMemberState = React.useState(''); const newMemberName = newMemberState[0]; const setNewMemberName = newMemberState[1]
      const localAttState = React.useState({ tb: '', fs: '', voucher: '' }); const localAtt = localAttState[0]; const setLocalAtt = localAttState[1]
      const dateState = React.useState((function () {
        const now = new Date()
        const pad = function (value) { return String(value).padStart(2, '0') }
        return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      })()); const generatedDate = dateState[0]; const setGeneratedDate = dateState[1]

      function cyclePbc(item) {
        const next = item.status === '未交' ? '待补' : item.status === '待补' ? '已交' : '未交'
        setPbc(function (prev) { return (prev || []).map(function (row) { return row.id === item.id ? Object.assign({}, row, { status: next }) : row }) })
        api('/audit/pbc/status', null, { method: 'POST', body: { id: item.id, status: next } })
          .then(function (d) {
            if (!d || !d.item) return
            setPbc(function (prev) { return (prev || []).map(function (row) { return row.id === d.item.id ? d.item : row }) })
            api('/audit/events', { project: activeProject, limit: 40 }).then(function (e) { setEvents(e.events || []) }).catch(function () {})
          })
          .catch(function () { /* 失败回滚：重新拉取 */ api('/audit/pbc', { project: activeProject }).then(function (d) { setPbc(d.items || []) }).catch(function () {}) })
      }

      React.useEffect(function () {
        if (!activeProject) { setPbc(null); setWp(null); return }
        let cancelled = false
        setPbc(null); setWp(null)
        api('/audit/pbc', { project: activeProject }).then(function (d) { if (!cancelled) setPbc(d.items || []) })
          .catch(function () { if (!cancelled) setPbc([]) })
        api('/audit/workpapers', { project: activeProject }).then(function (d) { if (!cancelled) setWp(d.items || []) })
          .catch(function () { if (!cancelled) setWp([]) })
        api('/audit/project_sessions', { project: activeProject }).then(function (d) { if (!cancelled) setLinked(d.sessions || []) })
          .catch(function () { if (!cancelled) setLinked([]) })
        api('/audit/events', { project: activeProject, limit: 40 }).then(function (d) { if (!cancelled) setEvents(d.events || []) })
          .catch(function () { if (!cancelled) setEvents([]) })
        api('/audit/approvals', { project: activeProject }).then(function (d) { if (!cancelled) setApprovals(d.items || []) })
          .catch(function () { if (!cancelled) setApprovals([]) })
        api('/audit/workpapers/generated', { project: activeProject }).then(function (d) { if (!cancelled) setGenerated(d.items || []) })
          .catch(function () { if (!cancelled) setGenerated([]) })
        api('/audit/members', { project: activeProject }).then(function (d) { if (!cancelled) setMembers(d.items || []) })
          .catch(function () { if (!cancelled) setMembers([]) })
        setAnalysis(null)
        api('/audit/analysis/summary', { project: activeProject }).then(function (d) { if (!cancelled) setAnalysis(d) })
          .catch(function () { if (!cancelled) setAnalysis(null) })
        api('/audit/analysis/materiality/history', { project: activeProject }).then(function (d) { if (!cancelled) setMatHistory(d.items || []) })
          .catch(function () { if (!cancelled) setMatHistory([]) })
        api('/audit/confirmations', { project: activeProject }).then(function (d) { if (!cancelled) setConfirmations(d.items || []) })
          .catch(function () { if (!cancelled) setConfirmations([]) })
        api('/audit/inventory-counts', { project: activeProject }).then(function (d) { if (!cancelled) setInventoryCounts(d.items || []) })
          .catch(function () { if (!cancelled) setInventoryCounts([]) })
        api('/audit/inventory-attachments', { project: activeProject }).then(function (d) { if (!cancelled) setInventoryAttachments(d.items || []) })
          .catch(function () { if (!cancelled) setInventoryAttachments([]) })
        api('/audit/inventory-meta', { project: activeProject }).then(function (d) { if (!cancelled) setInventoryMeta(d.item || {}) })
          .catch(function () { if (!cancelled) setInventoryMeta({}) })
        api('/audit/report/completeness', { project: activeProject }).then(function (d) { if (!cancelled) setCompleteness(d) })
          .catch(function () { if (!cancelled) setCompleteness(null) })
        api('/audit/report/elements', { project: activeProject }).then(function (d) { if (!cancelled) setReportElements((d && d.elements) || {}) })
          .catch(function () { if (!cancelled) setReportElements({}) })
        api('/audit/misstatements', { project: activeProject }).then(function (d) { if (!cancelled) setMisstates(d || { items: [] }) })
          .catch(function () { if (!cancelled) setMisstates({ items: [] }) })
        api('/audit/programs', { project: activeProject }).then(function (d) { if (!cancelled) setPrograms(d.items || []) })
          .catch(function () { if (!cancelled) setPrograms([]) })
        api('/audit/events', { project: activeProject, item_type: 'program', limit: 30 }).then(function (d) { if (!cancelled) setProgramEvents(d.events || []) })
          .catch(function () { if (!cancelled) setProgramEvents([]) })
        api('/audit/events', { project: activeProject, item_type: 'data', limit: 10 }).then(function (d) { if (!cancelled) setDataEvents(d.events || []) })
          .catch(function () { if (!cancelled) setDataEvents([]) })
        setGenerateMessage('')
        setReport({})
        return function () { cancelled = true }
      }, [activeProject])

      function safeName(value) {
        return String(value || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      }
      async function ensureDir(ui, parentPath, name) {
        const listing = await ui.listDirectory(parentPath)
        const found = (listing.entries || []).filter(function (entry) { return entry.name === name })[0]
        if (found) return found.path
        return await ui.createDirectory(parentPath, name)
      }
      async function ensureProjectWorkspace(company, project) {
        const ui = props.ui.uiWorkspace
        const workspaces = props.ui.workspaces
        const home = (await ui.listDirectory()).home
        const base = await ensureDir(ui, home, 'AuditDeskProjects')
        const companyDir = await ensureDir(ui, base, safeName(company))
        const projectDir = await ensureDir(ui, companyDir, safeName(project ? project.name : 'project'))
        const workspace = await workspaces.create({ path: projectDir })
        const title = String(company || '') + ' / ' + String(project ? project.name : '')
        if (workspace.title !== title) {
          try { await workspaces.rename(workspace.workspaceId, title) } catch (e) {}
        }
        return workspace
      }
      async function ensureViaHostCommand(company, project) {
        const ui = props.ui
        if (!ui.remote || !ui.remote.commands) return null
        const snapshot = ui.sessions.list.getSnapshot()
        let commandSession = (snapshot.ids || [])[0]
        let temporary = null
        if (!commandSession) {
          temporary = await ui.sessions.create({})
          commandSession = temporary
        }
        try {
          await ui.remote.commands.execute(commandSession, '/audit-project ' + company + '|' + (project ? project.name : ''), [])
        } finally {
          if (temporary) { try { await ui.uiWorkspace.archiveSession(temporary) } catch (e) {} }
        }
        const title = String(company || '') + ' / ' + String(project ? project.name : '')
        const deadline = Date.now() + 8000
        while (Date.now() < deadline) {
          const items = (ui.workspaces.list.getSnapshot().items || [])
          const found = items.filter(function (item) { return item.title === title })[0]
          if (found) return found
          await new Promise(function (resolve) { setTimeout(resolve, 300) })
        }
        return null
      }

      function refreshPendingCounts() {
        api('/audit/approvals/pending-counts').then(function (d) { setPendingCounts((d && d.counts) || {}) }).catch(function () {})
      }
      function jumpTodoZone(kind) {
        const map = { '底稿复核': '审计底稿', '底稿校验': '审计底稿', '报告复核': '报告', '归档校验': '概览', '立项审批': '概览', 'engagement': '概览', 'review': '报告' }
        setZone(map[kind] || '审批状态')
      }
      function exportApprovals() {
        if (!activeProject) return
        const params = '?project=' + encodeURIComponent(activeProject) + '&status=' + encodeURIComponent(approvalFilter || 'all')
        fetch(BASE + '/audit/approvals/export' + params, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '审批列表_' + (approvalFilter === 'all' ? '全部' : approvalFilter) + '.csv'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function (e) { setError(String(e)) })
      }
      function refreshApprovals() {
        api('/audit/approvals', { project: activeProject }).then(function (d) { setApprovals(d.items || []) }).catch(function () {})
        api('/audit/events', { project: activeProject, limit: 40 }).then(function (d) { setEvents(d.events || []) }).catch(function () {})
        refreshPendingCounts()
      }
      function refreshPbc() {
        api('/audit/pbc', { project: activeProject }).then(function (d) { setPbc(d.items || []) }).catch(function () {})
        api('/audit/events', { project: activeProject, limit: 40 }).then(function (d) { setEvents(d.events || []) }).catch(function () {})
      }
      function addPbcItem(name) {
        const value = String(name || '').trim()
        if (!value) return
        api('/audit/pbc/add', null, { method: 'POST', body: { project: activeProject, name: value } }).then(refreshPbc).catch(function () {})
      }
      function deletePbcItem(item) {
        api('/audit/pbc/delete', null, { method: 'POST', body: { id: item.id } }).then(refreshPbc).catch(function () {})
      }
      function uploadPbcAttachment(item, file) {
        fetch(BASE + '/audit/pbc/upload?pbc_id=' + item.id + '&project=' + encodeURIComponent(activeProject) + '&filename=' + encodeURIComponent(file.name), {
          method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: file,
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json() }).then(refreshPbc).catch(function () {})
      }
      function downloadPbcAttachment(att) {
        fetch(BASE + '/audit/pbc/download?attachment_id=' + att.id, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = att.filename
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function addProjectMember(username) {
        const value = String(username || '').trim()
        if (!value) return
        api('/audit/members/add', null, { method: 'POST', body: { project: activeProject, username: value } })
          .then(function (d) {
            setNewMemberName('')
            return api('/audit/members', { project: activeProject })
          })
          .then(function (d) { setMembers(d.items || []) })
          .catch(function () {})
      }
      function removeProjectMember(member) {
        api('/audit/members/remove', null, { method: 'POST', body: { id: member.id } })
          .then(function () { return api('/audit/members', { project: activeProject }) })
          .then(function (d) { setMembers(d.items || []) })
          .catch(function () {})
      }
      function openRenameDialog() {
        setMgmtClient(activeCompany || '')
        setMgmtName(activeProject || '')
        setMgmtError('')
        setRenameOpen(true)
      }
      function submitRename() {
        if (!mgmtName.trim()) { setMgmtError('项目名称不能为空'); return }
        const newName = mgmtName.trim()
        setMgmtError('')
        api('/audit/projects/rename', null, { method: 'POST', body: { project: activeProject, new_name: newName, new_client: mgmtClient.trim() } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) {
            setData({ loading: false, companies: d.companies || [], error: '' })
            setActiveCompany(mgmtClient.trim() || activeCompany)
            setActiveProject(newName)
            setRenameOpen(false)
          })
          .catch(function (error) { setMgmtError(String(error && error.message ? error.message : error)) })
      }
      function submitDelete() {
        setMgmtError('')
        api('/audit/projects/delete', null, { method: 'POST', body: { project: activeProject, confirm: true } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) {
            setData({ loading: false, companies: d.companies || [], error: '' })
            setActiveProject(null)
            setActiveCompany(null)
            setDeleteOpen(false)
          })
          .catch(function (error) { setMgmtError(String(error && error.message ? error.message : error)) })
      }
      function uploadConfirmationAttachment(itemId, file) {
        if (!activeProject || !file) return
        const form = new FormData()
        form.append('item_id', String(itemId))
        form.append('file', file)
        fetch(BASE + '/audit/confirmations/attach', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return api('/audit/confirmations', { project: activeProject }) })
          .then(function (d) { setConfirmations(d.items || []) }).catch(function () {})
      }
      function previewConfirmationAttachment(item) {
        fetch(BASE + '/audit/confirmations/attachment/preview?item_id=' + item.id, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status)
            const type = resp.headers.get('content-type') || ''
            return resp.blob().then(function (blob) { return { type: type, blob: blob } })
          })
          .then(function (result) {
            setPreview({ attachment: { filename: item.attachment_name || '回函扫描件' }, url: URL.createObjectURL(result.blob), type: result.type, onDownload: function () { downloadConfirmationAttachment(item.id) } })
          }).catch(function () {})
      }
      function downloadConfirmationAttachment(itemId) {
        fetch(BASE + '/audit/confirmations/attachment?item_id=' + itemId, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '回函扫描件'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function replyConfirmation(itemId, repliedAmount, note) {
        if (!activeProject) return
        api('/audit/confirmations/reply', null, { method: 'POST', body: { id: itemId, replied_amount: repliedAmount, note: note } })
          .then(function () { return api('/audit/confirmations', { project: activeProject }) })
          .then(function (d) { setConfirmations(d.items || []) })
          .catch(function () {})
      }
      function exportConfirmationDifferences() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/confirmation-differences', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: activeProject }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '函证差异调节表.docx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); refreshWorkpapers() }).catch(function () {})
      }
      function updateInventoryRow(code, field, value) {
        setInventoryCounts(function (prev) { return (prev || []).map(function (row) { return row.code === code ? Object.assign({}, row, { [field]: value }) : row }) })
      }
      function exportInventoryExceptions() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/inventory-exceptions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: activeProject }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '存货监盘差异事项.docx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function exportInventorySummary() {
        if (!activeProject) return
        fetch(BASE + '/audit/inventory-summary/export?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '存货监盘汇总.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function updateInventoryMeta(field, value) {
        setInventoryMeta(function (prev) { return Object.assign({}, prev, { [field]: value }) })
      }
      function saveInventoryMeta() {
        if (!activeProject) return
        api('/audit/inventory-meta/save', null, { method: 'POST', body: Object.assign({ project: activeProject }, inventoryMeta) })
          .then(function (d) { setInventoryMeta(d.item || {}); setImportMessage('监盘信息已保存') })
          .catch(function () {})
      }
      function uploadInventoryAttachment(file) {
        if (!activeProject || !file) return
        const form = new FormData()
        form.append('project', activeProject)
        form.append('file', file)
        fetch(BASE + '/audit/inventory-attachments/upload', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return api('/audit/inventory-attachments', { project: activeProject }) })
          .then(function (d) { setInventoryAttachments(d.items || []); setImportMessage('盘点表扫描件已上传') })
          .catch(function () {})
      }
      function previewInventoryAttachment(item) {
        fetch(BASE + '/audit/inventory-attachments/file?attachment_id=' + item.id + '&inline=1', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); const type = resp.headers.get('content-type') || ''; return resp.blob().then(function (blob) { return { type: type, blob: blob } }) })
          .then(function (result) {
            setPreview({ attachment: { filename: item.filename }, url: URL.createObjectURL(result.blob), type: result.type,
              onDownload: function () {
                fetch(BASE + '/audit/inventory-attachments/file?attachment_id=' + item.id, { headers: { 'X-KB-Token': currentToken() } })
                  .then(function (resp) { return resp.blob() })
                  .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = item.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) })
              } })
          }).catch(function () {})
      }
      function saveInventoryCounts() {
        if (!activeProject) return
        api('/audit/inventory-counts/save', null, { method: 'POST', body: { project: activeProject, items: inventoryCounts } })
          .then(function (d) { setInventoryCounts(d.items || []); setImportMessage('存货监盘已保存') })
          .catch(function () {})
      }
      function confirmInventory() {
        if (!activeProject) return
        api('/audit/inventory-counts/confirm', null, { method: 'POST', body: { project: activeProject } })
          .then(function () { return api('/audit/inventory-counts', { project: activeProject }) })
          .then(function (d) { setInventoryCounts(d.items || []); setImportMessage('存货监盘已确认') })
          .catch(function () {})
      }
      function syncConfirmations() {
        if (!activeProject) return
        api('/audit/confirmations/sync', null, { method: 'POST', body: { project: activeProject } })
          .then(function (d) { setConfirmations(d.items || []) })
          .catch(function () {})
      }
      function cycleConfirmation(item) {
        const order = ['待发', '已发', '已回函', '未回函', '替代程序']
        const next = order[(order.indexOf(item.status) + 1) % order.length]
        api('/audit/confirmations/status', null, { method: 'POST', body: { id: item.id, status: next } })
          .then(function (d) {
            if (d && d.item) setConfirmations(function (prev) { return (prev || []).map(function (row) { return row.id === d.item.id ? d.item : row }) })
          }).catch(function () {})
      }
      function generateTrialBalance() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/trial-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '试算平衡底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function downloadFinancialTemplate() {
        fetch(BASE + '/audit/data/template-fs', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '财务报表_标准模板.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function downloadImportTemplate(kind) {
        fetch(BASE + '/audit/data/template?kind=' + kind, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = kind === 'tb' ? '科目余额表_标准模板.xlsx' : '序时账_标准模板.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function chooseMultiSheetFile(file) {
        if (!file) return
        setMultiFile(file)
        setMultiSheets([])
        setMultiSheetIndex('0')
        setMultiLoading(true)
        const form = new FormData()
        form.append('file', file)
        fetch(BASE + '/audit/data/sheets', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) { setImportMessage('读取工作表失败'); return }
            setMultiSheets(result.data.sheets || [])
            setImportMessage('已读取工作表：' + (result.data.sheets || []).join('、'))
          })
          .catch(function () { setImportMessage('读取工作表失败') })
          .then(function () { setMultiLoading(false) })
      }
      function submitMultiSheet(mode) {
        if (!activeProject || !multiFile) return
        const form = new FormData()
        form.append('project', activeProject)
        form.append('kind', multiKind)
        form.append('sheet_index', String(Number(multiSheetIndex) || 0))
        form.append('file', multiFile)
        const url = mode === 'validate' ? BASE + '/audit/data/validate' : BASE + '/audit/data/import'
        setImportMessage(mode === 'validate' ? '正在校验所选工作表…' : '正在导入所选工作表…')
        fetch(url, { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) {
              const detail = result.data && result.data.detail
              setImportMessage('失败：' + (typeof detail === 'string' ? detail : '文件格式不符'))
              return
            }
            if (mode === 'validate') {
              setImportMessage(result.data.ok ? ('校验通过：识别 ' + result.data.rows + ' 行') : ('校验失败：缺少列 ' + (result.data.missing || []).join('、')))
            } else {
              setImportMessage('导入成功：' + (multiKind === 'tb' ? '科目余额表' : '序时账') + ' ' + result.data.rows + ' 行')
              return api('/audit/analysis/summary', { project: activeProject }).then(function (d) { setAnalysis(d) })
            }
          })
          .catch(function () { setImportMessage('操作失败，请检查文件') })
      }
      function importFinancialStatements(file) {
        if (!activeProject || !file) return
        const form = new FormData()
        form.append('project', activeProject)
        form.append('file', file)
        setImportMessage('正在导入财务报表…')
        fetch(BASE + '/audit/data/import-fs', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) {
              const detail = result.data && result.data.detail
              setImportMessage('导入失败：' + (typeof detail === 'string' ? detail : '文件格式不符'))
              return
            }
            const tables = (result.data.imported || []).map(function (item) { return item.sheet + '(' + item.rows + '行)' }).join('、')
            setImportMessage('财务报表导入成功：' + result.data.imported.length + ' 张表（' + tables + '）'); refreshDataEvents()
            return api('/audit/analysis/summary', { project: activeProject }).then(function (d) { setAnalysis(d) })
          })
          .catch(function () { setImportMessage('财务报表导入失败') })
      }
      function validateImportFile(kind, file) {
        if (!activeProject || !file) return
        const form = new FormData()
        form.append('project', activeProject)
        form.append('kind', kind)
        form.append('file', file)
        setImportMessage('正在校验文件…')
        fetch(BASE + '/audit/data/validate', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) {
              const detail = result.data && result.data.detail
              setImportMessage('校验失败：' + (typeof detail === 'string' ? detail : '文件格式不符'))
              return
            }
            const data = result.data
            if (data.ok) {
              const cols = Object.keys(data.recognized || {}).map(function (key) { return data.recognized[key] }).join('、')
              setImportMessage('校验通过：识别 ' + data.rows + ' 行；列：' + cols)
            } else {
              setImportMessage('校验失败：缺少列 ' + (data.missing || []).join('、') + '（表头：' + (data.header || []).join('、') + '）')
            }
          })
          .catch(function () { setImportMessage('校验失败，请检查文件') })
      }
      function refreshDataEvents() {
        if (!activeProject) return
        api('/audit/events', { project: activeProject, item_type: 'data', limit: 10 })
          .then(function (d) { setDataEvents(d.events || []) })
          .catch(function () {})
      }
      function importProjectData(kind, file) {
        if (!activeProject || !file) return
        const form = new FormData()
        form.append('project', activeProject)
        form.append('kind', kind)
        form.append('file', file)
        setImportMessage(kind === 'tb' ? '正在导入科目余额表…' : '正在导入序时账…')
        fetch(BASE + '/audit/data/import', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) {
              const detail = result.data && result.data.detail
              setImportMessage('导入失败：' + (typeof detail === 'string' ? detail : (detail && detail.message ? detail.message + '（缺少列：' + (detail.missing || []).join('、') + '）' : '文件格式不符')))
              return
            }
            const baseMessage = '导入成功：' + (kind === 'tb' ? '科目余额表' : '序时账') + ' ' + result.data.rows + ' 行'
            setImportMessage(baseMessage)
            refreshDataEvents()
            return api('/audit/analysis/summary', { project: activeProject }).then(function (summary) {
              setAnalysis(summary)
              const diffs = ((summary.trial_balance || {}).differences || []).length
              setImportMessage(baseMessage + (diffs ? '；勾稽提示：科目余额表与序时账有 ' + diffs + ' 个科目差异，请查看试算平衡底稿' : '；勾稽检查通过'))
            })
          })
          .catch(function () { setImportMessage('导入失败，请检查文件格式') })
      }
      function generateAccountingPolicies() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/accounting-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '会计政策与会计估计检查表.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateFixedAssets() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/fixed-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '固定资产底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generatePayroll() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/payroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '应付职工薪酬底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateTaxes() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/taxes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '应交税费底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateChecklist() {
        const map = {
          subsequent: generateSubsequentEvents,
          going: generateGoingConcern,
          related: generateRelatedParties,
          contingencies: generateContingencies,
          opening: generateOpeningBalances,
          policies: generateAccountingPolicies,
          fixed_assets: generateFixedAssets,
          payroll: generatePayroll,
          taxes: generateTaxes,
        }
        const handler = map[checklistKind] || generateSubsequentEvents
        if (handler) handler()
      }
      function generateOpeningBalances() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/opening-balances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '期初余额审计程序表.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateContingencies() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/contingencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '或有事项检查表.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateRelatedParties() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/related-parties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '关联方交易检查表.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateGoingConcern() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/going-concern', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '持续经营评估.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateSubsequentEvents() {
        if (!activeProject) return
        fetch(BASE + '/audit/workpapers/subsequent-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '期后事项检查表.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function generateRiskDocx() {
        if (!activeProject) return
        fetch(BASE + '/audit/risk-assessment/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject, reviewer: reviewerName }),
        }).then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '风险评估底稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            refreshWorkpapers()
          }).catch(function () {})
      }
      function confirmMateriality(values) {
        if (!activeProject) return
        api('/audit/analysis/materiality/confirm', null, { method: 'POST', body: Object.assign({ project: activeProject }, values) })
          .then(function () { return api('/audit/analysis/summary', { project: activeProject }) })
          .then(function (d) { setAnalysis(d) })
          .then(function () { return api('/audit/analysis/materiality/history', { project: activeProject }) })
          .then(function (d) { setMatHistory((d && d.items) || []) })
          .catch(function () {})
      }
      function uploadProjectFile(projectName, path, fields) {
        const form = new FormData()
        form.append('project', projectName)
        Object.keys(fields || {}).forEach(function (key) { form.append(key, fields[key]) })
        return fetch(BASE + path, { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
      }
      function uploadProjectFiles(projectName, files) {
        const messages = []
        let chain = Promise.resolve()
        if (files.fs) {
          chain = chain.then(function () { return uploadProjectFile(projectName, '/audit/data/import-fs', { file: files.fs }) })
            .then(function (result) { messages.push(result.ok ? ('财务报表 ' + (result.data.imported || []).length + ' 张') : '财务报表导入失败') })
        }
        if (files.tb) {
          chain = chain.then(function () { return uploadProjectFile(projectName, '/audit/data/import', { kind: 'tb', file: files.tb }) })
            .then(function (result) { messages.push(result.ok ? ('余额表 ' + result.data.rows + ' 行') : '余额表导入失败') })
        }
        if (files.journal) {
          chain = chain.then(function () { return uploadProjectFile(projectName, '/audit/data/import', { kind: 'journal', file: files.journal }) })
            .then(function (result) { messages.push(result.ok ? ('序时账 ' + result.data.rows + ' 行') : '序时账导入失败') })
        }
        return chain.then(function () { return messages })
      }
      function createProject() {
        if (creating) return
        if (!contractId) { setCreateError('请先选择合同（没有合同不能立项）'); return }
        if (!newName.trim()) { setCreateError('项目名称必填'); return }
        const targetClient = newClient.trim()
        const targetName = newName.trim()
        const files = { fs: newFsFile, tb: newTbFile, journal: newJournalFile }
        setCreating(true); setCreateError('')
        api('/audit/projects/create', null, { method: 'POST', body: { client: targetClient, name: targetName, period: newPeriod.trim(), business_type: businessType, contract_id: contractId } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) {
            setData({ loading: false, companies: d.companies || [], error: '' })
            setActiveCompany(targetClient)
            setActiveProject(targetName)
            setShowCreate(false)
            setNewClient(''); setNewName(''); setNewPeriod('')
            setNewFsFile(null); setNewTbFile(null); setNewJournalFile(null)
            setZone('风险评估')
            const chosen = [files.fs, files.tb, files.journal].filter(Boolean).length
            if (!chosen) {
              setImportMessage('项目已创建，正在初始化审计程序…')
              return api('/audit/programs', { project: targetName }).then(function (program) {
                const items = program.items || []
                setPrograms(items)
                setImportMessage('项目已创建。下一步：① 上传财务报表（xlsx）② 导入科目余额表 ③ 导入序时账；审计程序 0/' + items.length + '（可在「审计程序」分区维护）。')
              })
            }
            setImportMessage('项目已创建，正在导入所选文件…')
            return uploadProjectFiles(targetName, files).then(function (messages) {
              const tail = messages.join('；')
              return api('/audit/analysis/summary', { project: targetName }).then(function (summary) {
                setAnalysis(summary)
                return api('/audit/programs', { project: targetName }).then(function (program) {
                  const items = program.items || []
                  setPrograms(items)
                  setImportMessage('项目已创建；' + tail + '。下一步可确认重要性、查看勾稽结果；审计程序 0/' + items.length + '。')
                })
              })
            })
          })
          .catch(function (error) { setCreateError(String(error && error.message ? error.message : error)) })
          .then(function () { setCreating(false) })
      }
      function loadReportChecklist() {
        api('/audit/report/checklist', { project: activeProject }).then(function (d) { setReport(function (prev) { return Object.assign({}, prev, { checklist: d.items || [] }) }) }).catch(function () {})
      }
      function loadReportOpinion() {
        api('/audit/report/opinion', { project: activeProject }).then(function (d) { setReport(function (prev) { return Object.assign({}, prev, { opinion: d.opinion || null }) }) }).catch(function () {})
      }
      function generateReportDraft() {
        if (!activeProject || reportLoading) return
        setReportLoading(true)
        api('/audit/report/draft', null, { method: 'POST', body: { project: activeProject } })
          .then(function (d) {
            setReport(function (prev) { return Object.assign({}, prev, { draft: d }) })
            loadReportVersions()
          })
          .catch(function () {})
          .then(function () { setReportLoading(false) })
      }
      function loadReportVersions() {
        api('/audit/report/versions', { project: activeProject }).then(function (d) { setReport(function (prev) { return Object.assign({}, prev, { versions: d.items || [] }) }) }).catch(function () {})
      }
      function downloadVersion(versionId) {
        fetch(BASE + '/audit/report/version?version_id=' + versionId, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '报告初稿_' + versionId + '.md'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function exportReportPdf(versionId) {
        if (completeness && !completeness.ready) {
          try {
            if (!window.confirm('报告完整性未完成（' + completeness.ok_count + '/' + completeness.count + '）：建议先处理未完成项再导出。仍要导出吗？')) return
          } catch (e) {}
        }
        fetch(BASE + '/audit/report/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject, version_id: versionId || 0 }),
        })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '审计报告初稿.pdf'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function exportReportDocx(versionId) {
        if (completeness && !completeness.ready) {
          try {
            if (!window.confirm('报告完整性未完成（' + completeness.ok_count + '/' + completeness.count + '）：建议先处理未完成项再导出。仍要导出吗？')) return
          } catch (e) {}
        }
        fetch(BASE + '/audit/report/docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ project: activeProject, version_id: versionId || 0 }),
        })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '审计报告初稿.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function generateManagementLetter() {
        if (!activeProject) return
        fetch(BASE + '/audit/report/management-letter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: activeProject }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '管理层声明书.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            api('/audit/report/completeness', { project: activeProject }).then(setCompleteness).catch(function () {})
          }).catch(function () {})
      }
      function submitReportReview(versionId) {
        api('/audit/report/submit-review', null, { method: 'POST', body: { version_id: versionId } })
          .then(function () {
            setReport(function (prev) { return Object.assign({}, prev, { message: '已提交复核' }) })
            loadReportVersions()
          }).catch(function () {})
      }
      function finalizeReport(versionId) {
        try {
          const ready = completeness && completeness.ready
          const summary = completeness ? ('报告完整性 ' + completeness.ok_count + '/' + completeness.count) : '完整性未知'
          if (!window.confirm('确认将报告定稿？定稿后不可修改。\n' + summary + (ready ? '' : '（仍有未完成项，可能被拦截）'))) return
        } catch (e) {}
        function send(extra) {
          return fetch(BASE + '/audit/report/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
            body: JSON.stringify(Object.assign({ version_id: versionId }, extra || {})),
          })
        }
        function success() {
          setReport(function (prev) { return Object.assign({}, prev, { message: '报告已定稿' }) })
          loadReportVersions()
        }
        function fail(data, status) {
          const detail = data && data.detail
          const items = (detail && detail.items) || []
          const names = items.slice(0, 4).map(function (item) { return item.item || item.label || '' }).filter(Boolean)
          const message = detail && detail.message
            ? detail.message + '（' + items.length + ' 项' + (names.length ? '：' + names.join('、') + (items.length > 4 ? '…' : '') : '') + '）'
            : (typeof detail === 'string' ? detail : '定稿失败')
          setReport(function (prev) { return Object.assign({}, prev, { message: message }) })
          if (status === 409 && items.length) {
            const role = ((props.auth && props.auth.user && props.auth.user.role) || '')
            if (['partner', 'kb-admin', 'admin'].indexOf(role) >= 0) {
              let reason = ''
              try { reason = window.prompt('存在风险/未完成事项，可由合伙人覆盖风险并定稿（需填写至少 8 个字的理由）：\n' + names.join('、'), '') || '' } catch (e) {}
              if (reason.trim().length >= 8) {
                send({ allow_risk: true, override_reason: reason.trim() }).then(function (resp) {
                  return resp.json().then(function (data) {
                    if (resp.ok) { success(); setReport(function (prev) { return Object.assign({}, prev, { message: '报告已定稿（合伙人覆盖风险）' }) }) }
                    else { fail(data, resp.status) }
                  })
                }).catch(function () {})
              }
            }
          }
        }
        send({}).then(function (resp) {
          return resp.json().then(function (data) {
            if (resp.ok) { success() } else { fail(data, resp.status) }
          })
        }).catch(function () {})
      }
      function downloadReportDraft() {
        if (!report.draft) return
        const blob = new Blob([report.draft.content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = report.draft.filename || '报告初稿.md'
        document.body.appendChild(anchor); anchor.click(); anchor.remove()
        URL.revokeObjectURL(url)
      }
      function exportArchive() {
        if (!activeProject || exporting) return
        setExporting(true)
        fetch(BASE + '/audit/projects/archive-export?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) {
            if (resp.ok) return resp.blob()
            return resp.json().then(function (data) { throw new Error((data && data.detail) || ('HTTP ' + resp.status)) })
          })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = activeProject + '_审计档案.zip'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function (e) { try { window.alert('导出归档包失败：' + String(e.message || e)) } catch (x) {} })
          .then(function () { setExporting(false) })
      }
      function archiveProject() {
        if (!activeProject) return
        try {
          if (!window.confirm('确认归档项目「' + activeProject + '」？\n归档后项目变为只读：资料、底稿、程序、报告全部锁定，只能查看和下载。\n（如需继续编辑需先解除归档。）')) return
        } catch (e) {}
        api('/audit/projects/archive', null, { method: 'POST', body: { project: activeProject } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) { setData({ loading: false, companies: d.companies || [], error: '' }) })
          .catch(function () {})
      }
      function unarchiveProject() {
        if (!activeProject) return
        api('/audit/projects/unarchive', null, { method: 'POST', body: { project: activeProject } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) { setData({ loading: false, companies: d.companies || [], error: '' }) })
          .catch(function () {})
      }
      function updateProgramRow(id, field, value) {
        setPrograms(function (prev) { return (prev || []).map(function (row) { return row.id === id ? Object.assign({}, row, { [field]: value }) : row }) })
      }
      function exportPrograms() {
        if (!activeProject) return
        fetch(BASE + '/audit/programs/export?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '审计程序表.docx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function exportProgramsXlsx() {
        if (!activeProject) return
        fetch(BASE + '/audit/programs/export-xlsx?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '审计程序表.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function exportProgramHistory() {
        if (!activeProject) return
        fetch(BASE + '/audit/programs/history-xlsx?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '程序变更历史.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function () {})
      }
      function savePrograms() {
        if (!activeProject) return
        api('/audit/programs/save', null, { method: 'POST', body: { project: activeProject, items: programs } })
          .then(function (d) { setPrograms(d.items || []); setImportMessage('审计程序清单已保存'); refreshWorkpapers() })
          .catch(function () {})
      }
      function completePrograms() {
        if (!activeProject) return
        api('/audit/programs/complete', null, { method: 'POST', body: { project: activeProject } })
          .then(function (d) { setPrograms(d.items || []); setImportMessage('已补全审计程序清单（+' + (d.added || 0) + ' 项）') })
          .catch(function () {})
      }
      function askAiNextSteps() {
        const project = (companies.filter(function (c) { return c.name === activeCompany })[0] || {}).projects || []
        const target = project.filter(function (p) { return p.id === activeProject })[0]
        if (!target || !props.ui || !props.ui.uiWorkspace) return
        projectPrompt(activeCompany, target).then(function (base) {
          const prompt = base + '\n\n请基于上述项目上下文，输出：1）下一步审计程序清单（按底稿索引号）；2）每项程序需要的审计证据；3）重点风险与判断依据。结论须检索知识库并标注出处。'
          try { props.ui.layout.selectPanel(null) } catch (e) {}
          props.ui.uiWorkspace.startSession(undefined, { prompt: prompt, whenDraftExists: 'append' })
        }).catch(function () {})
      }
      function refreshWorkpapers() {
        if (!activeProject) return
        Promise.all([
          api('/audit/workpapers', { project: activeProject }),
          api('/audit/workpapers/generated', { project: activeProject }),
        ]).then(function (results) {
          setWp((results[0] && results[0].items) || [])
          setGenerated((results[1] && results[1].items) || [])
        }).catch(function () {})
      }
      function generateAllWorkpapers() {
        if (!activeProject || generating) return
        setGenerating(true)
        setGenerateMessage('已提交后台任务，等待执行…')
        api('/audit/jobs/generate-all', null, { method: 'POST', body: { project: activeProject } })
          .then(function (data) {
            const jobId = data.job_id
            const poll = function () {
              api('/audit/jobs/' + jobId).then(function (result) {
                const item = (result && result.item) || {}
                setGenerateMessage('后台任务：' + (item.status || '') + '（' + (item.progress || 0) + '/' + (item.total || 4) + '）' + (item.message ? ' · ' + item.message : ''))
                if (item.status === '已完成' || item.status === '部分失败') {
                  setGenerating(false)
                  refreshWorkpapers()
                  api('/audit/events', { project: activeProject, limit: 40 }).then(function (e) { setEvents((e && e.events) || []) }).catch(function () {})
                } else {
                  setTimeout(poll, 1500)
                }
              }).catch(function () { setGenerating(false); setGenerateMessage('任务状态查询失败') })
            }
            setTimeout(poll, 1200)
          })
          .catch(function (error) {
            setGenerating(false)
            setGenerateMessage('提交后台任务失败：' + String(error && error.message ? error.message : error))
          })
      }

      function localAttachments() {
        const out = []
        ;((pbc || [])).forEach(function (it) {
          ;((it.attachments) || []).forEach(function (a) { out.push({ id: String(a.id), filename: a.filename, pbc: it.name }) })
        })
        return out
      }
      function generateLocalWorkpapers() {
        if (!activeProject || generating) return
        setGenerating(true)
        setGenerateMessage('本机引擎：正在读取资料清单…')
        const token = currentToken()
        const atts = localAttachments()
        function byId(id) { return atts.filter(function (a) { return a.id === String(id) })[0] }
        function pick(re) { return atts.filter(function (a) { return re.test(a.filename || '') })[0] }
        const tb = byId(localAtt.tb) || pick(/(科目余额表|余额表)/)
        const fs = byId(localAtt.fs) || pick(/(资产负债表|财务报表|报表)/)
        const voucher = byId(localAtt.voucher) || pick(/(序时账|凭证|明细账)/)
        Promise.resolve().then(function () {
          if (!tb || !fs) throw new Error('资料清单里没找到科目余额表或财务报表，请在上方下拉框选择')
          function load(a) {
            return fetch(BASE + '/audit/pbc/download?attachment_id=' + a.id, { headers: { 'X-KB-Token': token } })
              .then(function (r) { if (!r.ok) throw new Error('下载失败：' + a.filename); return r.blob() })
              .then(function (b) {
                return new Promise(function (resolve, reject) {
                  const fr = new FileReader()
                  fr.onload = function () { resolve({ name: a.filename, data: String(fr.result).split(',')[1] }) }
                  fr.onerror = reject
                  fr.readAsDataURL(b)
                })
              })
          }
          return Promise.all([load(tb), load(fs), voucher ? load(voucher) : Promise.resolve(null)])
        }).then(function (files) {
          const p = project.filter(function (x) { return x.id === activeProject })[0] || {}
          return fetch('/api/audit-fill/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company: activeCompany, client: p.name || activeCompany, period: p.period || '2025',
              project: activeProject, token: token,
              tb: files[0], fs: files[1], voucher: files[2] || undefined }),
          }).then(function (r) { return r.json() })
        }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || '本机引擎生成失败')
          const lines = d.lines || []
          const ok = lines.filter(function (l) { return l.diff === 0 }).length
          const bad = lines.filter(function (l) { return l.diff !== null && l.diff !== undefined && Math.abs(l.diff) > 0.01 })
          setGenerating(false)
          setGenerateMessage('本机引擎：勾稽 ' + ok + '/' + lines.length + ' 一致' +
            (bad.length ? '；差异 ' + bad.length + ' 项：' + bad.slice(0, 3).map(function (b) { return b.line + ' ' + Number(b.diff).toFixed(2) }).join('、') : '') +
            (d.uploaded ? '；已回传网关 ' + d.uploaded + ' 个文件' : '') +
            (d.upload_errors && d.upload_errors.length ? '（回传失败：' + d.upload_errors.join('；') + '）' : '') +
            (d.outputs && d.outputs.package_dir ? '；本机输出 ' + d.outputs.package_dir : ''))
        }).catch(function (e) {
          setGenerating(false)
          setGenerateMessage('本机引擎：' + String(e && e.message ? e.message : e))
        })
      }

      function escalateApprovals() {
        setEscalateMessage('正在扫描超期审批…')
        api('/audit/approvals/escalate', null, { method: 'POST', body: { days: 2 } })
          .then(function (d) {
            if (d.escalated) setEscalateMessage('已升级 ' + d.escalated + ' 项超期审批（已留痕/通知）')
            else if (d.overdue) setEscalateMessage('超期 ' + d.overdue + ' 项（今日已提醒，请尽快处理）')
            else setEscalateMessage('暂无超期审批（≥2 天）')
            api('/audit/approvals', { project: activeProject }).then(function (a) { setApprovals(a.items || []) }).catch(function () {})
          })
          .catch(function () { setEscalateMessage('扫描失败') })
      }
      function verifyArchiveFile(file) {
        if (!file) return
        setArchiveVerifyMessage('正在校验归档包…')
        const form = new FormData()
        form.append('file', file)
        fetch(BASE + '/audit/projects/archive-verify', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) {
              const detail = result.data && result.data.detail
              setArchiveVerifyMessage('校验失败：' + (typeof detail === 'string' ? detail : '文件无效'))
              return
            }
            const data = result.data
            if (data.ok) setArchiveVerifyMessage('校验通过：' + data.checked + ' 个文件 SHA256 全部一致')
            else setArchiveVerifyMessage('校验未通过：不一致 ' + (data.mismatched || []).length + ' 个，缺失 ' + (data.missing || []).length + ' 个')
          })
          .catch(function () { setArchiveVerifyMessage('校验失败，请重试') })
      }
      function exportWorkpaperListCsv() {
        const rows = [['索引号', '底稿名称', '状态', '说明', '更新人', '更新时间']]
        const wpList = Array.isArray(wp) ? wp : ((wp && wp.items) || [])
        ;wpList.forEach(function (item) {
          rows.push([item.code || '', item.name || '', item.status || '', item.note || '', item.updated_by || '', item.updated_at || ''])
        })
        const csv = '\ufeff' + rows.map(function (row) { return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = '底稿台账_' + (activeProject || '') + '.csv'
        document.body.appendChild(anchor); anchor.click(); anchor.remove()
        URL.revokeObjectURL(url)
      }
      function verifyWorkpapersZip(file) {
        if (!file) return
        setWpsVerifyMessage('正在校验底稿包…')
        const form = new FormData()
        form.append('file', file)
        if (activeProject) form.append('project', activeProject)
        fetch(BASE + '/audit/workpapers/verify', { method: 'POST', headers: { 'X-KB-Token': currentToken() }, body: form })
          .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data } }) })
          .then(function (result) {
            if (!result.ok) { setWpsVerifyMessage('校验失败：' + ((result.data && result.data.detail) || '文件无效')); return }
            const d = result.data
            setWpsVerifyMessage(d.ok ? ('底稿包校验通过：' + d.checked + ' 个文件 SHA256 一致') : ('底稿包校验未通过：不一致 ' + (d.mismatched || []).length + ' 个，缺失 ' + (d.missing || []).length + ' 个'))
          })
          .catch(function () { setWpsVerifyMessage('校验失败，请重试') })
      }
      function exportWorkpapersZip() {
        const kindSuffix = (generatedKind && generatedKind !== 'all') ? ('&kind=' + encodeURIComponent(generatedKind)) : ''
        fetch(BASE + '/audit/workpapers/export?project=' + encodeURIComponent(activeProject) + kindSuffix, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = activeProject + '_底稿.zip'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function generateWorkpaper(kind) {
        if (!activeProject || generating) return
        setGenerating(true); setGenerateMessage('')
        api('/audit/workpapers/generate', null, { method: 'POST', body: { project: activeProject, kind: kind || 'currency', reviewer: reviewerName, date: generatedDate } })
          .then(function (d) {
            setGenerateMessage('已生成：' + d.item.filename)
            return api('/audit/workpapers/generated', { project: activeProject })
          })
          .then(function (d) { setGenerated(d.items || []) ; api('/audit/events', { project: activeProject, limit: 40 }).then(function (e) { setEvents(e.events || []) }).catch(function () {}) })
          .catch(function (error) { setGenerateMessage('生成失败：' + String(error && error.message ? error.message : error)) })
          .then(function () { setGenerating(false) })
      }
      function openWorkpaperByIndex(indexNo) {
        const suffix = String(indexNo || '').replace(/-\d+$/, '')
        const kindByPrefix = { ZA: 'currency', ZE: 'receivable', ZJ: 'inventory', SA: 'revenue', SB: 'revenue', SC: 'revenue', SD: 'revenue' }
        const kind = kindByPrefix[suffix]
        if (!kind) {
          setGenerateMessage('索引 ' + indexNo + ' 暂无对应的程序底稿，可在风险评估页生成')
          return
        }
        const open = function (items) {
          const list = (items || []).filter(function (item) { return item.kind === kind })
          if (list.length) {
            previewGeneratedWorkpaper(list[0])
          } else {
            setGenerateMessage('索引 ' + indexNo + ' 暂无已生成底稿，请先生成对应科目底稿')
          }
        }
        if (generated && generated.length) open(generated)
        else api('/audit/workpapers/generated', { project: activeProject }).then(function (d) { setGenerated(d.items || []); open(d.items) }).catch(function () {})
      }
      function previewGeneratedWorkpaper(item) {
        fetch(BASE + '/audit/workpapers/preview?workpaper_id=' + item.id, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            setPreview({ attachment: { filename: item.filename }, url: URL.createObjectURL(blob), type: 'text/html', onDownload: function () { downloadGeneratedWorkpaper(item) } })
          }).catch(function () {})
      }
      function downloadGeneratedWorkpaper(item) {
        fetch(BASE + '/audit/workpapers/download?workpaper_id=' + item.id, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = item.filename
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function saveReportElements(next) {
        if (!activeProject) return
        api('/audit/report/elements', null, { method: 'POST', body: Object.assign({ project: activeProject }, next) })
          .then(function (d) {
            setReportElements((d && d.elements) || {})
            setReportElementsMsg('已保存')
            api('/audit/report/completeness', { project: activeProject }).then(setCompleteness).catch(function () {})
          })
          .catch(function (e) { setReportElementsMsg('保存失败：' + String(e)) })
      }
      function loadMisstatements() {
        if (!activeProject) return
        api('/audit/misstatements', { project: activeProject }).then(function (d) { setMisstates(d || { items: [] }) }).catch(function () {})
      }
      function addMisstatementFromFinding(finding) {
        if (!activeProject) return
        api('/audit/misstatements/add', null, { method: 'POST', body: {
          project: activeProject,
          source: (finding.sheet || '') + '!' + (finding.cell || ''),
          description: finding.message || '客户底稿核对差异',
          amount: Math.abs(Number(finding.diff) || 0),
          category: finding.category || '未更正',
          note: finding.note || '',
        } }).then(function (d) {
          setClientCheckMsg('已记入未更正错报：' + ((d.item && d.item.description) || '').slice(0, 40))
          loadMisstatements()
        }).catch(function (e) { setClientCheckMsg('记入失败：' + String(e)) })
      }
      function updateMisstatement(id, status) {
        api('/audit/misstatements/update', null, { method: 'POST', body: { id: id, status: status } })
          .then(loadMisstatements).catch(function () {})
      }
      function checkAttachment(att) {
        if (!activeProject || !att) return
        setClientCheckMsg('正在核对 ' + att.filename + ' …')
        setClientCheck(null)
        api('/audit/pbc/check', null, { method: 'POST', body: { project: activeProject, attachment_id: att.id } })
          .then(function (d) {
            setClientCheck(d)
            const summary = d.summary || {}
            setClientCheckMsg('核对完成：发现 ' + (summary.total || 0) + ' 项（高风险 ' + (summary.high || 0) + '）')
          })
          .catch(function (e) { setClientCheckMsg('核对失败：' + String(e)) })
      }
      function exportClientCheckReport() {
        if (!activeProject) return
        fetch(BASE + '/audit/pbc/check/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() }, body: JSON.stringify({ project: activeProject }) })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '客户底稿核对记录.docx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
            if (props.onRefreshWorkpapers) props.onRefreshWorkpapers()
          }).catch(function (e) { setClientCheckMsg('导出失败：' + String(e)) })
      }
      function openAttachmentPreview(att) {
        fetch(BASE + '/audit/pbc/preview?attachment_id=' + att.id, { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status)
            const type = resp.headers.get('content-type') || ''
            return resp.blob().then(function (blob) { return { type: type, blob: blob } })
          })
          .then(function (result) {
            setPreview({ attachment: att, url: URL.createObjectURL(result.blob), type: result.type, onDownload: function () { downloadPbcAttachment(att) } })
          })
          .catch(function () {})
      }
      function closeAttachmentPreview() {
        setPreview(function (current) {
          if (current && current.url) { try { URL.revokeObjectURL(current.url) } catch (e) {} }
          return null
        })
      }
      function submitApproval(item, approverUsername) {
        api('/audit/approvals/submit', null, { method: 'POST', body: { id: item.id, approver: approverUsername } }).then(refreshApprovals).catch(function () {})
      }
      function decideApproval(item, decision, opinion) {
        api('/audit/approvals/decide', null, { method: 'POST', body: { id: item.id, decision: decision, opinion: opinion } }).then(refreshApprovals).catch(function () {})
      }

      function newProjectSession(company, project) {
        if (!props.ui || !props.ui.sessions || !props.ui.uiWorkspace) return
        ensureViaHostCommand(company, project).catch(function () { return null })
          .then(function (workspace) { return workspace || ensureProjectWorkspace(company, project).catch(function () { return null }) })
          .then(function (workspace) {
            return projectPrompt(company, project).then(function (prompt) {
              return { workspace: workspace, prompt: prompt }
            })
          })
          .then(function (context) {
            const before = new Set(((props.ui.sessions.list.getSnapshot() || {}).ids) || [])
            props.ui.uiWorkspace.startSession(context.workspace ? context.workspace.workspaceId : undefined, { prompt: context.prompt, whenDraftExists: 'append' })
            let attempts = 0
            const poll = function () {
              attempts += 1
              const ids = ((props.ui.sessions.list.getSnapshot() || {}).ids) || []
              const fresh = ids.filter(function (id) { return !before.has(id) })[0]
              if (fresh) {
                const title = (project ? project.name : company) + ' · ' + new Date().toLocaleString()
                api('/audit/link_session', null, { method: 'POST', body: { project: activeProject, session_id: fresh, title: title } })
                  .then(function () { return api('/audit/project_sessions', { project: activeProject }) })
                  .then(function (d) { setLinked(d.sessions || []) }).catch(function () {})
              } else if (attempts < 20) {
                setTimeout(poll, 400)
              }
            }
            setTimeout(poll, 400)
          })
          .catch(function (error) {
            try { console.warn('audit-workbench: create project session failed', error) } catch (e) {}
          })
      }
      function openProjectSession(sessionId) {
        if (props.ui && props.ui.uiWorkspace) props.ui.uiWorkspace.openSession(sessionId)
      }

      function cycleWp(item) {
        // 顺序要符合实际过程：先生成（引擎填数）→ 再复核完成 → 不适用
        // 旧顺序把「已生成」放在「已完成」之后，从「已生成」点击会直接跳到「不适用」，等于跳过复核
        const order = ['待执行', '进行中', '已生成', '已完成', '不适用']
        const next = order[(order.indexOf(item.status) + 1) % order.length]
        setWp(function (prev) { return (prev || []).map(function (row) { return row.id === item.id ? Object.assign({}, row, { status: next }) : row }) })
        api('/audit/workpapers/status', null, { method: 'POST', body: { id: item.id, status: next } })
          .then(function (d) {
            if (!d || !d.item) return
            setWp(function (prev) { return (prev || []).map(function (row) { return row.id === d.item.id ? d.item : row }) })
            api('/audit/events', { project: activeProject, limit: 40 }).then(function (e) { setEvents(e.events || []) }).catch(function () {})
          })
          .catch(function () { api('/audit/workpapers', { project: activeProject }).then(function (d) { setWp(d.items || []) }).catch(function () {}) })
      }

      React.useEffect(function () {
        let cancelled = false
        api('/audit/projects').then(function (d) {
          if (cancelled) return
          setData({ loading: false, companies: d.companies || [], error: '' })
        }).catch(function (e) { if (!cancelled) setData({ loading: false, companies: [], error: String(e) }) })
        return function () { cancelled = true }
      }, [])

      React.useEffect(function () {
        function onKeyDown(event) {
          if (event.key === 'Escape') closeAttachmentPreview()
        }
        if (preview) document.addEventListener('keydown', onKeyDown)
        return function () { document.removeEventListener('keydown', onKeyDown) }
      }, [preview])

      if (loading) return h(Empty, null, '正在加载项目…')
      if (error) return h(Empty, null, '数据加载失败，请稍后重试；持续失败请联系管理员')

      const current = companies.filter(function (c) { return c.name === activeCompany })[0]
      const projects = current ? current.projects : []
      const keyword = search.trim().toLowerCase()
      const matchProject = function (p) {
        if (statusFilter && p.status !== statusFilter) return false
        if (!keyword) return true
        return (p.name + ' ' + p.client + ' ' + (p.business_type || '')).toLowerCase().indexOf(keyword) >= 0
      }
      const visibleCompanies = companies.filter(function (c) {
        const projectMatch = (c.projects || []).some(matchProject)
        if (!keyword && !statusFilter) return true
        if (keyword && c.name.toLowerCase().indexOf(keyword) >= 0) {
          if (!statusFilter) return true
          if (projectMatch) return true
        }
        return projectMatch
      })
      const visibleProjects = projects.filter(matchProject)
      // 只有一个年度项目时直接进入，不显示中间的年度选择列
      const singleProject = visibleProjects.length === 1 ? visibleProjects[0] : null
      const effectiveProjectId = activeProject || (singleProject ? singleProject.id : null)
      const project = projects.filter(function (p) { return p.id === effectiveProjectId })[0]
      const readOnly = Boolean(project && project.status === '已归档')
      const role = ((props.auth && props.auth.user) || {}).role || 'auditor'
      const isManager = inRole(role, 'partner')
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', marginBottom: '8px' }

      const previewModal = preview ? h('div', { onClick: function (event) { if (event.target === event.currentTarget) closeAttachmentPreview() },
        style: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { width: '82vw', height: '82vh', background: '#fff', color: '#111', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, preview.attachment.filename),
            h('div', { style: { display: 'flex', gap: '10px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setPreviewZoom(function (value) { return Math.max(0.5, Math.round((value - 0.1) * 10) / 10) }) }, style: { border: '1px solid ' + COLORS.line, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer', width: '28px', height: '24px', borderRadius: '6px' } }, '−'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setPreviewZoom(1) }, style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } }, Math.round(previewZoom * 100) + '%'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setPreviewZoom(function (value) { return Math.min(3, Math.round((value + 0.1) * 10) / 10) }) }, style: { border: '1px solid ' + COLORS.line, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer', width: '28px', height: '24px', borderRadius: '6px' } }, '+'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (preview.url) window.open(preview.url, '_blank', 'noopener') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '新窗口打开'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { if (preview.onDownload) preview.onDownload() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: closeAttachmentPreview, style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } }, '关闭'))),
          h('div', { style: { flex: 1, minHeight: 0, background: '#fff' } },
            String(preview.type).indexOf('image/') === 0
              ? h('img', { src: preview.url, style: { maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto' } })
              : h('iframe', { src: preview.url, style: { width: '100%', height: '100%', border: 0, background: '#fff', zoom: previewZoom }, sandbox: '' }))))
        : null

      const mgmtModal = (renameOpen || deleteOpen) ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { width: '380px', padding: '18px', borderRadius: '12px', background: '#fff', color: '#111' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '10px' } }, renameOpen ? '重命名项目' : '删除项目'),
          renameOpen
            ? h('div', null,
                h(ui.Input, { className: 'ad-plain', value: mgmtClient, onChange: function (e) { setMgmtClient(e.target.value) }, placeholder: '被审计单位全称', style: inputStyle }),
                h(ui.Input, { className: 'ad-plain', value: mgmtName, onChange: function (e) { setMgmtName(e.target.value) }, placeholder: '项目名称', style: inputStyle }))
            : h('div', { style: { fontSize: '12px', lineHeight: 1.7, marginBottom: '8px' } },
                '确认删除项目「' + activeProject + '」？其资料清单、底稿台账、成员、审批、会话关联等数据将一并删除，已生成文件保留在磁盘。'),
          mgmtError ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, mgmtError) : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setRenameOpen(false); setDeleteOpen(false); setMgmtError('') }, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: '#111', fontSize: '12px', cursor: 'pointer' } }, '取消'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: renameOpen ? submitRename : submitDelete, style: { padding: '7px 12px', borderRadius: '7px', border: 0, background: renameOpen ? COLORS.accent : '#b91c1c', color: renameOpen ? 'var(--dsw-alias-label-primary-foreground)' : '#fff', fontSize: '12px', cursor: 'pointer' } }, renameOpen ? '保存' : '确认删除'))))
        : null

      // 从对象跳到它的变更历史：写筛选条件 + 切到留痕页
      function openObjectHistory(item, itemType) {
        try {
          localStorage.setItem('auditdesk.events.filters', JSON.stringify({
            project: activeProject, type: itemType, itemName: item.name || item.item_name || ''
          }))
        } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('auditdesk:goto-settings-tab', { detail: 'events' })) } catch (e) {}
        try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel('audit-settings') } catch (e) {}
        // 留痕页若已在打开状态，不会重新挂载，用事件让它重读筛选条件
        try { setTimeout(function () { window.dispatchEvent(new CustomEvent('auditdesk:events-refresh')) }, 50) } catch (e) {}
      }
      function initStdProject() {
        if (!activeProject) return
        api('/audit/project/init-std', null, { method: 'POST', body: { project: activeProject } })
          .then(function (d) {
            const parts = []
            if (d.pbc_added) parts.push('资料清单 +' + d.pbc_added)
            if (d.wp_added) parts.push('底稿台账 +' + d.wp_added)
            if (d.approvals_added) parts.push('审批 +' + d.approvals_added)
            if (d.member_added) parts.push('已加入项目组')
            try { window.alert(parts.length ? ('已补全：' + parts.join('，')) : '标准数据已齐，无需补全') } catch (e) {}
            try { if (typeof refreshPbc === 'function') refreshPbc() } catch (e) {}
            try { if (typeof refreshApprovals === 'function') refreshApprovals() } catch (e) {}
          })
          .catch(function (e) { try { window.alert('补全失败：' + String(e)) } catch (e2) {} })
      }
      function syncEngineStatus() {
        if (!activeProject) return
        api('/audit/workpapers/sync-engine', null, { method: 'POST', body: { project: activeProject } })
          .then(function (d) {
            const msg = d && d.matched
              ? ('已同步 ' + d.matched + ' 张底稿为「已生成」（引擎实际填过的表）')
              : ('没有可同步的底稿' + (d && d.note ? '：' + d.note : ''))
            try { window.alert(msg) } catch (e) {}
            api('/audit/workpapers', { project: activeProject }).then(function (r) { setWp(r.items || []) }).catch(function () {})
          })
          .catch(function (e) { try { window.alert('同步失败：' + String(e)) } catch (e2) {} })
      }
      function initPbcTemplate() {
        if (!activeProject) return
        api('/audit/pbc/init', null, { method: 'POST', body: { project: activeProject } })
          .then(function () { api('/audit/pbc', { project: activeProject }).then(function (r) { setPbc(r.items || []) }).catch(function () {}) })
          .catch(function () {})
      }
      function openWorkpaperHistory(item) { openObjectHistory(item, 'workpaper') }
      function openPbcHistory(item) { openObjectHistory(item, '') }
      const zoneProps = {
        zone: zone, pbc: pbc, wp: wp, linked: linked, events: events, approvals: approvals,
        auth: props.auth, readOnly: readOnly,
        onArchiveProject: archiveProject, onUnarchiveProject: unarchiveProject,
        onOpenRename: openRenameDialog, onOpenDelete: function () { setMgmtError(''); setDeleteOpen(true) },
        onExportArchive: exportArchive, onVerifyArchiveFile: verifyArchiveFile, archiveVerifyMessage: archiveVerifyMessage, onEscalateApprovals: escalateApprovals, escalateMessage: escalateMessage, exporting: exporting,
        report: report, reportLoading: reportLoading, analysis: analysis, matHistory: matHistory,
        importMessage: importMessage, onImportData: importProjectData, onImportFinancialStatements: importFinancialStatements, onValidateImportFile: validateImportFile, multiFile: multiFile, multiSheets: multiSheets, multiSheetIndex: multiSheetIndex, multiKind: multiKind, multiLoading: multiLoading, onChooseMultiSheetFile: chooseMultiSheetFile, onDownloadImportTemplate: downloadImportTemplate, onDownloadFinancialTemplate: downloadFinancialTemplate, onSetMultiSheetIndex: setMultiSheetIndex, onSetMultiKind: setMultiKind, onSubmitMultiSheet: submitMultiSheet, onGenerateTrialBalance: generateTrialBalance, onRefreshWorkpapers: refreshWorkpapers, confirmations: confirmations, inventoryCounts: inventoryCounts, inventoryAttachments: inventoryAttachments, inventoryMeta: inventoryMeta, onUpdateInventoryMeta: updateInventoryMeta, onSaveInventoryMeta: saveInventoryMeta, onExportInventorySummary: exportInventorySummary, onAskAiNextSteps: askAiNextSteps, onGenerateSubsequentEvents: generateSubsequentEvents, onGenerateGoingConcern: generateGoingConcern, onGenerateRelatedParties: generateRelatedParties, onGenerateContingencies: generateContingencies, onGenerateOpeningBalances: generateOpeningBalances, generatedKind: generatedKind, onSetGeneratedKind: setGeneratedKind, checklistKind: checklistKind, onSetChecklistKind: setChecklistKind, onGenerateChecklist: generateChecklist, programs: programs, onUpdateProgramRow: updateProgramRow, onSavePrograms: savePrograms, onCompletePrograms: completePrograms,  onExportPrograms: exportPrograms, programEvents: programEvents, onExportProgramsXlsx: exportProgramsXlsx, onExportProgramHistory: exportProgramHistory, onExportInventoryExceptions: exportInventoryExceptions, dataEvents: dataEvents, onUploadInventoryAttachment: uploadInventoryAttachment, onPreviewInventoryAttachment: previewInventoryAttachment, onUpdateInventoryRow: updateInventoryRow, onSaveInventoryCounts: saveInventoryCounts, onConfirmInventory: confirmInventory, onSyncConfirmations: syncConfirmations, onCycleConfirmation: cycleConfirmation, onReplyConfirmation: replyConfirmation, onExportConfirmationDifferences: exportConfirmationDifferences, onUploadConfirmationAttachment: uploadConfirmationAttachment, onDownloadConfirmationAttachment: downloadConfirmationAttachment, onPreviewConfirmationAttachment: previewConfirmationAttachment,
        onConfirmMateriality: confirmMateriality, onGenerateRiskDocx: generateRiskDocx,
        onLoadChecklist: loadReportChecklist, onLoadOpinion: loadReportOpinion,
        onGenerateDraft: generateReportDraft, onDownloadDraft: downloadReportDraft,
        onLoadVersions: loadReportVersions, onDownloadVersion: downloadVersion,
        onExportDocx: exportReportDocx, onExportPdf: exportReportPdf, onGenerateLetter: generateManagementLetter, onSubmitReview: submitReportReview, onFinalizeReport: finalizeReport,
        generated: generated, generating: generating, generateMessage: generateMessage,
        reviewerName: reviewerName, onReviewerNameChange: setReviewerName,
        members: members, newMemberName: newMemberName, onNewMemberNameChange: setNewMemberName,
        onAddMember: addProjectMember, onRemoveMember: removeProjectMember, onOpenWorkpaperHistory: openWorkpaperHistory, onOpenPbcHistory: openPbcHistory, onInitPbc: initPbcTemplate, onInitStdProject: initStdProject, onSyncEngine: syncEngineStatus,
        generatedDate: generatedDate, onGeneratedDateChange: setGeneratedDate,
        onOpenWorkpaperIndex: openWorkpaperByIndex, onGenerateWorkpaper: generateWorkpaper,
        onGenerateAll: generateAllWorkpapers, onGenerateLocal: generateLocalWorkpapers, localAtt: localAtt, onLocalAttChange: setLocalAtt, localAtts: localAttachments(), onExportWorkpapers: exportWorkpapersZip, reportVersionFilter: reportVersionFilter, onSetReportVersionFilter: setReportVersionFilter, approvalFilter: approvalFilter, onSetApprovalFilter: setApprovalFilter, onExportApprovals: exportApprovals, todoOverdueOnly: todoOverdueOnly, onSetTodoOverdueOnly: setTodoOverdueOnly, wpStatusFilter: wpStatusFilter, onSetWpStatusFilter: setWpStatusFilter, wpCycle: wpCycle, onSetWpCycle: setWpCycle, wpSearch: wpSearch, onSetWpSearch: setWpSearch, onExportWorkpaperList: exportWorkpaperListCsv, onJumpTodoZone: jumpTodoZone, onJumpZone: function (name) { setZone(name) }, onVerifyWorkpapersZip: verifyWorkpapersZip, wpsVerifyMessage: wpsVerifyMessage,
        onDownloadWorkpaper: downloadGeneratedWorkpaper, onPreviewWorkpaper: previewGeneratedWorkpaper,
        newPbcName: newPbcName, onPbcNameChange: setNewPbcName, onAddPbc: addPbcItem,
        onDeletePbc: deletePbcItem, onUploadAttachment: uploadPbcAttachment,
        onDownloadAttachment: downloadPbcAttachment, onPreviewAttachment: openAttachmentPreview, onCheckAttachment: checkAttachment, clientCheck: clientCheck, clientCheckMsg: clientCheckMsg, onExportClientCheck: exportClientCheckReport, onAddMisstatement: addMisstatementFromFinding, misstates: misstates, completeness: completeness, reportElements: reportElements, reportElementsMsg: reportElementsMsg, onSaveReportElements: saveReportElements, onUpdateMisstatement: updateMisstatement,
        onSubmitApproval: submitApproval, onDecideApproval: decideApproval,
        company: activeCompany, project: project,
        onStartChat: props.onStartChat, onCyclePbc: cyclePbc, onCycleWp: cycleWp,
        onNewSession: newProjectSession, onOpenSession: openProjectSession,
      }

      return h('div', { className: 'ad-split' },
        h('div', { className: 'ad-rail' },
          h('div', { className: 'ad-rail-h' },
            h('div', null, '项目'),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { setShowCreate(!showCreate); setCreateError(''); api('/audit/contracts').then(function (d) { setContracts(d.items || []) }).catch(function () {}) } }, '+ 新建')),
          h('div', { style: { padding: '0 12px 8px', display: 'flex', gap: '6px' } },
            h(ui.Input, { className: 'ad-plain', value: search, onChange: function (e) { setSearch(e.target.value) }, placeholder: '搜索客户/项目…', style: inputStyle }),
            h('select', { value: statusFilter, onChange: function (e) { setStatusFilter(e.target.value) }, style: Object.assign({}, inputStyle, { width: '86px', flexShrink: 0 }) },
              h('option', { value: '' }, '全部'),
              h('option', { value: '进行中' }, '进行中'),
              h('option', { value: '已归档' }, '已归档'))),
          showCreate ? h('div', { className: 'ad-form', style: { margin: '4px 8px 10px', gridTemplateColumns: '1fr' } },
            h('label', { className: 'ad-field' }, '合同', h('select', { className: 'ad-input', value: contractId, onChange: function (e) { const v = e.target.value; setContractId(v); const ct = (contracts || []).filter(function (x) { return String(x.id) === String(v) })[0]; if (ct && ct.client_name) setNewClient(ct.client_name) } },
              h('option', { value: '' }, '必选'),
              (contracts || []).map(function (c) { return h('option', { key: 'ct-' + c.id, value: String(c.id) }, c.client_name + (c.project_name ? ' · ' + c.project_name : '') + ' · ' + c.status) }))),
            h('label', { className: 'ad-field' }, '被审计单位', h(ui.Input, { className: 'ad-iw', value: newClient, onChange: function (e) { setNewClient(e.target.value) } })),
            h('label', { className: 'ad-field' }, '项目名称', h(ui.Input, { className: 'ad-iw', value: newName, onChange: function (e) { setNewName(e.target.value) }, placeholder: '如 2026年度审计' })),
            h('label', { className: 'ad-field' }, '期间', h(ui.Input, { className: 'ad-iw', value: newPeriod, onChange: function (e) { setNewPeriod(e.target.value) }, placeholder: '如 2026' })),
            h('label', { className: 'ad-field' }, '业务类型', h('select', { className: 'ad-input', value: businessType, onChange: function (e) { setBusinessType(e.target.value) } },
              ['年报审计', '专项审计', '内控审计'].map(function (name) { return h('option', { key: name, value: name }, name) }))),
            h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '可选：创建后立即导入（也可稍后上传）'),
            h('label', { style: { padding: '5px 8px', borderRadius: '6px', border: '1px dashed ' + COLORS.line, color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } },
              newFsFile ? ('财务报表：' + newFsFile.name) : '＋ 财务报表（xlsx）',
              h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' }, onChange: function (e) { setNewFsFile(e.target.files && e.target.files[0] || null); e.target.value = '' } })),
            h('label', { style: { padding: '5px 8px', borderRadius: '6px', border: '1px dashed ' + COLORS.line, color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } },
              newTbFile ? ('科目余额表：' + newTbFile.name) : '＋ 科目余额表',
              h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { setNewTbFile(e.target.files && e.target.files[0] || null); e.target.value = '' } })),
            h('label', { style: { padding: '5px 8px', borderRadius: '6px', border: '1px dashed ' + COLORS.line, color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } },
              newJournalFile ? ('序时账：' + newJournalFile.name) : '＋ 序时账',
              h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { setNewJournalFile(e.target.files && e.target.files[0] || null); e.target.value = '' } })),
            createError ? h('div', { style: { fontSize: '11px', color: '#b91c1c' } }, createError) : null,
            h('div', { className: 'ad-form-actions' },
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: createProject, disabled: creating }, creating ? '创建中…' : '创建'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setShowCreate(false); setCreateError('') } }, '取消'))) : null,
          (pinnedProjects || []).length ? h('div', { style: { padding: '0 10px 8px' } },
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '已固定'),
            pinnedProjects.map(function (item) {
              return h('div', { key: 'pin-' + item.project, onClick: function () { setActiveCompany(item.company); setActiveProject(item.project) },
                style: { padding: '5px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', color: item.project === activeProject ? COLORS.accent : 'inherit' } },
                h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center', minWidth: 0 } },
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '★ ' + item.project),
                    (pendingCounts || {})[item.project] ? h(ui.Button, { variant: 'outline', size: 'sm', title: '查看待审批', onClick: function (e) { e.stopPropagation(); setActiveCompany(item.company); setActiveProject(item.project); setZone('审批状态') },
                      style: { border: 0, borderRadius: '8px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '10px', padding: '1px 6px', cursor: 'pointer', flexShrink: 0 } }, pendingCounts[item.project] + ' 待审') : null),
                  (function () { const meta = projectMeta(item); return meta ? h('span', { style: { fontSize: '10px', color: COLORS.muted } }, (meta.status || '-') + (meta.period ? ' · ' + meta.period : '')) : null })()),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function (e) { e.stopPropagation(); togglePinProject(item) }, style: { border: 0, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontSize: '11px', flexShrink: 0 } }, '取消固定'))
            })) : null,
          h('div', { style: { padding: '0 8px 12px' } }, visibleCompanies.length ? visibleCompanies.map(function (c) {
            const active = c.name === activeCompany
            return h('div', { key: c.name, className: 'ad-nav' + (active ? ' on' : ''), onClick: function () { setActiveCompany(c.name); setActiveProject(null) } },
              h('div', null, c.name), h('div', { className: 'ad-row-meta' }, c.projects.length + ' 个项目'))
          }) : h('div', { style: { padding: '10px', fontSize: '12px', color: COLORS.muted } }, '没有匹配的客户'))),
        visibleProjects.length > 1 ? h('div', { className: 'ad-rail', style: { width: '260px' } },
          h('div', { className: 'ad-rail-h' }, '年度项目'),
          h('div', { style: { padding: '0 8px 12px' } }, visibleProjects.map(function (p) {
            const active = p.id === effectiveProjectId
            return h('div', { key: p.id, className: 'ad-nav' + (active ? ' on' : ''), onClick: function () { setActiveProject(p.id) } },
              h('div', null, p.name), h('div', { className: 'ad-row-meta' }, p.period + ' · ' + p.status + (p.business_type ? ' · ' + p.business_type : '')))
          }))) : null,
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { className: 'ad-zones' },
            activeProject ? h(ui.Button, { variant: 'ghost', size: 'sm', style: { alignSelf: 'flex-end', flexShrink: 0, marginRight: '10px', marginBottom: '4px', minHeight: '30px' }, onClick: function () { setActiveProject(null) } }, '← 项目列表') : null,
            [{ label: '执行', items: ['概览', '风险评估', '资料清单', '审计程序', '程序执行', '审计底稿', '项目对话'] }, { label: '交付', items: ['报告', '审批状态', '归档'] }].map(function (group) {
              return h('div', { key: group.label, className: 'ad-zone-group' },
                h('span', { className: 'ad-zone-label' }, group.label),
                group.items.map(function (name) {
                  const active = zone === name
                  return h(ui.Button, { variant: 'outline', size: 'sm', key: name, 'data-zone': name, className: 'ad-tab' + (active ? ' on' : ''), onClick: function () { setZone(name) } }, name)
                }))
            })),
          readOnly
            ? h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'rgba(180,83,9,0.10)', color: '#b45309', fontSize: '12px', borderBottom: '1px solid ' + COLORS.line } },
                h('span', null, '项目已归档：所有写操作已锁定，仅可查看/下载。'),
                isManager ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: unarchiveProject, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '解除归档') : null)
            : null,
          h('div', { style: { flex: 1, overflow: 'auto' } },
            project ? h(Zone, zoneProps) : h(Empty, null, activeCompany ? '选择右侧项目查看四个分区' : '选择公司开始'))),
        previewModal, mgmtModal)
    }

    // ---------- 知识库 ----------
    function KbPage(props) {
      const authUser = (props && props.auth && props.auth.user) || {}
      const isKbAdmin = inRole(authUser.role, 'admin')
      const kbStatusState = React.useState(null); const kbStatus = kbStatusState[0]; const setKbStatus = kbStatusState[1]
      const kbExpiringState = React.useState(null); const kbExpiring = kbExpiringState[0]; const setKbExpiring = kbExpiringState[1]
      const pendingState = React.useState([]); const pendingDocs = pendingState[0]; const setPendingDocs = pendingState[1]
      const pendingMsgState = React.useState(''); const pendingMsg = pendingMsgState[0]; const setPendingMsg = pendingMsgState[1]
      const pendingBusyState = React.useState(false); const pendingBusy = pendingBusyState[0]; const setPendingBusy = pendingBusyState[1]
      function loadPending() {
        if (!isKbAdmin) return
        api('/kb/pending').then(function (d) { setPendingDocs((d && d.docs) || []) }).catch(function () {})
        api('/kb/admin/status').then(function (d) { setKbStatus(d) }).catch(function () {})
      }
      function toggleExpiring() {
        if (kbExpiring) { setKbExpiring(null); return }
        api('/kb/expiring', { days: 90 }).then(function (d) { setKbExpiring(d) }).catch(function () { setKbExpiring({ items: [], count: 0 }) })
      }
      function decidePending(id, decision) {
        setPendingBusy(true)
        setPendingMsg(decision === 'approve' ? '已提交通过，正在发布并重建索引…' : '正在驳回…')
        api('/kb/pending/decide', null, { method: 'POST', body: { id: id, decision: decision } })
          .then(function (d) {
            setPendingMsg(d && d.started ? '已开始发布并重建索引，请稍后刷新' : (decision === 'approve' ? '已处理' : '已驳回'))
            setTimeout(function () { loadPending(); setPendingBusy(false) }, 2000)
          })
          .catch(function (e) { setPendingMsg('失败：' + String(e)); setPendingBusy(false) })
      }
      React.useEffect(function () { loadPending() }, [])
      const docsState = React.useState([]); const docs = docsState[0]; const setDocs = docsState[1]
      const queryState = React.useState(''); const q = queryState[0]; const setQ = queryState[1]
      const hitsState = React.useState(null); const hits = hitsState[0]; const setHits = hitsState[1]
      const codeState = React.useState(''); const code = codeState[0]; const setCode = codeState[1]
      const docState = React.useState(null); const doc = docState[0]; const setDoc = docState[1]
      const [targetSection, setTargetSection] = React.useState('')
      const searchingState = React.useState(false); const searching = searchingState[0]; const setSearching = searchingState[1]
      const errorState = React.useState(''); const error = errorState[0]; const setError = errorState[1]

      React.useEffect(function () {
        let cancelled = false
        api('/kb/docs').then(function (d) { if (!cancelled) setDocs(d.docs || []) })
          .catch(function (e) { if (!cancelled) setError(String(e)) })
        return function () { cancelled = true }
      }, [])

      function runSearch() {
        if (!q.trim()) return
        setSearching(true); setError('')
        api('/kb/search', { q: q, top_k: 20 })
          .then(function (d) { setHits(d.hits || []) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setSearching(false) })
      }
      function openDoc(ref, section) {
        const raw = String(ref)
        const path = raw.split(' › ')[0]
        const sec = section || (raw.indexOf(' › ') > 0 ? raw.split(' › ')[1] : '')
        setTargetSection(sec || '')
        setError('')
        api('/kb/doc', { doc: path }).then(function (d) { setDoc(d) }).catch(function (e) { setError(String(e)) })
      }

      const counts = {}
      docs.forEach(function (d) { counts[d.code] = (counts[d.code] || 0) + 1 })
      const catCodes = Object.keys(CAT).filter(function (c) { return counts[c] })
      const visibleDocs = hits === null ? docs.filter(function (d) { return !code || d.code === code }).slice(0, 200) : []
      const catItems = [{ code: '', label: '全部文档（' + docs.length + '）' }].concat(catCodes.map(function (c) { return { code: c, label: CAT[c] + '（' + counts[c] + '）' } }))
      const left = h('div', { className: 'ad-rail', style: { width: '220px' } },
        h('div', { className: 'ad-rail-h' }, '知识库'),
        h('div', { style: { padding: '0 8px 12px' } }, catItems.map(function (item) {
          const active = code === item.code
          return h('div', { key: item.code || 'all', className: 'ad-nav' + (active ? ' on' : ''), onClick: function () { setCode(item.code); setHits(null) } }, item.label)
        })))
      const searchBox = h('div', { style: { padding: '12px', borderBottom: '1px solid ' + COLORS.line } },
        h('div', { style: { display: 'flex', gap: '6px' } },
          h(ui.Input, { className: 'ad-iw', value: q, onChange: function (e) { setQ(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') runSearch() }, placeholder: '检索准则、法规或模板' }),
          h(ui.Button, { variant: 'primary', size: 'sm', onClick: runSearch, disabled: searching }, searching ? '检索中' : '检索')),
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginTop: '8px' } }, error) : null)
      const statusBox = isKbAdmin && kbStatus ? h('div', { style: { padding: '8px 12px', borderBottom: '1px solid ' + COLORS.line, fontSize: '11px', color: COLORS.muted } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', { style: { fontWeight: 600, color: COLORS.text } }, '知识库状态'),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: loadPending, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '10px', cursor: 'pointer' } }, '刷新')),
        h('div', { style: { marginTop: '3px', lineHeight: 1.8 } },
          '已发布 ' + ((kbStatus.counts || {}).approved || 0) + ' · 待审 ' + ((kbStatus.counts || {}).pending || 0) +
          ' · 过期 ' + ((kbStatus.counts || {}).expired || 0) + ' · 索引 ' + (kbStatus.chunks || 0) + ' 块'),
        kbStatus.last_reviewed ? h('div', null, '最近发布：' + kbStatus.last_reviewed.title + '（' + kbStatus.last_reviewed.at + '）') : null,
        kbStatus.last_sync ? h('div', null, '最近巡检：' + (kbStatus.last_sync.at || '') + '，新增 ' + (kbStatus.last_sync.added || 0) + ' 篇') : null,
        h(ui.Button, { variant: 'outline', size: 'sm', onClick: toggleExpiring, style: { marginTop: '3px', border: 0, background: 'transparent', color: COLORS.accent, fontSize: '10px', cursor: 'pointer', padding: 0 } }, (kbExpiring ? '收起' : '失效/到期提醒') + '（' + ((kbStatus.counts || {}).expired || 0) + '）'),
        kbExpiring && kbExpiring.items && kbExpiring.items.length ? h('div', { style: { marginTop: '2px', maxHeight: '120px', overflow: 'auto' } },
          kbExpiring.items.slice(0, 12).map(function (item, i) {
            return h('div', { key: 'kbexp-' + (item.id || i), style: { padding: '1px 0', color: '#b45309' } },
              '· ' + item.title + (item.expire ? '（' + item.expire + '）' : '（已失效）'),
              (item.replacements && item.replacements.length)
                ? h('div', { style: { color: '#16a34a', paddingLeft: '10px' } }, item.replacements.map(function (rep) {
                    return h('div', { key: 'rep-' + (rep.id || rep.title), onClick: function () { if (rep.filename) openDoc(rep.filename) }, title: '点击查看新版本全文', style: { cursor: 'pointer', textDecoration: 'underline' } }, '↳ 可能替代：' + rep.title + (rep.docno ? '（' + rep.docno + '）' : ''))
                  }))
                : null)
          })) : null,
        (kbStatus.apply || {}).running ? h('div', { style: { color: '#b45309', marginTop: '2px' } }, '正在' + ((kbStatus.apply || {}).action === 'approve' ? '发布并重建索引' : '处理审批') + '…（重建索引约 10 分钟）') : null,
        (kbStatus.apply || {}).error ? h('div', { style: { color: '#b91c1c', marginTop: '2px' } }, '上次审批异常：' + kbStatus.apply.error) : null) : null
      const pendingBox = isKbAdmin && (pendingDocs.length > 0 || pendingMsg) ? h('div', { style: { padding: '10px 12px', borderBottom: '1px solid ' + COLORS.line, background: 'rgba(180,83,9,0.06)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 600, color: '#b45309' } }, '待审文档（' + pendingDocs.length + '）'),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: loadPending, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '刷新')),
        pendingDocs.slice(0, 5).map(function (item) {
          return h('div', { key: 'kb-pending-' + item.id, style: { padding: '5px 0', borderBottom: '1px dashed ' + COLORS.line, fontSize: '11px' } },
            h('div', { style: { color: COLORS.text, marginBottom: '3px' } }, item.title + (item.docno ? '（' + item.docno + '）' : '')),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', color: COLORS.muted } },
              h('span', null, (CAT[item.code] || item.code) + (item.source_url ? ' · 官网' : '') + ' · ' + (item.added_at || '')),
              h(ui.Button, { variant: 'outline', size: 'sm', disabled: pendingBusy, onClick: function () { decidePending(item.id, 'approve') },
                style: { padding: '2px 8px', borderRadius: '6px', border: 0, background: '#16a34a', color: '#fff', fontSize: '10px', cursor: 'pointer' } }, '通过'),
              h(ui.Button, { variant: 'outline', size: 'sm', disabled: pendingBusy, onClick: function () { decidePending(item.id, 'reject') },
                style: { padding: '2px 8px', borderRadius: '6px', border: '1px solid #b91c1c', background: 'transparent', color: '#b91c1c', fontSize: '10px', cursor: 'pointer' } }, '驳回')))
        }),
        pendingMsg ? h('div', { style: { marginTop: '6px', fontSize: '11px', color: '#b45309' } }, pendingMsg) : null) : null
      let listItems = []
      if (hits === null) {
        listItems = visibleDocs.map(function (d, i) {
          return h('div', { key: d.code + ':' + (d.filename || d.title) + ':' + i, className: 'ad-row', onClick: function () { openDoc(d.filename) }, style: { cursor: 'pointer' } },
            h('div', null,
              h('div', { className: 'ad-row-title' }, d.title || d.filename),
              h('div', { className: 'ad-row-meta' }, (CAT[d.code] || d.code) + (d.docno ? ' · ' + d.docno : ''))))
        })
        if (!listItems.length) listItems = [h(Empty, { key: 'empty' }, '暂无文档')]
      } else if (!hits.length) {
        listItems = [h(Empty, { key: 'empty' }, '没有命中，换个关键词试试')]
      } else {
        listItems = hits.map(function (hit, i) {
          const title = hit.doc && hit.doc.title ? hit.doc.title : hit.ref
          const meta = (hit.doc && hit.doc.code ? (CAT[hit.doc.code] || hit.doc.code) : '') + ' · ' + (hit.section || '')
          return h('div', { key: 'hit-' + i, className: 'ad-row', onClick: function () { openDoc(hit.ref, hit.section) }, style: { cursor: 'pointer', alignItems: 'flex-start' } },
            h('div', null,
              h('div', { className: 'ad-row-title' }, markKw(title, q)),
              h('div', { className: 'ad-row-meta' }, meta),
              h('div', { className: 'ad-row-meta', style: { marginTop: '6px', lineHeight: 1.6, maxHeight: '3.2em', overflow: 'hidden' } }, markKw(hit.text, q))))
        })
      }
      const markKw = function (text, kw) {
        const src = String(text == null ? '' : text)
        const k = String(kw || '').trim()
        if (!k) return src
        const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        let re
        try { re = new RegExp('(' + esc + ')', 'gi') } catch (e) { return src }
        return src.split(re).map(function (part, i) {
          return part.toLowerCase() === k.toLowerCase() ? h('mark', { key: 'mk-' + i }, part) : part
        })
      }
      const middle = h('div', { style: { width: '320px', borderRight: '1px solid ' + COLORS.line, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%', flexShrink: 0 } },
        searchBox, statusBox, pendingBox, h('div', { style: { flex: 1, overflow: 'auto', padding: '4px 8px' } }, listItems))
      let right
      if (!doc) {
        right = h(Empty, null, '左侧检索或选择文档，这里显示条文全文与出处')
      } else {
        const metaLine = [
          doc.meta && doc.meta.code ? (CAT[doc.meta.code] || doc.meta.code) : '',
          doc.meta && doc.meta.docno ? doc.meta.docno : '',
          doc.meta && doc.meta.effective ? '生效 ' + doc.meta.effective : '',
        ].filter(Boolean).join(' · ')
        const chunks = (doc.chunks || []).map(function (c, i) {
          return h('div', { key: 'chunk-' + i, className: 'ad-chunk', 'data-section': c.section || '' },
            h('div', { className: 'ad-chunk-h' }, c.section || '正文'),
            h('div', { style: { fontSize: '14px', lineHeight: 1.75, whiteSpace: 'pre-wrap' } }, c.text))
        })
        right = h('div', { className: 'ad-doc' },
          h('h1', { className: 'ad-doc-title' }, (doc.meta && doc.meta.title) || doc.doc),
          h('div', { className: 'ad-sub', style: { marginBottom: '22px' } }, metaLine),
          chunks)
      }
      React.useEffect(function () {
        if (!doc || !targetSection) return
        const want = String(targetSection).trim()
        if (!want) return
        const nodes = Array.prototype.slice.call(document.querySelectorAll('.ad-chunk'))
        const hit = nodes.filter(function (el) {
          const sec = String((el.getAttribute('data-section') || '')).trim()
          return sec && (sec === want || sec.indexOf(want) >= 0 || want.indexOf(sec) >= 0)
        })[0]
        if (hit) { try { hit.scrollIntoView({ block: 'start', behavior: 'auto' }) } catch (e) {} }
      }, [doc, targetSection])
      const rightPane = h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto' } }, right)
      return h('div', { className: 'ad-split' }, left, middle, rightPane)
    }

    // ---------- 操作留痕 ----------
    // 覆盖数据里实际出现的全部 item_type（漏一个就意味着该类记录筛不到）
    const TYPE_NAMES = {
      pbc: '资料清单', workpaper: '底稿', approval: '审批', pbc_attachment: '附件',
      member: '成员', program: '审计程序', report: '报告', materiality: '重要性',
      data: '数据', inventory: '存货监盘', confirmation: '函证', risk: '风险评估',
      archive: '归档包', drill: '演练', backup: '备份',
      alert: '告警', client: '客户', client_check: '客户底稿核对', contract: '合同',
      evidence: '证据', invoice: '发票', kb_review: '知识库审校', kb_sync: '知识库同步',
      mapping_rules: '映射规则', misstatement: '错报', program_catalog: '程序库',
      project: '项目', report_push: '报告推送', report_seal: '报告盖章',
      stage: '流程节点', workpapers_verify: '底稿校验',
    }

    function EventsPage() {
      const savedFilters = (function () {
        try { return JSON.parse(localStorage.getItem('auditdesk.events.filters') || '{}') || {} } catch (e) { return {} }
      })()
      const navType = (function () {
        try {
          const saved = localStorage.getItem('auditdesk.events.type') || ''
          if (saved) localStorage.removeItem('auditdesk.events.type')
          return saved
        } catch (e) { return '' }
      })()
      const [events, setEvents] = React.useState([])
      const [projects, setProjects] = React.useState([])
      const [project, setProject] = React.useState(savedFilters.project || '')
      const [actor, setActor] = React.useState(savedFilters.actor || '')
      const [type, setType] = React.useState(navType || savedFilters.type || '')
      const [itemName, setItemName] = React.useState(savedFilters.itemName || '')
      const [startDate, setStartDate] = React.useState(savedFilters.startDate || '')
      const [endDate, setEndDate] = React.useState(savedFilters.endDate || '')
      React.useEffect(function () {
        try { localStorage.setItem('auditdesk.events.filters', JSON.stringify({ project: project, actor: actor, type: type, itemName: itemName, startDate: startDate, endDate: endDate })) } catch (e) {}
      }, [project, actor, type, itemName, startDate, endDate])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [page, setPage] = React.useState(1)
      const [total, setTotal] = React.useState(0)

      // 从别处（如底稿台账「历史」）跳进来时，组件可能已挂载，需要重读筛选条件
      React.useEffect(function () {
        function onRefresh() {
          try {
            const f = JSON.parse(localStorage.getItem('auditdesk.events.filters') || '{}') || {}
            setProject(f.project || ''); setActor(f.actor || ''); setType(f.type || '')
            setItemName(f.itemName || ''); setStartDate(f.startDate || ''); setEndDate(f.endDate || '')
            setPage(1)
            // 直接带参数查询：此时 state 还没更新，走 load() 会用到旧值
            setLoading(true); setError('')
            api('/audit/events', {
              project: f.project || undefined, actor: f.actor || undefined,
              item_type: f.type || undefined, item_name: f.itemName || undefined,
              start_date: f.startDate || undefined, end_date: f.endDate || undefined,
              limit: 100, offset: 0
            }).then(function (d) { setEvents(d.events || []); setTotal(d.total || (d.events || []).length) })
              .catch(function (e) { setError(String(e)) })
              .then(function () { setLoading(false) })
          } catch (e) {}
        }
        window.addEventListener('auditdesk:events-refresh', onRefresh)
        return function () { window.removeEventListener('auditdesk:events-refresh', onRefresh) }
      }, [])
      // 快捷时间：直接带参数查，不走 load()（state 尚未更新，闭包会读到旧值）
      function applyQuickRange(days) {
        if (days < 0) {
          setStartDate(''); setEndDate('')
          setLoading(true); setError('')
          api('/audit/events', { project: project || undefined, actor: actor || undefined,
            item_type: type || undefined, item_name: itemName || undefined, limit: 100, offset: 0 })
            .then(function (d) { setEvents(d.events || []); setTotal(d.total || (d.events || []).length); setPage(1) })
            .catch(function (e) { setError(String(e)) })
            .then(function () { setLoading(false) })
          return
        }
        const now = new Date()
        const fmtD = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
        const end = fmtD(now)
        const start = days === 0 ? end : fmtD(new Date(now.getTime() - days * 86400000))
        setStartDate(start); setEndDate(end)
        setLoading(true); setError('')
        api('/audit/events', { project: project || undefined, actor: actor || undefined,
          item_type: type || undefined, item_name: itemName || undefined,
          start_date: start, end_date: end, limit: 100, offset: 0 })
          .then(function (d) { setEvents(d.events || []); setTotal(d.total || (d.events || []).length); setPage(1) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setLoading(false) })
      }
      function resetFilters() {
        setProject(''); setActor(''); setType(''); setItemName(''); setStartDate(''); setEndDate(''); setPage(1)
        try { localStorage.removeItem('auditdesk.events.filters') } catch (e) {}
        setTimeout(function () { load(1) }, 0)
      }
      function exportCsv() {
        const params = []
        if (project) params.push('project=' + encodeURIComponent(project))
        if (actor) params.push('actor=' + encodeURIComponent(actor))
        if (type) params.push('item_type=' + encodeURIComponent(type))
        if (startDate) params.push('start_date=' + encodeURIComponent(startDate))
        if (endDate) params.push('end_date=' + encodeURIComponent(endDate))
        fetch(BASE + '/audit/events/export' + (params.length ? '?' + params.join('&') : ''), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = 'audit-events.csv'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function (e) { setError(String(e)) })
      }
      function exportPageCsv() {
        const rows = [['ID', '项目', '类型', '对象', '原状态', '新状态', '操作人', 'IP', '时间']]
        ;(events || []).forEach(function (event) {
          rows.push([event.id, event.project_id, event.item_type, event.item_name, event.old_status, event.new_status, event.actor, event.source_ip, event.created_at])
        })
        const csv = '\ufeff' + rows.map(function (row) { return row.map(function (cell) { return '"' + String(cell === null || cell === undefined ? '' : cell).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = '操作留痕_第' + page + '页.csv'
        document.body.appendChild(anchor); anchor.click(); anchor.remove()
        URL.revokeObjectURL(url)
      }
      function load(pageNo) {
        const target = pageNo || page
        setLoading(true); setError('')
        api('/audit/events', { project: project || undefined, actor: actor || undefined, item_type: type || undefined, item_name: itemName || undefined, start_date: startDate || undefined, end_date: endDate || undefined, limit: 100, offset: (target - 1) * 100 })
          .then(function (d) { setEvents(d.events || []); setTotal(d.total || (d.events || []).length); setPage(target) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setLoading(false) })
      }
      React.useEffect(function () {
        api('/audit/projects').then(function (d) {
          const list = []
          ;(d.companies || []).forEach(function (company) { (company.projects || []).forEach(function (p) { list.push(p) }) })
          setProjects(list)
        }).catch(function () {})
        load()
      }, [])

      const quickBar = h('div', { style: { display: 'flex', gap: '6px', padding: '0 14px 8px', flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { style: { fontSize: '11px', color: COLORS.muted } }, '快捷时间：'),
        [{ label: '今天', days: 0 }, { label: '近 7 天', days: 7 }, { label: '近 30 天', days: 30 }, { label: '全部', days: -1 }].map(function (r) {
          return h(ui.Button, { key: 'qr-' + r.label, variant: 'ghost', size: 'sm',
            style: { fontSize: '11px', padding: '2px 8px', minHeight: '22px' },
            onClick: function () { applyQuickRange(r.days) } }, r.label)
        }))
      const filterBar = h('div', { className: 'ad-form' },
        h('label', { className: 'ad-field' }, '项目', h('select', { className: 'ad-input', value: project, onChange: function (e) { setProject(e.target.value) } },
          h('option', { value: '' }, '全部'),
          projects.map(function (p) { return h('option', { key: p.id, value: p.id }, p.client + ' / ' + p.name) }))),
        h('label', { className: 'ad-field' }, '操作人', h(ui.Input, { className: 'ad-iw', value: actor, onChange: function (e) { setActor(e.target.value) } })),
        h('label', { className: 'ad-field' }, '对象（如底稿名）', h(ui.Input, { className: 'ad-iw', value: itemName, placeholder: '按名称模糊匹配', onChange: function (e) { setItemName(e.target.value) } })),
        h('label', { className: 'ad-field' }, '类型', h('select', { className: 'ad-input', value: type, onChange: function (e) { setType(e.target.value) } },
          h('option', { value: '' }, '全部'),
          Object.keys(TYPE_NAMES).map(function (key) { return h('option', { key: key, value: key }, TYPE_NAMES[key]) }))),
        h('label', { className: 'ad-field' }, '开始', h(ui.Input, { className: 'ad-iw', value: startDate, onChange: function (e) { setStartDate(e.target.value) }, type: 'date' })),
        h('label', { className: 'ad-field' }, '结束', h(ui.Input, { className: 'ad-iw', value: endDate, onChange: function (e) { setEndDate(e.target.value) }, type: 'date' })),
        h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { load(1) } }, loading ? '查询中…' : '查询')))

      // 留痕的 new_status 被部分调用方当成「动作描述」用（试算平衡/存货监盘/抽样…），
      // 先判断是不是真状态，避免把程序名当状态显示成「— → 试算平衡」
      // 按数据里实际出现的状态值补齐（old_status 分布统计），漏一个就会把真状态误判成"动作"
      const KNOWN_STATUSES = ['待执行', '进行中', '已生成', '已完成', '不适用',
        '未交', '待补', '已交', '部分收到',
        '待提交', '待审批', '已通过', '已驳回', '已撤回', '待审', '已审',
        '待归档', '已归档', '已签', '待开', '已开', '待发', '已发', '已回函', '已核', '待核', '待取',
        '待审批', '已审批', '已确认', '待确认', '未确认', '已定稿', '已复核', '复核中', '新建',
        '已执行', '执行中', '草稿', '待处理', '已询问', '已调整', '已整改',
        '一审通过', '二审通过', '待一审', '待二审']
      const isStatus = function (v) { return !!v && KNOWN_STATUSES.indexOf(String(v).trim()) >= 0 }
      // 从留痕跳回对象现状：切到审计底稿并预填该科目循环
      const gotoObject = function (item) {
        const p = (projects || []).filter(function (x) { return x.id === item.project_id })[0]
        const m = String(item.item_name || '').match(/^([A-Z]{1,3})-\d+/)
        const cycle = m ? m[1] : ''
        try {
          localStorage.setItem('auditdesk.lastContext', JSON.stringify({
            company: (p && p.client) || item.project_id, project: item.project_id, zone: '审计底稿'
          }))
          if (cycle) localStorage.setItem('auditdesk.pendingWpCycle', cycle)
          else localStorage.removeItem('auditdesk.pendingWpCycle')
        } catch (e) {}
        // 项目页可能已经挂载，靠事件同步筛选（localStorage 只在首次挂载时读）
        try { window.dispatchEvent(new CustomEvent('auditdesk:wp-cycle', { detail: cycle || 'all' })) } catch (e) {}
        try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel('audit-companies') } catch (e) {}
      }
      // 留痕里最该被看见的是「倒退」：已交→未交、已完成→待执行、已调整→未处理
      const TRANSITION_TONE = (function () {
        const down = { '待执行': 0, '未交': 0, '未处理': 0, '已驳回': 0, '进行中': 1, '待补': 1, '待审批': 1, '已询问': 1 }
        const terminal = { '已完成': 3, '已交': 2, '已调整': 3, '已通过': 3, '已定稿': 4, '已生成': 2 }
        return function (oldS, newS) {
          const o = oldS || ''
          const n = newS || ''
          if (!o) return '#6b7280'                      // 新增
          // 从终态退回（已完成→待执行、已交→未交）：最该被看见的异常
          if (terminal[o] !== undefined && terminal[n] === undefined) return '#b91c1c'
          const oi = down[o]
          const ni = down[n]
          if (oi !== undefined && ni !== undefined) return ni < oi ? '#b91c1c' : (ni > oi ? '#16a34a' : '#6b7280')
          if (terminal[n] !== undefined) return '#16a34a'   // 走向终态
          return '#b45309'                                   // 其它（多为新增/流程推进）
        }
      })()
      const rows = events.map(function (item) {
        return h('div', { key: item.id, style: { display: 'grid', gridTemplateColumns: '140px 70px 66px minmax(0,1fr) 150px 110px', gap: '10px', padding: '7px 16px', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px', alignItems: 'center' } },
          h('span', { style: { color: COLORS.muted } }, item.created_at),
          h('span', null, item.actor || '-'),
          h('span', { style: { color: COLORS.muted, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, TYPE_NAMES[item.item_type] || item.item_type),
          h('span', { title: item.item_name || '', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.item_name || '—'),
          (function () {
            const o = item.old_status || ''
            const n = item.new_status || ''
            const act = String(item.action || '').trim()
            const det = String(item.detail || '').trim()
            // 有独立 action 字段时（新记录），动作信息放 title，不和状态变更抢列
            const extra = act ? (act + (det ? '：' + det : '')) : ''
            if (act && isStatus(o) && isStatus(n)) {
              const tone = TRANSITION_TONE(o, n)
              return h('span', { style: { color: tone, fontSize: '11px', fontWeight: tone === '#b91c1c' ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: (o + ' → ' + n) + ' · ' + extra },
                (o + ' → ' + n))
            }
            if (act && !isStatus(n)) {
              // 有旧状态时保留「未交 → 删除」的上下文，比单写"动作：删除"信息多
              if (isStatus(o)) {
                return h('span', { title: (o + ' → 删除') + ' · ' + extra, style: { color: '#b45309', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  o + ' → ' + act)
              }
              return h('span', { title: extra, style: { color: COLORS.muted, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '动作：' + act)
            }
            // 旧记录没有 action 列，退回白名单判断
            if (!isStatus(o) && !isStatus(n) && (o || n)) {
              return h('span', { title: '动作：' + (o || n), style: { color: COLORS.muted, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                '动作：' + (o || n))
            }
            const tone = TRANSITION_TONE(o, n)
            return h('span', { style: { color: tone, fontSize: '11px', fontWeight: tone === '#b91c1c' ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: (o || '—') + ' → ' + (n || '—') },
              (o || '—') + ' → ' + (n || '—'))
          })(),
          h('span', { style: { color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            item.item_type === 'workpaper' && item.item_id
              ? h('span', { style: { color: COLORS.accent, cursor: 'pointer' }, title: '切到审计底稿并预填该科目循环',
                  onClick: function () { gotoObject(item) } }, '查看现状')
              : item.project_id))
      })

      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '留痕'),
            h('div', { className: 'ad-sub' }, '共 ' + total + ' 条 · 第 ' + page + ' / ' + Math.max(1, Math.ceil(total / 100)) + ' 页')),
          h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'ghost', size: 'sm', disabled: page <= 1, onClick: function () { if (page > 1) load(page - 1) } }, '上一页'),
            h(ui.Button, { variant: 'ghost', size: 'sm', disabled: page * 100 >= total, onClick: function () { if (page * 100 < total) load(page + 1) } }, '下一页'))),
        h('details', { className: 'ad-more' },
          h('summary', null, '清除与导出'),
          h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: resetFilters }, '清除筛选'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportCsv }, '导出全部'),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: exportPageCsv }, '导出当前页'))),
        quickBar,
        filterBar,
        error ? h('div', { style: { padding: '10px 16px', color: '#b91c1c', fontSize: '12px' } }, error) : null,
        rows.length ? h('div', { style: { display: 'grid', gridTemplateColumns: '140px 70px 66px minmax(0,1fr) 150px 110px', gap: '10px', padding: '4px 16px', fontSize: '11px', color: COLORS.muted, borderBottom: '1px solid ' + COLORS.line, background: 'rgba(127,127,127,0.05)' } },
          h('span', null, '时间'),
          h('span', null, '操作人'),
          h('span', null, '类型'),
          h('span', null, '对象'),
          h('span', null, '状态变更'),
          h('span', null, '项目')) : null,
        h('div', { style: { flex: 1, overflow: 'auto' } },
          rows.length ? rows : h('div', { style: { padding: '20px', fontSize: '12px', color: COLORS.muted } }, '没有符合条件的操作记录')))
    }

    // ---------- 图标 ----------
    function CompaniesIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M4 21V5a1 1 0 0 1 1-1h7v17M12 21h8V9a1 1 0 0 1 1-1h-9M7 8h2M7 12h2M7 16h2M15 12h3M15 16h3' }))
    }
    function EventsIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M12 8v5l3 2M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12 3v2' }))
    }
    function KbIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5A2.5 2.5 0 0 1 17.5 21H6.5A2.5 2.5 0 0 1 4 18.5zM8 7h8M8 11h8M8 15h5' }))
    }

    function UsersIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }))
    }

    function UsersPage(props) {
      const auth = props.auth || {}
      const role = (auth.user && auth.user.role) || ''
      const isAdmin = role === 'kb-admin' || role === 'admin'
      const usersState = React.useState([]); const users = usersState[0]; const setUsers = usersState[1]
      const loadingState = React.useState(false); const loading = loadingState[0]; const setLoading = loadingState[1]
      const errorState = React.useState(''); const error = errorState[0]; const setError = errorState[1]
      const messageState = React.useState(''); const message = messageState[0]; const setMessage = messageState[1]
      const newUserState = React.useState({ username: '', name: '', password: '', role: 'auditor' }); const newUser = newUserState[0]; const setNewUser = newUserState[1]
      const resetUserState = React.useState(''); const resetUser = resetUserState[0]; const setResetUser = resetUserState[1]
      const resetPasswordState = React.useState(''); const resetPassword = resetPasswordState[0]; const setResetPassword = resetPasswordState[1]
      const inputStyle = { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' }

      function load() {
        if (!isAdmin) return
        setLoading(true); setError('')
        api('/audit/users').then(function (d) { setUsers(d.items || []) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setLoading(false) })
      }
      React.useEffect(function () { load() }, [isAdmin])

      function createUser() {
        setMessage(''); setError('')
        api('/audit/users/create', null, { method: 'POST', body: newUser })
          .then(function () { setMessage('已创建用户：' + newUser.username); setNewUser({ username: '', name: '', password: '', role: 'auditor' }); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function toggleUserStatus(user) {
        api('/audit/users/status', null, { method: 'POST', body: { username: user.username, active: !(user.active === 1 || user.active === true) } })
          .then(function () { setMessage((user.active ? '已停用 ' : '已启用 ') + user.username); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function changeRole(username, nextRole) {
        api('/audit/users/update-role', null, { method: 'POST', body: { username: username, role: nextRole } })
          .then(load).catch(function (e) { setError(String(e)) })
      }
      function submitReset() {
        if (!resetUser || !resetPassword) return
        api('/audit/users/reset-password', null, { method: 'POST', body: { username: resetUser, password: resetPassword } })
          .then(function () { setMessage('已重置 ' + resetUser + ' 的密码'); setResetUser(''); setResetPassword('') })
          .catch(function (e) { setError(String(e)) })
      }

      if (!isAdmin) {
        return h(Empty, null, '仅管理员可访问用户管理（当前角色：' + role + '）')
      }
      const roleOptions = [['auditor', '审计员'], ['manager', '项目经理'], ['partner', '合伙人'], ['kb-admin', '管理员']]
      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '用户'),
            h('div', { className: 'ad-sub' }, '建账号、改角色、重置密码。停用只锁登录，不删历史。'))),
        message ? h('div', { className: 'ad-note' }, message) : null,
        error ? h('div', { className: 'ad-note' }, error) : null,
        h('div', { className: 'ad-form' },
          h('label', { className: 'ad-field' }, '用户名', h(ui.Input, { className: 'ad-iw', value: newUser.username, onChange: function (e) { setNewUser(Object.assign({}, newUser, { username: e.target.value })) }, placeholder: '登录名' })),
          h('label', { className: 'ad-field' }, '姓名', h(ui.Input, { className: 'ad-iw', value: newUser.name, onChange: function (e) { setNewUser(Object.assign({}, newUser, { name: e.target.value })) } })),
          h('label', { className: 'ad-field' }, '初始密码', h(ui.Input, { className: 'ad-iw', value: newUser.password, onChange: function (e) { setNewUser(Object.assign({}, newUser, { password: e.target.value })) }, placeholder: '至少 6 位' })),
          h('label', { className: 'ad-field' }, '角色', h('select', { className: 'ad-input', value: newUser.role, onChange: function (e) { setNewUser(Object.assign({}, newUser, { role: e.target.value })) } }, roleOptions.map(function (item) { return h('option', { key: item[0], value: item[0] }, item[1]) }))),
          h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: createUser }, '创建'))),
        loading ? h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '加载中…') : null,
        users.map(function (user) {
          const active = user.active === 1 || user.active === true
          return h('div', { key: user.username, className: 'ad-row' },
            h('div', null,
              h('div', { className: 'ad-row-title' }, user.name || user.username),
              h('div', { className: 'ad-row-meta' }, user.username)),
            h('select', { value: user.role, onChange: function (e) { changeRole(user.username, e.target.value) }, style: inputStyle },
              roleOptions.map(function (item) { return h('option', { key: item[0], value: item[0] }, item[1]) })),
            h('span', null, h(Badge, { tone: active ? 'ok' : 'bad' }, active ? '启用' : '停用')),
            h('div', { style: { display: 'flex', gap: '4px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { toggleUserStatus(user) }, style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + (active ? '#b91c1c' : '#16a34a'), background: 'transparent', color: active ? '#b91c1c' : '#16a34a', fontSize: '11px', cursor: 'pointer' } }, active ? '停用' : '启用'),
            resetUser === user.username
              ? h('div', { style: { display: 'flex', gap: '4px' } },
                  h(ui.Input, { className: 'ad-plain', value: resetPassword, onChange: function (e) { setResetPassword(e.target.value) }, placeholder: '新密码', style: Object.assign({}, inputStyle, { width: '90px' }) }),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: submitReset, style: { padding: '6px 8px', borderRadius: '6px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '11px', cursor: 'pointer' } }, '保存'))
              : h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setResetUser(user.username); setResetPassword('') }, style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '重置密码')))
        }))
    }

    function SystemIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.92a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8.92a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1' }))
    }

    function CommerceIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21zM9 8h6M9 12h6M9 16h4' }))
    }

    function formatBytes(value) {
      const number = Number(value || 0)
      if (number >= 1024 * 1024 * 1024) return (number / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
      if (number >= 1024 * 1024) return (number / (1024 * 1024)).toFixed(1) + ' MB'
      if (number >= 1024) return (number / 1024).toFixed(1) + ' KB'
      return number + ' B'
    }

    function SystemPage(props) {
      const auth = props.auth || {}
      const role = (auth.user && auth.user.role) || ''
      const isAdmin = role === 'kb-admin' || role === 'admin'
      const healthState = React.useState(null); const health = healthState[0]; const setHealth = healthState[1]
      const backupsState = React.useState([]); const backups = backupsState[0]; const setBackups = backupsState[1]
      const jobsState = React.useState([]); const jobs = jobsState[0]; const setJobs = jobsState[1]
      const restoreNameState = React.useState(''); const restoreName = restoreNameState[0]; const setRestoreName = restoreNameState[1]
      const loadingState = React.useState(false); const loading = loadingState[0]; const setLoading = loadingState[1]
      const messageState = React.useState(''); const message = messageState[0]; const setMessage = messageState[1]
      const errorState = React.useState(''); const error = errorState[0]; const setError = errorState[1]
      const settingsState = React.useState(null); const settings = settingsState[0]; const setSettings = settingsState[1]
      const drillEventsState = React.useState(null); const drillEvents = drillEventsState[0]; const setDrillEvents = drillEventsState[1]
      const pruneDaysState = React.useState(30); const pruneDays = pruneDaysState[0]; const setPruneDays = pruneDaysState[1]
      const deleteBackupState = React.useState(''); const deleteBackupName = deleteBackupState[0]; const setDeleteBackupName = deleteBackupState[1]
      const restoreSummaryState = React.useState(null); const restoreSummary = restoreSummaryState[0]; const setRestoreSummary = restoreSummaryState[1]
      const backupVerifyState = React.useState(''); const backupVerifyMessage = backupVerifyState[0]; const setBackupVerifyMessage = backupVerifyState[1]
      const kbSyncState = React.useState(null); const kbSync = kbSyncState[0]; const setKbSync = kbSyncState[1]
      const kbAdminState = React.useState(null); const kbAdmin = kbAdminState[0]; const setKbAdmin = kbAdminState[1]
      const auditEventsState = React.useState(null); const auditEvents = auditEventsState[0]; const setAuditEvents = auditEventsState[1]
      const auditEventsMsgState = React.useState(''); const auditEventsMsg = auditEventsMsgState[0]; const setAuditEventsMsg = auditEventsMsgState[1]
      React.useEffect(function () { loadKbSync(); loadAuditEvents() }, [])
      const kbSyncMsgState = React.useState(''); const kbSyncMsg = kbSyncMsgState[0]; const setKbSyncMsg = kbSyncMsgState[1]
      const sysEventState = React.useState(null); const sysEvent = sysEventState[0]; const setSysEvent = sysEventState[1]
      const sysEventsState = React.useState([]); const sysEvents = sysEventsState[0]; const setSysEvents = sysEventsState[1]
      const reportPushSettingsState = React.useState(null); const reportPushSettings = reportPushSettingsState[0]; const setReportPushSettings = reportPushSettingsState[1]
      const backupSettingsState = React.useState(null); const backupSettings = backupSettingsState[0]; const setBackupSettings = backupSettingsState[1]
      const settingsMessageState = React.useState(''); const settingsMessage = settingsMessageState[0]; const setSettingsMessage = settingsMessageState[1]

      function load() {
        setLoading(true); setError('')
        api('/audit/system/health').then(function (d) { setHealth(d) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setLoading(false) })
        api('/audit/jobs').then(function (d) { setJobs(d.items || []) }).catch(function () {})
        if (isAdmin) {
          api('/audit/system/backups').then(function (d) { setBackups(d.items || []) }).catch(function () {})
          api('/audit/system/settings').then(function (d) { setSettings(d.escalation || null); setBackupSettings(d.backup || null); setReportPushSettings(d.report_push || null); setKbSync(d.kb_sync ? { config: d.kb_sync } : null) }).catch(function () {})
        }
      }
      React.useEffect(function () { load() }, [isAdmin])

      function deleteBackup(name) {
        api('/audit/system/backup/delete', null, { method: 'POST', body: { name: name } })
          .then(function () { setMessage('已删除备份：' + name); setDeleteBackupName(''); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function loadDrillHistory() {
        if (drillEvents) { setDrillEvents(null); return }
        api('/audit/events', { item_type: 'drill', limit: 10 })
          .then(function (d) { setDrillEvents(d.events || []) })
          .catch(function () { setDrillEvents([]) })
      }
      function exportDrillHistory() {
        if (!drillEvents || !drillEvents.length) return
        const rows = [['演练名称', '结果', '操作人', '时间']]
        drillEvents.forEach(function (event) { rows.push([event.item_name || '', event.new_status || '', event.actor || '', event.created_at || '']) })
        const csv = '\ufeff' + rows.map(function (row) { return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = '恢复演练记录.csv'
        document.body.appendChild(anchor); anchor.click(); anchor.remove()
        URL.revokeObjectURL(url)
      }
      function exportOpsReport() {
        fetch(BASE + '/audit/system/report', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = 'auditdesk-运维报告.md'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function (e) { setError(String(e)) })
      }
      function pushOpsReport() {
        setMessage('正在推送运维报告…')
        api('/audit/system/report/push', null, { method: 'POST', body: {} })
          .then(function (d) {
            if (d.sent) setMessage('运维报告已推送（Webhook）')
            else if (d.attempts) setMessage('报告推送失败（已重试 ' + d.attempts + ' 次），请检查推送服务设置')
            else setMessage('报告推送服务尚未配置，本次报告未推送（请联系管理员）')
          })
          .catch(function (e) { setError(String(e)) })
      }
      function exportOpsReportPdf() {
        fetch(BASE + '/audit/system/report.pdf', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = 'AuditDesk运维报告.pdf'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function (e) { setError(String(e)) })
      }
      function showSystemEvents(type) {
        if (sysEvent === type) { setSysEvent(null); return }
        setSysEvent(type)
        setSysEvents([])
        api('/audit/events', { item_type: type, limit: 30 })
          .then(function (d) { setSysEvents(d.events || []) })
          .catch(function () { setSysEvents([]) })
      }
      function loadKbSync() {
        api('/kb/admin/status').then(function (d) { setKbAdmin(d) }).catch(function () {})
        api('/kb/sync/status').then(function (d) { setKbSync(d) }).catch(function () {})
      }
      function loadAuditEvents() {
        fetch('/api/audit/events?since=0').then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          return resp.json()
        }).then(function (d) { setAuditEvents(d); setAuditEventsMsg('') })
          .catch(function () { setAuditEvents(null); setAuditEventsMsg('AI 行为审计插件未启用') })
      }
      function exportAuditEvents() {
        if (!auditEvents) return
        const rows = [['时间', '事件', '模式', '参数摘要']].concat((auditEvents.recent || []).map(function (rec) {
          return [new Date(rec.at).toISOString(), rec.event || '', rec.mode || '', JSON.stringify(rec.args || []).slice(0, 500)]
        }))
        const csv = rows.map(function (row) { return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob); const a = document.createElement('a')
        a.href = url; a.download = 'AI行为审计_' + new Date().toISOString().slice(0, 10) + '.csv'
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      }
      function runKbSync() {
        setKbSyncMsg('已开始检查，可能需要几分钟…')
        api('/kb/sync/run', null, { method: 'POST', body: {} })
          .then(function (d) { setKbSyncMsg(d.started ? '已开始后台检查，稍后刷新查看结果' : (d.reason || '未启动')); loadKbSync() })
          .catch(function (e) { setKbSyncMsg('检查失败：' + String(e)) })
      }
      function runEscalationNow() {
        api('/audit/approvals/escalate', null, { method: 'POST', body: { days: 2 } })
          .then(function (d) { setMessage(d.escalated ? ('已升级 ' + d.escalated + ' 项超期审批') : ('超期 ' + (d.overdue || 0) + ' 项（今日已提醒）')); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function drillBackup() {
        setMessage('正在执行恢复演练…')
        api('/audit/system/backup/drill', null, { method: 'POST', body: {} })
          .then(function (d) { setMessage(d.ok ? ('恢复演练通过：' + d.tables + ' 张表 / ' + d.projects + ' 个项目 / ' + d.users + ' 用户（' + d.name + '）') : ('恢复演练失败：' + (d.integrity || ''))); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function pruneBackups(days) {
        const body = days ? { days: days } : {}
        api('/audit/system/backup/prune', null, { method: 'POST', body: body })
          .then(function (d) {
            setMessage(d.deleted ? ('已清理 ' + d.deleted + ' 份旧备份' + (days ? '（早于 ' + days + ' 天）' : '')) : (days ? ('没有早于 ' + days + ' 天的备份') : '无需清理（未超过保留份数）'))
            load()
          })
          .catch(function (e) { setError(String(e)) })
      }
      function openRestore(item) {
        setRestoreSummary(null)
        setRestoreName(item.filename)
        api('/audit/system/backup/verify', null, { method: 'POST', body: { name: item.filename } })
          .then(function (d) { setRestoreSummary(d) })
          .catch(function () { setRestoreSummary({ ok: false, integrity: '校验失败', tables: 0, projects: 0, size: 0, name: item.filename }) })
      }
      function verifyBackup(name) {
        setBackupVerifyMessage('正在校验 ' + name + '…')
        api('/audit/system/backup/verify', null, { method: 'POST', body: { name: name } })
          .then(function (d) {
            setBackupVerifyMessage(d.ok ? ('校验通过：' + d.name + '（' + d.tables + ' 张表 / ' + d.projects + ' 个项目 / ' + formatBytes(d.size) + '）') : ('校验失败：' + d.name + '（' + d.integrity + '）'))
          })
          .catch(function () { setBackupVerifyMessage('校验失败，请重试') })
      }
      function saveSettings(next, nextBackup, nextReportPush, nextKbSync) {
        api('/audit/system/settings', null, { method: 'POST', body: { escalation: next, backup: nextBackup, report_push: nextReportPush, kb_sync: nextKbSync } })
          .then(function (d) { setSettings(d.escalation || null); setBackupSettings(d.backup || null); setReportPushSettings(d.report_push || null); setKbSync(d.kb_sync ? { config: d.kb_sync } : null); setSettingsMessage('设置已保存') })
          .catch(function () { setSettingsMessage('保存失败') })
      }
      function checkAutoBackup(force) {
        setMessage('')
        api('/audit/system/auto-backup/check', null, { method: 'POST', body: { force: !!force } })
          .then(function (result) {
            if (result.created) setMessage('自动备份已创建：' + result.filename + '（' + formatBytes(result.size) + '）')
            else setMessage('未到期：最近备份 ' + result.last_backup + '，约 ' + Math.round((result.next_due_seconds || 0) / 60) + ' 分钟后再次检查')
            load()
          })
          .catch(function (e) { setError(String(e)) })
      }
      function createBackup() {
        setMessage('')
        api('/audit/system/backup', null, { method: 'POST', body: {} })
          .then(function (d) { setMessage('已创建备份：' + d.filename + '（' + formatBytes(d.size) + '）'); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function restoreBackup(name) {
        api('/audit/system/restore', null, { method: 'POST', body: { name: name, confirm: true } })
          .then(function (result) { setMessage('已从 ' + result.restored + ' 恢复（安全备份：' + result.safety_backup + '）。请刷新页面或重新登录，其他页面才会读到新数据。'); setRestoreName(''); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function cancelJob(job) {
        api('/audit/jobs/cancel', null, { method: 'POST', body: { job_id: job.id } })
          .then(function () { setMessage('已请求取消任务 #' + job.id); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function retryJob(job) {
        api('/audit/jobs/retry', null, { method: 'POST', body: { job_id: job.id } })
          .then(function () { setMessage('已重新提交任务 #' + job.id); load() })
          .catch(function (e) { setError(String(e)) })
      }
      function downloadBackup(name) {
        fetch(BASE + '/audit/system/backup/download?name=' + encodeURIComponent(name), { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }).catch(function (e) { setError(String(e)) })
      }

      const card = function (title, value, hint) {
        return h('div', { className: 'ad-kpi' },
          h('div', { className: 'ad-kpi-label' }, title),
          h('div', { className: 'ad-kpi-value', style: { fontSize: '18px' } }, value),
          hint ? h('div', { className: 'ad-kpi-hint' }, hint) : null)
      }
      if (!health) {
        return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '8px' } }, '系统状态'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : (error || '暂无数据')),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: load, style: { marginTop: '10px', padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '刷新'))
      }
      const backupStatusText = (health.backup && health.backup.last_backup ? ('上次：' + (health.backup.last_backup_at || '-') + ' · 下次约 ' + Math.max(0, Math.ceil(((health.backup.next_due_seconds || 0) / 3600))) + ' 小时后 · 自动备份每 ' + (health.backup.interval_hours || 24) + ' 小时') : ('自动备份：每 ' + (((health.backup || {}).interval_hours) || 24) + ' 小时检查一次')) + ' · 共 ' + backups.length + ' 份 · 总占用 ' + formatBytes(backups.reduce(function (sum, item) { return sum + (item.size || 0) }, 0)) + ' · 保留最近 ' + (((health.backup || {}).keep) || 10) + ' 份' + (health.last_drill ? (' · 最近演练：' + (String(health.last_drill.status || '').indexOf('PASS') === 0 ? '通过' : '异常') + '（' + (health.last_drill.at || '') + '）') : '')
      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '系统'),
            h('div', { className: 'ad-sub' }, '服务时间 ' + health.server_time + ' · 网关 mini4pro:8030')),
          h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: load }, loading ? '刷新中…' : '刷新'),
            isAdmin ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportOpsReport }, '运维报告') : null)),
        message ? h('div', { style: { fontSize: '12px', color: '#16a34a', marginBottom: '8px' } }, message) : null,
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, error) : null,
        h('div', { className: 'ad-kpis' },
          card('项目数', health.projects),
          card('启用用户', health.active_users),
          card('已生成文件', health.generated_files + ' 个', formatBytes(health.generated_bytes)),
          card('今日操作', health.events_today + ' 条', '最近：' + (health.last_event_at || '-'))),
        h('div', { className: 'ad-kpis' },
          card('数据库大小', formatBytes(health.database_bytes)),
          card('生成目录', formatBytes(health.generated_root_bytes)),
          card('上传目录', formatBytes(health.uploads_root_bytes)),
          card('磁盘使用', health.disk_used_percent + '%', '剩余 ' + formatBytes(health.disk_free) + ' / 共 ' + formatBytes(health.disk_total))),
        isAdmin ? h('div', { className: 'ad-card' },
          h('div', { className: 'ad-row-title', style: { marginBottom: '4px' } }, '后台任务'),
          h('div', { className: 'ad-row' },
            h('div', null,
              h('div', { className: 'ad-row-title' }, '审批超期扫描'),
              h('div', { className: 'ad-row-meta' }, (health.escalation ? (health.escalation.auto ? '已启用' : '已关闭') + ' · 每 ' + health.escalation.interval_hours + ' 小时' : '未配置') + ' · 最近 ' + ((health.escalation && health.escalation.last_run) || '待运行'))),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: runEscalationNow }, '立即扫描')),
          h('div', { className: 'ad-row' },
            h('div', null,
              h('div', { className: 'ad-row-title' }, '运维报告推送'),
              h('div', { className: 'ad-row-meta' }, (health.report_push ? (health.report_push.auto ? '已启用' : '已关闭') + ' · 每日 ' + health.report_push.hour + ':00' : '未配置') + ' · 最近 ' + ((health.report_push && health.report_push.last_at) || '待运行'))),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: pushOpsReport }, '立即推送')),
          h('div', { className: 'ad-row' },
            h('div', null,
              h('div', { className: 'ad-row-title' }, '自动备份'),
              h('div', { className: 'ad-row-meta' }, (health.backup ? (health.backup.auto ? '已启用' : '已关闭') + ' · 每 ' + health.backup.interval_hours + ' 小时' : '未配置') + ' · 最近 ' + ((health.backup && health.backup.last_backup_at) || '无'))),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: drillBackup }, '恢复演练'))) : null,
        isAdmin ? h('div', { className: 'ad-card' },
          h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
            h('div', { className: 'ad-row-title' }, '知识库定时更新'),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: loadKbSync }, '刷新'),
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: runKbSync, disabled: kbSync && kbSync.state && kbSync.state.running }, kbSync && kbSync.state && kbSync.state.running ? '检查中…' : '立即检查'))),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, lineHeight: 1.8 } },
            '自动检查：' + (kbSync && kbSync.config && kbSync.config.auto ? ('每日 ' + kbSync.config.hour + ':00') : '已关闭')
            + ' · 最近：' + ((kbSync && kbSync.last && kbSync.last.at) || '尚未运行')
            + ' · 新增 ' + ((kbSync && kbSync.last && kbSync.last.added) || 0) + ' 篇'
            + ' · 待审 ' + ((kbSync && (kbSync.pending_now ?? (kbSync.last && kbSync.last.pending))) || 0) + ' 篇'),
          kbAdmin ? h('div', { style: { fontSize: '12px', color: COLORS.muted, lineHeight: 1.8, marginTop: '2px' } },
            '已发布 ' + (((kbAdmin.counts || {}).approved) || 0) + ' · 待审 ' + (((kbAdmin.counts || {}).pending) || 0)
            + ' · 过期 ' + (((kbAdmin.counts || {}).expired) || 0) + ' · 索引 ' + (kbAdmin.chunks || 0) + ' 块'
            + (kbAdmin.last_reviewed ? ' · 最近发布：' + kbAdmin.last_reviewed.title + '（' + kbAdmin.last_reviewed.at + '）' : '')
            + ((kbAdmin.apply && kbAdmin.apply.running) ? ' · 正在发布/重建索引…' : '')
            + ((kbAdmin.apply && kbAdmin.apply.error) ? ' · 上次审批异常：' + kbAdmin.apply.error : '')) : null,
          kbSync && kbSync.state && kbSync.state.results && kbSync.state.results.length ? h('div', { style: { marginTop: '6px', fontSize: '11px', color: COLORS.muted } },
            kbSync.state.results.map(function (r, i) { return h('div', { key: 'kbs-' + i }, '· ' + r.source + '：' + (r.ok ? '成功' : '失败') + '（新增 ' + (r.added || 0) + '，' + (r.elapsed || 0) + 's）') })) : null,
          kbSyncMsg ? h('div', { style: { marginTop: '6px', fontSize: '11px', color: '#b45309' } }, kbSyncMsg) : null) : null,
        isAdmin ? h('div', { className: 'ad-card' },
          h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
            h('div', { className: 'ad-row-title' }, 'AI 行为审计'),
            h('div', { className: 'ad-actions' },
              auditEvents ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: exportAuditEvents }, '导出') : null,
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: loadAuditEvents }, '刷新'))),
          auditEventsMsg ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, auditEventsMsg) : null,
          auditEvents ? (function () {
            const counts = auditEvents.counts || {}
            const total = Object.keys(counts).reduce(function (sum, key) { return sum + (counts[key] || 0) }, 0)
            const toolCount = Object.keys(counts).filter(function (key) { return key.indexOf('tools/') === 0 || key.indexOf('tool') >= 0 }).reduce(function (sum, key) { return sum + counts[key] }, 0)
            const agentCount = Object.keys(counts).filter(function (key) { return key.indexOf('agent/') === 0 || key.indexOf('subagent') >= 0 }).reduce(function (sum, key) { return sum + counts[key] }, 0)
            const recent = (auditEvents.recent || []).slice(-10).reverse()
            return h('div', { style: { fontSize: '12px', color: COLORS.muted, lineHeight: 1.8 } },
              '累计事件 ' + total + ' · 工具调用 ' + toolCount + ' · Agent/子代理 ' + agentCount + ' · 当前缓冲 ' + (auditEvents.recent || []).length + ' 条',
              recent.length ? h('div', { style: { marginTop: '4px', maxHeight: '150px', overflow: 'auto' } }, recent.map(function (rec, i) {
                return h('div', { key: 'ae-' + i, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '1px 0' } },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (rec.event || '') + ' · ' + String(JSON.stringify(rec.args || [])).slice(0, 80)),
                  h('span', { style: { color: COLORS.muted } }, new Date(rec.at).toLocaleTimeString()))
              })) : h('div', null, '暂无事件（运行一次对话/底稿生成后自动积累）'))
          })() : null) : null,
        isAdmin ? h('div', { style: { marginBottom: '12px', padding: '10px 14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', alignItems: 'center' } },
          h('span', { style: { fontWeight: 600 } }, '系统操作统计'),
          [['backup', '备份'], ['drill', '演练'], ['alert', '告警'], ['archive', '归档'], ['report_push', '报告推送']].map(function (pair) {
            const active = sysEvent === pair[0]
            return h('span', { key: 'syscount-' + pair[0], title: '点击查看明细', onClick: function () { showSystemEvents(pair[0]) },
              style: { padding: '2px 8px', borderRadius: '10px', border: '1px solid ' + (active ? COLORS.accent : COLORS.line), color: active ? COLORS.accent : COLORS.muted, cursor: 'pointer' } },
              pair[1] + ' ' + (((health.system_event_counts || {})[pair[0]]) || 0))
          }),
          sysEvent ? h('div', { style: { width: '100%', marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed ' + COLORS.line, fontSize: '11px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' } },
              h('div', { style: { fontWeight: 600 } }, '最近明细（' + sysEvents.length + '）'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () {
                try { localStorage.setItem('auditdesk.events.type', sysEvent || '') } catch (e) {}
                try { localStorage.setItem('auditdesk.settings.tab', 'events') } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('auditdesk:goto-settings-tab', { detail: 'events' })) } catch (e) {}
                try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel('audit-settings') } catch (e) {}
              }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '查看全部（操作留痕）')),
            sysEvents.length ? sysEvents.slice(0, 10).map(function (event) {
              return h('div', { key: 'se-' + event.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '2px 0' } },
                h('span', null, (event.item_name || '') + ' · ' + (event.new_status || '') + ' · ' + (event.actor || '')),
                h('span', { style: { color: COLORS.muted } }, event.created_at))
            }) : h('div', { style: { color: COLORS.muted } }, '加载中…或者暂无记录')) : null) : null,
        isAdmin && settings ? h('details', { className: 'ad-card' },
          h('summary', { className: 'ad-row-title' }, '定时设置'),
          h('div', { className: 'ad-row-meta', style: { margin: '8px 0' } }, '扫描、备份、推送和知识库检查一起保存。'),
          h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!settings.auto, onChange: function (e) { setSettings(Object.assign({}, settings, { auto: e.target.checked })) } }), '启用自动扫描'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '超期天数',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, value: settings.days || 2, onChange: function (e) { setSettings(Object.assign({}, settings, { days: Number(e.target.value) || 2 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '扫描间隔（小时）',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, value: settings.interval_hours || 6, onChange: function (e) { setSettings(Object.assign({}, settings, { interval_hours: Number(e.target.value) || 6 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '去重（小时）',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, value: settings.dedupe_hours || 24, onChange: function (e) { setSettings(Object.assign({}, settings, { dedupe_hours: Number(e.target.value) || 24 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { saveSettings(settings, backupSettings, reportPushSettings, (kbSync && kbSync.config) || kbSync) } }, '保存全部设置'),
            settingsMessage ? h('span', { style: { color: '#16a34a' } }, settingsMessage) : null),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '数据库自动备份'),
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!backupSettings.auto, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { auto: e.target.checked })) } }), '启用自动备份') : null,
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '保留份数',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, value: backupSettings.keep || 10, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { keep: Number(e.target.value) || 10 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })) : null,
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '备份间隔（小时）',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, value: backupSettings.interval_hours || 24, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { interval_hours: Number(e.target.value) || 24 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })) : null),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '运维报告推送'),
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!reportPushSettings.auto, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { auto: e.target.checked })) } }), '每日自动推送') : null,
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '推送时间',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 0, max: 23, value: reportPushSettings.hour || 8, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { hour: Number(e.target.value) || 0 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '点') : null,
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '失败重试',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 1, max: 10, value: reportPushSettings.retries || 3, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { retries: Number(e.target.value) || 3 })) }, style: { width: '54px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '次') : null),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '知识库定时更新'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!((kbSync && kbSync.config) || {}).auto,
                onChange: function (e) { const cfg = Object.assign({}, (kbSync && kbSync.config) || {}, { auto: e.target.checked }); setKbSync(Object.assign({}, kbSync || {}, { config: cfg })) } }), '每日自动检查'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '检查时间',
              h(ui.Input, { className: 'ad-plain', type: 'number', min: 0, max: 23, value: ((kbSync && kbSync.config) || {}).hour || 6, onChange: function (e) { const cfg = Object.assign({}, (kbSync && kbSync.config) || {}, { hour: Number(e.target.value) || 0 }); setKbSync(Object.assign({}, kbSync || {}, { config: cfg })) }, style: { width: '60px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '点'))) : null,
        isAdmin ? h('div', { className: 'ad-card' },
          h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
            h('div', null,
              h('div', { className: 'ad-row-title' }, '数据库备份'),
              h('div', { className: 'ad-row-meta' }, '保留最近 ' + (((health.backup || {}).keep) || 10) + ' 份')),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'primary', size: 'sm', onClick: createBackup }, '立即备份'))),
          h('details', { className: 'ad-more' },
            h('summary', null, '检查、演练与清理'),
            h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { checkAutoBackup(false) } }, '检查自动备份'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: drillBackup }, '恢复演练'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: loadDrillHistory }, drillEvents ? '收起演练记录' : '演练记录'),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { pruneBackups(0) } }, '清理旧备份'),
              h('label', { className: 'ad-row-meta' }, '清理早于 ', h(ui.Input, { className: 'ad-iw', type: 'number', min: 1, value: pruneDays, onChange: function (e) { setPruneDays(Number(e.target.value) || 30) }, style: { width: '64px', display: 'inline-block' } }), ' 天'),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { pruneBackups(pruneDays) } }, '按天数清理'))),
          backupVerifyMessage ? h('div', { style: { fontSize: '12px', marginBottom: '6px', color: backupVerifyMessage.indexOf('通过') >= 0 ? '#16a34a' : '#b45309' } }, backupVerifyMessage) : null,
          drillEvents ? h('div', { style: { marginBottom: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(127,127,127,0.06)', fontSize: '11px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
              h('div', { style: { fontWeight: 600 } }, '最近恢复演练记录（' + drillEvents.length + '）'),
              drillEvents.length ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportDrillHistory, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '导出 CSV') : null),
            drillEvents.length ? drillEvents.map(function (event) {
              return h('div', { key: 'drill-' + event.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '2px 0' } },
                h('span', null, (event.item_name || '') + ' · ' + (event.new_status || '') + ' · ' + (event.actor || '')),
                h('span', { style: { color: COLORS.muted } }, event.created_at))
            }) : h('div', { style: { color: COLORS.muted } }, '暂无演练记录')) : null,
          backups.length ? backups.map(function (item) {
            return h('div', { key: item.filename, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid ' + COLORS.line } },
              h('span', null, item.filename + ' · ' + formatBytes(item.size)),
              h('div', { style: { display: 'flex', gap: '10px' } },
                h('span', { style: { color: COLORS.muted } }, item.created_at),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { verifyBackup(item.filename) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '校验'),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { downloadBackup(item.filename) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载'),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { openRestore(item) }, style: { border: 0, background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '恢复'),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setDeleteBackupName(item.filename) }, style: { border: 0, background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '删除')))
          }) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '还没有备份'),
          deleteBackupName ? h('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(185,28,28,0.10)', fontSize: '12px', color: '#b91c1c' } },
            '确认删除备份 ' + deleteBackupName + '？删除后不可恢复。',
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { deleteBackup(deleteBackupName) }, style: { padding: '5px 10px', borderRadius: '6px', border: 0, background: '#b91c1c', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '确认删除'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setDeleteBackupName('') }, style: { padding: '5px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null,
          restoreName ? h('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(180,83,9,0.10)', fontSize: '12px', color: '#b45309' } },
            '确认用 ' + restoreName + ' 覆盖当前数据库？系统会先自动创建安全备份。',
            (health && (health.projects || health.active_users)) ? h('div', { style: { marginTop: '4px', fontSize: '11px', fontWeight: 600 } },
              '当前库：' + (health.projects || 0) + ' 个项目 / ' + (health.active_users || 0) + ' 个启用用户'
              + (restoreSummary && restoreSummary.projects !== undefined ? '　→　恢复后：' + restoreSummary.projects + ' 个项目' : '')) : null,
            restoreSummary ? h('div', { style: { marginTop: '6px', fontSize: '11px', lineHeight: 1.7 } }, '完整性：' + (restoreSummary.ok ? '通过' : '未通过（' + (restoreSummary.integrity || '') + '）') + ' · 表 ' + restoreSummary.tables + ' 张 · 项目 ' + restoreSummary.projects + ' 个 · ' + formatBytes(restoreSummary.size || 0)) : h('div', { style: { marginTop: '6px', fontSize: '11px', color: COLORS.muted } }, '正在校验备份完整性…'),
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { restoreBackup(restoreName) }, disabled: !restoreSummary || !restoreSummary.ok,
                style: { padding: '5px 10px', borderRadius: '6px', border: 0, background: '#b45309', color: '#fff', fontSize: '12px', cursor: 'pointer', opacity: (!restoreSummary || !restoreSummary.ok) ? 0.5 : 1 } }, '确认恢复'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setRestoreName(''); setRestoreSummary(null) }, style: { padding: '5px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null) : null,
        h('div', { className: 'ad-card' },
          h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
            h('div', { className: 'ad-row-title' }, '最近任务'),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: load }, '刷新')),
          jobs.length ? jobs.map(function (job) {
            return h('div', { key: 'job-' + job.id, className: 'ad-row' },
              h('div', { style: { minWidth: 0 } },
                h('div', { className: 'ad-row-title' }, (job.kind === 'generate_all' ? '批量生成底稿' : job.kind) + ' · ' + (job.progress || 0) + '/' + (job.total || 4)),
                h('div', { className: 'ad-row-meta' }, (job.project_id || '') + (job.message ? ' · ' + job.message : ''))),
              h('div', { className: 'ad-actions' },
                h(Badge, { tone: job.status === '已完成' ? 'ok' : job.status === '部分失败' ? 'bad' : job.status === '已取消' ? 'muted' : 'warn' }, job.status),
                (job.status === '部分失败' || job.status === '失败') ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { retryJob(job) } }, '重试') : null,
                (job.status === '排队中' || job.status === '执行中') ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { cancelJob(job) } }, '取消') : null))
          }) : h('div', { className: 'ad-row-meta' }, '暂无任务'))
        )
    }

    function DashboardIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }))
    }

    function RoleHomeCards(props) {
      const [home, setHome] = React.useState(null)
      // 各客户引擎资料齐套情况（本机接口）：缺哪份资料决定了“补资料”这张卡到底该催什么
      const [materials, setMaterials] = React.useState({})
      React.useEffect(function () {
        let cancelled = false
        api('/audit/home').then(function (d) { if (!cancelled) setHome(d) }).catch(function () {})
        fetch('/api/audit-fill/companies')
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (cancelled) return
            const map = {}
            ;(d.companies || []).forEach(function (c) {
              const miss = []
              if (!c.tb) miss.push('余额表')
              if (!c.fs) miss.push('报表')
              if (!c.voucher) miss.push('序时账')
              if (miss.length) map[c.name] = miss
              if (c.client) map[c.client] = miss
            })
            setMaterials(map)
          })
          .catch(function () { if (!cancelled) setMaterials({}) })
        return function () { cancelled = true }
      }, [])
      if (!home || !home.cards || !home.cards.length) return null
      const tone = { high: { color: '#b91c1c', bg: 'rgba(185,28,28,0.07)', border: '#b91c1c' }, medium: { color: '#b45309', bg: 'rgba(180,83,9,0.07)', border: '#b45309' }, low: { color: '#6b7280', bg: 'transparent', border: COLORS.line } }
      // 卡片说“补资料”就落到资料清单，说“待我复核”就落到审批状态——不要统一跳概览再让用户找
      // key 必须与后端 _role_card 返回的 kind 完全一致；漏一个就会落到「概览」
      const ZONE_BY_KIND = {
        '补资料': '资料清单', '催资料': '资料清单',
        '生成底稿': '审计底稿', '推进底稿': '审计底稿', '进度风险': '审计底稿',
        '处理差异': '审计底稿', '关注错报': '审计底稿', '风险处理': '审计底稿', '推进流程': '审计底稿',
        '待我复核': '审批状态', '待审批': '审批状态',
        '报告复核': '报告', '待复核报告': '报告', '待签发': '报告',
        '跟进项目': '概览', '项目总览': '概览', '系统': '概览'
      }
      const openProject = function (c) {
        const zone = ZONE_BY_KIND[c.kind] || '概览'
        try { localStorage.setItem('auditdesk.lastContext', JSON.stringify({ company: c.client, project: c.project_id, zone: zone })) } catch (e) {}
        try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel('audit-companies') } catch (e) {}
      }
      return h('div', { style: { marginBottom: '12px' } },
        h('div', { style: { fontSize: '12px', fontWeight: 600, color: COLORS.muted, marginBottom: '6px' } }, '下一步该做什么 · ' + (home.greeting || '')),
        (home.todo && home.todo.length) ? h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } },
          home.todo.map(function (t) {
            return h('div', { key: 'todo-' + t.label, style: { flex: '1 1 140px', minWidth: '140px', padding: '10px 12px', borderRadius: '10px', border: '1px solid ' + COLORS.line, background: 'rgba(47,124,246,0.05)', textAlign: 'center' } },
              h('div', { style: { fontSize: '22px', fontWeight: 700, color: COLORS.accent } }, t.value),
              h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, t.label))
          })) : null,
        h('div', { className: 'ad-next' },
          home.cards.slice(0, 6).map(function (c) {
            const t = tone[c.priority] || tone.low
            return h('div', { key: 'hc-' + c.project_id, className: 'ad-next-card', onClick: function () { openProject(c) } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
                h(AStatus, { tone: c.priority === 'high' ? 'warn' : '' }, c.kind),
                h('span', { className: 'ad-row-meta' }, c.metric)),
              h('div', { className: 'ad-row-title' }, c.project),
              (function () {
                const missing = materials[c.client] || []
                // 知道缺哪份时，用「请客户补：序时账」替代泛泛的「上传余额表/报表/凭证」，一行说清
                if (c.kind === '补资料' && missing.length) {
                  return h('div', { style: { fontSize: '11.5px', color: '#b45309', fontWeight: 600, marginTop: '2px' } },
                    '请客户补：' + missing.join('、'))
                }
                return h('div', { className: 'ad-row-meta' }, c.action)
              })())
          })),
        home.cards.length > 6
          ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '6px' } },
              '另有 ' + (home.cards.length - 6) + ' 个进行中项目（按优先级已折叠），进「项目」查看全部 ' + home.cards.length + ' 个。')
          : null)
    }

    function DashboardPage(props) {
      const authUser = (props && props.auth && props.auth.user) || {}
      const role = authUser.role || 'auditor'
      const roleLabel = { auditor: '审计员', manager: '项目经理', partner: '合伙人', 'kb-admin': '管理员', admin: '管理员' }[role] || role
      const roleHome = {
        auditor: { hint: '今天先看我的项目与底稿进度，再处理资料清单待补项。', actions: [['进入项目', 'audit-companies'], ['知识库检索', 'audit-kb']] },
        manager: { hint: '优先处理「我的待办」中的审批，再复核底稿与报告。', actions: [['进入项目（审批）', 'audit-companies'], ['知识库', 'audit-kb']] },
        partner: { hint: '关注报告复核与定稿、重要性确认与归档。', actions: [['进入项目（报告）', 'audit-companies'], ['知识库', 'audit-kb']] },
        'kb-admin': { hint: '关注知识库更新审批、用户与备份，再进入项目抽查。', actions: [['系统状态', 'audit-system'], ['知识库（待审）', 'audit-kb']] },
        admin: { hint: '关注系统健康、备份与知识库更新，再进入项目抽查。', actions: [['系统状态', 'audit-system'], ['知识库（待审）', 'audit-kb']] },
      }[role] || { hint: '进入项目查看进度。', actions: [['进入项目', 'audit-companies']] }
      function goSettingsTab(tabId) {
        try { localStorage.setItem('auditdesk.settings.tab', tabId) } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('auditdesk:goto-settings-tab', { detail: tabId })) } catch (e) {}
        goPanel('audit-settings')
      }
      function goPanel(panelId) {
        // 隐藏面板无侧栏入口，统一路由到「设置」对应页签，保证有返回路径
        if (panelId === 'audit-system') { goSettingsTab('system'); return }
        if (panelId === 'audit-guide') { goSettingsTab('guide'); return }
        if (panelId === 'audit-events') { goSettingsTab('events'); return }
        try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel(panelId) } catch (e) {}
      }
      function openProject(item) {
        try { localStorage.setItem('auditdesk.lastContext', JSON.stringify({ company: item.client, project: item.id, zone: '概览' })) } catch (e) {}
        goPanel('audit-companies')
      }
      const pendingState = React.useState(0); const pendingTotal = pendingState[0]; const setPendingTotal = pendingState[1]
      React.useEffect(function () {
        api('/audit/approvals/pending-counts').then(function (d) { setPendingTotal((d && d.total) || 0) }).catch(function () {})
      }, [])
      const state = React.useState(null); const dashboard = state[0]; const setDashboard = state[1]
      const loadingState = React.useState(false); const loading = loadingState[0]; const setLoading = loadingState[1]
      const errorState = React.useState(''); const error = errorState[0]; const setError = errorState[1]
      const keywordState = React.useState(''); const keyword = keywordState[0]; const setKeyword = keywordState[1]
      const statusState = React.useState(''); const statusFilter = statusState[0]; const setStatusFilter = statusState[1]
      const sortState = React.useState('updated'); const sortBy = sortState[0]; const setSortBy = sortState[1]
      const guideState = React.useState(function () { try { return localStorage.getItem('auditdesk.guide.dismissed') !== '1' } catch (e) { return true } })
      const showGuide = guideState[0]; const setShowGuide = guideState[1]
      function dismissGuide() { try { localStorage.setItem('auditdesk.guide.dismissed', '1') } catch (e) {}; setShowGuide(false) }

      function exportDashboard() {
        fetch(BASE + '/audit/dashboard/export', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '项目看板.xlsx'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function exportDashboardPdf() {
        fetch(BASE + '/audit/dashboard/pdf', { headers: { 'X-KB-Token': currentToken() } })
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = '项目看板.pdf'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
      }
      function load() {
        setLoading(true); setError('')
        api('/audit/dashboard').then(function (d) { setDashboard(d) })
          .catch(function (e) { setError(String(e)) })
          .then(function () { setLoading(false) })
      }
      React.useEffect(function () { load() }, [])

      if (!dashboard) {
        return h('div', { style: { padding: '18px' } },
          h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '8px' } }, '今日'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : (error || '暂无数据')),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: load, style: { marginTop: '10px', padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '刷新'))
      }
      const card = function (title, value, hint) {
        return h('div', { className: 'ad-kpi' },
          h('div', { className: 'ad-kpi-label' }, title),
          h('div', { className: 'ad-kpi-value' }, value),
          hint ? h('div', { className: 'ad-kpi-hint' }, hint) : null)
      }
      const search = keyword.trim().toLowerCase()
      const rows = (dashboard.items || [])
        .filter(function (item) {
          if (statusFilter && item.status !== statusFilter) return false
          if (!search) return true
          return (item.name + ' ' + item.client).toLowerCase().indexOf(search) >= 0
        })
        .slice()
      if (sortBy === 'updated') rows.sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) })
      else if (sortBy === 'name') rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh') })
      else if (sortBy === 'pbc') rows.sort(function (a, b) { return (a.pbc_percent || 0) - (b.pbc_percent || 0) })
      else if (sortBy === 'pending') rows.sort(function (a, b) { return (b.approval_pending || 0) - (a.approval_pending || 0) })
      return h('div', { className: 'ad-page' }, h('div', { className: 'ad-page-inner' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '今日'),
            h('div', { className: 'ad-sub' }, roleLabel + ' · ' + roleHome.hint)),
          h('div', { className: 'ad-actions' },
            roleHome.actions.slice(0, 1).map(function (pair) {
              return h(ui.Button, { variant: 'outline', size: 'sm', key: 'rh-' + pair[1], className: 'ad-btn primary', onClick: function () { goPanel(pair[1]) } }, pair[0])
            }),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: load }, loading ? '刷新中…' : '刷新'),
            h('details', { className: 'ad-more', style: { margin: 0 } },
              h('summary', null, '导出'),
              h('div', { className: 'ad-actions' },
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportDashboard }, 'Excel'),
                h(ui.Button, { variant: 'outline', size: 'sm', onClick: exportDashboardPdf }, 'PDF'))))),
        error ? h('div', { className: 'ad-note', style: { color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
        pendingTotal > 0 ? h('div', { className: 'ad-note' }, '当前待审批 ' + pendingTotal + ' 项。先处理审批，再进项目。') : null,
        h(RoleHomeCards, { ui: props.ui }),
        dashboard.count === 0 ? h('div', { style: { marginBottom: '14px', padding: '16px 18px', borderRadius: '12px', border: '1px solid ' + COLORS.accent, background: 'rgba(47,124,246,0.06)' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '三步开始第一次审计'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '10px' } }, '不需要记流程，按顺序点即可：'),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            [['1  新建项目', 'audit-companies'], ['2  导入科目余额表 / 账表', 'audit-companies'], ['3  生成第一份底稿', 'audit-companies']].map(function (pair) {
              return h(ui.Button, { variant: 'outline', size: 'sm', key: 'onb-' + pair[0], onClick: function () { goPanel(pair[1]) },
                style: { padding: '9px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, pair[0])
            }),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { goPanel('audit-guide') }, style: { padding: '9px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '查看使用指南'))) : null,
        h('div', { className: 'ad-kpis' },
          card('项目数', dashboard.count),
          card('进行中', dashboard.active),
          card('已归档', dashboard.archived),
          card('待审批', dashboard.approval_pending)),
        h('div', { className: 'ad-toolbar', style: { marginBottom: '12px' } },
          h(ui.Input, { className: 'ad-iw', style: { width: '220px' }, value: keyword, onChange: function (e) { setKeyword(e.target.value) }, placeholder: '搜索客户或项目' }),
          h('select', { className: 'ad-input', style: { width: 'auto' }, value: statusFilter, onChange: function (e) { setStatusFilter(e.target.value) } },
            h('option', { value: '' }, '全部状态'),
            h('option', { value: '进行中' }, '进行中'),
            h('option', { value: '已归档' }, '已归档')),
          h('select', { className: 'ad-input', style: { width: 'auto' }, value: sortBy, onChange: function (e) { setSortBy(e.target.value) } },
            h('option', { value: 'updated' }, '按更新时间'),
            h('option', { value: 'name' }, '按项目名称'),
            h('option', { value: 'pbc' }, '按资料完成率'),
            h('option', { value: 'pending' }, '按待审批')),
          h('span', { className: 'ad-row-meta' }, rows.length + ' 个项目')),
        h('div', { className: 'ad-card' },
          rows.map(function (item) {
            return h('div', { key: item.id, className: 'ad-row', style: { cursor: 'pointer' }, onClick: function () { openProject(item) } },
              h('div', { style: { minWidth: 0 } },
                h('div', { className: 'ad-row-title' }, item.name, (item.data_source === 'test') ? h(AStatus, { tone: 'warn', className: 'ad-ml6' }, '测试') : null),
                h('div', { className: 'ad-row-meta' }, item.client + ' · ' + (item.period || '-') + ' · 资料 ' + item.pbc_percent + '% · 底稿 ' + item.wp_percent + '% · 程序 ' + (item.program_percent || 0) + '%' + (item.approval_pending ? ' · 待审批 ' + item.approval_pending : ''))),
              h(Badge, { tone: item.status === '已归档' ? 'muted' : 'ok' }, item.status))
          }))))
    }

    const CLIENT_VERSION = '0.1.0'
    const RELEASE_URL = 'https://github.com/miaowei1985-david/auditdesk-dsh/releases'

    function AboutPage() {
      const healthState = React.useState(null); const health = healthState[0]; const setHealth = healthState[1]
      const errorState = React.useState(''); const error = errorState[0]; const setError = errorState[1]
      React.useEffect(function () {
        api('/audit/system/health').then(function (d) { setHealth(d) }).catch(function (e) { setError(String(e)) })
      }, [])
      const bootRelease = (typeof window !== 'undefined' && window.__DSH_BOOT__ && window.__DSH_BOOT__.release) || {}
      const runtimeVersion = bootRelease.version ? ('DeepSeek Harness ' + bootRelease.version + (bootRelease.commit ? '（' + bootRelease.commit + '）' : '')) : '未知'
      const row = function (label, value) {
        return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
          h('span', { style: { color: COLORS.muted } }, label), h('span', null, String(value)))
      }
      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '10px' } }, '关于 AuditDesk'),
        h('div', { style: { padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, marginBottom: '12px' } },
          row('客户端版本', CLIENT_VERSION + '（审计工作台插件）'),
          row('运行时版本', runtimeVersion),
          row('网关地址', BASE),
          row('服务状态', health ? '正常' : (error || '检测中…')),
          health ? row('服务端版本', health.server_version || '-') : null,
          health ? row('服务端构建', health.server_build || '-') : null,
          (health && health.escalation) ? row('审批超期自动扫描', (health.escalation.auto ? '已启用' : '已关闭') + ' · 每 ' + (health.escalation.interval_hours || 6) + ' 小时 · 超期 ≥' + (health.escalation.days || 2) + ' 天' + (health.escalation.last_run ? ' · 最近 ' + health.escalation.last_run : '')) : null,
          health ? row('服务时间', health.server_time || '-') : null,
          health ? row('项目数 / 启用用户', (health.projects || 0) + ' / ' + (health.active_users || 0)) : null,
          health ? row('已生成文件', (health.generated_files || 0) + ' 个 / ' + formatBytes(health.generated_bytes || 0)) : null,
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
            h('span', { style: { color: COLORS.muted } }, '最新安装包'),
            h('a', { href: RELEASE_URL, target: '_blank', rel: 'noreferrer', style: { color: COLORS.accent } }, 'Windows / macOS 构建（GitHub Releases）'))),
        h('div', { style: { padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, marginBottom: '12px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '已启用模块'),
          h('div', { style: { fontSize: '12px', lineHeight: 1.9, color: COLORS.muted } },
            '今日 · 项目 · 商务（客户/合同/发票）· 知识库 · 设置（留痕/用户/程序库/映射规则/底稿引擎/系统/指南，按角色显示）')),
        h('div', { style: { padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '升级方式'),
          h('div', { style: { fontSize: '12px', lineHeight: 1.9, color: COLORS.muted } },
            '当前构建未启用自动更新（unsigned）。升级请下载最新安装包手动安装；安装完成后桌面/开始菜单会有「安装审计插件」快捷方式（如首次安装）。'),
          error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginTop: '8px' } }, '服务连接失败：' + error) : null))
    }

    function AboutIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 10.5v6M12 7.2v.2' }))
    }

    function GuideIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M12 6.5A3.5 3.5 0 0 0 8.5 3H3v15h6a3 3 0 0 1 3 3V6.5zM12 6.5A3.5 3.5 0 0 1 15.5 3H21v15h-6a3 3 0 0 0-3 3V6.5z' }))
    }

    // ---------- 审计程序库（底库模板管理） ----------
    function ProgramCatalogPage(props) {
      const auth = props.auth || {}
      const role = (auth.user && auth.user.role) || ''
      const canEdit = ['partner', 'kb-admin', 'admin'].indexOf(role) >= 0
      const SOURCE_STYLE = {
        账载: { color: '#2f7cf6', hint: '导科目余额表/序时账' },
        外部: { color: '#b45309', hint: '收资料/发函' },
        现场: { color: '#7c3aed', hint: '监盘/盘点' },
        程序: { color: '#6b7280', hint: '执行/判断' },
      }
      const TYPES = ['年报审计', '专项审计', '内控审计']
      const [businessType, setBusinessType] = React.useState('年报审计')
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState({ category: '', name: '', source: '程序' })

      function load(type) {
        const target = type || businessType
        setLoading(true); setErr('')
        api('/audit/program-catalog', { business_type: target })
          .then(function (d) { setItems(d.items || []) })
          .catch(function (e) { setErr(String(e)) })
          .then(function () { setLoading(false) })
      }
      React.useEffect(function () { load(businessType) }, [businessType])

      function sourceBadge(source) {
        const meta = SOURCE_STYLE[source]
        if (!meta) return null
        return h('span', { title: meta.hint, style: { display: 'inline-block', marginLeft: '6px', padding: '0 6px', borderRadius: '6px', border: '1px solid ' + meta.color, color: meta.color, fontSize: '10px', lineHeight: '16px', whiteSpace: 'nowrap' } }, source)
      }
      function startEdit(item) {
        if (!canEdit) return
        setEditing(item.id)
        setDraft({ category: item.category || '', name: item.name || '', source: item.source || '程序' })
        setMsg('')
      }
      function cancelEdit() { setEditing(null); setDraft({ category: '', name: '', source: '程序' }) }
      function submitSave(id) {
        if (!canEdit) return
        if (!draft.name.trim()) { setErr('程序名称不能为空'); return }
        const body = { business_type: businessType, category: draft.category.trim() || '其他', name: draft.name.trim(), source: draft.source || '程序' }
        if (id) body.id = id
        api('/audit/program-catalog/save', null, { method: 'POST', body: body })
          .then(function () { setMsg(id ? '已保存修改' : '已新增程序'); cancelEdit(); load(businessType) })
          .catch(function (e) { setErr(String(e)) })
      }
      function stopItem(item) {
        if (!canEdit) return
        try { if (!window.confirm('停用「' + item.name + '」？停用后新项目不再包含该程序（已有项目不受影响）。')) return } catch (e) {}
        api('/audit/program-catalog/delete', null, { method: 'POST', body: { id: item.id } })
          .then(function () { setMsg('已停用：' + item.name); load(businessType) })
          .catch(function (e) { setErr(String(e)) })
      }
      function resetCatalog() {
        if (!canEdit) return
        try { if (!window.confirm('恢复「' + businessType + '」的内置默认程序库？当前自定义修改会被覆盖。')) return } catch (e) {}
        api('/audit/program-catalog/reset', null, { method: 'POST', body: { business_type: businessType } })
          .then(function () { setMsg('已恢复内置默认程序库'); load(businessType) })
          .catch(function (e) { setErr(String(e)) })
      }

      const groups = []
      const seen = {}
      items.forEach(function (item) {
        const category = item.category || '其他'
        if (!seen[category]) { seen[category] = true; groups.push(category) }
      })
      const inputStyle = { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' }
      const smallBtn = { padding: '4px 9px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' }

      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '程序库'),
            h('div', { className: 'ad-sub' }, '新项目按业务类型套用。改这里只影响之后新建或补全的项目。')),
          canEdit ? h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { setEditing('new'); setDraft({ category: '', name: '', source: '程序' }) } }, '新增程序'),
            h(ui.Button, { variant: 'ghost', size: 'sm', onClick: resetCatalog }, '恢复默认')) : null),
        h('div', { className: 'ad-toolbar', style: { marginBottom: '16px' } },
          h(ui.SegmentedTabs, {
            className: 'ad-tabs-fit',
            items: TYPES.map(function (type) { return { value: type, label: type, id: 'ptype-' + type, panelId: 'ptype-panel' } }),
            value: businessType,
            onChange: function (v) { setBusinessType(v); cancelEdit() },
            label: '业务类型',
            size: 'sm'
          }),
          h('span', { className: 'ad-row-meta' }, items.length + ' 项' + (loading ? ' · 加载中' : ''))),
        msg ? h('div', { className: 'ad-note' }, msg) : null,
        err ? h('div', { className: 'ad-note' }, err) : null,
        editing === 'new' ? h('div', { className: 'ad-form' },
          h('label', { className: 'ad-field' }, '分类', h(ui.Input, { className: 'ad-iw', value: draft.category, onChange: function (e) { setDraft(Object.assign({}, draft, { category: e.target.value })) }, placeholder: '如：货币资金' })),
          h('label', { className: 'ad-field' }, '程序名称', h(ui.Input, { className: 'ad-iw', value: draft.name, onChange: function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })) }, placeholder: '必填' })),
          h('label', { className: 'ad-field' }, '来源', h('select', { className: 'ad-input', value: draft.source, onChange: function (e) { setDraft(Object.assign({}, draft, { source: e.target.value })) } }, ['账载', '外部', '现场', '程序'].map(function (src) { return h('option', { key: 'new-src-' + src, value: src }, src) }))),
          h('div', { className: 'ad-form-actions' },
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { submitSave(0) } }, '添加'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: cancelEdit }, '取消'))) : null,
        groups.length ? groups.map(function (category) {
          const groupItems = items.filter(function (item) { return (item.category || '其他') === category })
          return h('div', { key: 'cat-' + category, style: { marginBottom: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0 4px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(47,124,246,0.06)', fontSize: '13px', fontWeight: 600 } },
              h('span', null, category),
              h('span', { style: { fontSize: '11px', color: COLORS.muted, fontWeight: 400 } }, groupItems.length + ' 项')),
            groupItems.map(function (item) {
              if (editing === item.id) {
                return h('div', { key: 'cat-item-' + item.id, style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line } },
                  h(ui.Input, { className: 'ad-plain', value: draft.category, onChange: function (e) { setDraft(Object.assign({}, draft, { category: e.target.value })) }, placeholder: '分类', style: Object.assign({}, inputStyle, { width: '150px' }) }),
                  h(ui.Input, { className: 'ad-plain', value: draft.name, onChange: function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })) }, placeholder: '程序名称', style: Object.assign({}, inputStyle, { flex: 1, minWidth: '180px' }) }),
                  h('select', { value: draft.source, onChange: function (e) { setDraft(Object.assign({}, draft, { source: e.target.value })) }, style: inputStyle },
                    ['账载', '外部', '现场', '程序'].map(function (src) { return h('option', { key: 'edit-src-' + src, value: src }, src) })),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { submitSave(item.id) }, style: Object.assign({}, smallBtn, { border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)' }) }, '保存'),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: cancelEdit, style: smallBtn }, '取消'))
              }
              return h('div', { key: 'cat-item-' + item.id, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: '8px', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('span', { style: { minWidth: 0 } }, item.name, sourceBadge(item.source)),
                canEdit ? h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { startEdit(item) }, style: smallBtn }, '编辑'),
                  h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { stopItem(item) }, style: Object.assign({}, smallBtn, { color: '#b91c1c', border: '1px solid #b91c1c' }) }, '停用')) : h('span', { style: { fontSize: '11px', color: COLORS.muted, textAlign: 'right' } }, ''))
            }))
        }) : h('div', { style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : '程序库为空，可「恢复默认」或新增程序'),
        h('div', { style: { marginTop: '10px', fontSize: '11px', color: COLORS.muted, lineHeight: 1.8 } },
          '说明：① 程序库修改只影响之后新建/补全的项目，已有项目清单不变；② 停用是逻辑删除，可随时「恢复默认」找回内置程序；③ 维护权限仅限合伙人/管理员。'))
    }

    function ReportOverviewPanel(props) {
      const [ov, setOv] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [err, setErr] = React.useState('')
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/report/overview', { project: props.projectId })
          .then(function (d) { if (!cancelled) setOv(d) })
          .catch(function (e) { if (!cancelled) setErr(String(e)) })
        api('/audit/opinion-draft', { project: props.projectId })
          .then(function (d) { if (!cancelled) setDraft(d) })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.projectId])
      if (err) return h('div', { style: { fontSize: '12px', color: '#b91c1c', padding: '6px 0' } }, '报告总览加载失败：' + err)
      if (!ov) return h('div', { style: { fontSize: '12px', color: COLORS.muted, padding: '6px 0' } }, '加载报告总览…')
      const op = ov.opinion || {}
      const level = op.level || ''
      const tone = level.indexOf('无法表示') >= 0 || level.indexOf('否定') >= 0 ? { color: '#b91c1c', bg: 'rgba(185,28,28,0.10)', border: '#b91c1c' }
        : level.indexOf('保留') >= 0 ? { color: '#b45309', bg: 'rgba(180,83,9,0.10)', border: '#b45309' }
        : { color: '#16a34a', bg: 'rgba(22,163,74,0.10)', border: '#16a34a' }
      const limits = op.limits || []
      const mat = ov.materiality
      const versions = ov.versions || []
      const latest = versions[0]
      const checklistRisk = (ov.checklist || []).filter(function (i) { return i.status === 'RISK' }).length
      const checklistTodo = (ov.checklist || []).filter(function (i) { return i.status === 'TODO' }).length
      const SEQ = ['草稿', '复核中', '已复核', '已定稿']
      const curIdx = latest ? Math.max(0, SEQ.indexOf(latest.status)) : -1
      return h('div', { style: { marginBottom: '14px', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + tone.border, background: tone.bg } },
        draft && draft.has_materiality ? h('div', { style: { marginBottom: '10px', padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'rgba(47,124,246,0.04)' } },
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' } },
            h('span', { style: { fontSize: '11px', color: COLORS.muted } }, '结论草稿'),
            h('span', { style: { fontSize: '14px', fontWeight: 700, color: COLORS.accent } }, draft.opinion),
            h('span', { style: { fontSize: '11px', color: COLORS.muted } }, draft.reason)),
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } },
            '依据：重要性 ' + draft.materiality.basis + '=' + draft.materiality.overall + (draft.materiality.confirmed ? '（已确认）' : '（推荐值，未确认）') + ' · 错报合计 ' + draft.misstatement_total + (draft.unquantified_diff > 0 ? ' · 未量化差异 ' + draft.unquantified_diff + ' 项' : '')),
          draft.notes && draft.notes.length ? h('div', { style: { marginTop: '4px' } }, draft.notes.map(function (n, ni) { return h('div', { key: 'dn-' + ni, style: { fontSize: '11px', color: '#b45309', padding: '1px 0' } }, '· ' + n) })) : null) : null,
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1 1 260px' } },
            h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '审计意见倾向'),
            h('div', { style: { fontSize: '20px', fontWeight: 700, color: tone.color, margin: '4px 0' } }, level || '未生成'),
            op.text ? h('div', { style: { fontSize: '12px', lineHeight: 1.7 } }, op.text) : null),
          h('div', { style: { flex: '1 1 200px', fontSize: '12px' } },
            h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, '限制事项（' + limits.length + '）'),
            limits.length ? limits.slice(0, 6).map(function (l) { return h('div', { key: 'lim-' + l, style: { padding: '2px 0', color: '#b45309' } }, '⚠ ' + l) }) : h('div', { style: { color: '#16a34a' } }, '无未解决限制事项')),
          h('div', { style: { flex: '1 1 180px', fontSize: '12px' } },
            h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, '重要性（万元）'),
            mat ? h('div', null,
              [['整体', mat.overall], ['执行', mat.performance], ['明显微小', mat.trivial]].map(function (p) {
                return h('div', { key: 'mat-' + p[0], style: { display: 'flex', justifyContent: 'space-between', padding: '1px 0' } }, h('span', { style: { color: COLORS.muted } }, p[0]), h('span', null, p[1] != null ? (p[1] / 10000).toFixed(2) : '—'))
              }),
              mat.confirmed_by ? h('div', { style: { marginTop: '4px', color: COLORS.muted, fontSize: '11px' } }, '确认人：' + mat.confirmed_by) : null) : h('div', { style: { color: COLORS.muted } }, '未确认'),
            h('div', { style: { fontSize: '12px', fontWeight: 600, margin: '8px 0 4px' } }, '检查清单'),
            h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '风险 ' + checklistRisk + ' · 待办 ' + checklistTodo))),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' } },
          h('span', { style: { fontSize: '11px', color: COLORS.muted } }, '版本：'),
          SEQ.map(function (s, i) {
            const reached = i <= curIdx
            const isLast = i === SEQ.length - 1
            return h('span', { key: 'vs-' + s, style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
              h('span', { style: { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', border: '1px solid ' + (reached ? tone.color : COLORS.line), background: reached ? tone.bg : 'transparent', color: reached ? tone.color : COLORS.muted } }, (reached ? '✓ ' : '○ ') + s),
              isLast ? null : h('span', { style: { color: reached ? tone.color : COLORS.muted } }, '→'))
          }),
          latest ? h('span', { style: { fontSize: '11px', color: COLORS.muted } }, '（最新：' + (latest.created_by || '') + ' · ' + (latest.created_at || '') + '）') : null))
    }

    function EvidencePanel(props) {
      const [ev, setEv] = React.useState(null)
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/evidence', { project: props.projectId })
          .then(function (d) { if (!cancelled) setEv(d) })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.projectId])
      if (!ev) return null
      const findings = ev.findings || []
      const mis = ev.misstatements || []
      const events = (ev.events || []).slice(0, 8)
      if (!findings.length && !mis.length) return null
      const kindTone = { formula_error: '#b91c1c', tb_mismatch: '#b45309', total_mismatch: '#b45309' }
      return h('div', { style: { marginBottom: '14px', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
        h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '证据溯源链'),
        mis.length ? h('div', { style: { marginBottom: '8px' } },
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '未更正错报（' + mis.length + '）'),
          mis.map(function (m) {
            return h('div', { key: 'm-' + m.id, style: { fontSize: '12px', padding: '4px 0', borderTop: '1px solid ' + COLORS.line, display: 'flex', justifyContent: 'space-between', gap: '10px' } },
              h('span', { style: { minWidth: 0 } }, m.description + (m.source ? '（' + m.source + '）' : '') + ' · ' + (m.amount || 0)),
              h('span', { style: { color: COLORS.muted, fontSize: '11px', flexShrink: 0 } }, (m.created_by || '') + ' ' + (m.created_at || '')))
          })) : null,
        findings.length ? h('div', { style: { marginBottom: '8px' } },
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '核对发现（' + findings.length + '）'),
          findings.slice(0, 12).map(function (f, i) {
            return h('div', { key: 'f-' + i, style: { fontSize: '11px', padding: '3px 0', borderTop: '1px solid ' + COLORS.line, display: 'flex', justifyContent: 'space-between', gap: '10px' } },
              h('span', { style: { minWidth: 0 } },
                h('span', { style: { fontWeight: 600, color: kindTone[f.kind] || COLORS.muted } }, f.kind + ' '),
                h('span', null, (f.sheet || '') + ' ' + (f.cell || '') + '：' + (f.message || '')),
                f.expected != null ? h('span', { style: { color: COLORS.muted } }, ' 期望 ' + f.expected + ' vs 实际 ' + f.actual) : null),
              h('span', { style: { color: COLORS.muted, flexShrink: 0 } }, (f.checked_by || '') + ' ' + String(f.checked_at || '').slice(0, 16)))
          })) : null,
        events.length ? h('div', null,
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '最近操作'),
          events.map(function (e, i) {
            return h('div', { key: 'e-' + i, style: { fontSize: '11px', padding: '2px 0', color: COLORS.muted } },
              String(e.created_at || '').slice(0, 16) + ' · ' + (e.actor || '') + ' · ' + (e.item_name || '') + ' → ' + (e.new_status || ''))
          })) : null)
    }

    function KamPanel(props) {
      const [kam, setKam] = React.useState(null)
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/kam', { project: props.projectId })
          .then(function (d) { if (!cancelled) setKam(d) })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.projectId])
      if (!kam || !kam.kam || !kam.kam.length) return null
      const tone = { high: { color: '#b91c1c', bg: 'rgba(185,28,28,0.07)', border: '#b91c1c' }, medium: { color: '#b45309', bg: 'rgba(180,83,9,0.07)', border: '#b45309' } }
      return h('div', { style: { marginBottom: '14px', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
        h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '关键审计事项（' + kam.count + '）'),
        kam.kam.map(function (k, i) {
          const t = tone[k.severity] || tone.medium
          return h('div', { key: 'kam-' + i, style: { padding: '10px 12px', marginBottom: '8px', borderRadius: '8px', border: '1px solid ' + t.border, background: t.bg } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
              h('span', { style: { fontSize: '13px', fontWeight: 700, color: t.color } }, (i + 1) + '. ' + k.title),
              h('span', { style: { fontSize: '11px', padding: '1px 8px', borderRadius: '9px', color: t.color } }, k.severity === 'high' ? '重大' : '关注')),
            h('div', { style: { fontSize: '12px' } }, k.detail),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, '依据：' + k.basis))
        }),
        h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '关键审计事项为 AI 推导，须审计师复核确认后进入报告。'))
    }

    function FlowPanel(props) {
      const [flow, setFlow] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [confirming, setConfirming] = React.useState(false)
      // 引擎勾稽差异数：流程后端只看「未更正错报」（人工记入），看不到引擎发现项，
      // 这里补一个数据源，避免「流程说差异处理完成、引擎却有 20 项差异」的矛盾
      const [engineDiff, setEngineDiff] = React.useState(0)
      React.useEffect(function () {
        if (!props.client) return
        let cancelled = false
        fetch('/api/audit-fill/company?name=' + encodeURIComponent(props.client))
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (cancelled || !d || !d.ok) return
            const bad = (d.lines || []).filter(function (l) {
              return l.diff !== 0 && l.diff !== null && l.diff !== undefined && !l.hint
            })
            setEngineDiff(bad.length)
          })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.client])
      function load() {
        api('/audit/project-flow', { project: props.projectId })
          .then(function (d) { setFlow(d) })
          .catch(function (e) { setErr(String(e)) })
      }
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/project-flow', { project: props.projectId })
          .then(function (d) { if (!cancelled) setFlow(d) })
          .catch(function (e) { if (!cancelled) setErr(String(e)) })
        return function () { cancelled = true }
      }, [props.projectId])
      function confirmStage() {
        if (!flow || !flow.can_confirm) return
        // 门禁只查角色和顺序，不查数据；若当前节点还有未齐/未做/不平的指标，先让人确认一次
        const cur = (flow.stages || []).filter(function (s) { return s.key === flow.current })[0]
        const warns = ((cur && cur.metrics) || []).filter(function (m) {
          const val = String(m.value || '').trim()
          // 值为 0 的一律不算问题（"待补 0" 是好状态，不是待办）
          if (val === '0' || val === '0 项' || val === '0 张') return false
          // 关键词可能在 label（"资料未齐"）也可能在 value（"不平 3"），两边都测；
          // 「0/32」这种进度为零的也要提示（一项没做就点确认，几乎肯定是误操作）
          const text = String(m.label || '') + val
          return /未齐|待补|未交|不平|未生成|待处理|未归档/.test(text) || /^0\//.test(val)
        })
        if (warns.length) {
          const msg = warns.map(function (m) { return m.label + ' ' + m.value }).join('，')
          try { if (!window.confirm('「' + (cur.label || flow.current) + '」仍有：' + msg + '。\n\n仍要确认完成并进入下一节点吗？')) return } catch (e) { return }
        }
        setConfirming(true); setErr('')
        api('/audit/flow/confirm', null, { method: 'POST', body: { project: props.projectId, stage: flow.current } })
          .then(function () { setConfirming(false); load() })
          .catch(function (e) { setConfirming(false); setErr(String(e)) })
      }
      if (err) return h('div', { style: { fontSize: '12px', color: '#b91c1c', padding: '6px 0' } }, '流程加载失败：' + err)
      if (!flow) return h('div', { style: { fontSize: '12px', color: COLORS.muted, padding: '6px 0' } }, '加载审计流程…')
      const META = { done: { color: '#16a34a', bg: 'rgba(22,163,74,0.12)', txt: '完成' }, current: { color: '#2f7cf6', bg: 'rgba(47,124,246,0.12)', txt: '进行中' }, pending: { color: '#9ca3af', bg: 'rgba(156,163,175,0.10)', txt: '待开始' } }
      const last = flow.stages.length - 1
      return h('div', { style: { marginBottom: '14px', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '10px', flexWrap: 'wrap' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '审计全流程'),
          h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '进度 ' + flow.progress + '% · 下一步：' + flow.next_action),
            (function () {
              const zone = ({ receive: '资料清单', fill: '审计底稿', tieout: '审计底稿', diff: '审计底稿', memo: '报告', review: '审批状态', archive: '概览' })[flow.current]
              if (!zone || !props.onJumpZone) return null
              return h(ui.Button, { variant: 'outline', size: 'sm', title: '直接去处理这一步',
                style: { padding: '2px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' },
                onClick: function () { props.onJumpZone(zone) } }, '去' + zone)
            })()),
          flow.can_confirm ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: confirmStage, disabled: confirming, style: { padding: '6px 14px', borderRadius: '8px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '12px', cursor: 'pointer' } }, confirming ? '确认中…' : '确认完成，进入下一节点') : null),
        h('div', { style: { height: '6px', borderRadius: '3px', background: 'rgba(127,127,127,0.18)', marginBottom: '16px', overflow: 'hidden' } },
          h('div', { style: { width: Math.max(4, flow.progress) + '%', height: '100%', borderRadius: '3px', background: flow.archived ? '#16a34a' : COLORS.accent, transition: 'width .5s ease' } })),
        h('div', { style: { display: 'flex' } },
          flow.stages.map(function (st, i) {
            const meta = META[st.status] || META.pending
            const done = st.status === 'done'
            const leftLine = i === 0 ? 'transparent' : (done ? '#16a34a' : 'rgba(127,127,127,0.2)')
            return h('div', { key: 'st-' + st.key, onClick: function () { if (props.onJumpZone) props.onJumpZone(({ receive: '资料清单', fill: '审计底稿', tieout: '审计底稿', diff: '审计底稿', memo: '报告', review: '审批状态', archive: '概览' })[st.key] || '概览') }, style: { flex: '1 1 0', minWidth: '62px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' } },
              h('div', { style: { display: 'flex', alignItems: 'center', width: '100%', marginBottom: '6px' } },
                h('div', { style: { flex: 1, height: '2px', background: leftLine } }),
                h('div', { style: { width: '28px', height: '28px', flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, border: '1px solid ' + meta.color, fontWeight: 700, fontSize: '13px', boxShadow: st.status === 'current' ? '0 0 0 4px rgba(47,124,246,0.18)' : 'none' } }, done ? '✓' : (i + 1)),
                h('div', { style: { flex: 1, height: '2px', background: i === last ? 'transparent' : (done ? '#16a34a' : 'rgba(127,127,127,0.2)') } })),
              h('div', { style: { fontSize: '11px', fontWeight: st.status === 'current' ? 700 : 600, color: st.status === 'pending' ? COLORS.muted : 'inherit' } }, st.label),
              h('div', { style: { fontSize: '9px', color: meta.color, marginTop: '2px' } }, meta.txt),
              (st.status === 'done' && st.confirmed_at)
                ? h('div', { title: (st.confirmed_by || '') + ' 于 ' + st.confirmed_at + ' 确认', style: { fontSize: '8px', color: COLORS.muted, marginTop: '1px', whiteSpace: 'nowrap' } },
                    String(st.confirmed_at).slice(5, 16))
                : null,
              st.metrics.map(function (m) {
                const text = m.label + ' ' + m.value
                const blocking = /待补|待处理|待审|不平|未生成|未归档|未定|缺|失败/.test(text)
                return h('div', { key: 'm-' + st.key + '-' + m.label, title: text, style: { fontSize: '9.5px', color: blocking ? '#b45309' : COLORS.muted, fontWeight: blocking ? 600 : 400, marginTop: '1px', maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, text)
              }),
              (st.key === 'diff' && engineDiff) ? h('div', { title: '引擎勾稽发现的待确认差异（未计入未更正错报）', style: { fontSize: '9.5px', color: '#b45309', fontWeight: 600, marginTop: '1px' } }, '引擎差异 ' + engineDiff) : null)
          })))
    }

    function ProjectFieldsPanel(props) {
      const [msg, setMsg] = React.useState('')
      const [f, setF] = React.useState({ principal: '', service_unit: '', project_type: '年报审计', risk_level: 'A' })
      React.useEffect(function () {
        if (!props.projectId) return
        api('/audit/projects/fields', { project: props.projectId }).then(function (d) {
          const x = d.fields || {}
          setF({ principal: x.principal || '', service_unit: x.service_unit || '', project_type: x.project_type || '年报审计', risk_level: x.risk_level || 'A' })
        }).catch(function () {})
      }, [props.projectId])
      function upd(k, v) { setF(function (p) { const n = Object.assign({}, p); n[k] = v; return n }) }
      function save() {
        api('/audit/projects/fields/save', null, { method: 'POST', body: Object.assign({ project: props.projectId }, f) })
          .then(function () { setMsg('已保存') }).catch(function (e) { setMsg('保存失败：' + e) })
      }
      const inp = { padding: '4px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' }
      return h('details', { className: 'ad-more', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line } },
        h('summary', null, '项目立项信息 · 主委托方 / 被服务单位 / 风险等级'),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } },
          h(ui.Input, { className: 'ad-plain', value: f.principal, placeholder: '主委托方', onChange: function (e) { upd('principal', e.target.value) }, style: inp }),
          h(ui.Input, { className: 'ad-plain', value: f.service_unit, placeholder: '被服务单位', onChange: function (e) { upd('service_unit', e.target.value) }, style: inp }),
          h(ui.Input, { className: 'ad-plain', value: f.project_type, placeholder: '项目类型', onChange: function (e) { upd('project_type', e.target.value) }, style: inp }),
          h('select', { value: f.risk_level, onChange: function (e) { upd('risk_level', e.target.value) }, style: inp }, ['A', 'B', 'C'].map(function (t) { return h('option', { key: 'rl-' + t, value: t }, '风险 ' + t) })),
          h(ui.Button, { variant: 'outline', size: 'sm', onClick: save, style: { padding: '4px 10px', borderRadius: '6px', border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '11px', cursor: 'pointer' } }, '保存'),
          msg ? h('span', { style: { fontSize: '11px', color: '#16a34a' } }, msg) : null))
    }

    function ArchivePackagePanel(props) {
      const [pkg, setPkg] = React.useState(null)
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/archive/package', { project: props.projectId })
          .then(function (d) { if (!cancelled) setPkg(d) })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.projectId])
      if (!pkg) return null
      const c = pkg.coverage
      const e = pkg.evidence_workflow
      return h('div', { style: { marginBottom: '14px', padding: '12px 14px', borderRadius: '10px', border: '1px solid ' + COLORS.line } },
        h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '归档包快照'),
        h('div', { style: { fontSize: '11px', color: COLORS.muted, lineHeight: 1.8 } },
          '流程确认 ' + (pkg.flow_confirmations || []).length + ' 节点 · 底稿 ' + (c ? c.total_filled : 0) + ' 格 · 取证 ' + (e ? e.count : 0) + ' 项 · 结论 ' + (pkg.opinion_draft || '未定') + ' · 留痕 ' + (pkg.events || []).length + ' 条'),
        h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, pkg.traceability_note))
    }

    function EngineFillsPanel(props) {
      const [data, setData] = React.useState(null)
      const [cov, setCov] = React.useState(null)
      const [ewf, setEwf] = React.useState(null)
      React.useEffect(function () {
        if (!props.projectId) return
        let cancelled = false
        api('/audit/workpapers/engine-fills', { project: props.projectId })
          .then(function (d) { if (!cancelled) setData(d) })
          .catch(function () { if (!cancelled) setData({ has_engine: false }) })
        api('/audit/fill-coverage', { project: props.projectId })
          .then(function (d) { if (!cancelled) setCov(d) })
          .catch(function () {})
        api('/audit/evidence-workflow', { project: props.projectId })
          .then(function (d) { if (!cancelled) setEwf(d) })
          .catch(function () {})
        return function () { cancelled = true }
      }, [props.projectId])
      function markDone(itemKey) {
        api('/audit/evidence/update', null, { method: 'POST', body: { project: props.projectId, company: data.company, item_key: itemKey, status: '已核' } })
          .then(function () { return api('/audit/evidence-workflow', { project: props.projectId }) })
          .then(function (d) { setEwf(d) })
          .catch(function () {})
      }
      if (!data || !data.has_engine) return null
      return h('details', { className: 'ad-more', style: { marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid ' + COLORS.line, background: 'rgba(47,124,246,0.05)' } },
        h('summary', null, '引擎填写结果 · ' + data.company + ' · ' + data.fill_count + ' 格 / ' + data.evidence_count + ' 证据'),
        cov && cov.has_engine ? h('div', { style: { marginBottom: '8px' } },
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' } },
            (cov.workbooks || []).map(function (w) {
              return h('span', { key: 'cw-' + w.workbook, style: { fontSize: '11px', padding: '2px 8px', borderRadius: '8px', border: '1px solid ' + COLORS.line, color: COLORS.muted } },
                w.workbook.replace(/\.xlsx$/i, '') + ' ' + w.filled + '/' + w.touched + ' 格')
            })),
          cov.uncovered_count > 0 ? h('div', { style: { fontSize: '11px', color: '#b45309' } },
            '未覆盖 ' + cov.uncovered_count + ' 表：' + cov.uncovered.map(function (u) { return u.sheet + (u.index ? '(' + u.index + ')' : '') }).join('、')) : null) : null,
        h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '8px' } }, '每个数字可追溯到科目/报表行/凭证'),
        h('div', { style: { maxHeight: '220px', overflow: 'auto', border: '1px solid ' + COLORS.line, borderRadius: '8px' } },
          (data.fills || []).slice(0, 60).map(function (f, i) {
            return h('div', { key: 'ef-' + i, style: { fontSize: '11px', padding: '3px 8px', borderBottom: '1px solid ' + COLORS.line, display: 'flex', gap: '8px' } },
              h('span', { style: { color: COLORS.muted, flexShrink: 0 } }, f.sheet + ' ' + f.cell),
              h('span', null, f.value),
              h('span', { style: { color: COLORS.muted } }, '← ' + f.basis))
          })),
        (data.evidence || []).length ? h('div', { style: { marginTop: '8px' } },
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '2px' } }, '待取证（' + data.evidence_count + '）'),
          (data.evidence || []).map(function (e, i) {
            return h('div', { key: 'ee-' + i, style: { fontSize: '11px', padding: '2px 0' } },
              h('span', { style: { fontWeight: 600, color: e.type === '报表与底表差异' ? '#b45309' : '#6b7280' } }, e.type + ' '),
              h('span', null, e.item + '：' + e.detail))
          })) : null,
        ewf && ewf.has_engine ? h('div', { style: { marginTop: '8px', borderTop: '1px solid ' + COLORS.line, paddingTop: '8px' } },
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '待取证闭环（已核 ' + ewf.done + ' / 待处理 ' + ewf.pending + '）'),
          h('div', { style: { maxHeight: '160px', overflow: 'auto' } },
            (ewf.evidence || []).map(function (e, i) {
              const stColor = e.status === '已核' ? '#16a34a' : e.status === '已取' ? '#b45309' : '#6b7280'
              return h('div', { key: 'ew-' + i, style: { fontSize: '11px', padding: '3px 0', borderBottom: '1px solid ' + COLORS.line, display: 'flex', gap: '8px', alignItems: 'center' } },
                h('span', { style: { color: stColor, flexShrink: 0, fontWeight: 600 } }, e.status),
                h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.item),
                e.owner ? h('span', { style: { color: COLORS.muted, flexShrink: 0 } }, e.owner + (e.deadline ? ' · ' + e.deadline : '')) : null,
                e.status !== '已核' ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { markDone(e.item_key) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer', flexShrink: 0 } }, '已核') : null)
            }))) : null)
    }

    function EnginePanel(props) {
      const [logic, setLogic] = React.useState(null)
      const [std, setStd] = React.useState(null)
      const [tpl, setTpl] = React.useState(null)
      React.useEffect(function () {
        api('/audit/logic').then(function (d) { setLogic(d) }).catch(function () {})
        api('/audit/templates').then(function (d) { setTpl(d.templates || []) }).catch(function () {})
      }, [])
      if (!logic) return h('div', { style: { padding: '18px', fontSize: '12px', color: COLORS.muted } }, '加载审计逻辑…')
      const sheets = logic.sheets || []
      function openStandard(s) {
        if (!s.standard) return
        setStd({ sheet: s.sheet, standard: s.standard, loading: true, hits: null })
        api('/kb/search', { q: s.standard }).then(function (d) {
          setStd({ sheet: s.sheet, standard: s.standard, loading: false, hits: (d.hits || []).slice(0, 2) })
        }).catch(function () { setStd({ sheet: s.sheet, standard: s.standard, loading: false, hits: [] }) })
      }
      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '底稿引擎'),
            h('div', { className: 'ad-sub' }, '每张表怎么填、哪些是公式。填写结果在项目的底稿页看。')),
          tpl && tpl.length ? h(AStatus, { tone: 'ok' }, tpl[0].name + ' ' + tpl[0].version) : null),
        logic.general ? h('div', { className: 'ad-note' },
          h('div', { className: 'ad-row-title', style: { marginBottom: '4px' } }, '总要求'),
          logic.general.split('\n').filter(function (l) { return l.trim() }).map(function (l, i) {
            return h('div', { key: 'g-' + i, style: { fontSize: '12px', lineHeight: 1.8 } }, l)
          })) : null,
        sheets.map(function (s, idx) {
          return h('div', { key: 's-' + idx, className: 'ad-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' } },
              h('span', { style: { fontSize: '13px', fontWeight: 600 } }, s.workbook + '｜' + s.sheet),
              s.index ? h('span', { style: { padding: '1px 8px', borderRadius: '9px', background: 'rgba(47,124,246,0.1)', color: COLORS.accent, fontSize: '11px' } }, s.index) : null,
              s.type ? h('span', { style: { padding: '1px 8px', borderRadius: '9px', border: '1px solid ' + COLORS.line, color: COLORS.muted, fontSize: '11px' } }, s.type) : null,
              s.standard ? h('span', { onClick: function () { openStandard(s) }, title: '查看准则依据', style: { padding: '1px 8px', borderRadius: '9px', background: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: '11px', cursor: 'pointer' } }, s.standard) : null),
            (s.steps || []).map(function (step, si) {
              return h('div', { key: 'st-' + si, style: { fontSize: '12px', lineHeight: 1.8 } }, h('span', { style: { color: COLORS.muted, marginRight: '6px' } }, (si + 1) + '.'), step)
            }),
            std && std.sheet === s.sheet ? h('div', { style: { marginTop: '6px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.2)' } },
              std.loading ? h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '正在检索准则依据…') :
                (std.hits && std.hits.length) ? std.hits.map(function (hit, hi) {
                  const title = hit.doc && hit.doc.title ? hit.doc.title : (hit.ref || '')
                  return h('div', { key: 'sh-' + hi, style: { fontSize: '11px', lineHeight: 1.7, marginBottom: '6px' } },
                    h('div', { style: { color: '#7c3aed', fontWeight: 600, marginBottom: '2px' } }, title),
                    h('div', { style: { color: 'inherit' } }, (hit.text || '').slice(0, 220)))
                }) : h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '未检索到相关准则段落')) : null)
        }))
    }

    function ClientsContractsPage(props) {
      const [tab, setTab] = React.useState(props.section || 'clients')
      const embedded = !!props.embedded
      const section = props.section || tab
      const [clients, setClients] = React.useState(null)
      const [contracts, setContracts] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [name, setName] = React.useState('')
      const [creditCode, setCreditCode] = React.useState('')
      const [clientType, setClientType] = React.useState('其他')
      const [contact, setContact] = React.useState('')
      const [cClient, setCClient] = React.useState('')
      const [cProject, setCProject] = React.useState('')
      const [cSeal, setCSeal] = React.useState('双章')
      const [ownerName, setOwnerName] = React.useState('')
      const [riskLevel, setRiskLevel] = React.useState('低')
      const [approvers, setApprovers] = React.useState([])
      const [submitFor, setSubmitFor] = React.useState(null)
      const [approverPick, setApproverPick] = React.useState('')
      const [decisionFor, setDecisionFor] = React.useState(null)
      const [opinion, setOpinion] = React.useState('')
      const [showCreateClient, setShowCreateClient] = React.useState(false)
      const [showCreateContract, setShowCreateContract] = React.useState(false)
      const [dashRows, setDashRows] = React.useState([])
      const [progSummary, setProgSummary] = React.useState({})
      const [selectedClient, setSelectedClient] = React.useState(null)
      const [selPrograms, setSelPrograms] = React.useState(null)
      const [selCats, setSelCats] = React.useState([])
      const [staffing, setStaffing] = React.useState({
        auditor: { count: 2, hours: 40 },
        manager: { count: 1, hours: 16 },
        partner: { count: 1, hours: 4 }
      })
      const [fee, setFee] = React.useState('')
      const [catalog, setCatalog] = React.useState([])
      const [selItems, setSelItems] = React.useState([])
      const role = (props.auth && props.auth.user && props.auth.user.role) || ''
      const canApprove = inRole(role, 'manage')
      function loadClients() { api('/audit/clients').then(function (d) { setClients(d.items || []) }).catch(function () {}) }
      function loadContracts() { api('/audit/contracts').then(function (d) { setContracts(d.items || []) }).catch(function () {}) }
      React.useEffect(function () { loadClients(); loadContracts() }, [])
      React.useEffect(function () { api('/audit/approvers').then(function (d) { setApprovers(d.items || []) }).catch(function () {}) }, [])
      React.useEffect(function () { api('/audit/dashboard').then(function (d) { setDashRows((d && d.items) || []) }).catch(function () {}) }, [])
      React.useEffect(function () { api('/audit/programs/summary').then(function (d) { setProgSummary((d && d.items) || {}) }).catch(function () {}) }, [])
      React.useEffect(function () { api('/audit/program-catalog', { business_type: '年报审计' }).then(function (d) { setCatalog((d && d.items) || []) }).catch(function () {}) }, [])
      React.useEffect(function () {
        if (!selectedClient) { setSelPrograms(null); return }
        api('/audit/clients/programs', { client: selectedClient })
          .then(function (d) { setSelPrograms(d) })
          .catch(function () { setSelPrograms({ project: null, groups: [] }) })
      }, [selectedClient])
      // 客户审计全流程状态：准入/合同/立项/执行/归档
      function flowOf(cl) {
        const cs = (contracts || []).filter(function (x) { return x.client_name === cl.name })
        const ps = (dashRows || []).filter(function (x) { return x.client === cl.name })
        const admission = cl.status === '已审批' ? 'done' : cl.status === '待审批' ? 'warning' : cl.status === '已驳回' ? 'error' : 'idle'
        const contract = cs.some(function (x) { return x.status === '已签' || x.status === '已归档' }) ? 'done' : cs.length ? 'warning' : 'idle'
        const engagement = ps.length ? 'done' : 'idle'
        const execution = ps.length ? (ps.every(function (p) { return (p.wp_percent || 0) >= 100 }) ? 'done' : 'warning') : 'idle'
        const archive = (ps.length && ps.every(function (p) { return p.status === '已归档' })) ? 'done' : 'idle'
        return { admission: admission, contract: contract, engagement: engagement, execution: execution, archive: archive }
      }
      // 客户的审计程序/资料/底稿聚合指标
      function statsOf(cl) {
        const ps = (dashRows || []).filter(function (x) { return x.client === cl.name })
        const avg = function (key) {
          return ps.length ? Math.round(ps.reduce(function (s, p) { return s + (p[key] || 0) }, 0) / ps.length) : 0
        }
        const pbc = avg('pbc_percent')
        const wp = avg('wp_percent')
        const program = avg('program_percent')
        const cats = (progSummary || {})[cl.name] || []
        const progTotal = cats.reduce(function (s, x) { return s + (x.total || 0) }, 0)
        const progDone = cats.reduce(function (s, x) { return s + (x.done || 0) }, 0)
        return {
          projects: ps.length,
          pbc: pbc, wp: wp, program: program,
          overall: Math.round((pbc + wp + program) / 3),
          archived: ps.filter(function (p) { return p.status === '已归档' }).length,
          cats: cats, progTotal: progTotal, progDone: progDone
        }
      }
      // 客户详情：总览 + 4 大类审计程序（含 65 项细项）
      function renderClientDetail() {
        const c = (clients || []).filter(function (x) { return x.name === selectedClient })[0] || { name: selectedClient }
        const st = statsOf(c)
        const flow = flowOf(c)
        const prog = selPrograms || { project: null, groups: [] }
        return h('div', null,
          h('div', { className: 'ad-head', style: { marginBottom: '14px' } },
            h('div', null,
              h('h2', { className: 'ad-title', style: { fontSize: '18px' } }, c.name),
              h('div', { className: 'ad-sub' }, (prog.project ? prog.project.name + ' · ' + (prog.project.period || '') : '暂无项目') + ' · ' + st.projects + ' 个项目')),
            h('div', { className: 'ad-actions' },
              h(AStatus, { tone: c.status === '已审批' ? 'ok' : c.status === '已驳回' ? 'warn' : '' }, c.status || ''),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { setSelectedClient(null) } }, '← 客户列表'))),
          h('div', { className: 'ad-card' },
            h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center' } },
              h(Ring, { value: st.overall }),
              h('div', { style: { flex: 1 } },
                h(ClientFlow, { flow: flow }),
                h('div', { className: 'ad-metrics' },
                  h(MetricBar, { label: '资料', value: st.pbc, color: 'var(--dsw-alias-chart-messages)' }),
                  h(MetricBar, { label: '底稿', value: st.wp, color: 'var(--dsw-alias-state-success-primary)' }),
                  h(MetricBar, { label: '程序', value: st.program, color: 'var(--dsw-alias-state-done-primary)' }))))),
          selPrograms === null ? h('div', { className: 'ad-row-meta' }, '加载审计程序…') : null,
          h('div', { className: 'ad-client-grid', style: { alignItems: 'start' } }, (prog.groups || []).map(function (cat) {
            const total = cat.items.length
            const done = cat.items.filter(function (i) { return i.status === '已完成' }).length
            const pct = total ? Math.round(done / total * 100) : 0
            return h('div', { key: cat.category, className: 'ad-card' },
              h('div', { className: 'ad-metric-head', style: { marginBottom: '4px' } },
                h('span', { className: 'ad-row-title', style: { fontSize: '13px' } }, cat.category),
                h('span', { className: 'ad-metric-val' }, done + '/' + total + ' 项 · ' + pct + '%')),
              h('div', { className: 'ad-bar-track', style: { marginBottom: '10px' } },
                h('div', { className: 'ad-bar-fill', style: { width: pct + '%', background: 'var(--dsw-alias-state-business-primary)' } })),
              cat.items.map(function (it) {
                return h('div', { key: it.seq, className: 'ad-prog-item' },
                  h(ui.StateDot, { state: PROG_STATE(it.status) }),
                  h('span', { className: 'ad-prog-item-name' }, it.name),
                  h('span', { className: 'ad-prog-item-status' }, it.status))
              }))
          })),
          h('div', { className: 'ad-card' },
            h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
              h('div', null,
                h('div', { className: 'ad-row-title' }, '业务约定书'),
                h('div', { className: 'ad-row-meta' }, '登记 → 签署 → 归档。立项需要已签署的合同。')),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { setShowCreateContract(!showCreateContract) } }, showCreateContract ? '取消' : '新建合同')),
            (showCreateContract || ((contracts || []).filter(function (x) { return x.client_name === c.name }).length === 0)) ? h('div', { className: 'ad-form' },
              h('label', { className: 'ad-field' }, '项目名称', h(ui.Input, { className: 'ad-iw', value: cProject, onChange: function (e) { setCProject(e.target.value) } })),
              h('label', { className: 'ad-field' }, '盖章类型', h('select', { className: 'ad-input', value: cSeal, onChange: function (e) { setCSeal(e.target.value) } }, ['双章', '单章(客户章)'].map(function (t) { return h('option', { key: 'cs-' + t, value: t }, t) }))),
              h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { createContractFor(c.name) } }, '登记'))) : null,
            ((contracts || []).filter(function (x) { return x.client_name === c.name })).map(function (ct) {
              return h('div', { key: 'ct-' + ct.id, className: 'ad-row' },
                h('div', null,
                  h('div', { className: 'ad-row-title' }, ct.project_name || ct.client_name),
                  h('div', { className: 'ad-row-meta' }, [ct.seal_type, ct.signed_by ? '签署 ' + ct.signed_by + (ct.signed_at ? '（' + ct.signed_at + '）' : '') : ''].filter(Boolean).join(' · '))),
                h('div', { className: 'ad-actions' },
                  h(AStatus, { tone: ct.status === '已归档' || ct.status === '已签' ? 'ok' : 'warn' }, ct.status === '已归档' ? '已归档' : ct.status === '已签' ? '已签' : '待签'),
                  ct.status === '待归档' ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { signContract(ct.id) } }, '签署') : null,
                  ct.status === '已签' ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { archiveContract(ct.id) } }, '归档') : null))
            })))
      }
      // 新建客户弹窗：基本信息 + 科目循环 + 人力投入 + 预计收费
      function createClientModal() {
        const roles = [
          { key: 'auditor', label: '审计员' },
          { key: 'manager', label: '项目经理' },
          { key: 'partner', label: '合伙人' }
        ]
        const totalHours = roles.reduce(function (s, r) {
          const v = staffing[r.key] || { count: 0, hours: 0 }
          return s + (Number(v.count) || 0) * (Number(v.hours) || 0)
        }, 0)
        const feeNum = Number(fee) || 0
        const perHour = totalHours > 0 && feeNum > 0 ? Math.round(feeNum / totalHours) : 0
        return h(ui.Modal, {
          open: showCreateClient,
          onClose: function () { setShowCreateClient(false) },
          title: '新建客户',
          closeLabel: '关闭',
          className: 'ad-modal-wide',
          contentClassName: 'ad-modal-scroll',
          description: '建档时一并评估业务范围与人力投入，便于判断收费是否合理。',
          footer: h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'outline', onClick: function () { setShowCreateClient(false) } }, '取消'),
            h(ui.Button, { variant: 'primary', onClick: createClient }, '建档'))
        },
          h('div', { className: 'ad-form' },
            h('label', { className: 'ad-field' }, '客户名称', h(ui.Input, { className: 'ad-iw', value: name, placeholder: '必填', onChange: function (e) { setName(e.target.value) } })),
            h('label', { className: 'ad-field' }, '统一社会信用代码', h(ui.Input, { className: 'ad-iw', value: creditCode, onChange: function (e) { setCreditCode(e.target.value) } })),
            h('label', { className: 'ad-field' }, '客户类型', h('select', { className: 'ad-input', value: clientType, onChange: function (e) { setClientType(e.target.value) } }, ['其他', '企业', '事业单位', '政府', '个人'].map(function (t) { return h('option', { key: 'ct-' + t, value: t }, t) }))),
            h('label', { className: 'ad-field' }, '联系信息', h(ui.Input, { className: 'ad-iw', value: contact, onChange: function (e) { setContact(e.target.value) } })),
            h('label', { className: 'ad-field' }, '业务责任人', h(ui.Input, { className: 'ad-iw', value: ownerName, placeholder: '姓名', onChange: function (e) { setOwnerName(e.target.value) } })),
            h('label', { className: 'ad-field' }, '风险等级', h('select', { className: 'ad-input', value: riskLevel, onChange: function (e) { setRiskLevel(e.target.value) } }, ['低', '中', '高'].map(function (x) { return h('option', { key: 'rl-' + x, value: x }, x) })))),
          h('div', { className: 'ad-field', style: { marginTop: '14px' } },
            h('span', null, '适用科目循环（不选 = 全部 13 类，勾选后按该范围生成程序清单）'),
            h('div', { className: 'ad-cat-tree' },
              PROGRAM_CATEGORIES.map(function (cat) {
                const names = (catalog || []).filter(function (it) { return (it.category || '') === cat }).map(function (it) { return it.name })
                const picked = names.filter(function (n) { return selItems.indexOf(n) >= 0 })
                const all = names.length > 0 && picked.length === names.length
                const some = picked.length > 0 && !all
                return h('div', { key: cat, className: 'ad-cat-block' },
                  h('label', { className: 'ad-cat-check' },
                    h(CatCheck, { checked: all, indeterminate: some, onChange: function () {
                      setSelItems(function (prev) {
                        if (all) return prev.filter(function (x) { return names.indexOf(x) < 0 })
                        const next = prev.slice()
                        names.forEach(function (n) { if (next.indexOf(n) < 0) next.push(n) })
                        return next
                      })
                    } }),
                    h('span', { className: 'ad-cat-name' }, cat + (names.length ? '（' + picked.length + '/' + names.length + '）' : ''))),
                  names.length ? h('div', { className: 'ad-cat-items' },
                    names.map(function (n) {
                      const on = selItems.indexOf(n) >= 0
                      return h('label', { key: n, className: 'ad-cat-item' },
                        h('input', { type: 'checkbox', checked: on, onChange: function () {
                          setSelItems(function (prev) { return prev.indexOf(n) >= 0 ? prev.filter(function (x) { return x !== n }) : prev.concat([n]) })
                        } }),
                        h('span', null, n))
                    })) : null)
              }))),
          h('div', { style: { marginTop: '16px' } },
            h('div', { className: 'ad-row-title', style: { marginBottom: '6px' } }, '人力投入'),
            roles.map(function (r) {
              const v = staffing[r.key] || { count: 0, hours: 0 }
              return h('div', { key: r.key, className: 'ad-staff-row' },
                h('span', { className: 'ad-staff-label' }, r.label),
                h(ui.Input, { className: 'ad-staff-input', type: 'number', min: 0, value: String(v.count), onChange: function (e) {
                  setStaffing(function (prev) { const n = Object.assign({}, prev); n[r.key] = Object.assign({}, n[r.key], { count: e.target.value }); return n })
                } }),
                h('span', { className: 'ad-staff-x' }, '人 ×'),
                h(ui.Input, { className: 'ad-staff-input', type: 'number', min: 0, value: String(v.hours), onChange: function (e) {
                  setStaffing(function (prev) { const n = Object.assign({}, prev); n[r.key] = Object.assign({}, n[r.key], { hours: e.target.value }); return n })
                } }),
                h('span', { className: 'ad-staff-unit' }, '小时'))
            }),
            h('div', { className: 'ad-row-meta' }, '合计工时：' + totalHours + ' 小时')),
          h('div', { className: 'ad-form', style: { marginTop: '12px' } },
            h('label', { className: 'ad-field' }, '预计收费（元）', h(ui.Input, { className: 'ad-iw', type: 'number', value: fee, onChange: function (e) { setFee(e.target.value) } })),
            perHour ? h('div', { className: 'ad-row-meta' }, '折算 ' + perHour + ' 元/小时') : null))
      }
      function createClient() {
        if (!name.trim()) { setMsg('客户名称必填'); return }
        api('/audit/clients/create', null, { method: 'POST', body: {
          name: name, credit_code: creditCode, client_type: clientType, contact: contact,
          owner_name: ownerName, risk_level: riskLevel, program_categories: selCats.join(','),
          staff_plan: JSON.stringify(Object.keys(staffing).map(function (k) {
            return { role: k, count: Number(staffing[k].count) || 0, hours: Number(staffing[k].hours) || 0 }
          })),
          program_names: JSON.stringify(selItems),
          fee_estimate: Number(fee) || 0
        } })
          .then(function () { setMsg('客户已建档（待提交）。下一步：指定审批人提交准入'); setName(''); setCreditCode(''); setContact(''); setOwnerName(''); setSelCats([]); setSelItems([]); setFee(''); setShowCreateClient(false); loadClients() })
          .catch(function (e) { setMsg('建档失败：' + e) })
      }
      function submitClient(id) {
        if (!approverPick) { setMsg('请选择审批人'); return }
        api('/audit/clients/submit', null, { method: 'POST', body: { id: id, approver_username: approverPick } })
          .then(function () { setMsg('已提交审批，等待审批人处理'); setSubmitFor(null); setApproverPick(''); loadClients() })
          .catch(function (e) { setMsg('提交失败：' + e) })
      }
      function decideClient(id, decision) {
        api('/audit/clients/decide', null, { method: 'POST', body: { id: id, decision: decision, opinion: opinion } })
          .then(function () {
            setMsg(decision === 'approve' ? '客户已通过准入。下一步：切到「合同」页签登记业务约定书' : '已驳回，客户补充资料后可重新提交')
            setDecisionFor(null); setOpinion(''); loadClients()
          })
          .catch(function (e) { setMsg('审批失败：' + e) })
      }
      function createContract() {
        const picked = (clients || []).filter(function (c) { return c.name === cClient })[0]
        if (!picked) { setMsg('请先选择已审批客户'); return }
        if (picked.status !== '已审批') { setMsg('该客户尚未审批，不能登记合同'); return }
        api('/audit/contracts/create', null, { method: 'POST', body: { client_name: cClient, project_name: cProject, seal_type: cSeal } })
          .then(function () { setMsg('合同已登记，待签'); setCClient(''); setCProject(''); setShowCreateContract(false); loadContracts() })
          .catch(function (e) { setMsg('登记失败：' + e) })
      }
      // 客户详情内登记合同（客户已由上下文确定，仍校验准入状态）
      function createContractFor(clientName) {
        const picked = (clients || []).filter(function (c) { return c.name === clientName })[0]
        if (!picked) { setMsg('客户不存在'); return }
        if (picked.status !== '已审批') { setMsg('该客户尚未审批，不能登记合同'); return }
        api('/audit/contracts/create', null, { method: 'POST', body: { client_name: clientName, project_name: cProject, seal_type: cSeal } })
          .then(function () { setMsg('合同已登记，待签'); setCProject(''); setShowCreateContract(false); loadContracts() })
          .catch(function (e) { setMsg('登记失败：' + e) })
      }
      function signContract(id) {
        api('/audit/contracts/sign', null, { method: 'POST', body: { id: id } })
          .then(function () { setMsg('合同已签署。下一步：归档'); loadContracts() })
          .catch(function (e) { setMsg('签署失败：' + e) })
      }
      function archiveContract(id) {
        api('/audit/contracts/archive', null, { method: 'POST', body: { id: id } })
          .then(function () { setMsg('合同已归档'); loadContracts() })
          .catch(function (e) { setMsg('归档失败：' + e) })
      }
      function tabBtn(code, label) {
        const active = tab === code
        return h(ui.Button, { variant: 'outline', size: 'sm', key: 'tab-' + code, onClick: function () { setTab(code) },
          style: { padding: '6px 14px', borderRadius: '8px', border: '1px solid ' + (active ? COLORS.accent : COLORS.line), background: active ? 'rgba(47,124,246,0.08)' : 'transparent', color: active ? COLORS.accent : 'inherit', fontSize: '12px', cursor: 'pointer' } }, label)
      }
      const inp = { padding: '6px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' }
      return h('div', { style: embedded ? { maxWidth: '980px' } : { padding: '18px', maxWidth: '980px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        embedded ? null : h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '客户与合同'),
        embedded ? null : h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '10px' } }, '商务外壳：客户建档审批 → 业务约定书登记归档'),
        embedded ? null : h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } }, tabBtn('clients', '客户管理'), tabBtn('contracts', '合同管理')),
        msg ? h('div', { style: { fontSize: '11px', color: '#16a34a', marginBottom: '8px' } }, msg) : null,
        section === 'clients' ? (selectedClient ? renderClientDetail() : h('div', null,
          h('div', { className: 'ad-toolbar', style: { marginBottom: '12px' } },
            h('span', { className: 'ad-row-meta' }, clients === null ? '加载中…' : (clients.length + ' 家客户')),
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { setShowCreateClient(!showCreateClient) } }, showCreateClient ? '取消' : '新建客户')),
          createClientModal(),
          clients === null ? h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '加载客户…') :
            (clients.length ? h('div', null, clients.map(function (c) {
              const st = statsOf(c)
              return h('div', { key: 'cl-' + c.id, className: 'ad-row', style: { cursor: 'pointer', alignItems: 'flex-start' }, onClick: function () { setSelectedClient(c.name) } },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('div', { className: 'ad-row-title' }, c.name),
                  h('div', { className: 'ad-row-meta' }, [c.client_type, c.risk_level ? '风险 ' + c.risk_level : '', c.owner_name ? '责任人 ' + c.owner_name : '', st.projects ? st.projects + ' 个项目' : ''].filter(Boolean).join(' · ')),
                  h(ClientFlow, { flow: flowOf(c) })),
                h('div', { className: 'ad-actions' },
                  h(AStatus, { tone: c.status === '已审批' ? 'ok' : c.status === '已驳回' ? 'warn' : '' }, c.status),
                  h('span', { className: 'ad-metric-val' }, st.overall + '%')))
            })) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无客户，点「新建客户」开始建档')))
        ) : h('div', null,
          h('div', { className: 'ad-toolbar', style: { marginBottom: '12px' } },
            h('span', { className: 'ad-row-meta' }, contracts === null ? '加载中…' : (contracts.length + ' 份合同')),
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { setShowCreateContract(!showCreateContract) } }, showCreateContract ? '取消' : '新建合同')),
          (showCreateContract || (contracts && contracts.length === 0)) ? h('div', { className: 'ad-form' },
            h('label', { className: 'ad-field' }, '客户（仅已审批）', h('select', { className: 'ad-input', value: cClient, onChange: function (e) { setCClient(e.target.value) } },
              h('option', { value: '' }, '选择已审批客户'),
              (clients || []).filter(function (c) { return c.status === '已审批' }).map(function (c) { return h('option', { key: 'cc-' + c.id, value: c.name }, c.name) }))),
            h('label', { className: 'ad-field' }, '项目名称', h(ui.Input, { className: 'ad-iw', value: cProject, onChange: function (e) { setCProject(e.target.value) } })),
            h('label', { className: 'ad-field' }, '盖章类型', h('select', { className: 'ad-input', value: cSeal, onChange: function (e) { setCSeal(e.target.value) } }, ['双章', '单章(客户章)'].map(function (t) { return h('option', { key: 'cs-' + t, value: t }, t) }))),
            h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: createContract }, '登记'))) : null,
          contracts === null ? h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '加载合同…') :
            (contracts.length ? contracts.map(function (c) {
              return h('div', { key: 'co-' + c.id, className: 'ad-row' },
                h('div', null,
                  h('div', { className: 'ad-row-title' }, c.client_name),
                  h('div', { className: 'ad-row-meta' }, [c.project_name, c.seal_type, c.signed_by ? '签署 ' + c.signed_by + (c.signed_at ? '（' + c.signed_at + '）' : '') : ''].filter(Boolean).join(' · '))),
                h('div', { className: 'ad-actions' },
                  h(AStatus, { tone: c.status === '已归档' || c.status === '已签' ? 'ok' : 'warn' }, c.status === '已归档' ? '已归档' : c.status === '已签' ? '已签' : '待签'),
                  c.status === '待归档' ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { signContract(c.id) } }, '签署') : null,
                  c.status === '已签' ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { archiveContract(c.id) } }, '归档') : null))
            }) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无合同，先登记'))
        ))
    }

    function ReportSealPanel(props) {
      const [seal, setSeal] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [f, setF] = React.useState({ report_type: '', seal_type: '电子印章', seal_category: '', signer_partner: '', signer_cpa: '', report_date: '', doc_no: '', codes: '' })
      React.useEffect(function () {
        if (!props.projectId) return
        api('/audit/report/seal', { project: props.projectId }).then(function (d) {
          const s = d.seal || {}
          setSeal(d.seal || null)
          setF({ report_type: s.report_type || '', seal_type: s.seal_type || '电子印章', seal_category: s.seal_category || '', signer_partner: s.signer_partner || '', signer_cpa: s.signer_cpa || '', report_date: s.report_date || '', doc_no: s.doc_no || '', codes: s.codes || '' })
        }).catch(function () {})
      }, [props.projectId])
      function upd(k, v) { setF(function (p) { const n = Object.assign({}, p); n[k] = v; return n }) }
      function save() {
        api('/audit/report/seal/save', null, { method: 'POST', body: Object.assign({ project: props.projectId }, f) })
          .then(function (d) { setSeal(d.seal); setMsg('已保存') }).catch(function (e) { setMsg('保存失败：' + e) })
      }
      function advance() {
        api('/audit/report/seal/advance', null, { method: 'POST', body: { project: props.projectId } })
          .then(function (d) { setSeal(d.seal); setMsg('状态已推进') }).catch(function (e) { setMsg('推进失败：' + e) })
      }
      const inp = { padding: '4px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' }
      return h('div', { className: 'ad-card' },
        h('div', { className: 'ad-head', style: { marginBottom: '8px' } },
          h('div', null,
            h('div', { className: 'ad-row-title' }, '报告盖章'),
            h('div', { className: 'ad-row-meta' }, seal ? seal.status : '未建。保存不代表已盖章。')),
          h('div', { className: 'ad-actions' },
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: save }, '保存'),
            seal ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: advance, disabled: seal.status === '已盖章' }, seal.status === '已盖章' ? '已盖章' : '推进状态') : null)),
        h('div', { className: 'ad-form' },
          h('label', { className: 'ad-field' }, '报告类型', h(ui.Input, { className: 'ad-iw', value: f.report_type, onChange: function (e) { upd('report_type', e.target.value) } })),
          h('label', { className: 'ad-field' }, '盖章类型', h(ui.Input, { className: 'ad-iw', value: f.seal_type, onChange: function (e) { upd('seal_type', e.target.value) } })),
          h('label', { className: 'ad-field' }, '用章类别', h(ui.Input, { className: 'ad-iw', value: f.seal_category, onChange: function (e) { upd('seal_category', e.target.value) } })),
          h('label', { className: 'ad-field' }, '签字合伙人', h(ui.Input, { className: 'ad-iw', value: f.signer_partner, onChange: function (e) { upd('signer_partner', e.target.value) } })),
          h('label', { className: 'ad-field' }, '签字注册会计师', h(ui.Input, { className: 'ad-iw', value: f.signer_cpa, onChange: function (e) { upd('signer_cpa', e.target.value) } })),
          h('label', { className: 'ad-field' }, '报告日期', h(ui.Input, { className: 'ad-iw', value: f.report_date, onChange: function (e) { upd('report_date', e.target.value) } })),
          h('label', { className: 'ad-field' }, '文号', h(ui.Input, { className: 'ad-iw', value: f.doc_no, onChange: function (e) { upd('doc_no', e.target.value) } })),
          h('label', { className: 'ad-field' }, '赋码', h(ui.Input, { className: 'ad-iw', value: f.codes, onChange: function (e) { upd('codes', e.target.value) } }))),
        msg ? h('div', { className: 'ad-row-meta' }, msg) : null)
    }

    function InvoicesPage(props) {
      const [items, setItems] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [buyer, setBuyer] = React.useState('')
      const [invType, setInvType] = React.useState('电子普票')
      const [amount, setAmount] = React.useState('')
      const [content, setContent] = React.useState('')
      const [note, setNote] = React.useState('')
      const [contracts, setContracts] = React.useState([])
      const [contractId, setContractId] = React.useState('')
      function load() { api('/audit/invoices').then(function (d) { setItems(d.items || []) }).catch(function () {}) }
      React.useEffect(load, [])
      React.useEffect(function () { api('/audit/contracts').then(function (d) { setContracts(d.items || []) }).catch(function () {}) }, [])
      function create() {
        if (!buyer.trim()) { setMsg('购方名称必填'); return }
        const picked = (contracts || []).filter(function (c) { return String(c.id) === String(contractId) })[0]
        api('/audit/invoices/create', null, { method: 'POST', body: { buyer_name: buyer, invoice_type: invType, amount: parseFloat(amount) || 0, content: content, note: note, contract_id: picked ? picked.id : 0, client_name: picked ? picked.client_name : '' } })
          .then(function () { setMsg('发票已申请'); setBuyer(''); setAmount(''); setContent(''); setNote(''); load() })
          .catch(function (e) { setMsg('申请失败：' + e) })
      }
      function issue(id) {
        api('/audit/invoices/issue', null, { method: 'POST', body: { id: id } })
          .then(function () { setMsg('发票已开具'); load() })
          .catch(function (e) { setMsg('开具失败：' + e) })
      }
      const embedded = !!props.embedded
      const inp = { padding: '6px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' }
      return h('div', { style: embedded ? { maxWidth: '980px' } : { padding: '18px', maxWidth: '980px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        embedded ? null : h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '发票管理'),
        embedded ? null : h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '10px' } }, '开票申请 → 开具（电子专票/普票，含快递备注）'),
        msg ? h('div', { style: { fontSize: '11px', color: '#16a34a', marginBottom: '8px' } }, msg) : null,
        h('div', { className: 'ad-form' },
          h('label', { className: 'ad-field' }, '购方名称', h(ui.Input, { className: 'ad-iw', value: buyer, placeholder: '必填', onChange: function (e) { setBuyer(e.target.value) } })),
          h('label', { className: 'ad-field' }, '关联合同', h('select', { className: 'ad-input', value: contractId, onChange: function (e) { setContractId(e.target.value) } },
            h('option', { value: '' }, '不关联'),
            (contracts || []).filter(function (c) { return c.status === '已签' || c.status === '已归档' }).map(function (c) {
              return h('option', { key: 'ic-' + c.id, value: String(c.id) }, c.client_name + (c.project_name ? ' · ' + c.project_name : ''))
            }))),
          h('label', { className: 'ad-field' }, '发票类型', h('select', { className: 'ad-input', value: invType, onChange: function (e) { setInvType(e.target.value) } }, ['电子普票', '电子专票'].map(function (t) { return h('option', { key: 'it-' + t, value: t }, t) }))),
          h('label', { className: 'ad-field' }, '开票金额', h(ui.Input, { className: 'ad-iw', value: amount, onChange: function (e) { setAmount(e.target.value) } })),
          h('label', { className: 'ad-field' }, '开票内容', h(ui.Input, { className: 'ad-iw', value: content, onChange: function (e) { setContent(e.target.value) } })),
          h('label', { className: 'ad-field' }, '备注', h(ui.Input, { className: 'ad-iw', value: note, placeholder: '快递要求等', onChange: function (e) { setNote(e.target.value) } })),
          h('div', { className: 'ad-form-actions' }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: create }, '申请'))),
        items === null ? h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '加载发票…') :
          (items.length ? items.map(function (it) {
            return h('div', { key: 'inv-' + it.id, className: 'ad-row' },
              h('div', null,
                h('div', { className: 'ad-row-title' }, it.buyer_name),
                h('div', { className: 'ad-row-meta' }, [it.invoice_type, '¥' + it.amount, it.content, it.note].filter(Boolean).join(' · '))),
              h('div', { className: 'ad-actions' },
                h(AStatus, { tone: it.status === '已开' ? 'ok' : 'warn' }, it.status),
                it.status === '待开' ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { issue(it.id) } }, '开具') : null))
          }) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无发票，先申请'))
      )
    }

    function MappingRulesPage(props) {
      const auth = props.auth || {}
      const role = (auth.user && auth.user.role) || ''
      const canEdit = ['kb-admin', 'admin'].indexOf(role) >= 0
      const KINDS = [{ code: 'name', label: '名称关键词' }, { code: 'prefix_code', label: '编码前缀' }, { code: 'exact_code', label: '精确编码' }]
      const [kind, setKind] = React.useState('name')
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState({ needle: '', std: '', kind: 'name', company: '', note: '' })
      function load() {
        setLoading(true); setErr('')
        api('/audit/mapping-rules', { kind: kind })
          .then(function (d) { setItems(d.items || []) })
          .catch(function (e) { setErr(String(e)) })
          .then(function () { setLoading(false) })
      }
      React.useEffect(function () { load() }, [kind])
      function startEdit(item) {
        if (!canEdit) return
        setEditing(item.id)
        setDraft({ needle: item.needle || '', std: item.std || '', kind: item.kind || 'name', company: item.company || '', note: item.note || '' })
        setMsg('')
      }
      function cancelEdit() { setEditing(null); setDraft({ needle: '', std: '', kind: kind, company: '', note: '' }) }
      function submitSave(id) {
        if (!canEdit) return
        if (!draft.needle.trim() || !draft.std.trim()) { setErr('关键词/编码 和 标准科目码 均必填'); return }
        const body = { needle: draft.needle.trim(), std: draft.std.trim(), kind: draft.kind, company: draft.company.trim() || null, note: draft.note.trim() }
        if (id) body.id = id
        api('/audit/mapping-rules/save', null, { method: 'POST', body: body })
          .then(function () { setMsg(id ? '已保存修改' : '已新增规则'); cancelEdit(); load() })
          .catch(function (e) { setErr(String(e)) })
      }
      function toggle(item) {
        if (!canEdit) return
        api('/audit/mapping-rules/save', null, { method: 'POST', body: { id: item.id, needle: item.needle, std: item.std, kind: item.kind, company: item.company, note: item.note, enabled: item.enabled ? 0 : 1 } })
          .then(function () { load() })
          .catch(function (e) { setErr(String(e)) })
      }
      const inputStyle = { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' }
      const smallBtn = { padding: '4px 9px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' }
      const kindLabel = function (k) { const f = KINDS.filter(function (x) { return x.code === k })[0]; return f ? f.label : k }
      return h('div', { className: 'ad-zone-page' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '映射规则'),
            h('div', { className: 'ad-sub' }, '客户科目对不上标准科目时在这里补。保存后全所生效。')),
          canEdit ? h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { setEditing('new'); setDraft({ needle: '', std: '', kind: kind, company: '', note: '' }) } }, '新增规则') : null),
        h('div', { className: 'ad-toolbar', style: { marginBottom: '16px' } },
          h(ui.SegmentedTabs, {
            className: 'ad-tabs-fit',
            items: KINDS.map(function (k) { return { value: k.code, label: k.label, id: 'kind-' + k.code, panelId: 'kind-panel' } }),
            value: kind,
            onChange: function (v) { setKind(v); cancelEdit() },
            label: '规则类型',
            size: 'sm'
          }),
          h('span', { className: 'ad-row-meta' }, items.length + ' 条' + (loading ? ' · 加载中' : ''))),
        msg ? h('div', { className: 'ad-note' }, msg) : null,
        err ? h('div', { className: 'ad-note' }, err) : null,
        editing === 'new' ? h('div', { className: 'ad-form' },
          h('label', { className: 'ad-field' }, '关键词或编码', h(ui.Input, { className: 'ad-iw', value: draft.needle, onChange: function (e) { setDraft(Object.assign({}, draft, { needle: e.target.value })) }, placeholder: '必填' })),
          h('label', { className: 'ad-field' }, '标准科目码', h(ui.Input, { className: 'ad-iw', value: draft.std, onChange: function (e) { setDraft(Object.assign({}, draft, { std: e.target.value })) }, placeholder: '如 1601' })),
          h('label', { className: 'ad-field' }, '类型', h('select', { className: 'ad-input', value: draft.kind, onChange: function (e) { setDraft(Object.assign({}, draft, { kind: e.target.value })) } }, KINDS.map(function (k) { return h('option', { key: 'new-' + k.code, value: k.code }, k.label) }))),
          h('label', { className: 'ad-field' }, '客户', h(ui.Input, { className: 'ad-iw', value: draft.company, onChange: function (e) { setDraft(Object.assign({}, draft, { company: e.target.value })) }, placeholder: '留空表示通用' })),
          h('label', { className: 'ad-field' }, '备注', h(ui.Input, { className: 'ad-iw', value: draft.note, onChange: function (e) { setDraft(Object.assign({}, draft, { note: e.target.value })) } })),
          h('div', { className: 'ad-form-actions' },
            h(ui.Button, { variant: 'primary', size: 'sm', onClick: function () { submitSave(0) } }, '添加'),
            h(ui.Button, { variant: 'outline', size: 'sm', onClick: cancelEdit }, '取消'))) : null,
        items.length ? h('div', { style: { marginTop: '6px' } }, items.map(function (item) {
          if (editing === item.id) {
            return h('div', { key: 'it-' + item.id, style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line } },
              h(ui.Input, { className: 'ad-plain', value: draft.needle, onChange: function (e) { setDraft(Object.assign({}, draft, { needle: e.target.value })) }, style: Object.assign({}, inputStyle, { width: '170px' }) }),
              h(ui.Input, { className: 'ad-plain', value: draft.std, onChange: function (e) { setDraft(Object.assign({}, draft, { std: e.target.value })) }, style: Object.assign({}, inputStyle, { width: '110px' }) }),
              h('select', { value: draft.kind, onChange: function (e) { setDraft(Object.assign({}, draft, { kind: e.target.value })) }, style: inputStyle },
                KINDS.map(function (k) { return h('option', { key: 'e-' + k.code, value: k.code }, k.label) })),
              h(ui.Input, { className: 'ad-plain', value: draft.note, onChange: function (e) { setDraft(Object.assign({}, draft, { note: e.target.value })) }, placeholder: '备注', style: Object.assign({}, inputStyle, { flex: 1, minWidth: '120px' }) }),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: function () { submitSave(item.id) }, style: Object.assign({}, smallBtn, { border: 0, background: COLORS.accent, color: 'var(--dsw-alias-label-primary-foreground)' }) }, '保存'),
              h(ui.Button, { variant: 'outline', size: 'sm', onClick: cancelEdit, style: smallBtn }, '取消'))
          }
          return h('div', { key: 'it-' + item.id, className: 'ad-row' },
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'ad-row-title' }, item.needle + ' → ' + item.std),
              h('div', { className: 'ad-row-meta' }, kindLabel(item.kind) + (item.company ? ' · ' + item.company : ' · 通用') + (item.note ? ' · ' + item.note : ''))),
            canEdit ? h('div', { className: 'ad-actions' },
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { startEdit(item) } }, '编辑'),
              h(ui.Button, { variant: 'ghost', size: 'sm', onClick: function () { toggle(item) } }, item.enabled ? '停用' : '启用')) : h(AStatus, {}, item.enabled ? '启用' : '停用'))
        })) : h('div', { style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : '该类型暂无规则'),
        h('div', { style: { marginTop: '10px', fontSize: '11px', color: COLORS.muted, lineHeight: 1.8 } },
          '说明：① 命中顺序：内置 chart 映射 → 客户专用前缀 → 通用名称关键词（长词优先）；② 改动保存到后端，全部客户端统一生效；③ 维护权限仅限管理员。'))
    }

    function GuidePage() {
      const section = function (title, children) {
        return h('div', { style: { marginBottom: '14px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, title),
          children)
      }
      const line = function (text) {
        return h('div', { style: { fontSize: '12px', lineHeight: 1.9 } }, text)
      }
      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '10px' } }, '使用指南'),
        section('快速开始（5 步）', h('div', null,
          line('1. 客户 → 点客户进详情 → 业务约定书登记合同（签署后）；再回 项目 → + 新建项目选该合同。没有合同不能立项。'),
          line('2. 风险评估：确认重要性（经理/合伙人），上传财务报表（xlsx），导入科目余额表、序时账（支持 xlsx/xls/csv、多工作表、模板下载）。'),
          line('3. 执行程序：试算平衡、抽样、函证/回函、账龄、截止测试、存货监盘；生成程序底稿（Word）。'),
          line('4. 审计程序：86 张程序表，选中科目看 5 项认定与实质性程序；点进底下看关联底稿表。'),
          line('5. 程序执行：按业务类型生成的项目清单，逐项更新状态 / 负责人 / 备注，联动底稿台账。'),
          line('6. 报告 → 生成初稿/意见 → 导出 Word/PDF → 定稿后才能提交审批 → 审批通过 → 归档（只读）→ 导出归档包。'))),
        section('数据导入格式', h('div', null,
          line('科目余额表：科目编码、科目名称、期初余额、借方发生额、贷方发生额、期末余额。'),
          line('序时账：日期、凭证号、摘要、科目编码、科目名称、借方金额、贷方金额。'),
          line('支持表头自动识别（跳过标题行）、列名容错、多工作表选择；导入前可先「校验」。'),
          line('导入后可跑凭证异常扫描（资料清单）：本福特定律、重复凭证、大额交易、整数金额、红字冲销、日期异常、凭证连号。'))),
        section('角色与权限', h('div', null,
          line('审计员：执行底稿/程序、生成报告初稿、提交审批。'),
          line('项目经理/合伙人：确认重要性、审批、复核/定稿、归档。'),
          line('管理员：用户管理、系统状态、备份/恢复、项目删除。'))),
        section('AI 助手', h('div', null,
          line('项目对话 → 新建项目对话：自动带入重要性、进度、报告门禁、审批、待办、风险等上下文。'),
          line('风险评估 → AI 建议后续程序：基于项目上下文输出程序清单、证据与风险点。'),
          line('AI 输出为初稿，须审计师复核；准则/法规结论以知识库检索结果为准。'))),
        section('归档与备份', h('div', null,
          line('归档后项目只读；归档包含最新底稿、程序底稿、扫描件、操作日志与项目信息。'),
          line('设置 → 系统（管理员）：数据库备份/恢复；服务常驻时每日自动备份（保留 10 份）。'))),
        section('底稿与交付文档', h('div', null,
          line('底稿 15 类：货币资金、应收账款、存货、营业收入成本、试算平衡、期后事项、持续经营、关联方、或有事项、期初余额、会计政策与估计、风险评估、固定资产、应付职工薪酬、应交税费。'),
          line('底稿 ZIP：打包下载含 README/清单/校验值；「校验底稿包（ZIP）」可核对 SHA256，失败自动告警并生成复核审批。'),
          line('台账：可按状态筛选、按名称/索引/说明搜索，支持导出 CSV。'),
          line('交付文档（客户验收清单、用户培训手册、发布说明）随客户端安装包内置，安装后位于 ~/.dsh/auditdesk-docs。'))),
        section('常见问题', h('div', null,
          line('加载失败：检查网关服务（8030）与网络/Tailscale。'),
          line('登录 429：连续失败锁定 5 分钟，请联系管理员或稍后再试。'),
          line('导入失败：用「校验」查看缺失列；.xls 若为网页导出请另存为 .xlsx。'),
          line('报告 PDF 中文空白：服务器缺少 Arial Unicode 字体。'))))
    }

    function shellTab(code, label, tab, setTab) {
      return h(ui.Button, { variant: 'outline', size: 'sm', key: 'shell-' + code, className: 'ad-tab' + (tab === code ? ' on' : ''), onClick: function () { setTab(code) } }, label)
    }

    function CommercePage(props) {
      return h('div', { className: 'ad-page' }, h('div', { className: 'ad-page-inner' },
        h('div', { className: 'ad-head' },
          h('div', null,
            h('h1', { className: 'ad-title' }, '客户'),
            h('div', { className: 'ad-sub' }, '客户准入：建档 → 指定审批人 → 通过。合同与开票在客户详情里处理。')),
          null),
        h(ClientsContractsPage, { auth: props.auth, embedded: true, section: 'clients' })))
    }

    function settingsTabsFor(role) {
      const tabs = []
      if (['manager', 'partner', 'kb-admin', 'admin'].indexOf(role) >= 0) tabs.push({ id: 'events', label: '留痕' })
      if (role === 'kb-admin' || role === 'admin') {
        tabs.push({ id: 'users', label: '用户' })
        tabs.push({ id: 'catalog', label: '程序库' })
        tabs.push({ id: 'mapping', label: '映射规则' })
        tabs.push({ id: 'engine', label: '底稿引擎' })
        tabs.push({ id: 'system', label: '系统' })
      }
      tabs.push({ id: 'guide', label: '指南' })
      tabs.push({ id: 'about', label: '关于' })
      return tabs
    }

    function SettingsPage(props) {
      const role = (props.auth && props.auth.user && props.auth.user.role) || ''
      const tabs = settingsTabsFor(role)
      const initial = (function () {
        try {
          const saved = localStorage.getItem('auditdesk.settings.tab') || ''
          if (saved) localStorage.removeItem('auditdesk.settings.tab')
          if (tabs.some(function (item) { return item.id === saved })) return saved
        } catch (e) {}
        return tabs[0].id
      })()
      const [tab, setTab] = React.useState(initial)
      const current = tabs.some(function (item) { return item.id === tab }) ? tab : tabs[0].id
      React.useEffect(function () {
        function onGo(e) {
          const target = e && e.detail
          if (target && tabs.some(function (item) { return item.id === target })) setTab(target)
        }
        try { window.addEventListener('auditdesk:goto-settings-tab', onGo) } catch (e) {}
        return function () { try { window.removeEventListener('auditdesk:goto-settings-tab', onGo) } catch (e) {} }
      }, [tabs])
      let body = h(GuidePage, null)
      if (current === 'events') body = h(EventsPage, { auth: props.auth, ui: props.ui })
      else if (current === 'users') body = h(UsersPage, { auth: props.auth })
      else if (current === 'catalog') body = h(ProgramCatalogPage, { auth: props.auth })
      else if (current === 'mapping') body = h(MappingRulesPage, { auth: props.auth })
      else if (current === 'engine') body = h(EnginePanel, { auth: props.auth })
      else if (current === 'system') body = h(SystemPage, Object.assign({}, props, { auth: props.auth }))
      else if (current === 'about') body = h(AboutPage, null)
      return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } },
        h('div', { style: { padding: '22px 28px 0', flexShrink: 0 } },
          h('h1', { className: 'ad-title' }, '设置'),
          h('div', { className: 'ad-sub', style: { marginBottom: '12px' } }, role === 'auditor' ? '使用说明。后台页签按角色开放。' : '能看到的页签由当前角色决定。'),
          h(ui.SegmentedTabs, {
            className: 'ad-tabs-fit',
            items: tabs.map(function (item) { return { value: item.id, label: item.label, id: 'set-tab-' + item.id, panelId: 'set-panel' } }),
            value: current,
            onChange: setTab,
            label: '设置页签',
            size: 'sm'
          })),
        h('div', { style: { flex: 1, minHeight: 0 } }, body))
    }

    return {
      inject: ['slots', 'uiWorkspace', 'layout', 'sessions', 'workspaces', 'remote', 'remote.commands'],
      apply(ctx) {
        function onStartChat(company, project) {
          try { ctx.layout.selectPanel(null) } catch (e) {}
          projectPrompt(company, project).then(function (prompt) {
            ctx.uiWorkspace.startSession(undefined, { prompt: prompt, whenDraftExists: 'append' })
          }).catch(function () {
            ctx.uiWorkspace.startSession(undefined, { prompt: basicProjectPrompt(company, project), whenDraftExists: 'append' })
          })
        }
        function AuditCompaniesPage(props) { return h(CompaniesPage, { onStartChat: onStartChat, ui: ctx, auth: props.auth }) }
        const sidebar = [
          { id: 'audit-dashboard', label: '今日', icon: DashboardIcon, page: withAuth(function (p) { return h(DashboardPage, Object.assign({}, p, { ui: ctx })) }), order: 29 },
          { id: 'audit-commerce', label: '商务', icon: CommerceIcon, page: withAuth(CommercePage), order: 29.5 },
          { id: 'audit-companies', label: '项目', icon: CompaniesIcon, page: withAuth(AuditCompaniesPage), order: 30 },
          { id: 'audit-kb', label: '知识库', icon: KbIcon, page: withAuth(KbPage), order: 31 },
          { id: 'audit-settings', label: '设置', icon: SystemIcon, page: withAuth(function (p) { return h(SettingsPage, Object.assign({}, p, { ui: ctx })) }), order: 40 },
        ]
        const hidden = [
          { id: 'audit-guide', page: withAuth(GuidePage) },
          { id: 'audit-about', page: withAuth(AboutPage) },
          { id: 'audit-clients', page: withAuth(ClientsContractsPage) },
          { id: 'audit-invoices', page: withAuth(InvoicesPage) },
          { id: 'audit-events', page: withAuth(EventsPage) },
          { id: 'audit-users', page: withAuth(UsersPage) },
          { id: 'audit-catalog', page: withAuth(ProgramCatalogPage) },
          { id: 'audit-mapping-rules', page: withAuth(MappingRulesPage) },
          { id: 'audit-engine', page: withAuth(EnginePanel) },
          { id: 'audit-system', page: withAuth(function (props) { return h(SystemPage, Object.assign({}, props, { ui: ctx })) }) },
        ]
        function registerMain(panel) {
          ctx.slots.inject('main', function () {
            return ctx.slots.register({ name: 'main', key: panel.id }, panel.page)
          })
        }
        sidebar.forEach(function (panel) {
          registerMain(panel)
          ctx.slots.inject('sidebar.panellist', function () {
            return ctx.slots.register({ name: 'sidebar.panellist', id: panel.id, order: panel.order, label: function () { return panel.label } }, panel.icon)
          })
        })
        hidden.forEach(registerMain)
      },
    }
  },
})
