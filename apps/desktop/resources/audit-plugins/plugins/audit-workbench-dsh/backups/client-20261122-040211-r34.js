window.__ModuleLoader__.load({
  id: '@local/dsh-audit-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = 'http://100.101.170.7:8030'
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
      return fetch(url.toString(), {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
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

    function Zone(props) {
      const readOnly = Boolean(props.readOnly)
      const matEditState = React.useState(false); const matEditing = matEditState[0]; const setMatEditing = matEditState[1]
      const matOverallState = React.useState(''); const matOverall = matOverallState[0]; const setMatOverall = matOverallState[1]
      const matPerfState = React.useState(''); const matPerf = matPerfState[0]; const setMatPerf = matPerfState[1]
      const matTrivialState = React.useState(''); const matTrivial = matTrivialState[0]; const setMatTrivial = matTrivialState[1]
      const matNoteState = React.useState(''); const matNote = matNoteState[0]; const setMatNote = matNoteState[1]
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
      if (props.zone === '概览') {
        const pbcItems = props.pbc || []
        const wpItems = props.wp || []
        const approvalItems = props.approvals || []
        const generatedItems = props.generated || []
        const memberItems = props.members || []
        const countBy = function (list, key) { const map = {}; list.forEach(function (item) { const value = item[key] || '未知'; map[value] = (map[value] || 0) + 1 }); return map }
        const pbcCounts = countBy(pbcItems, 'status')
        const wpCounts = countBy(wpItems, 'status')
        const approvalCounts = countBy(approvalItems, 'status')
        const finishedPbc = pbcCounts['已交'] || 0
        const pbcPercent = pbcItems.length ? Math.round(finishedPbc / pbcItems.length * 100) : 0
        const current = (props.auth && props.auth.user) || {}
        const myApprovals = approvalItems.filter(function (item) { return item.status === '待审批' && item.assigned_username === current.username })
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
        return h('div', { style: { padding: '18px', maxWidth: '900px' } },
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
              h('button', { onClick: function () { if (props.onExportArchive) props.onExportArchive() }, disabled: props.exporting,
                style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid ' + COLORS.accent, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } },
                props.exporting ? '打包中…' : '导出归档包（ZIP）'),
              readOnly
                ? h('span', { style: { padding: '4px 10px', borderRadius: '10px', background: 'rgba(180,83,9,0.12)', color: '#b45309', fontSize: '12px' } }, '已归档 · 只读')
                : (['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
                    ? h('button', { onClick: function () { if (props.onArchiveProject) props.onArchiveProject() },
                        style: { padding: '7px 12px', borderRadius: '8px', border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontSize: '12px', cursor: 'pointer' } }, '归档项目（只读）')
                    : null))),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            h('div', { style: { flex: '1 1 180px', minWidth: '180px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line, background: COLORS.bg } },
              h('div', { style: { fontSize: '12px', color: COLORS.muted } }, '资料清单完成率'),
              h('div', { style: { fontSize: '26px', fontWeight: 700, margin: '4px 0' } }, pbcPercent + '%'),
              h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '已交 ' + finishedPbc + ' / 共 ' + pbcItems.length + ' 项（待补 ' + (pbcCounts['待补'] || 0) + '，未交 ' + (pbcCounts['未交'] || 0) + '）'),
              progress(pbcPercent)),
            card('审计底稿', wpItems.length, '已生成 ' + (wpCounts['已生成'] || 0) + ' · 进行中 ' + (wpCounts['进行中'] || 0) + ' · 待执行 ' + (wpCounts['待执行'] || 0)),
            card('已生成文件', generatedItems.length, '可预览/下载，按索引号回写台账'),
            card('审批状态', approvalItems.length, '已通过 ' + (approvalCounts['已通过'] || 0) + ' · 待审批 ' + (approvalCounts['待审批'] || 0) + ' · 待提交 ' + (approvalCounts['待提交'] || 0)),
            card('项目成员', memberItems.length, memberItems.map(function (m) { return m.name }).join('、'))),
          h('div', { style: { marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '我的待办'),
            myApprovals.length
              ? myApprovals.map(function (item) {
                  return h('div', { key: 'todo-' + item.id, style: { fontSize: '12px', padding: '4px 0', color: COLORS.accent } }, '待你审批：' + item.title)
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
        return h('div', { style: { padding: '18px', maxWidth: '960px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
            h('div', null,
              h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '风险评估与重要性'),
              h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '14px' } }, '基于客户报表数据自动计算，审计师须结合职业判断确认')),
            readOnly ? null : h('button', { onClick: function () { if (props.onGenerateRiskDocx) props.onGenerateRiskDocx() },
              style: { padding: '8px 14px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '生成风险评估底稿（Word）')),
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
          (props.matHistory || []).length ? h('div', { style: { marginTop: '12px', padding: '14px', borderRadius: '12px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px' } }, '重要性调整历史（' + props.matHistory.length + '）'),
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
                return h('span', { key: 'att-' + att.id, onClick: function () { if (props.onPreviewAttachment) props.onPreviewAttachment(att) },
                  title: '点击预览',
                  style: { display: 'inline-block', marginRight: '6px', marginTop: '4px', padding: '2px 8px', borderRadius: '8px', background: COLORS.bg, fontSize: '11px', cursor: 'pointer', color: COLORS.accent } },
                  att.filename + ' ' + fmtSize(att.size))
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
        const addForm = h('div', { style: { display: 'flex', gap: '6px', marginTop: '10px' } },
          h('input', { value: props.newPbcName || '', onChange: function (event) { if (props.onPbcNameChange) props.onPbcNameChange(event.target.value) },
            placeholder: '新增资料项名称（如：银行开户许可证）',
            style: { flex: 1, padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px' } }),
          readOnly ? null : h('button', { onClick: function () { if (props.onAddPbc) props.onAddPbc(props.newPbcName || '') },
            style: { padding: '7px 12px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, '+ 新增资料项'))
        return h('div', null,
          h(Section, null, h('div', { style: { fontSize: '13px' } }, '应收资料清单（PBC）'), h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '2px' } }, '上传底表、点击状态切换；所有变更写入操作留痕')),
          h('div', { style: { padding: '6px 14px' } }, rows, addForm), eventsBlock('pbc'))
      }
      if (props.zone === '审计底稿') {
        const toneOfWp = function (status) { return status === '已完成' || status === '已执行' || status === '已预填' || status === '已生成' ? 'ok' : status === '进行中' ? 'warn' : status === '不适用' ? 'muted' : 'bad' }
        const items = props.wp === null ? null : props.wp
        const rows = items === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载审计底稿…')]
          : (items.length ? items.map(function (item) {
              const generatedFile = item.note && /\.xlsx$/i.test(item.note)
              return h('div', { key: item.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + COLORS.line } },
                h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', minWidth: 0 } },
                  h('span', { style: { fontSize: '11px', color: COLORS.accent, minWidth: '44px' } }, item.index_no),
                  h('span', { style: { fontSize: '13px' } }, item.name),
                  generatedFile
                    ? h('span', { onClick: function () { if (props.onOpenWorkpaperIndex) props.onOpenWorkpaperIndex(item.index_no) }, title: '打开已生成底稿',
                        style: { fontSize: '11px', color: COLORS.accent, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.note)
                    : (item.note ? h('span', { style: { fontSize: '11px', color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.note) : null)),
                h('span', { onClick: function () { if (!readOnly && props.onCycleWp) props.onCycleWp(item) }, title: '点击切换执行状态', 'data-wp-id': String(item.id), style: { cursor: 'pointer' } },
                  h(Badge, { tone: toneOfWp(item.status) }, item.status)))
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无底稿，先从模板生成')])
        const generated = props.generated === null ? [] : props.generated
        const generatedRows = generated.map(function (item) {
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
                props.generating ? '生成中…' : '一键生成全部底稿（4 类）'),
              h('button', { onClick: function () { if (props.onExportWorkpapers) props.onExportWorkpapers() },
                style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '打包下载全部底稿（ZIP）'),
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
              h('div', { style: { fontSize: '12px', fontWeight: 600, margin: '6px 0' } }, '已生成底稿（' + generated.length + '）'),
              generatedRows) : h('div', { style: { fontSize: '11px', color: COLORS.muted } }, '还没有生成底稿')),
          eventsBlock('workpaper'))
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
        const user = (props.auth && props.auth.user) || { name: '未登录', role: 'auditor', username: '' }
        const canApprove = ['manager', 'partner', 'kb-admin', 'admin'].indexOf(user.role) >= 0
        const approverMembers = (props.members || []).filter(function (m) { return ['manager', 'partner', 'kb-admin', 'admin'].indexOf(m.role) >= 0 })
        const toneOf = function (status) { return status === '已通过' ? 'ok' : status === '待审批' ? 'warn' : status === '已驳回' ? 'bad' : 'muted' }
        const rows = items === null
          ? [h('div', { key: 'loading', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '正在加载审批状态…')]
          : (items.length ? items.map(function (item) {
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
                actions.length ? h('div', null, actions) : null)
            }) : [h('div', { key: 'empty', style: { padding: '14px', fontSize: '12px', color: COLORS.muted } }, '暂无审批事项')])
        const identityBar = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px' } },
          h('span', { style: { color: COLORS.muted } }, '当前身份：'),
          h('span', { style: { fontWeight: 600 } }, user.name + '（' + user.role + '）'),
          h('span', { style: { color: canApprove ? '#16a34a' : '#b45309' } }, canApprove ? '可审批' : '只读/提交'))
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
          h('div', { style: { fontSize: '14px', marginBottom: '6px' } }, '审批状态'),
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
        return h('div', { style: { padding: '20px', maxWidth: '900px' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, '审计报告'),
          h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '12px' } }, '基于项目数据与底稿检查结果生成：检查清单 / 审计意见 / 报告初稿（AI 初稿，需人工复核）'),
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
            h('button', { onClick: function () { if (props.onLoadVersions) props.onLoadVersions() },
              style: { padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '历史版本')),
          checklist.length ? h('div', { style: { marginBottom: '16px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '报告检查清单（' + checklist.length + '）'),
            checklist.map(function (item, index) {
              return h('div', { key: 'cl-' + index, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('div', null, h('span', null, item.item), item.detail ? h('span', { style: { color: COLORS.muted, marginLeft: '8px' } }, item.detail) : null),
                h(Badge, { tone: statusTone(item.status) }, item.status))
            })) : null,
          opinion ? h('div', { style: { marginBottom: '16px', padding: '12px', borderRadius: '10px', border: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, '审计意见：' + (opinion.level || '')),
            h('div', { style: { fontSize: '12px', lineHeight: 1.7 } }, opinion.text || ''),
            (opinion.limits || []).length ? h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '6px' } }, '限制事项：' + (opinion.limits || []).join('；')) : null) : null,
          draft ? h('div', null,
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '报告初稿：' + draft.filename),
            h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: 1.7, background: COLORS.bg, padding: '12px', borderRadius: '10px', maxHeight: '420px', overflow: 'auto' } }, draft.content)) : null,
          (report.versions || []).length ? h('div', { style: { marginTop: '16px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '历史版本（' + report.versions.length + '）'),
            report.versions.map(function (version) {
              const canFinalize = ['partner', 'kb-admin', 'admin'].indexOf(((props.auth && props.auth.user) || {}).role) >= 0
              return h('div', { key: 'v-' + version.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + COLORS.line, fontSize: '12px' } },
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, version.filename + ' · ' + version.created_by + ' · ' + version.created_at),
                  h(Badge, { tone: version.status === '已定稿' ? 'ok' : version.status === '复核中' ? 'warn' : 'muted' }, version.status || '草稿')),
                h('div', { style: { display: 'flex', gap: '10px' } },
                  version.status !== '已定稿' ? h('button', { onClick: function () { if (props.onSubmitReview) props.onSubmitReview(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '提交复核') : null,
                  (version.status !== '已定稿' && canFinalize) ? h('button', { onClick: function () { if (props.onFinalizeReport) props.onFinalizeReport(version.id) }, style: { border: 0, background: 'transparent', color: '#16a34a', fontSize: '12px', cursor: 'pointer' } }, '定稿') : null,
                  h('button', { onClick: function () { if (props.onDownloadVersion) props.onDownloadVersion(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载 MD'),
                  h('button', { onClick: function () { if (props.onExportDocx) props.onExportDocx(version.id) }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '导出 Word')))
            })) : null)
      }
      return h('div', null)
    }

    function CompaniesPage(props) {
      const state = React.useState({ loading: true, companies: [], error: '' })
      const companies = state[0].companies; const loading = state[0].loading; const error = state[0].error; const setData = state[1]
      const companyState = React.useState(null); const activeCompany = companyState[0]; const setActiveCompany = companyState[1]
      const projectState = React.useState(null); const activeProject = projectState[0]; const setActiveProject = projectState[1]
      const zoneState = React.useState('概览'); const zone = zoneState[0]; const setZone = zoneState[1]
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
      const showCreateState = React.useState(false); const showCreate = showCreateState[0]; const setShowCreate = showCreateState[1]
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

      function refreshApprovals() {
        api('/audit/approvals', { project: activeProject }).then(function (d) { setApprovals(d.items || []) }).catch(function () {})
        api('/audit/events', { project: activeProject, limit: 40 }).then(function (d) { setEvents(d.events || []) }).catch(function () {})
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
      function createProject() {
        if (!newClient.trim() || !newName.trim() || creating) return
        const targetClient = newClient.trim()
        const targetName = newName.trim()
        setCreating(true); setCreateError('')
        api('/audit/projects/create', null, { method: 'POST', body: { client: targetClient, name: targetName, period: newPeriod.trim(), business_type: businessType } })
          .then(function () { return api('/audit/projects') })
          .then(function (d) {
            setData({ loading: false, companies: d.companies || [], error: '' })
            setActiveCompany(targetClient)
            setActiveProject(targetName)
            setShowCreate(false)
            setNewClient(''); setNewName(''); setNewPeriod('')
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
      function exportReportDocx(versionId) {
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
      function submitReportReview(versionId) {
        api('/audit/report/submit-review', null, { method: 'POST', body: { version_id: versionId } })
          .then(function () {
            setReport(function (prev) { return Object.assign({}, prev, { message: '已提交复核' }) })
            loadReportVersions()
          }).catch(function () {})
      }
      function finalizeReport(versionId) {
        fetch(BASE + '/audit/report/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KB-Token': currentToken() },
          body: JSON.stringify({ version_id: versionId }),
        }).then(function (resp) {
          return resp.json().then(function (data) {
            if (!resp.ok) {
              const detail = data && data.detail
              const message = detail && detail.message ? detail.message + '（' + ((detail.items || []).length) + ' 项未完成）' : (typeof detail === 'string' ? detail : '定稿失败')
              setReport(function (prev) { return Object.assign({}, prev, { message: message }) })
              return null
            }
            setReport(function (prev) { return Object.assign({}, prev, { message: '报告已定稿' }) })
            loadReportVersions()
            return data
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
          .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob() })
          .then(function (blob) {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = activeProject + '_审计档案.zip'
            document.body.appendChild(anchor); anchor.click(); anchor.remove()
            URL.revokeObjectURL(url)
          }).catch(function () {})
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
      function generateAllWorkpapers() {
        if (!activeProject || generating) return
        const kinds = [['currency', '货币资金'], ['receivable', '应收账款'], ['inventory', '存货'], ['revenue', '营业收入成本']]
        setGenerating(true)
        setGenerateMessage('正在生成 1/4：货币资金…')
        let failed = 0
        let chain = Promise.resolve()
        kinds.forEach(function (entry, index) {
          chain = chain.then(function () {
            setGenerateMessage('正在生成 ' + (index + 1) + '/4：' + entry[1] + '…')
            return api('/audit/workpapers/generate', null, { method: 'POST', body: { project: activeProject, kind: entry[0], reviewer: reviewerName, date: generatedDate } })
              .catch(function () { failed += 1 })
          })
        })
        chain.then(function () {
          setGenerateMessage('全部生成完成：成功 ' + (kinds.length - failed) + ' 个' + (failed ? '，失败 ' + failed + ' 个' : ''))
          return Promise.all([
            api('/audit/workpapers/generated', { project: activeProject }),
            api('/audit/workpapers', { project: activeProject }),
            api('/audit/events', { project: activeProject, limit: 40 }),
          ])
        }).then(function (results) {
          setGenerated((results[0] && results[0].items) || [])
          setWp((results[1] && results[1].items) || [])
          setEvents((results[2] && results[2].events) || [])
        }).catch(function (error) { setGenerateMessage('批量生成失败：' + String(error && error.message ? error.message : error)) })
          .then(function () { setGenerating(false) })
      }
      function exportWorkpapersZip() {
        fetch(BASE + '/audit/workpapers/export?project=' + encodeURIComponent(activeProject), { headers: { 'X-KB-Token': currentToken() } })
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
        const kindByIndex = { ZA: 'currency', 'ZA-1': 'currency', ZE: 'receivable', 'ZE-1': 'receivable', ZJ: 'inventory', 'ZJ-1': 'inventory', SA: 'revenue', 'SA-1': 'revenue' }
        const kind = kindByIndex[indexNo]
        if (!kind) return
        const open = function (items) {
          const found = (items || []).filter(function (item) { return item.kind === kind })[0]
          if (found) previewGeneratedWorkpaper(found)
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
        if (!props.ui || !props.ui.sessions) return
        ensureViaHostCommand(company, project).catch(function () { return null })
          .then(function (workspace) { return workspace || ensureProjectWorkspace(company, project).catch(function () { return null }) })
          .then(function (workspace) {
            return workspace ? props.ui.sessions.create({ workspaceId: workspace.workspaceId }) : props.ui.sessions.create({})
          }).then(function (id) {
          const title = (project ? project.name : company) + ' · ' + new Date().toLocaleString()
          api('/audit/link_session', null, { method: 'POST', body: { project: activeProject, session_id: id, title: title } })
            .then(function () { return api('/audit/project_sessions', { project: activeProject }) })
            .then(function (d) { setLinked(d.sessions || []) }).catch(function () {})
          props.ui.uiWorkspace.openSession(id)
        }).catch(function (error) {
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

      if (loading) return h(Empty, null, '正在加载客户与项目…')
      if (error) return h(Empty, null, '加载失败：' + error + '（检查 mini4pro:8030 与 token）')

      const current = companies.filter(function (c) { return c.name === activeCompany })[0]
      const projects = current ? current.projects : []
      const project = projects.filter(function (p) { return p.id === activeProject })[0]
      const readOnly = Boolean(project && project.status === '已归档')
      const role = ((props.auth && props.auth.user) || {}).role || 'auditor'
      const isManager = ['partner', 'kb-admin', 'admin'].indexOf(role) >= 0
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', marginBottom: '8px' }

      const previewModal = preview ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { width: '82vw', height: '82vh', background: '#fff', color: '#111', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid ' + COLORS.line } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, preview.attachment.filename),
            h('div', { style: { display: 'flex', gap: '10px' } },
              h('button', { onClick: function () { if (preview.onDownload) preview.onDownload() }, style: { border: 0, background: 'transparent', color: COLORS.accent, fontSize: '12px', cursor: 'pointer' } }, '下载'),
              h('button', { onClick: closeAttachmentPreview, style: { border: 0, background: 'transparent', color: COLORS.muted, fontSize: '12px', cursor: 'pointer' } }, '关闭'))),
          h('div', { style: { flex: 1, minHeight: 0, background: '#fff' } },
            String(preview.type).indexOf('image/') === 0
              ? h('img', { src: preview.url, style: { maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto' } })
              : h('iframe', { src: preview.url, style: { width: '100%', height: '100%', border: 0, background: '#fff' }, sandbox: '' }))))
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
        onExportArchive: exportArchive, exporting: exporting,
        report: report, reportLoading: reportLoading, analysis: analysis, matHistory: matHistory,
        onConfirmMateriality: confirmMateriality, onGenerateRiskDocx: generateRiskDocx,
        onLoadChecklist: loadReportChecklist, onLoadOpinion: loadReportOpinion,
        onGenerateDraft: generateReportDraft, onDownloadDraft: downloadReportDraft,
        onLoadVersions: loadReportVersions, onDownloadVersion: downloadVersion,
        onExportDocx: exportReportDocx, onSubmitReview: submitReportReview, onFinalizeReport: finalizeReport,
        generated: generated, generating: generating, generateMessage: generateMessage,
        reviewerName: reviewerName, onReviewerNameChange: setReviewerName,
        members: members, newMemberName: newMemberName, onNewMemberNameChange: setNewMemberName,
        onAddMember: addProjectMember, onRemoveMember: removeProjectMember,
        generatedDate: generatedDate, onGeneratedDateChange: setGeneratedDate,
        onOpenWorkpaperIndex: openWorkpaperByIndex, onGenerateWorkpaper: generateWorkpaper,
        onGenerateAll: generateAllWorkpapers, onExportWorkpapers: exportWorkpapersZip,
        onDownloadWorkpaper: downloadGeneratedWorkpaper, onPreviewWorkpaper: previewGeneratedWorkpaper,
        newPbcName: newPbcName, onPbcNameChange: setNewPbcName, onAddPbc: addPbcItem,
        onDeletePbc: deletePbcItem, onUploadAttachment: uploadPbcAttachment,
        onDownloadAttachment: downloadPbcAttachment, onPreviewAttachment: openAttachmentPreview,
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
          showCreate ? h('div', { style: { padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('input', { value: newClient, onChange: function (e) { setNewClient(e.target.value) }, placeholder: '被审计单位全称', style: inputStyle }),
            h('input', { value: newName, onChange: function (e) { setNewName(e.target.value) }, placeholder: '项目名称（如 2026年度审计）', style: inputStyle }),
            h('input', { value: newPeriod, onChange: function (e) { setNewPeriod(e.target.value) }, placeholder: '会计期间（如 2026）', style: inputStyle }),
            h('select', { value: businessType, onChange: function (e) { setBusinessType(e.target.value) }, style: inputStyle },
              ['年报审计', '专项审计', '内控审计'].map(function (name) { return h('option', { key: name, value: name }, '业务类型：' + name) })),
            createError ? h('div', { style: { fontSize: '11px', color: '#b91c1c' } }, createError) : null,
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button', { onClick: createProject, disabled: creating,
                style: { flex: 1, padding: '6px 10px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, creating ? '创建中…' : '创建项目'),
              h('button', { onClick: function () { setShowCreate(false); setCreateError('') },
                style: { padding: '6px 10px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '取消'))) : null,
          h('div', { style: { padding: '0 8px 12px' } }, companies.map(function (c) {
            const active = c.name === activeCompany
            return h('div', { key: c.name, onClick: function () { setActiveCompany(c.name); setActiveProject(null) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, c.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, c.projects.length + ' 个项目'))
          }))),
        h('div', { style: { width: '260px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { padding: '14px 14px 8px', fontSize: '13px', fontWeight: 600 } }, activeCompany ? '年度项目' : '选择左侧公司'),
          h('div', { style: { padding: '0 8px 12px' } }, projects.map(function (p) {
            const active = p.id === activeProject
            return h('div', { key: p.id, onClick: function () { setActiveProject(p.id) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, p.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, p.period + ' · ' + p.status + (p.business_type ? ' · ' + p.business_type : '')))
          }))),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', gap: '2px', padding: '10px 14px 0', borderBottom: '1px solid ' + COLORS.line, flexShrink: 0, flexWrap: 'wrap' } },
            ['概览', '风险评估', '资料清单', '审计底稿', '项目对话', '审批状态', '报告'].map(function (name) {
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
    function KbPage() {
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
      const middle = h('div', { style: { width: '320px', borderRight: '1px solid ' + COLORS.line, display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0 } },
        searchBox, h('div', { style: { flex: 1, overflow: 'auto', padding: '4px 8px' } }, listItems))
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
    const TYPE_NAMES = { pbc: '资料清单', workpaper: '底稿', approval: '审批', pbc_attachment: '附件', member: '成员' }

    function EventsPage() {
      const [events, setEvents] = React.useState([])
      const [projects, setProjects] = React.useState([])
      const [project, setProject] = React.useState('')
      const [actor, setActor] = React.useState('')
      const [type, setType] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')

      function exportCsv() {
        const params = []
        if (project) params.push('project=' + encodeURIComponent(project))
        if (actor) params.push('actor=' + encodeURIComponent(actor))
        if (type) params.push('item_type=' + encodeURIComponent(type))
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
      function load() {
        setLoading(true); setError('')
        api('/audit/events', { project: project || undefined, actor: actor || undefined, item_type: type || undefined, limit: 200 })
          .then(function (d) { setEvents(d.events || []) })
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
        h('button', { onClick: load, style: { padding: '7px 14px', borderRadius: '7px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '12px', cursor: 'pointer' } }, loading ? '查询中…' : '查询'),
        h('button', { onClick: exportCsv, style: { padding: '7px 14px', borderRadius: '7px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer' } }, '导出 CSV'))

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

    return {
      inject: ['slots', 'uiWorkspace', 'layout', 'sessions', 'workspaces', 'remote', 'remote.commands'],
      apply(ctx) {
        function onStartChat(company, project) {
          const prompt = '【审计项目】公司：' + company + '；项目：' + (project ? project.name : '') +
            (project && project.period ? '；期间：' + project.period : '') +
            '。请作为该项目的审计助手：先检索事务所知识库（准则/法规/模板），再给结论并标注出处；涉及底稿时说明索引号与数据来源。'
          try { ctx.layout.selectPanel(null) } catch (e) {}
          ctx.uiWorkspace.startSession(undefined, { prompt: prompt, whenDraftExists: 'append' })
        }
        function AuditCompaniesPage(props) { return h(CompaniesPage, { onStartChat: onStartChat, ui: ctx, auth: props.auth }) }
        const panels = [
          { id: 'audit-companies', label: '客户与项目', icon: CompaniesIcon, page: withAuth(AuditCompaniesPage), order: 30 },
          { id: 'audit-kb', label: '知识库', icon: KbIcon, page: withAuth(KbPage), order: 31 },
          { id: 'audit-events', label: '操作留痕', icon: EventsIcon, page: withAuth(EventsPage), order: 32 },
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
