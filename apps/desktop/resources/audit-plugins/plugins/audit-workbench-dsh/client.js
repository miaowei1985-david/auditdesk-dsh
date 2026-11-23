window.__ModuleLoader__.load({
  id: '@local/dsh-audit-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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
          h('input', { value: username, onChange: function (e) { setUsername(e.target.value) }, placeholder: '用户名', autoFocus: true, style: inputStyle }),
          h('input', { value: password, onChange: function (e) { setPassword(e.target.value) }, placeholder: '密码', type: 'password', style: inputStyle }),
          error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '10px' } }, error) : null,
          h('button', { type: 'submit', disabled: loading, style: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '13px', cursor: 'pointer' } }, loading ? '登录中…' : '登录'),
          h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '12px', lineHeight: 1.7 } },
            '演示账号：auditor/auditor123（审计员）、manager/manager123（项目经理）、partner/partner123（合伙人）、admin/admin123（管理员）')))
    }

    function withAuth(PageComponent) {
      return function AuthenticatedPage(props) {
        const auth = useAuth()
        if (!auth.user) return h(LoginForm, null)
        return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', padding: '5px 14px', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px', flexShrink: 0 } },
            h('span', { style: { color: COLORS.muted } }, auth.user.name + '（' + auth.user.role + '）'),
            h('button', { onClick: auth.logout, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '退出')),
          h('div', { style: { flex: 1, minHeight: 0 } }, h(PageComponent, Object.assign({}, props, { auth: auth }))))
      }
    }

    const CAT = {
      'K-01': '审计准则', 'K-02': '会计准则', 'K-03': '税法征管', 'K-04': '监管案例',
      'K-05': '职业道德', 'K-06': '质量控制', 'K-07': '底稿模板', 'K-08': '客户档案',
      'K-09': '历史经验', 'K-10': '行业专精', 'K-11': '银行函证', 'K-12': '法律法规', 'K-13': '重要性参数',
    }
    const COLORS = { text: 'inherit', muted: 'rgba(127,127,127,0.85)', line: 'rgba(127,127,127,0.22)', accent: '#2f7cf6', bg: 'rgba(127,127,127,0.06)' }

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
            let message = 'HTTP ' + resp.status
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
      return h('span', {
        style: { fontSize: '11px', padding: '1px 7px', borderRadius: '9px', whiteSpace: 'nowrap',
          color: props.tone === 'ok' ? '#166534' : props.tone === 'warn' ? '#92400e' : props.tone === 'bad' ? '#991b1b' : COLORS.muted,
          background: props.tone === 'ok' ? 'rgba(22,163,74,0.12)' : props.tone === 'warn' ? 'rgba(217,119,6,0.14)' : props.tone === 'bad' ? 'rgba(220,38,38,0.12)' : COLORS.bg },
      }, props.children)
    }

    function Section(props) {
      return h('div', { style: { borderBottom: '1px solid ' + COLORS.line, padding: '10px 14px' } }, props.children)
    }

    function Empty(props) {
      return h('div', { style: { padding: '24px', color: COLORS.muted, fontSize: '13px' } }, props.children)
    }

    // ---------- 客户与项目 ----------
    const PBC = [
      { name: '科目余额表', status: '已交', tone: 'ok' },
      { name: '序时账/明细账', status: '已交', tone: 'ok' },
      { name: '财务报表（未审）', status: '已交', tone: 'ok' },
      { name: '银行对账单及余额调节表', status: '待补', tone: 'warn' },
      { name: '已开立银行账户清单', status: '未交', tone: 'bad' },
      { name: '合同/发票（抽样）', status: '待补', tone: 'warn' },
    ]
    const WP = [
      { name: '货币资金审定表（ZA）', state: '已预填', tone: 'ok' },
      { name: '货币资金明细表（ZA-1）', state: '已填 9 格', tone: 'ok' },
      { name: '银行询证函控制表（ZA-4）', state: '待发函', tone: 'warn' },
      { name: '截止性测试（ZA-5）', state: '待执行', tone: 'warn' },
      { name: '余额调节表（ZA-7）', state: '待补资料', tone: 'bad' },
    ]
    const APPROVAL = [
      { name: '业务承接/保持', state: '已通过', tone: 'ok', note: '项目经理 · 2026-11-19' },
      { name: '独立性声明', state: '已通过', tone: 'ok', note: '项目组 · 2026-11-19' },
      { name: '审计计划', state: '已通过', tone: 'ok', note: '项目负责人 · 2026-11-20' },
      { name: '成果复核', state: '待提交', tone: 'warn', note: '底稿完成后提交' },
    ]

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

    function Zone(props) {
      const readOnly = Boolean(props.readOnly)
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
        const quickBar = h('div', { style: { marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', border: '1px solid ' + COLORS.line, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
          h('span', { style: { color: COLORS.muted } }, '当前角色：' + roleName + ' · 常用入口'),
          roleActions.map(function (pair) {
            return h('button', { key: 'role-' + pair[1], onClick: function () { if (props.onJumpZone) props.onJumpZone(pair[1]) },
              style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, pair[0])
          }))
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
        const card = function (title, value, detail, tone) {
          return h('div', { style: { flex: '1 1 180px', minWidth: '180px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
            h('div', { style: { fontSize: '12px', color: COLORS.muted } }, title),
            h('div', { style: { fontSize: '26px', fontWeight: 700, margin: '4px 0', color: tone || 'inherit' } }, String(value)),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, lineHeight: 1.6 } }, detail))
        }
        const progress = function (percent) {
          return h('div', { style: { height: '6px', borderRadius: '3px', background: 'rgba(127,127,127,0.2)', marginTop: '8px', overflow: 'hidden' } },
            h('div', { style: { width: Math.max(0, Math.min(100, percent)) + '%', height: '100%', background: percent >= 100 ? '#16a34a' : COLORS.accent } }))
        }
        return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
            h('div', null,
              h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, props.company + ' / ' + (props.project ? props.project.name : '')),
              h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '14px' } }, '期间：' + (props.project ? props.project.period : '') + ' · ' + ((props.project && props.project.business_type) || '年报审计') + ' · 项目概览')),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0 && !readOnly)
                ? h('button', { onClick: function () { if (props.onOpenRename) props.onOpenRename() },
                    style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '重命名')
                : null,
              (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0)
                ? h('button', { onClick: function () { if (props.onOpenDelete) props.onOpenDelete() },
                    style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid #b91c1c', background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '删除项目')
                : null,
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } },
                '校验归档包（ZIP）', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onVerifyArchiveFile) props.onVerifyArchiveFile(f); e.target.value = '' } })),
              h('button', { onClick: function () { if (props.onExportArchive) props.onExportArchive() }, disabled: props.exporting,
                style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                props.exporting ? '打包中…' : '导出归档包（ZIP）'),
              readOnly
                ? h('span', { style: { padding: '4px 10px', borderRadius: '10px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '12px' } }, '已归档 · 只读')
                : (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
                    ? h('button', { onClick: function () { if (props.onArchiveProject) props.onArchiveProject() },
                        style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '归档项目（只读）')
                    : null))),
          props.archiveVerifyMessage ? h('div', { style: { fontSize: '12px', marginBottom: '8px', color: props.archiveVerifyMessage.indexOf('通过') >= 0 && props.archiveVerifyMessage.indexOf('未') < 0 ? '#16a34a' : '#b45309' } }, props.archiveVerifyMessage) : null,
          quickBar,
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            h('div', { style: { flex: '1 1 180px', minWidth: '180px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
              h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '资料清单完成率'),
              h('div', { style: { fontSize: '26px', fontWeight: 700, margin: '4px 0' } }, pbcPercent + '%'),
              h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '已交 ' + finishedPbc + ' / 共 ' + pbcItems.length + ' 项（待补 ' + (pbcCounts['待补'] || 0) + '，未交 ' + (pbcCounts['未交'] || 0) + '）'),
              progress(pbcPercent)),
            card('审计底稿', wpItems.length, '已生成 ' + (wpCounts['已生成'] || 0) + ' · 进行中 ' + (wpCounts['进行中'] || 0) + ' · 待执行 ' + (wpCounts['待执行'] || 0)),
            card('已生成文件', generatedItems.length, '可预览/下载，按索引号回写台账'),
            card('审批状态', approvalItems.length, '已通过 ' + (approvalCounts['已通过'] || 0) + ' · 待审批 ' + (approvalCounts['待审批'] || 0) + ' · 待提交 ' + (approvalCounts['待提交'] || 0)),
            card('审计程序', programPercent + '%', '已完成 ' + programDone + ' / ' + programItems.length + ' 项'),
            card('项目成员', memberItems.length, memberItems.map(function (m) { return m.name }).join('、'))),
          h('div', { style: { marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '我的待办' + (props.todoOverdueOnly ? '（仅超期）' : '')),
              h('button', { onClick: function () { if (props.onSetTodoOverdueOnly) props.onSetTodoOverdueOnly(!props.todoOverdueOnly) }, style: { padding: '3px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, props.todoOverdueOnly ? '查看全部' : '只看超期')),
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
                      h('button', { onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'approve', '确认通过') },
                        style: { padding: '3px 8px', borderRadius: '6px', border: 0, background: '#16a34a', color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '通过'),
                      h('button', { onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'reject', '已驳回，请重新处理') },
                        style: { padding: '3px 8px', borderRadius: '6px', border: '1px solid #b91c1c', background: 'transparent', color: '#b91c1c', fontSize: '11px', cursor: 'pointer' } }, '驳回')))
                })
              : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无指派给你的审批；资料清单待补 ' + (pbcCounts['待补'] || 0) + ' 项')),
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
        const canConfirmMateriality = ['manager', 'partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
        const card = function (title, rows) {
          return h('div', { style: { flex: '1 1 260px', minWidth: '260px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, title),
            rows.map(function (row, index) {
              return h('div', { key: index, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '3px 0' } },
                h('span', { style: { color: COLORS.muted } }, row[0]),
                h('span', { style: { fontWeight: row[2] ? 600 : 400, color: row[2] ? '#b45309' : 'inherit' } }, row[1]))
            }))
        }
        return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
            h('div', null,
              h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '风险评估与重要性'),
              h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '14px' } }, '基于客户报表数据自动计算，审计师须结合职业判断确认')),
            readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', { onClick: function () { if (props.onAskAiNextSteps) props.onAskAiNextSteps() },
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, 'AI 建议后续程序'),
              h('select', { value: props.checklistKind, onChange: function (e) { if (props.onSetChecklistKind) props.onSetChecklistKind(e.target.value) },
                style: { padding: '7px 10px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: 'inherit', fontSize: '12px' } },
                h('option', { value: 'subsequent' }, '期后事项检查表'),
                h('option', { value: 'going' }, '持续经营评估'),
                h('option', { value: 'related' }, '关联方交易检查表'),
                h('option', { value: 'contingencies' }, '或有事项检查表'),
                h('option', { value: 'opening' }, '期初余额审计程序表'),
                h('option', { value: 'policies' }, '会计政策与估计检查表'),
                h('option', { value: 'fixed_assets' }, '固定资产审计底稿'),
                h('option', { value: 'payroll' }, '应付职工薪酬审计底稿'),
                h('option', { value: 'taxes' }, '应交税费审计底稿')),
              h('button', { onClick: function () { if (props.onGenerateChecklist) props.onGenerateChecklist() },
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '生成检查表（Word）'),
              h('button', { onClick: function () { if (props.onGenerateRiskDocx) props.onGenerateRiskDocx() },
                style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '生成风险评估底稿（Word）'))),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
            h('div', { style: { flex: '1 1 260px', minWidth: '260px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '重要性水平'),
                materiality ? h(Badge, { tone: materiality.confirmed ? 'ok' : 'warn' }, materiality.confirmed ? '已确认' : '自动测算') : null),
              materiality ? (matEditing
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '基准：' + materiality.basis),
                    h('input', { value: matOverall, onChange: function (e) {
                        const value = e.target.value
                        setMatOverall(value)
                        const numeric = Number(value)
                        if (value !== '' && !isNaN(numeric) && numeric > 0) {
                          setMatPerf(String(Math.round(numeric * 0.75 * 100) / 100))
                          setMatTrivial(String(Math.round(numeric * 0.05 * 100) / 100))
                        }
                      }, placeholder: '整体重要性',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h('input', { value: matPerf, onChange: function (e) { setMatPerf(e.target.value) }, placeholder: '实际执行重要性',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h('input', { value: matTrivial, onChange: function (e) { setMatTrivial(e.target.value) }, placeholder: '明显微小错报',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h('input', { value: matNote, onChange: function (e) { setMatNote(e.target.value) }, placeholder: '确认说明（选填）',
                      style: { padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                    h('div', { style: { display: 'flex', gap: '6px' } },
                      h('button', { onClick: function () { if (props.onConfirmMateriality) props.onConfirmMateriality({ basis: materiality.basis, overall: Number(matOverall), performance: Number(matPerf), trivial: Number(matTrivial), note: matNote }); setMatEditing(false) },
                        style: { flex: 1, padding: '6px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '确认'),
                      h('button', { onClick: function () { setMatEditing(false) },
                        style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消')))
                : h('div', null,
                    [['基准', materiality.basis], ['整体重要性', materiality.overall.toLocaleString()], ['实际执行重要性（75%）', materiality.performance.toLocaleString()], ['明显微小错报（5%）', materiality.trivial.toLocaleString()]].map(function (row, index) {
                      return h('div', { key: index, style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' } },
                        h('span', { style: { color: COLORS.muted } }, row[0]), h('span', null, row[1]))
                    }),
                    materiality.confirmed ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, '确认人：' + (materiality.confirmed_by || '') + ' · ' + (materiality.confirmed_at || '') + (materiality.note ? ' · ' + materiality.note : '')) : null,
                    (readOnly || !canConfirmMateriality) ? null : h('button', { onClick: function () { setMatEditing(true) },
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
            h('div', { style: { flex: '2 1 420px', minWidth: '420px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
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
                readOnly ? null : h('button', { onClick: function () { if (props.onGenerateTrialBalance) props.onGenerateTrialBalance() },
                  style: { padding: '7px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '生成试算平衡底稿（Word）')),
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
          h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '凭证抽样（MUS 货币单位抽样）'),
              (sampleResult && sampleResult.available && !readOnly) ? h('button', { onClick: exportSamplingWorkpaper,
                style: { padding: '7px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '生成抽样底稿（Word）') : null),
            readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' } },
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '样本量'),
              h('input', { value: sampleSize, onChange: function (e) { setSampleSize(e.target.value) }, style: { width: '64px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '种子'),
              h('input', { value: sampleSeed, onChange: function (e) { setSampleSeed(e.target.value) }, style: { width: '64px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('button', { onClick: runSampling, disabled: sampling, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, sampling ? '抽样中…' : '执行抽样')),
            sampleResult && sampleResult.available ? h('div', null,
              h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '6px' } },
                '总体 ' + sampleResult.population_count + ' 笔 / 合计 ' + Number(sampleResult.total).toLocaleString() + ' · 间隔 ' + Number(sampleResult.interval).toLocaleString() + ' · 覆盖率 ' + sampleResult.coverage + '%'),
              (sampleResult.samples || []).map(function (item) {
                return h('div', { key: 'sample-' + item.index, style: { display: 'grid', gridTemplateColumns: '40px 100px 80px 1fr 120px', gap: '8px', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid ' + COLORS.line } },
                  h('span', null, '#' + item.index), h('span', null, item.date), h('span', null, item.voucher),
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.summary + (item.name ? ' · ' + item.name : '')),
                  h('span', { style: { textAlign: 'right' } }, Number(item.amount).toLocaleString()))
              })) : (sampleResult && !sampleResult.available ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, sampleResult.message || '抽样不可用') : null)),
          h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '截止测试与存货监盘'),
              readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                h('button', { onClick: exportCutoff, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '生成截止测试底稿'),
                h('button', { onClick: exportInventoryCount, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '生成存货监盘表'))),
            readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } },
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '截止日'),
              h('input', { value: cutoffAsOf, onChange: function (e) { setCutoffAsOf(e.target.value) }, placeholder: 'YYYY-MM-DD', style: { width: '110px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '前后'),
              h('input', { value: cutoffDays, onChange: function (e) { setCutoffDays(e.target.value) }, style: { width: '52px', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '天'),
              h('button', { onClick: runCutoff, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '执行截止测试')),
            cutoffResult && cutoffResult.available ? h('div', { style: { fontSize: '12px', color: COLORS.muted } },
              '截止日 ' + cutoffResult.asof + '：日前 ' + cutoffResult.before_count + ' 笔 / 日后 ' + cutoffResult.after_count + ' 笔'
              + (cutoffResult.before_count + cutoffResult.after_count === 0 ? '（无临近凭证，调整截止日或天数）' : ''))
              : (cutoffResult && !cutoffResult.available ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, cutoffResult.message || '截止测试不可用') : null),
            (props.inventoryCounts || []).length ? h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed ' + COLORS.line } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
                h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '存货监盘录入（' + props.inventoryCounts.length + '）'),
                readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                  h('button', { onClick: function () { if (props.onSaveInventoryCounts) props.onSaveInventoryCounts() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '保存录入'),
                  h('button', { onClick: function () { if (props.onExportInventorySummary) props.onExportInventorySummary() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出汇总 Excel'),
                  h('button', { onClick: function () { if (props.onExportInventoryExceptions) props.onExportInventoryExceptions() }, style: { border: 0, background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '差异事项清单'),
                  h('button', { onClick: function () { if (props.onConfirmInventory) props.onConfirmInventory() }, style: { border: 0, background: 'transparent', color: '#16a34a', fontSize: '12px', cursor: 'pointer' } }, '确认监盘'))),
              h('div', { style: { display: 'grid', gridTemplateColumns: '60px 1fr 90px 70px 70px 70px 1fr 60px', gap: '6px', fontSize: '11px', color: COLORS.muted, padding: '3px 0' } },
                h('span', null, '编码'), h('span', null, '名称'), h('span', null, '账面金额'), h('span', null, '账面数量'), h('span', null, '实盘数量'), h('span', null, '差异'), h('span', null, '备注'), h('span', null, '状态')),
              (props.inventoryCounts || []).map(function (row) {
                return h('div', { key: 'inv-' + row.code, style: { display: 'grid', gridTemplateColumns: '60px 1fr 90px 70px 70px 70px 1fr 60px', gap: '6px', alignItems: 'center', fontSize: '12px', padding: '2px 0' } },
                  h('span', null, row.code), h('span', null, row.name), h('span', null, Number(row.book_amount).toLocaleString()),
                  h('input', { value: String(row.book_qty || ''), onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'book_qty', e.target.value) }, style: { width: '58px', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h('input', { value: String(row.counted_qty || ''), onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'counted_qty', e.target.value) }, style: { width: '58px', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h('span', { style: { color: Number(row.difference || 0) === 0 ? COLORS.muted : '#b45309' } }, String(row.difference || 0)),
                  h('input', { value: row.note || '', onChange: function (e) { if (props.onUpdateInventoryRow) props.onUpdateInventoryRow(row.code, 'note', e.target.value) }, style: { width: '100%', padding: '3px 5px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                  h(Badge, { tone: row.status === '已确认' ? 'ok' : row.status === '已录入' ? 'warn' : 'muted' }, row.status))
              }),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '6px', fontSize: '11px' } },
                h('span', { style: { color: COLORS.muted } }, '监盘日期'),
                h('input', { value: (props.inventoryMeta && props.inventoryMeta.counted_at) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('counted_at', e.target.value) }, placeholder: 'YYYY-MM-DD', style: { width: '92px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h('span', { style: { color: COLORS.muted } }, '监盘人'),
                h('input', { value: (props.inventoryMeta && props.inventoryMeta.auditor_rep) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('auditor_rep', e.target.value) }, placeholder: '监盘人', style: { width: '80px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h('span', { style: { color: COLORS.muted } }, '陪同人'),
                h('input', { value: (props.inventoryMeta && props.inventoryMeta.client_rep) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('client_rep', e.target.value) }, placeholder: '客户陪同人', style: { width: '100px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                h('input', { value: (props.inventoryMeta && props.inventoryMeta.note) || '', onChange: function (e) { if (props.onUpdateInventoryMeta) props.onUpdateInventoryMeta('note', e.target.value) }, placeholder: '监盘说明', style: { flex: 1, minWidth: '100px', padding: '3px 6px', borderRadius: '5px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
                readOnly ? null : h('button', { onClick: function () { if (props.onSaveInventoryMeta) props.onSaveInventoryMeta() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '保存监盘信息')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', fontSize: '12px', flexWrap: 'wrap' } },
                h('span', { style: { color: COLORS.muted } }, '盘点表扫描件（' + (props.inventoryAttachments || []).length + '）'),
                readOnly ? null : h('label', { style: { color: COLORS.accent, cursor: 'pointer' } },
                  '上传扫描件', h('input', { type: 'file', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onUploadInventoryAttachment) props.onUploadInventoryAttachment(f); e.target.value = '' } })),
                (props.inventoryAttachments || []).map(function (item) {
                  return h('button', { key: 'invatt-' + item.id, onClick: function () { if (props.onPreviewInventoryAttachment) props.onPreviewInventoryAttachment(item) },
                    style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '查看 ' + item.filename)
                }))) : null),
          (function () {
            const confirmation = analysis.confirmation || {}
            const aging = analysis.aging || {}
            if (!confirmation.available && !aging.available) return null
            return h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '函证与账龄'),
                readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                  confirmation.available ? h('button', { onClick: exportConfirmation, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '生成函证清单（Word）') : null,
                  aging.available ? h('button', { onClick: exportAging, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '生成账龄分析（Word）') : null)),
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
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
                  h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '函证回函跟踪（' + (props.confirmations || []).length + '）'),
                  readOnly ? null : h('div', { style: { display: 'flex', gap: '10px' } },
                    h('button', { onClick: function () { if (props.onExportConfirmationDifferences) props.onExportConfirmationDifferences() },
                      style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '差异调节表（Word）'),
                    h('button', { onClick: function () { if (props.onSyncConfirmations) props.onSyncConfirmations() },
                      style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '同步台账'))),
                (props.confirmations || []).length
                  ? (props.confirmations || []).map(function (item) {
                      const replied = Math.abs(Number(item.replied_amount || 0)) > 0 || item.status === '已回函'
                      return h('div', { key: 'conf-' + item.id, style: { padding: '3px 0', borderBottom: '1px solid ' + COLORS.line } },
                        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' } },
                          h('span', null, item.code + ' ' + item.name + ' · ' + Number(item.balance).toLocaleString()
                            + (replied ? ' · 回函 ' + Number(item.replied_amount).toLocaleString() + ' · 差异 ' + Number(item.difference).toLocaleString() : '')),
                          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                            (!readOnly && item.status !== '已回函') ? h('button', { onClick: function () { setReplyItem(replyItem === item.id ? null : item.id); setReplyAmount(String(item.balance)); setReplyNote('') },
                              style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '登记回函') : null,
                            item.attachment_name ? h('button', { onClick: function () { if (props.onPreviewConfirmationAttachment) props.onPreviewConfirmationAttachment(item) },
                              style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '查看扫描件') : null,
                            readOnly ? null : h('label', { style: { color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } },
                              '上传扫描件', h('input', { type: 'file', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onUploadConfirmationAttachment) props.onUploadConfirmationAttachment(item.id, f); e.target.value = '' } })),
                            h('span', { onClick: function () { if (!readOnly && props.onCycleConfirmation) props.onCycleConfirmation(item) }, title: '点击切换回函状态', style: { cursor: 'pointer' } },
                              h(Badge, { tone: item.status === '已回函' ? 'ok' : item.status === '未回函' ? 'bad' : item.status === '已发' ? 'warn' : 'muted' }, item.status)))),
                        replyItem === item.id ? h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
                          h('input', { value: replyAmount, onChange: function (e) { setReplyAmount(e.target.value) }, placeholder: '回函金额', style: { width: '110px', padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                          h('input', { value: replyNote, onChange: function (e) { setReplyNote(e.target.value) }, placeholder: '差异说明', style: { flex: 1, minWidth: '80px', padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
                          h('button', { onClick: function () { if (props.onReplyConfirmation) props.onReplyConfirmation(item.id, Number(replyAmount) || 0, replyNote); setReplyItem(null) },
                            style: { padding: '4px 10px', borderRadius: '6px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '保存')) : null)
                    })
                  : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '尚未同步，点击「同步台账」生成')))
          })(),
          (props.matHistory || []).length ? h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '重要性调整历史（' + props.matHistory.length + '）'),
            (props.matHistory || []).map(function (history) {
              return h('div', { key: 'mh-' + history.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '4px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('span', null, history.actor + '：整体 ' + Number(history.overall).toLocaleString() + ' / 执行 ' + Number(history.performance).toLocaleString() + ' / 微小 ' + Number(history.trivial).toLocaleString() + (history.note ? ' · ' + history.note : '')),
                h('span', { style: { color: COLORS.muted } }, history.created_at))
            })) : null,
          h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '项目数据导入'),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '8px' } }, '导入科目余额表与序时账后，可执行试算平衡、勾稽与抽样程序（支持 .xlsx / .xls / .csv）。'),
            readOnly ? h('div', { style: { fontSize: '12px', color: '#b45309' } }, '项目已归档，不可导入') : h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                '上传科目余额表', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportData) props.onImportData('tb', f); e.target.value = '' } })),
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                '上传序时账/明细账', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportData) props.onImportData('journal', f); e.target.value = '' } })),
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                '上传财务报表（xlsx）', h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onImportFinancialStatements) props.onImportFinancialStatements(f); e.target.value = '' } })),
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } },
                '校验科目余额表', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onValidateImportFile) props.onValidateImportFile('tb', f); e.target.value = '' } })),
              h('label', { style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } },
                '校验序时账', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onValidateImportFile) props.onValidateImportFile('journal', f); e.target.value = '' } }))),
            h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px', fontSize: '11px' } },
              h('span', { style: { color: COLORS.muted } }, '标准模板：'),
              h('button', { onClick: function () { if (props.onDownloadImportTemplate) props.onDownloadImportTemplate('tb') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载科目余额表模板'),
              h('button', { onClick: function () { if (props.onDownloadImportTemplate) props.onDownloadImportTemplate('journal') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载序时账模板'),
              h('button', { onClick: function () { if (props.onDownloadFinancialTemplate) props.onDownloadFinancialTemplate() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '下载财务报表模板')),
            readOnly ? null : h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' } },
              h('label', { style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, color: COLORS.muted, cursor: 'pointer' } },
                props.multiLoading ? '读取中…' : '多工作表文件', h('input', { type: 'file', accept: '.xlsx,.xls', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onChooseMultiSheetFile) props.onChooseMultiSheetFile(f); e.target.value = '' } })),
              (props.multiSheets || []).length ? h('select', { value: props.multiKind, onChange: function (e) { if (props.onSetMultiKind) props.onSetMultiKind(e.target.value) }, style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                h('option', { value: 'tb' }, '科目余额表'), h('option', { value: 'journal' }, '序时账')) : null,
              (props.multiSheets || []).length ? h('select', { value: props.multiSheetIndex, onChange: function (e) { if (props.onSetMultiSheetIndex) props.onSetMultiSheetIndex(e.target.value) }, style: { padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                props.multiSheets.map(function (name, index) { return h('option', { key: name + index, value: String(index) }, name) })) : null,
              (props.multiSheets || []).length ? h('button', { onClick: function () { if (props.onSubmitMultiSheet) props.onSubmitMultiSheet('validate') }, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '校验所选') : null,
              (props.multiSheets || []).length ? h('button', { onClick: function () { if (props.onSubmitMultiSheet) props.onSubmitMultiSheet('import') }, style: { padding: '5px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '导入所选') : null),
            props.importMessage ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' } },
              h('div', { style: { fontSize: '12px', color: props.importMessage.indexOf('失败') >= 0 ? '#b91c1c' : '#16a34a' } }, props.importMessage),
              (props.importMessage.indexOf('勾稽提示') >= 0 && !readOnly) ? h('button', { onClick: function () { if (props.onGenerateTrialBalance) props.onGenerateTrialBalance() },
                style: { padding: '4px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '生成试算平衡底稿') : null) : null,
            (props.dataEvents || []).length ? h('div', { style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } },
              h('div', { style: { marginBottom: '3px' } }, '最近导入：'),
              (props.dataEvents || []).slice(0, 5).map(function (event, index) {
                return h('div', { key: 'de-' + index, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
                  h('span', null, (event.item_name || '') + ' · ' + (event.actor || '') + (event.new_status ? ' · ' + event.new_status : '')),
                  h('span', null, event.created_at))
              })) : null))
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
                  h('button', { onClick: function () { if (props.onCheckAttachment) props.onCheckAttachment(att) },
                    title: '核对数字勾稽/公式/账面差异',
                    style: { padding: '2px 6px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '核对'))
              })
              return h('div', { key: item.id, style: { padding: '8px 0', borderBottom: '1px solid ' + COLORS.line } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  h('div', null,
                    h('span', { style: { fontSize: '13px' } }, item.name),
                    item.note ? h('span', { style: { fontSize: '11px', color: COLORS.muted, marginLeft: '8px' } }, item.note) : null),
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                    readOnly ? null : h('label', { style: { fontSize: '11px', color: COLORS.accent, cursor: 'pointer' } }, '上传附件',
                      h('input', { type: 'file', style: { display: 'none' },
                        onChange: function (event) {
                          const file = event.target.files && event.target.files[0]
                          if (file && props.onUploadAttachment) props.onUploadAttachment(item, file)
                          event.target.value = ''
                        } })),
                    readOnly ? null : h('button', { onClick: function () { if (props.onDeletePbc) props.onDeletePbc(item) }, 'data-pbc-delete': String(item.id),
                      style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } }, '删除'),
                    h('span', {
                      onClick: function () { if (!readOnly && props.onCyclePbc) props.onCyclePbc(item) },
                      title: '点击切换：未交 → 待补 → 已交',
                      'data-pbc-id': String(item.id),
                      style: { cursor: 'pointer' },
                    }, h(Badge, { tone: toneOf(item.status) }, item.status)))),
                attachments.length ? h('div', null, attachments) : null)
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无资料清单，先新增应收资料')])
        const checkPanel = props.clientCheckMsg ? h('div', { style: { marginTop: '10px', padding: '10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, fontSize: '12px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, props.clientCheckMsg),
          props.clientCheck ? h('button', { onClick: function () { if (props.onExportClientCheck) props.onExportClientCheck() },
            style: { marginBottom: '6px', padding: '4px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '导出核对记录（Word）') : null,
          props.clientCheck ? h('div', null,
            h('div', { style: { color: COLORS.muted, marginBottom: '6px' } }, '文件：' + (props.clientCheck.filename || '') + ' · 共 ' + ((props.clientCheck.summary || {}).total || 0) + ' 项（高 ' + ((props.clientCheck.summary || {}).high || 0) + ' / 中 ' + ((props.clientCheck.summary || {}).medium || 0) + '）'),
            (props.clientCheck.findings || []).slice(0, 12).map(function (f, i) {
              return h('div', { key: 'cc-' + i, style: { padding: '3px 0', borderTop: i ? '1px dashed ' + COLORS.line : 'none' } },
                h('span', { style: { color: f.severity === 'high' ? '#b91c1c' : '#b45309', marginRight: '6px' } }, f.severity === 'high' ? '高' : '中'),
                f.sheet + '!' + f.cell + '：' + f.message,
                h('button', { onClick: function () { if (props.onAddMisstatement) props.onAddMisstatement(f) },
                  style: { marginLeft: '8px', padding: '1px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '记入未更正'))
            })) : null) : null
        const addForm = h('div', { style: { display: 'flex', gap: '6px', marginTop: '10px' } },
          h('input', { value: props.newPbcName || '', onChange: function (event) { if (props.onPbcNameChange) props.onPbcNameChange(event.target.value) },
            placeholder: '新增资料项名称（如：银行开户许可证）',
            style: { flex: 1, padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
          readOnly ? null : h('button', { onClick: function () { if (props.onAddPbc) props.onAddPbc(props.newPbcName || '') },
            style: { padding: '7px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '+ 新增资料项'))
        return h('div', null,
          h(Section, null, h('div', { style: { fontSize: '13px' } }, '应收资料清单（PBC）'), h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '2px' } }, '上传底表、点击状态切换；所有变更写入操作留痕')),
          h('div', { style: { padding: '6px 14px' } }, rows, checkPanel, addForm), eventsBlock('pbc'))
      }
      if (props.zone === '审计底稿') {
        const toneOfWp = function (status) { return status === '已完成' || status === '已执行' || status === '已预填' || status === '已生成' ? 'ok' : status === '进行中' ? 'warn' : status === '不适用' ? 'muted' : 'bad' }
        const items = props.wp === null ? null : props.wp
        const wpFilter = props.wpStatusFilter || 'all'
        const visibleItems = items === null ? null : items.filter(function (item) {
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
                h('span', { onClick: function () { if (!readOnly && props.onCycleWp) props.onCycleWp(item) }, title: '点击切换执行状态', 'data-wp-id': String(item.id), style: { cursor: 'pointer' } },
                  h(Badge, { tone: toneOfWp(item.status) }, item.status)))
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
              h('button', { onClick: function () { if (props.onPreviewWorkpaper) props.onPreviewWorkpaper(item) },
                style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '预览'),
              h('button', { onClick: function () { if (props.onDownloadWorkpaper) props.onDownloadWorkpaper(item) },
                style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载')))
        })
        return h('div', null,
          h(Section, null, h('div', { style: { fontSize: '13px' } }, '审计底稿（审计员产出）'), h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '2px' } }, '按事务所模板与索引号生成，点击状态可切换执行状态')),
          h('div', { style: { padding: '8px 14px 0', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' } },
            h('span', { style: { color: COLORS.muted } }, '底稿统计：共 ' + generated.length + ' 份 · 台账 ' + (items ? items.length : 0) + ' 项'),
            h('input', { value: props.wpSearch || '', placeholder: '搜索底稿名称/索引/说明', onChange: function (e) { if (props.onSetWpSearch) props.onSetWpSearch(e.target.value) },
              style: { width: '170px', padding: '4px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }),
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
          h('div', { style: { padding: '6px 14px' } }, rows),
          h('div', { style: { padding: '10px 14px', borderTop: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } },
              h('select', { value: props.reviewerName || '待复核', onChange: function (e) { if (props.onReviewerNameChange) props.onReviewerNameChange(e.target.value) },
                style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
                h('option', { value: '待复核' }, '复核人：待复核'),
                (props.members || []).map(function (m) { return h('option', { key: m.id, value: m.name }, '复核人：' + m.name) })),
              h('input', { type: 'date', value: props.generatedDate || '', onChange: function (e) { if (props.onGeneratedDateChange) props.onGeneratedDateChange(e.target.value) },
                style: { padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
              h('button', { onClick: function () { if (props.onGenerateAll) props.onGenerateAll() }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: '#16a34a', color: '#fff', fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '一键生成常用底稿（4 类）'),
              ['tb', 'fs', 'voucher'].map(function (k) {
                const label = k === 'tb' ? '余额表' : k === 'fs' ? '报表' : '凭证'
                const list = props.localAtts || []
                const value = (props.localAtt && props.localAtt[k]) || ''
                return h('select', { key: k, value: value, onChange: function (e) { if (props.onLocalAttChange) props.onLocalAttChange(Object.assign({}, props.localAtt || {}, { [k]: e.target.value })) },
                  style: { padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', maxWidth: '160px' } },
                  h('option', { value: '' }, label + '：自动'), list.map(function (a) { return h('option', { key: k + a.id, value: a.id }, a.filename) }))
              }),
              h('button', { onClick: function () { if (props.onGenerateLocal) props.onGenerateLocal() }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: '#7c3aed', color: '#fff', fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '本机引擎生成（全量勾稽）'),
              h('button', { onClick: function () { if (props.onExportWorkpapers) props.onExportWorkpapers() },
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '打包下载全部底稿（ZIP）'),
              h('button', { onClick: function () { if (props.onExportWorkpaperList) props.onExportWorkpaperList() }, style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出底稿台账（CSV）'),
              h('label', { style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } },
                '校验底稿包（ZIP）', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f && props.onVerifyWorkpapersZip) props.onVerifyWorkpapersZip(f); e.target.value = '' } })),
              props.wpsVerifyMessage ? h('span', { style: { fontSize: '11px', color: props.wpsVerifyMessage.indexOf('通过') >= 0 && props.wpsVerifyMessage.indexOf('未') < 0 ? '#16a34a' : '#b45309' } }, props.wpsVerifyMessage) : null,
              h('button', { onClick: function () { if (props.onGenerateWorkpaper) props.onGenerateWorkpaper('currency') }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '生成货币资金底稿（ZA）'),
              h('button', { onClick: function () { if (props.onGenerateWorkpaper) props.onGenerateWorkpaper('receivable') }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '生成应收账款底稿（ZE）'),
              h('button', { onClick: function () { if (props.onGenerateWorkpaper) props.onGenerateWorkpaper('inventory') }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '生成存货底稿（ZJ）'),
              h('button', { onClick: function () { if (props.onGenerateWorkpaper) props.onGenerateWorkpaper('revenue') }, disabled: props.generating || readOnly,
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                props.generating ? '生成中…' : '生成营业收入成本底稿（SA）'),
              props.generateMessage ? h('span', { style: { fontSize: '11px', color: COLORS.muted } }, props.generateMessage) : null),
            generated.length ? h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' } },
                h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '已生成底稿（' + filteredGenerated.length + (props.generatedKind && props.generatedKind !== 'all' ? ' / ' + generated.length : '') + '）'),
                h('select', { value: props.generatedKind || 'all', onChange: function (e) { if (props.onSetGeneratedKind) props.onSetGeneratedKind(e.target.value) },
                  style: { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } },
                  h('option', { value: 'all' }, '全部类型'),
                  kindOptions.map(function (kind) { return h('option', { key: kind, value: kind }, KIND_LABELS[kind] || kind) }))),
              generatedRows) : h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '还没有生成底稿')),
          eventsBlock('workpaper'))
      }
      if (props.zone === '审计程序') {
        const rows = props.programs || []
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
        return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
            h('div', { style: { minWidth: '240px' } },
              h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '2px' } }, '审计程序清单'),
              h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '业务类型：' + (((props.project || {}).business_type) || '年报审计') + ' · 共 ' + rows.length + ' 项')),
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
              h('button', { onClick: function () { if (props.onExportPrograms) props.onExportPrograms() }, style: btnStyle }, '导出 Word'),
              h('button', { onClick: function () { if (props.onExportProgramsXlsx) props.onExportProgramsXlsx() }, style: btnStyle }, '导出 Excel'),
              readOnly ? null : h('button', { onClick: function () { if (props.onCompletePrograms) props.onCompletePrograms() }, style: Object.assign({}, btnStyle, { border: '1px solid ' + COLORS.accent, color: COLORS.accent }) }, '补全程序清单'),
              readOnly ? null : h('button', { onClick: function () { if (props.onSavePrograms) props.onSavePrograms() }, style: Object.assign({}, btnStyle, { border: 0, background: COLORS.accent, color: '#fff' }) }, '保存'))),
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
                    h('input', { value: row.note || '', onChange: function (e) { if (props.onUpdateProgramRow) props.onUpdateProgramRow(row.id, 'note', e.target.value) }, placeholder: '备注/证据', style: { padding: '4px 7px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', minWidth: 0 } }))
                }))
            })
          })() : h('div', { style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无审计程序，点「补全程序清单」生成全量清单'),
          (props.programEvents || []).filter(function (event) { return event.old_status }).length ? h('div', { style: { marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '最近变更（' + (props.programEvents || []).filter(function (event) { return event.old_status }).length + '）'),
              h('button', { onClick: function () { if (props.onExportProgramHistory) props.onExportProgramHistory() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出变更历史 Excel')),
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
            style: { marginBottom: '12px', padding: '9px 16px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '13px', cursor: 'pointer' },
          }, '+ 新建项目对话'),
          h('div', null, sessionRows))
      }
      if (props.zone === '审批状态') {
        const items = props.approvals === null ? null : props.approvals
        const statusFilter = props.approvalFilter || 'all'
        const filteredItems = items === null ? null : (statusFilter === 'all' ? items : items.filter(function (item) { return item.status === statusFilter }))
        const user = (props.auth && props.auth.user) || { name: '未登录', role: 'auditor', username: '' }
        const canApprove = ['manager', 'partner', 'kb-admin', 'admin'].indexOf(user.role) >= 0
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
                actions.push(h('button', { key: 'submit', onClick: function () { if (props.onSubmitApproval) props.onSubmitApproval(item, approvers[item.id] || (approverMembers[0] && approverMembers[0].username)) },
                  style: { marginTop: '8px', padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '提交审批'))
              }
              const isAssigned = !item.assigned_username || item.assigned_username === user.username || user.role === 'kb-admin' || user.role === 'admin'
              if (item.status === '待审批' && !canApprove) {
                actions.push(h('div', { key: 'denied', style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } }, '当前身份为「' + user.name + '」，无审批权限（需项目经理/合伙人）'))
              }
              if (item.status === '待审批' && canApprove && !isAssigned) {
                actions.push(h('div', { key: 'waiting', style: { marginTop: '8px', fontSize: '11px', color: COLORS.muted } }, '等待指派审批人「' + (item.assigned_name || item.assigned_username) + '」审批'))
              }
              if (item.status === '待审批' && canApprove && isAssigned) {
                actions.push(h('input', { key: 'op', placeholder: '审批意见', value: opinions[item.id] || '',
                  onChange: function (e) { const v = e.target.value; setOpinions(function (prev) { const next = Object.assign({}, prev); next[item.id] = v; return next }) },
                  style: { marginTop: '8px', width: '260px', padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }))
                actions.push(h('button', { key: 'ok', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'approve', opinions[item.id] || '') },
                  style: { marginTop: '8px', marginLeft: '6px', padding: '6px 12px', borderRadius: '7px', border: 0, background: '#16a34a', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '通过'))
                actions.push(h('button', { key: 'no', onClick: function () { if (props.onDecideApproval) props.onDecideApproval(item, 'reject', opinions[item.id] || '') },
                  style: { marginTop: '8px', marginLeft: '6px', padding: '6px 12px', borderRadius: '7px', border: 0, background: '#dc2626', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '驳回'))
              }
              const meta = [
                item.submitter ? '提交：' + item.submitter : '',
                item.assigned_name ? '指派审批：' + item.assigned_name : '',
                item.approver ? '审批：' + item.approver : '',
                item.opinion ? '意见：' + item.opinion : '',
                item.decided_at || item.submitted_at || '',
              ].filter(Boolean).join(' · ')
              return h('div', { key: item.id, style: { padding: '10px 0', borderBottom: '1px solid ' + COLORS.line } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  h('div', null,
                    h('span', { style: { fontSize: '13px' } }, item.title),
                    h('span', { style: { fontSize: '11px', color: COLORS.muted, marginLeft: '8px' } }, item.kind === 'engagement' ? '立项' : item.kind === 'review' ? '成果复核' : item.kind)),
                  h(Badge, { tone: toneOf(item.status) }, item.status)),
                meta ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, meta) : null,
                item.overdue_days ? h('div', { style: { marginTop: '4px' } }, h(Badge, { tone: item.overdue_days > 7 ? 'bad' : 'warn' }, '超期 ' + item.overdue_days + ' 天')) : null,
                actions.length ? h('div', null, actions) : null)
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无审批事项')])
        const identityBar = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px' } },
          h('span', { style: { color: COLORS.muted } }, '当前身份：'),
          h('span', { style: { fontWeight: 600 } }, user.name + '（' + user.role + '）'),
          h('span', { style: { color: canApprove ? '#16a34a' : '#b45309' } }, canApprove ? '可审批' : '只读/提交'),
          h('button', { onClick: function () { if (props.onExportApprovals) props.onExportApprovals() }, style: { marginLeft: 'auto', padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出 CSV'),
          h('select', { value: statusFilter, onChange: function (e) { if (props.onSetApprovalFilter) props.onSetApprovalFilter(e.target.value) },
            style: { marginLeft: 'auto', padding: '5px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
            h('option', { value: 'all' }, '全部状态（' + (items ? items.length : 0) + '）'),
            h('option', { value: '待提交' }, '待提交'),
            h('option', { value: '待审批' }, '待审批'),
            h('option', { value: '已通过' }, '已通过'),
            h('option', { value: '已驳回' }, '已驳回')))
        const memberList = props.members || []
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
        const membersBlock = h('div', { style: { marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid ' + COLORS.line } },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, '项目成员（' + memberList.length + '）'),
          memberList.map(function (m) {
            return h('div', { key: 'm-' + m.id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '3px 0', fontSize: '12px' } },
              h('span', null, m.name + '（' + m.role + '）'),
              h('button', { onClick: function () { if (props.onRemoveMember) props.onRemoveMember(m) },
                style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '11px', cursor: 'pointer' } }, '移除'))
          }),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
            h('input', { value: props.newMemberName || '', onChange: function (e) { if (props.onNewMemberNameChange) props.onNewMemberNameChange(e.target.value) }, placeholder: '用户名（如 partner）',
              style: { width: '160px', padding: '6px 8px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
            h('button', { onClick: function () { if (props.onAddMember) props.onAddMember(props.newMemberName || '') },
              style: { padding: '6px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '+ 添加成员')))
        return h('div', { style: { padding: '20px', maxWidth: '720px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
            h('div', { style: { fontSize: '14px' } }, '审批状态'),
            canApprove ? h('button', { onClick: function () { if (props.onEscalateApprovals) props.onEscalateApprovals() },
              style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '超期升级提醒') : null),
          props.escalateMessage ? h('div', { style: { fontSize: '12px', color: '#b45309', marginBottom: '8px' } }, props.escalateMessage) : null,
          membersBlock,
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '6px' } }, '立项审批与成果复核：提交 → 待审批 → 通过/驳回，操作全程留痕。'),
          identityBar,
          h('div', null, rows), eventsBlock('approval'))
      }
      if (props.zone === '报告') {
        const report = props.report || {}
        const checklist = report.checklist || []
        const opinion = report.opinion || null
        const draft = report.draft || null
        const statusTone = function (status) { return status === 'OK' ? 'ok' : status === 'TODO' ? 'warn' : 'bad' }
        const button = function (label, onClick, disabled) {
          return h('button', { onClick: onClick, disabled: disabled,
            style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, label)
        }
        return h('div', { style: { padding: '20px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '审计报告'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '12px' } }, '基于项目数据与底稿检查结果生成：检查清单 / 审计意见 / 报告初稿（AI 初稿，需人工复核）'),
          h('div', { style: { marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', border: '1px solid ' + COLORS.line, fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '报告要素'),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
              h('span', { style: { color: COLORS.muted } }, '审计意见类型'),
              h('select', { value: (props.reportElements || {}).opinion_type || '', onChange: function (e) { if (props.onSaveReportElements) props.onSaveReportElements({ opinion_type: e.target.value, emphasis: (props.reportElements || {}).emphasis || '', other_matters: (props.reportElements || {}).other_matters || '' }) },
                style: { padding: '5px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
                h('option', { value: '' }, '未选择'),
                h('option', { value: '标准无保留意见' }, '标准无保留意见'),
                h('option', { value: '带强调事项段的无保留意见' }, '带强调事项段的无保留意见'),
                h('option', { value: '保留意见' }, '保留意见'),
                h('option', { value: '否定意见' }, '否定意见'),
                h('option', { value: '无法表示意见' }, '无法表示意见')),
              props.reportElementsMsg ? h('span', { style: { color: '#16a34a' } }, props.reportElementsMsg) : null),
            h('div', { style: { marginBottom: '4px', color: COLORS.muted } }, '强调事项段'),
            h('textarea', { value: (props.reportElements || {}).emphasis || '', rows: 2, onChange: function (e) { setTmpElements({ emphasis: e.target.value }) },
              style: { width: '100%', marginBottom: '6px', padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
            h('div', { style: { marginBottom: '4px', color: COLORS.muted } }, '其他事项段'),
            h('textarea', { value: (props.reportElements || {}).other_matters || '', rows: 2, onChange: function (e) { setTmpElements({ other_matters: e.target.value }) },
              style: { width: '100%', marginBottom: '6px', padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
            h('button', { onClick: function () { if (props.onSaveReportElements) props.onSaveReportElements(Object.assign({}, props.reportElements || {}, tmpElements)) },
              style: { padding: '5px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '保存报告要素')),
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
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' } },
            button('生成检查清单', function () { if (props.onLoadChecklist) props.onLoadChecklist() }),
            button('生成审计意见', function () { if (props.onLoadOpinion) props.onLoadOpinion() }),
            h('button', { onClick: function () { if (props.onGenerateDraft) props.onGenerateDraft() }, disabled: readOnly || props.reportLoading,
              style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: readOnly ? 'rgba(127,127,127,0.3)' : COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } },
              props.reportLoading ? '生成中…' : '生成报告初稿（Markdown）'),
            draft ? h('button', { onClick: function () { if (props.onDownloadDraft) props.onDownloadDraft() },
              style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '下载初稿 Markdown') : null,
            draft ? h('button', { onClick: function () { if (props.onExportDocx) props.onExportDocx(draft.version_id) },
              style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: '#2f7cf6', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '导出 Word（.docx）') : null,
            draft ? h('button', { onClick: function () { if (props.onExportPdf) props.onExportPdf(draft.version_id) },
              style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: '#b91c1c', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '导出 PDF') : null,
            h('button', { onClick: function () { if (props.onGenerateLetter) props.onGenerateLetter() },
              style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '生成管理层声明书'),
            h('button', { onClick: function () { if (props.onLoadVersions) props.onLoadVersions() },
              style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '历史版本')),
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
                    item.status !== '已询问' ? h('button', { onClick: function () { if (props.onUpdateMisstatement) props.onUpdateMisstatement(item.id, '已询问') }, style: { padding: '1px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '10px', cursor: 'pointer' } }, '已询问') : null,
                    item.status !== '已调整' ? h('button', { onClick: function () { if (props.onUpdateMisstatement) props.onUpdateMisstatement(item.id, '已调整') }, style: { padding: '1px 6px', borderRadius: '6px', border: '1px solid #16a34a', background: 'transparent', color: '#16a34a', fontSize: '10px', cursor: 'pointer' } }, '已调整') : null))
              }))
          })(),
          opinion ? h('div', { style: { marginBottom: '16px', padding: '12px', borderRadius: '10px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, '审计意见：' + (opinion.level || '')),
            h('div', { style: { fontSize: '12px', lineHeight: 1.7 } }, opinion.text || ''),
            (opinion.limits || []).length ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '6px' } }, '限制事项：' + (opinion.limits || []).join('；')) : null) : null,
          draft ? h('div', null,
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '报告初稿：' + draft.filename),
            h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: 1.7, background: COLORS.bg, padding: '12px', borderRadius: '10px', maxHeight: '420px', overflow: 'auto' } }, draft.content)) : null,
          (report.versions || []).length ? h('div', { style: { marginTop: '16px' } },
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
              const canFinalize = ['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
              return h('div', { key: 'v-' + version.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, version.filename + ' · ' + version.created_by + ' · ' + version.created_at + (version.status === '已复核' && version.reviewed_by ? (' · 复核：' + version.reviewed_by + (version.finalized_at ? '（' + version.finalized_at + '）' : '')) : '')),
                  h(Badge, { tone: (version.status === '已定稿' || version.status === '已复核') ? 'ok' : version.status === '复核中' ? 'warn' : 'muted' }, version.status || '草稿')),
                h('div', { style: { display: 'flex', gap: '10px' } },
                  version.status !== '已定稿' ? h('button', { onClick: function () { if (props.onSubmitReview) props.onSubmitReview(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '提交复核') : null,
                  (version.status !== '已定稿' && canFinalize) ? h('button', { onClick: function () { if (props.onFinalizeReport) props.onFinalizeReport(version.id) }, style: { border: 0, background: 'transparent', color: '#16a34a', fontSize: '12px', cursor: 'pointer' } }, '定稿') : null,
                  h('button', { onClick: function () { if (props.onDownloadVersion) props.onDownloadVersion(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载 MD'),
                  h('button', { onClick: function () { if (props.onExportDocx) props.onExportDocx(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出 Word'),
                  h('button', { onClick: function () { if (props.onExportPdf) props.onExportPdf(version.id) }, style: { border: 0, background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '导出 PDF')))
            })) : null)
      }
      return h('div', null)
    }

    function CompaniesPage(props) {
      const state = React.useState({ loading: true, companies: [], error: '' })
      const companies = state[0].companies; const loading = state[0].loading; const error = state[0].error; const setData = state[1]
      const savedContext = (function () { try { return JSON.parse(localStorage.getItem('auditdesk.lastContext') || '{}') || {} } catch (e) { return {} } })()
      const companyState = React.useState(savedContext.company || null); const activeCompany = companyState[0]; const setActiveCompany = companyState[1]
      const projectState = React.useState(savedContext.project || null); const activeProject = projectState[0]; const setActiveProject = projectState[1]
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
        if (!newClient.trim() || !newName.trim() || creating) return
        const targetClient = newClient.trim()
        const targetName = newName.trim()
        const files = { fs: newFsFile, tb: newTbFile, journal: newJournalFile }
        setCreating(true); setCreateError('')
        api('/audit/projects/create', null, { method: 'POST', body: { client: targetClient, name: targetName, period: newPeriod.trim(), business_type: businessType } })
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
          category: '未更正',
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
        const order = ['待执行', '进行中', '已完成', '已生成', '不适用']
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

      if (loading) return h(Empty, null, '正在加载客户与项目…')
      if (error) return h(Empty, null, '加载失败：' + error + '（检查 mini4pro:8030 与 token）')

      const current = companies.filter(function (c) { return c.name === activeCompany })[0]
      const projects = current ? current.projects : []
      const project = projects.filter(function (p) { return p.id === activeProject })[0]
      const readOnly = Boolean(project && project.status === '已归档')
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
      const role = ((props.auth && props.auth.user) || {}).role || 'auditor'
      const isManager = ['partner', 'kb-admin', 'admin'].indexOf(role) >= 0
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', marginBottom: '8px' }

      const previewModal = preview ? h('div', { onClick: function (event) { if (event.target === event.currentTarget) closeAttachmentPreview() },
        style: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { width: '82vw', height: '82vh', background: '#fff', color: '#111', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, preview.attachment.filename),
            h('div', { style: { display: 'flex', gap: '10px' } },
              h('button', { onClick: function () { setPreviewZoom(function (value) { return Math.max(0.5, Math.round((value - 0.1) * 10) / 10) }) }, style: { border: '1px solid ' + COLORS.line, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer', width: '28px', height: '24px', borderRadius: '6px' } }, '−'),
              h('button', { onClick: function () { setPreviewZoom(1) }, style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } }, Math.round(previewZoom * 100) + '%'),
              h('button', { onClick: function () { setPreviewZoom(function (value) { return Math.min(3, Math.round((value + 0.1) * 10) / 10) }) }, style: { border: '1px solid ' + COLORS.line, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer', width: '28px', height: '24px', borderRadius: '6px' } }, '+'),
              h('button', { onClick: function () { if (preview.url) window.open(preview.url, '_blank', 'noopener') }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '新窗口打开'),
              h('button', { onClick: function () { if (preview.onDownload) preview.onDownload() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载'),
              h('button', { onClick: closeAttachmentPreview, style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } }, '关闭'))),
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
                h('input', { value: mgmtClient, onChange: function (e) { setMgmtClient(e.target.value) }, placeholder: '被审计单位全称', style: inputStyle }),
                h('input', { value: mgmtName, onChange: function (e) { setMgmtName(e.target.value) }, placeholder: '项目名称', style: inputStyle }))
            : h('div', { style: { fontSize: '12px', lineHeight: 1.7, marginBottom: '8px' } },
                '确认删除项目「' + activeProject + '」？其资料清单、底稿台账、成员、审批、会话关联等数据将一并删除，已生成文件保留在磁盘。'),
          mgmtError ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, mgmtError) : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
            h('button', { onClick: function () { setRenameOpen(false); setDeleteOpen(false); setMgmtError('') }, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: '#111', fontSize: '12px', cursor: 'pointer' } }, '取消'),
            h('button', { onClick: renameOpen ? submitRename : submitDelete, style: { padding: '7px 12px', borderRadius: '7px', border: 0, background: renameOpen ? COLORS.accent : '#b91c1c', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, renameOpen ? '保存' : '确认删除'))))
        : null

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
        onAddMember: addProjectMember, onRemoveMember: removeProjectMember,
        generatedDate: generatedDate, onGeneratedDateChange: setGeneratedDate,
        onOpenWorkpaperIndex: openWorkpaperByIndex, onGenerateWorkpaper: generateWorkpaper,
        onGenerateAll: generateAllWorkpapers, onGenerateLocal: generateLocalWorkpapers, localAtt: localAtt, onLocalAttChange: setLocalAtt, localAtts: localAttachments(), onExportWorkpapers: exportWorkpapersZip, reportVersionFilter: reportVersionFilter, onSetReportVersionFilter: setReportVersionFilter, approvalFilter: approvalFilter, onSetApprovalFilter: setApprovalFilter, onExportApprovals: exportApprovals, todoOverdueOnly: todoOverdueOnly, onSetTodoOverdueOnly: setTodoOverdueOnly, wpStatusFilter: wpStatusFilter, onSetWpStatusFilter: setWpStatusFilter, wpSearch: wpSearch, onSetWpSearch: setWpSearch, onExportWorkpaperList: exportWorkpaperListCsv, onJumpTodoZone: jumpTodoZone, onJumpZone: function (name) { setZone(name) }, onVerifyWorkpapersZip: verifyWorkpapersZip, wpsVerifyMessage: wpsVerifyMessage,
        onDownloadWorkpaper: downloadGeneratedWorkpaper, onPreviewWorkpaper: previewGeneratedWorkpaper,
        newPbcName: newPbcName, onPbcNameChange: setNewPbcName, onAddPbc: addPbcItem,
        onDeletePbc: deletePbcItem, onUploadAttachment: uploadPbcAttachment,
        onDownloadAttachment: downloadPbcAttachment, onPreviewAttachment: openAttachmentPreview, onCheckAttachment: checkAttachment, clientCheck: clientCheck, clientCheckMsg: clientCheckMsg, onExportClientCheck: exportClientCheckReport, onAddMisstatement: addMisstatementFromFinding, misstates: misstates, completeness: completeness, reportElements: reportElements, reportElementsMsg: reportElementsMsg, onSaveReportElements: saveReportElements, onUpdateMisstatement: updateMisstatement,
        onSubmitApproval: submitApproval, onDecideApproval: decideApproval,
        company: activeCompany, project: project,
        onStartChat: props.onStartChat, onCyclePbc: cyclePbc, onCycleWp: cycleWp,
        onNewSession: newProjectSession, onOpenSession: openProjectSession,
      }

      return h('div', { style: { display: 'flex', height: '100%', minHeight: 0, color: COLORS.text } },
        h('div', { style: { width: '280px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 8px' } },
            h('div', { style: { fontSize: '14px', fontWeight: 600 } }, '客户与项目'),
            h('button', { onClick: function () { setShowCreate(!showCreate); setCreateError('') },
              style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '+ 新建项目')),
          h('div', { style: { padding: '0 12px 8px', display: 'flex', gap: '6px' } },
            h('input', { value: search, onChange: function (e) { setSearch(e.target.value) }, placeholder: '搜索客户/项目…', style: inputStyle }),
            h('select', { value: statusFilter, onChange: function (e) { setStatusFilter(e.target.value) }, style: Object.assign({}, inputStyle, { width: '86px', flexShrink: 0 }) },
              h('option', { value: '' }, '全部'),
              h('option', { value: '进行中' }, '进行中'),
              h('option', { value: '已归档' }, '已归档'))),
          showCreate ? h('div', { style: { padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('input', { value: newClient, onChange: function (e) { setNewClient(e.target.value) }, placeholder: '被审计单位全称', style: inputStyle }),
            h('input', { value: newName, onChange: function (e) { setNewName(e.target.value) }, placeholder: '项目名称（如 2026年度审计）', style: inputStyle }),
            h('input', { value: newPeriod, onChange: function (e) { setNewPeriod(e.target.value) }, placeholder: '会计期间（如 2026）', style: inputStyle }),
            h('select', { value: businessType, onChange: function (e) { setBusinessType(e.target.value) }, style: inputStyle },
              ['年报审计', '专项审计', '内控审计'].map(function (name) { return h('option', { key: name, value: name }, '业务类型：' + name) })),
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
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button', { onClick: createProject, disabled: creating,
                style: { flex: 1, padding: '6px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, creating ? '创建中…' : '创建项目'),
              h('button', { onClick: function () { setShowCreate(false); setCreateError('') },
                style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null,
          (pinnedProjects || []).length ? h('div', { style: { padding: '0 10px 8px' } },
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '已固定'),
            pinnedProjects.map(function (item) {
              return h('div', { key: 'pin-' + item.project, onClick: function () { setActiveCompany(item.company); setActiveProject(item.project) },
                style: { padding: '5px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', color: item.project === activeProject ? COLORS.accent : 'inherit' } },
                h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center', minWidth: 0 } },
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '★ ' + item.project),
                    (pendingCounts || {})[item.project] ? h('button', { title: '查看待审批', onClick: function (e) { e.stopPropagation(); setActiveCompany(item.company); setActiveProject(item.project); setZone('审批状态') },
                      style: { border: 0, borderRadius: '8px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '10px', padding: '1px 6px', cursor: 'pointer', flexShrink: 0 } }, pendingCounts[item.project] + ' 待审') : null),
                  (function () { const meta = projectMeta(item); return meta ? h('span', { style: { fontSize: '10px', color: COLORS.muted } }, (meta.status || '-') + (meta.period ? ' · ' + meta.period : '')) : null })()),
                h('button', { onClick: function (e) { e.stopPropagation(); togglePinProject(item) }, style: { border: 0, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontSize: '11px', flexShrink: 0 } }, '取消固定'))
            })) : null,
          (recentProjects || []).filter(function (item) { return !(pinnedProjects || []).some(function (p) { return p.project === item.project }) }).length ? h('div', { style: { padding: '0 10px 8px' } },
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '4px' } }, '最近访问'),
            recentProjects.filter(function (item) { return !(pinnedProjects || []).some(function (p) { return p.project === item.project }) }).slice(0, 3).map(function (item) {
              const isPinned = (pinnedProjects || []).some(function (p) { return p.project === item.project })
              return h('div', { key: 'recent-' + item.project, onClick: function () { setActiveCompany(item.company); setActiveProject(item.project) },
                style: { padding: '5px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', color: item.project === activeProject ? COLORS.accent : 'inherit' } },
                h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center', minWidth: 0 } },
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.project),
                    (pendingCounts || {})[item.project] ? h('button', { title: '查看待审批', onClick: function (e) { e.stopPropagation(); setActiveCompany(item.company); setActiveProject(item.project); setZone('审批状态') },
                      style: { border: 0, borderRadius: '8px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '10px', padding: '1px 6px', cursor: 'pointer', flexShrink: 0 } }, pendingCounts[item.project] + ' 待审') : null),
                  (function () { const meta = projectMeta(item); return meta ? h('span', { style: { fontSize: '10px', color: COLORS.muted } }, (meta.status || '-') + (meta.period ? ' · ' + meta.period : '')) : null })()),
                h('span', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
                  h('button', { onClick: function (e) { e.stopPropagation(); togglePinProject(item) }, style: { border: 0, background: 'transparent', color: isPinned ? COLORS.accent : COLORS.muted, cursor: 'pointer', fontSize: '11px' } }, isPinned ? '★' : '☆'),
                  h('button', { onClick: function (e) { e.stopPropagation(); removeRecentProject(item.project) }, style: { border: 0, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontSize: '11px' } }, '×')))
            })) : null,
          h('div', { style: { padding: '0 8px 12px' } }, visibleCompanies.length ? visibleCompanies.map(function (c) {
            const active = c.name === activeCompany
            return h('div', { key: c.name, onClick: function () { setActiveCompany(c.name); setActiveProject(null) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, c.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, c.projects.length + ' 个项目'))
          }) : h('div', { style: { padding: '10px', fontSize: '12px', color: COLORS.muted } }, '没有匹配的客户'))),
        h('div', { style: { width: '260px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { padding: '14px 14px 8px', fontSize: '13px', fontWeight: 600 } }, activeCompany ? '年度项目' : '选择左侧公司'),
          h('div', { style: { padding: '0 8px 12px' } }, visibleProjects.length ? visibleProjects.map(function (p) {
            const active = p.id === activeProject
            return h('div', { key: p.id, onClick: function () { setActiveProject(p.id) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, p.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, p.period + ' · ' + p.status + (p.business_type ? ' · ' + p.business_type : '')))
          }) : h('div', { style: { padding: '10px', fontSize: '12px', color: COLORS.muted } }, '没有匹配的项目'))),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', gap: '2px', padding: '10px 14px 0', borderBottom: '1px solid ' + COLORS.line, flexShrink: 0, flexWrap: 'wrap' } },
            ['概览', '风险评估', '资料清单', '审计底稿', '审计程序', '项目对话', '审批状态', '报告'].map(function (name) {
              const active = zone === name
              return h('button', { key: name, 'data-zone': name, onClick: function () { setZone(name) },
                style: { border: 0, background: 'transparent', padding: '8px 12px', fontSize: '13px', cursor: 'pointer',
                  color: active ? COLORS.accent : COLORS.muted, borderBottom: '2px solid ' + (active ? COLORS.accent : 'transparent') } }, name)
            })),
          readOnly
            ? h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'rgba(180,83,9,0.10)', color: '#b45309', fontSize: '12px', borderBottom: '1px solid ' + COLORS.line } },
                h('span', null, '项目已归档：所有写操作已锁定，仅可查看/下载。'),
                isManager ? h('button', { onClick: unarchiveProject, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '解除归档') : null)
            : null,
          h('div', { style: { flex: 1, overflow: 'auto' } },
            project ? h(Zone, zoneProps) : h(Empty, null, activeCompany ? '选择右侧项目查看四个分区' : '选择公司开始'))),
        previewModal, mgmtModal)
    }

    // ---------- 知识库 ----------
    function KbPage(props) {
      const authUser = (props && props.auth && props.auth.user) || {}
      const isKbAdmin = ['kb-admin', 'admin'].indexOf(authUser.role) >= 0
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
      function openDoc(ref) {
        const path = String(ref).split(' › ')[0]
        api('/kb/doc', { doc: path }).then(function (d) { setDoc(d) }).catch(function (e) { setError(String(e)) })
      }

      const counts = {}
      docs.forEach(function (d) { counts[d.code] = (counts[d.code] || 0) + 1 })
      const catCodes = Object.keys(CAT).filter(function (c) { return counts[c] })
      const visibleDocs = hits === null ? docs.filter(function (d) { return !code || d.code === code }).slice(0, 200) : []
      const catItems = [{ code: '', label: '全部文档（' + docs.length + '）' }].concat(catCodes.map(function (c) { return { code: c, label: CAT[c] + '（' + counts[c] + '）' } }))
      const left = h('div', { style: { width: '210px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
        h('div', { style: { padding: '14px 14px 8px', fontSize: '14px', fontWeight: 600 } }, '知识库'),
        h('div', { style: { padding: '0 8px 12px' } }, catItems.map(function (item) {
          const active = code === item.code
          return h('div', { key: item.code || 'all', onClick: function () { setCode(item.code); setHits(null) },
            style: { padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', marginTop: '2px',
              background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } }, item.label)
        })))
      const searchBox = h('div', { style: { padding: '12px', borderBottom: '1px solid ' + COLORS.line } },
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('input', { value: q, onChange: function (e) { setQ(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') runSearch() }, placeholder: '检索准则/法规/模板…',
            style: { flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '13px' } }),
          h('button', { onClick: runSearch, disabled: searching, style: { padding: '8px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '13px', cursor: 'pointer' } }, searching ? '检索中' : '检索')),
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginTop: '8px' } }, error) : null)
      const statusBox = isKbAdmin && kbStatus ? h('div', { style: { padding: '8px 12px', borderBottom: '1px solid ' + COLORS.line, fontSize: '11px', color: COLORS.muted } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', { style: { fontWeight: 600, color: COLORS.text } }, '知识库状态'),
          h('button', { onClick: loadPending, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '10px', cursor: 'pointer' } }, '刷新')),
        h('div', { style: { marginTop: '3px', lineHeight: 1.8 } },
          '已发布 ' + ((kbStatus.counts || {}).approved || 0) + ' · 待审 ' + ((kbStatus.counts || {}).pending || 0) +
          ' · 过期 ' + ((kbStatus.counts || {}).expired || 0) + ' · 索引 ' + (kbStatus.chunks || 0) + ' 块'),
        kbStatus.last_reviewed ? h('div', null, '最近发布：' + kbStatus.last_reviewed.title + '（' + kbStatus.last_reviewed.at + '）') : null,
        kbStatus.last_sync ? h('div', null, '最近巡检：' + (kbStatus.last_sync.at || '') + '，新增 ' + (kbStatus.last_sync.added || 0) + ' 篇') : null,
        h('button', { onClick: toggleExpiring, style: { marginTop: '3px', border: 0, background: 'transparent', color: COLORS.accent, fontSize: '10px', cursor: 'pointer', padding: 0 } }, (kbExpiring ? '收起' : '失效/到期提醒') + '（' + ((kbStatus.counts || {}).expired || 0) + '）'),
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
          h('button', { onClick: loadPending, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '刷新')),
        pendingDocs.slice(0, 5).map(function (item) {
          return h('div', { key: 'kb-pending-' + item.id, style: { padding: '5px 0', borderBottom: '1px dashed ' + COLORS.line, fontSize: '11px' } },
            h('div', { style: { color: COLORS.text, marginBottom: '3px' } }, item.title + (item.docno ? '（' + item.docno + '）' : '')),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', color: COLORS.muted } },
              h('span', null, (CAT[item.code] || item.code) + (item.source_url ? ' · 官网' : '') + ' · ' + (item.added_at || '')),
              h('button', { disabled: pendingBusy, onClick: function () { decidePending(item.id, 'approve') },
                style: { padding: '2px 8px', borderRadius: '6px', border: 0, background: '#16a34a', color: '#fff', fontSize: '10px', cursor: 'pointer' } }, '通过'),
              h('button', { disabled: pendingBusy, onClick: function () { decidePending(item.id, 'reject') },
                style: { padding: '2px 8px', borderRadius: '6px', border: '1px solid #b91c1c', background: 'transparent', color: '#b91c1c', fontSize: '10px', cursor: 'pointer' } }, '驳回')))
        }),
        pendingMsg ? h('div', { style: { marginTop: '6px', fontSize: '11px', color: '#b45309' } }, pendingMsg) : null) : null
      let listItems = []
      if (hits === null) {
        listItems = visibleDocs.map(function (d, i) {
          return h('div', { key: d.code + ':' + (d.filename || d.title) + ':' + i, onClick: function () { openDoc(d.filename) },
            style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', marginTop: '2px' } },
            h('div', { style: { fontSize: '13px' } }, d.title || d.filename),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, (CAT[d.code] || d.code) + (d.docno ? ' · ' + d.docno : '')))
        })
        if (!listItems.length) listItems = [h(Empty, { key: 'empty' }, '暂无文档')]
      } else if (!hits.length) {
        listItems = [h(Empty, { key: 'empty' }, '没有命中，换个关键词试试')]
      } else {
        listItems = hits.map(function (hit, i) {
          const title = hit.doc && hit.doc.title ? hit.doc.title : hit.ref
          const meta = (hit.doc && hit.doc.code ? (CAT[hit.doc.code] || hit.doc.code) : '') + ' · ' + (hit.section || '')
          return h('div', { key: 'hit-' + i, onClick: function () { openDoc(hit.ref) }, style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', marginTop: '2px' } },
            h('div', { style: { fontSize: '13px' } }, title),
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, meta),
            h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '4px', lineHeight: 1.6, maxHeight: '3.2em', overflow: 'hidden' } }, hit.text))
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
          return h('div', { key: 'chunk-' + i, style: { marginBottom: '14px' } },
            h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '3px' } }, c.section || ''),
            h('div', { style: { fontSize: '13px', lineHeight: 1.85, whiteSpace: 'pre-wrap' } }, c.text))
        })
        right = h('div', null,
          h('div', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '4px' } }, (doc.meta && doc.meta.title) || doc.doc),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '14px' } }, metaLine),
          chunks)
      }
      const rightPane = h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto', padding: '18px 22px' } }, right)
      return h('div', { style: { display: 'flex', height: '100%', minHeight: 0, color: COLORS.text } }, left, middle, rightPane)
    }

    // ---------- 操作留痕 ----------
    const TYPE_NAMES = { pbc: '资料清单', workpaper: '底稿', approval: '审批', pbc_attachment: '附件', member: '成员', program: '审计程序', report: '报告', materiality: '重要性', data: '数据', inventory: '存货监盘', confirmation: '函证', risk: '风险评估', archive: '归档包', drill: '演练', backup: '备份' }

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
      const [startDate, setStartDate] = React.useState(savedFilters.startDate || '')
      const [endDate, setEndDate] = React.useState(savedFilters.endDate || '')
      React.useEffect(function () {
        try { localStorage.setItem('auditdesk.events.filters', JSON.stringify({ project: project, actor: actor, type: type, startDate: startDate, endDate: endDate })) } catch (e) {}
      }, [project, actor, type, startDate, endDate])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [page, setPage] = React.useState(1)
      const [total, setTotal] = React.useState(0)

      function resetFilters() {
        setProject(''); setActor(''); setType(''); setStartDate(''); setEndDate(''); setPage(1)
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
        api('/audit/events', { project: project || undefined, actor: actor || undefined, item_type: type || undefined, start_date: startDate || undefined, end_date: endDate || undefined, limit: 100, offset: (target - 1) * 100 })
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

      const filterBar = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid ' + COLORS.line } },
        h('select', { value: project, onChange: function (e) { setProject(e.target.value) },
          style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
          h('option', { value: '' }, '全部项目'),
          projects.map(function (p) { return h('option', { key: p.id, value: p.id }, p.client + ' / ' + p.name) })),
        h('input', { value: actor, onChange: function (e) { setActor(e.target.value) }, placeholder: '操作人',
          style: { width: '110px', padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
        h('select', { value: type, onChange: function (e) { setType(e.target.value) },
          style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
          h('option', { value: '' }, '全部类型'),
          Object.keys(TYPE_NAMES).map(function (key) { return h('option', { key: key, value: key }, TYPE_NAMES[key]) })),
        h('input', { value: startDate, onChange: function (e) { setStartDate(e.target.value) }, type: 'date', title: '开始日期',
          style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
        h('input', { value: endDate, onChange: function (e) { setEndDate(e.target.value) }, type: 'date', title: '结束日期',
          style: { padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
        h('button', { onClick: function () { load(1) }, style: { padding: '7px 14px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, loading ? '查询中…' : '查询'),
        h('button', { onClick: resetFilters, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '清除筛选'),
        h('span', { style: { fontSize: '11px', color: COLORS.muted, marginLeft: '6px' } }, '共 ' + total + ' 条 · 第 ' + page + ' / ' + Math.max(1, Math.ceil(total / 100)) + ' 页'),
        h('button', { onClick: function () { if (page > 1) load(page - 1) }, disabled: page <= 1,
          style: { padding: '7px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer', opacity: page <= 1 ? 0.4 : 1 } }, '上一页'),
        h('button', { onClick: function () { if (page * 100 < total) load(page + 1) }, disabled: page * 100 >= total,
          style: { padding: '7px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer', opacity: page * 100 >= total ? 0.4 : 1 } }, '下一页'),
        h('button', { onClick: exportCsv, style: { padding: '7px 14px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出 CSV'),
        h('button', { onClick: exportPageCsv, style: { padding: '7px 14px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出当前页'))

      const rows = events.map(function (item) {
        return h('div', { key: item.id, style: { display: 'grid', gridTemplateColumns: '150px 90px 1fr 90px', gap: '10px', padding: '7px 16px', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px', alignItems: 'center' } },
          h('span', { style: { color: COLORS.muted } }, item.created_at),
          h('span', null, item.actor || '-'),
          h('span', null, (TYPE_NAMES[item.item_type] || item.item_type) + ' · ' + (item.item_name || '') + '：' + (item.old_status || '') + ' → ' + (item.new_status || '')),
          h('span', { style: { color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.project_id))
      })

      return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', color: COLORS.text } },
        h('div', { style: { padding: '14px 16px 6px', fontSize: '14px', fontWeight: 600 } }, '操作留痕'),
        h('div', { style: { padding: '0 16px 10px', fontSize: '12px', color: COLORS.muted } }, '所有资料清单/底稿/审批/附件操作，按项目、操作人、类型筛选，用于复核与质量追溯。'),
        filterBar,
        error ? h('div', { style: { padding: '10px 16px', color: '#b91c1c', fontSize: '12px' } }, error) : null,
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
      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '用户管理'),
        h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '12px' } }, '创建审计人员账号、分配角色与重置密码（管理员）'),
        message ? h('div', { style: { fontSize: '12px', color: '#16a34a', marginBottom: '8px' } }, message) : null,
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, error) : null,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', border: '1px solid ' + COLORS.line, borderRadius: '10px', marginBottom: '14px' } },
          h('input', { value: newUser.username, onChange: function (e) { setNewUser(Object.assign({}, newUser, { username: e.target.value })) }, placeholder: '用户名（登录名）', style: inputStyle }),
          h('input', { value: newUser.name, onChange: function (e) { setNewUser(Object.assign({}, newUser, { name: e.target.value })) }, placeholder: '姓名', style: inputStyle }),
          h('input', { value: newUser.password, onChange: function (e) { setNewUser(Object.assign({}, newUser, { password: e.target.value })) }, placeholder: '初始密码（≥6位）', style: inputStyle }),
          h('select', { value: newUser.role, onChange: function (e) { setNewUser(Object.assign({}, newUser, { role: e.target.value })) }, style: inputStyle },
            roleOptions.map(function (item) { return h('option', { key: item[0], value: item[0] }, item[1]) })),
          h('button', { onClick: createUser, style: { padding: '7px 14px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '创建用户')),
        loading ? h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '加载中…') : null,
        users.map(function (user) {
          const active = user.active === 1 || user.active === true
          return h('div', { key: user.username, style: { display: 'grid', gridTemplateColumns: '110px 1fr 110px 70px 180px', gap: '8px', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
            h('span', null, user.username),
            h('span', null, user.name),
            h('select', { value: user.role, onChange: function (e) { changeRole(user.username, e.target.value) }, style: inputStyle },
              roleOptions.map(function (item) { return h('option', { key: item[0], value: item[0] }, item[1]) })),
            h('span', null, h(Badge, { tone: active ? 'ok' : 'bad' }, active ? '启用' : '停用')),
            h('div', { style: { display: 'flex', gap: '4px' } },
              h('button', { onClick: function () { toggleUserStatus(user) }, style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + (active ? '#b91c1c' : '#16a34a'), background: 'transparent', color: active ? '#b91c1c' : '#16a34a', fontSize: '11px', cursor: 'pointer' } }, active ? '停用' : '启用'),
            resetUser === user.username
              ? h('div', { style: { display: 'flex', gap: '4px' } },
                  h('input', { value: resetPassword, onChange: function (e) { setResetPassword(e.target.value) }, placeholder: '新密码', style: Object.assign({}, inputStyle, { width: '90px' }) }),
                  h('button', { onClick: submitReset, style: { padding: '6px 8px', borderRadius: '6px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '11px', cursor: 'pointer' } }, '保存'))
              : h('button', { onClick: function () { setResetUser(user.username); setResetPassword('') }, style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '重置密码')))
        }))
    }

    function SystemIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.92a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8.92a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1' }))
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
            else if (d.attempts) setMessage('推送失败（已重试 ' + d.attempts + ' 次）：' + (d.error || '请检查 Webhook 配置'))
            else setMessage('未配置 Webhook，报告未推送（可在服务器 ~/kb-shared/notify-webhook 配置）')
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
          .then(function (result) { setMessage('已从 ' + result.restored + ' 恢复（安全备份：' + result.safety_backup + '）'); setRestoreName(''); load() })
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
        return h('div', { style: { flex: '1 1 200px', minWidth: '200px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '6px' } }, title),
          h('div', { style: { fontSize: '18px', fontWeight: 600 } }, value),
          hint ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, hint) : null)
      }
      if (!health) {
        return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
          h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '8px' } }, '系统状态'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : (error || '暂无数据')),
          h('button', { onClick: load, style: { marginTop: '10px', padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '刷新'))
      }
      const backupStatusText = (health.backup && health.backup.last_backup ? ('上次：' + (health.backup.last_backup_at || '-') + ' · 下次约 ' + Math.max(0, Math.ceil(((health.backup.next_due_seconds || 0) / 3600))) + ' 小时后 · 自动备份每 ' + (health.backup.interval_hours || 24) + ' 小时') : ('自动备份：每 ' + (((health.backup || {}).interval_hours) || 24) + ' 小时检查一次')) + ' · 共 ' + backups.length + ' 份 · 总占用 ' + formatBytes(backups.reduce(function (sum, item) { return sum + (item.size || 0) }, 0)) + ' · 保留最近 ' + (((health.backup || {}).keep) || 10) + ' 份' + (health.last_drill ? (' · 最近演练：' + (String(health.last_drill.status || '').indexOf('PASS') === 0 ? '通过' : '异常') + '（' + (health.last_drill.at || '') + '）') : '')
      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
          h('div', null,
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, '系统状态'),
            h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '服务时间：' + health.server_time + ' · 数据目录：mini4pro:8030')),
          h('div', { style: { display: 'flex', gap: '8px' } },
            isAdmin ? h('button', { onClick: exportOpsReport, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出运维报告（MD）') : null,
            isAdmin ? h('button', { onClick: exportOpsReportPdf, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出运维报告（PDF）') : null,
            isAdmin ? h('button', { onClick: pushOpsReport, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '推送运维报告') : null,
            h('button', { onClick: load, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, loading ? '刷新中…' : '刷新'))),
        message ? h('div', { style: { fontSize: '12px', color: '#16a34a', marginBottom: '8px' } }, message) : null,
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, error) : null,
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
          card('项目数', health.projects),
          card('启用用户', health.active_users),
          card('已生成文件', health.generated_files + ' 个', formatBytes(health.generated_bytes)),
          card('今日操作', health.events_today + ' 条', '最近：' + (health.last_event_at || '-'))),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
          card('数据库大小', formatBytes(health.database_bytes)),
          card('生成目录', formatBytes(health.generated_root_bytes)),
          card('上传目录', formatBytes(health.uploads_root_bytes)),
          card('磁盘使用', health.disk_used_percent + '%', '剩余 ' + formatBytes(health.disk_free) + ' / 共 ' + formatBytes(health.disk_total))),
        isAdmin ? h('div', { style: { marginBottom: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '后台任务'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', fontSize: '12px' } },
            h('div', { style: { padding: '8px', borderRadius: '8px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, '审批超期自动扫描'),
              h('div', { style: { color: COLORS.muted } }, (health.escalation ? (health.escalation.auto ? '已启用' : '已关闭') + ' · 每 ' + health.escalation.interval_hours + ' 小时' : '未配置')),
              h('div', { style: { color: COLORS.muted } }, '最近：' + ((health.escalation && health.escalation.last_run) || '待运行')),
              h('button', { onClick: runEscalationNow, style: { marginTop: '4px', padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '立即扫描')),
            h('div', { style: { padding: '8px', borderRadius: '8px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, '运维报告定时推送'),
              h('div', { style: { color: COLORS.muted } }, (health.report_push ? (health.report_push.auto ? '已启用' : '已关闭') + ' · 每日 ' + health.report_push.hour + ':00' : '未配置')),
              h('div', { style: { color: COLORS.muted } }, '最近：' + ((health.report_push && health.report_push.last_at) || '待运行') + (health.report_push && health.report_push.last_sent ? ' · 成功' : '')),
              h('button', { onClick: pushOpsReport, style: { marginTop: '4px', padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '立即推送')),
            h('div', { style: { padding: '8px', borderRadius: '8px', border: '1px solid ' + COLORS.line } },
              h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, '数据库自动备份'),
              h('div', { style: { color: COLORS.muted } }, (health.backup ? (health.backup.auto ? '已启用' : '已关闭') + ' · 每 ' + health.backup.interval_hours + ' 小时' : '未配置')),
              h('div', { style: { color: COLORS.muted } }, '最近备份：' + ((health.backup && health.backup.last_backup_at) || '无')),
              h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
                h('button', { onClick: createBackup, style: { padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '立即备份'),
                h('button', { onClick: drillBackup, style: { padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '恢复演练'))))) : null,
        isAdmin ? h('div', { style: { marginBottom: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '知识库定时更新'),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', { onClick: loadKbSync, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '刷新状态'),
              h('button', { onClick: runKbSync, disabled: kbSync && kbSync.state && kbSync.state.running,
                style: { padding: '5px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '11px', cursor: 'pointer', opacity: kbSync && kbSync.state && kbSync.state.running ? 0.6 : 1 } }, kbSync && kbSync.state && kbSync.state.running ? '检查中…' : '立即检查'))),
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
        isAdmin ? h('div', { style: { marginBottom: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, 'AI 行为审计（事件流）'),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', { onClick: loadAuditEvents, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '刷新'),
              auditEvents ? h('button', { onClick: exportAuditEvents, style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '导出 CSV') : null)),
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
              h('button', { onClick: function () {
                try { localStorage.setItem('auditdesk.events.type', sysEvent || '') } catch (e) {}
                try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel('audit-events') } catch (e) {}
              }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '查看全部（操作留痕）')),
            sysEvents.length ? sysEvents.slice(0, 10).map(function (event) {
              return h('div', { key: 'se-' + event.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '2px 0' } },
                h('span', null, (event.item_name || '') + ' · ' + (event.new_status || '') + ' · ' + (event.actor || '')),
                h('span', { style: { color: COLORS.muted } }, event.created_at))
            }) : h('div', { style: { color: COLORS.muted } }, '加载中…或者暂无记录')) : null) : null,
        isAdmin && settings ? h('div', { style: { marginBottom: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '审批超期自动扫描'),
          h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!settings.auto, onChange: function (e) { setSettings(Object.assign({}, settings, { auto: e.target.checked })) } }), '启用自动扫描'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '超期天数',
              h('input', { type: 'number', min: 1, value: settings.days || 2, onChange: function (e) { setSettings(Object.assign({}, settings, { days: Number(e.target.value) || 2 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '扫描间隔（小时）',
              h('input', { type: 'number', min: 1, value: settings.interval_hours || 6, onChange: function (e) { setSettings(Object.assign({}, settings, { interval_hours: Number(e.target.value) || 6 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '去重（小时）',
              h('input', { type: 'number', min: 1, value: settings.dedupe_hours || 24, onChange: function (e) { setSettings(Object.assign({}, settings, { dedupe_hours: Number(e.target.value) || 24 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })),
            h('button', { onClick: function () { saveSettings(settings, backupSettings) }, style: { padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '保存设置'),
            settingsMessage ? h('span', { style: { color: '#16a34a' } }, settingsMessage) : null),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '数据库自动备份'),
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!backupSettings.auto, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { auto: e.target.checked })) } }), '启用自动备份') : null,
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '保留份数',
              h('input', { type: 'number', min: 1, value: backupSettings.keep || 10, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { keep: Number(e.target.value) || 10 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })) : null,
            backupSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '备份间隔（小时）',
              h('input', { type: 'number', min: 1, value: backupSettings.interval_hours || 24, onChange: function (e) { setBackupSettings(Object.assign({}, backupSettings, { interval_hours: Number(e.target.value) || 24 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } })) : null,
            h('button', { onClick: function () { saveSettings(settings, backupSettings, reportPushSettings) }, style: { padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '保存备份设置')),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '运维报告推送'),
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!reportPushSettings.auto, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { auto: e.target.checked })) } }), '每日自动推送') : null,
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '推送时间',
              h('input', { type: 'number', min: 0, max: 23, value: reportPushSettings.hour || 8, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { hour: Number(e.target.value) || 0 })) }, style: { width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '点') : null,
            reportPushSettings ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '失败重试',
              h('input', { type: 'number', min: 1, max: 10, value: reportPushSettings.retries || 3, onChange: function (e) { setReportPushSettings(Object.assign({}, reportPushSettings, { retries: Number(e.target.value) || 3 })) }, style: { width: '54px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '次') : null,
            h('button', { onClick: function () { saveSettings(settings, backupSettings, reportPushSettings) }, style: { padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '保存推送设置')),
          h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed ' + COLORS.line, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
            h('div', { style: { fontWeight: 600, width: '100%', marginBottom: '2px' } }, '知识库定时更新'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!((kbSync && kbSync.config) || {}).auto,
                onChange: function (e) { const cfg = Object.assign({}, (kbSync && kbSync.config) || {}, { auto: e.target.checked }); setKbSync(Object.assign({}, kbSync || {}, { config: cfg })) } }), '每日自动检查'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '检查时间',
              h('input', { type: 'number', min: 0, max: 23, value: ((kbSync && kbSync.config) || {}).hour || 6,
                onChange: function (e) { const cfg = Object.assign({}, (kbSync && kbSync.config) || {}, { hour: Number(e.target.value) || 0 }); setKbSync(Object.assign({}, kbSync || {}, { config: cfg })) },
                style: { width: '60px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit' } }), '点'),
            h('button', { onClick: function () { saveSettings(settings, backupSettings, reportPushSettings, (kbSync && kbSync.config) || kbSync) },
              style: { padding: '6px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '保存知识库设置'))) : null,
        isAdmin ? h('div', { style: { padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
            h('div', null,
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '数据库备份（保留最近 ' + (((health.backup || {}).keep) || 10) + ' 份）'),
              h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, backupStatusText)),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              h('button', { onClick: function () { checkAutoBackup(false) }, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '检查自动备份'),
              h('button', { onClick: drillBackup, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '恢复演练'),
              h('button', { onClick: loadDrillHistory, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, drillEvents ? '收起演练记录' : '演练记录'),
              h('button', { onClick: function () { pruneBackups(0) }, style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '清理旧备份'),
              h('span', { style: { fontSize: '11px', color: COLORS.muted, display: 'flex', alignItems: 'center', gap: '4px' } }, '清理早于',
                h('input', { type: 'number', min: 1, value: pruneDays, onChange: function (e) { setPruneDays(Number(e.target.value) || 30) }, style: { width: '54px', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px' } }), '天',
                h('button', { onClick: function () { pruneBackups(pruneDays) }, style: { padding: '4px 8px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '11px', cursor: 'pointer' } }, '执行')),
              h('button', { onClick: createBackup, style: { padding: '7px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '立即备份'))),
          backupVerifyMessage ? h('div', { style: { fontSize: '12px', marginBottom: '6px', color: backupVerifyMessage.indexOf('通过') >= 0 ? '#16a34a' : '#b45309' } }, backupVerifyMessage) : null,
          drillEvents ? h('div', { style: { marginBottom: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(127,127,127,0.06)', fontSize: '11px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
              h('div', { style: { fontWeight: 600 } }, '最近恢复演练记录（' + drillEvents.length + '）'),
              drillEvents.length ? h('button', { onClick: exportDrillHistory, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '11px', cursor: 'pointer' } }, '导出 CSV') : null),
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
                h('button', { onClick: function () { verifyBackup(item.filename) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '校验'),
                h('button', { onClick: function () { downloadBackup(item.filename) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载'),
                h('button', { onClick: function () { openRestore(item) }, style: { border: 0, background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '恢复'),
                h('button', { onClick: function () { setDeleteBackupName(item.filename) }, style: { border: 0, background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '删除')))
          }) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '还没有备份'),
          deleteBackupName ? h('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(185,28,28,0.10)', fontSize: '12px', color: '#b91c1c' } },
            '确认删除备份 ' + deleteBackupName + '？删除后不可恢复。',
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
              h('button', { onClick: function () { deleteBackup(deleteBackupName) }, style: { padding: '5px 10px', borderRadius: '6px', border: 0, background: '#b91c1c', color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '确认删除'),
              h('button', { onClick: function () { setDeleteBackupName('') }, style: { padding: '5px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null,
          restoreName ? h('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(180,83,9,0.10)', fontSize: '12px', color: '#b45309' } },
            '确认用 ' + restoreName + ' 覆盖当前数据库？系统会先自动创建安全备份。',
            restoreSummary ? h('div', { style: { marginTop: '6px', fontSize: '11px', lineHeight: 1.7 } }, '完整性：' + (restoreSummary.ok ? '通过' : '未通过（' + (restoreSummary.integrity || '') + '）') + ' · 表 ' + restoreSummary.tables + ' 张 · 项目 ' + restoreSummary.projects + ' 个 · ' + formatBytes(restoreSummary.size || 0)) : h('div', { style: { marginTop: '6px', fontSize: '11px', color: COLORS.muted } }, '正在校验备份完整性…'),
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
              h('button', { onClick: function () { restoreBackup(restoreName) }, disabled: !restoreSummary || !restoreSummary.ok,
                style: { padding: '5px 10px', borderRadius: '6px', border: 0, background: '#b45309', color: '#fff', fontSize: '12px', cursor: 'pointer', opacity: (!restoreSummary || !restoreSummary.ok) ? 0.5 : 1 } }, '确认恢复'),
              h('button', { onClick: function () { setRestoreName(''); setRestoreSummary(null) }, style: { padding: '5px 10px', borderRadius: '6px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null) : null,
        h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '任务中心（最近任务）'),
            h('button', { onClick: load, style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '刷新')),
          jobs.length ? jobs.map(function (job) {
            return h('div', { key: 'job-' + job.id, style: { display: 'grid', gridTemplateColumns: '1fr 110px 90px 1fr 110px', gap: '8px', alignItems: 'center', fontSize: '12px', padding: '5px 0', borderBottom: '1px solid ' + COLORS.line } },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, job.project_id),
              h('span', null, job.kind === 'generate_all' ? '批量生成底稿' : job.kind),
              h('span', { style: { color: COLORS.muted } }, (job.progress || 0) + '/' + (job.total || 4)),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, job.message || ''),
              h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' } },
                h(Badge, { tone: job.status === '已完成' ? 'ok' : job.status === '部分失败' ? 'bad' : job.status === '已取消' ? 'muted' : 'warn' }, job.status),
                (job.status === '部分失败' || job.status === '失败') ? h('button', { onClick: function () { retryJob(job) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '重试') : null,
                (job.status === '排队中' || job.status === '执行中') ? h('button', { onClick: function () { cancelJob(job) }, style: { border: 0, background: 'transparent', color: '#b91c1c', fontSize: '12px', cursor: 'pointer' } }, '取消') : null))
          }) : h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '暂无任务'))
        )
    }

    function DashboardIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }))
    }

    function DashboardPage(props) {
      const authUser = (props && props.auth && props.auth.user) || {}
      const role = authUser.role || 'auditor'
      const roleLabel = { auditor: '审计员', manager: '项目经理', partner: '合伙人', 'kb-admin': '管理员', admin: '管理员' }[role] || role
      const roleHome = {
        auditor: { hint: '今天先看我的项目与底稿进度，再处理资料清单待补项。', actions: [['进入客户与项目', 'audit-companies'], ['知识库检索', 'audit-kb']] },
        manager: { hint: '优先处理「我的待办」中的审批，再复核底稿与报告。', actions: [['进入客户与项目（审批）', 'audit-companies'], ['知识库', 'audit-kb']] },
        partner: { hint: '关注报告复核与定稿、重要性确认与归档。', actions: [['进入客户与项目（报告）', 'audit-companies'], ['系统状态', 'audit-system']] },
        'kb-admin': { hint: '关注知识库更新审批、用户与备份，再进入项目抽查。', actions: [['系统状态', 'audit-system'], ['知识库（待审）', 'audit-kb']] },
        admin: { hint: '关注系统健康、备份与知识库更新，再进入项目抽查。', actions: [['系统状态', 'audit-system'], ['知识库（待审）', 'audit-kb']] },
      }[role] || { hint: '进入客户与项目查看进度。', actions: [['进入客户与项目', 'audit-companies']] }
      function goPanel(panelId) { try { if (props.ui && props.ui.layout) props.ui.layout.selectPanel(panelId) } catch (e) {} }
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
          h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '8px' } }, '项目看板'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : (error || '暂无数据')),
          h('button', { onClick: load, style: { marginTop: '10px', padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '刷新'))
      }
      const card = function (title, value, hint) {
        return h('div', { style: { flex: '1 1 160px', minWidth: '160px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '6px' } }, title),
          h('div', { style: { fontSize: '18px', fontWeight: 600 } }, value),
          hint ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '4px' } }, hint) : null)
      }
      const formatBytesLocal = function (value) {
        const number = Number(value || 0)
        if (number >= 1024 * 1024 * 1024) return (number / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
        if (number >= 1024 * 1024) return (number / (1024 * 1024)).toFixed(1) + ' MB'
        if (number >= 1024) return (number / 1024).toFixed(1) + ' KB'
        return number + ' B'
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
      const isManager = false
      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
          h('div', null,
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, '项目看板'),
            h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '事务所级项目进度与待办汇总')),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('button', { onClick: exportDashboard, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出 Excel'),
            h('button', { onClick: exportDashboardPdf, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出 PDF'),
            h('button', { onClick: load, style: { padding: '7px 12px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, loading ? '刷新中…' : '刷新'))),
        error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginBottom: '8px' } }, error) : null,
        h('div', { style: { marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', border: '1px solid ' + COLORS.line, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
          h('span', { style: { fontWeight: 600 } }, '我的工作台 · ' + roleLabel),
          h('span', { style: { color: COLORS.muted } }, roleHome.hint),
          pendingTotal > 0 ? h('span', { style: { padding: '1px 8px', borderRadius: '9px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '11px' } }, '当前待审批 ' + pendingTotal + ' 项') : null,
          roleHome.actions.map(function (pair) {
            return h('button', { key: 'rh-' + pair[1], onClick: function () { goPanel(pair[1]) },
              style: { padding: '5px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, pair[0])
          })),
        dashboard.count === 0 ? h('div', { style: { marginBottom: '14px', padding: '16px 18px', borderRadius: '12px', border: '1px solid ' + COLORS.accent, background: 'rgba(47,124,246,0.06)' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '三步开始第一次审计'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '10px' } }, '不需要记流程，按顺序点即可：'),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            [['1  新建项目', 'audit-companies'], ['2  导入科目余额表 / 账表', 'audit-companies'], ['3  生成第一份底稿', 'audit-companies']].map(function (pair) {
              return h('button', { key: 'onb-' + pair[0], onClick: function () { goPanel(pair[1]) },
                style: { padding: '9px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, pair[0])
            }),
            h('button', { onClick: function () { goPanel('audit-guide') }, style: { padding: '9px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '查看使用指南'))) : null,
        showGuide ? h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(47,124,246,0.08)', border: '1px solid ' + COLORS.accent, marginBottom: '12px', fontSize: '12px' } },
          h('span', null, '第一次使用？侧栏「使用指南」有 5 步上手流程：新建项目 → 导入数据 → 执行程序 → 报告 → 归档。'),
          h('button', { onClick: dismissGuide, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '知道了')) : null,
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
          card('项目数', dashboard.count),
          card('进行中', dashboard.active),
          card('已归档', dashboard.archived),
          card('待审批', dashboard.approval_pending),
          card('已生成文件', formatBytesLocal(dashboard.generated_bytes))),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' } },
          h('input', { value: keyword, onChange: function (e) { setKeyword(e.target.value) }, placeholder: '搜索客户/项目…',
            style: { width: '220px', padding: '7px 10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
          h('select', { value: statusFilter, onChange: function (e) { setStatusFilter(e.target.value) }, style: { padding: '7px 9px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
            h('option', { value: '' }, '全部状态'),
            h('option', { value: '进行中' }, '进行中'),
            h('option', { value: '已归档' }, '已归档')),
          h('select', { value: sortBy, onChange: function (e) { setSortBy(e.target.value) }, style: { padding: '7px 9px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } },
            h('option', { value: 'updated' }, '按更新时间'),
            h('option', { value: 'name' }, '按项目名称'),
            h('option', { value: 'pbc' }, '按资料清单完成率'),
            h('option', { value: 'pending' }, '按待审批数')),
          h('span', { style: { fontSize: '12px', color: COLORS.muted } }, '共 ' + rows.length + ' 个项目')),
        h('div', { style: { borderRadius: '12px', border: '1px solid ' + COLORS.line, overflow: 'hidden' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 90px 70px 130px 130px 130px 70px 70px', gap: '8px', padding: '8px 12px', fontSize: '11px', color: COLORS.muted, borderBottom: '1px solid ' + COLORS.line, background: COLORS.bg } },
            h('span', null, '客户 / 项目'), h('span', null, '期间'), h('span', null, '状态'), h('span', null, '资料清单'), h('span', null, '底稿执行'), h('span', null, '审计程序'), h('span', null, '生成文件'), h('span', null, '待审批')),
          rows.map(function (item) {
            return h('div', { key: item.id, style: { display: 'grid', gridTemplateColumns: '1fr 90px 70px 130px 130px 130px 70px 70px', gap: '8px', alignItems: 'center', padding: '8px 12px', fontSize: '12px', borderBottom: '1px solid ' + COLORS.line } },
              h('div', { style: { minWidth: 0 } },
                h('div', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
                h('div', { style: { fontSize: '11px', color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.client + (item.business_type ? ' · ' + item.business_type : ''))),
              h('span', null, item.period || '-'),
              h(Badge, { tone: item.status === '已归档' ? 'muted' : 'ok' }, item.status),
              h('div', null,
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' } }, h('span', null, item.pbc_percent + '%'), h('span', { style: { color: COLORS.muted } }, item.pbc_done + '/' + item.pbc_total)),
                h('div', { style: { height: '5px', borderRadius: '3px', background: COLORS.line } }, h('div', { style: { width: item.pbc_percent + '%', height: '100%', borderRadius: '3px', background: COLORS.accent } }))),
              h('div', null,
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' } }, h('span', null, item.wp_percent + '%'), h('span', { style: { color: COLORS.muted } }, '待执行 ' + item.wp_pending)),
                h('div', { style: { height: '5px', borderRadius: '3px', background: COLORS.line } }, h('div', { style: { width: item.wp_percent + '%', height: '100%', borderRadius: '3px', background: '#16a34a' } }))),
              h('div', null,
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' } }, h('span', null, (item.program_percent || 0) + '%'), h('span', { style: { color: COLORS.muted } }, (item.program_done || 0) + '/' + (item.program_total || 0))),
                h('div', { style: { height: '5px', borderRadius: '3px', background: COLORS.line } }, h('div', { style: { width: (item.program_percent || 0) + '%', height: '100%', borderRadius: '3px', background: '#7c3aed' } }))),
              h('span', null, item.generated_files),
              h('span', { style: { color: item.approval_pending ? '#b45309' : 'inherit' } }, item.approval_pending))
          })))
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
            '项目看板 · 客户与项目（概览/风险评估/资料清单/审计底稿/审计程序/项目对话/审批状态/报告）· 知识库 · 操作留痕 · 用户管理 · 系统状态 · 使用指南')),
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

      return h('div', { style: { padding: '18px', maxWidth: '960px', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
          h('div', null,
            h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '2px' } }, '审计程序库'),
            h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '事务所底库模板：新项目按业务类型自动套用；改这里的程序会应用到之后新建或补全的项目')),
          canEdit ? h('div', { style: { display: 'flex', gap: '6px' } },
            h('button', { onClick: resetCatalog, style: Object.assign({}, smallBtn, { fontSize: '11.5px', padding: '6px 10px' }) }, '恢复默认'),
            h('button', { onClick: function () { setEditing('new'); setDraft({ category: '', name: '', source: '程序' }) }, style: Object.assign({}, smallBtn, { fontSize: '11.5px', padding: '6px 10px', border: 0, background: COLORS.accent, color: '#fff' }) }, '+ 新增程序')) : null),
        h('div', { style: { display: 'flex', gap: '6px', margin: '10px 0 4px', flexWrap: 'wrap' } },
          TYPES.map(function (type) {
            const active = type === businessType
            return h('button', { key: 'type-' + type, onClick: function () { setBusinessType(type); cancelEdit() },
              style: { padding: '5px 12px', borderRadius: '7px', border: '1px solid ' + (active ? COLORS.accent : COLORS.line), background: active ? 'rgba(47,124,246,0.08)' : 'transparent', color: active ? COLORS.accent : 'inherit', fontSize: '12px', cursor: 'pointer' } }, type)
          }),
          h('span', { style: { fontSize: '11px', color: COLORS.muted, alignSelf: 'center', marginLeft: '4px' } }, '共 ' + items.length + ' 项 · ' + groups.length + ' 个分类' + (loading ? ' · 加载中…' : ''))),
        msg ? h('div', { style: { fontSize: '12px', color: '#16a34a', margin: '4px 0' } }, msg) : null,
        err ? h('div', { style: { fontSize: '12px', color: '#b91c1c', margin: '4px 0' } }, err) : null,
        editing === 'new' ? h('div', { style: { margin: '8px 0 12px', padding: '10px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { value: draft.category, onChange: function (e) { setDraft(Object.assign({}, draft, { category: e.target.value })) }, placeholder: '分类（如：货币资金）', style: Object.assign({}, inputStyle, { width: '160px' }) }),
          h('input', { value: draft.name, onChange: function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })) }, placeholder: '程序名称（必填）', style: Object.assign({}, inputStyle, { flex: 1, minWidth: '180px' }) }),
          h('select', { value: draft.source, onChange: function (e) { setDraft(Object.assign({}, draft, { source: e.target.value })) }, style: inputStyle },
            ['账载', '外部', '现场', '程序'].map(function (src) { return h('option', { key: 'new-src-' + src, value: src }, src) })),
          h('button', { onClick: function () { submitSave(0) }, style: Object.assign({}, smallBtn, { border: 0, background: COLORS.accent, color: '#fff' }) }, '添加'),
          h('button', { onClick: cancelEdit, style: smallBtn }, '取消')) : null,
        groups.length ? groups.map(function (category) {
          const groupItems = items.filter(function (item) { return (item.category || '其他') === category })
          return h('div', { key: 'cat-' + category, style: { marginBottom: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0 4px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(47,124,246,0.06)', fontSize: '13px', fontWeight: 600 } },
              h('span', null, category),
              h('span', { style: { fontSize: '11px', color: COLORS.muted, fontWeight: 400 } }, groupItems.length + ' 项')),
            groupItems.map(function (item) {
              if (editing === item.id) {
                return h('div', { key: 'cat-item-' + item.id, style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line } },
                  h('input', { value: draft.category, onChange: function (e) { setDraft(Object.assign({}, draft, { category: e.target.value })) }, placeholder: '分类', style: Object.assign({}, inputStyle, { width: '150px' }) }),
                  h('input', { value: draft.name, onChange: function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })) }, placeholder: '程序名称', style: Object.assign({}, inputStyle, { flex: 1, minWidth: '180px' }) }),
                  h('select', { value: draft.source, onChange: function (e) { setDraft(Object.assign({}, draft, { source: e.target.value })) }, style: inputStyle },
                    ['账载', '外部', '现场', '程序'].map(function (src) { return h('option', { key: 'edit-src-' + src, value: src }, src) })),
                  h('button', { onClick: function () { submitSave(item.id) }, style: Object.assign({}, smallBtn, { border: 0, background: COLORS.accent, color: '#fff' }) }, '保存'),
                  h('button', { onClick: cancelEdit, style: smallBtn }, '取消'))
              }
              return h('div', { key: 'cat-item-' + item.id, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: '8px', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('span', { style: { minWidth: 0 } }, item.name, sourceBadge(item.source)),
                canEdit ? h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
                  h('button', { onClick: function () { startEdit(item) }, style: smallBtn }, '编辑'),
                  h('button', { onClick: function () { stopItem(item) }, style: Object.assign({}, smallBtn, { color: '#b91c1c', border: '1px solid #b91c1c' }) }, '停用')) : h('span', { style: { fontSize: '11px', color: COLORS.muted, textAlign: 'right' } }, ''))
            }))
        }) : h('div', { style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, loading ? '加载中…' : '程序库为空，可「恢复默认」或新增程序'),
        h('div', { style: { marginTop: '10px', fontSize: '11px', color: COLORS.muted, lineHeight: 1.8 } },
          '说明：① 程序库修改只影响之后新建/补全的项目，已有项目清单不变；② 停用是逻辑删除，可随时「恢复默认」找回内置程序；③ 维护权限仅限合伙人/管理员。'))
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
          line('1. 客户与项目 → + 新建项目：填写公司、项目名称、期间，选择业务类型（年报/专项/内控）。'),
          line('2. 风险评估：确认重要性（经理/合伙人），上传财务报表（xlsx），导入科目余额表、序时账（支持 xlsx/xls/csv、多工作表、模板下载）。'),
          line('3. 执行程序：试算平衡、抽样、函证/回函、账龄、截止测试、存货监盘；生成程序底稿（Word）。'),
          line('4. 审计程序：按业务类型自动生成程序清单，更新状态/负责人，联动底稿台账。'),
          line('5. 报告 → 生成初稿/意见 → 导出 Word/PDF → 合伙人复核定稿 → 归档（只读）→ 导出归档包。'))),
        section('数据导入格式', h('div', null,
          line('科目余额表：科目编码、科目名称、期初余额、借方发生额、贷方发生额、期末余额。'),
          line('序时账：日期、凭证号、摘要、科目编码、科目名称、借方金额、贷方金额。'),
          line('支持表头自动识别（跳过标题行）、列名容错、多工作表选择；导入前可先「校验」。'))),
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
          line('系统状态 → 数据库备份/恢复；服务常驻时每日自动备份（保留 10 份）。'))),
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
        const panels = [
          { id: 'audit-dashboard', label: '项目看板', icon: DashboardIcon, page: withAuth(function (p) { return h(DashboardPage, Object.assign({}, p, { ui: ctx })) }), order: 29 },
          { id: 'audit-guide', label: '使用指南', icon: GuideIcon, page: withAuth(GuidePage), order: 35 },
          { id: 'audit-about', label: '关于', icon: AboutIcon, page: withAuth(AboutPage), order: 36 },
          { id: 'audit-companies', label: '客户与项目', icon: CompaniesIcon, page: withAuth(AuditCompaniesPage), order: 30 },
          { id: 'audit-kb', label: '知识库', icon: KbIcon, page: withAuth(KbPage), order: 31 },
          { id: 'audit-events', label: '操作留痕', icon: EventsIcon, page: withAuth(EventsPage), order: 32 },
          { id: 'audit-users', label: '用户管理', icon: UsersIcon, page: withAuth(UsersPage), order: 33 },
          { id: 'audit-catalog', label: '程序库', icon: GuideIcon, page: withAuth(ProgramCatalogPage), order: 33.5 },
          { id: 'audit-system', label: '系统状态', icon: SystemIcon, page: withAuth(function (props) { return h(SystemPage, Object.assign({}, props, { ui: ctx })) }), order: 34 },
        ]
        panels.forEach(function (panel) {
          ctx.slots.inject('main', function () {
            return ctx.slots.register({ name: 'main', key: panel.id }, panel.page)
          })
          ctx.slots.inject('sidebar.panellist', function () {
            return ctx.slots.register({ name: 'sidebar.panellist', id: panel.id, order: panel.order, label: function () { return panel.label } }, panel.icon)
          })
        })
      },
    }
  },
})
