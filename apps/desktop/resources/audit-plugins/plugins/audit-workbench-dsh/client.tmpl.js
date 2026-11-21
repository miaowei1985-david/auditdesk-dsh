window.__ModuleLoader__.load({
  id: '@local/dsh-audit-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = 'http://100.101.170.7:8030'
    const TOKEN = '__KB_TOKEN__'
    const CAT = {
      'K-01': '审计准则', 'K-02': '会计准则', 'K-03': '税法征管', 'K-04': '监管案例',
      'K-05': '职业道德', 'K-06': '质量控制', 'K-07': '底稿模板', 'K-08': '客户档案',
      'K-09': '历史经验', 'K-10': '行业专精', 'K-11': '银行函证', 'K-12': '法律法规', 'K-13': '重要性参数',
    }
    const COLORS = { text: 'inherit', muted: 'rgba(127,127,127,0.85)', line: 'rgba(127,127,127,0.22)', accent: '#2f7cf6', bg: 'rgba(127,127,127,0.06)' }

    function api(path, params) {
      const url = new URL(BASE + path)
      Object.keys(params || {}).forEach(function (key) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') url.searchParams.set(key, params[key])
      })
      return fetch(url.toString(), { headers: { 'X-KB-Token': TOKEN } }).then(function (resp) {
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
      if (props.zone === '资料清单') {
        return h('div', null,
          h(Section, null, h('div', { style: { fontSize: '13px' } }, '应收资料清单（PBC）'), h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '2px' } }, '底表由审计员收齐后上传，状态一目了然')),
          h('div', { style: { padding: '6px 14px' } }, PBC.map(function (item) {
            return h('div', { key: item.name, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + COLORS.line } },
              h('span', { style: { fontSize: '13px' } }, item.name), h(Badge, { tone: item.tone }, item.status))
          })))
      }
      if (props.zone === '审计底稿') {
        return h('div', null,
          h(Section, null, h('div', { style: { fontSize: '13px' } }, '审计底稿（审计员产出）'), h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '2px' } }, '按事务所模板生成，底稿与底表分区存放')),
          h('div', { style: { padding: '6px 14px' } }, WP.map(function (item) {
            return h('div', { key: item.name, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + COLORS.line } },
              h('span', { style: { fontSize: '13px' } }, item.name), h(Badge, { tone: item.tone }, item.state))
          })))
      }
      if (props.zone === '项目对话') {
        return h('div', { style: { padding: '20px', maxWidth: '620px' } },
          h('div', { style: { fontSize: '14px', marginBottom: '8px' } }, '项目对话'),
          h('div', { style: { fontSize: '13px', color: COLORS.muted, lineHeight: 1.8 } },
            '该项目的对话、AI 起草与复核意见会集中在这里，并按公司/项目归档。',
            h('br'), '下一步：点击项目后自动带上下文进入 AI 助手（会话按项目隔离）。'))
      }
      return h('div', { style: { padding: '20px', maxWidth: '620px' } },
        h('div', { style: { fontSize: '14px', marginBottom: '8px' } }, '审批状态'),
        APPROVAL.map(function (item) {
          return h('div', { key: item.name, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid ' + COLORS.line } },
            h('div', null, h('div', { style: { fontSize: '13px' } }, item.name), h('div', { style: { fontSize: '12px', color: COLORS.muted } }, item.note)),
            h(Badge, { tone: item.tone }, item.state))
        }))
    }

    function CompaniesPage() {
      const state = React.useState({ loading: true, companies: [], error: '' })
      const companies = state[0].companies; const loading = state[0].loading; const error = state[0].error; const setData = state[1]
      const companyState = React.useState(null); const activeCompany = companyState[0]; const setActiveCompany = companyState[1]
      const projectState = React.useState(null); const activeProject = projectState[0]; const setActiveProject = projectState[1]
      const zoneState = React.useState('资料清单'); const zone = zoneState[0]; const setZone = zoneState[1]

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

      return h('div', { style: { display: 'flex', height: '100%', minHeight: 0, color: COLORS.text } },
        h('div', { style: { width: '260px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { padding: '14px 14px 8px', fontSize: '14px', fontWeight: 600 } }, '客户与项目'),
          h('div', { style: { padding: '0 8px 12px' } }, companies.map(function (c) {
            const active = c.name === activeCompany
            return h('div', { key: c.name, onClick: function () { setActiveCompany(c.name); setActiveProject(null) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, c.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, c.projects.length + ' 个项目'))
          }))),
        h('div', { style: { width: '240px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { padding: '14px 14px 8px', fontSize: '13px', fontWeight: 600 } }, activeCompany ? '年度项目' : '选择左侧公司'),
          h('div', { style: { padding: '0 8px 12px' } }, projects.map(function (p) {
            const active = p.id === activeProject
            return h('div', { key: p.id, onClick: function () { setActiveProject(p.id) },
              style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px',
                background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
              h('div', null, p.name), h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, p.period + ' · ' + p.status))
          }))),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', gap: '4px', padding: '10px 14px 0', borderBottom: '1px solid ' + COLORS.line, flexShrink: 0 } },
            ['资料清单', '审计底稿', '项目对话', '审批状态'].map(function (name) {
              const active = zone === name
              return h('button', { key: name, onClick: function () { setZone(name) },
                style: { border: 0, background: 'transparent', padding: '8px 12px', fontSize: '13px', cursor: 'pointer',
                  color: active ? COLORS.accent : COLORS.muted, borderBottom: '2px solid ' + (active ? COLORS.accent : 'transparent') } }, name)
            })),
          h('div', { style: { flex: 1, overflow: 'auto' } },
            project ? h(Zone, { zone: zone }) : h(Empty, null, activeCompany ? '选择右侧项目查看四个分区' : '选择公司开始')))
      )
    }

    // ---------- 知识库 ----------
    function KbPage() {
      const docsState = React.useState([]); const docs = docsState[0]; const setDocs = docsState[1]
      const queryState = React.useState(''); const q = queryState[0]; const setQ = queryState[1]
      const hitsState = React.useState(null); const hits = hitsState[0]; const setHits = hitsState[1]
      const codeState = React.useState(''); const code = codeState[0]; const setCode = codeState[1]
      const docState = React.useState(null); const doc = docState[0]; const setDoc = docState[1]
      const [searching, setSearching] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(function () {
        let cancelled = false
        api('/kb/docs').then(function (d) { if (!cancelled) setDocs(d.docs || []) }).catch(function (e) { if (!cancelled) setError(String(e)) })
        return function () { cancelled = true }
      }, [])

      function runSearch() {
        if (!q.trim()) return
        setSearching(true); setError('')
        api('/kb/search', { q: q, top_k: 20 }).then(function (d) { setHits(d.hits || []) })
          .catch(function (e) { setError(String(e)) }).then(function () { setSearching(false) })
      }
      function openDoc(ref) {
        const path = ref.split(' › ')[0]
        api('/kb/doc', { doc: path }).then(function (d) { setDoc(d) }).catch(function (e) { setError(String(e)) })
      }

      const counts = {}
      docs.forEach(function (d) { counts[d.code] = (counts[d.code] || 0) + 1 })
      const cats = Object.keys(CAT).filter(function (c) { return counts[c] })

      return h('div', { style: { display: 'flex', height: '100%', minHeight: 0, color: COLORS.text } },
        h('div', { style: { width: '210px', borderRight: '1px solid ' + COLORS.line, overflow: 'auto', flexShrink: 0 } },
          h('div', { style: { padding: '14px 14px 8px', fontSize: '14px', fontWeight: 600 } }, '知识库'),
          h('div', { style: { padding: '0 8px 12px' } },
            h('div', { onClick: function () { setCode(''); setHits(null) }, style: { padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', background: code === '' ? COLORS.accent + '1a' : 'transparent', color: code === '' ? COLORS.accent : COLORS.text } },
              '全部文档（' + docs.length + '）'),
            cats.map(function (c) {
              const active = code === c
              return h('div', { key: c, onClick: function () { setCode(c); setHits(null) },
                style: { padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginTop: '2px', background: active ? COLORS.accent + '1a' : 'transparent', color: active ? COLORS.accent : COLORS.text } },
                h('div', null, CAT[c]), h('div', { style: { fontSize: '11px', color: COLORS.muted } }, counts[c] + ' 篇'))
            }))),
        h('div', { style: { width: '320px', borderRight: '1px solid ' + COLORS.line, display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0 } },
          h('div', { style: { padding: '12px', borderBottom: '1px solid ' + COLORS.line } },
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('input', { value: q, onChange: function (e) { setQ(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') runSearch() },
                placeholder: '检索准则/法规/模板…', style: { flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + COLORS.line, background: 'transparent', color: 'inherit', fontSize: '13px' } }),
              h('button', { onClick: runSearch, disabled: searching, style: { padding: '8px 12px', borderRadius: '8px', border: 0, background: COLORS.accent, color: '#fff', fontSize: '13px', cursor: 'pointer' } }, searching ? '检索中' : '检索')),
            error ? h('div', { style: { fontSize: '12px', color: '#b91c1c', marginTop: '8px' } }, error) : null),
          h('div', { style: { flex: 1, overflow: 'auto', padding: '4px 8px' } },
            hits === null
              ? docs.filter(function (d) { return !code || d.code === code }).slice(0, 200).map(function (d, i) {
                  return h('div', { key: d.code + d.title + i, onClick: function () { openDoc(d.filename) }, style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', marginTop: '2px' } },
                    h('div', { style: { fontSize: '13px' } }, d.title || d.filename),
                    h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, (CAT[d.code] || d.code) + (d.docno ? ' · ' + d.docno : '')))
                })
              : (hits.length === 0 ? h(Empty, null, '没有命中，换个关键词试试') : hits.map(function (hit, i) {
                  return h('div', { key: i, onClick: function () { openDoc(hit.ref) }, style: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', marginTop: '2px', border: '1px solid transparent' } },
                    h('div', { style: { fontSize: '13px' } }, hit.doc && hit.doc.title ? hit.doc.title : hit.ref),
                    h('div', { style: { fontSize: '11px', color: COLORS.muted, marginTop: '2px' } }, (hit.doc && hit.doc.code ? CAT[hit.doc.code] || hit.doc.code : '') + ' · ' + (hit.section || '')),
                    h('div', { style: { fontSize: '12px', color: COLORS.muted, marginTop: '4px', lineHeight: 1.6, maxHeight: '3.2em', overflow: 'hidden' } }, hit.text))
                }))))),
        h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto', padding: '18px 22px' } },
          doc
            ? h('div', null,
                h('div', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '4px' } }, (doc.meta && doc.meta.title) || doc.doc),
                h('div', { style: { fontSize: '12px', color: COLORS.muted, marginBottom: '14px' } },
                  [(doc.meta && doc.meta.code) ? CAT[doc.meta.code] || doc.meta.code : '', doc.meta && doc.meta.docno, doc.meta && doc.meta.effective ? '生效 ' + doc.meta.effective : ''].filter(Boolean).join(' · ')),
                (doc.chunks || []).map(function (c, i) {
                  return h('div', { key: i, style: { marginBottom: '14px' } },
                    h('div', { style: { fontSize: '11px', color: COLORS.muted, marginBottom: '3px' } }, c.section || ''),
                    h('div', { style: { fontSize: '13px', lineHeight: 1.85, whiteSpace: 'pre-wrap' } }, c.text))
                }))
            : h(Empty, null, '左侧检索或选择文档，这里显示条文全文与出处'))
      )
    }

    // ---------- 图标 ----------
    function CompaniesIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M4 21V5a1 1 0 0 1 1-1h7v17M12 21h8V9a1 1 0 0 1 1-1h-9M7 8h2M7 12h2M7 16h2M15 12h3M15 16h3' }))
    }
    function KbIcon(props) {
      const s = props && props.size ? props.size : 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5A2.5 2.5 0 0 1 17.5 21H6.5A2.5 2.5 0 0 1 4 18.5zM8 7h8M8 11h8M8 15h5' }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const panels = [
          { id: 'audit-companies', label: '客户与项目', icon: CompaniesIcon, page: CompaniesPage, order: 30 },
          { id: 'audit-kb', label: '知识库', icon: KbIcon, page: KbPage, order: 31 },
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
