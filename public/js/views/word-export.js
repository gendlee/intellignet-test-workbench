/**
 * Word 導出（零依賴）：HTML → .doc Blob
 * - BOM + <meta charset> 雙保險防中文亂碼
 * - 樣式全內聯（Word 對 <style> 支援弱）
 * - 內容：標題 → 案例信息表 → 輸入報文 → 差異清單 → 審核記錄
 */

import { esc, fmtTime, stateTypeLabel, statusLabel, kindLabel, plausibilityLabel } from '../util.js'

const KIND_CLS = { added: '#0b7a3b', deleted: '#b3261e', modified: '#9a6700' }
const SUSP_CLS = { low: '#1a7f37', medium: '#b7791f', high: '#c0392b' }

/** 單案例導出 */
export function exportCaseWord(c, run) {
  const html = buildCaseSection(c, run)
  downloadWord(html, `${c.txnCode}-${c.name}-測試報告.doc`)
}

/** 批量導出：多案例分節（分頁符） */
export function exportCasesWord(cases, runsByCase) {
  const sections = cases.map((c) => buildCaseSection(c, runsByCase.get(c.id) || null, true))
  downloadWord(sections.join(''), `批量測試報告-${cases.length}案例-${fmtStamp()}.doc`)
}

function fmtStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function buildCaseSection(c, run, pageBreak = false) {
  const rows = []
  rows.push(tr('案例名稱', c.name, '交易碼', c.txnCode))
  rows.push(tr('業務模組', c.module, '接口類型', stateTypeLabel[c.stateType] || c.stateType))
  rows.push(tr('審核狀態', statusLabel[c.status] || c.status, '建立人', c.createdBy))
  rows.push(tr('建立時間', fmtTime(c.createdAt), '更新時間', fmtTime(c.updatedAt)))
  if (c.precondition) rows.push(tr('前置條件', c.precondition, '', ''))

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
        <h3 style="font-size:13pt;color:#333;margin:18px 0 6px">三、字段級差異清單</h3>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9pt;width:100%">
          <tr style="background:#f2f2f2">
            ${['字段路徑', '類型', '主機（XML）', '新系統（JSON）', '類別', '可疑度', '機器理由'].map((h) => `<th style="${cellStyle}">${h}</th>`).join('')}
          </tr>
          ${rowsDiff}
        </table>`
    }
  } else {
    verdictHtml = `<p style="font-size:10pt;color:#999">尚未執行測試</p>`
  }

  const auditHtml = (c.auditLogs || []).length
    ? `
      <h3 style="font-size:13pt;color:#333;margin:18px 0 6px">四、審核記錄</h3>
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
      <h2 style="font-size:16pt;color:#B3002D;margin:0 0 4px">中銀香港智能化 API 測試工作台 — 測試報告</h2>
      <p style="font-size:9pt;color:#999;margin:0 0 12px">${c.txnCode} · 生成時間 ${fmtStamp()}</p>
      <h3 style="font-size:13pt;color:#333;margin:12px 0 6px">一、案例信息</h3>
      <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9.5pt;width:100%">
        ${rows.join('')}
      </table>
      <h3 style="font-size:13pt;color:#333;margin:18px 0 6px">二、執行結果</h3>
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
