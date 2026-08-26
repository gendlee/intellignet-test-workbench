/**
 * Word 導出（零依賴）：HTML → .doc Blob
 * - BOM + <meta charset> 雙保險防中文亂碼
 * - 樣式全內聯（Word 對 <style> 支援弱）
 * - 內容：標題 → 案例信息表 → 輸入報文 → 差異清單 → 審核記錄
 */

import { esc, fmtTime, stateTypeLabel, statusLabel, kindLabel, plausibilityLabel } from '../util.js'

const KIND_CLS = { added: '#0b7a3b', deleted: '#b3261e', modified: '#9a6700' }
const SUSP_CLS = { low: '#1a7f37', medium: '#b7791f', high: '#c0392b' }

/** 單案例導出（單案例報告形式，保留主標題） */
export function exportCaseWord(c, run) {
  const html = buildCaseSection(c, run, {})
  downloadWord(html, `${c.txnCode}-${c.name}-測試報告.doc`)
}

/**
 * 批量導出（匯總形式）：一個主標題 + 執行統計 + 案例結果總覽表 + 每案例詳情分節。
 * 唯一標識為案例編號（id）；交易碼可維護（允許重複）。
 */
export function exportCasesWord(cases, runsByCase, { exporter = '' } = {}) {
  const summary = buildSummarySection(cases, runsByCase, exporter)
  const sections = cases.map((c, i) => buildCaseSection(c, runsByCase.get(c.id) || null, { pageBreak: i > 0, index: i }))
  downloadWord(summary + sections.join(''), `批量測試結果匯總-${cases.length}案例-${fmtStamp()}.doc`)
}

/** 匯總區：主標題 + 執行統計 + 案例結果總覽表 */
function buildSummarySection(cases, runsByCase, exporter) {
  const stats = { PASS: 0, FAIL: 0, DIFF: 0, NONE: 0 }
  const rows = cases.map((c) => {
    const run = runsByCase.get(c.id) || null
    const verdict = run ? run.verdict : 'NONE'
    stats[verdict] = (stats[verdict] || 0) + 1
    return `
      <tr>
        <td style="${cellStyle}">${esc(c.id)}</td>
        <td style="${cellStyle}"><b>${esc(c.txnCode)}</b></td>
        <td style="${cellStyle}">${esc(c.name)}</td>
        <td style="${cellStyle}">${esc(c.module)}</td>
        <td style="${cellStyle}">${esc(c.type || 'Regular')}</td>
        <td style="${cellStyle}">${run ? `<b style="color:${verdictColor(run.verdict)}">${verdictLabel(run.verdict)}</b>` : '<span style="color:#999">未執行</span>'}</td>
        <td style="${cellStyle}">${run ? fmtTime(run.startedAt, true) : '—'}</td>
        <td style="${cellStyle}">${run ? esc(run.runBy) : '—'}</td>
      </tr>`
  }).join('')
  return `
    <h1 style="font-size:20pt;color:#B3002D;margin:0 0 4px;text-align:center">中銀香港智能化 API 測試工作台</h1>
    <h2 style="font-size:16pt;color:#333;margin:0 0 12px;text-align:center">批量測試結果匯總報告</h2>
    <p style="font-size:9.5pt;color:#999;text-align:center;margin:0 0 14px">導出時間 ${fmtStamp()}${exporter ? ` · 導出人 ${esc(exporter)}` : ''} · 共 ${cases.length} 個案例</p>
    <p style="font-size:11pt;color:#333;margin:0 0 6px">
      執行統計：
      <b style="color:#1a7f37">通過 ${stats.PASS}</b> ·
      <b style="color:#c0392b">失敗 ${stats.FAIL}</b> ·
      <b style="color:#b7791f">有差異 ${stats.DIFF}</b> ·
      <span style="color:#999">未執行 ${stats.NONE}</span>
    </p>
    <h3 style="font-size:13pt;color:#333;margin:14px 0 6px">一、案例結果總覽</h3>
    <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9pt;width:100%">
      <tr style="background:#f2f2f2">
        ${['案例編號', '交易碼', '案例名稱', '模組', '類型', '最近判定', '執行時間', '執行人'].map((h) => `<th style="${cellStyle}">${h}</th>`).join('')}
      </tr>
      ${rows}
    </table>`
}

function fmtStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function buildCaseSection(c, run, { pageBreak = false, index = null } = {}) {
  const rows = []
  rows.push(tr('案例名稱', c.name, '交易碼', c.txnCode))
  rows.push(tr('案例編號', c.id, '業務模組', c.module))
  rows.push(tr('接口類型', stateTypeLabel[c.stateType] || c.stateType, '審核狀態', statusLabel[c.status] || c.status))
  rows.push(tr('建立人', c.createdBy, '建立時間', fmtTime(c.createdAt)))
  if (c.precondition) rows.push(tr('前置條件', c.precondition, '', ''))

  // 匯總模式（index 不為 null）：副標題 + h4 章節；單案例模式：主標題 + 數字章節
  const head = index == null
    ? `<h2 style="font-size:16pt;color:#B3002D;margin:0 0 4px">中銀香港智能化 API 測試工作台 — 測試報告</h2>
       <p style="font-size:9pt;color:#999;margin:0 0 12px">${esc(c.txnCode)} · 生成時間 ${fmtStamp()}</p>`
    : `<h3 style="font-size:14pt;color:#B3002D;margin:0 0 2px">案例 ${index + 1}：${esc(c.txnCode)} — ${esc(c.name)}</h3>
       <p style="font-size:9pt;color:#999;margin:0 0 10px">案例編號 ${esc(c.id)} · 生成時間 ${fmtStamp()}</p>`
  const hSec = (title, num) => index == null
    ? `<h3 style="font-size:13pt;color:#333;margin:12px 0 6px">${num}、${title}</h3>`
    : `<h4 style="font-size:12pt;color:#333;margin:12px 0 5px">${title}</h4>`

  let diffHtml = ''
  let verdictHtml = ''
  if (run && run.diff) {
    const s = run.diff.summary
    verdictHtml = `
      <p style="font-size:12pt;color:#333;margin:6px 0 2px">
        最近執行判定：<b style="color:${verdictColor(run.verdict)}">${verdictLabel(run.verdict)}</b>
        （${fmtTime(run.startedAt, true)} · ${run.runBy}）
      </p>
      <p style="font-size:10pt;color:#666;margin:0 0 8px">
        差異 ${s.total} 項：新增 ${s.added} · 刪除 ${s.deleted} · 修改 ${s.modified}
        ｜ 可疑度：高 ${s.high} · 中 ${s.medium} · 低 ${s.low}
      </p>`
    if (run.diff.items.length) {
      const rowsDiff = run.diff.items.map((i) => `
        <tr>
          <td style="${cellStyle}">${i.path.join('.')}</td>
          <td style="${cellStyle}"><b style="color:${KIND_CLS[i.kind] || '#333'}">${kindLabel[i.kind] || i.kind}</b></td>
          <td style="${cellStyle}">${esc(i.hostValue ?? '（無）')}</td>
          <td style="${cellStyle}">${esc(i.newValue ?? '（無）')}</td>
          <td style="${cellStyle}">${plausibilityLabel[i.plausibility] || i.plausibility}</td>
          <td style="${cellStyle}"><b style="color:${SUSP_CLS[i.suspicion] || '#333'}">${suspLabel(i.suspicion)}</b></td>
          <td style="${cellStyle}">${esc(i.reason)}</td>
        </tr>`).join('')
      diffHtml = `
        ${hSec('字段級差異清單', '三')}
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9pt;width:100%">
          <tr style="background:#f2f2f2">
            ${['字段路徑', '類型', '主機（XML）', '微服務系統（JSON）', '類別', '可疑度', '機器理由'].map((h) => `<th style="${cellStyle}">${h}</th>`).join('')}
          </tr>
          ${rowsDiff}
        </table>`
    }
  } else {
    verdictHtml = `<p style="font-size:10pt;color:#999">尚未執行測試</p>`
  }

  const auditHtml = (c.auditLogs || []).length
    ? `
      ${hSec('審核記錄', '四')}
      <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9pt;width:100%">
        <tr style="background:#f2f2f2">${['時間', '操作', '狀態變化', '執行人', '意見'].map((h) => `<th style="${cellStyle}">${h}</th>`).join('')}</tr>
        ${(c.auditLogs || []).map((l) => `
          <tr>
            <td style="${cellStyle}">${fmtTime(l.at, true)}</td>
            <td style="${cellStyle}">${actionLabel(l.action)}</td>
            <td style="${cellStyle}">${l.from || ''} → ${l.to || ''}</td>
            <td style="${cellStyle}">${esc(l.operator)}</td>
            <td style="${cellStyle}">${esc(l.comment || '')}</td>
          </tr>`).join('')}
      </table>`
    : ''

  return `
    <div style="${pageBreak ? 'page-break-before:always;' : ''}">
      ${head}
      ${hSec('案例信息', '一')}
      <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9.5pt;width:100%">
        ${rows.join('')}
      </table>
      ${hSec('執行結果', '二')}
      ${verdictHtml}
      ${diffHtml}
      ${auditHtml}
    </div>`
}

const cellStyle = 'border:1px solid #bbb;padding:4px 6px;vertical-align:top;word-break:break-all'

function tr(k1, v1, k2, v2) {
  return `<tr>
    <td style="${cellStyle};background:#f7f7f7;width:12%;white-space:nowrap;font-weight:bold">${esc(k1)}</td>
    <td style="${cellStyle};width:38%">${esc(v1)}</td>
    <td style="${cellStyle};background:#f7f7f7;width:12%;white-space:nowrap;font-weight:bold">${esc(k2)}</td>
    <td style="${cellStyle};width:38%">${esc(v2)}</td>
  </tr>`
}

function verdictColor(v) {
  return { PASS: '#1a7f37', FAIL: '#c0392b', DIFF: '#b7791f' }[v] || '#333'
}
function verdictLabel(v) {
  return { PASS: '通過 PASS', FAIL: '失敗 FAIL', DIFF: '有差異 DIFF' }[v] || v
}
function suspLabel(s) {
  return { low: '低', medium: '中', high: '高' }[s] || s
}
function actionLabel(a) {
  return { create: '建立', approve: '審核通過', reject: '審核駁回', update: '更新' }[a] || a
}

/** HTML → .doc 下載（BOM 防中文亂碼） */
export function downloadWord(html, filename) {
  const doc = `﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>測試報告</title></head><body style="font-family:'PingFang TC','Microsoft JhengHei',sans-serif">${html}</body></html>`
  const blob = new Blob([doc], { type: 'application/msword;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}
