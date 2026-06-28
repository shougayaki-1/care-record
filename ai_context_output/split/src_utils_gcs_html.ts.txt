export type BackupRow = {
  id: string;
  clientName: string;
  startAt: string;
  endAt: string;
  helperName: string;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  pending: '承認待ち',
  approved: '承認済み',
  remanded: '差し戻し',
};

export function generateBackupHtml(date: string, rows: BackupRow[]): string {
  const dataJson = JSON.stringify(rows).replace(/<\/script>/gi, '<\\/script>');

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
    <option value="approved">承認済み</option>
    <option value="pending">承認待ち</option>
    <option value="draft">下書き</option>
    <option value="remanded">差し戻し</option>
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
const LABELS = ${JSON.stringify(STATUS_LABELS)};
const BADGE = {approved:'badge-approved',pending:'badge-pending',draft:'badge-draft',remanded:'badge-remanded'};
function fmt(s){if(!s)return'-';const d=new Date(s);return d.toLocaleDateString('ja-JP')+'\\u00a0'+d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
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
  tbody.innerHTML=rows.map(r=>'<tr><td>'+r.clientName+'</td><td>'+fmt(r.startAt)+'</td><td>'+fmt(r.endAt)+'</td><td>'+r.helperName+'</td><td><span class="badge '+(BADGE[r.status]||'')+'">'+( LABELS[r.status]||r.status)+'</span></td></tr>').join('');
}
render();
</script>
</body>
</html>`;
}
