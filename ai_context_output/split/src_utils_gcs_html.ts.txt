import { REPORT_STATUS_LABELS } from '@/utils/reportStatus';

export type BackupRow = {
  id: string;
  clientName: string;
  startAt: string;
  endAt: string;
  helperName: string;
  status: string;
};

export function generateBackupHtml(date: string, rows: BackupRow[]): string {
  const dataJson = JSON.stringify(rows).replace(/[<>&\u2028\u2029]/g, (char) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[char] || char);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>提供記録バックアップ ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;font-size:14px;color:#1a1a1a;background:#f5f5f5}
header{background:#1976d2;color:#fff;padding:16px 24px}
header h1{font-size:18px;font-weight:600}
header p{font-size:12px;opacity:.85;margin-top:4px}
.toolbar{background:#fff;padding:12px 24px;border-bottom:1px solid #e0e0e0;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.toolbar input,.toolbar select{padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;min-width:160px}
.count{font-size:13px;color:#555;margin-left:auto}
.wrap{padding:16px 24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
th{background:#f0f4f8;font-weight:600;font-size:12px;color:#555;text-align:left;padding:10px 12px;border-bottom:1px solid #e0e0e0}
td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafafa}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge-approved{background:#e8f5e9;color:#2e7d32}
.badge-pending{background:#fff3e0;color:#e65100}
.badge-draft{background:#f5f5f5;color:#757575}
.badge-remanded{background:#fce4ec;color:#c62828}
.empty{text-align:center;padding:48px;color:#999}
</style>
</head>
<body>
<header>
  <h1>提供記録バックアップ</h1>
  <p>対象日: ${date} ／ エクスポート件数: ${rows.length} 件</p>
</header>
<div class="toolbar">
  <input type="search" id="q" placeholder="利用者名・担当者で絞り込み" oninput="render()">
  <select id="status" onchange="render()">
    <option value="">すべてのステータス</option>
    <option value="approved">${REPORT_STATUS_LABELS.approved}</option>
    <option value="pending">${REPORT_STATUS_LABELS.pending}</option>
    <option value="draft">${REPORT_STATUS_LABELS.draft}</option>
    <option value="remanded">${REPORT_STATUS_LABELS.remanded}</option>
  </select>
  <span class="count" id="count"></span>
</div>
<div class="wrap">
  <table>
    <thead>
      <tr>
        <th>利用者名</th>
        <th>開始日時</th>
        <th>終了日時</th>
        <th>担当者</th>
        <th>ステータス</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
</div>
<script>
const ALL = ${dataJson};
const LABELS = ${JSON.stringify(REPORT_STATUS_LABELS)};
const BADGE = {approved:'badge-approved',pending:'badge-pending',draft:'badge-draft',remanded:'badge-remanded'};
function fmt(s){if(!s)return'-';const d=new Date(s);return d.toLocaleDateString('ja-JP')+'\\u00a0'+d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
function td(value){const cell=document.createElement('td');cell.textContent=String(value??'');return cell;}
function render(){
  const q=(document.getElementById('q').value||'').toLowerCase();
  const st=document.getElementById('status').value;
  const rows=ALL.filter(r=>{
    if(st&&r.status!==st)return false;
    if(q&&!(r.clientName+r.helperName).toLowerCase().includes(q))return false;
    return true;
  });
  document.getElementById('count').textContent=rows.length+'件表示中（全'+ALL.length+'件）';
  const tbody=document.getElementById('tbody');
  if(rows.length===0){tbody.innerHTML='<tr><td colspan="5" class="empty">該当する記録がありません</td></tr>';return;}
  tbody.replaceChildren(...rows.map(r=>{
    const row=document.createElement('tr');
    row.append(td(r.clientName),td(fmt(r.startAt)),td(fmt(r.endAt)),td(r.helperName));
    const statusCell=document.createElement('td');
    const badge=document.createElement('span');
    badge.className='badge '+(BADGE[r.status]||'');
    badge.textContent=LABELS[r.status]||r.status;
    statusCell.append(badge);
    row.append(statusCell);
    return row;
  }));
}
render();
</script>
</body>
</html>`;
}
